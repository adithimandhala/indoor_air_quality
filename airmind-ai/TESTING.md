# AirMind AI - Verification and Testing Guide

## 1. Running Servers

Both backend and frontend servers run locally in the workspace:

- **Frontend Application**: [http://localhost:5173](http://localhost:5173)
  - Started via: `npm run dev` in `airmind-ai/frontend`
  - Configured with strict port 5173 and Vite proxy
- **Backend API**: [http://localhost:8000](http://localhost:8000)
  - OpenAPI Documentation: [http://localhost:8000/docs](http://localhost:8000/docs)
  - Health Endpoint: [http://localhost:8000/health](http://localhost:8000/health)
  - Started via: `python -m uvicorn api:app --reload --port 8000` in `airmind-ai/backend`

---

## 2. Page-by-Page Verification

### 1. Overview Page (`/`)
- **Center Area**: React Three Fiber 3D classroom cutaway with instanced student desks/chairs, AC unit, window light, animated cyan airflow streamlines, and HTML glass sensor badges. Clicking any sensor card selects it and smoothly focuses the camera.
- **Right Column (470px)**:
  - **Indoor Air Quality Card**: Tooltip, "Project Proxy" pill, semicircle SVG gauge (teal to amber to red gradient) displaying real model proxy points, and current screening status dot.
  - **Selected Sensor Card**: Dropdown of real sensors in shared context, current value + unit, and threshold status badge.
  - **Recent Trends Card**: Recharts area chart for selected sensor labeled "Historical CSV", with clean sparse ticks and unit alignment.
- **Left Nav & System Status**: Real health status (Online green dot), Model: Random Forest, dataset record count, and formatted timestamp.

### 2. Air Quality Page (`/air-quality`)
- **Sensor Grid**: 8 responsive sensor cards (CO2, PM2.5, PM10, TVOC, CO, Temperature, Humidity, Occupancy) with real threshold chips (Normal, Elevated, High, Urgent) and values.
- **Historical Chart**: Recharts AreaChart with time-range selector (`100`, `300`, `500`, `1000` records), gradient fill, dashed reference line for configured screening threshold, and min/max/mean/latest stats row.
- **Collapsible Drawer**: "About the project proxy" explaining derivation vs regulatory AQI.

### 3. Predictions Page (`/predictions`)
- **Left Input Panel**: Full 14-feature control suite with numeric inputs and sliders matching feature ranges.
  - "Reset" button resets to simulated defaults.
  - "Random Record" button loads a real complete row from the historical dataset.
  - Fast, debounced (250ms) prediction updates.
- **Right Panel**:
  - Predicted proxy display with proxy band and delta from calculated formula proxy.
  - Evaluation metrics: R² = 1.0000, MAE = 0.0469 pts, RMSE = 0.1396 pts across 8,000 train / 2,000 test holdout split.
  - Actual vs Predicted line/scatter chart comparing holdout test points.
  - Collapsible "What this model can and cannot do".

### 4. Ventilation Page (`/ventilation`)
- **Status Strip**: Live visual state for ventilation (Open/Closed toggle), CO2 level, PM2.5, and room occupancy.
- **Prioritized Recommendation**: Displays highest-priority actionable guidance from configured screening thresholds (Urgent, High, Medium, Low).
- **Interactive What-If Scenario**:
  - Open ventilation toggle with variable assumed dilution rate slider (10% to 50%).
  - BEFORE vs AFTER comparison cards with delta proxy points.
- **Airflow Streamlines**: Animated SVG airflow cross-section visualizing circulation.

### 5. Explainability Page (`/explainability`)
- **SHAP Summary**: Plain-English lead sentence identifying the top positive driver, along with model base value, estimate, and sum check.
- **Local SHAP Diverging Bar Chart**: Horizontal bars displaying exact contribution points (amber/red for positive contributions that raise the estimate, cyan for negative contributions that lower it).
- **Global Feature Importance**: Horizontal bar chart from fitted Random Forest impurity importances.

### 6. AI Advisor Page (`/advisor`)
- **Chat Window**: Conversational interface with bubble styling, provider indicators ("AirMind Rule-Based Engine" or "OpenAI Response"), and typing indicators.
- **Quick Suggestion Chips**:
  - *"What is AirMind AI?"*
  - *"What is my current CO2 reading?"* (includes threshold evaluation)
  - *"What should I do about the current readings?"*
  - *"Why might my air quality be poor?"* (computes local SHAP attributions)
- **Controls**: "Clear Chat" and Send buttons.

---

## 3. Backend-Down Resilience Test

- **Behavior**: If the backend process is stopped or port 8000 is unreachable:
  - System Status card immediately switches to `Offline` with red indicator dot.
  - All pages surface a friendly notice: `"Can't reach the AirMind backend. Make sure it is running on http://127.0.0.1:8000."`
  - A visible **Retry** button allows instant reconnection once the backend restarts.
  - Raw `Failed to fetch` error strings are suppressed everywhere.
