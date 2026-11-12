"""Recipe lookup loaded from recipes/part-*.json beside this file."""

from __future__ import annotations

import json
from pathlib import Path

_DIR = Path(__file__).with_name("recipes")


def load_recipes() -> list[dict]:
    """Return the bundled recipes."""
    recipes: list[dict] = []
    for path in sorted(_DIR.glob("part-*.json")):
        recipes.extend(json.loads(path.read_text(encoding="utf-8")))
    return recipes


def recipe_by_name(name: str) -> dict | None:
    """Find a recipe by its display name."""
    for recipe in load_recipes():
        if recipe["name"] == name:
            return recipe
    return None


def recipe_by_key(key: str) -> dict | None:
    """Find a recipe by its stable key."""
    for recipe in load_recipes():
        if recipe["key"] == key:
            return recipe
    return None


def describe(recipe: dict, servings: int = 1) -> str:
    """Plain-text event body shown in the Home Assistant calendar."""
    calories = _amount(recipe["calories"]) * servings
    protein = _amount(recipe["protein"]) * servings
    ingredients = "\n".join(f"- {item}" for item in recipe["ingredients"])
    steps = "\n".join(
        f"{index}. {step}" for index, step in enumerate(recipe["instructions"], start=1)
    )
    portion = "2 servings" if servings == 2 else "1 serving"
    egg = "egg" in recipe["name"].lower()
    fish = any(word in recipe["name"].lower() for word in ("salmon", "shrimp", "tuna"))
    ahead = "1 plate" not in str(recipe.get("servings", "")).lower() and "|No cook|" not in recipe["key"]
    if ahead and egg:
        reheat = (
            "REHEAT\n"
            "Make ahead. Fridge 3 days.\n"
            "1. This was cooked ahead. Reheat one portion. Do not cook it again.\n"
            "2. Cover the box.\n"
            "3. Microwave 60–90 seconds and stir once, or a covered pan on low for 3–4 minutes.\n"
            "4. Stop when it is hot. More time makes the eggs rubbery.\n\n"
        )
    elif ahead:
        days = "2" if fish else "4"
        reheat = (
            "REHEAT\n"
            f"Make ahead. Fridge {days} days.\n"
            "1. This was cooked ahead. Reheat one portion.\n"
            "2. Cover it. Add a splash of water if it looks dry.\n"
            "3. Microwave 60–90 seconds, or a covered pan on low until hot through.\n"
            f"4. Use it within {days} days.\n\n"
        )
    else:
        reheat = "COOK WHEN YOU EAT IT\nThis one is not a make-ahead meal.\n\n"
    return (
        f"{recipe['name']}\n"
        f"{reheat}"
        f"{portion} · {recipe['style']} · {recipe['time']}\n"
        f"{protein}g protein · {calories} cal · "
        f"{recipe['carbs']} carbs · {recipe['sodium']} sodium\n\n"
        f"Ingredients\n{ingredients}\n\n"
        f"Steps\n{steps}\n\n"
        f"Done when: {recipe['doneWhen']}\n"
        f"calories:{calories}\n"
        f"protein:{protein}\n"
        f"servings:{servings}\n"
        f"recipe_key:{recipe['key']}"
    )


def _amount(value) -> int:
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    return int(digits or 0)
