import { createContext, useContext, useEffect, useState } from "react";
import { api, postJSON } from "./api.js";

const AppContext = createContext(null);

const initialParams = {
  temperature: 23,
  humidity: 50,
  co2: 700,
  pm25: 35,
  pm10: 50,
  tvoc: 250,
  co: 2.5,
  light: 500,
  motion: 1,
  occupancy: 25,
  ventilation_enc: 0,
  hour: new Date().getHours(),
  day_of_week: (new Date().getDay() + 6) % 7,
  is_working_hours: new Date().getHours() >= 8 && new Date().getHours() <= 18 ? 1 : 0,
};

export function AppProvider({ children }) {
  const [params, setParams] = useState(initialParams);
  const [dataSource, setDataSource] = useState("simulated");
  const [selectedTimestamp, setSelectedTimestamp] = useState(null);
  const [health, setHealth] = useState(null);
  const [dataset, setDataset] = useState(null);
  const [screeningThresholds, setScreeningThresholds] = useState(null);
  const [modelInfo, setModelInfo] = useState(null);
  const [historyRecords, setHistoryRecords] = useState([]);
  const [prediction, setPrediction] = useState(null);
  const [scenarios, setScenarios] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [selectedSensorId, setSelectedSensorId] = useState("co2");
  const [retryCount, setRetryCount] = useState(0);
  const [requestState, setRequestState] = useState("loading");
  const [error, setError] = useState("");

  const retry = () => setRetryCount((c) => c + 1);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const status = await api("/health");
        if (active) setHealth(status);
      } catch {
        if (active) setHealth({ status: "offline", model_loaded: false, mongodb: { available: false, message: "Backend is unavailable." } });
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 20000);
    Promise.all([api("/dataset-info"), api("/model-info")]).then(([datasetInfo, model]) => {
      if (!active) return;
      setDataset(datasetInfo);
      setModelInfo(model);
      const offset = Math.max(0, (datasetInfo?.rows || 1000) - 300);
      const firstDay = datasetInfo?.timestamp_start?.slice(0, 10);
      return Promise.all([
        api(`/records?limit=300&offset=${offset}`),
        firstDay ? api(`/analytics/summary?start=${firstDay}T00:00:00&end=${firstDay}T23:59:59`) : Promise.resolve(null),
      ]);
    }).then(([result, summary]) => {
      if (!active) return;
      if (result) setHistoryRecords(result.records || []);
      if (summary?.screening_thresholds) setScreeningThresholds(summary.screening_thresholds);
    }).catch((err) => {
      if (active) {
        setError(err.message || "Can't reach the AirMind backend.");
      }
    });
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [retryCount]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setRequestState("loading");
      setError("");
      const payload = { ...params, data_source: dataSource };
      try {
        const [result, options, forecastRes] = await Promise.all([
          postJSON("/predict", payload),
          postJSON("/optimize", payload),
          postJSON("/forecast", { params: payload, horizon_minutes: 120 }),
        ]);
        if (active) {
          setPrediction(result);
          setScenarios(options);
          setForecast(forecastRes);
          setRequestState("ready");
        }
      } catch (requestError) {
        if (active) {
          setError(requestError.message);
          setRequestState("error");
        }
      }
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [params, dataSource, retryCount]);

  const updateParam = (name, value) => {
    setDataSource("simulated");
    setSelectedTimestamp(null);
    setParams((current) => ({ ...current, [name]: value }));
  };

  const resetToInitial = () => {
    setParams(initialParams);
    setDataSource("simulated");
    setSelectedTimestamp(null);
  };

  const selectHistoricalRecord = (record) => {
    setParams((current) => ({
      ...current,
      ...Object.fromEntries(Object.keys(current).filter((key) => record[key] != null).map((key) => [key, record[key]])),
      day_of_week: record.timestamp ? (new Date(record.timestamp).getDay() + 6) % 7 : current.day_of_week,
      hour: record.timestamp ? new Date(record.timestamp).getHours() : current.hour,
      is_working_hours: record.timestamp && new Date(record.timestamp).getHours() >= 8 && new Date(record.timestamp).getHours() <= 18 ? 1 : 0,
    }));
    setDataSource("historical");
    setSelectedTimestamp(record.timestamp || null);
  };

  const loadRandomRecord = async () => {
    try {
      const rec = await api("/records/random");
      selectHistoricalRecord(rec);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <AppContext.Provider value={{
      params, setParams, updateParam, resetToInitial, dataSource, setDataSource, selectedTimestamp, setSelectedTimestamp,
      selectHistoricalRecord, loadRandomRecord,
      health, dataset, screeningThresholds, modelInfo, historyRecords, prediction, scenarios, forecast, requestState, error,
      selectedSensorId, setSelectedSensorId, retry,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAirMind() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useAirMind must be used inside AppProvider");
  return value;
}