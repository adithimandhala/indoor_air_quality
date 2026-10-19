import { useState } from "react";
import { Bar, Line } from "react-chartjs-2";
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend } from "chart.js";
import { ArrowUpRight, Send, Wind } from "lucide-react";
import { Link } from "react-router-dom";
import { postJSON } from "./api.js";
import { useAirMind } from "./AppContext.jsx";
import "./pages.css";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend);

const palette = { cyan: "#43d9d0", teal: "#9ae8df", green: "#8fceab", amber: "#e5b76f", red: "#e77c78", blue: "#86aedd", muted: "#91a5b7", grid: "rgba(165,190,207,.12)" };
const chartOptions = { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: palette.muted, usePointStyle: true, boxWidth: 7, font: { family: "Inter", size: 10 } } }, tooltip: { backgroundColor: "#172532", borderColor: "rgba(255,255,255,.12)", borderWidth: 1, titleColor: "#edf6f8", bodyColor: "#c6d5dc" } }, scales: { x: { ticks: { color: palette.muted, maxTicksLimit: 6 }, grid: { color: palette.grid } }, y: { ticks: { color: palette.muted }, grid: { color: palette.grid } } } };

function PageTitle({ eyebrow, title, summary }) {
  return <header className="page-title"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{summary}</p></div></header>;
}

function Section({ title, subtitle, children }) {
  return <section className="panel"><div className="panel-head"><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div></div>{children}</section>;
}

function StateMessage({ children }) {
  return <div className="state-message">{children}</div>;
}

function TrendChart({ records, field, label, unit }) {
  const samples = records.filter((record) => record.timestamp && record[field] != null && Number.isFinite(Number(record[field]))).slice(-180);
  if (samples.length < 2) return <StateMessage>No historical observations are available for this sensor.</StateMessage>;
  return <div className="chart-area"><Line data={{
    labels: samples.map((record) => new Date(record.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "numeric" })),
    datasets: [{ label: `${label} (${unit})`, data: samples.map((record) => record[field]), borderColor: palette.cyan, backgroundColor: "rgba(67,217,208,.08)", pointRadius: 0, borderWidth: 1.6, tension: 0.2, spanGaps: true }],
  }} options={chartOptions} /></div>;
}

function Reading({ label, value, unit, rule }) {
  const high = rule?.priority === "urgent" || rule?.priority === "high";
  const elevated = Boolean(rule);
  return <div className="reading-row"><span>{label}</span><strong>{value}<small>{unit}</small></strong><span className={`reading-state ${high ? "high" : elevated ? "elevated" : "normal"}`}>{high ? "High screen" : elevated ? "Review" : "No screen"}</span></div>;
}

export function AirQualityPage() {
  const { params, historyRecords, prediction, dataSource, selectedTimestamp, dataset, selectHistoricalRecord } = useAirMind();
  const [field, setField] = useState("co2");
  const historicalChoices = historyRecords.filter((record) => record.timestamp && ["temperature", "humidity", "co2", "pm25", "pm10", "tvoc", "co", "light", "motion", "occupancy", "ventilation_enc"].every((key) => record[key] != null)).slice(-80).reverse();
  const readings = [
    ["CO2", "co2", "ppm"], ["PM2.5", "pm25", "ug/m3"], ["PM10", "pm10", "ug/m3"],
    ["TVOC", "tvoc", "ppb"], ["Carbon monoxide", "co", "ppm"], ["Temperature", "temperature", "degC"],
    ["Relative humidity", "humidity", "%"],
  ];
  const selected = readings.find((item) => item[1] === field) || readings[0];
  return <div className="page-stack">
    <PageTitle eyebrow="SENSOR READINGS" title="Air Quality" summary="Current selected inputs with historical observations from the supplied CSV." />
    <div className="source-strip"><span className={`source-mark ${dataSource}`} />{dataSource === "historical" ? `Selected record · ${selectedTimestamp ? new Date(selectedTimestamp).toLocaleString() : "timestamp unavailable"}` : "Simulated sensor inputs"}<span className="source-divider" />{dataset?.filename || "Dataset loading"}<label className="historical-picker-label">Historical record<select aria-label="Select a complete historical observation" value={selectedTimestamp || ""} onChange={(event) => { const record = historicalChoices.find((item) => item.timestamp === event.target.value); if (record) selectHistoricalRecord(record); }}><option value="">Choose a recent observation</option>{historicalChoices.map((record) => <option key={record.timestamp} value={record.timestamp}>{new Date(record.timestamp).toLocaleString()}</option>)}</select></label></div>
    <Section title="Current readings" subtitle="Project screening rules are indicators, not regulatory exposure limits.">
      <div className="sensor-reading-list">{readings.map(([label, key, unit]) => <Reading key={key} label={label} value={params[key]} unit={unit} rule={prediction?.recommendations?.find((item) => item.condition === key)} />)}</div>
    </Section>
    <Section title="Historical trend" subtitle="These are recorded CSV observations, not live telemetry.">
      <div className="filter-row trend-controls"><label>Sensor<select value={field} onChange={(event) => setField(event.target.value)}>{readings.map(([label, key]) => <option value={key} key={key}>{label}</option>)}</select></label><span>{selected[0]} · {selected[2]}</span></div>
      <TrendChart records={historyRecords} field={field} label={selected[0]} unit={selected[2]} />
    </Section>
    <details className="method-details"><summary>About the project proxy</summary><p>The custom proxy is the maximum of project-specific PM2.5, CO2, TVOC, and CO sub-indices. It is formula-derived; the dataset contains no measured AQI target, and this value is not regulatory AQI.</p></details>
  </div>;
}

export function PredictionsPage() {
  const { modelInfo, prediction } = useAirMind();
  const metric = modelInfo?.comparison?.["Random Forest"];
  const rows = modelInfo?.evaluation_sample || [];
  const chartData = { labels: rows.map((point) => new Date(point.timestamp).toLocaleDateString()), datasets: [
    { label: "Formula-derived target", data: rows.map((point) => point.actual), borderColor: palette.muted, borderWidth: 1.2, pointRadius: 0, tension: 0.05 },
    { label: "Random Forest estimate", data: rows.map((point) => point.predicted), borderColor: palette.cyan, borderWidth: 1.4, pointRadius: 0, tension: 0.05 },
  ] };
  return <div className="page-stack">
    <PageTitle eyebrow="SELECTED MODEL" title="Predictions" summary="Random Forest estimates the project-defined indoor air-quality proxy." />
    <Section title="Current estimate" subtitle="For the current simulated input or selected historical record.">
      <div className="prediction-pair"><div><span>Calculated custom proxy</span><strong>{prediction?.proxy_calculated?.toFixed(2) ?? "--"}<small>pts</small></strong></div><div><span>Random Forest estimate</span><strong>{prediction?.prediction?.toFixed(2) ?? "--"}<small>pts</small></strong></div></div>
      <p className="subtle-note">This is not a temporal forecast and does not estimate independently measured or regulatory AQI.</p>
    </Section>
    <Section title="Evaluation" subtitle={modelInfo?.evaluation_method || "Chronological holdout evaluation"}>
      {metric ? <div className="metric-grid three"><div className="metric-tile"><span>MAE</span><strong>{metric.mae.toFixed(4)}</strong><em>Lower is better</em></div><div className="metric-tile"><span>RMSE</span><strong>{metric.rmse.toFixed(4)}</strong><em>Penalizes larger errors</em></div><div className="metric-tile"><span>R²</span><strong>{metric.r2.toFixed(4)}</strong><em>Not a confidence score</em></div></div> : <StateMessage>Evaluation metadata is unavailable.</StateMessage>}
      <div className="evaluation-meta"><span>{modelInfo?.rows_train?.toLocaleString() ?? "--"} earlier training records</span><span>{modelInfo?.rows_test?.toLocaleString() ?? "--"} later test records</span><span>Newly reproduced evaluation</span></div>
      {rows.length > 1 && <div className="chart-area evaluation-chart"><Line data={chartData} options={chartOptions} /></div>}
    </Section>
    <details className="method-details"><summary>What this model can and cannot establish</summary><p>The CSV has no measured AQI labels. Training targets are calculated from PM2.5, CO2, TVOC, and CO, which are also model inputs. Near-perfect fit therefore shows that the model approximates this formula on a later-in-time holdout; it is not evidence of accuracy against independently measured air quality. Original Colab outputs were unavailable, so these results are newly reproduced.</p></details>
  </div>;
}

export function VentilationPage() {
  const { params, prediction, scenarios } = useAirMind();
  const [showScenario, setShowScenario] = useState(false);
  const recommendation = prediction?.recommendations?.[0];
  const scenario = scenarios?.scenarios?.find((item) => item.id === "ventilation_and_dilution");
  const alreadyOpen = Boolean(params.ventilation_enc);
  return <div className="page-stack">
    <PageTitle eyebrow="DECISION SUPPORT" title="Ventilation" summary="One actionable recommendation and an optional model-recomputed what-if." />
    <Section title="Current condition" subtitle="No physical window, fan, AC, or building control is connected.">
      <div className="ventilation-status"><span className={`source-mark ${alreadyOpen ? "historical" : ""}`} />Ventilation input {alreadyOpen ? "open" : "closed"}<span className="status-spacer" />CO2 {params.co2} ppm</div>
      {recommendation ? <div className={`ventilation-action priority-${recommendation.priority}`}><span>{recommendation.priority} priority · {recommendation.condition} {recommendation.observed} {recommendation.unit}</span><p>{recommendation.reason}</p><strong>{recommendation.action}</strong></div> : <p className="body-copy">No configured project screening rule is currently raised. This does not certify the room as safe.</p>}
    </Section>
    <Section title="Try an open-ventilation input" subtitle="A hypothetical change to one model feature. It does not operate a real window or predict an actual pollutant reduction.">
      <label className="scenario-switch"><input type="checkbox" checked={showScenario} onChange={(event) => setShowScenario(event.target.checked)} disabled={!scenario} /><span>{alreadyOpen ? "Compare open ventilation with assumed pollutant dilution" : "Compare opening ventilation with assumed pollutant dilution"}</span></label>
      {showScenario && scenario && <div className="scenario-compare"><div><span>Current RF estimate</span><strong>{scenarios.baseline_predicted_proxy?.toFixed(2)} pts</strong></div><ArrowUpRight size={17} /><div><span>Hypothetical inputs</span><strong>{scenario.predicted_proxy?.toFixed(2)} pts</strong></div><p>{scenario.assumptions} Model-predicted proxy change: {scenario.difference_from_baseline > 0 ? "+" : ""}{scenario.difference_from_baseline?.toFixed(2)} points. The estimate is recalculated by the existing RF pipeline; unchanged output is shown as-is.</p></div>}
    </Section>
  </div>;
}

export function ExplainabilityPage() {
  const { prediction, modelInfo } = useAirMind();
  const shap = prediction?.shap;
  const contributions = shap?.contributions || [];
  const visible = contributions.slice(0, 5);
  const maxAbs = Math.max(0.01, ...visible.map((item) => Math.abs(item.contribution)));
  const importance = Object.entries(modelInfo?.feature_importance || {}).sort((a, b) => b[1] - a[1]);
  const leading = visible[0];
  return <div className="page-stack">
    <PageTitle eyebrow="MODEL EXPLANATION" title="Explainability" summary="Local SHAP attributions describe this Random Forest estimate; they are not causes." />
    <Section title="Largest local contributions" subtitle={shap?.available ? `TreeExplainer · baseline ${shap.base_value} pts · estimate ${prediction?.prediction ?? "--"} pts` : "Waiting for a current SHAP calculation."}>
      {visible.length ? <><p className="explanation-lead">{leading.feature.replaceAll("_", " ")} has the largest absolute attribution for this estimate.</p><div className="shap-list">{visible.map((item) => <div className="shap-row" key={item.feature}><div className="shap-label"><b>{item.feature.replaceAll("_", " ")}</b><span>{item.value} {item.unit}</span></div><div className="shap-track"><i className={item.contribution >= 0 ? "positive" : "negative"} style={{ width: `${Math.max(1, Math.abs(item.contribution) / maxAbs * 48)}%`, left: item.contribution >= 0 ? "50%" : undefined, right: item.contribution < 0 ? "50%" : undefined }} /></div><strong className={item.contribution >= 0 ? "positive-text" : "negative-text"}>{item.contribution > 0 ? "+" : ""}{item.contribution.toFixed(3)}</strong></div>)}</div></> : <StateMessage>{shap?.reason || "SHAP values are not available."}</StateMessage>}
    </Section>
    <Section title="Global feature importance" subtitle="Impurity-based importance across the fitted forest; no direction or causal meaning.">
      {importance.length ? <div className="chart-area importance-chart"><Bar data={{ labels: importance.slice(0, 8).map(([name]) => name.replaceAll("_", " ")), datasets: [{ label: "Relative importance", data: importance.slice(0, 8).map(([, value]) => value * 100), backgroundColor: palette.cyan, borderRadius: 2, barThickness: 11 }] }} options={{ ...chartOptions, indexAxis: "y", plugins: { ...chartOptions.plugins, legend: { display: false } } }} /></div> : <StateMessage>Model importance is unavailable.</StateMessage>}
      <details className="method-details"><summary>Interpretation notes</summary><p>Positive contributions raise the estimate relative to the model baseline; negative contributions lower it. SHAP describes the fitted model output, not correlation or causation. Correlated sensors and the formula-derived target limit interpretation.</p></details>
    </Section>
  </div>;
}

export function AdvisorPage() {
  const { params, dataSource } = useAirMind();
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const prompts = ["What is my current CO2 reading?", "What should I do about the current readings?"];
  const send = async (text = question) => {
    const clean = text.trim();
    if (!clean || busy) return;
    const history = messages.slice(-8).map((message) => ({ role: message.role, content: message.text }));
    setQuestion(""); setError(""); setMessages((current) => [...current, { role: "user", text: clean }]); setBusy(true);
    try {
      const answer = await postJSON("/advisor", { params: { ...params, data_source: dataSource }, question: clean, history });
      setMessages((current) => [...current, { role: "assistant", text: answer.answer, provider: answer.provider }]);
    } catch (requestError) {
      setMessages((current) => current.at(-1)?.role === "user" && current.at(-1)?.text === clean ? current.slice(0, -1) : current);
      setQuestion(clean); setError(requestError.message);
    } finally { setBusy(false); }
  };
  return <div className="page-stack">
    <PageTitle eyebrow="ASK AIRMIND" title="AI Advisor" summary="A conversational guide to this project and the selected environmental readings." />
    <section className="panel advisor-panel"><div className="chat-window" aria-live="polite">{!messages.length && <div className="chat-empty"><Wind size={23} /><p>Hi. Ask about AirMind AI, a sensor reading, or an action to consider.</p></div>}{messages.map((message, index) => <div className={`chat-message ${message.role}`} key={`${message.role}-${index}`}><div>{message.text}{message.provider && <small className="provider-label">{message.provider === "openai" ? "OpenAI response" : "Rule-based response"}</small>}</div></div>)}{busy && <div className="chat-message assistant"><div className="typing-dots" role="status">Thinking...</div></div>}</div>
      {!messages.length && <div className="suggestion-row">{prompts.map((prompt) => <button className="suggestion-chip" key={prompt} onClick={() => send(prompt)}>{prompt}</button>)}</div>}
      {error && <div className="state-message danger" role="alert">{error}<button className="inline-button" onClick={() => send()}>Retry</button></div>}
      <form className="chat-form" onSubmit={(event) => { event.preventDefault(); send(); }}><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask a question..." maxLength={1200} aria-label="Ask AirMind AI" /><button className="button primary" disabled={busy || !question.trim()}><Send size={15} /> Send</button></form>
    </section>
  </div>;
}