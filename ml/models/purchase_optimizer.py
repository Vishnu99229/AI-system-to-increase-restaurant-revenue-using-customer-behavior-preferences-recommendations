from __future__ import annotations

import random
import sys
from collections import defaultdict, deque
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import psycopg2
import torch
import torch.nn as nn


ML_ROOT = Path(__file__).resolve().parents[1]
if str(ML_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_ROOT))

from training.restaurant_simulator import optimizer_bucket


SAVED_MODELS_DIR = ML_ROOT / "saved_models"
ACTION_SIZE = 5


class QNetwork(nn.Module):
    """Neural network that approximates Q-values for each purchase action."""

    def __init__(self, state_size: int, action_size: int = ACTION_SIZE, hidden_size: int = 128):
        super().__init__()
        self.network = nn.Sequential(
            nn.Linear(state_size, hidden_size),
            nn.ReLU(),
            nn.Linear(hidden_size, hidden_size),
            nn.ReLU(),
            nn.Linear(hidden_size, action_size),
        )

    def forward(self, state: torch.Tensor) -> torch.Tensor:
        return self.network(state)


class DQNAgent:
    def __init__(
        self,
        state_size: int,
        action_size: int = ACTION_SIZE,
        learning_rate: float = 0.001,
        gamma: float = 0.95,
        epsilon_start: float = 1.0,
        epsilon_end: float = 0.05,
        epsilon_decay: float = 0.995,
        buffer_size: int = 10000,
        batch_size: int = 64,
    ):
        self.state_size = state_size
        self.action_size = action_size
        self.gamma = gamma
        self.epsilon = epsilon_start
        self.epsilon_end = epsilon_end
        self.epsilon_decay = epsilon_decay
        self.batch_size = batch_size
        self.policy_net = QNetwork(state_size, action_size)
        self.target_net = QNetwork(state_size, action_size)
        self.target_net.load_state_dict(self.policy_net.state_dict())
        self.optimizer = torch.optim.Adam(self.policy_net.parameters(), lr=learning_rate)
        self.memory: deque[tuple[np.ndarray, int, float, np.ndarray, bool]] = deque(maxlen=buffer_size)

    def select_action(self, state: np.ndarray | list[float]) -> int:
        if random.random() < self.epsilon:
            return random.randrange(self.action_size)
        with torch.no_grad():
            state_tensor = torch.tensor(np.asarray(state, dtype=np.float32)).unsqueeze(0)
            q_values = self.policy_net(state_tensor)
            return int(q_values.argmax(dim=1).item())

    def store_transition(self, state: np.ndarray | list[float], action: int, reward: float, next_state: np.ndarray | list[float], done: bool) -> None:
        self.memory.append(
            (
                np.asarray(state, dtype=np.float32),
                int(action),
                float(reward),
                np.asarray(next_state, dtype=np.float32),
                bool(done),
            )
        )

    def train_step(self) -> float | None:
        if len(self.memory) < self.batch_size:
            return None

        batch = random.sample(self.memory, self.batch_size)
        states, actions, rewards, next_states, dones = zip(*batch)
        states_tensor = torch.tensor(np.array(states), dtype=torch.float32)
        actions_tensor = torch.tensor(actions, dtype=torch.long).unsqueeze(1)
        rewards_tensor = torch.tensor(rewards, dtype=torch.float32)
        next_states_tensor = torch.tensor(np.array(next_states), dtype=torch.float32)
        dones_tensor = torch.tensor(dones, dtype=torch.float32)

        current_q = self.policy_net(states_tensor).gather(1, actions_tensor).squeeze()
        with torch.no_grad():
            next_q = self.target_net(next_states_tensor).max(dim=1)[0]
            target_q = rewards_tensor + (1 - dones_tensor) * self.gamma * next_q

        loss = nn.MSELoss()(current_q, target_q)
        self.optimizer.zero_grad()
        loss.backward()
        self.optimizer.step()
        return float(loss.item())

    def update_target_network(self) -> None:
        self.target_net.load_state_dict(self.policy_net.state_dict())

    def decay_epsilon(self) -> None:
        self.epsilon = max(self.epsilon_end, self.epsilon * self.epsilon_decay)

    def state_dict(self) -> dict[str, Any]:
        return {
            "state_size": self.state_size,
            "action_size": self.action_size,
            "epsilon": self.epsilon,
            "policy_state": self.policy_net.state_dict(),
            "target_state": self.target_net.state_dict(),
        }

    @classmethod
    def from_state_dict(cls, payload: dict[str, Any]) -> "DQNAgent":
        agent = cls(state_size=int(payload["state_size"]), action_size=int(payload.get("action_size", ACTION_SIZE)), epsilon_start=float(payload.get("epsilon", 0.05)))
        agent.policy_net.load_state_dict(payload["policy_state"])
        agent.target_net.load_state_dict(payload.get("target_state", payload["policy_state"]))
        agent.epsilon = float(payload.get("epsilon", 0.05))
        return agent


class PurchaseOptimizer:
    def __init__(self, cafe_slug: str, db_config: dict[str, Any], agents: dict[str, DQNAgent] | None = None, metadata: dict[str, Any] | None = None):
        self.cafe_slug = cafe_slug
        self.db_config = db_config
        self.agents = agents or {}
        self.metadata = metadata or {}

    @staticmethod
    def artifact_path(cafe_slug: str) -> Path:
        safe_slug = cafe_slug.replace("/", "_")
        return SAVED_MODELS_DIR / f"dqn_purchase_{safe_slug}.pt"

    def save(self, metadata: dict[str, Any] | None = None) -> Path:
        SAVED_MODELS_DIR.mkdir(parents=True, exist_ok=True)
        if metadata:
            self.metadata.update(metadata)
        path = self.artifact_path(self.cafe_slug)
        torch.save(
            {
                "cafe_slug": self.cafe_slug,
                "metadata": self.metadata,
                "agents": {bucket: agent.state_dict() for bucket, agent in self.agents.items()},
            },
            path,
        )
        return path

    @classmethod
    def load(cls, cafe_slug: str, db_config: dict[str, Any], model_path: str | None = None) -> "PurchaseOptimizer":
        path = Path(model_path) if model_path else cls.artifact_path(cafe_slug)
        payload = torch.load(path, map_location="cpu")
        agents = {bucket: DQNAgent.from_state_dict(agent_state) for bucket, agent_state in payload["agents"].items()}
        for agent in agents.values():
            agent.epsilon = 0.0
        return cls(cafe_slug=cafe_slug, db_config=db_config, agents=agents, metadata=payload.get("metadata", {}))

    def recommend(self) -> dict[str, Any]:
        data = load_recommendation_data(self.cafe_slug, self.db_config)
        recommendations: list[dict[str, Any]] = []
        alerts: list[dict[str, Any]] = []
        today = date.today()

        for ingredient_id, ingredient in data["ingredients"].items():
            bucket = ingredient["bucket"]
            state = build_live_ingredient_state(ingredient_id, ingredient, data)
            agent = self.agents.get(bucket)
            action = agent.select_action(state) if agent else heuristic_action(state)
            quantity = action_to_recommendation_quantity(action, ingredient_id, ingredient, data)
            current_stock = data["current_stock"].get(ingredient_id, 0.0)
            demand_3d = data["ingredient_demand_3d"].get(ingredient_id, 0.0)
            avg_daily_usage = max(data["avg_daily_usage"].get(ingredient_id, 0.0), 0.01)
            days_left = current_stock / avg_daily_usage
            nearest_expiry_days = data["days_until_expiry"].get(ingredient_id, 999.0)

            if quantity > 0:
                urgency = "URGENT" if days_left < 1.5 else "RECOMMENDED"
                recommendations.append(
                    {
                        "ingredient_id": ingredient_id,
                        "ingredient_name": ingredient["name"],
                        "unit": ingredient["unit"],
                        "bucket": bucket,
                        "urgency": urgency,
                        "current_stock": round(current_stock, 1),
                        "days_left": round(days_left, 1),
                        "recommended_quantity": round(quantity, 1),
                        "estimated_cost": round(quantity * ingredient["cost_per_unit"], 2),
                        "reason": f"Predicted demand: {round(demand_3d, 1)} {ingredient['unit']} over 3 days",
                    }
                )

            if nearest_expiry_days <= 1.0 and current_stock > 0 and ingredient["is_perishable"]:
                alerts.append(
                    {
                        "ingredient_id": ingredient_id,
                        "ingredient_name": ingredient["name"],
                        "current_stock": round(current_stock, 1),
                        "days_until_expiry": round(nearest_expiry_days, 1),
                        "message": f"{ingredient['name']} is expiring soon; push menu items that use it.",
                        "menu_items_to_push": data["menu_items_by_ingredient"].get(ingredient_id, []),
                    }
                )

        write_purchase_recommendations(self.cafe_slug, self.db_config, today, recommendations)
        write_inventory_alerts(self.cafe_slug, self.db_config, today, alerts)
        print_recommendations(self.cafe_slug, today, recommendations, alerts, data)
        return {"recommendations": recommendations, "alerts": alerts}


def load_recommendation_data(cafe_slug: str, db_config: dict[str, Any]) -> dict[str, Any]:
    conn = psycopg2.connect(**db_config)
    try:
        ingredients_df = pd.read_sql_query(
            """
            SELECT id, name, category, unit, cost_per_unit, shelf_life_hours, storage_type, min_order_quantity
            FROM ingredients
            WHERE cafe_slug = %s AND is_active = true
            ORDER BY name
            """,
            conn,
            params=(cafe_slug,),
        )
        inventory_df = pd.read_sql_query(
            """
            SELECT DISTINCT ON (ingredient_id)
                ingredient_id, quantity_on_hand, recorded_at
            FROM inventory_snapshots
            WHERE cafe_slug = %s
            ORDER BY ingredient_id, recorded_at DESC
            """,
            conn,
            params=(cafe_slug,),
        )
        forecasts_df = pd.read_sql_query(
            """
            SELECT menu_item_id, forecast_date, predicted_quantity
            FROM demand_forecasts
            WHERE cafe_slug = %s AND forecast_date >= CURRENT_DATE
            ORDER BY forecast_date
            """,
            conn,
            params=(cafe_slug,),
        )
        recipes_df = pd.read_sql_query(
            """
            SELECT ri.menu_item_id, ri.ingredient_id, ri.quantity_used
            FROM recipe_ingredients ri
            WHERE ri.ingredient_id IN (
                SELECT id FROM ingredients WHERE cafe_slug = %s AND is_active = true
            )
            """,
            conn,
            params=(cafe_slug,),
        )
        usage_df = pd.read_sql_query(
            """
            WITH sales AS (
                SELECT DATE(o.created_at) AS sale_date, oi.menu_item_id, SUM(oi.quantity)::float AS units_sold
                FROM order_items oi
                JOIN orders o ON o.id = oi.order_id
                JOIN restaurants r ON r.id = o.restaurant_id
                WHERE r.domain = %s
                GROUP BY DATE(o.created_at), oi.menu_item_id
            ),
            daily_usage AS (
                SELECT
                    ri.ingredient_id,
                    sales.sale_date,
                    SUM(sales.units_sold * ri.quantity_used)::float AS quantity_used
                FROM sales
                JOIN recipe_ingredients ri ON ri.menu_item_id = sales.menu_item_id
                GROUP BY ri.ingredient_id, sales.sale_date
            )
            SELECT ingredient_id, AVG(quantity_used)::float AS avg_daily_usage
            FROM daily_usage
            GROUP BY ingredient_id
            """,
            conn,
            params=(cafe_slug,),
        )
    finally:
        conn.close()

    ingredients = {
        str(row.id): {
            "id": str(row.id),
            "name": str(row.name),
            "category": str(row.category),
            "bucket": optimizer_bucket(str(row.category)),
            "unit": str(row.unit),
            "cost_per_unit": float(row.cost_per_unit),
            "shelf_life_hours": float(row.shelf_life_hours or 720),
            "min_order_quantity": float(row.min_order_quantity or 1.0),
            "is_perishable": float(row.shelf_life_hours or 720) < 120,
        }
        for row in ingredients_df.itertuples(index=False)
    }
    current_stock = {str(row.ingredient_id): float(row.quantity_on_hand or 0) for row in inventory_df.itertuples(index=False)}
    avg_daily_usage = {str(row.ingredient_id): float(row.avg_daily_usage or 0) for row in usage_df.itertuples(index=False)}
    menu_items_by_ingredient: dict[str, list[int]] = defaultdict(list)
    recipes_by_menu: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in recipes_df.itertuples(index=False):
        ingredient_id = str(row.ingredient_id)
        menu_item_id = int(row.menu_item_id)
        menu_items_by_ingredient[ingredient_id].append(menu_item_id)
        recipes_by_menu[menu_item_id].append({"ingredient_id": ingredient_id, "quantity_used": float(row.quantity_used)})

    ingredient_demand_by_horizon = {3: defaultdict(float), 5: defaultdict(float), 7: defaultdict(float)}
    if forecasts_df.empty:
        for ingredient_id, usage in avg_daily_usage.items():
            for horizon in ingredient_demand_by_horizon:
                ingredient_demand_by_horizon[horizon][ingredient_id] = usage * horizon
    else:
        forecasts_df["forecast_date"] = pd.to_datetime(forecasts_df["forecast_date"]).dt.date
        start_date = forecasts_df["forecast_date"].min()
        for row in forecasts_df.itertuples(index=False):
            days_ahead = (row.forecast_date - start_date).days + 1
            for recipe_row in recipes_by_menu.get(int(row.menu_item_id), []):
                for horizon in ingredient_demand_by_horizon:
                    if days_ahead <= horizon:
                        ingredient_demand_by_horizon[horizon][recipe_row["ingredient_id"]] += float(row.predicted_quantity) * recipe_row["quantity_used"]

    max_cost = max((ingredient["cost_per_unit"] for ingredient in ingredients.values()), default=1.0)
    return {
        "ingredients": ingredients,
        "current_stock": current_stock,
        "avg_daily_usage": avg_daily_usage,
        "ingredient_demand_3d": dict(ingredient_demand_by_horizon[3]),
        "ingredient_demand_5d": dict(ingredient_demand_by_horizon[5]),
        "ingredient_demand_7d": dict(ingredient_demand_by_horizon[7]),
        "menu_items_by_ingredient": dict(menu_items_by_ingredient),
        "days_until_expiry": {ingredient_id: estimate_days_until_expiry(ingredient) for ingredient_id, ingredient in ingredients.items()},
        "max_cost_per_unit": max_cost,
    }


def build_live_ingredient_state(ingredient_id: str, ingredient: dict[str, Any], data: dict[str, Any]) -> np.ndarray:
    avg_usage = max(data["avg_daily_usage"].get(ingredient_id, 0.0), 0.01)
    current_stock = data["current_stock"].get(ingredient_id, 0.0)
    demand_3d = data["ingredient_demand_3d"].get(ingredient_id, avg_usage * 3)
    days_until_expiry = data["days_until_expiry"].get(ingredient_id, 999.0)
    shelf_life_days = max(1.0, ingredient["shelf_life_hours"] / 24.0)
    return np.array(
        [
            min(current_stock / (avg_usage * 7.0), 2.0) / 2.0,
            min(max(days_until_expiry / shelf_life_days, 0.0), 1.0),
            min(demand_3d / (avg_usage * 3.0), 2.0) / 2.0,
            min(ingredient["cost_per_unit"] / data["max_cost_per_unit"], 1.0),
            1.0 if ingredient["is_perishable"] else 0.0,
        ],
        dtype=np.float32,
    )


def action_to_recommendation_quantity(action: int, ingredient_id: str, ingredient: dict[str, Any], data: dict[str, Any]) -> float:
    if action == 0:
        return 0.0
    if action == 1:
        return round(float(ingredient["min_order_quantity"]), 1)
    horizon_map = {2: 3, 3: 5, 4: 7}
    demand_key = f"ingredient_demand_{horizon_map.get(action, 3)}d"
    demand = float(data[demand_key].get(ingredient_id, data["avg_daily_usage"].get(ingredient_id, 0.0) * horizon_map.get(action, 3)))
    current_stock = float(data["current_stock"].get(ingredient_id, 0.0))
    needed = max(0.0, demand - current_stock)
    return round(max(needed, float(ingredient["min_order_quantity"]) if needed > 0 else 0.0), 1)


def heuristic_action(state: np.ndarray) -> int:
    stock_score = float(state[0])
    demand_pressure = float(state[2])
    if stock_score < 0.20:
        return 3
    if demand_pressure > 0.80:
        return 2
    return 0


def estimate_days_until_expiry(ingredient: dict[str, Any]) -> float:
    return max(1.0, float(ingredient["shelf_life_hours"]) / 24.0)


def write_purchase_recommendations(cafe_slug: str, db_config: dict[str, Any], recommendation_date: date, recommendations: list[dict[str, Any]]) -> None:
    conn = psycopg2.connect(**db_config)
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM purchase_recommendations WHERE cafe_slug = %s AND recommendation_date = %s AND status = %s", (cafe_slug, recommendation_date, "pending"))
            for rec in recommendations:
                cur.execute(
                    """
                    INSERT INTO purchase_recommendations (
                        cafe_slug, ingredient_id, recommendation_date, recommended_quantity,
                        estimated_cost, reason, status
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        cafe_slug,
                        rec["ingredient_id"],
                        recommendation_date,
                        round(rec["recommended_quantity"], 1),
                        round(rec["estimated_cost"], 2),
                        rec["reason"],
                        "pending",
                    ),
                )
        conn.commit()
    finally:
        conn.close()


def write_inventory_alerts(cafe_slug: str, db_config: dict[str, Any], alert_date: date, alerts: list[dict[str, Any]]) -> None:
    conn = psycopg2.connect(**db_config)
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM inventory_alerts WHERE cafe_slug = %s AND alert_date = %s AND resolved = false", (cafe_slug, alert_date))
            for alert in alerts:
                cur.execute(
                    """
                    INSERT INTO inventory_alerts (
                        cafe_slug, ingredient_id, alert_type, alert_date, message, menu_items_to_push
                    )
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        cafe_slug,
                        alert["ingredient_id"],
                        "expiring_soon",
                        alert_date,
                        alert["message"],
                        alert["menu_items_to_push"],
                    ),
                )
        conn.commit()
    finally:
        conn.close()


def print_recommendations(cafe_slug: str, recommendation_date: date, recommendations: list[dict[str, Any]], alerts: list[dict[str, Any]], data: dict[str, Any]) -> None:
    print(f"\n=== Purchase Recommendations for {recommendation_date} ===")
    print(f"Cafe: {cafe_slug}")
    print("Based on: LSTM demand forecast + current inventory + shelf life")

    for title, urgency in (("URGENT (order today)", "URGENT"), ("RECOMMENDED (order within 2 days)", "RECOMMENDED")):
        rows = [row for row in recommendations if row["urgency"] == urgency]
        print(f"\n{title}:")
        if not rows:
            print("None")
            continue
        print("Ingredient          | Current Stock | Days Left | Order Qty | Est. Cost | Reason")
        for row in rows:
            print(
                f"{row['ingredient_name'][:19]:19} | "
                f"{row['current_stock']:10.1f} {row['unit'][:3]:3} | "
                f"{row['days_left']:9.1f} | "
                f"{row['recommended_quantity']:8.1f} | "
                f"INR {row['estimated_cost']:7.2f} | {row['reason']}"
            )

    print("\nWASTE ALERT (use soon or promote on menu):")
    if not alerts:
        print("None")
    for alert in alerts:
        ingredient = data["ingredients"][alert["ingredient_id"]]
        print(
            f"{alert['ingredient_name'][:19]:19} | "
            f"{alert['current_stock']:8.1f} {ingredient['unit'][:3]:3} | "
            f"{alert['days_until_expiry']:4.1f} days | {alert['message']}"
        )

    total_cost = round(sum(row["estimated_cost"] for row in recommendations), 2)
    print("\nSummary:")
    print(f"Total recommended purchase cost: INR {total_cost}")
    print(f"Items flagged for Orlena front-of-house push: {len(alerts)}")
    print("Recommendations saved to purchase_recommendations table.")
