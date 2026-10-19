import tempfile
import unittest
from pathlib import Path

import pandas as pd

from ml_pipeline import (
    COLUMN_MAP,
    FEATURES,
    calculate_indoor_proxy,
    prepare_dataset,
    temporal_split,
)


class IndoorProxyTests(unittest.TestCase):
    def test_proxy_matches_original_formula_at_breakpoints(self):
        self.assertEqual(calculate_indoor_proxy(12, 400, 50, 0.1), 50.0)
        self.assertEqual(calculate_indoor_proxy(35.4, 400, 50, 0.1), 100.0)
        self.assertEqual(calculate_indoor_proxy(55.4, 400, 50, 0.1), 150.0)

    def test_highest_pollutant_subindex_is_returned(self):
        self.assertEqual(calculate_indoor_proxy(5, 1000, 500, 0.1), 150.0)


class DatasetPreparationTests(unittest.TestCase):
    def test_missing_target_inputs_are_dropped_but_other_features_retained(self):
        rows = []
        for index in range(4):
            row = {
                "Timestamp": f"18-02-2024 08:{index * 5:02d}",
                "Temperature (?C)": 23,
                "Humidity (%)": None if index == 0 else 50,
                "CO2 (ppm)": 700,
                "PM2.5 (?g/m?)": 20,
                "PM10 (?g/m?)": 40,
                "TVOC (ppb)": 200,
                "CO (ppm)": 1,
                "Light Intensity (lux)": 500,
                "Motion Detected": 1,
                "Occupancy Count": 2,
                "Ventilation Status": "Closed",
            }
            if index == 3:
                row["PM2.5 (?g/m?)"] = None
            rows.append(row)

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "data.csv"
            pd.DataFrame(rows).to_csv(path, index=False)
            features, target, timestamps = prepare_dataset(path)

        self.assertEqual(list(features.columns), FEATURES)
        self.assertEqual(len(features), 3)
        self.assertEqual(len(target), 3)
        self.assertTrue(pd.isna(features.iloc[0]["humidity"]))
        self.assertTrue(timestamps.is_monotonic_increasing)

    def test_split_keeps_later_rows_out_of_training(self):
        features = pd.DataFrame({"value": range(10)})
        target = pd.Series(range(10))
        timestamps = pd.Series(pd.date_range("2024-01-01", periods=10, freq="5min"))
        x_train, x_test, _, _, train_times, test_times = temporal_split(
            features, target, timestamps
        )
        self.assertEqual(len(x_train), 8)
        self.assertEqual(len(x_test), 2)
        self.assertLess(train_times.max(), test_times.min())


if __name__ == "__main__":
    unittest.main()