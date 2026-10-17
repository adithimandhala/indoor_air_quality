import { useState, useEffect, useRef, useCallback } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import ReactMarkdown from 'react-markdown';
import {
  Wind, Users, Thermometer, Droplets, Cloud,
  Zap, Sun, Activity, Info, FileText,
  CheckCircle, XCircle, AlertTriangle, ShieldAlert,
  Target, TrendingDown, Clock, Database, ChevronDown, ChevronUp, Download
} from 'lucide-react';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const API = "http://127.0.0.1:8000";

const T = {
  bg:      "#0B0F1A",
  card:    "#161E2E",
  border:  "rgba(255,255,255,0.07)",
  cyan:    "#00D4FF",
  amber:   "#FFB547",
  danger:  "#FF4D4F",
  success: "#22c55e",
  muted:   "#64748B",
  text:    "#E8F4F8",
};

function aqiColor(v) {
  if (v <= 50)  return "#22c55e";
  if (v <= 100) return "#eab308";
  if (v <= 150) return "#f97316";
  if (v <= 200) return "#ef4444";
  if (v <= 300) return "#8b5cf6";
  return "#7f1d1d";
}

function aqiLabel(v) {
  if (v <= 50)  return "Good";
  if (v <= 100) return "Moderate";
  if (v <= 150) return "Unhealthy for Sensitive Groups";
  if (v <= 200) return "Unhealthy";
  if (v <= 300) return "Very Unhealthy";
  return "Hazardous";
}

function getStatus(val, normal, warning) {
  if (val <= normal) return 'normal';
  if (val <= warning) return 'warning';
  return 'danger';
}

function BreathRing({ aqi, confidence }) {
  const r = 85, cx = 110, cy = 110, lw = 16;
  const circ = 2 * Math.PI * r;
  const pct  = Math.min(1, aqi / 500);
  const dashOffset = circ * (1 - pct);
  const color = aqiColor(aqi);

  return (
    <div className="flex flex-col items-center relative">
      <svg width="220" height="220" viewBox="0 0 220 220">
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke="rgba(255,255,255,0.04)" strokeWidth={lw} />
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke={color} strokeWidth={lw} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: "stroke-dashoffset 1s ease-out, stroke 0.5s ease" }}
        />
        {[50, 100, 150, 200, 300].map((zone) => {
          const angle = (zone / 500) * 360 - 90;
          const rad   = (angle * Math.PI) / 180;
          return <circle key={zone}
            cx={cx + (r + 14) * Math.cos(rad)}
            cy={cy + (r + 14) * Math.sin(rad)}
            r={2} fill="rgba(255,255,255,0.15)" />;
        })}
        <text x={cx} y={cy - 12} textAnchor="middle" fill={color}
          fontSize="48" fontWeight="800" fontFamily="'Space Grotesk', sans-serif">
          {Math.round(aqi)}
        </text>
        <text x={cx} y={cy + 18} textAnchor="middle"
          fill={T.text} fontSize="13" fontWeight="500" fontFamily="Inter, sans-serif">
          {aqiLabel(aqi)}
        </text>
        <text x={cx} y={cy + 38} textAnchor="middle"
          fill={T.muted} fontSize="10" fontFamily="'JetBrains Mono', monospace" letterSpacing="0.05em">
          AQI INDEX
        </text>
      </svg>
      {confidence && (
        <div className="absolute top-2 right-2 flex flex-col items-end">
          <span style={{ fontSize: 10, color: T.muted }}>Confidence</span>
          <span style={{ fontSize: 12, color: T.success, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{confidence}%</span>
        </div>
      )}
    </div>
  );
}

function Slider({ label, min, max, value, onChange, unit = "", step = 1, icon: Icon, normalRange, status }) {
  const pct = ((value - min) / (max - min)) * 100;
  let trackColor = T.cyan;
  let trackBg = "rgba(255,255,255,0.06)";
  
  if (status === 'danger') trackColor = T.danger;
  else if (status === 'warning') trackColor = T.amber;

  return (
    <div className="mb-4 group">
      <div className="flex justify-between items-center mb-1">
        <div className="flex items-center gap-2">
          {Icon && <Icon size={14} color={T.muted} />}
          <span style={{ color: T.text, fontSize: 13, fontWeight: 500 }}>{label}</span>
          {status === 'danger' && <AlertTriangle size={12} color={T.danger} />}
        </div>
        <span style={{ color: trackColor, fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
          {value}{unit}
        </span>
      </div>
      <div className="relative h-1.5 rounded-full mt-2" style={{ background: trackBg }}>
        <div className="absolute top-0 left-0 h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, background: trackColor, boxShadow: `0 0 8px ${trackColor}60` }} />
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
        />
      </div>
      {normalRange && (
        <div className="flex justify-between items-center mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
           <span style={{ color: T.muted, fontSize: 10 }}>Normal: {normalRange}</span>
        </div>
      )}
    </div>
  );
}

function Toggle({ label, value, onChange, icon: Icon }) {
  return (
    <div className="flex items-center justify-between mb-3 py-1">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={14} color={T.muted} />}
        <span style={{ color: T.text, fontSize: 13, fontWeight: 500 }}>{label}</span>
      </div>
      <button onClick={() => onChange(!value)}
        className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none"
        style={{ background: value ? T.cyan : "rgba(255,255,255,0.1)" }}>
        <span className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform shadow-sm"
          style={{ transform: value ? "translateX(18px)" : "translateX(3px)" }} />
      </button>
    </div>
  );
}

function ShapBars({ shap }) {
  if (!shap) return null;
  const sorted = Object.entries(shap).sort((a, b) => b[1] - a[1]);
  const colors = ["#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#8b5cf6","#ec4899","#6b7280"];
  const topContributor = sorted[0];

  return (
    <div>
      <div className="mb-4 pb-3 border-b border-white/5">
        <p className="text-xs text-muted font-medium uppercase tracking-wider mb-1" style={{color: T.muted}}>Top Contributor</p>
        <div className="flex items-center gap-2">
           <Target size={16} color={colors[0]} />
           <span style={{ color: T.text, fontSize: 14, fontWeight: 600 }}>{topContributor[0]}</span>
           <span style={{ color: colors[0], fontSize: 14, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{topContributor[1]}%</span>
        </div>
        <p className="mt-2 text-xs" style={{color: T.muted, lineHeight: 1.5}}>
          {topContributor[0]} is currently the primary contributor to the predicted AQI. Addressing this will have the highest impact.
        </p>
      </div>
      
      <div className="space-y-3">
        {sorted.slice(1).map(([key, pct], i) => (
          <div key={key}>
            <div className="flex justify-between mb-1">
              <span style={{ color: T.text, fontSize: 12 }}>{key}</span>
              <span style={{ color: T.muted, fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{pct}%</span>
            </div>
            <div className="w-full rounded-full h-1.5" style={{ background: "rgba(255,255,255,0.05)" }}>
              <div className="h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, background: colors[(i + 1) % colors.length] }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ForecastChart({ forecast }) {
  if (!forecast) return null;
  const labels = forecast.map(f => f.label);
  const values = forecast.map(f => f.aqi);
  
  const data = {
    labels,
    datasets: [{
      label: "Predicted AQI", data: values,
      borderColor: T.cyan, 
      backgroundColor: "rgba(0,212,255,0.15)",
      borderWidth: 2, 
      pointBackgroundColor: values.map(v => aqiColor(v)),
      pointBorderColor: T.bg,
      pointBorderWidth: 2,
      pointRadius: 6, pointHoverRadius: 8,
      tension: 0.4, fill: true,
    }]
  };
  const options = {
    responsive: true, maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: { display: false },
      tooltip: { 
        backgroundColor: T.card, titleColor: T.text, bodyColor: T.text, 
        borderColor: T.border, borderWidth: 1, padding: 10,
        titleFont: { size: 13, family: 'Inter' },
        bodyFont: { size: 14, family: "'JetBrains Mono'", weight: 'bold' },
        displayColors: false,
        callbacks: {
          label: (ctx) => `AQI: ${Math.round(ctx.raw)} (${aqiLabel(ctx.raw)})`
        }
      }
    },
    scales: {
      x: { ticks: { color: T.muted, font: { size: 11 } }, grid: { color: "rgba(255,255,255,0.03)" } },
      y: { ticks: { color: T.muted, font: { size: 11 } }, grid: { color: "rgba(255,255,255,0.03)", borderDash: [4, 4] }, min: 0, max: Math.max(...values, 200) + 20 }
    }
  };
  return <div style={{ height: 180 }}><Line data={data} options={options} /></div>;
}

function OptCards({ options, onSelect, selected }) {
  if (!options) return null;
  const icons = { wind: Wind, air: Wind, "users-minus": Users, snowflake: Zap };
  
  return (
    <div className="flex flex-col gap-3">
      {options.map(opt => {
        const Icon = icons[opt.icon] || Info;
        const isSelected = selected?.id === opt.id;
        
        let badgeColor = T.muted;
        let badgeBg = "rgba(255,255,255,0.1)";
        let priorityLabel = "Alternative";
        
        if (opt.best) {
           badgeColor = T.success; badgeBg = "rgba(34,197,94,0.15)"; priorityLabel = "Best Option";
        } else if (opt.improvement_pct > 10) {
           badgeColor = T.amber; badgeBg = "rgba(245,158,11,0.15)"; priorityLabel = "Good Option";
        }

        return (
          <button key={opt.id} onClick={() => onSelect(opt)}
            className="text-left p-4 rounded-xl transition-all duration-200 flex flex-col gap-2 relative overflow-hidden group"
            style={{
              background: isSelected ? "rgba(0,212,255,0.05)" : "rgba(255,255,255,0.02)",
              border: `1px solid ${isSelected ? T.cyan : T.border}`,
            }}>
            
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                 <div className="p-2 rounded-lg" style={{background: badgeBg, color: badgeColor}}>
                    <Icon size={18} />
                 </div>
                 <div>
                   <div style={{ color: T.text, fontSize: 14, fontWeight: 600 }}>{opt.name}</div>
                   <div style={{ color: badgeColor, fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                     {priorityLabel}
                   </div>
                 </div>
              </div>
              <div className="text-right">
                 <div style={{ color: T.success, fontSize: 15, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                   ↓ {opt.improvement_pct}%
                 </div>
                 <div style={{ color: T.muted, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                   AQI {Math.round(opt.base_aqi)} → {Math.round(opt.simulated_aqi)}
                 </div>
              </div>
            </div>
            
            <div style={{ color: T.muted, fontSize: 12, lineHeight: 1.5, marginTop: 4 }}>
               {opt.description}
            </div>
            
            {isSelected && (
              <div className="absolute inset-0 pointer-events-none rounded-xl" style={{boxShadow: `inset 0 0 0 1px ${T.cyan}40`}} />
            )}
          </button>
        );
      })}
    </div>
  );
}

function Advisor({ params, prediction }) {
  const [messages, setMessages] = useState([]);
  const [input,    setInput]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const endRef = useRef(null);
  
  const chips = [
    "Explain my AQI", 
    "Generate Health Report", 
    "What should I do now?", 
    "Which pollutant is causing the problem?"
  ];

  const ask = useCallback(async (question) => {
    if (!params || !prediction || loading) return;
    setLoading(true);
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setMessages(m => [...m, { role: "user", content: question, time: timestamp }]);

    const shapSummary = prediction.shap
      ? Object.entries(prediction.shap).sort((a,b)=>b[1]-a[1]).slice(0,3)
          .map(([k,v]) => `${k}: ${v}%`).join(", ")
      : "";

    try {
      const res = await fetch(`${API}/advisor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          params, current_aqi: prediction.current_aqi,
          aqi_30min: prediction.forecast?.[2]?.aqi ?? prediction.current_aqi,
          shap_summary: shapSummary, question,
        }),
      });

      if (!res.ok) throw new Error(`API Error: ${res.statusText}`);

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText  = "";
      const assistTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setMessages(m => [...m, { role: "assistant", content: "", time: assistTime }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        setMessages(m => {
          const updated = [...m];
          updated[updated.length - 1] = { role: "assistant", content: fullText, time: assistTime };
          return updated;
        });
      }
    } catch (e) {
      setMessages(m => [...m, { role: "assistant", content: "Error: Unable to reach AI Advisor. Please verify your OpenAI API key in the backend/.env file.", time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
    } finally {
      setLoading(false);
    }
  }, [params, prediction, loading]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  return (
    <div className="flex flex-col h-[400px]">
      <div className="flex gap-2 mb-4 flex-wrap">
        {chips.map(c => (
          <button key={c} onClick={() => ask(c)}
            className="text-[11px] px-3 py-1.5 rounded-full transition-all hover:bg-white/10"
            style={{ background: "rgba(0,212,255,0.06)", color: T.text, border: "1px solid rgba(0,212,255,0.15)", fontWeight: 500 }}>
            {c}
          </button>
        ))}
      </div>
      
      <div className="flex-1 overflow-y-auto mb-4 space-y-4 pr-2 custom-scrollbar">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full opacity-50 space-y-3">
             <Activity size={32} color={T.muted} />
             <p style={{ color: T.muted, fontSize: 13 }}>AI Advisor is ready to assist you...</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"} max-w-[85%]`}>
              <div className={`rounded-2xl px-4 py-2.5 shadow-sm ${m.role === "user" ? "rounded-br-sm" : "rounded-bl-sm"}`}
                style={{
                  background: m.role === "user" ? T.cyan : "rgba(255,255,255,0.03)",
                  border: `1px solid ${m.role === "assistant" ? T.border : 'transparent'}`,
                  color: m.role === "user" ? T.bg : T.text, 
                  fontSize: 13, lineHeight: 1.6,
                }}>
                {m.content ? (
                  m.role === "user" ? m.content : (
                    <div className="prose prose-sm prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5">
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    </div>
                  )
                ) : <span className="animate-pulse">● ● ●</span>}
              </div>
              <span className="text-[10px] mt-1 px-1 opacity-50" style={{color: T.muted}}>{m.time}</span>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      
      <div className="flex gap-2 relative">
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && input.trim()) { ask(input.trim()); setInput(""); } }}
          placeholder="Type your question..."
          className="flex-1 px-4 py-3 rounded-xl text-sm outline-none transition-all focus:ring-2 focus:ring-cyan-500/50"
          style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${T.border}`, color: T.text }}
        />
        <button onClick={() => { if (input.trim()) { ask(input.trim()); setInput(""); } }}
          className="px-5 py-3 rounded-xl text-sm font-semibold transition-all hover:opacity-90 active:scale-95 flex items-center justify-center shadow-lg"
          style={{ background: T.cyan, color: T.bg, boxShadow: `0 4px 14px 0 ${T.cyan}40` }}>
          Send
        </button>
      </div>
    </div>
  );
}

const Card = ({ title, icon: Icon, children, className = "", action }) => (
  <div className={`rounded-2xl p-5 shadow-sm transition-all duration-300 hover:shadow-md ${className}`}
    style={{ background: T.card, border: `1px solid ${T.border}` }}>
    {(title || action) && (
      <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
        <div className="flex items-center gap-2">
          {Icon && <Icon size={16} color={T.cyan} />}
          <h3 className="text-[13px] font-semibold tracking-wider uppercase"
            style={{ color: T.text, letterSpacing: "0.08em" }}>
            {title}
          </h3>
        </div>
        {action}
      </div>
    )}
    {children}
  </div>
);

function RoomStatusCard({ params }) {
  const score = Math.max(0, 100 - (
    (params.co2 > 1000 ? 20 : 0) +
    (params.pm25 > 35 ? 20 : 0) +
    (params.tvoc > 300 ? 15 : 0) +
    (params.temperature > 26 || params.temperature < 20 ? 10 : 0)
  ));
  
  return (
    <Card title="Room Status" icon={Activity}>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
           <span style={{color: T.muted, fontSize: 11}}>Ventilation</span>
           <div className="flex items-center gap-1.5">
             {params.ventilation_enc ? <Wind size={14} color={T.success}/> : <Wind size={14} color={T.amber}/>}
             <span style={{fontSize: 13, fontWeight: 500}}>{params.ventilation_enc ? 'Active/Open' : 'Restricted'}</span>
           </div>
        </div>
        <div className="flex flex-col gap-1">
           <span style={{color: T.muted, fontSize: 11}}>Occupancy</span>
           <div className="flex items-center gap-1.5">
             <Users size={14} color={params.occupancy > 30 ? T.amber : T.success}/>
             <span style={{fontSize: 13, fontWeight: 500}}>{params.occupancy} People</span>
           </div>
        </div>
        <div className="flex flex-col gap-1">
           <span style={{color: T.muted, fontSize: 11}}>Pollution Level</span>
           <div className="flex items-center gap-1.5">
             <Cloud size={14} color={params.pm25 > 35 ? T.danger : T.success}/>
             <span style={{fontSize: 13, fontWeight: 500}}>{params.pm25 > 35 ? 'High' : 'Normal'}</span>
           </div>
        </div>
        <div className="flex flex-col gap-1">
           <span style={{color: T.muted, fontSize: 11}}>Overall Score</span>
           <div className="flex items-center gap-1.5">
             <ShieldAlert size={14} color={score > 80 ? T.success : score > 60 ? T.amber : T.danger}/>
             <span style={{fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono'"}}>{score}/100</span>
           </div>
        </div>
      </div>
    </Card>
  );
}

function HealthAdvisory({ aqi }) {
  let risk = "Low Risk";
  let sensitive = "None";
  let precautions = "Ideal air quality for outdoor activities.";
  let color = T.success;

  if (aqi > 50 && aqi <= 100) {
    risk = "Moderate Risk"; sensitive = "Unusually sensitive individuals"; precautions = "Consider reducing prolonged outdoor exertion."; color = T.amber;
  } else if (aqi > 100 && aqi <= 150) {
    risk = "High Risk for Sensitive Groups"; sensitive = "Children, elderly, asthmatics"; precautions = "Reduce prolonged outdoor exertion."; color = "#f97316";
  } else if (aqi > 150 && aqi <= 200) {
    risk = "Unhealthy (High Risk)"; sensitive = "Everyone"; precautions = "Avoid prolonged outdoor exertion. Wear masks."; color = T.danger;
  } else if (aqi > 200) {
    risk = "Very Unhealthy / Hazardous"; sensitive = "Everyone"; precautions = "Stay indoors. Keep windows closed. Run purifiers."; color = "#8b5cf6";
  }

  return (
    <div className="mt-6 p-4 rounded-xl flex gap-4 items-start" style={{background: `${color}15`, border: `1px solid ${color}30`}}>
      <Info size={24} color={color} className="shrink-0 mt-1" />
      <div className="flex flex-col gap-1">
        <h4 style={{color: color, fontSize: 14, fontWeight: 700}}>{risk}</h4>
        <p style={{color: T.text, fontSize: 12, lineHeight: 1.5}}><span className="font-semibold opacity-75">Sensitive Groups:</span> {sensitive}</p>
        <p style={{color: T.text, fontSize: 12, lineHeight: 1.5}}><span className="font-semibold opacity-75">Action:</span> {precautions}</p>
      </div>
    </div>
  );
}

function ReportModal({ isOpen, onClose, params, prediction, opt, modelR2 }) {
  if (!isOpen) return null;
  const time = new Date().toLocaleString();
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm transition-opacity">
      <div className="bg-[#1E2A3A] w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden border border-white/10 flex flex-col max-h-[90vh]">
        <div className="p-5 border-b border-white/10 flex justify-between items-center bg-[#161E2E]">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <FileText size={20} color={T.cyan} /> Official Air Quality Report
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors">
            <XCircle size={24} />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-sm text-slate-300">
          <div className="flex justify-between items-end border-b border-slate-700 pb-4">
             <div>
                <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Generated</p>
                <p className="font-mono">{time}</p>
             </div>
             <div className="text-right">
                <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Status</p>
                <p className="font-bold" style={{color: aqiColor(prediction?.current_aqi)}}>{aqiLabel(prediction?.current_aqi)} (AQI {prediction?.current_aqi})</p>
             </div>
          </div>
          
          <div>
            <h3 className="text-white font-semibold mb-3">Room Parameters Snapshot</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
              <div className="bg-white/5 p-2 rounded">Temp: {params.temperature}°C</div>
              <div className="bg-white/5 p-2 rounded">Hum: {params.humidity}%</div>
              <div className="bg-white/5 p-2 rounded">CO2: {params.co2}ppm</div>
              <div className="bg-white/5 p-2 rounded">PM2.5: {params.pm25}µg</div>
              <div className="bg-white/5 p-2 rounded">TVOC: {params.tvoc}ppb</div>
              <div className="bg-white/5 p-2 rounded">Occ: {params.occupancy}</div>
              <div className="bg-white/5 p-2 rounded">Vent: {params.ventilation_enc ? 'Open':'Closed'}</div>
              <div className="bg-white/5 p-2 rounded">Model R²: {modelR2}</div>
            </div>
          </div>

          {prediction?.shap && (
            <div>
               <h3 className="text-white font-semibold mb-2">Key Contributors</h3>
               <p className="mb-2">The primary factor degrading air quality is currently <strong>{Object.keys(prediction.shap).sort((a,b)=>prediction.shap[b]-prediction.shap[a])[0]}</strong>.</p>
            </div>
          )}

          {opt && opt.length > 0 && (
             <div>
               <h3 className="text-white font-semibold mb-2">AI Recommended Action</h3>
               <div className="bg-[#0B0F1A] p-4 rounded-lg border border-[#22c55e]/30">
                 <p className="font-semibold text-white">{opt[0].name}</p>
                 <p className="text-slate-400 mb-2">{opt[0].description}</p>
                 <p className="font-mono text-[#22c55e]">Expected Improvement: {opt[0].improvement_pct}% (AQI {Math.round(opt[0].base_aqi)} → {Math.round(opt[0].simulated_aqi)})</p>
               </div>
             </div>
          )}
        </div>
        
        <div className="p-4 border-t border-white/10 bg-[#161E2E] flex justify-end">
          <button onClick={() => {
              window.print();
            }} 
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg flex items-center gap-2 font-medium transition-colors">
            <Download size={16} /> Save / Print
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [temp,       setTemp]       = useState(23);
  const [humidity,   setHumidity]   = useState(50);
  const [co2,        setCo2]        = useState(700);
  const [pm25,       setPm25]       = useState(35);
  const [pm10,       setPm10]       = useState(50);
  const [tvoc,       setTvoc]       = useState(250);
  const [co,         setCo]         = useState(2.5);
  const [light,      setLight]      = useState(500);
  const [motion,     setMotion]     = useState(true);
  const [occupancy,  setOccupancy]  = useState(25);
  const [ventOpen,   setVentOpen]   = useState(false);
  const [fans,       setFans]       = useState(true);
  const [ac,         setAC]         = useState(false);
  const [prediction, setPrediction] = useState(null);
  const [options,    setOptions]    = useState(null);
  const [selectedOpt,setSelectedOpt]= useState(null);
  const [simAqi,     setSimAqi]     = useState(null);
  const [sessions,   setSessions]   = useState([]);
  const [histOpen,   setHistOpen]   = useState(false);
  const [modelR2,    setModelR2]    = useState(null);
  const [lastPredTime, setLastPredTime] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const debounceRef = useRef(null);

  const hour = new Date().getHours();
  const dow  = new Date().getDay();

  const params = {
    temperature: temp, humidity, co2, pm25, pm10, tvoc, co,
    light, motion: motion ? 1 : 0, occupancy,
    ventilation_enc: ventOpen ? 1 : 0,
    hour, day_of_week: dow,
    is_working_hours: hour >= 8 && hour <= 18 ? 1 : 0,
  };

  useEffect(() => {
    fetch(`${API}/model-info`).then(r => r.json()).then(d => setModelR2(d.r2)).catch(() => {});
    fetch(`${API}/sessions`).then(r => r.json()).then(d => setSessions(d.sessions || [])).catch(() => {});
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const [predRes, optRes] = await Promise.all([
          fetch(`${API}/predict`,  { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) }),
          fetch(`${API}/optimize`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) }),
        ]);
        const pred = await predRes.json();
        const opt  = await optRes.json();
        setPrediction(pred);
        setOptions(opt.options);
        setSelectedOpt(null);
        setSimAqi(null);
        setLastPredTime(new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'}));
      } catch (e) { console.error("API error:", e); }
    }, 400);
  }, [temp, humidity, co2, pm25, pm10, tvoc, co, light, motion, occupancy, ventOpen, fans, ac]);

  const displayAqi = simAqi ?? prediction?.current_aqi ?? 0;
  const confidenceScore = modelR2 ? Math.round(modelR2 * 100) : 95;

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8 font-sans selection:bg-cyan-500/30" style={{ background: T.bg, color: T.text }}>
      <ReportModal isOpen={reportOpen} onClose={() => setReportOpen(false)} params={params} prediction={prediction} opt={options} modelR2={modelR2} />

      {/* HEADER */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg"
            style={{ background: "linear-gradient(135deg, rgba(0,212,255,0.2) 0%, rgba(0,212,255,0.05) 100%)", border: "1px solid rgba(0,212,255,0.3)" }}>
            <Wind size={24} color={T.cyan} />
          </div>
          <div>
            <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em" }}>
              AirMind AI
            </h1>
            <p className="flex items-center gap-2 mt-0.5" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: T.muted }}>
              <span className="uppercase tracking-widest text-cyan-400 font-semibold">Predict</span> &bull; 
              <span className="uppercase tracking-widest text-amber-400 font-semibold">Explain</span> &bull; 
              <span className="uppercase tracking-widest text-emerald-400 font-semibold">Optimize</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-3 md:gap-4 bg-white/5 px-4 py-2 rounded-xl border border-white/5">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
               <Database size={14}/> 97,458 Records
            </div>
            <div className="hidden md:block w-px h-4 bg-white/10"></div>
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
               <Target size={14}/> GB Regressor
            </div>
            <div className="hidden md:block w-px h-4 bg-white/10"></div>
            {lastPredTime && (
              <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
                 <Clock size={14}/> {lastPredTime}
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl shadow-sm"
            style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)" }}>
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: T.success, boxShadow: `0 0 8px ${T.success}` }} />
            <span style={{ color: T.success, fontSize: 12, fontWeight: 600 }}>Live Monitoring</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        
        {/* COLUMN 1: Inputs & Status */}
        <div className="xl:col-span-3 flex flex-col gap-6">
          <RoomStatusCard params={params} />
          
          <Card title="Room Parameters" icon={Thermometer}>
            <Slider label="Temperature" min={18} max={30}   value={temp}      onChange={setTemp}      unit="°C"   step={0.5} icon={Thermometer} normalRange="20-24°C" status={getStatus(temp, 24, 27)} />
            <Slider label="Humidity"    min={30} max={80}   value={humidity}  onChange={setHumidity}  unit="%"    icon={Droplets} normalRange="40-60%" status={getStatus(humidity, 60, 70)} />
            <Slider label="CO₂"         min={400} max={1500} value={co2}       onChange={setCo2}       unit=" ppm" step={10} icon={Cloud} normalRange="<800ppm" status={getStatus(co2, 800, 1000)} />
            <Slider label="PM2.5"       min={0}  max={100}  value={pm25}      onChange={setPm25}      unit=" µg"  step={0.5} icon={Activity} normalRange="<12µg" status={getStatus(pm25, 12, 35)} />
            <Slider label="TVOC"        min={50} max={600}  value={tvoc}      onChange={setTvoc}      unit=" ppb" step={5} icon={AlertTriangle} normalRange="<200ppb" status={getStatus(tvoc, 200, 400)} />
            <Slider label="CO"          min={0.1} max={5}   value={co}        onChange={setCo}        unit=" ppm" step={0.1} icon={Cloud} normalRange="<1ppm" status={getStatus(co, 1.0, 2.0)} />
            <Slider label="Occupancy"   min={0}  max={50}   value={occupancy} onChange={setOccupancy} unit=" ppl" icon={Users} normalRange="<30" status={getStatus(occupancy, 30, 40)} />
            
            <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${T.border}` }}>
              <Toggle label="Ventilation Open" value={ventOpen} onChange={setVentOpen} icon={Wind} />
              <Toggle label="Fans Running"     value={fans}    onChange={setFans}    icon={Wind} />
              <Toggle label="AC Running"       value={ac}      onChange={setAC}      icon={Zap} />
            </div>
          </Card>
        </div>

        {/* COLUMN 2: Visualizations */}
        <div className="xl:col-span-5 flex flex-col gap-6">
          <Card title="Air Quality Index" icon={Activity}>
            <div className="flex flex-col items-center justify-center py-4">
              <BreathRing aqi={displayAqi} confidence={confidenceScore} />
              
              {prediction && (
                <div className="mt-6 text-center bg-white/5 px-6 py-2 rounded-full border border-white/5 flex items-center gap-2">
                  <span style={{ color: T.muted, fontSize: 13, fontWeight: 500 }}>30 Min Forecast:</span>
                  <span style={{ color: aqiColor(prediction.forecast?.[2]?.aqi ?? displayAqi), fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                    {Math.round(prediction.forecast?.[2]?.aqi ?? displayAqi)}
                  </span>
                  <span style={{ color: T.muted, fontSize: 14 }}>
                    {(prediction.forecast?.[2]?.aqi ?? displayAqi) > displayAqi ? <TrendingDown size={16} className="text-danger rotate-180 inline"/> : <TrendingDown size={16} className="text-success inline"/>}
                  </span>
                </div>
              )}
            </div>
            
            {prediction && <HealthAdvisory aqi={displayAqi} />}
          </Card>

          <Card title="AQI Forecast Timeline" icon={TrendingDown}>
            <ForecastChart forecast={prediction?.forecast} />
          </Card>

          <Card title="Key Contributors (SHAP)" icon={Target}>
            <ShapBars shap={prediction?.shap} />
          </Card>
        </div>

        {/* COLUMN 3: AI Actions & Reports */}
        <div className="xl:col-span-4 flex flex-col gap-6">
          
          {options && options.length > 0 && (
            <Card title="AI Optimization Summary" icon={Zap} className="bg-gradient-to-br from-[#161E2E] to-[#0f172a]">
              <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center pb-2 border-b border-white/5">
                   <span className="text-slate-400 text-sm">Best Recommendation</span>
                   <span className="text-[#22c55e] font-semibold text-sm px-2 py-1 bg-[#22c55e]/10 rounded-lg">{options[0].name}</span>
                </div>
                <div className="flex justify-between items-center">
                   <span className="text-slate-400 text-sm">Est. Improvement</span>
                   <span className="text-white font-mono font-bold text-lg">↓ {options[0].improvement_pct}%</span>
                </div>
                <div className="flex justify-between items-center">
                   <span className="text-slate-400 text-sm">Expected AQI</span>
                   <span className="text-cyan-400 font-mono font-bold text-lg">{Math.round(options[0].simulated_aqi)}</span>
                </div>
              </div>
            </Card>
          )}

          <Card title="Prioritized Recommendations" icon={CheckCircle}>
            <OptCards options={options} selected={selectedOpt} onSelect={(opt) => {
              setSelectedOpt(opt); setSimAqi(opt.simulated_aqi);
            }} />
          </Card>

          <Card title="AI Advisor" icon={ShieldAlert}>
            <Advisor params={params} prediction={prediction} />
          </Card>

          <div className="flex gap-4">
             <button onClick={() => setReportOpen(true)}
                className="flex-1 py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all hover:bg-white/10"
                style={{background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: T.text}}>
                <FileText size={18} /> Generate Report
             </button>
          </div>

        </div>
      </div>
    </div>
  );
}
