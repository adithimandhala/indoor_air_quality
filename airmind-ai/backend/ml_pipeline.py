"""Training and inference pipeline for the custom indoor air quality proxy."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import Pipeline
from xgboost import XGBRegressor


BASE_DIR = Path(__file__).resolve().parent
DATASET_PATH = BASE_DIR / "data" / "IoT_Indoor_Air_Quality_Dataset.csv"
MODEL_DIR = BASE_DIR / "models"

COLUMN_MAP = {
    "Temperature (?C)": "temperature",
    "Humidity (%)": "humidity",
    "CO2 (ppm)": "co2",
    "PM2.5 (?g/m?)": "pm25",
    "PM10 (?g/m?)": "pm10",
    "TVOC (ppb)": "tvoc",
    "CO (ppm)": "co",
    "Light Intensity (lux)": "light",
    "Motion Detected": "motion",
    "Occupancy Count": "occupancy",
    "Ventilation Status": "ventilation",
}

FEATURES = [
    "temperature", "humidity", "co2", "pm25", "pm10", "tvoc", "co",
    "light", "motion", "occupancy", "ventilation_enc", "hour",
    "day_of_week", "is_working_hours",
]
TARGET_INPUTS = ["pm25", "co2", "tvoc", "co"]


def calculate_indoor_proxy(pm25: float, co2: float, tvoc: float, co: float) -> float:
    """Calculate the project's pollutant-max proxy; this is not regulatory AQI."""
    if pm25 < 12:
        pm25_index = pm25 / 12 * 50
    elif pm25 < 35.4:
        pm25_index = 50 + (pm25 - 12) / (35.4 - 12) * 50
    elif pm25 < 55.4:
        pm25_index = 100 + (pm25 - 35.4) / (55.4 - 35.4) * 50
    else:
        pm25_index = 150 + (pm25 - 55.4) / (150.4 - 55.4) * 50

    co2_index = min(200, max(0, (co2 - 400) / 600 * 150))
    tvoc_index = min(200, max(0, (tvoc - 50) / 450 * 150))
    co_index = min(200, max(0, (co - 0.1) / 4.9 * 150))
    return round(max(pm25_index, co2_index, tvoc_index, co_index), 2)


def prepare_dataset(csv_path: Path = DATASET_PATH) -> tuple[pd.DataFrame, pd.Series, pd.Series]:
    """Read actual records, derive the proxy, and retain chronological order."""
    frame = pd.read_csv(csv_path)
    frame.columns = frame.columns.str.strip()
    original_columns = set(frame.columns)
    required = {"Timestamp", *COLUMN_MAP.keys()}
    missing = required.difference(original_columns)
    if missing:
        raise ValueError(f"Dataset is missing required columns: {sorted(missing)}")
    frame = frame.rename(columns=COLUMN_MAP)

    frame["Timestamp"] = pd.to_datetime(
        frame["Timestamp"], format="%d-%m-%Y %H:%M", errors="coerce"
    )
    for column in [value for value in COLUMN_MAP.values() if value != "ventilation"]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")

    frame["ventilation_enc"] = frame["ventilation"].map({"Open": 1, "Closed": 0})
    frame = frame.dropna(subset=["Timestamp", *TARGET_INPUTS]).copy()
    frame = frame.sort_values("Timestamp", kind="stable").reset_index(drop=True)
    frame["hour"] = frame["Timestamp"].dt.hour
    frame["day_of_week"] = frame["Timestamp"].dt.dayofweek
    frame["is_working_hours"] = frame["hour"].between(8, 18).astype(int)
    frame["indoor_proxy"] = [
        calculate_indoor_proxy(row.pm25, row.co2, row.tvoc, row.co)
        for row in frame.itertuples()
    ]

    features = frame[FEATURES].replace([np.inf, -np.inf], np.nan)
    target = frame["indoor_proxy"].astype(float)
    timestamps = frame["Timestamp"]
    return features, target, timestamps


def temporal_split(
    features: pd.DataFrame,
    target: pd.Series,
    timestamps: pd.Series,
    train_ratio: float = 0.8,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.Series, pd.Series, pd.Series, pd.Series]:
    """Train on the earlier 80%; evaluate once on the latest 20%."""
    split_index = int(len(features) * train_ratio)
    if split_index < 1 or split_index >= len(features):
        raise ValueError("Not enough valid rows for a chronological train/test split.")
    return (
        features.iloc[:split_index], features.iloc[split_index:],
        target.iloc[:split_index], target.iloc[split_index:],
        timestamps.iloc[:split_index], timestamps.iloc[split_index:],
    )


def _pipeline(estimator: Any) -> Pipeline:
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("model", estimator),
    ])


def _metrics(actual: pd.Series, predicted: np.ndarray) -> dict[str, float]:
    return {
        "mae": round(float(mean_absolute_error(actual, predicted)), 4),
        "rmse": round(float(np.sqrt(mean_squared_error(actual, predicted))), 4),
        "r2": round(float(r2_score(actual, predicted)), 4),
    }


def train_and_save(csv_path: Path = DATASET_PATH) -> dict[str, Any]:
    features, target, timestamps = prepare_dataset(csv_path)
    x_train, x_test, y_train, y_test, train_times, test_times = temporal_split(
        features, target, timestamps
    )
    candidates = {
        "Random Forest": (
            "random_forest_model.joblib",
            RandomForestRegressor(
                n_estimators=200, min_samples_leaf=2, max_leaf_nodes=2048,
                random_state=42, n_jobs=-1,
            ),
        ),
        "Gradient Boosting": (
            "gradient_boosting_reproduced.joblib",
            GradientBoostingRegressor(
                n_estimators=200, max_depth=5, learning_rate=0.05, random_state=42
            ),
        ),
        "XGBoost": (
            "xgboost_reproduced.joblib",
            XGBRegressor(
                n_estimators=300, max_depth=5, learning_rate=0.05,
                subsample=0.9, colsample_bytree=0.9, objective="reg:squarederror",
                random_state=42, n_jobs=-1,
            ),
        ),
    }

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    results: dict[str, Any] = {}
    predictions: dict[str, np.ndarray] = {}
    for name, (artifact_name, estimator) in candidates.items():
        pipeline = _pipeline(estimator)
        pipeline.fit(x_train, y_train)
        predicted = pipeline.predict(x_test)
        predictions[name] = predicted
        results[name] = {
            **_metrics(y_test, predicted),
            "artifact": artifact_name,
        }
        joblib.dump(pipeline, MODEL_DIR / artifact_name)

    reproduced_best = min(
        results,
        key=lambda name: (results[name]["mae"], results[name]["rmse"], -results[name]["r2"]),
    )
    selected_name = "Random Forest"
    selected_artifact = candidates[selected_name][0]

    model = joblib.load(MODEL_DIR / "random_forest_model.joblib")
    importance = dict(zip(FEATURES, model.named_steps["model"].feature_importances_))
    source_hash = hashlib.sha256(csv_path.read_bytes()).hexdigest()
    sample_indices = np.linspace(0, len(y_test) - 1, min(500, len(y_test)), dtype=int)
    evaluation_sample = [
        {
            "timestamp": test_times.iloc[index].isoformat(),
            "actual": round(float(y_test.iloc[index]), 3),
            "predicted": round(float(predictions[selected_name][index]), 3),
        }
        for index in sample_indices
    ]
    metadata = {
        "selected_model": selected_name,
        "selected_artifact": selected_artifact,
        "selection_reason": "Random Forest is primary per the user-reported Colab experiment; the original metrics were unavailable for verification.",
        "results_origin": "newly_reproduced",
        "original_colab_results_available": False,
        "reproduced_best_model": reproduced_best,
        "reproduced_metrics_agree_with_selection": reproduced_best == selected_name,
        "evaluation_method": "Chronological holdout: earliest 80% train, latest 20% test; no shuffle.",
        "target_name": "custom_indoor_air_quality_proxy",
        "target_unit": "project index points; not regulatory AQI",
        "target_method": "Maximum of PM2.5, CO2, TVOC, and CO sub-indices; see README.",
        "rows_eligible": int(len(features)),
        "rows_train": int(len(x_train)),
        "rows_test": int(len(x_test)),
        "train_start": train_times.iloc[0].isoformat(),
        "train_end": train_times.iloc[-1].isoformat(),
        "test_start": test_times.iloc[0].isoformat(),
        "test_end": test_times.iloc[-1].isoformat(),
        "dataset_sha256": source_hash,
        "feature_names": FEATURES,
        "comparison": results,
    }
    (MODEL_DIR / "model_meta.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    (MODEL_DIR / "feature_names.json").write_text(json.dumps(FEATURES, indent=2), encoding="utf-8")
    (MODEL_DIR / "feature_importance.json").write_text(
        json.dumps({key: round(float(value), 6) for key, value in importance.items()}, indent=2),
        encoding="utf-8",
    )
    (MODEL_DIR / "evaluation_predictions.json").write_text(
        json.dumps(evaluation_sample, indent=2), encoding="utf-8"
    )
    print(json.dumps(metadata, indent=2))
    return metadata


if __name__ == "__main__":
    train_and_save()