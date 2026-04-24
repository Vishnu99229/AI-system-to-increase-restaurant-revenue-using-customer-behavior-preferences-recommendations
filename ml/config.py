import os

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": int(os.getenv("DB_PORT", 5432)),
    "database": os.getenv("DB_NAME", "orlena"),
    "user": os.getenv("DB_USER", "orlena_user"),
    "password": os.getenv("DB_PASSWORD", ""),
}

# Synthetic data parameters
SYNTHETIC_CAFE_SLUG = "synthetic-bangalore-cafe"
SYNTHETIC_DAYS = 180
START_DATE = "2025-10-01"

DEFAULT_TABLE_COUNT = 15
RANDOM_SEED = 42
