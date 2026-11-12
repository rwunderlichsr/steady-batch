"""Steady Batch meal planner for Home Assistant."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path
import hashlib
import json

import voluptuous as vol
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_time_interval

from .const import DOMAIN, MEALS, SIGNAL, SLOT_CLOCK
from .recipes import describe, load_recipes, recipe_by_name
from .store import MealStore

PLATFORMS = [Platform.CALENDAR, Platform.SENSOR]
CARD_KEY = f"{DOMAIN}_card"


def _local(day: date, hour: int, minute: int) -> datetime:
    from homeassistant.util import dt as dt_util

    tz = dt_util.now().tzinfo
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=tz)


def _as_date(value) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def slot_uid(day: date, meal: str) -> str:
    return f"steady-{day.isoformat()}-{meal.lower()}"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    store = MealStore(hass)
    await store.async_load()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = store
    await _async_register_card(hass)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    _async_register_services(hass)
    async def _tick(_now):
        await _async_pull_phone(hass)

    entry.async_on_unload(async_track_time_interval(hass, _tick, timedelta(minutes=2)))
    hass.async_create_task(_async_pull_phone(hass))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unload = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return unload


async def _async_register_card(hass: HomeAssistant) -> None:
    if hass.data.get(CARD_KEY):
        return
    root = Path(__file__).parent
    card = root / "www" / "steady-batch-card.js"
    recipes = root / "recipes"
    if not card.is_file():
        return
    paths = [StaticPathConfig("/steady_batch/steady-batch-card.js", str(card), False)]
    if recipes.is_dir():
        paths.append(StaticPathConfig("/steady_batch/recipes", str(recipes), False))
    try:
        await hass.http.async_register_static_paths(paths)
    except RuntimeError:
        pass
    url = "/steady_batch/steady-batch-card.js?v=26"
    add_extra_js_url(hass, url)
    try:
        from homeassistant.components.panel_custom import async_register_panel

        await async_register_panel(
            hass,
            frontend_url_path="steady-batch",
            webcomponent_name="steady-batch-panel",
            sidebar_title="Meals",
            sidebar_icon="mdi:silverware-fork-knife",
            js_url=url,
            module_url=url,
            require_admin=False,
        )
    except ValueError:
        pass
    hass.data[CARD_KEY] = True


def _first_store(hass: HomeAssistant) -> MealStore | None:
    stores = hass.data.get(DOMAIN) or {}
    return next(iter(stores.values()), None)


def _async_register_services(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, "set_meal"):
        return

    async def set_meal(call: ServiceCall) -> None:
        store = _first_store(hass)
        if store is None:
            return
        recipe = recipe_by_name(call.data["recipe"])
        if recipe is None:
            return
        day = _as_date(call.data["date"])
        meal = call.data["meal"]
        servings = 2 if int(call.data.get("servings") or 1) == 2 else 1
        (start_h, start_m), (end_h, end_m) = SLOT_CLOCK[meal]
        name = recipe["name"] + (" ×2" if servings == 2 else "")
        store.upsert(
            {
                "uid": slot_uid(day, meal),
                "summary": f"{meal}: {name}",
                "description": describe(recipe, servings),
                "start": _local(day, start_h, start_m).isoformat(),
                "end": _local(day, end_h, end_m).isoformat(),
                "recipe_key": recipe["key"],
                "servings": servings,
                "calories": _amount(recipe["calories"]) * servings,
                "protein": _amount(recipe["protein"]) * servings,
            }
        )
        await store.async_save()
        async_dispatcher_send(hass, SIGNAL)

    async def clear_meal(call: ServiceCall) -> None:
        store = _first_store(hass)
        if store is None:
            return
        store.remove(slot_uid(_as_date(call.data["date"]), call.data["meal"]))
        await store.async_save()
        async_dispatcher_send(hass, SIGNAL)

    async def set_goal(call: ServiceCall) -> None:
        store = _first_store(hass)
        if store is None:
            return
        store.goal = int(call.data["calories"])
        await store.async_save()
        async_dispatcher_send(hass, SIGNAL)

    async def list_recipes(call: ServiceCall) -> dict:
        return {"recipes": load_recipes()}

    async def get_ratings(call: ServiceCall) -> dict:
        store = _first_store(hass)
        if store is None:
            return {"ratings": {}, "goal": None, "skip_proteins": []}
        return {"ratings": store.ratings, "goal": store.goal, "skip_proteins": store.skip_proteins}

    async def set_rating(call: ServiceCall) -> None:
        store = _first_store(hass)
        if store is None:
            return
        name = call.data["recipe"]
        rating = call.data["rating"]
        if rating == "none":
            store.ratings.pop(name, None)
        else:
            store.ratings[name] = rating
        await store.async_save()

    async def set_preferences(call: ServiceCall) -> None:
        store = _first_store(hass)
        if store is None:
            return
        allowed = {
            "Chicken",
            "Turkey",
            "Beef",
            "Pork",
            "Salmon",
            "Eggs",
            "Yogurt",
            "Cottage cheese",
            "Tuna",
            "Shrimp",
            "White fish",
            "Beans",
        }
        incoming = call.data.get("ratings") or {}
        if isinstance(incoming, dict):
            store.ratings = {
                str(key)[:180]: value
                for key, value in incoming.items()
                if value in ("like", "dislike")
            }
        skipped = call.data.get("skip_proteins") or []
        store.skip_proteins = [item for item in skipped if item in allowed]
        await store.async_save()
        async_dispatcher_send(hass, SIGNAL)

    async def import_plan(call: ServiceCall) -> dict:
        store = _first_store(hass)
        if store is None:
            return {"saved": 0}
        saved = 0
        kept: set[str] = set()
        scope = {str(day)[:10] for day in call.data.get("dates") or []}
        replace = bool(call.data.get("replace", True))
        for item in call.data["meals"]:
            recipe = recipe_by_name(item["recipe"])
            if recipe is None:
                continue
            day = _as_date(item["date"])
            meal = item["meal"]
            servings = 2 if int(item.get("servings") or 1) == 2 else 1
            (start_h, start_m), (end_h, end_m) = SLOT_CLOCK[meal]
            name = recipe["name"] + (" ×2" if servings == 2 else "")
            uid = slot_uid(day, meal)
            kept.add(uid)
            store.upsert(
                {
                    "uid": uid,
                    "summary": f"{meal}: {name}",
                    "description": describe(recipe, servings),
                    "start": _local(day, start_h, start_m).isoformat(),
                    "end": _local(day, end_h, end_m).isoformat(),
                    "recipe_key": recipe["key"],
                    "servings": servings,
                    "calories": _amount(recipe["calories"]) * servings,
                    "protein": _amount(recipe["protein"]) * servings,
                }
            )
            saved += 1
        if not replace and not scope:
            scope = {str(item["date"])[:10] for item in call.data["meals"]}
        for uid in list(store.events):
            if not uid.startswith("steady-") or uid in kept:
                continue
            parts = uid.split("-")
            day = "-".join(parts[1:4]) if len(parts) >= 5 else ""
            if replace or day in scope:
                store.remove(uid)
        await store.async_save()
        async_dispatcher_send(hass, SIGNAL)
        return {"saved": saved}

    hass.services.async_register(
        DOMAIN,
        "set_meal",
        set_meal,
        schema=vol.Schema(
            {
                vol.Required("date"): vol.Any(date, datetime, str),
                vol.Required("meal"): vol.In(MEALS),
                vol.Required("recipe"): str,
                vol.Optional("servings", default=1): vol.All(vol.Coerce(int), vol.In([1, 2])),
            }
        ),
    )
    hass.services.async_register(
        DOMAIN,
        "clear_meal",
        clear_meal,
        schema=vol.Schema(
            {
                vol.Required("date"): vol.Any(date, datetime, str),
                vol.Required("meal"): vol.In(MEALS),
            }
        ),
    )
    hass.services.async_register(
        DOMAIN,
        "set_goal",
        set_goal,
        schema=vol.Schema({vol.Required("calories"): vol.All(vol.Coerce(int), vol.Range(min=800, max=4000))}),
    )
    hass.services.async_register(
        DOMAIN,
        "list_recipes",
        list_recipes,
        supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN,
        "get_ratings",
        get_ratings,
        supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN,
        "set_rating",
        set_rating,
        schema=vol.Schema(
            {
                vol.Required("recipe"): str,
                vol.Required("rating"): vol.In(["like", "dislike", "none"]),
            }
        ),
    )
    hass.services.async_register(
        DOMAIN,
        "set_preferences",
        set_preferences,
        schema=vol.Schema(
            {
                vol.Optional("ratings", default={}): dict,
                vol.Optional("skip_proteins", default=[]): [str],
            }
        ),
    )
    hass.services.async_register(
        DOMAIN,
        "import_plan",
        import_plan,
        schema=vol.Schema(
            {
                vol.Required("meals"): [
                    vol.Schema(
                        {
                            vol.Required("date"): str,
                            vol.Required("meal"): vol.In(MEALS),
                            vol.Required("recipe"): str,
                            vol.Optional("servings", default=1): vol.All(vol.Coerce(int), vol.In([1, 2])),
                        }
                    )
                ],
                vol.Optional("replace", default=True): bool,
                vol.Optional("dates"): [str],
            }
        ),
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def set_phone_plan(call: ServiceCall) -> None:
        store = _first_store(hass)
        if store is None:
            return
        store.feed_url = str(call.data.get("url") or "").strip()
        store.feed_stamp = ""
        await store.async_save()
        await _async_pull_phone(hass)

    hass.services.async_register(
        DOMAIN,
        "set_phone_plan",
        set_phone_plan,
        schema=vol.Schema({vol.Required("url"): str}),
    )


async def _async_pull_phone(hass: HomeAssistant) -> None:
    store = _first_store(hass)
    if store is None:
        return
    url = store.feed_url
    if not url.startswith("https://") or "/api/plan/" not in url:
        return
    session = async_get_clientsession(hass)
    try:
        async with session.get(url, timeout=20) as response:
            if response.status != 200:
                return
            payload = await response.json(content_type=None)
    except Exception:
        return
    meals = payload.get("meals") if isinstance(payload, dict) else None
    if not isinstance(meals, list) or not meals:
        return
    stamp = hashlib.sha256(json.dumps(meals, sort_keys=True, default=str).encode()).hexdigest()
    if stamp == store.feed_stamp:
        return
    await hass.services.async_call(
        DOMAIN,
        "import_plan",
        {"meals": meals, "replace": True},
        blocking=True,
    )
    store.feed_stamp = stamp
    await store.async_save()


def _amount(value) -> int:
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    return int(digits or 0)
