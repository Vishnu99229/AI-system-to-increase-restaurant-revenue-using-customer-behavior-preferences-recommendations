"""
Usage:
    cd ml/
    python scripts/recommend.py --cafe-slug synthetic-bangalore-cafe

Generates today's purchase recommendations using the trained DQN agent
and LSTM demand predictions. Writes to purchase_recommendations and
inventory_alerts.

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
    parser = argparse.ArgumentParser(description="Generate Orlena purchase recommendations.")
    parser.add_argument("--cafe-slug", default=SYNTHETIC_CAFE_SLUG)
    parser.add_argument("--model-path", default=None)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    from models.purchase_optimizer import PurchaseOptimizer

    optimizer = PurchaseOptimizer.load(args.cafe_slug, DB_CONFIG, model_path=args.model_path)
    optimizer.recommend()


if __name__ == "__main__":
    main()
