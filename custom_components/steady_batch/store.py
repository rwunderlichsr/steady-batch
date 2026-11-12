"""Persist planned meals."""

from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN


class MealStore:
    """JSON store of calendar events, keyed by uid."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict] = Store(hass, 1, f"{DOMAIN}.meals")
        self.events: dict[str, dict] = {}
        self.goal: int | None = None
        self.ratings: dict[str, str] = {}

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        events = data.get("events", {})
        self.events = events if isinstance(events, dict) else {}
        goal = data.get("goal")
        self.goal = goal if isinstance(goal, int) else None
        ratings = data.get("ratings", {})
        self.ratings = ratings if isinstance(ratings, dict) else {}

    async def async_save(self) -> None:
        await self._store.async_save({"events": self.events, "goal": self.goal, "ratings": self.ratings})

    def upsert(self, event: dict) -> None:
        self.events[event["uid"]] = event

    def remove(self, uid: str) -> None:
        self.events.pop(uid, None)
