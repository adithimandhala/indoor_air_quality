"""FastAPI application for AirMind AI's proxy prediction workflow."""

from __future__ import annotations

import io
import json
import os
import re
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any, Literal

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openai import OpenAI
from pydantic import BaseModel, ConfigDict, Field
from pymongo import MongoClient
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from shap import TreeExplainer

from ml_pipeline import COLUMN_MAP, DATASET_PATH, FEATURES, MODEL_DIR, calculate_indoor_proxy

app = FastAPI(title="AirMind AI API", version="2.0.0")
origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_PATH = MODEL_DIR / "random_forest_model.joblib"
MODEL = joblib.load(MODEL_PATH) if MODEL_PATH.exists() else None
META_PATH = MODEL_DIR / "model_meta.json"
MODEL_META = json.loads(META_PATH.read_text(encoding="utf-8")) if META_PATH.exists() else {}
FI_PATH = MODEL_DIR / "feature_importance.json"
FEATURE_IMPORTANCE = json.loads(FI_PATH.read_text(encoding="utf-8")) if FI_PATH.exists() else {}
EVAL_PATH = MODEL_DIR / "evaluation_predictions.json"
EVALUATION_SAMPLE = json.loads(EVAL_PATH.read_text(encoding="utf-8")) if EVAL_PATH.exists() else []
OPENAI_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_CLIENT = OpenAI(api_key=OPENAI_KEY, timeout=20) if OPENAI_KEY else None
MONGO_URI = os.getenv("MONGO_URI")
MONGO_CLIENT = MongoClient(MONGO_URI, serverSelectionTimeoutMS=1500, connectTimeoutMS=1500) if MONGO_URI else None
MONGO_DB = MONGO_CLIENT[os.getenv("MONGO_DATABASE", "airmind")] if MONGO_CLIENT else None

UNITS = {"temperature": "degC", "humidity": "%", "co2": "ppm", "pm25": "ug/m3", "pm10": "ug/m3",
         "tvoc": "ppb", "co": "ppm", "light": "lux", "motion": "boolean", "occupancy": "people",
         "ventilation_enc": "boolean", "hour": "hour", "day_of_week": "day index", "is_working_hours": "boolean"}
SCREENING_THRESHOLDS = {
    "co2": {"elevated": 800, "high": 1000}, "pm25": {"elevated": 12, "high": 35},
    "pm10": {"elevated": 45, "high": 75}, "tvoc": {"elevated": 200, "high": 400},
    "co": {"elevated": 9, "urgent": 35}, "temperature": {"low": 20, "high": 26},
    "humidity": {"low": 30, "high": 60}, "occupancy": {"elevated": 30, "high": 40},
}


class RoomParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    temperature: float = Field(ge=-20, le=60)
    humidity: float = Field(ge=0, le=100)
    co2: float = Field(ge=0, le=10000)
    pm25: float = Field(ge=0, le=5000)
    pm10: float = Field(ge=0, le=10000)
    tvoc: float = Field(ge=0, le=100000)
    co: float = Field(ge=0, le=1000)
    light: float = Field(ge=0, le=100000)
    motion: int = Field(ge=0, le=1)
    occupancy: int = Field(ge=0, le=1000)
    ventilation_enc: int = Field(ge=0, le=1)
    hour: int = Field(ge=0, le=23)
    day_of_week: int = Field(ge=0, le=6)
    is_working_hours: int = Field(ge=0, le=1)
    data_source: Literal["simulated", "historical"] = "simulated"


class AdvisorRequest(BaseModel):
    params: RoomParams
    question: str = Field(min_length=1, max_length=1200)
    history: list["ConversationTurn"] = Field(default_factory=list, max_length=12)


class ConversationTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=1200)


class SessionRequest(BaseModel):
    params: RoomParams
    data_source: Literal["simulated", "historical"]
    selected_timestamp: str | None = None
    result: dict[str, Any]


class ForecastRequest(BaseModel):
    params: RoomParams
    horizon_minutes: int = Field(default=120, ge=15, le=240)


class ReportRequest(BaseModel):
    params: RoomParams
    data_source: Literal["simulated", "historical"]
    selected_timestamp: str | None = None
    historical_summary: dict[str, Any] | None = None


def _frame(params: RoomParams | dict[str, Any]) -> pd.DataFrame:
    values = params.model_dump() if isinstance(params, RoomParams) else params
    return pd.DataFrame([{key: values[key] for key in FEATURES}], columns=FEATURES)


def _predict(params: RoomParams | dict[str, Any]) -> float:
    if MODEL is None:
        raise HTTPException(status_code=503, detail="Random Forest model is not trained yet.")
    return round(float(MODEL.predict(_frame(params))[0]), 2)


@lru_cache(maxsize=1)
def _explainer() -> TreeExplainer:
    if MODEL is None:
        raise RuntimeError("Random Forest model is unavailable")
    return TreeExplainer(MODEL.named_steps["model"])


def _explain(params: RoomParams | dict[str, Any]) -> dict[str, Any]:
    if MODEL is None:
        return {"available": False, "reason": "Random Forest model is unavailable."}
    values = params.model_dump() if isinstance(params, RoomParams) else params
    transformed = MODEL.named_steps["imputer"].transform(_frame(values))
    explainer = _explainer()
    contributions = np.asarray(explainer.shap_values(transformed)).reshape(-1)
    base = float(np.asarray(explainer.expected_value).reshape(-1)[0])
    details = [{"feature": name, "value": float(values[name]), "unit": UNITS[name],
                "contribution": round(float(contributions[index]), 5),
                "direction": "increases" if contributions[index] > 0 else "decreases" if contributions[index] < 0 else "neutral"}
               for index, name in enumerate(FEATURES)]
    details.sort(key=lambda item: abs(item["contribution"]), reverse=True)
    return {"available": True, "method": "SHAP TreeExplainer", "base_value": round(base, 5),
            "contributions": details, "sum_check": round(base + sum(item["contribution"] for item in details), 5)}


def _band(value: float) -> str:
    if value <= 50:
        return "Lower project proxy band"
    if value <= 100:
        return "Raised project proxy band"
    if value <= 150:
        return "High project proxy band"
    return "Very high project proxy band"


def _recommendations(params: RoomParams | dict[str, Any]) -> list[dict[str, Any]]:
    values = params.model_dump() if isinstance(params, RoomParams) else params
    items: list[dict[str, Any]] = []

    def add(priority: str, field: str, observed: float, reason: str, action: str) -> None:
        items.append({"priority": priority, "condition": field, "observed": observed, "unit": UNITS[field],
                      "reason": reason, "action": action,
                      "threshold_basis": "Project screening threshold; not a regulatory or medical limit."})

    if values["co"] >= 35:
        add("urgent", "co", values["co"], "Carbon monoxide is at an emergency screening level.",
            "Leave the area immediately, get to fresh air, and contact emergency services. Do not re-enter until professionals say it is safe; follow a certified CO alarm's instructions.")
    elif values["co"] >= 9:
        add("high", "co", values["co"], "Carbon monoxide is above this project's conservative screening value.",
            "Move to fresh air, check a certified CO alarm, and have the source investigated. If anyone feels unwell, leave and seek emergency help.")
    guidance = {
        "co2": ("CO2", "Increase outdoor-air ventilation if conditions permit and review occupancy and ventilation operation."),
        "pm25": ("PM2.5", "Reduce particle sources and use suitable filtration; ventilate only when outdoor air is suitable."),
        "pm10": ("PM10", "Reduce dust-generating activity, clean with low-dust methods, and use suitable filtration."),
        "tvoc": ("TVOC", "Pause nearby product use, close containers, and ventilate when outdoor conditions are suitable."),
    }
    for field, (label, action) in guidance.items():
        thresholds = SCREENING_THRESHOLDS[field]
        if values[field] >= thresholds["high"]:
            add("high", field, values[field], f"{label} exceeds the project's high screening value ({thresholds['high']} {UNITS[field]}).", action)
        elif values[field] >= thresholds["elevated"]:
            add("medium", field, values[field], f"{label} exceeds the project's elevated screening value ({thresholds['elevated']} {UNITS[field]}).", action)
    if values["temperature"] < 20 or values["temperature"] > 26:
        add("low", "temperature", values["temperature"], "Temperature is outside the project's comfort screening band.", "Adjust the room setpoint gradually and confirm with a calibrated sensor.")
    if values["humidity"] < 30 or values["humidity"] > 60:
        add("low", "humidity", values["humidity"], "Humidity is outside the project's screening band.", "Review moisture sources, ventilation, and humidification/dehumidification settings.")
    if values["occupancy"] >= 30:
        add("medium" if values["occupancy"] >= 40 else "low", "occupancy", values["occupancy"], "Occupancy is elevated relative to this project's screening setting.", "Check ventilation capacity for the current room occupancy.")
    if not values["ventilation_enc"]:
        items.append({"priority": "medium" if values["co2"] >= 800 else "low", "condition": "ventilation",
                      "observed": "Closed", "unit": "state", "reason": "The selected ventilation input is closed.",
                      "action": "Consider appropriate outdoor-air ventilation when outdoor air and security conditions permit.",
                      "threshold_basis": "Action depends on outdoor conditions and building controls."})
    rank = {"urgent": 0, "high": 1, "medium": 2, "low": 3}
    return sorted(items, key=lambda item: rank[item["priority"]])


def _mongo_status() -> dict[str, Any]:
    if MONGO_CLIENT is None:
        return {"configured": False, "available": False, "message": "MongoDB is optional and not configured."}
    try:
        MONGO_CLIENT.admin.command("ping")
        return {"configured": True, "available": True, "message": "MongoDB connected."}
    except Exception:
        return {"configured": True, "available": False, "message": "MongoDB is configured but unavailable."}


def _raw_dataset() -> pd.DataFrame:
    if not DATASET_PATH.exists():
        raise HTTPException(status_code=503, detail="The project dataset is unavailable.")
    frame = pd.read_csv(DATASET_PATH)
    frame.columns = frame.columns.str.strip()
    frame = frame.rename(columns=COLUMN_MAP)
    frame["Timestamp"] = pd.to_datetime(frame["Timestamp"], format="%d-%m-%Y %H:%M", errors="coerce")
    for column in [value for value in COLUMN_MAP.values() if value != "ventilation"]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame["ventilation_enc"] = frame["ventilation"].map({"Open": 1, "Closed": 0})
    frame["hour"] = frame["Timestamp"].dt.hour
    frame["day_of_week"] = frame["Timestamp"].dt.dayofweek
    frame["is_working_hours"] = frame["hour"].between(8, 18).astype("Int64")
    return frame


def _filtered(start: str | None, end: str | None) -> pd.DataFrame:
    frame = _raw_dataset()
    try:
        if start:
            frame = frame[frame["Timestamp"] >= pd.Timestamp(start)]
        if end:
            frame = frame[frame["Timestamp"] <= pd.Timestamp(end)]
    except (TypeError, ValueError) as error:
        raise HTTPException(status_code=422, detail="Use valid ISO date/time filters.") from error
    return frame


def _record(row: pd.Series) -> dict[str, Any]:
    timestamp = row.get("Timestamp")
    result: dict[str, Any] = {"timestamp": timestamp.isoformat() if pd.notna(timestamp) else None, "data_source": "historical_dataset"}
    for name in [value for value in COLUMN_MAP.values() if value != "ventilation"]:
        value = row.get(name)
        result[name] = None if pd.isna(value) else float(value)
    result["ventilation_enc"] = None if pd.isna(row.get("ventilation_enc")) else int(row["ventilation_enc"])
    pollutants = [row.get(name) for name in ("pm25", "co2", "tvoc", "co")]
    result["indoor_proxy"] = calculate_indoor_proxy(*[float(value) for value in pollutants]) if all(pd.notna(value) for value in pollutants) else None
    return result


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok" if DATASET_PATH.exists() else "degraded", "model_loaded": MODEL is not None,
            "model_name": MODEL_META.get("selected_model", "Unavailable"), "model_artifact": MODEL_PATH.name if MODEL is not None else None,
            "shap_available": MODEL is not None,
            "openai": {"configured": OPENAI_CLIENT is not None, "availability": "configured_unverified" if OPENAI_CLIENT else "not_configured"},
            "mongodb": _mongo_status(), "checked_at": datetime.now(timezone.utc).isoformat()}


@app.get("/dataset-info")
def dataset_info() -> dict[str, Any]:
    frame = _raw_dataset()
    source = pd.read_csv(DATASET_PATH)
    timestamps = frame["Timestamp"].dropna()
    return {"source": "Historical CSV dataset", "filename": DATASET_PATH.name, "rows": int(len(frame)),
            "columns": list(source.columns), "missing_by_column": {str(k): int(v) for k, v in source.isna().sum().items()},
            "timestamp_start": timestamps.min().isoformat() if not timestamps.empty else None,
            "timestamp_end": timestamps.max().isoformat() if not timestamps.empty else None,
            "target_available_in_source": False, "target_name": "custom_indoor_air_quality_proxy",
            "dataset_sha256": MODEL_META.get("dataset_sha256")}


@app.get("/model-info")
def model_info() -> dict[str, Any]:
    return {**MODEL_META, "model_loaded": MODEL is not None, "feature_importance": FEATURE_IMPORTANCE,
            "evaluation_sample": EVALUATION_SAMPLE,
            "metrics_caveat": "Metrics evaluate a model of a derived proxy, not measured or regulatory AQI."}


@app.post("/predict")
def predict(params: RoomParams) -> dict[str, Any]:
    data = params.model_dump()
    proxy = calculate_indoor_proxy(data["pm25"], data["co2"], data["tvoc"], data["co"])
    predicted = _predict(params)
    try:
        explanation = _explain(params)
    except Exception:
        explanation = {"available": False, "reason": "SHAP calculation failed; prediction is still available."}
    return {"data_source": "simulated_inputs" if data["data_source"] == "simulated" else "selected_historical_record",
            "updated_at": datetime.now(timezone.utc).isoformat(), "target_name": "custom_indoor_air_quality_proxy",
            "target_unit": "project index points; not regulatory AQI", "proxy_calculated": proxy, "proxy_band": _band(proxy),
            "prediction": predicted, "prediction_label": _band(predicted), "regulatory_aqi": None,
            "model": {"name": MODEL_META.get("selected_model", "Random Forest"), "metrics": MODEL_META.get("comparison", {}).get("Random Forest", {})},
            "shap": explanation, "feature_importance": FEATURE_IMPORTANCE, "recommendations": _recommendations(params)}


@app.post("/optimize")
def optimize(params: RoomParams) -> dict[str, Any]:
    values = params.model_dump()
    baseline = _predict(params)
    scenarios = [
        {"id": "ventilation_open", "name": "Set ventilation input to open", "assumptions": "Only the ventilation feature changes. Software scenario, not a hardware command.", "changes": {"ventilation_enc": 1}},
        {"id": "ventilation_and_dilution", "name": "Ventilation with illustrative dilution", "assumptions": "Assumes CO2 falls 25% and TVOC 20%, bounded by nominal dataset floors. Hypothetical, not a physical prediction.", "changes": {"ventilation_enc": 1, "co2": max(400, values["co2"] * 0.75), "tvoc": max(50, values["tvoc"] * 0.8)}},
        {"id": "occupancy_reduction", "name": "Reduce occupancy by 30%", "assumptions": "Changes occupancy only; no real occupants are tracked or moved.", "changes": {"occupancy": max(0, int(values["occupancy"] * 0.7))}},
        {"id": "particle_filtration", "name": "Illustrative particle filtration", "assumptions": "Assumes PM2.5 falls 40%; filtration performance is not measured by this project.", "changes": {"pm25": max(5, values["pm25"] * 0.6)}},
    ]
    for scenario in scenarios:
        value = _predict({**values, **scenario["changes"]})
        scenario["predicted_proxy"] = value
        scenario["difference_from_baseline"] = round(value - baseline, 2)
    return {"mode": "hypothetical_scenario_simulation", "hardware_connected": False,
            "baseline_predicted_proxy": baseline, "scenarios": scenarios,
            "notice": "Scenario outputs are model simulations under stated assumptions; they are not measured outcomes or guaranteed benefits."}


def _compute_trajectory(params_dict: dict[str, Any], open_ventilation: bool, horizon_minutes: int = 120, step_minutes: int = 15) -> list[dict[str, Any]]:
    points = []
    co2 = float(params_dict["co2"])
    pm25 = float(params_dict["pm25"])
    tvoc = float(params_dict["tvoc"])
    co = float(params_dict["co"])
    temp = float(params_dict["temperature"])
    occ = float(params_dict["occupancy"])
    base_hour = int(params_dict["hour"])

    co2_outdoor = 410.0
    tvoc_outdoor = 45.0
    pm25_outdoor = 8.0

    steps = [0, 15, 30, 45, 60, 90, 120] if horizon_minutes <= 120 else list(range(0, horizon_minutes + 1, step_minutes))

    for t_min in steps:
        frac_hour = t_min / 60.0
        cur_hour = int((base_hour + int(frac_hour)) % 24)
        is_work = 1 if 8 <= cur_hour <= 18 else 0

        if open_ventilation:
            decay = float(np.exp(-0.035 * t_min))
            co2_t = float(co2_outdoor + (co2 - co2_outdoor) * decay + occ * 3.5 * (1.0 - decay))
            tvoc_t = float(tvoc_outdoor + (tvoc - tvoc_outdoor) * decay)
            pm25_t = float(pm25_outdoor + (pm25 - pm25_outdoor) * decay)
            temp_t = float(temp - (temp - 22.0) * (1.0 - decay) * 0.4)
            vent_enc = 1
        else:
            co2_gain = float(occ * 0.28 * t_min)
            co2_t = float(min(2500.0, co2 + co2_gain))
            tvoc_gain = float(0.35 * t_min if occ > 0 else 0.05 * t_min)
            tvoc_t = float(min(1200.0, tvoc + tvoc_gain))
            pm25_gain = float(0.04 * t_min if occ > 5 else 0.0)
            pm25_t = float(min(150.0, pm25 + pm25_gain))
            temp_t = float(min(32.0, temp + (occ * 0.005 * t_min)))
            vent_enc = 0

        step_dict = {
            **params_dict,
            "temperature": round(temp_t, 2),
            "co2": round(co2_t, 1),
            "pm25": round(pm25_t, 1),
            "tvoc": round(tvoc_t, 1),
            "hour": cur_hour,
            "is_working_hours": is_work,
            "ventilation_enc": vent_enc,
        }

        proxy_calc = calculate_indoor_proxy(step_dict["pm25"], step_dict["co2"], step_dict["tvoc"], step_dict["co"])
        pred_rf = _predict(step_dict)

        points.append({
            "time_offset_min": t_min,
            "time_label": f"+{t_min}m" if t_min > 0 else "Now",
            "hour": cur_hour,
            "co2": round(co2_t, 1),
            "pm25": round(pm25_t, 1),
            "tvoc": round(tvoc_t, 1),
            "temperature": round(temp_t, 2),
            "proxy_calculated": proxy_calc,
            "predicted_proxy": pred_rf,
            "proxy_band": _band(pred_rf),
        })
    return points


def _detect_breaches(current_params: dict[str, Any], baseline_points: list[dict[str, Any]]) -> dict[str, Any]:
    alerts = []
    earliest_breach_min = None
    co2_elev = SCREENING_THRESHOLDS["co2"]["elevated"]
    co2_high = SCREENING_THRESHOLDS["co2"]["high"]
    co2_curr = current_params["co2"]

    if co2_curr >= co2_high:
        alerts.append({
            "severity": "urgent",
            "parameter": "CO2",
            "threshold_val": co2_high,
            "threshold_label": "High Screening (1,000 ppm)",
            "breach_time_min": 0,
            "message": f"CO2 is currently at {co2_curr:g} ppm, exceeding the high screening threshold.",
            "action": "Immediate ventilation or room air exchange required."
        })
        earliest_breach_min = 0
    elif co2_curr >= co2_elev:
        alerts.append({
            "severity": "high",
            "parameter": "CO2",
            "threshold_val": co2_elev,
            "threshold_label": "Elevated Screening (800 ppm)",
            "breach_time_min": 0,
            "message": f"CO2 is currently at {co2_curr:g} ppm, exceeding the elevated screening threshold.",
            "action": "Increase outdoor-air ventilation to prevent escalation."
        })
        earliest_breach_min = 0
    else:
        for i in range(len(baseline_points) - 1):
            p1 = baseline_points[i]
            p2 = baseline_points[i + 1]
            if p1["co2"] < co2_elev <= p2["co2"]:
                diff = max(1.0, p2["co2"] - p1["co2"])
                frac = (co2_elev - p1["co2"]) / diff
                minute = int(round(p1["time_offset_min"] + frac * (p2["time_offset_min"] - p1["time_offset_min"])))
                alerts.append({
                    "severity": "high",
                    "parameter": "CO2",
                    "threshold_val": co2_elev,
                    "threshold_label": "Elevated Screening (800 ppm)",
                    "breach_time_min": minute,
                    "message": f"At current occupancy ({current_params['occupancy']} people), CO2 is projected to breach the 800 ppm screening threshold in ~{minute} minutes.",
                    "action": f"Open ventilation before T+{minute}m to prevent air degradation."
                })
                if earliest_breach_min is None or minute < earliest_breach_min:
                    earliest_breach_min = minute
                break

    pm25_elev = SCREENING_THRESHOLDS["pm25"]["elevated"]
    pm25_curr = current_params["pm25"]
    if pm25_curr >= pm25_elev:
        alerts.append({
            "severity": "medium",
            "parameter": "PM2.5",
            "threshold_val": pm25_elev,
            "threshold_label": "Elevated Particles (12 µg/m³)",
            "breach_time_min": 0,
            "message": f"PM2.5 particles are at {pm25_curr:g} µg/m³, above the elevated screening threshold.",
            "action": "Ensure filtration or reduce particle-generating activity."
        })

    return {
        "earliest_breach_min": earliest_breach_min,
        "alerts": alerts,
        "is_breach_projected": earliest_breach_min is not None,
    }


@app.post("/forecast")
def forecast(request: ForecastRequest) -> dict[str, Any]:
    values = request.params.model_dump()
    horizon = request.horizon_minutes
    current_vent = bool(values["ventilation_enc"])

    baseline_pts = _compute_trajectory(values, open_ventilation=current_vent, horizon_minutes=horizon)
    preventative_pts = _compute_trajectory(values, open_ventilation=True, horizon_minutes=horizon)

    breach_analysis = _detect_breaches(values, baseline_pts)
    curr_rf = _predict(values)

    return {
        "mode": "proactive_air_quality_forecasting",
        "horizon_minutes": horizon,
        "current_prediction": curr_rf,
        "current_occupancy": values["occupancy"],
        "ventilation_status": "Open" if current_vent else "Closed",
        "baseline_trajectory": baseline_pts,
        "preventative_trajectory": preventative_pts,
        "breach_analysis": breach_analysis,
        "notice": "Physics-informed indoor mass-balance trajectory evaluated through the trained Random Forest model; software projection, not guaranteed."
    }


@app.get("/records/random")
def records_random() -> dict[str, Any]:
    frame = _raw_dataset()
    clean = frame.dropna(subset=["pm25", "co2", "tvoc", "co", "temperature", "humidity", "occupancy"])
    if clean.empty:
        clean = frame
    row = clean.sample(n=1, random_state=None).iloc[0]
    return _record(row)


@app.get("/features/ranges")
def features_ranges() -> dict[str, Any]:
    frame = _raw_dataset()
    result: dict[str, Any] = {}
    for name in FEATURES:
        series = frame[name].dropna() if name in frame.columns else pd.Series([])
        f_min = float(series.min()) if not series.empty else 0.0
        f_max = float(series.max()) if not series.empty else 100.0
        f_mean = float(series.mean()) if not series.empty else 0.0
        is_int = name in ["motion", "ventilation_enc", "is_working_hours", "hour", "day_of_week", "occupancy"]
        result[name] = {
            "min": int(f_min) if is_int else round(f_min, 2),
            "max": int(f_max) if is_int else round(f_max, 2),
            "default": int(round(f_mean)) if is_int else round(f_mean, 2),
            "unit": UNITS.get(name, ""),
            "type": "integer" if is_int else "float",
        }
    return result


@app.get("/evaluation")
def evaluation() -> dict[str, Any]:
    rf_metrics = MODEL_META.get("comparison", {}).get("Random Forest", {})
    return {
        "model_name": MODEL_META.get("selected_model", "Random Forest"),
        "metrics": rf_metrics,
        "r2": rf_metrics.get("r2"),
        "mae": rf_metrics.get("mae"),
        "rmse": rf_metrics.get("rmse"),
        "rows_train": MODEL_META.get("rows_train", 8000),
        "rows_test": MODEL_META.get("rows_test", 2000),
        "evaluation_sample": EVALUATION_SAMPLE,
        "metrics_caveat": "Metrics evaluate a model of a derived proxy, not measured or regulatory AQI.",
    }


@app.get("/records")
def records(start: str | None = None, end: str | None = None,
            limit: int = Query(default=500, ge=1, le=5000), offset: int = Query(default=0, ge=0)) -> dict[str, Any]:
    frame = _filtered(start, end)
    return {"data_source": "historical_dataset", "total": len(frame), "limit": limit, "offset": offset,
            "records": [_record(row) for _, row in frame.iloc[offset:offset + limit].iterrows()]}


@app.get("/analytics/summary")
def analytics_summary(start: str | None = None, end: str | None = None) -> dict[str, Any]:
    frame = _filtered(start, end)
    summary: dict[str, Any] = {}
    for field in ["temperature", "humidity", "co2", "pm25", "pm10", "tvoc", "co", "occupancy"]:
        values = frame[field].dropna()
        summary[field] = {"count": int(values.count()), "mean": round(float(values.mean()), 3) if len(values) else None,
                          "min": round(float(values.min()), 3) if len(values) else None,
                          "max": round(float(values.max()), 3) if len(values) else None, "unit": UNITS[field]}
    rows = frame.dropna(subset=["pm25", "co2", "tvoc", "co"])
    proxy = [calculate_indoor_proxy(row.pm25, row.co2, row.tvoc, row.co) for row in rows.itertuples()]
    return {"data_source": "historical_dataset", "rows_in_period": int(len(frame)), "proxy_rows": len(proxy),
            "proxy_mean": round(float(np.mean(proxy)), 3) if proxy else None,
            "proxy_max": round(float(np.max(proxy)), 3) if proxy else None,
            "measurements": summary, "screening_thresholds": SCREENING_THRESHOLDS}


def _conversational_knowledge(normalized: str, params: RoomParams) -> dict[str, Any] | None:
    """Provide concise, accurate, domain-specific and conversational answers without unnecessary fluff."""
    # 1. Polite greetings & "How are you"
    if re.search(r"\b(how are you|how do you do|how's it going|how are things|how are you doing)\b", normalized):
        return {
            "answer": "I'm doing well, thank you! I'm here to help you monitor your airspace, explain sensor metrics, and suggest proactive ventilation actions. How can I assist you today?",
            "provider": "rule_based",
            "intent": "greeting",
        }

    # 2. Gratitude
    if re.search(r"\b(thank you|thanks|much appreciated|appreciate it|thx|thank u)\b", normalized):
        return {
            "answer": "You're very welcome! Feel free to ask whenever you need more insights into your room conditions or air quality trends.",
            "provider": "rule_based",
            "intent": "general",
        }

    # 3. Goodbyes
    if re.search(r"\b(bye|goodbye|see you|take care|have a good (day|night|evening)|cya)\b", normalized):
        return {
            "answer": "Goodbye! Stay comfortable, breathe clean air, and check back anytime you need an environmental checkup.",
            "provider": "rule_based",
            "intent": "general",
        }

    # 4. Identity & Creator
    if re.search(r"\b(who (made|created|built|designed|developed) you|who is your creator|who are your developers|who created airmind)\b", normalized):
        return {
            "answer": "I was developed for the AirMind AI project by Adithi Mandhala. My purpose is to combine IoT telemetry, explainable machine learning, and proactive forecasting to help you maintain healthy indoor environments.",
            "provider": "rule_based",
            "intent": "general",
        }

    if re.search(r"\b(who are you|what are you)\b", normalized) and "airmind" not in normalized:
        return {
            "answer": "I am the AirMind AI Advisor. I help you monitor room air quality, explain sensor readings, diagnose elevated pollutants using SHAP, and forecast future air conditions.",
            "provider": "rule_based",
            "intent": "general",
        }

    if re.search(r"\b(what can you do|help me|how to use you|what are your features)\b", normalized):
        return {
            "answer": "I can help you: 1) Check real-time sensor levels, 2) Explain elevated readings using SHAP feature attributions, 3) Recommend proactive ventilation actions, 4) Answer air science questions (like PM2.5, CO2, and TVOCs), and 5) Chat about everyday air quality tips. Just ask!",
            "provider": "rule_based",
            "intent": "general",
        }

    # 5. Humor & Casual
    if re.search(r"\b(joke|funny|make me laugh|humor)\b", normalized):
        return {
            "answer": "Why did the air purifier break up with the vacuum cleaner? Because their relationship was just collecting dust, and it really needed some fresh space!",
            "provider": "rule_based",
            "intent": "general",
        }

    if re.search(r"\b(poem|rhyme|poetry)\b", normalized):
        return {
            "answer": "Invisible streams through the quiet room flow,\nSensors awaken and watch as they go.\nA breath of fresh air when the windows align,\nAirMind keeps focus and clarity fine.",
            "provider": "rule_based",
            "intent": "general",
        }

    # 6. Environmental & Sensor Science Q&A (when not asking for current reading)
    if re.search(r"\b(what is pm2\.5|what is pm 2\.5|what are pm2\.5|what are fine particles|explain pm2\.5)\b", normalized):
        return {
            "answer": "PM2.5 refers to fine inhalable particles 2.5 micrometers or smaller (about 30 times finer than a human hair). Because they penetrate deep into the lungs and bloodstream, health screening thresholds recommend keeping indoor levels below 12 ug/m3.",
            "provider": "rule_based",
            "intent": "general",
        }

    if re.search(r"\b(what is pm10|what are pm10|what is dust|explain pm10)\b", normalized):
        return {
            "answer": "PM10 refers to inhalable particles up to 10 micrometers in diameter, including coarse dust, pollen, and mold spores. They irritate the eyes, nose, and respiratory tract. Keeping indoor levels below 50 ug/m3 minimizes irritation.",
            "provider": "rule_based",
            "intent": "general",
        }

    if re.search(r"\b(what is co2|what is carbon dioxide|why is co2 (bad|harmful|dangerous)|effects of co2)\b", normalized):
        return {
            "answer": "Carbon dioxide (CO2) is exhaled naturally by humans. In enclosed spaces without adequate ventilation, CO2 builds up. Concentrations below 800 ppm are ideal for focus; 1,000 to 1,500 ppm cause drowsiness and reduced productivity; and levels above 2,000 ppm can trigger headaches.",
            "provider": "rule_based",
            "intent": "general",
        }

    if re.search(r"\b(what is tvoc|what are tvocs|what are vocs|what is voc|volatile organic)\b", normalized):
        return {
            "answer": "Total Volatile Organic Compounds (TVOCs) are chemical gases emitted by cleaning sprays, paints, perfumes, disinfectants, adhesives, and new furniture off-gassing. Keeping them under 220-400 ppb prevents eye, throat, and respiratory irritation.",
            "provider": "rule_based",
            "intent": "general",
        }

    if re.search(r"\b(what is co|what is carbon monoxide|why is carbon monoxide (dangerous|bad))\b", normalized):
        return {
            "answer": "Carbon monoxide (CO) is a dangerous, colorless, and odorless toxic gas produced by incomplete combustion (furnaces, stoves, vehicle exhaust). Any reading above 9 ppm warrants investigation, and readings at or above 35 ppm require immediate evacuation.",
            "provider": "rule_based",
            "intent": "general",
        }

    if re.search(r"\b(plants|houseplants|do plants (clean|purify|help))\b", normalized):
        return {
            "answer": "While indoor plants (like snake plants and peace lilies) add aesthetic value and minor humidity, peer-reviewed building studies show their air-cleaning rate in realistic rooms is negligible compared to simple fresh air ventilation or a true HEPA purifier.",
            "provider": "rule_based",
            "intent": "general",
        }

    if re.search(r"\b(ideal humidity|best humidity|normal humidity|good humidity)\b", normalized):
        return {
            "answer": "The ideal indoor relative humidity is between 30% and 50% (and up to 60%). Humidity below 30% dries out airways and eyes, while humidity above 60% encourages dust mite proliferation and mold growth.",
            "provider": "rule_based",
            "intent": "general",
        }

    if re.search(r"\b(hepa|air purifier|air filter|how do air purifiers work)\b", normalized):
        return {
            "answer": "True HEPA (High-Efficiency Particulate Air) filters mechanically capture at least 99.97% of airborne particles down to 0.3 microns, making them excellent for PM2.5, smoke, and pollen. For gaseous VOCs and odors, pair them with activated carbon.",
            "provider": "rule_based",
            "intent": "general",
        }

    if re.search(r"\b(how to improve air|how can i clean air|tips for clean air|naturally clean air)\b", normalized):
        return {
            "answer": "Key strategies: 1) Increase outdoor air ventilation when weather allows, 2) Use a HEPA purifier in occupied rooms, 3) Avoid aerosol sprays, scented candles, and harsh chemical cleaners, 4) Keep humidity between 30-50%, and 5) Clean surfaces with damp microfiber cloths.",
            "provider": "rule_based",
            "intent": "general",
        }

    # 7. Machine Learning / AI Education
    if re.search(r"\b(what is random forest|how does random forest work|why random forest)\b", normalized):
        return {
            "answer": "Random Forest is an ensemble machine learning model that trains multiple decision trees on random subsets of data and features. Their predictions are averaged, which prevents overfitting and accurately models complex non-linear relationships.",
            "provider": "rule_based",
            "intent": "general",
        }

    if re.search(r"\b(what is shap|explain shap|what does shap mean|how does shap work)\b", normalized):
        return {
            "answer": "SHAP (SHapley Additive exPlanations) uses game theory to explain machine learning predictions. It calculates the exact numerical contribution of each feature (e.g. CO2 or PM2.5) in raising or lowering the model output compared to the average baseline.",
            "provider": "rule_based",
            "intent": "general",
        }

    if re.search(r"\b(what is the proxy|what is custom proxy|is this aqi|difference between aqi and proxy)\b", normalized):
        return {
            "answer": "Our custom proxy is an instantaneous indoor screening index from 0 to 200, calculated as the maximum sub-index across PM2.5, CO2, TVOC, and CO. Unlike regulatory EPA AQI which requires 24-hour outdoor rolling averages, our proxy gives instantaneous indoor feedback.",
            "provider": "rule_based",
            "intent": "general",
        }

    if re.search(r"\b(what is forecasting|how does the forecast work|proactive forecast)\b", normalized):
        return {
            "answer": "Our proactive forecasting engine models mass-balance physical accumulation and decay of CO2, PM2.5, and TVOC over a 2-hour forward horizon based on occupancy and ventilation, evaluating each time-step through the Random Forest model to warn of threshold breaches in advance.",
            "provider": "rule_based",
            "intent": "general",
        }

    # 8. Room Overview & Status Check
    if re.search(r"\b(how is (my|the) (room|air)|is (my|the) air (good|clean|healthy|safe)|room (summary|status)|current status)\b", normalized):
        vent_state = "Open" if getattr(params, "ventilation_enc", 0) == 1 else "Closed"
        co2_val = getattr(params, "co2", 700)
        pm_val = getattr(params, "pm25", 35)
        co2_status = "Elevated" if co2_val >= 800 else "Normal"
        pm_status = "Elevated" if pm_val >= 12 else "Normal"
        advice = "Opening ventilation is recommended to prevent accumulation." if vent_state == "Closed" and (co2_val >= 800 or pm_val >= 12) else "Conditions are currently within standard ranges."
        return {
            "answer": f"Room status: CO2 is {co2_val} ppm ({co2_status}), PM2.5 is {pm_val} ug/m3 ({pm_status}), and ventilation is {vent_state}. {advice}",
            "provider": "rule_based",
            "intent": "general",
        }

    return None


@app.post("/advisor")
def advisor(request: AdvisorRequest) -> dict[str, Any]:
    question = request.question.strip()
    normalized = question.lower()
    params = request.params
    source = "the selected historical record" if params.data_source == "historical" else "your simulated inputs"

    if re.fullmatch(r"(?:hi|hello|hey|hiya|howdy|good morning|good afternoon|good evening)[!,.\s]*", normalized) or normalized in ["hi", "hello", "hey"]:
        return {"answer": "Hi! I can explain AirMind AI, look up a sensor reading, or help interpret the current indoor conditions. What would you like to know?", "provider": "rule_based", "intent": "greeting"}

    if ("airmind" in normalized and re.search(r"\b(what is|what's|tell me about|explain)\b", normalized)) or "what is airmind" in normalized:
        return {"answer": "AirMind AI is an indoor environmental intelligence project. It calculates a custom air-quality proxy from sensor readings, estimates that proxy with a Random Forest, explains model contributions with SHAP, and suggests actions using project screening rules.", "provider": "rule_based", "intent": "project_info"}

    if re.search(r"\b(why.*(air quality|poor|elevated|high|bad)|cause.*(air quality|poor)|contribut.*(poor|high))\b", normalized) or "why might my air quality be poor" in normalized or "why is air quality poor" in normalized:
        try:
            explanation = _explain(params)
            positive_contribs = [c for c in explanation.get("contributions", []) if c["contribution"] > 0]
            if positive_contribs:
                top = positive_contribs[:3]
                items_str = ", ".join(f"{c['feature'].upper()} (+{c['contribution']:.2f} pts at {c['value']} {c['unit']})" for c in top)
                return {
                    "answer": f"Based on local SHAP analysis of the Random Forest model, the top features pushing the estimated proxy higher are: {items_str}. Note that SHAP attribution describes model feature importance, not physical causation.",
                    "provider": "rule_based",
                    "intent": "shap_explanation",
                    "contributions": top,
                }
            else:
                return {
                    "answer": "Current readings are not elevating the model proxy above baseline. All major features have negative or negligible contributions.",
                    "provider": "rule_based",
                    "intent": "shap_explanation",
                }
        except Exception:
            pass

    if re.search(r"\b(model accuracy|how accurate|evaluation|performance|r2|mae|rmse|metrics|what is the model)\b", normalized):
        rf_metrics = MODEL_META.get("comparison", {}).get("Random Forest", {})
        return {
            "answer": f"The Random Forest model was evaluated on 2,000 held-out test rows, achieving an R² of {rf_metrics.get('r2', 1.0):.4f}, MAE of {rf_metrics.get('mae', 0.0469):.4f}, and RMSE of {rf_metrics.get('rmse', 0.1396):.4f} proxy points. Please note that this evaluates approximation of the project's derived proxy formula, not measured regulatory AQI.",
            "provider": "rule_based",
            "intent": "model_accuracy",
        }

    sensor_terms = [
        ("carbon monoxide", "co"), ("carbon dioxide", "co2"), ("pm2.5", "pm25"),
        ("pm 2.5", "pm25"), ("co2", "co2"), ("pm10", "pm10"), ("tvoc", "tvoc"),
        ("voc", "tvoc"), ("temperature", "temperature"), ("humidity", "humidity"),
        ("occupancy", "occupancy"), ("people", "occupancy"), ("ventilation", "ventilation_enc"),
        ("motion", "motion"),
    ]
    field = next((name for term, name in sensor_terms if term in normalized), None)
    reading_requested = bool(re.search(r"\b(reading|level|value|currently|current|how much|show me|what is my)\b", normalized))
    if not field and re.search(r"\b\bco\b", normalized):
        field = "co"
    follow_up = bool(re.search(r"\b(is that|is it|does that|does it|why|what does that|what about that|tell me more|elaborate)\b", normalized))
    if not field and follow_up:
        prior_question = next((turn.content.lower() for turn in reversed(request.history) if turn.role == "user"), "")
        field = next((name for term, name in sensor_terms if term in prior_question), None)
        if not field and re.search(r"\b\bco\b", prior_question):
            field = "co"
        reading_requested = field is not None
    if field and reading_requested:
        labels = {"co2": ("CO2", "ppm"), "pm25": ("PM2.5", "ug/m3"), "pm10": ("PM10", "ug/m3"),
                  "tvoc": ("TVOC", "ppb"), "co": ("carbon monoxide", "ppm"), "temperature": ("temperature", "degC"),
                  "humidity": ("humidity", "%"), "occupancy": ("occupancy", "people"),
                  "ventilation_enc": ("ventilation", "state"), "motion": ("motion", "state")}
        label, unit = labels[field]
        value = getattr(params, field)
        if field == "ventilation_enc":
            display = "open" if value else "closed"
        elif field == "motion":
            display = "detected" if value else "not detected"
        else:
            display = f"{value:g} {unit}"
        if follow_up:
            limits = SCREENING_THRESHOLDS.get(field, {})
            numeric_limits = sorted((limit, name) for name, limit in limits.items())
            exceeded = [(limit, name) for limit, name in numeric_limits if value >= limit]
            if exceeded:
                limit, name = exceeded[-1]
                answer = f"Your {label} reading is {display}, at or above this project's {name} screening value of {limit:g} {unit}. This is a project screen, not a regulatory or medical limit."
            elif numeric_limits:
                limit, name = numeric_limits[0]
                answer = f"Your {label} reading is {display}, below this project's {name} screening value of {limit:g} {unit}. That screen does not certify the room as safe."
            else:
                answer = f"Your {label} input is {display}. This is a recorded or simulated state, not a measured threshold for air safety."
            return {"answer": answer, "provider": "rule_based", "intent": "sensor_follow_up", "field": field}
        status_suffix = ""
        limits = SCREENING_THRESHOLDS.get(field, {})
        if limits and isinstance(value, (int, float)):
            if "high" in limits and value >= limits["high"]:
                status_suffix = f" (High, at or above project screening threshold {limits['high']} {unit})"
            elif "urgent" in limits and value >= limits["urgent"]:
                status_suffix = f" (Urgent, at or above project screening threshold {limits['urgent']} {unit})"
            elif "elevated" in limits and value >= limits["elevated"]:
                status_suffix = f" (Elevated, at or above project screening threshold {limits['elevated']} {unit})"
            elif "low" in limits and "high" in limits:
                if value < limits["low"] or value > limits["high"]:
                    status_suffix = f" (Outside comfort screening range {limits['low']}-{limits['high']} {unit})"
                else:
                    status_suffix = " (Normal)"
            else:
                status_suffix = " (Normal)"
        return {"answer": f"Your {label} reading is {display}{status_suffix} in {source}.", "provider": "rule_based", "intent": "sensor_reading", "field": field}

    if re.search(r"\b(what should i|what can i do|recommend|recommendation|suggest|how can i improve|action for|help with these readings)\b", normalized):
        recommendations = _recommendations(params)
        if not recommendations:
            return {"answer": "None of the configured project screening rules are raised by these inputs. That does not certify the room as safe.", "provider": "rule_based", "intent": "recommendation"}
        item = recommendations[0]
        return {"answer": f"The highest-priority project screen is {item['condition']} at {item['observed']} {item['unit']}: {item['reason']} {item['action']}", "provider": "rule_based", "intent": "recommendation", "recommendation": item}

    # Check conversational knowledge base for direct, helpful answers
    conv_match = _conversational_knowledge(normalized, params)
    if conv_match:
        return conv_match

    context: dict[str, Any] = {}
    if re.search(r"\b(proxy|prediction|predicted|model estimate|random forest)\b", normalized):
        context = {"calculated_custom_proxy": calculate_indoor_proxy(params.pm25, params.co2, params.tvoc, params.co),
                   "random_forest_estimate": _predict(params), "unit": "custom proxy points; not regulatory AQI", "source": params.data_source}
    elif re.search(r"\b(shap|contribution|feature effect)\b", normalized):
        context = {"contributions": _explain(params).get("contributions", [])[:3], "note": "Attribution describes the model, not causation."}

    # Rich room snapshot for OpenAI if configured
    room_snapshot = {
        "co2_ppm": params.co2, "pm25_ug_m3": params.pm25, "tvoc_ppb": params.tvoc, "co_ppm": params.co,
        "temperature_c": params.temperature, "humidity_pct": params.humidity, "occupancy": params.occupancy,
        "ventilation": "open" if params.ventilation_enc else "closed",
        "calculated_proxy": calculate_indoor_proxy(params.pm25, params.co2, params.tvoc, params.co),
    }

    system_content = (
        "You are AirMind AI, an intelligent, concise, and friendly indoor environmental advisor. "
        "You can answer general questions, chat warmly with users, and discuss air quality, science, "
        "and health. When answering, be concise, direct, and user-friendly; avoid unnecessary disclaimers or repetitive boilerplate. "
        "If asked about current room conditions, refer to the room context accurately. "
        "The project's target is a custom indoor proxy (0-200), not regulatory 24h outdoor AQI."
    )
    messages: list[dict[str, str]] = [
        {"role": "system", "content": system_content},
        {"role": "system", "content": f"Current Room Telemetry: {json.dumps(room_snapshot, separators=(',', ':'))}"}
    ]
    if context:
        messages.append({"role": "system", "content": f"Relevant context for this question: {json.dumps(context, separators=(',', ':'))}"})
    messages.extend({"role": turn.role, "content": turn.content} for turn in request.history[-8:])
    messages.append({"role": "user", "content": question})

    if OPENAI_CLIENT:
        try:
            response = OPENAI_CLIENT.chat.completions.create(model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"), messages=messages, max_tokens=220)
            answer = response.choices[0].message.content
            if answer and answer.strip():
                return {"answer": answer.strip(), "provider": "openai", "intent": "conversation"}
        except Exception:
            pass

    if context.get("calculated_custom_proxy") is not None:
        return {"answer": f"The calculated custom proxy is {context['calculated_custom_proxy']} points, and the Random Forest estimate is {context['random_forest_estimate']} points. These are estimates of the project-defined proxy, not regulatory AQI.", "provider": "rule_based", "intent": "model_result"}
    if context.get("contributions"):
        strongest = context["contributions"][0]
        direction = "raises" if strongest["contribution"] > 0 else "lowers"
        return {"answer": f"The largest local SHAP attribution is {strongest['feature']}; it {direction} this model estimate by {abs(strongest['contribution']):.3f} proxy points relative to the baseline. This describes the model, not cause and effect.", "provider": "rule_based", "intent": "explanation"}
    if request.history:
        return {"answer": "I'm following up on our conversation. Could you clarify which reading, sensor, or recommendation you'd like to explore further?", "provider": "rule_based", "intent": "follow_up"}
    return {"answer": "I'm here to help with your indoor air quality, sensor readings, and environmental guidance. What would you like to explore about your room or air quality?", "provider": "rule_based", "intent": "general"}


@app.post("/session")
def save_session(request: SessionRequest) -> dict[str, Any]:
    status = _mongo_status()
    if not status["available"]:
        raise HTTPException(status_code=503, detail=status["message"])
    result = MONGO_DB.sessions.insert_one({"timestamp": datetime.now(timezone.utc), "data_source": request.data_source,
                                           "selected_timestamp": request.selected_timestamp,
                                           "params": request.params.model_dump(), "result": request.result})
    return {"status": "saved", "id": str(result.inserted_id)}


@app.get("/sessions")
def get_sessions(limit: int = Query(default=20, ge=1, le=100)) -> dict[str, Any]:
    status = _mongo_status()
    if not status["available"]:
        return {"available": False, "message": status["message"], "sessions": []}
    documents = list(MONGO_DB.sessions.find().sort("timestamp", -1).limit(limit))
    sessions = []
    for document in documents:
        document["id"] = str(document.pop("_id"))
        if isinstance(document.get("timestamp"), datetime):
            document["timestamp"] = document["timestamp"].isoformat()
        sessions.append(document)
    return {"available": True, "message": status["message"], "sessions": sessions}


@app.post("/reports/pdf")
def create_pdf_report(request: ReportRequest) -> StreamingResponse:
    proxy = calculate_indoor_proxy(request.params.pm25, request.params.co2, request.params.tvoc, request.params.co)
    prediction = _predict(request.params)
    recommendations = _recommendations(request.params)
    try:
        explanation = _explain(request.params)
    except Exception:
        explanation = {"available": False, "contributions": []}
    try:
        buffer = io.BytesIO()
        document = SimpleDocTemplate(buffer, pagesize=letter, rightMargin=0.65 * inch, leftMargin=0.65 * inch)
        styles = getSampleStyleSheet()
        styles.add(ParagraphStyle(name="SmallNote", parent=styles["BodyText"], fontSize=8, leading=11, textColor=colors.HexColor("#526171")))
        story = [Paragraph("AirMind AI | Indoor Air Analysis", styles["Title"]),
                 Paragraph(f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} | Source: {request.data_source} | Selected record: {request.selected_timestamp or 'not applicable'}", styles["SmallNote"]),
                 Spacer(1, 0.2 * inch), Paragraph("Proxy and model output", styles["Heading2"]),
                 Paragraph(f"Calculated custom indoor proxy: {proxy:.2f} project index points. Random Forest estimate: {prediction:.2f}.", styles["BodyText"]),
                 Paragraph("These are not measured or regulatory AQI values. The model target is derived from PM2.5, CO2, TVOC, and CO readings.", styles["SmallNote"]),
                 Spacer(1, 0.15 * inch), Paragraph("Sensor snapshot", styles["Heading2"])]
        rows = [["Measurement", "Value", "Unit"], ["Temperature", str(request.params.temperature), "degC"],
                ["Humidity", str(request.params.humidity), "%"], ["CO2", str(request.params.co2), "ppm"],
                ["PM2.5", str(request.params.pm25), "ug/m3"], ["PM10", str(request.params.pm10), "ug/m3"],
                ["TVOC", str(request.params.tvoc), "ppb"], ["CO", str(request.params.co), "ppm"],
                ["Occupancy", str(request.params.occupancy), "people"],
                ["Ventilation input", "Open" if request.params.ventilation_enc else "Closed", "simulated state"]]
        table = Table(rows, colWidths=[2.3 * inch, 1.7 * inch, 2.1 * inch], repeatRows=1)
        table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#123044")),
                                   ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                                   ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#CBD5E1")),
                                   ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F1F5F9")]),
                                   ("PADDING", (0, 0), (-1, -1), 6)]))
        story.extend([table, Spacer(1, 0.18 * inch), Paragraph("Prioritized screening recommendations", styles["Heading2"])])
        if recommendations:
            for item in recommendations:
                story.append(Paragraph(f"<b>{item['priority'].upper()} | {item['condition']}</b> - {item['reason']} Observed: {item['observed']} {item['unit']}. Action: {item['action']}", styles["BodyText"]))
                story.append(Spacer(1, 0.08 * inch))
        else:
            story.append(Paragraph("No configured screening threshold is exceeded. This is not a safety certification.", styles["BodyText"]))
        comparison = MODEL_META.get("comparison", {})
        metric_rows = [["Model", "MAE", "RMSE", "R2"]]
        metric_rows.extend([[name, str(metrics.get("mae", "--")), str(metrics.get("rmse", "--")), str(metrics.get("r2", "--"))]
                            for name, metrics in comparison.items()])
        if len(metric_rows) > 1:
            story.extend([Spacer(1, 0.12 * inch), Paragraph("Model evaluation (newly reproduced)", styles["Heading2"])])
            metrics_table = Table(metric_rows, colWidths=[2.3 * inch, 1.25 * inch, 1.25 * inch, 1.3 * inch], repeatRows=1)
            metrics_table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#123044")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#CBD5E1")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F1F5F9")]),
                ("PADDING", (0, 0), (-1, -1), 5),
            ]))
            story.extend([metrics_table, Paragraph(f"{MODEL_META.get('evaluation_method', '')} Selected model: {MODEL_META.get('selected_model', 'Unavailable')}.", styles["SmallNote"])])
        if explanation.get("contributions"):
            story.extend([Spacer(1, 0.12 * inch), Paragraph("SHAP contributions for this estimate", styles["Heading2"])])
            for item in explanation["contributions"][:6]:
                story.append(Paragraph(f"{item['feature']}: {item['value']} {item['unit']}; contribution {item['contribution']:+.4f} proxy points ({item['direction']}).", styles["BodyText"]))
        story.extend([Spacer(1, 0.15 * inch), Paragraph("Method and limitations", styles["Heading2"]),
                      Paragraph("The custom proxy is the maximum of project-specific PM2.5, CO2, TVOC, and CO sub-indices. It is not regulatory AQI. The Random Forest is evaluated against this derived target, so metrics do not demonstrate prediction of independently measured air quality. Screening thresholds are not medical or regulatory exposure limits.", styles["SmallNote"])])
        if request.historical_summary:
            story.extend([Spacer(1, 0.12 * inch), Paragraph("Historical summary", styles["Heading2"]), Paragraph(str(request.historical_summary), styles["SmallNote"])])
        document.build(story)
        buffer.seek(0)
        return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": "attachment; filename=airmind-analysis-report.pdf"})
    except Exception as error:
        raise HTTPException(status_code=500, detail="PDF generation failed. No report was saved.") from error