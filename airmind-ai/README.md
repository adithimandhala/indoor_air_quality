# AirMind AI

AirMind AI is a React and FastAPI application for exploring historical indoor sensor records, calculating a project-defined indoor air quality proxy, estimating that proxy with Random Forest, explaining estimates with SHAP, and comparing hypothetical input scenarios.

## Architecture

- `frontend/`: React 18, Vite, React Router, Three.js, React Three Fiber, Drei, Chart.js, and Lucide. Six routes share a data context and API client; the 3D Overview is lazy-loaded.
- `backend/main.py`: Existing FastAPI entry point. It exports the current service from `api.py`; the former GB implementation remains above that export as legacy reference.
- `backend/api.py`: Validated API, historical analytics, recommendations, optional OpenAI and MongoDB integrations, SHAP, scenarios, and PDF reporting.
- `backend/ml_pipeline.py`: Dataset parsing, target construction, chronological splitting, preprocessing, model comparison, and artifact export.
- `backend/train_models.py`: Entry point for the newly reproduced comparison. `backend/train_model.py` is the preserved earlier Gradient Boosting training script.
- `backend/data/IoT_Indoor_Air_Quality_Dataset.csv`: The application dataset. The root-level copy is byte-identical.

The Overview room is assembled from lightweight Three.js meshes rather than a downloaded model. Sensor marker positions and the conceptual airflow route are illustrative because the dataset has no spatial coordinates or airflow measurements. Orbit controls support rotate, zoom, pan mode, and reset. The UI shows a textual fallback if WebGL cannot initialize.

## Dataset And Target

The application CSV has 97,458 rows and these 12 source columns:

`Timestamp`, `Temperature (?C)`, `Humidity (%)`, `CO2 (ppm)`, `PM2.5 (?g/m?)`, `PM10 (?g/m?)`, `TVOC (ppb)`, `CO (ppm)`, `Light Intensity (lux)`, `Motion Detected`, `Occupancy Count`, and `Ventilation Status`.

The CSV contains missing values and no measured AQI label. Training drops rows without a valid timestamp or one of the four pollutant measurements required to calculate the target. Other missing feature values remain missing until a median imputer, fitted only on the training partition, processes them. The cleaned records are sorted by timestamp before a no-shuffle split: earliest 80% for training and latest 20% for evaluation. Feature order is centralized in `ml_pipeline.FEATURES`; the saved sklearn pipeline includes the inference-time imputer.

The target is named **custom indoor air quality proxy** and is not regulatory AQI. It is the maximum of four project-specific sub-indices:

- PM2.5 (ug/m3): piecewise linear scaling at 12, 35.4, 55.4, and 150.4 ug/m3. Below 12, `PM2.5 / 12 * 50`; from 12 to 35.4, scale from 50 to 100; from 35.4 to 55.4, scale from 100 to 150; above 55.4, continue the final linear segment.
- CO2 (ppm): `clip((CO2 - 400) / 600 * 150, 0, 200)`.
- TVOC (ppb): `clip((TVOC - 50) / 450 * 150, 0, 200)`.
- CO (ppm): `clip((CO - 0.1) / 4.9 * 150, 0, 200)`.

PM10, temperature, humidity, occupancy, and other fields are features or recommendation inputs but do not directly contribute to the proxy formula. No regulatory AQI is calculated: the data does not provide a measured AQI target, and this project proxy is not a substitute for an applicable standard and its required averaging periods.

The Random Forest receives the same pollutant fields used to construct the target. Consequently, the model comparison evaluates approximation of a deterministic formula, not independent future air-quality prediction. The time-ordered split prevents future rows from entering training, and the preprocessing statistics are learned only on training rows; it cannot make a formula-derived target independent of its source readings.

## Reproduced Model Comparison

The repository notebook `Indoor_Air_Quality.ipynb` contains two empty, unexecuted cells. No original Colab comparison table, evaluation predictions, Random Forest artifact, or XGBoost artifact was present. The previous model metadata reported Gradient Boosting MAE 0.6258 and R2 0.998, with no RMSE or evaluation method; that metadata is preserved in `backend/models/legacy_gradient_boosting_meta.json` and is not comparable to this holdout.

The following results are **newly reproduced**, not the original Colab metrics. All candidates use the same 89,893 eligible chronological records, with 71,914 training rows and 17,979 latest-period test rows. The Random Forest is the selected primary model because it was reported as best in the original experiment and ranked first in this reproduction as well.

| Model | MAE (lower is better) | RMSE (lower is better) | R2 (generally higher is better) | Result |
| --- | ---: | ---: | ---: | --- |
| Random Forest | 0.0469 | 0.1396 | 1.0000 | Selected primary model |
| Gradient Boosting | 0.6446 | 1.1532 | 0.9979 | Comparison model |
| XGBoost | 0.8699 | 1.4165 | 0.9968 | Comparison model |

MAE measures average absolute error. RMSE penalizes larger errors more strongly. R2 compares residual variance with target variance and can be misleading, especially when the target is directly computed from available input features. Values above are rounded to four decimals. The reproduced models use a chronological holdout rather than a random split, so these results should not be compared directly with undocumented Colab metrics.

The reproduced candidates use Random Forest with 200 trees, `min_samples_leaf=2`, and `max_leaf_nodes=2048`; Gradient Boosting with 200 estimators, depth 5, and learning rate 0.05; and XGBoost with 300 estimators, depth 5, and learning rate 0.05. The RF leaf cap keeps the saved primary artifact to roughly 59 MB while preserving its first-place ranking on this evaluation.

## Run Locally

Use two PowerShell terminals.

Backend:

```powershell
cd airmind-ai\backend
python -m pip install -r requirements.txt
python train_models.py
python -m uvicorn main:app --reload --port 8000
```

The Random Forest artifact is `backend/models/random_forest_model.joblib`. The previous `aqi_model.pkl` and `scaler.pkl` are retained; the new service does not relabel or load those legacy Gradient Boosting artifacts. Training writes separately named RF, GB, and XGBoost artifacts, metadata, and a downsampled held-out actual-versus-predicted series.

Frontend:

```powershell
cd airmind-ai\frontend
npm install
npm run dev
```

The frontend defaults to `http://127.0.0.1:8000`. To change it, set `VITE_API_BASE_URL` in the frontend environment. Configure CORS with a comma-separated `CORS_ORIGINS` value in `backend/.env` when using a different frontend origin.

Optional backend environment variables:

- `OPENAI_API_KEY`: Enables OpenAI-backed advisor responses. Without it, a labeled rule-based advisor remains available.
- `OPENAI_MODEL`: Optional model name; defaults to `gpt-4o-mini`.
- `MONGO_URI`: Enables remote MongoDB session persistence. Without an available MongoDB, session snapshots fall back to browser local storage.
- `MONGO_DATABASE`: Optional database name; defaults to `airmind`.
- `CORS_ORIGINS`: Allowed frontend origins; defaults to localhost and 127.0.0.1 on port 5173.

No physical sensor, fan, AC, or building-control integration is included. The interactive source is therefore labeled simulated input; interventions are explicitly hypothetical model scenarios, not forecasts or hardware actions.

## Routes And API

Frontend pages: `/` (interactive room), `/air-quality` (current readings and recent complete historical records), `/predictions` (selected RF metrics only), `/ventilation` (one hypothetical model scenario), `/explainability` (local SHAP and global feature importance), and `/advisor` (conversation).

API endpoints:

- `GET /health`, `GET /dataset-info`, and `GET /model-info` expose service, dataset, and model state.
- `POST /predict` calculates the formula proxy, returns the Random Forest estimate, genuine local SHAP values, and prioritized screening recommendations.
- `POST /optimize` compares explicitly assumed hypothetical sensor changes; it does not issue physical controls or forecast future measurements.
- `GET /records` and `GET /analytics/summary` serve historical CSV records with optional date filters; the six-page UI consumes the records in Air Quality and Overview.
- `POST /advisor` uses OpenAI when configured and otherwise returns a rule-based answer with the provider identified.
- `POST /session` and `GET /sessions` remain available to API clients when MongoDB is configured; session management is not exposed in the frontend.
- `POST /reports/pdf` remains available to API clients and generates a PDF from validated current readings, model results, recommendations, evaluation metrics, and SHAP contributions; report generation is not exposed in the frontend.

The UI's configurable project screening values live in `backend/api.py`. They are clearly marked as screening settings, not medical guidance or regulatory exposure limits. In particular, a low proxy does not mean a room is safe. Carbon monoxide alerts provide conservative leave/fresh-air/emergency guidance at the configured urgent level; follow certified alarm instructions and local emergency guidance.

## Tests

From `airmind-ai/backend`:

```powershell
python -m unittest discover -s tests -v
```

From `airmind-ai/frontend`:

```powershell
npm run build
```

The backend tests cover target breakpoints, missing-value policy, feature order, chronological splitting, model health, prediction/SHAP additivity, invalid inputs, scenarios, historical records, advisor provider output, and PDF generation.

## Limitations

- There are no measured AQI labels or live IoT readings in this repository.
- Model scores evaluate a formula-derived target and do not establish regulatory AQI accuracy or generalization to actual indoor exposure.
- SHAP explains the Random Forest output; it does not show causality.
- Scenario reductions are assumptions, not measured intervention outcomes.
- Project screening values are configurable heuristics and are not substitutes for certified instruments, health advice, building standards, or emergency guidance.