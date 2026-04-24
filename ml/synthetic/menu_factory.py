from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np


@dataclass(frozen=True)
class IngredientSpec:
    name: str
    category: str
    unit: str
    cost_per_unit: float
    shelf_life_hours: int
    storage_type: str
    supplier_name: str
    min_order_quantity: float


@dataclass(frozen=True)
class MenuItemSpec:
    name: str
    description: str
    price: float
    category: str
    sub_category: str
    tags: list[str]
    popularity: float
    dayparts: list[str]
    weather_affinity: str


INGREDIENTS: list[IngredientSpec] = [
    IngredientSpec("Arabica Coffee Beans", "Beverages", "kg", 900, 720, "dry", "Blue Tokai Wholesale", 2),
    IngredientSpec("Chicory Blend Coffee", "Beverages", "kg", 420, 720, "dry", "Coorg Coffee Works", 2),
    IngredientSpec("Tea Leaves", "Beverages", "kg", 360, 720, "dry", "Nilgiri Tea Depot", 1),
    IngredientSpec("Masala Chai Mix", "Spices", "kg", 500, 720, "dry", "KR Market Spices", 1),
    IngredientSpec("Milk", "Dairy", "litre", 62, 48, "refrigerated", "Nandini Dairy", 20),
    IngredientSpec("Curd", "Dairy", "kg", 80, 72, "refrigerated", "Nandini Dairy", 5),
    IngredientSpec("Paneer", "Dairy", "kg", 340, 72, "refrigerated", "Nandini Dairy", 3),
    IngredientSpec("Cheese", "Dairy", "kg", 520, 168, "refrigerated", "Metro Cash & Carry", 2),
    IngredientSpec("Butter", "Dairy", "kg", 560, 240, "refrigerated", "Nandini Dairy", 2),
    IngredientSpec("Cream", "Dairy", "litre", 260, 96, "refrigerated", "Nandini Dairy", 2),
    IngredientSpec("Eggs", "Protein", "pieces", 7, 240, "refrigerated", "Hennur Poultry", 60),
    IngredientSpec("Chicken Breast", "Meat", "kg", 260, 48, "refrigerated", "Russell Market Meats", 5),
    IngredientSpec("Bacon", "Meat", "kg", 900, 168, "refrigerated", "Imported Foods BLR", 1),
    IngredientSpec("Sourdough Bread", "Bakery", "loaf", 95, 36, "dry", "Indiranagar Bakehouse", 10),
    IngredientSpec("Milk Bread", "Bakery", "loaf", 60, 48, "dry", "Local Bakery", 10),
    IngredientSpec("Croissant", "Bakery", "pieces", 45, 24, "dry", "Lavonne Wholesale", 20),
    IngredientSpec("Burger Bun", "Bakery", "pieces", 18, 48, "dry", "Local Bakery", 30),
    IngredientSpec("Pasta Penne", "Dry Goods", "kg", 180, 720, "dry", "Metro Cash & Carry", 5),
    IngredientSpec("Basmati Rice", "Dry Goods", "kg", 110, 720, "dry", "APMC Yard", 10),
    IngredientSpec("Quinoa", "Dry Goods", "kg", 520, 720, "dry", "Organic Mandya", 2),
    IngredientSpec("Rolled Oats", "Dry Goods", "kg", 220, 720, "dry", "Metro Cash & Carry", 3),
    IngredientSpec("All Purpose Flour", "Dry Goods", "kg", 48, 720, "dry", "APMC Yard", 10),
    IngredientSpec("Rice Flour", "Dry Goods", "kg", 60, 720, "dry", "APMC Yard", 5),
    IngredientSpec("Rava", "Dry Goods", "kg", 52, 720, "dry", "APMC Yard", 5),
    IngredientSpec("Sugar", "Dry Goods", "kg", 45, 720, "dry", "Avenue Road Traders", 10),
    IngredientSpec("Jaggery", "Dry Goods", "kg", 75, 720, "dry", "Organic Mandya", 3),
    IngredientSpec("Honey", "Dry Goods", "kg", 380, 720, "dry", "Coorg Naturals", 2),
    IngredientSpec("Chocolate Syrup", "Dry Goods", "litre", 240, 720, "dry", "Metro Cash & Carry", 2),
    IngredientSpec("Vanilla Syrup", "Dry Goods", "litre", 310, 720, "dry", "Metro Cash & Carry", 2),
    IngredientSpec("Caramel Syrup", "Dry Goods", "litre", 310, 720, "dry", "Metro Cash & Carry", 2),
    IngredientSpec("Cocoa Powder", "Dry Goods", "kg", 480, 720, "dry", "Avenue Road Traders", 1),
    IngredientSpec("Ice Cream", "Dairy", "kg", 240, 120, "frozen", "Nandini Dairy", 5),
    IngredientSpec("Ice Cubes", "Beverages", "kg", 18, 24, "frozen", "Ice Depot BLR", 20),
    IngredientSpec("Tomato", "Produce", "kg", 42, 72, "refrigerated", "KR Market Produce", 5),
    IngredientSpec("Onion", "Produce", "kg", 36, 168, "dry", "KR Market Produce", 10),
    IngredientSpec("Potato", "Produce", "kg", 32, 240, "dry", "KR Market Produce", 10),
    IngredientSpec("Capsicum", "Produce", "kg", 90, 96, "refrigerated", "KR Market Produce", 5),
    IngredientSpec("Mushroom", "Produce", "kg", 180, 48, "refrigerated", "Hopcoms", 2),
    IngredientSpec("Spinach", "Produce", "kg", 60, 36, "refrigerated", "Hopcoms", 2),
    IngredientSpec("Lettuce", "Produce", "kg", 170, 48, "refrigerated", "Hopcoms", 2),
    IngredientSpec("Cucumber", "Produce", "kg", 45, 72, "refrigerated", "KR Market Produce", 3),
    IngredientSpec("Carrot", "Produce", "kg", 50, 168, "refrigerated", "KR Market Produce", 5),
    IngredientSpec("Avocado", "Produce", "kg", 260, 72, "refrigerated", "Premium Produce BLR", 2),
    IngredientSpec("Banana", "Produce", "kg", 55, 72, "dry", "KR Market Produce", 5),
    IngredientSpec("Mango Pulp", "Produce", "kg", 220, 120, "refrigerated", "Malgova Foods", 3),
    IngredientSpec("Strawberry", "Produce", "kg", 340, 48, "refrigerated", "Nandi Hills Produce", 2),
    IngredientSpec("Blueberry", "Produce", "kg", 900, 72, "refrigerated", "Imported Foods BLR", 1),
    IngredientSpec("Lemon", "Produce", "kg", 90, 168, "refrigerated", "KR Market Produce", 2),
    IngredientSpec("Mint", "Produce", "kg", 160, 36, "refrigerated", "Hopcoms", 1),
    IngredientSpec("Coriander", "Produce", "kg", 90, 36, "refrigerated", "KR Market Produce", 1),
    IngredientSpec("Ginger", "Produce", "kg", 120, 240, "dry", "KR Market Produce", 2),
    IngredientSpec("Garlic", "Produce", "kg", 150, 240, "dry", "KR Market Produce", 2),
    IngredientSpec("Green Chilli", "Produce", "kg", 95, 96, "refrigerated", "KR Market Produce", 1),
    IngredientSpec("Basil", "Produce", "kg", 550, 36, "refrigerated", "Premium Produce BLR", 0.5),
    IngredientSpec("Mixed Greens", "Produce", "kg", 240, 36, "refrigerated", "Hopcoms", 2),
    IngredientSpec("Olive Oil", "Dry Goods", "litre", 700, 720, "dry", "Metro Cash & Carry", 2),
    IngredientSpec("Sunflower Oil", "Dry Goods", "litre", 130, 720, "dry", "Metro Cash & Carry", 10),
    IngredientSpec("Mayonnaise", "Condiments", "kg", 190, 240, "refrigerated", "Metro Cash & Carry", 3),
    IngredientSpec("Pesto", "Condiments", "kg", 640, 168, "refrigerated", "Premium Produce BLR", 1),
    IngredientSpec("Schezwan Sauce", "Condiments", "kg", 220, 240, "refrigerated", "Metro Cash & Carry", 2),
    IngredientSpec("Peanut Butter", "Condiments", "kg", 360, 720, "dry", "Metro Cash & Carry", 2),
    IngredientSpec("Jam", "Condiments", "kg", 280, 720, "dry", "Metro Cash & Carry", 2),
    IngredientSpec("Salt", "Spices", "kg", 18, 720, "dry", "Avenue Road Traders", 5),
    IngredientSpec("Pepper", "Spices", "kg", 700, 720, "dry", "Avenue Road Traders", 1),
    IngredientSpec("Garam Masala", "Spices", "kg", 420, 720, "dry", "KR Market Spices", 1),
    IngredientSpec("Chaat Masala", "Spices", "kg", 300, 720, "dry", "KR Market Spices", 1),
    IngredientSpec("Sambar Powder", "Spices", "kg", 260, 720, "dry", "KR Market Spices", 1),
    IngredientSpec("Cardamom", "Spices", "kg", 2400, 720, "dry", "KR Market Spices", 0.25),
    IngredientSpec("Cinnamon", "Spices", "kg", 1200, 720, "dry", "KR Market Spices", 0.25),
    IngredientSpec("Paper Cup", "Packaging", "pieces", 3, 720, "dry", "Packaging Hub", 500),
    IngredientSpec("Takeaway Box", "Packaging", "pieces", 8, 720, "dry", "Packaging Hub", 200),
    IngredientSpec("Napkins", "Packaging", "pieces", 0.5, 720, "dry", "Packaging Hub", 1000),
]


MENU_ITEMS: list[MenuItemSpec] = [
    MenuItemSpec("Filter Coffee", "Strong South Indian filter coffee with milk.", 80, "Beverages", "Coffee", ["hot", "classic"], 1.35, ["breakfast", "snack"], "hot"),
    MenuItemSpec("Cappuccino", "Espresso with steamed milk foam.", 140, "Beverages", "Coffee", ["hot"], 1.10, ["breakfast", "snack", "dinner"], "hot"),
    MenuItemSpec("Iced Americano", "Chilled espresso over ice.", 150, "Beverages", "Coffee", ["cold"], 0.95, ["lunch", "snack"], "cold"),
    MenuItemSpec("Cold Coffee", "Creamy chilled coffee with ice cream.", 180, "Beverages", "Coffee", ["cold", "sweet"], 1.18, ["lunch", "snack"], "cold"),
    MenuItemSpec("Masala Chai", "House chai brewed with Bangalore spice blend.", 70, "Beverages", "Tea", ["hot", "classic"], 1.22, ["breakfast", "snack"], "hot"),
    MenuItemSpec("Lemon Mint Cooler", "Fresh lemon, mint, and soda-style cooler.", 130, "Beverages", "Coolers", ["cold"], 0.88, ["lunch", "snack"], "cold"),
    MenuItemSpec("Mango Smoothie", "Mango pulp blended with curd and honey.", 190, "Beverages", "Smoothies", ["cold", "fruit"], 0.82, ["lunch", "snack"], "cold"),
    MenuItemSpec("Berry Banana Smoothie", "Banana, berries, curd, and honey.", 220, "Beverages", "Smoothies", ["cold", "fruit"], 0.72, ["breakfast", "snack"], "cold"),
    MenuItemSpec("Classic Croissant", "Buttery croissant warmed to order.", 110, "Bakery", "Pastry", ["breakfast"], 0.90, ["breakfast", "snack"], "neutral"),
    MenuItemSpec("Chocolate Croissant", "Croissant with chocolate syrup drizzle.", 150, "Bakery", "Pastry", ["sweet"], 0.82, ["breakfast", "snack"], "neutral"),
    MenuItemSpec("Sourdough Toast Butter Jam", "Toasted sourdough with butter and jam.", 140, "Breakfast", "Toast", ["vegetarian"], 0.80, ["breakfast"], "neutral"),
    MenuItemSpec("Avocado Sourdough Toast", "Sourdough toast with avocado, lemon, and chilli.", 260, "Breakfast", "Toast", ["vegetarian", "premium"], 0.78, ["breakfast", "lunch"], "neutral"),
    MenuItemSpec("Masala Omelette Toast", "Two egg omelette with onions and chilli.", 190, "Breakfast", "Eggs", ["eggs"], 1.02, ["breakfast"], "neutral"),
    MenuItemSpec("Mushroom Cheese Omelette", "Egg omelette with mushrooms and cheese.", 230, "Breakfast", "Eggs", ["eggs"], 0.70, ["breakfast"], "neutral"),
    MenuItemSpec("Upma Bowl", "Rava upma with vegetables and chutney.", 130, "Breakfast", "South Indian", ["vegetarian"], 0.76, ["breakfast"], "hot"),
    MenuItemSpec("Paneer Bhurji Toast", "Spiced paneer bhurji on toast.", 220, "Breakfast", "Toast", ["vegetarian"], 0.74, ["breakfast", "lunch"], "hot"),
    MenuItemSpec("Pesto Veg Sandwich", "Grilled sandwich with pesto and vegetables.", 230, "Sandwiches", "Veg", ["vegetarian"], 0.95, ["lunch", "snack"], "neutral"),
    MenuItemSpec("Chicken Club Sandwich", "Chicken, egg, lettuce, mayo, and toast.", 290, "Sandwiches", "Non Veg", ["chicken"], 0.92, ["lunch", "dinner"], "neutral"),
    MenuItemSpec("Bombay Masala Sandwich", "Potato masala grilled sandwich.", 170, "Sandwiches", "Veg", ["vegetarian", "classic"], 1.10, ["snack", "dinner"], "hot"),
    MenuItemSpec("Mushroom Melt Sandwich", "Mushroom and cheese grilled sandwich.", 240, "Sandwiches", "Veg", ["vegetarian"], 0.66, ["lunch", "dinner"], "neutral"),
    MenuItemSpec("Classic Veg Burger", "Veg patty, lettuce, tomato, and mayo.", 210, "Burgers", "Veg", ["vegetarian"], 0.78, ["lunch", "dinner"], "neutral"),
    MenuItemSpec("Chicken Burger", "Grilled chicken burger with mayo.", 280, "Burgers", "Non Veg", ["chicken"], 0.84, ["lunch", "dinner"], "neutral"),
    MenuItemSpec("Paneer Tikka Burger", "Paneer tikka burger with mint mayo.", 260, "Burgers", "Veg", ["vegetarian"], 0.76, ["lunch", "dinner"], "hot"),
    MenuItemSpec("Pesto Pasta", "Penne tossed in basil pesto.", 310, "Mains", "Pasta", ["vegetarian"], 0.82, ["lunch", "dinner"], "neutral"),
    MenuItemSpec("Creamy Mushroom Pasta", "Penne with mushroom cream sauce.", 320, "Mains", "Pasta", ["vegetarian"], 0.78, ["lunch", "dinner"], "hot"),
    MenuItemSpec("Schezwan Chicken Pasta", "Spicy Indo-Italian chicken pasta.", 340, "Mains", "Pasta", ["chicken", "spicy"], 0.80, ["lunch", "dinner"], "hot"),
    MenuItemSpec("Paneer Rice Bowl", "Paneer, rice, vegetables, and masala gravy.", 280, "Mains", "Rice Bowl", ["vegetarian"], 0.90, ["lunch", "dinner"], "hot"),
    MenuItemSpec("Chicken Rice Bowl", "Chicken, rice, vegetables, and house sauce.", 320, "Mains", "Rice Bowl", ["chicken"], 0.92, ["lunch", "dinner"], "hot"),
    MenuItemSpec("Quinoa Buddha Bowl", "Quinoa, greens, avocado, and lemon dressing.", 360, "Mains", "Salad Bowl", ["healthy", "vegetarian"], 0.58, ["lunch"], "cold"),
    MenuItemSpec("Caesar Salad", "Lettuce, chicken, cheese, and creamy dressing.", 300, "Salads", "Non Veg", ["chicken"], 0.54, ["lunch"], "cold"),
    MenuItemSpec("Greek Veg Salad", "Mixed greens, cucumber, tomato, and cheese.", 260, "Salads", "Veg", ["vegetarian"], 0.50, ["lunch"], "cold"),
    MenuItemSpec("French Fries", "Crispy potato fries.", 130, "Sides", "Snacks", ["vegetarian"], 1.05, ["snack", "dinner"], "neutral"),
    MenuItemSpec("Peri Peri Fries", "Fries tossed with spicy seasoning.", 150, "Sides", "Snacks", ["vegetarian", "spicy"], 0.95, ["snack", "dinner"], "hot"),
    MenuItemSpec("Garlic Bread", "Toasted bread with garlic butter.", 160, "Sides", "Bakery", ["vegetarian"], 0.84, ["snack", "dinner"], "hot"),
    MenuItemSpec("Paneer Skewers", "Grilled paneer skewers with mint chutney.", 260, "Sides", "Small Plates", ["vegetarian"], 0.62, ["dinner"], "hot"),
    MenuItemSpec("Chicken Skewers", "Grilled chicken skewers with house spice.", 300, "Sides", "Small Plates", ["chicken"], 0.68, ["dinner"], "hot"),
    MenuItemSpec("Chocolate Brownie", "Dense chocolate brownie.", 160, "Desserts", "Cake", ["sweet"], 0.86, ["snack", "dinner"], "neutral"),
    MenuItemSpec("Ice Cream Brownie", "Brownie served with vanilla ice cream.", 220, "Desserts", "Cake", ["sweet", "cold"], 0.78, ["snack", "dinner"], "cold"),
    MenuItemSpec("Caramel Banana Pancake", "Pancake with banana and caramel.", 240, "Desserts", "Pancake", ["sweet"], 0.62, ["breakfast", "snack"], "neutral"),
    MenuItemSpec("Strawberry Pancake", "Pancake with strawberry compote.", 270, "Desserts", "Pancake", ["sweet", "fruit"], 0.58, ["breakfast", "snack"], "cold"),
]


def build_menu_and_ingredients(rng: np.random.Generator) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    ingredients = [
        {
            "name": item.name,
            "category": item.category,
            "unit": item.unit,
            "cost_per_unit": round(float(item.cost_per_unit), 2),
            "shelf_life_hours": item.shelf_life_hours,
            "storage_type": item.storage_type,
            "supplier_name": item.supplier_name,
            "min_order_quantity": round(float(item.min_order_quantity), 2),
        }
        for item in INGREDIENTS
    ]

    menu_items = [
        {
            "name": item.name,
            "description": item.description,
            "price": round(float(item.price), 2),
            "category": item.category,
            "sub_category": item.sub_category,
            "tags": item.tags,
            "popularity": item.popularity,
            "dayparts": item.dayparts,
            "weather_affinity": item.weather_affinity,
        }
        for item in MENU_ITEMS
    ]

    recipes = _build_recipe_map()
    _validate_food_costs(menu_items, ingredients, recipes, rng)
    return menu_items, ingredients, recipes


def _recipe(*pairs: tuple[str, float]) -> list[dict[str, Any]]:
    return [{"ingredient_name": name, "quantity_used": qty} for name, qty in pairs]


def _build_recipe_map() -> dict[str, list[dict[str, Any]]]:
    return {
        "Filter Coffee": _recipe(("Chicory Blend Coffee", 0.018), ("Milk", 0.16), ("Sugar", 0.012), ("Paper Cup", 1)),
        "Cappuccino": _recipe(("Arabica Coffee Beans", 0.018), ("Milk", 0.18), ("Sugar", 0.008), ("Paper Cup", 1)),
        "Iced Americano": _recipe(("Arabica Coffee Beans", 0.020), ("Ice Cubes", 0.12), ("Paper Cup", 1)),
        "Cold Coffee": _recipe(("Chicory Blend Coffee", 0.020), ("Milk", 0.22), ("Ice Cream", 0.08), ("Sugar", 0.018), ("Ice Cubes", 0.10), ("Paper Cup", 1)),
        "Masala Chai": _recipe(("Tea Leaves", 0.010), ("Masala Chai Mix", 0.006), ("Milk", 0.15), ("Sugar", 0.014), ("Ginger", 0.004), ("Paper Cup", 1)),
        "Lemon Mint Cooler": _recipe(("Lemon", 0.08), ("Mint", 0.012), ("Sugar", 0.020), ("Ice Cubes", 0.12), ("Paper Cup", 1)),
        "Mango Smoothie": _recipe(("Mango Pulp", 0.18), ("Curd", 0.14), ("Honey", 0.018), ("Ice Cubes", 0.08), ("Paper Cup", 1)),
        "Berry Banana Smoothie": _recipe(("Banana", 0.18), ("Strawberry", 0.08), ("Blueberry", 0.04), ("Curd", 0.12), ("Honey", 0.018), ("Paper Cup", 1)),
        "Classic Croissant": _recipe(("Croissant", 1), ("Butter", 0.010), ("Napkins", 2)),
        "Chocolate Croissant": _recipe(("Croissant", 1), ("Chocolate Syrup", 0.030), ("Cocoa Powder", 0.004), ("Napkins", 2)),
        "Sourdough Toast Butter Jam": _recipe(("Sourdough Bread", 0.25), ("Butter", 0.020), ("Jam", 0.030), ("Napkins", 2)),
        "Avocado Sourdough Toast": _recipe(("Sourdough Bread", 0.25), ("Avocado", 0.12), ("Lemon", 0.025), ("Green Chilli", 0.004), ("Salt", 0.002), ("Pepper", 0.001), ("Napkins", 2)),
        "Masala Omelette Toast": _recipe(("Eggs", 2), ("Onion", 0.04), ("Tomato", 0.04), ("Green Chilli", 0.004), ("Milk Bread", 0.20), ("Butter", 0.012), ("Napkins", 2)),
        "Mushroom Cheese Omelette": _recipe(("Eggs", 2), ("Mushroom", 0.08), ("Cheese", 0.04), ("Milk", 0.03), ("Butter", 0.012), ("Pepper", 0.001), ("Napkins", 2)),
        "Upma Bowl": _recipe(("Rava", 0.10), ("Onion", 0.04), ("Carrot", 0.04), ("Green Chilli", 0.004), ("Sunflower Oil", 0.012), ("Coriander", 0.006), ("Takeaway Box", 1)),
        "Paneer Bhurji Toast": _recipe(("Paneer", 0.12), ("Onion", 0.04), ("Tomato", 0.05), ("Garam Masala", 0.004), ("Milk Bread", 0.20), ("Butter", 0.010), ("Takeaway Box", 1)),
        "Pesto Veg Sandwich": _recipe(("Milk Bread", 0.25), ("Pesto", 0.035), ("Capsicum", 0.05), ("Tomato", 0.04), ("Cheese", 0.035), ("Butter", 0.010), ("Takeaway Box", 1)),
        "Chicken Club Sandwich": _recipe(("Milk Bread", 0.30), ("Chicken Breast", 0.12), ("Eggs", 1), ("Lettuce", 0.04), ("Mayonnaise", 0.030), ("Tomato", 0.035), ("Takeaway Box", 1)),
        "Bombay Masala Sandwich": _recipe(("Milk Bread", 0.25), ("Potato", 0.14), ("Onion", 0.035), ("Chaat Masala", 0.004), ("Butter", 0.012), ("Green Chilli", 0.003), ("Takeaway Box", 1)),
        "Mushroom Melt Sandwich": _recipe(("Milk Bread", 0.25), ("Mushroom", 0.12), ("Cheese", 0.05), ("Butter", 0.012), ("Pepper", 0.001), ("Takeaway Box", 1)),
        "Classic Veg Burger": _recipe(("Burger Bun", 1), ("Potato", 0.16), ("Lettuce", 0.03), ("Tomato", 0.04), ("Mayonnaise", 0.025), ("Sunflower Oil", 0.020), ("Takeaway Box", 1)),
        "Chicken Burger": _recipe(("Burger Bun", 1), ("Chicken Breast", 0.15), ("Lettuce", 0.03), ("Tomato", 0.04), ("Mayonnaise", 0.030), ("Takeaway Box", 1)),
        "Paneer Tikka Burger": _recipe(("Burger Bun", 1), ("Paneer", 0.14), ("Garam Masala", 0.005), ("Mayonnaise", 0.025), ("Mint", 0.006), ("Lettuce", 0.03), ("Takeaway Box", 1)),
        "Pesto Pasta": _recipe(("Pasta Penne", 0.12), ("Pesto", 0.055), ("Cream", 0.04), ("Cheese", 0.025), ("Basil", 0.006), ("Olive Oil", 0.012), ("Takeaway Box", 1)),
        "Creamy Mushroom Pasta": _recipe(("Pasta Penne", 0.12), ("Mushroom", 0.12), ("Cream", 0.08), ("Cheese", 0.03), ("Butter", 0.010), ("Pepper", 0.001), ("Takeaway Box", 1)),
        "Schezwan Chicken Pasta": _recipe(("Pasta Penne", 0.12), ("Chicken Breast", 0.12), ("Schezwan Sauce", 0.05), ("Capsicum", 0.05), ("Garlic", 0.006), ("Sunflower Oil", 0.012), ("Takeaway Box", 1)),
        "Paneer Rice Bowl": _recipe(("Basmati Rice", 0.14), ("Paneer", 0.12), ("Capsicum", 0.06), ("Tomato", 0.07), ("Garam Masala", 0.006), ("Sunflower Oil", 0.012), ("Takeaway Box", 1)),
        "Chicken Rice Bowl": _recipe(("Basmati Rice", 0.14), ("Chicken Breast", 0.14), ("Capsicum", 0.06), ("Schezwan Sauce", 0.04), ("Garlic", 0.006), ("Sunflower Oil", 0.012), ("Takeaway Box", 1)),
        "Quinoa Buddha Bowl": _recipe(("Quinoa", 0.11), ("Mixed Greens", 0.08), ("Avocado", 0.10), ("Cucumber", 0.05), ("Carrot", 0.05), ("Lemon", 0.03), ("Olive Oil", 0.015), ("Takeaway Box", 1)),
        "Caesar Salad": _recipe(("Lettuce", 0.12), ("Chicken Breast", 0.12), ("Cheese", 0.03), ("Mayonnaise", 0.035), ("Sourdough Bread", 0.10), ("Takeaway Box", 1)),
        "Greek Veg Salad": _recipe(("Mixed Greens", 0.10), ("Cucumber", 0.08), ("Tomato", 0.08), ("Cheese", 0.04), ("Olive Oil", 0.015), ("Lemon", 0.03), ("Takeaway Box", 1)),
        "French Fries": _recipe(("Potato", 0.22), ("Sunflower Oil", 0.030), ("Salt", 0.003), ("Takeaway Box", 1)),
        "Peri Peri Fries": _recipe(("Potato", 0.22), ("Sunflower Oil", 0.030), ("Chaat Masala", 0.005), ("Salt", 0.003), ("Takeaway Box", 1)),
        "Garlic Bread": _recipe(("Sourdough Bread", 0.20), ("Butter", 0.035), ("Garlic", 0.010), ("Coriander", 0.004), ("Takeaway Box", 1)),
        "Paneer Skewers": _recipe(("Paneer", 0.18), ("Curd", 0.04), ("Garam Masala", 0.006), ("Mint", 0.008), ("Sunflower Oil", 0.010), ("Takeaway Box", 1)),
        "Chicken Skewers": _recipe(("Chicken Breast", 0.18), ("Curd", 0.04), ("Garam Masala", 0.006), ("Garlic", 0.008), ("Sunflower Oil", 0.010), ("Takeaway Box", 1)),
        "Chocolate Brownie": _recipe(("All Purpose Flour", 0.08), ("Cocoa Powder", 0.025), ("Sugar", 0.06), ("Butter", 0.04), ("Eggs", 1), ("Chocolate Syrup", 0.020), ("Napkins", 2)),
        "Ice Cream Brownie": _recipe(("All Purpose Flour", 0.08), ("Cocoa Powder", 0.025), ("Sugar", 0.06), ("Butter", 0.04), ("Eggs", 1), ("Ice Cream", 0.10), ("Chocolate Syrup", 0.020), ("Napkins", 2)),
        "Caramel Banana Pancake": _recipe(("All Purpose Flour", 0.10), ("Milk", 0.10), ("Eggs", 1), ("Banana", 0.12), ("Caramel Syrup", 0.030), ("Butter", 0.015), ("Napkins", 2)),
        "Strawberry Pancake": _recipe(("All Purpose Flour", 0.10), ("Milk", 0.10), ("Eggs", 1), ("Strawberry", 0.12), ("Sugar", 0.020), ("Butter", 0.015), ("Napkins", 2)),
    }


def _validate_food_costs(menu_items: list[dict[str, Any]], ingredients: list[dict[str, Any]], recipes: dict[str, list[dict[str, Any]]], rng: np.random.Generator) -> None:
    ingredient_cost = {ingredient["name"]: ingredient["cost_per_unit"] for ingredient in ingredients}
    for item in menu_items:
        recipe = recipes[item["name"]]
        food_cost = sum(ingredient_cost[row["ingredient_name"]] * row["quantity_used"] for row in recipe)
        food_cost_pct = food_cost / item["price"]
        if food_cost_pct < 0.25:
            item["price"] = round(food_cost / float(rng.uniform(0.25, 0.32)), 2)
        elif food_cost_pct > 0.40:
            item["price"] = round(food_cost / float(rng.uniform(0.32, 0.40)), 2)
