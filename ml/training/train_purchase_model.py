from __future__ import annotations

import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np


ML_ROOT = Path(__file__).resolve().parents[1]
if str(ML_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_ROOT))

from models.purchase_optimizer import DQNAgent, PurchaseOptimizer
from training.restaurant_simulator import RestaurantSimulator


@dataclass
class EpisodeStats:
    episode: int
    waste_cost: float
    stockouts: int
    reward: float
    purchase_cost: float
    holding_cost: float
    epsilon: float


def train_purchase_optimizer(cafe_slug: str, db_config: dict[str, Any], num_episodes: int = 200) -> dict[str, Any]:
    started_at = time.time()
    print(f"Loading restaurant simulator for cafe domain={cafe_slug}...")
    simulator = RestaurantSimulator(cafe_slug, db_config, start_day_index=28, end_day_index=159)

    agents = {
        bucket: DQNAgent(state_size=5, action_size=5, batch_size=64, epsilon_decay=0.985)
        for bucket in simulator.ingredient_ids_by_bucket
    }
    optimizer = PurchaseOptimizer(cafe_slug, db_config, agents=agents)
    history: list[EpisodeStats] = []

    print("Training DQN purchasing optimizer...")
    for episode in range(1, num_episodes + 1):
        simulator.reset()
        episode_reward = 0.0
        episode_waste = 0.0
        episode_stockouts = 0
        episode_purchase = 0.0
        episode_holding = 0.0
        losses: list[float] = []

        while simulator.has_next_day():
            current_day = simulator.current_date()
            transitions: list[tuple[str, str, np.ndarray, int]] = []
            actions_by_ingredient: dict[str, int] = {}

            for bucket, ingredient_ids in simulator.ingredient_ids_by_bucket.items():
                agent = agents[bucket]
                for ingredient_id in ingredient_ids:
                    state = np.array(simulator.get_ingredient_features(ingredient_id, current_day), dtype=np.float32)
                    action = agent.select_action(state)
                    actions_by_ingredient[ingredient_id] = action
                    transitions.append((bucket, ingredient_id, state, action))

            _, reward, done, day_result = simulator.step(actions_by_ingredient)

            for bucket, ingredient_id, state, action in transitions:
                agent = agents[bucket]
                if done:
                    next_state = np.zeros(5, dtype=np.float32)
                else:
                    next_state = np.array(simulator.get_ingredient_features(ingredient_id, simulator.current_date()), dtype=np.float32)
                agent.store_transition(state, action, reward, next_state, done)

            for agent in agents.values():
                loss = agent.train_step()
                if loss is not None:
                    losses.append(loss)

            episode_reward += reward
            episode_waste += day_result.waste_cost
            episode_stockouts += day_result.stockout_events
            episode_purchase += day_result.purchase_cost
            episode_holding += day_result.holding_cost

        for agent in agents.values():
            agent.decay_epsilon()
            if episode % 10 == 0:
                agent.update_target_network()

        epsilon = float(np.mean([agent.epsilon for agent in agents.values()]))
        stats = EpisodeStats(
            episode=episode,
            waste_cost=round(episode_waste, 2),
            stockouts=episode_stockouts,
            reward=round(episode_reward, 2),
            purchase_cost=round(episode_purchase, 2),
            holding_cost=round(episode_holding, 2),
            epsilon=epsilon,
        )
        history.append(stats)

        if episode == 1 or episode % 10 == 0 or episode == num_episodes:
            avg_loss = float(np.mean(losses)) if losses else 0.0
            print(
                f"Episode {episode:3d}/{num_episodes} | "
                f"Waste: INR {stats.waste_cost:8.2f} | "
                f"Stockouts: {stats.stockouts:3d} | "
                f"Reward: {stats.reward:10.2f} | "
                f"Epsilon: {stats.epsilon:.2f} | "
                f"Loss: {avg_loss:.4f}"
            )

    for agent in agents.values():
        agent.epsilon = 0.0

    test_stats = evaluate_optimizer(cafe_slug, db_config, agents)
    training_time = round(time.time() - started_at, 2)
    metadata = {
        "cafe_slug": cafe_slug,
        "episodes": num_episodes,
        "training_time_seconds": training_time,
        "buckets": {bucket: len(ids) for bucket, ids in simulator.ingredient_ids_by_bucket.items()},
        "first_episode": history[0].__dict__ if history else {},
        "last_episode": history[-1].__dict__ if history else {},
        "test_stats": test_stats,
    }
    model_path = optimizer.save(metadata)
    print_training_summary(cafe_slug, history, test_stats, training_time, model_path)
    return {"history": history, "test_stats": test_stats, "model_path": model_path, "metadata": metadata}


def evaluate_optimizer(cafe_slug: str, db_config: dict[str, Any], agents: dict[str, DQNAgent]) -> dict[str, Any]:
    simulator = RestaurantSimulator(cafe_slug, db_config, start_day_index=160, end_day_index=179, seed=99)
    simulator.reset()
    total_reward = 0.0
    total_waste = 0.0
    total_stockouts = 0
    total_purchase = 0.0
    total_holding = 0.0

    while simulator.has_next_day():
        current_day = simulator.current_date()
        actions_by_ingredient: dict[str, int] = {}
        for bucket, ingredient_ids in simulator.ingredient_ids_by_bucket.items():
            agent = agents[bucket]
            for ingredient_id in ingredient_ids:
                state = np.array(simulator.get_ingredient_features(ingredient_id, current_day), dtype=np.float32)
                actions_by_ingredient[ingredient_id] = agent.select_action(state)

        _, reward, _, day_result = simulator.step(actions_by_ingredient)
        total_reward += reward
        total_waste += day_result.waste_cost
        total_stockouts += day_result.stockout_events
        total_purchase += day_result.purchase_cost
        total_holding += day_result.holding_cost

    food_cost_pct = total_purchase / max(total_purchase + total_waste, 1.0)
    return {
        "total_waste_cost": round(total_waste, 2),
        "stockout_events": int(total_stockouts),
        "purchase_cost": round(total_purchase, 2),
        "holding_cost": round(total_holding, 2),
        "reward": round(total_reward, 2),
        "food_cost_pct": round(food_cost_pct * 100, 1),
    }


def print_training_summary(cafe_slug: str, history: list[EpisodeStats], test_stats: dict[str, Any], training_time: float, model_path: Path) -> None:
    first = history[0]
    last = history[-1]
    waste_improvement = improvement_pct(first.waste_cost, last.waste_cost, lower_is_better=True)
    stockout_improvement = improvement_pct(first.stockouts, last.stockouts, lower_is_better=True)
    reward_improvement = improvement_pct(abs(first.reward), abs(last.reward), lower_is_better=True)

    print("\n=== Q-Learning Purchase Optimizer Training Complete ===")
    print(f"Cafe: {cafe_slug}")
    print(f"Episodes: {len(history)}")
    print(f"Training time: {training_time:.1f} seconds")

    print("\n=== Performance Improvement ===")
    print("Metric              | Episode 1     | Final Episode | Improvement")
    print(f"Total waste cost    | INR {first.waste_cost:8.2f} | INR {last.waste_cost:8.2f} | {waste_improvement}")
    print(f"Stockout events     | {first.stockouts:13d} | {last.stockouts:13d} | {stockout_improvement}")
    print(f"Avg daily reward    | {first.reward:13.2f} | {last.reward:13.2f} | {reward_improvement}")

    print("\n=== Test Period Evaluation (Days 161-180) ===")
    print(f"Total waste cost:    INR {test_stats['total_waste_cost']}")
    print(f"Stockout events:     {test_stats['stockout_events']}")
    print(f"Food cost %:         {test_stats['food_cost_pct']}% (target: 28-35%)")
    print(f"Test reward:         {test_stats['reward']}")
    print(f"\nSaved model: {model_path}")


def improvement_pct(start: float, end: float, lower_is_better: bool) -> str:
    if start == 0:
        return "n/a"
    delta = ((start - end) / abs(start)) * 100 if lower_is_better else ((end - start) / abs(start)) * 100
    sign = "+" if delta >= 0 else ""
    return f"{sign}{delta:.1f}%"
