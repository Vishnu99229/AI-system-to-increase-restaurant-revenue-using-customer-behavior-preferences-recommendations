"""
Usage:
    cd ml/
    python scripts/train_model.py --cafe-slug synthetic-bangalore-cafe

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
    parser = argparse.ArgumentParser(description="Train Orlena LSTM demand forecasting model.")
    parser.add_argument("--cafe-slug", default=SYNTHETIC_CAFE_SLUG)
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--lookback", type=int, default=14)
    parser.add_argument("--batch-size", type=int, default=32)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    from training.train_demand_model import train

    train(
        cafe_slug=args.cafe_slug,
        db_config=DB_CONFIG,
        lookback_days=args.lookback,
        epochs=args.epochs,
        batch_size=args.batch_size,
    )


if __name__ == "__main__":
    main()
