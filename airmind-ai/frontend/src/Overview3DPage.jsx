import { useState, useMemo } from "react";
import {
  Wind,
  Activity,
  Thermometer,
  Users,
  Sliders,
  RotateCw,
  RotateCcw,
  ZoomIn,
  Move,
  Info,
  Sparkles,
} from "lucide-react";
import { useAirMind } from "./AppContext.jsx";
import "./overview.css";

const SENSORS = [
  {
    id: "co2",
    name: "CO2 Sensor (Window Side)",
    short: "CO2",
    unit: "ppm",
    icon: Wind,
    interpretation:
      "CO2 levels above 800–1000 ppm may indicate insufficient ventilation and reduced air freshness.",
  },
  {
    id: "pm25",
    name: "PM2.5 Sensor (Center)",
    short: "PM2.5",
    unit: "µg/m³",
    icon: Sparkles,
    interpretation:
      "Fine particulate matter (PM2.5) can penetrate deep into lungs. Elevated readings suggest indoor emissions or outdoor infiltration.",
  },
  {
    id: "temperature",
    name: "Temperature",
    short: "Temperature",
    unit: "°C",
    icon: Thermometer,
    interpretation:
      "Indoor temperature affects comfort and cognitive focus. Recommended classroom range is 20°C to 24°C.",
  },
  {
    id: "occupancy",
    name: "Occupancy",
    short: "Occupancy",
    unit: "people",
    icon: Users,
    interpretation:
      "Room occupancy count directly drives carbon dioxide generation and bioeffluent levels.",
  },
  {
    id: "ventilation_enc",
    name: "Ventilation Status",
    short: "Ventilation",
    unit: "",
    icon: Sliders,
    interpretation:
      "Indicates whether natural or mechanical airspace ventilation dampers are open or closed.",
  },
  {
    id: "tvoc",
    name: "TVOC Sensor",
    short: "TVOC",
    unit: "ppb",
    icon: Activity,
    interpretation:
      "Total Volatile Organic Compounds summarize chemical vapors emitted from cleaning agents and furniture.",
  },
  {
    id: "pm10",
    name: "PM10 Sensor",
    short: "PM10",
    unit: "µg/m³",
    icon: Sparkles,
    interpretation:
      "Coarse particulate matter includes dust, pollen, and suspended aerosols within the airspace.",
  },
  {
    id: "humidity",
    name: "Relative Humidity",
    short: "Humidity",
    unit: "%",
    icon: Wind,
    interpretation:
      "Relative humidity between 40% and 60% optimizes respiratory health and inhibits pathogen survival.",
  },
];

export default function Overview3DPage() {
  const { params, prediction, historyRecords } = useAirMind();
  const [selectedSensorId, setSelectedSensorId] = useState("co2");
  const [trendSensorId, setTrendSensorId] = useState("co2");
  const [activeCameraTool, setActiveCameraTool] = useState("rotate");

  const selectedSensor = useMemo(
    () => SENSORS.find((s) => s.id === selectedSensorId) || SENSORS[0],
    [selectedSensorId]
  );

  const currentReading = useMemo(() => {
    if (selectedSensor.id === "ventilation_enc") {
      return params.ventilation_enc ? "Open" : "Closed";
    }
    const val = params[selectedSensor.id];
    return val != null ? `${val} ${selectedSensor.unit}`.trim() : "--";
  }, [selectedSensor, params]);

  // Project proxy score & current status
  const proxyScore = useMemo(() => {
    if (prediction?.proxy_calculated != null) {
      return Number(prediction.proxy_calculated).toFixed(1);
    }
    if (prediction?.prediction != null) {
      return Number(prediction.prediction).toFixed(1);
    }
    return "99.2";
  }, [prediction]);

  const numScore = parseFloat(proxyScore);
  const statusType = numScore >= 70 ? "poor" : numScore >= 40 ? "moderate" : "good";
  const statusLabel = numScore >= 70 ? "Poor" : numScore >= 40 ? "Moderate" : "Good";

  const statusExplanation =
    prediction?.recommendations?.[0]?.reason ||
    "Higher pollutant levels detected. Consider improving ventilation.";

  // Trend data computation for the SVG trend chart
  const trendData = useMemo(() => {
    const records = (historyRecords || []).filter(
      (r) => r[trendSensorId] != null && Number.isFinite(Number(r[trendSensorId]))
    );
    if (records.length < 5) {
      // Default 24h curve matching reference image
      return [
        { x: 0, y: 780 },
        { x: 10, y: 760 },
        { x: 20, y: 810 },
        { x: 30, y: 770 },
        { x: 40, y: 800 },
        { x: 50, y: 790 },
        { x: 60, y: 750 },
        { x: 70, y: 730 },
        { x: 80, y: 710 },
        { x: 90, y: 690 },
        { x: 100, y: 680 },
        { x: 110, y: 710 },
        { x: 120, y: 700 },
      ];
    }
    const slice = records.slice(-30);
    return slice.map((r, i) => ({
      x: (i / (slice.length - 1)) * 120,
      y: Number(r[trendSensorId]),
      timestamp: r.timestamp,
    }));
  }, [historyRecords, trendSensorId]);

  // SVG Chart path calculation
  const chartProps = useMemo(() => {
    const vals = trendData.map((d) => d.y);
    const min = Math.min(...vals, 400);
    const max = Math.max(...vals, 1200);
    const range = max - min || 1;

    const width = 360;
    const height = 90;

    const points = trendData.map((d, index) => {
      const px = (index / (trendData.length - 1)) * width;
      const py = height - ((d.y - min) / range) * (height - 18) - 10;
      return [px, py];
    });

    const pathD = points.reduce((acc, curr, idx, arr) => {
      if (idx === 0) return `M ${curr[0]} ${curr[1]}`;
      const prev = arr[idx - 1];
      const cp1x = prev[0] + (curr[0] - prev[0]) / 2;
      const cp1y = prev[1];
      const cp2x = prev[0] + (curr[0] - prev[0]) / 2;
      const cp2y = curr[1];
      return `${acc} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${curr[0]} ${curr[1]}`;
    }, "");

    const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;
    const lastPoint = points[points.length - 1] || [width, height / 2];

    return { pathD, areaD, lastPoint, width, height };
  }, [trendData]);

  // Selected sensor badge state
  const selectedRule = prediction?.recommendations?.find(
    (item) => item.condition === selectedSensor.id
  );
  const sensorState = selectedRule ? "Elevated" : "Normal";
  const sensorStateClass = selectedRule ? "elevated" : "normal";

  // Arc path for the radial gauge (260 degree arc)
  const gaugeArcPath = useMemo(() => {
    const cx = 65;
    const cy = 65;
    const r = 50;
    const startAngle = 140; // in degrees
    const endAngle = 400; // in degrees (total 260 deg)
    const currentScore = Math.min(Math.max(numScore, 0), 100);
    const activeEndAngle = startAngle + (currentScore / 100) * 260;

    const polarToCartesian = (centerX, centerY, radius, angleInDegrees) => {
      const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
      return {
        x: centerX + radius * Math.cos(angleInRadians),
        y: centerY + radius * Math.sin(angleInRadians),
      };
    };

    const describeArc = (x, y, radius, startAngle, endAngle) => {
      const start = polarToCartesian(x, y, radius, endAngle);
      const end = polarToCartesian(x, y, radius, startAngle);
      const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
      return [
        "M",
        start.x,
        start.y,
        "A",
        radius,
        radius,
        0,
        largeArcFlag,
        0,
        end.x,
        end.y,
      ].join(" ");
    };

    return {
      bgArc: describeArc(cx, cy, r, startAngle, endAngle),
      valArc: describeArc(cx, cy, r, startAngle, activeEndAngle),
    };
  }, [numScore]);

  return (
    <div className="overview-layout">
      {/* 5. Center Area: Placeholder div for the 3D room (to be built next) */}
      <section
        className="room-center-area room-3d-placeholder"
        aria-label="3D Classroom Airspace Viewport"
      >
        <div className="room-viewport-scene">
          {/* High-fidelity Isometric Classroom SVG Placeholder */}
          <svg
            className="room-bg-svg"
            viewBox="0 0 1000 700"
            preserveAspectRatio="xMidYMid slice"
            fill="none"
          >
            <defs>
              <linearGradient id="wall-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#0c2333" />
                <stop offset="100%" stopColor="#071723" />
              </linearGradient>
              <linearGradient id="floor-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#1a3547" />
                <stop offset="100%" stopColor="#0d1f2d" />
              </linearGradient>
              <linearGradient id="window-glow" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#175058" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#0b242e" stopOpacity="0.3" />
              </linearGradient>
              <linearGradient id="air-stream" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#2ee6d6" stopOpacity="0.9" />
                <stop offset="60%" stopColor="#2ee6d6" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#2ee6d6" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Back Classroom Walls */}
            <polygon points="500,60 920,240 920,580 500,680 80,480 80,180" fill="url(#wall-grad)" />

            {/* Windows on the Left Wall */}
            <polygon points="120,200 450,80 450,380 120,440" fill="url(#window-glow)" stroke="#2ee6d6" strokeWidth="1.5" strokeOpacity="0.3" />
            <line x1="285" y1="140" x2="285" y2="410" stroke="#2ee6d6" strokeWidth="1.5" strokeOpacity="0.25" />
            <line x1="120" y1="320" x2="450" y2="230" stroke="#2ee6d6" strokeWidth="1.5" strokeOpacity="0.25" />

            {/* Classroom Blackboard */}
            <polygon points="530,190 770,290 770,390 530,300" fill="#06222b" stroke="#1f4b59" strokeWidth="2" />

            {/* Classroom Floor Grid */}
            <polygon points="500,680 920,500 500,320 80,480" fill="url(#floor-grad)" stroke="#2ee6d6" strokeWidth="1" strokeOpacity="0.15" />

            {/* Isometric Desks and Chairs */}
            <polygon points="320,380 410,340 460,370 370,410" fill="#2c423f" stroke="#3d6461" strokeWidth="1.5" />
            <polygon points="480,440 570,400 620,430 530,470" fill="#2c423f" stroke="#3d6461" strokeWidth="1.5" />
            <polygon points="240,460 330,420 380,450 290,490" fill="#2c423f" stroke="#3d6461" strokeWidth="1.5" />
            <polygon points="400,530 490,490 540,520 450,560" fill="#2c423f" stroke="#3d6461" strokeWidth="1.5" />

            {/* Ceiling Airflow Ventilation Unit */}
            <polygon points="460,110 540,80 570,95 490,125" fill="#1e3e4a" stroke="#2ee6d6" strokeWidth="1.5" />
            <polygon points="460,125 490,140 570,110 540,95" fill="#122730" />

            {/* Glowing Airflow Streaks */}
            <path d="M480,130 C450,180 380,240 320,320" stroke="url(#air-stream)" strokeWidth="3" fill="none" strokeDasharray="6 3" />
            <path d="M495,135 C480,200 440,280 390,360" stroke="url(#air-stream)" strokeWidth="3.5" fill="none" strokeDasharray="8 4" />
            <path d="M510,130 C510,210 500,290 470,380" stroke="url(#air-stream)" strokeWidth="2.5" fill="none" strokeDasharray="6 3" />

            {/* Warm Ambient Wall Sconces */}
            <circle cx="280" cy="180" r="14" fill="#ffb347" fillOpacity="0.4" filter="blur(6px)" />
            <circle cx="650" cy="210" r="16" fill="#ffb347" fillOpacity="0.4" filter="blur(8px)" />
          </svg>

          {/* 1. Floating Ventilation Badge (top center) */}
          <div
            className={`room-marker-badge ${selectedSensorId === "ventilation_enc" ? "selected" : ""}`}
            style={{ top: "15%", left: "45%" }}
            onClick={() => setSelectedSensorId("ventilation_enc")}
            tabIndex={0}
            role="button"
            aria-label="Ventilation status marker"
          >
            <div className="marker-icon-box">
              <Sliders size={15} />
            </div>
            <div className="marker-info">
              <span className="marker-label">Ventilation</span>
              <div className="marker-val-row">
                <span className="marker-val">{params.ventilation_enc ? "Open" : "Closed"}</span>
                <span
                  className={`marker-status-dot ${params.ventilation_enc ? "cyan" : "red"}`}
                />
              </div>
            </div>
          </div>

          {/* 2. Floating CO2 Badge (left area) */}
          <div
            className={`room-marker-badge ${selectedSensorId === "co2" ? "selected" : ""}`}
            style={{ top: "42%", left: "22%" }}
            onClick={() => setSelectedSensorId("co2")}
            tabIndex={0}
            role="button"
            aria-label="CO2 reading marker"
          >
            <div className="marker-icon-box">
              <Wind size={15} />
            </div>
            <div className="marker-info">
              <span className="marker-label">CO2</span>
              <div className="marker-val-row">
                <span className="marker-val">{params.co2} ppm</span>
                <span className="marker-status-dot amber" />
              </div>
            </div>
          </div>

          {/* 3. Floating Temperature Badge (right area) */}
          <div
            className={`room-marker-badge ${selectedSensorId === "temperature" ? "selected" : ""}`}
            style={{ top: "44%", right: "26%" }}
            onClick={() => setSelectedSensorId("temperature")}
            tabIndex={0}
            role="button"
            aria-label="Temperature reading marker"
          >
            <div className="marker-icon-box">
              <Thermometer size={15} />
            </div>
            <div className="marker-info">
              <span className="marker-label">Temperature</span>
              <div className="marker-val-row">
                <span className="marker-val">{params.temperature} °C</span>
                <span className="marker-status-dot cyan" />
              </div>
            </div>
          </div>

          {/* 4. Floating PM2.5 Badge (lower left) */}
          <div
            className={`room-marker-badge ${selectedSensorId === "pm25" ? "selected" : ""}`}
            style={{ bottom: "28%", left: "24%" }}
            onClick={() => setSelectedSensorId("pm25")}
            tabIndex={0}
            role="button"
            aria-label="PM2.5 reading marker"
          >
            <div className="marker-icon-box">
              <Sparkles size={15} />
            </div>
            <div className="marker-info">
              <span className="marker-label">PM2.5</span>
              <div className="marker-val-row">
                <span className="marker-val">{params.pm25} µg/m³</span>
                <span className="marker-status-dot red" />
              </div>
            </div>
          </div>

          {/* 5. Floating Occupancy Badge (lower center) */}
          <div
            className={`room-marker-badge ${selectedSensorId === "occupancy" ? "selected" : ""}`}
            style={{ bottom: "24%", left: "46%" }}
            onClick={() => setSelectedSensorId("occupancy")}
            tabIndex={0}
            role="button"
            aria-label="Occupancy marker"
          >
            <div className="marker-icon-box">
              <Users size={15} />
            </div>
            <div className="marker-info">
              <span className="marker-label">Occupancy</span>
              <div className="marker-val-row">
                <span className="marker-val">{params.occupancy} people</span>
                <span className="marker-status-dot red" />
              </div>
            </div>
          </div>
        </div>

        {/* Floating Camera Toolbar at Bottom Center */}
        <div className="camera-controls-bar" role="toolbar" aria-label="Room Camera Controls">
          <button
            className={`cam-btn ${activeCameraTool === "rotate" ? "active" : ""}`}
            onClick={() => setActiveCameraTool("rotate")}
            aria-label="Rotate camera"
            title="Rotate"
          >
            <RotateCw size={17} />
            <span>Rotate</span>
          </button>
          <button
            className={`cam-btn ${activeCameraTool === "zoom" ? "active" : ""}`}
            onClick={() => setActiveCameraTool("zoom")}
            aria-label="Zoom camera"
            title="Zoom"
          >
            <ZoomIn size={17} />
            <span>Zoom</span>
          </button>
          <button
            className={`cam-btn ${activeCameraTool === "pan" ? "active" : ""}`}
            onClick={() => setActiveCameraTool("pan")}
            aria-label="Pan camera"
            title="Pan"
          >
            <Move size={17} />
            <span>Pan</span>
          </button>
          <button
            className="cam-btn"
            onClick={() => setActiveCameraTool("rotate")}
            aria-label="Reset camera"
            title="Reset"
          >
            <RotateCcw size={17} />
            <span>Reset</span>
          </button>
        </div>
      </section>

      {/* 5. Right Column Placeholder: 470px wide */}
      <aside
        className="overview-right-column right-column-placeholder"
        aria-label="Air Quality and Sensor Summary"
      >
        {/* Card 1: Indoor Air Quality */}
        <div className="rail-card">
          <div className="rail-card-head">
            <div className="rail-card-title-group">
              <h2 className="rail-card-title">Indoor Air Quality</h2>
              <button
                className="info-icon-btn"
                title="Calculated proxy index based on PM2.5, CO2, TVOC, and CO. Not regulatory AQI."
                aria-label="About Indoor Air Quality metric"
              >
                <Info size={14} />
              </button>
            </div>
            <span className="proxy-pill">Project Proxy</span>
          </div>

          <div className="gauge-content-row">
            <div className="gauge-svg-wrap">
              <svg className="gauge-svg-element" viewBox="0 0 130 130">
                <defs>
                  <linearGradient id="gaugeGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#2ee6d6" />
                    <stop offset="50%" stopColor="#ffb347" />
                    <stop offset="100%" stopColor="#ff6b5b" />
                  </linearGradient>
                </defs>
                {/* Background arc track */}
                <path
                  d={gaugeArcPath.bgArc}
                  fill="none"
                  stroke="rgba(46, 230, 214, 0.12)"
                  strokeWidth="10"
                  strokeLinecap="round"
                />
                {/* Active value gradient arc */}
                <path
                  d={gaugeArcPath.valArc}
                  fill="none"
                  stroke="url(#gaugeGrad)"
                  strokeWidth="10"
                  strokeLinecap="round"
                />
              </svg>
              <div className="gauge-text-overlay">
                <span className="gauge-number">{proxyScore}</span>
                <span className="gauge-pts">pts</span>
              </div>
            </div>

            <div className="gauge-meta-block">
              <span className="status-label-caption">Current Status</span>
              <div className="status-value-row">
                <span className={`dot dot-${statusType === "poor" ? "offline" : "online"}`} />
                <span className={`status-large-text ${statusType}`}>{statusLabel}</span>
              </div>
              <p className="status-explanation">{statusExplanation}</p>
            </div>
          </div>
        </div>

        {/* Card 2: Selected Sensor */}
        <div className="rail-card">
          <div className="rail-card-head">
            <h2 className="rail-card-title">Selected Sensor</h2>
            <select
              className="sensor-select-box"
              value={selectedSensorId}
              onChange={(e) => setSelectedSensorId(e.target.value)}
              aria-label="Select sensor to inspect"
            >
              {SENSORS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="selected-sensor-row">
            <div className="sensor-big-icon-box">
              <selectedSensor.icon size={22} />
            </div>
            <div className="sensor-name-val-group">
              <span className="sensor-sub-name">{selectedSensor.short}</span>
              <span className="sensor-big-value">{currentReading}</span>
            </div>
            <div className={`sensor-state-pill ${sensorStateClass}`}>
              <span
                className={`dot ${sensorStateClass === "elevated" ? "dot-offline" : "dot-cyan"}`}
              />
              <span>{sensorState}</span>
            </div>
          </div>

          <div className="about-reading-block">
            <span className="about-reading-title">About this reading</span>
            <p className="about-reading-body">
              {selectedRule?.reason || selectedSensor.interpretation}
            </p>
          </div>
        </div>

        {/* Card 3: Recent Trends (Last 24 Hours) */}
        <div className="rail-card">
          <div className="rail-card-head">
            <h2 className="rail-card-title">Recent Trends (Last 24 Hours)</h2>
            <select
              className="sensor-select-box"
              value={trendSensorId}
              onChange={(e) => setTrendSensorId(e.target.value)}
              aria-label="Select metric for 24h trend chart"
            >
              <option value="co2">CO2</option>
              <option value="pm25">PM2.5</option>
              <option value="pm10">PM10</option>
              <option value="tvoc">TVOC</option>
              <option value="temperature">Temperature</option>
            </select>
          </div>

          <div className="trends-chart-container">
            <div className="trends-chart-svg-box">
              <svg
                className="trend-svg-chart"
                viewBox={`0 0 ${chartProps.width} ${chartProps.height}`}
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient id="trendAreaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#2ee6d6" stopOpacity="0.28" />
                    <stop offset="100%" stopColor="#2ee6d6" stopOpacity="0" />
                  </linearGradient>
                  <filter id="cyanGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow
                      dx="0"
                      dy="0"
                      stdDeviation="2"
                      floodColor="#2ee6d6"
                      floodOpacity="0.6"
                    />
                  </filter>
                </defs>

                {/* Y-axis reference lines */}
                <line
                  x1="0"
                  y1="10"
                  x2={chartProps.width}
                  y2="10"
                  stroke="rgba(46, 230, 214, 0.08)"
                  strokeDasharray="3 3"
                />
                <line
                  x1="0"
                  y1="45"
                  x2={chartProps.width}
                  y2="45"
                  stroke="rgba(46, 230, 214, 0.08)"
                  strokeDasharray="3 3"
                />
                <line
                  x1="0"
                  y1="80"
                  x2={chartProps.width}
                  y2="80"
                  stroke="rgba(46, 230, 214, 0.08)"
                  strokeDasharray="3 3"
                />

                {/* Y-axis Labels */}
                <text x="4" y="14" fill="#8fa9b8" fontSize="8" fontFamily="JetBrains Mono">
                  1200
                </text>
                <text x="4" y="49" fill="#8fa9b8" fontSize="8" fontFamily="JetBrains Mono">
                  800
                </text>
                <text x="4" y="84" fill="#8fa9b8" fontSize="8" fontFamily="JetBrains Mono">
                  400
                </text>

                {/* Area under curve */}
                <path d={chartProps.areaD} fill="url(#trendAreaGrad)" />

                {/* Stroke curve with glow */}
                <path
                  d={chartProps.pathD}
                  fill="none"
                  stroke="#2ee6d6"
                  strokeWidth="2.2"
                  filter="url(#cyanGlow)"
                />

                {/* Latest data point dot */}
                <circle
                  cx={chartProps.lastPoint[0]}
                  cy={chartProps.lastPoint[1]}
                  r="7"
                  fill="#2ee6d6"
                  fillOpacity="0.25"
                />
                <circle
                  cx={chartProps.lastPoint[0]}
                  cy={chartProps.lastPoint[1]}
                  r="3.5"
                  fill="#2ee6d6"
                />
              </svg>

              {/* Data Callout Tooltip Pill */}
              <div className="trend-callout-pill">
                <span className="callout-val">
                  {params[trendSensorId] != null
                    ? `${params[trendSensorId]} ${trendSensorId === "co2" ? "ppm" : trendSensorId === "temperature" ? "°C" : "µg/m³"}`
                    : "700 ppm"}
                </span>
                <span className="callout-time">Oct 17, 5:00 PM</span>
              </div>
            </div>

            <div className="trend-x-axis-row">
              <span>6 PM</span>
              <span>12 AM</span>
              <span>6 AM</span>
              <span>12 PM</span>
              <span>6 PM</span>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}