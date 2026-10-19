import unittest

from fastapi.testclient import TestClient

from api import app


PARAMS = {
    "temperature": 23,
    "humidity": 50,
    "co2": 700,
    "pm25": 35,
    "pm10": 50,
    "tvoc": 250,
    "co": 2.5,
    "light": 500,
    "motion": 1,
    "occupancy": 25,
    "ventilation_enc": 0,
    "hour": 12,
    "day_of_week": 1,
    "is_working_hours": 1,
}


class ApiIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_health_identifies_random_forest(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["model_loaded"])
        self.assertEqual(response.json()["model_name"], "Random Forest")

    def test_prediction_includes_proxy_and_additive_shap(self):
        response = self.client.post("/predict", json=PARAMS)
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["target_name"], "custom_indoor_air_quality_proxy")
        self.assertIsNone(result["regulatory_aqi"])
        self.assertTrue(result["shap"]["available"])
        self.assertLess(abs(result["shap"]["sum_check"] - result["prediction"]), 0.01)

    def test_invalid_sensor_values_are_rejected(self):
        response = self.client.post("/predict", json={**PARAMS, "co": 1001})
        self.assertEqual(response.status_code, 422)

    def test_scenarios_are_not_physical_actions_or_forecasts(self):
        response = self.client.post("/optimize", json=PARAMS)
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertFalse(result["hardware_connected"])
        self.assertEqual(result["mode"], "hypothetical_scenario_simulation")
        self.assertTrue(all("assumptions" in scenario for scenario in result["scenarios"]))

    def test_historical_records_are_labeled(self):
        response = self.client.get("/records?limit=2")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data_source"], "historical_dataset")
        self.assertEqual(len(response.json()["records"]), 2)

    def test_advisor_returns_provider_and_answer(self):
        response = self.client.post("/advisor", json={"params": PARAMS, "question": "Explain the reading"})
        self.assertEqual(response.status_code, 200)
        self.assertIn(response.json()["provider"], {"openai", "rule_based"})
        self.assertTrue(response.json()["answer"])

    def test_advisor_greeting_does_not_trigger_sensor_report(self):
        result = self.client.post("/advisor", json={"params": PARAMS, "question": "hi"}).json()
        self.assertEqual(result["intent"], "greeting")
        self.assertNotIn("99.15", result["answer"])

    def test_advisor_explains_project_without_sensor_dump(self):
        result = self.client.post("/advisor", json={"params": PARAMS, "question": "What is AirMind AI?"}).json()
        self.assertEqual(result["intent"], "project_info")
        self.assertIn("Random Forest", result["answer"])
        self.assertNotIn("700 ppm", result["answer"])

    def test_advisor_returns_only_requested_sensor_reading(self):
        result = self.client.post("/advisor", json={"params": PARAMS, "question": "What is my current CO2 reading?"}).json()
        self.assertEqual(result["intent"], "sensor_reading")
        self.assertIn("700 ppm", result["answer"])
        self.assertNotIn("PM2.5", result["answer"])

    def test_advisor_recommendation_uses_current_rules(self):
        result = self.client.post("/advisor", json={"params": PARAMS, "question": "What should I do about the current readings?"}).json()
        self.assertEqual(result["intent"], "recommendation")
        self.assertEqual(result["recommendation"]["condition"], "pm25")

    def test_advisor_follow_up_uses_prior_sensor_topic(self):
        history = [
            {"role": "user", "content": "What is my current CO2 reading?"},
            {"role": "assistant", "content": "Your CO2 reading is 700 ppm."},
        ]
        result = self.client.post("/advisor", json={"params": PARAMS, "question": "Is that high?", "history": history}).json()
        self.assertEqual(result["intent"], "sensor_follow_up")
        self.assertIn("below", result["answer"])
        self.assertIn("800 ppm", result["answer"])

    def test_unrelated_advisor_question_does_not_add_sensor_numbers(self):
        result = self.client.post("/advisor", json={"params": PARAMS, "question": "Tell me a joke"}).json()
        self.assertEqual(result["intent"], "general")
        self.assertNotIn("99.15", result["answer"])
        self.assertNotIn("700 ppm", result["answer"])

    def test_pdf_is_generated_from_validated_inputs(self):
        response = self.client.post("/reports/pdf", json={"params": PARAMS, "data_source": "simulated"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "application/pdf")
        self.assertTrue(response.content.startswith(b"%PDF"))


if __name__ == "__main__":
    unittest.main()