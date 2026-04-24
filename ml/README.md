# Orlena ML

This directory contains the data generation and future model training code for Orlena's restaurant intelligence layer.

The ML system will eventually power:

- Demand forecasting for menu items using historical sales, weather, events, and seasonality.
- Purchase optimization for ingredients using inventory levels, waste, supplier constraints, and predicted demand.

## Synthetic Data Generator

The first deliverable is a Bangalore-specific synthetic data generator. It creates a realistic independent cafe dataset for 6 months of operation, including:

- Restaurant and menu setup.
- Ingredients and recipe mappings.
- Customer orders and normalized `order_items`.
- Inventory snapshots.
- Waste logs.
- Bangalore calendar, weather, payday, college, IT quarter-end, weekend, and time-of-day effects.

## Setup

```bash
cd ml
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
cd ml
python scripts/generate_synthetic.py --days 180 --start-date 2025-10-01
```

Environment variables:

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

For a Render PostgreSQL database, copy these values from the Render dashboard. For local development, the defaults point to `localhost:5432/orlena`.

## Tables Written

The generator writes to:

- `restaurants`
- `menus`
- `ingredients`
- `recipe_ingredients`
- `orders`
- `order_items`
- `inventory_snapshots`
- `waste_log`

It also ensures `inventory_snapshots` exists before generation because older databases may not have that table yet.

## Idempotency

Running the generator twice with the same `cafe_slug` deletes previously generated synthetic data for that cafe, then regenerates fresh data. This keeps training runs repeatable.

## Switching To Real Data

The future model pipeline will use the same table shapes. To train on real cafe data instead of synthetic data, point feature engineering at the real cafe's domain/cafe slug and skip the synthetic generator.
