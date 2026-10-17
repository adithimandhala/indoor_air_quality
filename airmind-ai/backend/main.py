from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List
import joblib, json, numpy as np, datetime
from pymongo import MongoClient
from openai import OpenAI
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="AirMind AI API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Load model artifacts ────────────────────────────────────────
model    = joblib.load("models/aqi_model.pkl")
scaler   = joblib.load("models/scaler.pkl")
FEATURES = json.load(open("models/feature_names.json"))
FI       = json.load(open("models/feature_importance.json"))
META     = json.load(open("models/model_meta.json"))

print(f"Model loaded — R²: {META['r2']}  MAE: {META['mae']}  trained on {META['rows_trained']} rows")

# ── MongoDB ─────────────────────────────────────────────────────
mongo = MongoClient(os.getenv("MONGO_URI", "mongodb://localhost:27017"))
db    = mongo["airmind"]

# ── OpenAI ──────────────────────────────────────────────────────
openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# ── AQI helpers ─────────────────────────────────────────────────
def aqi_label(v):
    if v <= 50:  return "Good"
    if v <= 100: return "Moderate"
    if v <= 150: return "Unhealthy for Sensitive Groups"
    if v <= 200: return "Unhealthy"
    return "Very Unhealthy"

def aqi_color(v):
    if v <= 50:  return "#22c55e"
    if v <= 100: return "#eab308"
    if v <= 150: return "#f97316"
    if v <= 200: return "#ef4444"
    return "#7c3aed"

# ── Pydantic schemas ────────────────────────────────────────────
class RoomParams(BaseModel):
    temperature:      float
    humidity:         float
    co2:              float
    pm25:             float
    pm10:             float
    tvoc:             float
    co:               float
    light:            float
    motion:           int
    occupancy:        int
    ventilation_enc:  int
    hour:             int
    day_of_week:      int
    is_working_hours: int

class AdvisorRequest(BaseModel):
    params:       RoomParams
    current_aqi:  float
    aqi_30min:    float
    shap_summary: str
    question:     str

class SessionSave(BaseModel):
    params:         dict
    current_aqi:    float
    peak_aqi:       float
    recommendation: str

# ── /predict ────────────────────────────────────────────────────
@app.post("/predict")
def predict(p: RoomParams):
    def predict_aqi(override={}):
        base = p.dict()
        base.update(override)
        X = np.array([[base[f] for f in FEATURES]])
        return round(float(model.predict(scaler.transform(X))[0]), 1)

    curr = predict_aqi()
    f15  = predict_aqi({"occupancy": min(49, p.occupancy + 2)})
    f30  = predict_aqi({"occupancy": min(49, p.occupancy + 4), "temperature": p.temperature + 0.5})
    f60  = predict_aqi({"occupancy": min(49, p.occupancy + 6), "temperature": p.temperature + 1.0, "hour": (p.hour + 1) % 24})
    f120 = predict_aqi({"occupancy": min(49, p.occupancy + 8), "temperature": p.temperature + 1.5, "hour": (p.hour + 2) % 24})

    severity_scores = {
        "PM2.5":       min(1.0, p.pm25 / 75)           * FI.get("pm25", 0),
        "CO":          min(1.0, (p.co - 0.1) / 4.9)    * FI.get("co", 0),
        "TVOC":        min(1.0, (p.tvoc - 50) / 450)   * FI.get("tvoc", 0),
        "CO2 Level":   min(1.0, (p.co2 - 400) / 600)   * FI.get("co2", 0),
        "Occupancy":   min(1.0, p.occupancy / 49)       * FI.get("occupancy", 0),
        "Temperature": min(1.0, (p.temperature-18)/10)  * FI.get("temperature", 0),
        "Ventilation": (1 - p.ventilation_enc) * 0.08,
        "Humidity":    abs(p.humidity - 50) / 50        * FI.get("humidity", 0),
    }
    total = sum(severity_scores.values()) or 1
    shap  = {k: round(v / total * 100, 1) for k, v in severity_scores.items()}

    return {
        "current_aqi": curr,
        "label":       aqi_label(curr),
        "color":       aqi_color(curr),
        "model_r2":    META["r2"],
        "forecast": [
            {"label": "Now",  "aqi": curr},
            {"label": "+15m", "aqi": f15},
            {"label": "+30m", "aqi": f30},
            {"label": "+60m", "aqi": f60},
            {"label": "+2hr", "aqi": f120},
        ],
        "shap": shap,
    }

# ── /optimize ───────────────────────────────────────────────────
@app.post("/optimize")
def optimize(p: RoomParams):
    def sim(override):
        d = p.dict(); d.update(override)
        X = np.array([[d[f] for f in FEATURES]])
        return round(float(model.predict(scaler.transform(X))[0]), 1)

    base_aqi = sim({})
    opts = [
        {
            "id": "open_windows",
            "icon": "wind",
            "name": "Open all windows",
            "description": "Maximise natural ventilation",
            "simulated_aqi": sim({"ventilation_enc": 1}),
        },
        {
            "id": "open_windows_fans",
            "icon": "air",
            "name": "Open windows + run fans",
            "description": "Combined forced + natural airflow",
            "simulated_aqi": sim({"ventilation_enc": 1, "co2": max(400, p.co2 * 0.75), "tvoc": max(50, p.tvoc * 0.8)}),
        },
        {
            "id": "reduce_occupancy",
            "icon": "users-minus",
            "name": "Reduce occupancy by 30%",
            "description": "Limit room capacity immediately",
            "simulated_aqi": sim({"occupancy": max(0, int(p.occupancy * 0.7))}),
        },
        {
            "id": "boost_ac",
            "icon": "snowflake",
            "name": "Boost AC + air filtration",
            "description": "Lower temp and filter particulates",
            "simulated_aqi": sim({"temperature": max(18, p.temperature - 3), "pm25": max(5, p.pm25 * 0.6)}),
        },
    ]

    for opt in opts:
        opt["improvement_pct"] = max(0, round((base_aqi - opt["simulated_aqi"]) / base_aqi * 100, 1))
        opt["base_aqi"] = base_aqi

    opts.sort(key=lambda x: -x["improvement_pct"])
    opts[0]["best"] = True
    for o in opts[1:]: o["best"] = False

    return {"options": opts}

# ── /advisor (streaming) ─────────────────────────────────────────
@app.post("/advisor")
def advisor(req: AdvisorRequest):
    system = (
        "You are AirMind AI's indoor air quality advisor. Be concise, specific, and data-driven. "
        "Always reference the exact sensor readings in your response. "
        "Format: 1 sentence on current state, 1 sentence on prediction, 1 clear action with expected % improvement. "
        "Maximum 4 sentences total."
    )
    p = req.params
    user_msg = (
        f"Room data — Temp: {p.temperature}°C, Humidity: {p.humidity}%, "
        f"CO2: {p.co2}ppm, PM2.5: {p.pm25}µg/m³, TVOC: {p.tvoc}ppb, CO: {p.co}ppm, "
        f"Occupancy: {p.occupancy}, Ventilation: {'Open' if p.ventilation_enc else 'Closed'}, "
        f"Hour: {p.hour}:00.\n"
        f"Current AQI: {req.current_aqi} ({aqi_label(req.current_aqi)}). "
        f"Predicted AQI in 30 min: {req.aqi_30min}.\n"
        f"Top factors: {req.shap_summary}.\n"
        f"User question: {req.question}"
    )

    def stream_response():
        try:
            if not os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY") == "your_openai_key_here":
                import time
                yield "I am currently in demo mode because no OpenAI API key was provided. "
                time.sleep(0.5)
                yield f"Your current AQI is {req.current_aqi}. "
                time.sleep(0.5)
                if p.co2 > 800:
                    yield "Your CO2 levels are a bit high, consider increasing ventilation. "
                else:
                    yield "The air quality parameters look mostly fine. "
                time.sleep(0.5)
                yield "Please add a valid OPENAI_API_KEY in backend/.env for real AI responses."
                return

            stream = openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user",   "content": user_msg}
                ],
                stream=True,
                max_tokens=300,
            )
            for chunk in stream:
                delta = chunk.choices[0].delta.content
                if delta:
                    yield delta
        except Exception as e:
            print(f"OpenAI Error: {e}")
            yield f"\n\n[API Error: {str(e)}]\nPlease ensure you have added a valid OPENAI_API_KEY to the backend/.env file."

    return StreamingResponse(stream_response(), media_type="text/plain")

# ── /session ────────────────────────────────────────────────────
@app.post("/session")
def save_session(s: SessionSave):
    doc = {**s.dict(), "timestamp": datetime.datetime.utcnow()}
    db.sessions.insert_one(doc)
    return {"status": "saved"}

@app.get("/sessions")
def get_sessions():
    docs = list(db.sessions.find({}, {"_id": 0}).sort("timestamp", -1).limit(10))
    return {"sessions": docs}

@app.get("/model-info")
def model_info():
    return META
