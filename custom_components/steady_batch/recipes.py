"""Recipe lookup loaded from recipes.json beside this file."""

from __future__ import annotations

import json
from pathlib import Path

_PATH = Path(__file__).with_name("recipes.json")


def load_recipes() -> list[dict]:
    """Return the bundled recipes."""
    return json.loads(_PATH.read_text(encoding="utf-8"))


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
    return (
        f"{recipe['name']}\n"
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
