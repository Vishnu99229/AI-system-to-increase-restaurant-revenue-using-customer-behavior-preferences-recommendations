import os

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": int(os.getenv("DB_PORT", 5432)),
    "database": os.getenv("DB_NAME", "orlena"),
    "user": os.getenv("DB_USER", "orlena_user"),
    "password": os.getenv("DB_PASSWORD", ""),
}

# Synthetic data parameters
CITIES = {
    "bangalore": {
        "slug": "synthetic-bangalore-cafe",
        "name": "Brew & Bloom Cafe",
        "baseline_daily_orders": 100,
        "price_multiplier": 1.0,
        "timezone": "Asia/Kolkata",
    },
    "mumbai": {
        "slug": "synthetic-mumbai-cafe",
        "name": "Salt & Sip Cafe",
        "baseline_daily_orders": 120,
        "price_multiplier": 1.15,
        "timezone": "Asia/Kolkata",
    },
    "delhi": {
        "slug": "synthetic-delhi-cafe",
        "name": "The Chai Chapter",
        "baseline_daily_orders": 90,
        "price_multiplier": 1.05,
        "timezone": "Asia/Kolkata",
    },
}

SYNTHETIC_CAFE_SLUG = CITIES["bangalore"]["slug"]
SYNTHETIC_DAYS = 365
START_DATE = "2025-04-01"

DEFAULT_TABLE_COUNT = 15
RANDOM_SEED = 42
