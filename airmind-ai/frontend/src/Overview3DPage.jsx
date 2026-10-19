import { useState, useMemo, useRef, useEffect, lazy, Suspense } from "react";
import {
  Wind,
  Activity,
  Thermometer,
  Users,
  Sliders,
  RotateCw,
  RotateCcw,
  Search,
  Move,
  Info,
  Sparkles,
  Cloud,
  Droplets,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useAirMind } from "./AppContext.jsx";
import Room3D, { ROOM_SENSORS } from "./Room3D.jsx";
import "./overview.css";

export const ALL_SENSORS = [
  {
    id: "co2",
    name: "CO2 Sensor (Window Side)",
    short: "CO2",
    unit: "ppm",
    icon: Wind,
    interpretation:
      "Carbon dioxide accumulates indoors from occupant respiration. Levels above 800–1000 ppm indicate insufficient fresh outdoor air ventilation.",
  },
  {
    id: "pm25",
    name: "PM2.5 Sensor (Center)",
    short: "PM2.5",
    unit: "µg/m³",
    icon: Sparkles,
    interpretation:
      "Fine particulate matter penetrates deeply into lung alveoli. Elevated readings suggest indoor combustion, dust resuspension, or outdoor smoke infiltration.",
  },
  {
    id: "temperature",
    name: "Temperature Sensor",
    short: "Temperature",
    unit: "°C",
    icon: Thermometer,
    interpretation:
      "Classroom thermal comfort directly affects student engagement. Project screening target is maintained between 20°C and 26°C.",
  },
  {
    id: "occupancy",
    name: "Occupancy Count",
    short: "Occupancy",
    unit: "people",
    icon: Users,
    interpretation:
      "Headcount recorded in the room. Determines the rate of metabolic CO2 generation and required ventilation air volume.",
  },
  {
    id: "ventilation_enc",
    name: "Ventilation Status",
    short: "Ventilation",
    unit: "state",
    icon: Sliders,
    interpretation:
      "Operational status of the airspace ventilation damper or window opening (Open / Closed).",
  },
  {
    id: "pm10",
    name: "PM10 Sensor",
    short: "PM10",
    unit: "µg/m³",
    icon: Sparkles,
    interpretation:
      "Inhalable coarse particulate matter such as settled dust, pollen, and classroom chalk aerosols.",
  },
  {
    id: "tvoc",
    name: "TVOC Sensor",
    short: "TVOC",
    unit: "ppb",
    icon: Activity,
    interpretation:
      "Total Volatile Organic Compounds summarize vapors from cleaning solvents, whiteboard markers, and furnishings.",
  },
  {
    id: "co",
    name: "Carbon Monoxide",
    short: "CO",
    unit: "ppm",
    icon: Cloud,
    interpretation:
      "Toxic, odorless combustion byproduct. Project conservative screening initiates at 9 ppm; 35 ppm requires immediate evacuation.",
  },
  {
    id: "humidity",
    name: "Relative Humidity",
    short: "Humidity",
    unit: "%",
    icon: Droplets,
    interpretation:
      "Target indoor humidity ranges between 30% and 60% to suppress pathogen transmission and prevent respiratory irritation.",
  },
];

// Helper to determine status and dot color strictly from backend thresholds
function evaluateSensorThreshold(id, rawVal, thresholds) {
  if (rawVal == null || !Number.isFinite(Number(rawVal))) {
    if (id === "ventilation_enc") {
      return {
        word: rawVal ? "Open" : "Closed",
        dotClass: rawVal ? "cyan" : "amber",
        isElevated: false,
        isUrgent: false,
      };
    }
    return null;
  }

  const val = Number(rawVal);
  const t = thresholds?.[id];

  if (!t) {
    if (id === "ventilation_enc") {
      return {
        word: val ? "Open" : "Closed",
        dotClass: val ? "cyan" : "amber",
        isElevated: false,
        isUrgent: false,
      };
    }
    return null; // Do not show threshold word/color if no threshold defined
  }

  if (id === "co") {
    if (val >= (t.urgent || 35))
      return { word: "Urgent", dotClass: "red", isElevated: true, isUrgent: true };
    if (val >= (t.elevated || 9))
      return { word: "Elevated", dotClass: "amber", isElevated: true, isUrgent: false };
    return { word: "Normal", dotClass: "cyan", isElevated: false, isUrgent: false };
  }

  if (id === "temperature") {
    if (val < (t.low || 20))
      return { word: "Cool", dotClass: "blue", isElevated: false, isUrgent: false };
    if (val > (t.high || 26))
      return { word: "Warm", dotClass: "amber", isElevated: true, isUrgent: false };
    return { word: "Normal", dotClass: "cyan", isElevated: false, isUrgent: false };
  }

  if (id === "humidity") {
    if (val < (t.low || 30))
      return { word: "Dry", dotClass: "amber", isElevated: true, isUrgent: false };
    if (val > (t.high || 60))
      return { word: "Humid", dotClass: "amber", isElevated: true, isUrgent: false };
    return { word: "Normal", dotClass: "cyan", isElevated: false, isUrgent: false };
  }

  if (t.high && val >= t.high) {
    return { word: "High", dotClass: "red", isElevated: true, isUrgent: true };
  }
  if (t.elevated && val >= t.elevated) {
    return { word: "Elevated", dotClass: "amber", isElevated: true, isUrgent: false };
  }
  return { word: "Normal", dotClass: "cyan", isElevated: false, isUrgent: false };
}

// Recharts Custom Tooltip
function RechartsTooltipContent({ active, payload, unit }) {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="recharts-custom-tooltip">
        <span className="tooltip-value font-mono">
          {data.value} {unit}
        </span>
        <span className="tooltip-time">{data.fullTime}</span>
      </div>
    );
  }
  return null;
}

export default function Overview3DPage() {
  const {
    params,
    prediction,
    historyRecords,
    screeningThresholds,
    requestState,
    error,
    retry,
    selectedSensorId,
    setSelectedSensorId,
  } = useAirMind();

  // Camera toolbar state
  const [autoRotate, setAutoRotate] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const controlsRef = useRef(null);

  const reducedMotion = useMemo(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    []
  );

  // Synchronized selected sensor object
  const currentSensor = useMemo(
    () => ALL_SENSORS.find((s) => s.id === selectedSensorId) || ALL_SENSORS[0],
    [selectedSensorId]
  );

  // Real display value for selected sensor
  const currentDisplayValue = useMemo(() => {
    if (currentSensor.id === "ventilation_enc") {
      return params.ventilation_enc ? "Open" : "Closed";
    }
    const val = params[currentSensor.id];
    return val != null ? `${val} ${currentSensor.unit}`.trim() : "--";
  }, [currentSensor, params]);

  // Status computation for all sensors
  const sensorStatuses = useMemo(() => {
    const res = {};
    ALL_SENSORS.forEach((s) => {
      const raw = params[s.id];
      const evalRes = evaluateSensorThreshold(s.id, raw, screeningThresholds);
      const roomSensor = ROOM_SENSORS.find((rs) => rs.id === s.id);

      let display = "--";
      if (s.id === "ventilation_enc") {
        display = params.ventilation_enc ? "Open" : "Closed";
      } else if (raw != null) {
        display = `${raw} ${s.unit}`.trim();
      }

      res[s.id] = {
        raw,
        display,
        statusWord: evalRes?.word || null,
        dotClass: evalRes?.dotClass || "cyan",
        isElevated: evalRes?.isElevated || false,
        isUrgent: evalRes?.isUrgent || false,
        position: roomSensor?.position || null,
      };
    });
    return res;
  }, [params, screeningThresholds]);

  // Real proxy score & status from backend thresholds
  const proxyScore = useMemo(() => {
    if (prediction?.proxy_calculated != null) {
      return Number(prediction.proxy_calculated).toFixed(1);
    }
    if (prediction?.prediction != null) {
      return Number(prediction.prediction).toFixed(1);
    }
    return null;
  }, [prediction]);

  const numScore = proxyScore != null ? parseFloat(proxyScore) : 0;
  const statusInfo = useMemo(() => {
    if (proxyScore == null) return { word: "--", dot: "cyan", class: "normal" };
    if (numScore >= 100) return { word: "Poor", dot: "red", class: "poor" };
    if (numScore >= 50) return { word: "Moderate", dot: "amber", class: "moderate" };
    return { word: "Good", dot: "cyan", class: "good" };
  }, [proxyScore, numScore]);

  const proxyExplanation = useMemo(() => {
    if (prediction?.recommendations?.[0]?.reason) {
      return prediction.recommendations[0].reason;
    }
    if (numScore >= 100) return "Higher pollutant levels detected. Consider improving ventilation.";
    if (numScore >= 50) return "Moderate proxy levels. Review room ventilation intake.";
    return "Airspace proxy within target screening baseline.";
  }, [prediction, numScore]);

  // Recharts 24-hour historical records for selected sensor
  const chartData = useMemo(() => {
    if (!historyRecords || historyRecords.length === 0) return [];
    const valid = historyRecords.filter(
      (r) =>
        r.timestamp &&
        r[selectedSensorId] != null &&
        Number.isFinite(Number(r[selectedSensorId]))
    );
    const slice = valid.slice(-48);
    return slice.map((r) => {
      const d = new Date(r.timestamp);
      return {
        time: d.toLocaleTimeString([], { hour: "numeric" }),
        fullTime: d.toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }),
        value: Number(r[selectedSensorId]),
      };
    });
  }, [historyRecords, selectedSensorId]);

  // Semicircle gauge calculation (180 degree arc)
  const semiArcParams = useMemo(() => {
    const r = 50;
    const arcLength = Math.PI * r; // ≈ 157.08
    const clamped = Math.min(Math.max(numScore, 0), 150);
    const fraction = clamped / 150;
    const offset = arcLength * (1 - fraction);
    return { r, arcLength, offset };
  }, [numScore]);

  const selectedSensorStatus = sensorStatuses[selectedSensorId];

  return (
    <div className="overview-layout">
      {/* PART B: 3D ROOM (Center, fills the area, soft edge fade, no card border) */}
      <section
        className="room-center-area room-3d-seamless"
        aria-label="3D Classroom Airspace Viewport"
      >
        <Suspense
          fallback={
            <div className="room-3d-skeleton">
              <div className="skeleton-pulse-ring" />
              <span>Initializing 3D classroom airspace...</span>
            </div>
          }
        >
          <Room3D
            selectedId={selectedSensorId}
            sensorStatuses={sensorStatuses}
            onSelect={setSelectedSensorId}
            ventilationOpen={Boolean(params.ventilation_enc)}
            reducedMotion={reducedMotion}
            controlsRef={controlsRef}
            resetSignal={resetSignal}
            autoRotate={autoRotate}
            onInteraction={() => setAutoRotate(false)}
          />
        </Suspense>

        {/* Soft Edge Fade Vignette Overlay */}
        <div className="room-edge-fade-overlay" aria-hidden="true" />

        {/* Bottom-Center Glass Control Bar */}
        <div
          className="camera-controls-bar"
          role="toolbar"
          aria-label="Room Camera Controls"
        >
          <button
            type="button"
            className={`cam-btn ${autoRotate ? "active" : ""}`}
            onClick={() => setAutoRotate((v) => !v)}
            aria-label="Toggle rotate"
            title="Rotate"
          >
            <RotateCw size={17} />
            <span>Rotate</span>
          </button>
          <button
            type="button"
            className="cam-btn"
            onClick={() => {
              controlsRef.current?.dollyIn(1.15);
              controlsRef.current?.update();
            }}
            aria-label="Zoom camera"
            title="Zoom"
          >
            <Search size={17} />
            <span>Zoom</span>
          </button>
          <button
            type="button"
            className="cam-btn"
            onClick={() => {
              const c = controlsRef.current;
              if (c) c.enablePan = !c.enablePan;
            }}
            aria-label="Pan camera"
            title="Pan"
          >
            <Move size={17} />
            <span>Pan</span>
          </button>
          <button
            type="button"
            className="cam-btn"
            onClick={() => {
              setResetSignal((s) => s + 1);
              setAutoRotate(false);
            }}
            aria-label="Reset camera position"
            title="Reset"
          >
            <RotateCcw size={17} />
            <span>Reset</span>
          </button>
        </div>

        {/* Required Caption */}
        <div className="room-caption-tag">
          Sensor positions and airflow are illustrative, not measured.
        </div>
      </section>

      {/* PART A: RIGHT COLUMN (470px, three stacked glass cards) */}
      <aside
        className="overview-right-column"
        aria-label="Air Quality and Sensor Summary"
      >
        {/* Inline Error with Retry if API fails */}
        {error && (
          <div className="card-error-banner" role="alert">
            <div className="error-text-group">
              <AlertTriangle size={15} />
              <span>{error}</span>
            </div>
            <button type="button" className="retry-btn" onClick={retry}>
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        )}

        {/* CARD 1: Indoor Air Quality */}
        <div className="rail-card">
          <div className="rail-card-head">
            <div className="rail-card-title-group">
              <h2 className="rail-card-title">Indoor Air Quality</h2>
              <div className="tooltip-container">
                <button
                  type="button"
                  className="info-icon-btn"
                  aria-label="About Indoor Air Quality metric"
                >
                  <Info size={14} />
                </button>
                <div className="tooltip-popover" role="tooltip">
                  Project proxy from the Random Forest model, not a regulatory AQI
                </div>
              </div>
            </div>
            <span className="proxy-pill">Project Proxy</span>
          </div>

          {requestState === "loading" && !proxyScore ? (
            <div className="card-skeleton-row">
              <div className="skeleton-gauge-circle" />
              <div className="skeleton-lines">
                <div className="skeleton-line w-half" />
                <div className="skeleton-line w-full" />
                <div className="skeleton-line w-three-quarters" />
              </div>
            </div>
          ) : (
            <div className="gauge-content-row">
              {/* Semicircle SVG Gauge */}
              <div className="gauge-svg-wrap">
                <svg className="gauge-svg-element" viewBox="0 0 130 90">
                  <defs>
                    <linearGradient id="iaqSemiGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#2ee6d6" />
                      <stop offset="50%" stopColor="#ffb347" />
                      <stop offset="100%" stopColor="#ff6b5b" />
                    </linearGradient>
                  </defs>
                  {/* Background track arc */}
                  <path
                    d="M 15 75 A 50 50 0 0 1 115 75"
                    fill="none"
                    stroke="rgba(46, 230, 214, 0.12)"
                    strokeWidth="11"
                    strokeLinecap="round"
                  />
                  {/* Active gradient arc */}
                  <path
                    d="M 15 75 A 50 50 0 0 1 115 75"
                    fill="none"
                    stroke="url(#iaqSemiGrad)"
                    strokeWidth="11"
                    strokeLinecap="round"
                    strokeDasharray={semiArcParams.arcLength}
                    strokeDashoffset={semiArcParams.offset}
                  />
                </svg>
                <div className="gauge-text-overlay semicircle-text">
                  <span className="gauge-number">{proxyScore ?? "--"}</span>
                  <span className="gauge-pts">pts</span>
                </div>
              </div>

              <div className="gauge-meta-block">
                <span className="status-label-caption">Current Status</span>
                <div className="status-value-row">
                  <span className={`dot dot-${statusInfo.dot}`} />
                  <span className={`status-large-text ${statusInfo.class}`}>
                    {statusInfo.word}
                  </span>
                </div>
                <p className="status-explanation">{proxyExplanation}</p>
              </div>
            </div>
          )}
        </div>

        {/* CARD 2: Selected Sensor */}
        <div className="rail-card">
          <div className="rail-card-head">
            <h2 className="rail-card-title">Selected Sensor</h2>
            <select
              className="sensor-select-box"
              value={selectedSensorId}
              onChange={(e) => setSelectedSensorId(e.target.value)}
              aria-label="Select sensor to inspect"
            >
              {ALL_SENSORS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="selected-sensor-row">
            <div className="sensor-big-icon-box">
              <currentSensor.icon size={22} />
            </div>
            <div className="sensor-name-val-group">
              <span className="sensor-sub-name">{currentSensor.short}</span>
              <span className="sensor-big-value">{currentDisplayValue}</span>
            </div>
            {selectedSensorStatus?.statusWord && (
              <div className={`sensor-state-pill ${selectedSensorStatus.dotClass}`}>
                <span className={`dot dot-${selectedSensorStatus.dotClass}`} />
                <span>{selectedSensorStatus.statusWord}</span>
              </div>
            )}
          </div>

          <div className="about-reading-block">
            <span className="about-reading-title">About this reading</span>
            <p className="about-reading-body">{currentSensor.interpretation}</p>
          </div>
        </div>

        {/* CARD 3: Recent Trends */}
        <div className="rail-card">
          <div className="rail-card-head">
            <h2 className="rail-card-title">Recent Trends</h2>
            <span className="history-source-badge">Historical CSV</span>
          </div>

          <div className="trends-chart-container">
            {chartData.length > 2 ? (
              <ResponsiveContainer width="100%" height={135}>
                <AreaChart
                  data={chartData}
                  margin={{ top: 8, right: 10, left: -22, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="rechartsTealGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2ee6d6" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#2ee6d6" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="time"
                    stroke="#8fa9b8"
                    tick={{ fill: "#8fa9b8", fontSize: 9, fontFamily: "JetBrains Mono" }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={28}
                  />
                  <YAxis
                    stroke="#8fa9b8"
                    tick={{ fill: "#8fa9b8", fontSize: 9, fontFamily: "JetBrains Mono" }}
                    tickLine={false}
                    axisLine={false}
                    domain={["auto", "auto"]}
                    tickCount={4}
                  />
                  <Tooltip
                    content={<RechartsTooltipContent unit={currentSensor.unit} />}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="#2ee6d6"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#rechartsTealGrad)"
                    dot={false}
                    activeDot={{
                      r: 4,
                      fill: "#2ee6d6",
                      stroke: "#050c16",
                      strokeWidth: 2,
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="chart-empty-placeholder">
                <span>Waiting for historical CSV data for {currentSensor.short}...</span>
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}