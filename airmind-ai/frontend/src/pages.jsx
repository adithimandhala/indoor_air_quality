import { useState, useEffect, useRef } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ReferenceLine,
  BarChart,
  Bar,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";
import {
  Wind,
  CloudFog,
  Layers,
  Flame,
  AlertCircle,
  Thermometer,
  Droplets,
  Users,
  Sliders,
  RotateCcw,
  Shuffle,
  Send,
  Bot,
  User,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Info,
  ChevronDown,
  Trash2,
  ShieldAlert,
  ShieldCheck,
  Zap,
  Clock,
} from "lucide-react";
import { api, postJSON, API_BASE } from "./api.js";
import { useAirMind } from "./AppContext.jsx";
import "./pages.css";

export function BackendErrorBanner({ error, onRetry }) {
  if (!error) return null;
  const message = error.includes("Can't reach the AirMind backend")
    ? error
    : `Can't reach the AirMind backend. Make sure it is running on ${API_BASE}.`;
  return (
    <div className="backend-error-banner" role="alert">
      <div className="error-icon-box">
        <AlertTriangle size={18} className="text-amber" />
      </div>
      <div className="error-text-content">
        <span className="error-title">Backend Connection Issue</span>
        <p className="error-desc">{message}</p>
      </div>
      {onRetry && (
        <button className="retry-btn" onClick={onRetry}>
          <RotateCcw size={14} /> Retry
        </button>
      )}
    </div>
  );
}

function PageTitle({ eyebrow, title, summary }) {
  return (
    <header className="page-title">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{summary}</p>
      </div>
    </header>
  );
}

const SENSOR_META = [
  { id: "co2", label: "CO2", unit: "ppm", icon: Wind, max: 2000 },
  { id: "pm25", label: "PM2.5", unit: "µg/m³", icon: CloudFog, max: 150 },
  { id: "pm10", label: "PM10", unit: "µg/m³", icon: Layers, max: 200 },
  { id: "tvoc", label: "TVOC", unit: "ppb", icon: Flame, max: 1000 },
  { id: "co", label: "CO", unit: "ppm", icon: AlertCircle, max: 50 },
  { id: "temperature", label: "Temperature", unit: "°C", icon: Thermometer, max: 40 },
  { id: "humidity", label: "Humidity", unit: "%", icon: Droplets, max: 100 },
  { id: "occupancy", label: "Occupancy", unit: "people", icon: Users, max: 60 },
];

function getStatusInfo(field, value, thresholds) {
  if (!thresholds || value == null) return { status: "Normal", color: "var(--cyan)", level: "normal" };
  const limits = thresholds[field];
  if (!limits) return { status: "Normal", color: "var(--cyan)", level: "normal" };

  if (field === "co") {
    if (value >= 35) return { status: "Urgent", color: "var(--red)", level: "high" };
    if (value >= 9) return { status: "High", color: "var(--amber)", level: "elevated" };
    return { status: "Normal", color: "var(--cyan)", level: "normal" };
  }
  if (field === "temperature") {
    if (value < (limits.low || 20) || value > (limits.high || 26)) {
      return { status: "Out of Comfort", color: "var(--amber)", level: "elevated" };
    }
    return { status: "Normal", color: "var(--cyan)", level: "normal" };
  }
  if (field === "humidity") {
    if (value < (limits.low || 30) || value > (limits.high || 60)) {
      return { status: "Out of Range", color: "var(--amber)", level: "elevated" };
    }
    return { status: "Normal", color: "var(--cyan)", level: "normal" };
  }
  if (limits.high && value >= limits.high) {
    return { status: "High", color: "var(--red)", level: "high" };
  }
  if (limits.elevated && value >= limits.elevated) {
    return { status: "Elevated", color: "var(--amber)", level: "elevated" };
  }
  return { status: "Normal", color: "var(--cyan)", level: "normal" };
}

/* =========================================================================
   PAGE 1: AIR QUALITY
   ========================================================================= */
export function AirQualityPage() {
  const {
    params,
    historyRecords,
    screeningThresholds,
    selectedSensorId,
    setSelectedSensorId,
    error,
    retry,
  } = useAirMind();

  const [timeRange, setTimeRange] = useState(300);

  const activeSensorId = selectedSensorId || "co2";
  const activeSensor = SENSOR_META.find((s) => s.id === activeSensorId) || SENSOR_META[0];

  const filteredHistory = historyRecords
    .filter((r) => r.timestamp && r[activeSensorId] != null)
    .slice(-timeRange);

  const chartData = filteredHistory.map((r) => ({
    timestamp: r.timestamp,
    time: new Date(r.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    date: new Date(r.timestamp).toLocaleDateString([], { month: "short", day: "numeric" }),
    value: Number(r[activeSensorId]),
  }));

  const values = chartData.map((d) => d.value).filter(Number.isFinite);
  const minVal = values.length ? Math.min(...values).toFixed(1) : "--";
  const maxVal = values.length ? Math.max(...values).toFixed(1) : "--";
  const meanVal = values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : "--";
  const latestVal = values.length ? values[values.length - 1].toFixed(1) : "--";

  const thresholdDef = screeningThresholds?.[activeSensorId];
  const thresholdVal = thresholdDef?.elevated || thresholdDef?.high || null;

  return (
    <div className="page-stack">
      <BackendErrorBanner error={error} onRetry={retry} />
      <PageTitle
        eyebrow="HISTORICAL OBSERVATIONS & LIVE PROXY"
        title="Air Quality"
        summary="Explore multi-sensor readings, screening thresholds, and historical CSV observations."
      />

      {/* Sensor Grid */}
      <div className="aq-sensor-grid">
        {SENSOR_META.map((sensor) => {
          const val = params[sensor.id];
          const statusInfo = getStatusInfo(sensor.id, val, screeningThresholds);
          const isSelected = activeSensorId === sensor.id;
          const Icon = sensor.icon;
          return (
            <div
              key={sensor.id}
              className={`aq-sensor-card ${isSelected ? "selected" : ""}`}
              onClick={() => setSelectedSensorId(sensor.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && setSelectedSensorId(sensor.id)}
            >
              <div className="aq-card-header">
                <div className="aq-icon-wrap">
                  <Icon size={16} />
                </div>
                <span className="aq-sensor-title">{sensor.label}</span>
                <span className="aq-status-chip" style={{ color: statusInfo.color }}>
                  <span className="dot" style={{ backgroundColor: statusInfo.color }} />
                  {statusInfo.status}
                </span>
              </div>
              <div className="aq-card-body">
                <span className="aq-val font-mono">
                  {val != null ? val : "--"}
                </span>
                <span className="aq-unit">{sensor.unit}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Historical Trend Chart */}
      <div className="panel aq-chart-panel">
        <div className="panel-head aq-panel-head">
          <div>
            <div className="flex-row items-center gap-2">
              <h3>{activeSensor.label} Historical Trend</h3>
              <span className="honest-pill">Historical CSV</span>
            </div>
            <p>Recorded observations from the project dataset across the selected window.</p>
          </div>
          <div className="time-range-controls">
            {[100, 300, 500, 1000].map((count) => (
              <button
                key={count}
                className={`range-pill ${timeRange === count ? "active" : ""}`}
                onClick={() => setTimeRange(count)}
              >
                {count} records
              </button>
            ))}
          </div>
        </div>

        <div className="aq-chart-container">
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData} margin={{ top: 10, right: 15, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="aqTealGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2ee6d6" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#2ee6d6" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(46, 230, 214, 0.08)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="time"
                stroke="#8fa9b8"
                tick={{ fill: "#8fa9b8", fontSize: 11 }}
                minTickGap={40}
              />
              <YAxis
                stroke="#8fa9b8"
                tick={{ fill: "#8fa9b8", fontSize: 11 }}
                domain={["auto", "auto"]}
              />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: "rgba(8, 24, 40, 0.95)",
                  border: "1px solid rgba(46, 230, 214, 0.3)",
                  borderRadius: "12px",
                  color: "#e8f4f8",
                  fontSize: "12px",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                }}
                formatter={(val) => [`${val} ${activeSensor.unit}`, activeSensor.label]}
                labelFormatter={(_, items) => {
                  const p = items?.[0]?.payload;
                  return p ? `${p.date} · ${p.time}` : "";
                }}
              />
              {thresholdVal && (
                <ReferenceLine
                  y={thresholdVal}
                  stroke="#ffb347"
                  strokeDasharray="4 4"
                  label={{
                    value: `Screening: ${thresholdVal} ${activeSensor.unit}`,
                    fill: "#ffb347",
                    position: "top",
                    fontSize: 11,
                  }}
                />
              )}
              <Area
                type="monotone"
                dataKey="value"
                stroke="#2ee6d6"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#aqTealGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Stats Row */}
        <div className="aq-stats-row">
          <div className="aq-stat-tile">
            <span className="stat-label">Min</span>
            <span className="stat-val font-mono">{minVal} <small>{activeSensor.unit}</small></span>
          </div>
          <div className="aq-stat-tile">
            <span className="stat-label">Max</span>
            <span className="stat-val font-mono">{maxVal} <small>{activeSensor.unit}</small></span>
          </div>
          <div className="aq-stat-tile">
            <span className="stat-label">Mean</span>
            <span className="stat-val font-mono">{meanVal} <small>{activeSensor.unit}</small></span>
          </div>
          <div className="aq-stat-tile">
            <span className="stat-label">Latest</span>
            <span className="stat-val font-mono">{latestVal} <small>{activeSensor.unit}</small></span>
          </div>
        </div>
      </div>

      {/* Method details accordion */}
      <details className="method-details">
        <summary>About the project proxy</summary>
        <p>
          The custom proxy is the maximum of project-specific PM2.5, CO2, TVOC, and CO sub-indices.
          It is formula-derived; the dataset contains no measured AQI target, and this value is not
          regulatory AQI. Screening thresholds are project indicators, not medical exposure standards.
        </p>
      </details>
    </div>
  );
}

/* =========================================================================
   PAGE 2: PREDICTIONS
   ========================================================================= */
function ProactiveForecastCard({ forecast, params, updateParam }) {
  const [showPreventative, setShowPreventative] = useState(true);

  if (!forecast) {
    return (
      <div className="panel pred-forecast-card">
        <div className="panel-head">
          <div>
            <h3>Proactive Air Quality Forecast</h3>
            <p>Evaluating 2-hour trajectory through the Random Forest model...</p>
          </div>
        </div>
      </div>
    );
  }

  const { baseline_trajectory = [], preventative_trajectory = [], breach_analysis = {} } = forecast;
  const { is_breach_projected, earliest_breach_min, alerts = [] } = breach_analysis;
  const isVentOpen = Boolean(params.ventilation_enc);

  const chartData = baseline_trajectory.map((pt, idx) => {
    const prev = preventative_trajectory[idx] || {};
    return {
      time: pt.time_label,
      time_offset: pt.time_offset_min,
      status_quo_proxy: pt.predicted_proxy,
      preventative_proxy: prev.predicted_proxy,
      co2_projected: pt.co2,
      co2_preventative: prev.co2,
      pm25_projected: pt.pm25,
      temperature: pt.temperature,
    };
  });

  return (
    <div className="panel pred-forecast-card">
      <div className="panel-head">
        <div>
          <div className="flex-row items-center gap-2">
            <h3>Proactive Air Quality Forecast (120m Horizon)</h3>
            <span className="honest-pill">Physics-Informed RF Projection</span>
          </div>
          <p>
            Dynamic indoor mass-balance trajectory continuously evaluated by the Random Forest model.
          </p>
        </div>
        <div className="flex-row items-center gap-2">
          <label className="forecast-toggle-label">
            <input
              type="checkbox"
              checked={showPreventative}
              onChange={(e) => setShowPreventative(e.target.checked)}
            />
            <span>Show Preventative Curve</span>
          </label>
        </div>
      </div>

      {/* Breach Alert / Safety Banner */}
      {is_breach_projected && earliest_breach_min != null ? (
        <div className={`forecast-alert-banner ${earliest_breach_min === 0 ? "active-breach" : "imminent-breach"}`}>
          <div className="fab-icon-wrap">
            <ShieldAlert size={22} className={earliest_breach_min === 0 ? "text-red" : "text-amber"} />
          </div>
          <div className="fab-content">
            <div className="fab-header">
              <strong className="fab-title">
                {earliest_breach_min === 0
                  ? "Screening Threshold Currently Breached"
                  : `Projected Threshold Breach in ~${earliest_breach_min} Minutes`}
              </strong>
              <span className="fab-time-pill font-mono">
                {earliest_breach_min === 0 ? "Immediate" : `T+${earliest_breach_min}m`}
              </span>
            </div>
            <p className="fab-message">
              {alerts[0]?.message || `At current occupancy (${params.occupancy} people) with closed ventilation, CO2 is projected to exceed 800 ppm.`}
            </p>
          </div>
          {!isVentOpen && (
            <button
              className="fab-action-btn"
              onClick={() => updateParam("ventilation_enc", 1)}
              title="Avert breach by opening room ventilation"
            >
              <Zap size={14} /> Open Ventilation Now
            </button>
          )}
        </div>
      ) : (
        <div className="forecast-alert-banner stable-airspace">
          <div className="fab-icon-wrap">
            <ShieldCheck size={22} className="text-cyan" />
          </div>
          <div className="fab-content">
            <div className="fab-header">
              <strong className="fab-title">Airspace Trajectory Stable</strong>
              <span className="fab-time-pill safe font-mono">2h Safe</span>
            </div>
            <p className="fab-message">
              Under current {isVentOpen ? "active ventilation" : "moderate room activity"}, all pollutant concentrations remain below screening thresholds for the next 2 hours.
            </p>
          </div>
        </div>
      )}

      {/* Trajectory Recharts Chart */}
      <div className="forecast-chart-wrap">
        <div className="forecast-chart-legend">
          <div className="fcl-item">
            <span className="fcl-line status-quo" style={{ background: isVentOpen ? "var(--cyan)" : "var(--amber)" }} />
            <span>Projected Proxy (Current: {isVentOpen ? "Ventilated" : "Closed"})</span>
          </div>
          {showPreventative && (
            <div className="fcl-item">
              <span className="fcl-line preventative" />
              <span>Averted Proxy (Open Ventilation)</span>
            </div>
          )}
          <div className="fcl-item">
            <span className="fcl-line threshold" />
            <span>Elevated Threshold (800 ppm / 100 pts)</span>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={210}>
          <AreaChart data={chartData} margin={{ top: 10, right: 15, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="forecastAmberGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={isVentOpen ? "#2ee6d6" : "#ffb347"} stopOpacity={0.4} />
                <stop offset="95%" stopColor={isVentOpen ? "#2ee6d6" : "#ffb347"} stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(46, 230, 214, 0.08)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="time" stroke="#8fa9b8" tick={{ fill: "#8fa9b8", fontSize: 11 }} />
            <YAxis stroke="#8fa9b8" tick={{ fill: "#8fa9b8", fontSize: 11 }} domain={["auto", "auto"]} />
            <RechartsTooltip
              contentStyle={{
                backgroundColor: "rgba(8, 24, 40, 0.95)",
                border: "1px solid rgba(46, 230, 214, 0.3)",
                borderRadius: "12px",
                color: "#e8f4f8",
                fontSize: "12px",
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              }}
              formatter={(val, name) => [
                `${val} pts`,
                name === "status_quo_proxy" ? "Status Quo Proxy" : "Averted Proxy",
              ]}
              labelFormatter={(_, items) => {
                const p = items?.[0]?.payload;
                return p ? `Forecast: ${p.time} (${p.time_offset} min) · CO2: ${p.co2_projected} ppm` : "";
              }}
            />
            <ReferenceLine
              y={100}
              stroke="#ffb347"
              strokeDasharray="4 4"
              label={{ value: "Elevated Proxy (100 pts)", fill: "#ffb347", position: "top", fontSize: 10 }}
            />
            <Area
              type="monotone"
              dataKey="status_quo_proxy"
              stroke={isVentOpen ? "#2ee6d6" : "#ffb347"}
              strokeWidth={2.5}
              fill="url(#forecastAmberGrad)"
              name="status_quo_proxy"
            />
            {showPreventative && (
              <Line
                type="monotone"
                dataKey="preventative_proxy"
                stroke="#2ee6d6"
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={{ r: 3, fill: "#2ee6d6" }}
                name="preventative_proxy"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Snapshot Projection Tiles */}
      <div className="forecast-tiles-row">
        {[
          { offset: 15, label: "+15m Projection" },
          { offset: 30, label: "+30m Projection" },
          { offset: 60, label: "+1h Projection" },
          { offset: 120, label: "+2h Projection" },
        ].map(({ offset, label }) => {
          const pt = baseline_trajectory.find((p) => p.time_offset_min === offset) || {};
          const isHigh = pt.co2 >= 1000;
          const isElev = pt.co2 >= 800;
          const statusCol = isHigh ? "var(--red)" : isElev ? "var(--amber)" : "var(--cyan)";

          return (
            <div key={offset} className="forecast-mini-tile">
              <span className="fmt-label">{label}</span>
              <div className="flex-row items-baseline gap-2">
                <strong className="fmt-proxy font-mono" style={{ color: statusCol }}>
                  {pt.predicted_proxy != null ? pt.predicted_proxy.toFixed(1) : "--"}
                </strong>
                <small className="fmt-unit">pts</small>
              </div>
              <div className="fmt-details">
                <span>CO2: <strong className="font-mono">{pt.co2 != null ? pt.co2 : "--"} ppm</strong></span>
                <span>PM2.5: <strong className="font-mono">{pt.pm25 != null ? pt.pm25 : "--"} µg/m³</strong></span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


export function PredictionsPage() {
  const {
    params,
    updateParam,
    resetToInitial,
    loadRandomRecord,
    dataSource,
    selectedTimestamp,
    prediction,
    modelInfo,
    forecast,
    error,
    retry,
  } = useAirMind();

  const [evalData, setEvalData] = useState([]);

  useEffect(() => {
    if (modelInfo?.evaluation_sample?.length) {
      setEvalData(modelInfo.evaluation_sample);
    } else {
      api("/evaluation")
        .then((res) => {
          if (res?.evaluation_sample) setEvalData(res.evaluation_sample);
        })
        .catch(() => {});
    }
  }, [modelInfo]);

  const metrics = modelInfo?.comparison?.["Random Forest"] || {
    mae: 0.0469,
    rmse: 0.1396,
    r2: 1.0,
  };

  const chartPoints = evalData.slice(0, 50).map((pt, idx) => ({
    index: idx + 1,
    actual: Number(pt.actual),
    predicted: Number(pt.predicted),
    timestamp: pt.timestamp ? new Date(pt.timestamp).toLocaleDateString() : `#${idx + 1}`,
  }));

  const calculatedProxy = prediction?.proxy_calculated != null ? prediction.proxy_calculated.toFixed(2) : "--";
  const predictedProxy = prediction?.prediction != null ? prediction.prediction.toFixed(2) : "--";
  const delta = (prediction?.prediction != null && prediction?.proxy_calculated != null)
    ? (prediction.prediction - prediction.proxy_calculated).toFixed(2)
    : "0.00";

  return (
    <div className="page-stack">
      <BackendErrorBanner error={error} onRetry={retry} />
      <PageTitle
        eyebrow="MACHINE LEARNING MODEL"
        title="Predictions"
        summary="Random Forest estimates the project-defined indoor air-quality proxy across 14 environmental and schedule features."
      />

      <div className="predictions-layout">
        {/* Left Column: 14 Feature Controls */}
        <div className="panel pred-inputs-panel">
          <div className="panel-head pred-panel-head">
            <div>
              <h3>Input Features</h3>
              <p>Adjust simulated inputs or load a historical row.</p>
            </div>
            <div className="pred-actions">
              <button className="pred-btn" onClick={resetToInitial} title="Reset to default simulated inputs">
                <RotateCcw size={13} /> Reset
              </button>
              <button className="pred-btn primary" onClick={loadRandomRecord} title="Load a random historical CSV record">
                <Shuffle size={13} /> Random Record
              </button>
            </div>
          </div>

          <div className="source-banner">
            <span className={`dot ${dataSource === "historical" ? "dot-cyan" : "dot-amber"}`} />
            <span>
              Source: <strong>{dataSource === "historical" ? "Historical Record" : "Simulated Inputs"}</strong>
              {selectedTimestamp && ` (${new Date(selectedTimestamp).toLocaleString()})`}
            </span>
          </div>

          <div className="pred-sliders-scroll">
            <h4 className="slider-group-title">Key Pollutants & Environment</h4>
            <div className="slider-grid">
              <SliderField
                label="CO2"
                unit="ppm"
                val={params.co2}
                min={300}
                max={2000}
                step={10}
                onChange={(v) => updateParam("co2", v)}
              />
              <SliderField
                label="PM2.5"
                unit="µg/m³"
                val={params.pm25}
                min={0}
                max={150}
                step={1}
                onChange={(v) => updateParam("pm25", v)}
              />
              <SliderField
                label="PM10"
                unit="µg/m³"
                val={params.pm10}
                min={0}
                max={200}
                step={1}
                onChange={(v) => updateParam("pm10", v)}
              />
              <SliderField
                label="TVOC"
                unit="ppb"
                val={params.tvoc}
                min={0}
                max={1000}
                step={10}
                onChange={(v) => updateParam("tvoc", v)}
              />
              <SliderField
                label="Carbon Monoxide"
                unit="ppm"
                val={params.co}
                min={0}
                max={50}
                step={0.5}
                onChange={(v) => updateParam("co", v)}
              />
              <SliderField
                label="Temperature"
                unit="°C"
                val={params.temperature}
                min={10}
                max={40}
                step={0.5}
                onChange={(v) => updateParam("temperature", v)}
              />
              <SliderField
                label="Humidity"
                unit="%"
                val={params.humidity}
                min={10}
                max={90}
                step={1}
                onChange={(v) => updateParam("humidity", v)}
              />
            </div>

            <h4 className="slider-group-title">Room & Schedule Inputs</h4>
            <div className="slider-grid">
              <SliderField
                label="Occupancy"
                unit="people"
                val={params.occupancy}
                min={0}
                max={60}
                step={1}
                onChange={(v) => updateParam("occupancy", v)}
              />
              <SliderField
                label="Light Intensity"
                unit="lux"
                val={params.light}
                min={0}
                max={1000}
                step={25}
                onChange={(v) => updateParam("light", v)}
              />
              <ToggleField
                label="Ventilation State"
                val={params.ventilation_enc}
                onText="Open (1)"
                offText="Closed (0)"
                onChange={(v) => updateParam("ventilation_enc", v)}
              />
              <ToggleField
                label="Motion Detected"
                val={params.motion}
                onText="Detected (1)"
                offText="None (0)"
                onChange={(v) => updateParam("motion", v)}
              />
              <SliderField
                label="Hour of Day"
                unit="h"
                val={params.hour}
                min={0}
                max={23}
                step={1}
                onChange={(v) => updateParam("hour", v)}
              />
              <SliderField
                label="Day of Week"
                unit="idx (0=Mon)"
                val={params.day_of_week}
                min={0}
                max={6}
                step={1}
                onChange={(v) => updateParam("day_of_week", v)}
              />
              <ToggleField
                label="Working Hours"
                val={params.is_working_hours}
                onText="Working (1)"
                offText="Off (0)"
                onChange={(v) => updateParam("is_working_hours", v)}
              />
            </div>
          </div>
        </div>

        {/* Right Column: Output & Evaluation */}
        <div className="pred-results-col">
          {/* Predicted Proxy Card */}
          <div className="panel pred-output-card">
            <span className="pred-badge-label">Random Forest Model Estimate</span>
            <div className="pred-gauge-row">
              <div className="pred-big-num font-mono">
                {predictedProxy}
                <span className="pred-unit">pts</span>
              </div>
              <div className="pred-band-pill">
                {prediction?.prediction_label || "Proxy Band"}
              </div>
            </div>
            <div className="pred-comparison-box">
              <div className="comp-item">
                <span className="comp-label">Calculated Formula Proxy</span>
                <span className="comp-val font-mono">{calculatedProxy} pts</span>
              </div>
              <div className="comp-divider" />
              <div className="comp-item">
                <span className="comp-label">Estimate Difference (Delta)</span>
                <span className="comp-val font-mono text-cyan">{delta} pts</span>
              </div>
            </div>
            <p className="pred-footnote">
              The target is a derived proxy (not EPA AQI). Model output is updated debounced in real time.
            </p>
          </div>

          {/* Proactive Forecast & Early-Breach Alert Engine */}
          <ProactiveForecastCard forecast={forecast} params={params} updateParam={updateParam} />

          {/* Evaluation Metrics */}
          <div className="panel pred-eval-card">
            <div className="panel-head">
              <div>
                <h3>Holdout Evaluation Metrics</h3>
                <p>Reproduced evaluation on chronologically held-out test data.</p>
              </div>
            </div>
            <div className="metric-tiles-row">
              <div className="eval-metric-tile">
                <span className="eval-title">R² Score</span>
                <span className="eval-number font-mono text-cyan">{metrics.r2.toFixed(4)}</span>
                <span className="eval-sub">Target approximation</span>
              </div>
              <div className="eval-metric-tile">
                <span className="eval-title">MAE</span>
                <span className="eval-number font-mono">{metrics.mae.toFixed(4)}</span>
                <span className="eval-sub">Mean absolute error (pts)</span>
              </div>
              <div className="eval-metric-tile">
                <span className="eval-title">RMSE</span>
                <span className="eval-number font-mono">{metrics.rmse.toFixed(4)}</span>
                <span className="eval-sub">Root mean squared error</span>
              </div>
            </div>
            <div className="eval-split-note">
              <span>Train split: <strong>8,000 records</strong></span>
              <span>Test split: <strong>2,000 records</strong></span>
            </div>

            {/* Actual vs Predicted Sample Chart */}
            <div className="eval-chart-wrap">
              <span className="eval-chart-title">Test Sample: Actual Formula vs RF Predicted</span>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartPoints} margin={{ top: 5, right: 10, left: -25, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(46, 230, 214, 0.08)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="index" stroke="#8fa9b8" tick={{ fill: "#8fa9b8", fontSize: 10 }} />
                  <YAxis stroke="#8fa9b8" tick={{ fill: "#8fa9b8", fontSize: 10 }} domain={["auto", "auto"]} />
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: "rgba(8, 24, 40, 0.95)",
                      border: "1px solid rgba(46, 230, 214, 0.3)",
                      borderRadius: "10px",
                      color: "#e8f4f8",
                      fontSize: "11px",
                    }}
                  />
                  <Line type="monotone" dataKey="actual" name="Actual Formula" stroke="#8fa9b8" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="predicted" name="RF Predicted" stroke="#2ee6d6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <details className="method-details">
            <summary>What this model can and cannot do</summary>
            <p>
              <strong>Can:</strong> Accurately reproduce the project-defined multi-sensor proxy calculation
              across varied input combinations.
              <br />
              <strong>Cannot:</strong> Replace certified regulatory air monitors, predict true ambient EPA AQI,
              or infer physical causation without real-world telemetry.
            </p>
          </details>
        </div>
      </div>
    </div>
  );
}

function SliderField({ label, unit, val, min, max, step, onChange }) {
  return (
    <div className="slider-field">
      <div className="slider-label-row">
        <span className="sf-label">{label}</span>
        <span className="sf-val font-mono">{val} <small>{unit}</small></span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={val ?? min}
        onChange={(e) => onChange(Number(e.target.value))}
        className="sf-range"
      />
    </div>
  );
}

function ToggleField({ label, val, onText, offText, onChange }) {
  const isChecked = Boolean(val);
  return (
    <div className="slider-field toggle-field">
      <span className="sf-label">{label}</span>
      <button
        type="button"
        className={`sf-toggle-btn ${isChecked ? "active" : ""}`}
        onClick={() => onChange(isChecked ? 0 : 1)}
      >
        <span className="dot" style={{ backgroundColor: isChecked ? "var(--cyan)" : "var(--muted)" }} />
        {isChecked ? onText : offText}
      </button>
    </div>
  );
}

/* =========================================================================
   PAGE 3: VENTILATION
   ========================================================================= */
export function VentilationPage() {
  const { params, updateParam, prediction, scenarios, error, retry } = useAirMind();
  const [showScenario, setShowScenario] = useState(false);
  const [dilutionPct, setDilutionPct] = useState(25);

  const recommendation = prediction?.recommendations?.[0];
  const isVentOpen = Boolean(params.ventilation_enc);

  // Scenario computation
  const baselineEstimate = scenarios?.baseline_predicted_proxy ?? prediction?.prediction ?? 0;
  const hypotheticalScenario = scenarios?.scenarios?.find((s) => s.id === "ventilation_and_dilution");
  const hypotheticalEstimate = hypotheticalScenario?.predicted_proxy ?? (baselineEstimate * (1 - dilutionPct / 100));
  const diffEstimate = (hypotheticalEstimate - baselineEstimate).toFixed(2);

  return (
    <div className="page-stack">
      <BackendErrorBanner error={error} onRetry={retry} />
      <PageTitle
        eyebrow="DECISION SUPPORT"
        title="Ventilation"
        summary="Actionable screening recommendations and interactive hypothetical what-if ventilation scenarios."
      />

      {/* Visual Status Strip */}
      <div className="vent-status-strip">
        <div className="vent-status-tile">
          <span className="vst-label">Ventilation Status</span>
          <div className="flex-row items-center gap-2">
            <span className={`dot ${isVentOpen ? "dot-online" : "dot-offline"}`} />
            <strong className="vst-val">{isVentOpen ? "Open" : "Closed"}</strong>
          </div>
          <button
            className="vent-toggle-btn"
            onClick={() => updateParam("ventilation_enc", isVentOpen ? 0 : 1)}
          >
            Toggle to {isVentOpen ? "Closed" : "Open"}
          </button>
        </div>

        <div className="vent-status-tile">
          <span className="vst-label">CO2 Concentration</span>
          <strong className="vst-val font-mono">{params.co2} <small>ppm</small></strong>
          <span className="vst-sub">{params.co2 >= 800 ? "Elevated screening" : "Normal screening"}</span>
        </div>

        <div className="vent-status-tile">
          <span className="vst-label">PM2.5 Particles</span>
          <strong className="vst-val font-mono">{params.pm25} <small>µg/m³</small></strong>
          <span className="vst-sub">{params.pm25 >= 12 ? "Review recommended" : "Low screening"}</span>
        </div>

        <div className="vent-status-tile">
          <span className="vst-label">Occupancy</span>
          <strong className="vst-val font-mono">{params.occupancy} <small>people</small></strong>
          <span className="vst-sub">{params.occupancy >= 30 ? "High occupancy" : "Nominal"}</span>
        </div>
      </div>

      {/* Prioritized Recommendation Card */}
      <div className="panel vent-rec-panel">
        <div className="panel-head">
          <div className="flex-row items-center gap-2">
            <h3>Prioritized Recommendation</h3>
            {recommendation && (
              <span className={`priority-chip priority-${recommendation.priority}`}>
                {recommendation.priority.toUpperCase()} PRIORITY
              </span>
            )}
          </div>
        </div>

        {recommendation ? (
          <div className="vent-rec-content">
            <div className="vent-rec-reason">
              <strong>{recommendation.condition.toUpperCase()} ({recommendation.observed} {recommendation.unit}):</strong>{" "}
              {recommendation.reason}
            </div>
            <div className="vent-rec-action-box">
              <span className="action-tag">Recommended Action</span>
              <p className="action-text">{recommendation.action}</p>
            </div>
            <span className="threshold-basis-note">{recommendation.threshold_basis}</span>
          </div>
        ) : (
          <div className="vent-rec-none">
            <CheckCircle2 size={24} className="text-cyan" />
            <p>No project screening thresholds are currently exceeded. Conditions appear comfortable.</p>
          </div>
        )}
      </div>

      {/* Interactive What-If Scenario Panel */}
      <div className="panel vent-whatif-panel">
        <div className="panel-head">
          <div>
            <h3>What-If Scenario Simulation</h3>
            <p>Evaluate how opening ventilation with assumed outdoor air dilution affects the model proxy.</p>
          </div>
          <label className="whatif-toggle-label">
            <input
              type="checkbox"
              checked={showScenario}
              onChange={(e) => setShowScenario(e.target.checked)}
            />
            <span>Enable What-If Comparison</span>
          </label>
        </div>

        {showScenario && (
          <div className="whatif-body">
            <div className="whatif-controls">
              <div className="slider-field">
                <div className="slider-label-row">
                  <span className="sf-label">Assumed Dilution Rate</span>
                  <span className="sf-val font-mono">{dilutionPct}%</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={50}
                  step={5}
                  value={dilutionPct}
                  onChange={(e) => setDilutionPct(Number(e.target.value))}
                  className="sf-range"
                />
              </div>
            </div>

            <div className="whatif-compare-grid">
              <div className="compare-card before">
                <span className="card-phase">BEFORE (Current)</span>
                <strong className="compare-val font-mono">{baselineEstimate.toFixed(2)} pts</strong>
                <span className="card-desc">Ventilation: {isVentOpen ? "Open" : "Closed"}, CO2: {params.co2} ppm</span>
              </div>

              <div className="compare-arrow">
                <ArrowRight size={22} className="text-cyan" />
              </div>

              <div className="compare-card after">
                <span className="card-phase">AFTER (Hypothetical)</span>
                <strong className="compare-val font-mono text-cyan">{hypotheticalEstimate.toFixed(2)} pts</strong>
                <span className="card-desc">Ventilation: Open, CO2 diluted by ~{dilutionPct}%</span>
              </div>
            </div>

            <div className="whatif-delta-banner">
              <span>Model-predicted proxy delta: </span>
              <strong className="font-mono text-cyan">{diffEstimate} pts</strong>
              <span className="delta-note">
                (Simulated with Random Forest pipeline. Does not operate physical actuators or guarantee outdoor air quality.)
              </span>
            </div>
          </div>
        )}

        {/* Animated Airflow Graphic */}
        <div className="airflow-vis-container">
          <svg className="airflow-svg" viewBox="0 0 600 120" preserveAspectRatio="none">
            <defs>
              <linearGradient id="airGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#2ee6d6" stopOpacity="0.8" />
                <stop offset="50%" stopColor="#2ee6d6" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#2ee6d6" stopOpacity="0.1" />
              </linearGradient>
            </defs>
            <path
              d="M 20 30 Q 150 10, 300 35 T 580 40"
              fill="none"
              stroke="url(#airGrad)"
              strokeWidth="2.5"
              strokeDasharray="8 6"
              className="animated-wind-line line-1"
            />
            <path
              d="M 20 60 Q 200 45, 350 70 T 580 65"
              fill="none"
              stroke="url(#airGrad)"
              strokeWidth="2"
              strokeDasharray="10 8"
              className="animated-wind-line line-2"
            />
            <path
              d="M 20 90 Q 120 105, 280 85 T 580 95"
              fill="none"
              stroke="url(#airGrad)"
              strokeWidth="2"
              strokeDasharray="6 6"
              className="animated-wind-line line-3"
            />
          </svg>
          <div className="airflow-caption">
            <span>Airflow streamlines illustrative; fresh air circulation scenario.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   PAGE 4: EXPLAINABILITY
   ========================================================================= */
export function ExplainabilityPage() {
  const { prediction, modelInfo, error, retry } = useAirMind();

  const shap = prediction?.shap;
  const contributions = shap?.contributions || [];
  const topContributions = contributions.slice(0, 7);

  const baseVal = shap?.base_value != null ? shap.base_value.toFixed(2) : "--";
  const predVal = prediction?.prediction != null ? prediction.prediction.toFixed(2) : "--";
  const sumCheck = shap?.sum_check != null ? shap.sum_check.toFixed(2) : "--";

  const leadingContrib = topContributions[0];
  const importanceData = Object.entries(modelInfo?.feature_importance || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([feat, val]) => ({
      feature: feat.replace(/_/g, " ").toUpperCase(),
      importance: Number((val * 100).toFixed(2)),
    }));

  return (
    <div className="page-stack">
      <BackendErrorBanner error={error} onRetry={retry} />
      <PageTitle
        eyebrow="MODEL INTERPRETABILITY"
        title="Explainability"
        summary="Local SHAP feature attributions and global Random Forest feature importances."
      />

      {/* Plain-English Intro */}
      <div className="panel shap-intro-card">
        <p className="intro-text">
          Local SHAP (SHapley Additive exPlanations) values describe how each sensor reading shifts
          the Random Forest model’s estimate away from the average baseline for this specific room state.
          They describe <strong>feature attribution in the model</strong>, not physical causation.
        </p>

        {leadingContrib && (
          <div className="lead-sentence-box">
            <span className="dot dot-cyan" />
            <p>
              <strong>{leadingContrib.feature.replace(/_/g, " ").toUpperCase()}</strong>{" "}
              ({leadingContrib.contribution > 0 ? "+" : ""}{leadingContrib.contribution.toFixed(2)} pts at {leadingContrib.value} {leadingContrib.unit}){" "}
              has the largest impact for the current estimate.
            </p>
          </div>
        )}

        <div className="shap-meta-strip">
          <div className="shap-meta-item">
            <span>Model Base Value</span>
            <strong className="font-mono">{baseVal} pts</strong>
          </div>
          <div className="shap-meta-divider" />
          <div className="shap-meta-item">
            <span>Model Estimate</span>
            <strong className="font-mono text-cyan">{predVal} pts</strong>
          </div>
          <div className="shap-meta-divider" />
          <div className="shap-meta-item">
            <span>SHAP Sum Check</span>
            <strong className="font-mono">{sumCheck} pts</strong>
          </div>
        </div>
      </div>

      {/* Local SHAP Diverging Bar Chart */}
      <div className="panel shap-diverging-panel">
        <div className="panel-head">
          <div>
            <h3>Local Feature Attributions</h3>
            <p>
              Positive values (amber/red) push the proxy estimate higher; negative values (cyan) lower it.
            </p>
          </div>
        </div>

        {topContributions.length > 0 ? (
          <div className="shap-bars-list">
            {topContributions.map((item) => {
              const isPositive = item.contribution >= 0;
              const absVal = Math.abs(item.contribution);
              const barWidth = Math.min(100, (absVal / 25) * 100);

              return (
                <div key={item.feature} className="shap-row-item">
                  <div className="shap-feature-info">
                    <span className="shap-name">{item.feature.replace(/_/g, " ").toUpperCase()}</span>
                    <span className="shap-sub font-mono">{item.value} {item.unit}</span>
                  </div>

                  <div className="shap-track-container">
                    <div className="shap-midline" />
                    {isPositive ? (
                      <div
                        className="shap-bar pos-bar"
                        style={{ width: `${Math.max(2, barWidth)}%`, left: "50%" }}
                      />
                    ) : (
                      <div
                        className="shap-bar neg-bar"
                        style={{ width: `${Math.max(2, barWidth)}%`, right: "50%" }}
                      />
                    )}
                  </div>

                  <div className="shap-val-col">
                    <span className={`font-mono ${isPositive ? "text-amber" : "text-cyan"}`}>
                      {isPositive ? "+" : ""}{item.contribution.toFixed(3)} pts
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="state-message">SHAP attribution is loading or unavailable.</p>
        )}
      </div>

      {/* Global Feature Importance */}
      <div className="panel shap-importance-panel">
        <div className="panel-head">
          <div>
            <h3>Global Feature Importance</h3>
            <p>Relative impurity-based importance across all fitted trees in the Random Forest.</p>
          </div>
        </div>

        <div className="importance-chart-wrap">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={importanceData}
              layout="vertical"
              margin={{ top: 5, right: 25, left: 50, bottom: 5 }}
            >
              <CartesianGrid stroke="rgba(46, 230, 214, 0.08)" horizontal={false} />
              <XAxis type="number" stroke="#8fa9b8" tick={{ fill: "#8fa9b8", fontSize: 10 }} />
              <YAxis
                type="category"
                dataKey="feature"
                stroke="#8fa9b8"
                tick={{ fill: "#8fa9b8", fontSize: 11 }}
              />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: "rgba(8, 24, 40, 0.95)",
                  border: "1px solid rgba(46, 230, 214, 0.3)",
                  borderRadius: "10px",
                  color: "#e8f4f8",
                  fontSize: "11px",
                }}
                formatter={(val) => [`${val}%`, "Importance"]}
              />
              <Bar dataKey="importance" fill="#2ee6d6" radius={[0, 4, 4, 0]} barSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <details className="method-details">
        <summary>How to interpret SHAP values</summary>
        <p>
          SHAP attributions sum to the difference between the model’s prediction and its baseline.
          They explain which features the model relied on for this mathematical calculation. Because
          several sensors are correlated and the target is formula-derived, attribution should not be
          confused with physical cause and effect.
        </p>
      </details>
    </div>
  );
}

/* =========================================================================
   PAGE 5: AI ADVISOR
   ========================================================================= */
export function AdvisorPage() {
  const { params, dataSource, error, retry } = useAirMind();

  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "Hello! I am AirMind AI, your indoor environmental intelligence advisor. Ask me about your current sensor readings, project proxy scores, or recommended actions.",
      provider: "system",
    },
  ]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");

  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const suggestionPrompts = [
    "What is AirMind AI?",
    "What is my current CO2 reading?",
    "What should I do about the current readings?",
    "Why might my air quality be poor?",
  ];

  const send = async (textToSend) => {
    const text = (textToSend || question).trim();
    if (!text || busy) return;

    const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.text }));
    setQuestion("");
    setLocalError("");
    setMessages((curr) => [...curr, { role: "user", text }]);
    setBusy(true);

    try {
      const res = await postJSON("/advisor", {
        params: { ...params, data_source: dataSource },
        question: text,
        history,
      });
      setMessages((curr) => [
        ...curr,
        { role: "assistant", text: res.answer, provider: res.provider },
      ]);
    } catch (err) {
      setLocalError(err.message || "Failed to contact the advisor.");
      setMessages((curr) => [
        ...curr,
        {
          role: "assistant",
          text: `Can't reach the AirMind backend. Make sure it is running on ${API_BASE}.`,
          isError: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const clearChat = () => {
    setMessages([
      {
        role: "assistant",
        text: "Conversation cleared. How can I help you understand your airspace today?",
        provider: "system",
      },
    ]);
  };

  return (
    <div className="page-stack">
      <BackendErrorBanner error={error} onRetry={retry} />
      <PageTitle
        eyebrow="NATURAL LANGUAGE ASSISTANT"
        title="AI Advisor"
        summary="Ask questions about your indoor airspace, current readings, and model explanations."
      />

      <div className="panel advisor-chat-panel">
        <div className="chat-window" aria-live="polite">
          {messages.map((m, idx) => (
            <div key={idx} className={`chat-bubble-wrap ${m.role}`}>
              <div className="chat-avatar">
                {m.role === "assistant" ? <Bot size={16} /> : <User size={16} />}
              </div>
              <div className={`chat-bubble ${m.role} ${m.isError ? "chat-error" : ""}`}>
                <p className="bubble-text">{m.text}</p>
                {m.provider && (
                  <span className="bubble-provider">
                    {m.provider === "openai"
                      ? "OpenAI Response"
                      : m.provider === "rule_based"
                      ? "AirMind Rule-Based Engine"
                      : "System"}
                  </span>
                )}
              </div>
            </div>
          ))}

          {busy && (
            <div className="chat-bubble-wrap assistant">
              <div className="chat-avatar"><Bot size={16} /></div>
              <div className="chat-bubble assistant typing-bubble">
                <span className="dot pulse" />
                <span className="dot pulse delay-1" />
                <span className="dot pulse delay-2" />
                <span className="typing-text">AirMind is analyzing...</span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Suggestion Chips */}
        <div className="suggestion-chips-row">
          <span className="chips-hint">Suggested:</span>
          {suggestionPrompts.map((prompt) => (
            <button
              key={prompt}
              className="chip-btn"
              onClick={() => send(prompt)}
              disabled={busy}
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <form
          className="chat-input-bar"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <button
            type="button"
            className="clear-btn"
            onClick={clearChat}
            title="Clear conversation"
          >
            <Trash2 size={16} />
          </button>
          <input
            type="text"
            className="chat-input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about your indoor airspace, readings, or recommendations..."
            maxLength={1200}
            disabled={busy}
          />
          <button
            type="submit"
            className="send-btn"
            disabled={busy || !question.trim()}
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}