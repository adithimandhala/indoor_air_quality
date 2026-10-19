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

    context: dict[str, Any] = {}
    if re.search(r"\b(proxy|prediction|predicted|model estimate|random forest)\b", normalized):
        context = {"calculated_custom_proxy": calculate_indoor_proxy(params.pm25, params.co2, params.tvoc, params.co),
                   "random_forest_estimate": _predict(params), "unit": "custom proxy points; not regulatory AQI", "source": params.data_source}
    elif re.search(r"\b(shap|contribution|feature effect)\b", normalized):
        context = {"contributions": _explain(params).get("contributions", [])[:3], "note": "Attribution describes the model, not causation."}

    messages: list[dict[str, str]] = [{"role": "system", "content": "You are AirMind AI, a concise and natural assistant for an indoor environmental intelligence project. Answer the user's actual question; do not prepend an air-quality report. Use only supplied context for specific readings. The project's target is a custom proxy, not regulatory AQI. Do not claim hardware control or that SHAP proves causation. If the question is unrelated or context is absent, answer conversationally without inventing sensor facts."}]
    if context:
        messages.append({"role": "system", "content": f"Relevant context for this question only: {json.dumps(context, separators=(',', ':'))}"})
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
        return {"answer": "I can follow up on the previous AirMind question. Could you point me to the reading or part of the explanation you mean?", "provider": "rule_based", "intent": "follow_up"}
    return {"answer": "I can help with AirMind AI, a sensor reading, the model's proxy estimate, or practical guidance based on the current inputs. What would you like to explore?", "provider": "rule_based", "intent": "general"}


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