"""
Usage:
    cd ml/
    python scripts/train_purchase.py --cafe-slug synthetic-bangalore-cafe --episodes 200

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
    parser = argparse.ArgumentParser(description="Train Orlena DQN purchase optimizer.")
    parser.add_argument("--cafe-slug", default=SYNTHETIC_CAFE_SLUG)
    parser.add_argument("--episodes", type=int, default=200)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    from training.train_purchase_model import train_purchase_optimizer

    train_purchase_optimizer(args.cafe_slug, DB_CONFIG, num_episodes=args.episodes)


if __name__ == "__main__":
    main()
