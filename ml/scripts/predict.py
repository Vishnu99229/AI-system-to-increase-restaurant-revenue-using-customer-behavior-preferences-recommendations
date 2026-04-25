"""
Usage:
    cd ml/
    python scripts/predict.py --cafe-slug synthetic-bangalore-cafe

Loads the trained model, predicts tomorrow's demand, and writes rows to
the demand_forecasts table.

Environment variables:
    DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


ML_ROOT = Path(__file__).resolve().parents[1]
if str(ML_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_ROOT))

from config import DB_CONFIG, SYNTHETIC_CAFE_SLUG


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Predict next-day Orlena menu demand.")
    parser.add_argument("--cafe-slug", default=SYNTHETIC_CAFE_SLUG)
    parser.add_argument("--model-path", default=None)
    parser.add_argument("--scaler-path", default=None)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    from models.demand_forecast import predict_next_day

    predict_next_day(
        cafe_slug=args.cafe_slug,
        db_config=DB_CONFIG,
        model_path=args.model_path,
        scaler_path=args.scaler_path,
    )


if __name__ == "__main__":
    main()
