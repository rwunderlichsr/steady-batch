"""Today's meals as one sensor, for dashboard cards that are not calendars."""

from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .calendar import _parse
from .const import DOMAIN, MEALS, SIGNAL
from .store import MealStore


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    store: MealStore = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([TodayMealsSensor(entry, store)])


class TodayMealsSensor(SensorEntity):
    """Breakfast, lunch, and dinner for the local date."""

    _attr_has_entity_name = False
    _attr_name = "Steady Batch today"
    _attr_icon = "mdi:silverware-fork-knife"
    _attr_native_unit_of_measurement = "cal"

    def __init__(self, entry: ConfigEntry, store: MealStore) -> None:
        self._store = store
        self._updated = ""
        self._attr_unique_id = f"{entry.entry_id}-today"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name="Steady Batch",
            manufacturer="Steady Batch",
            model="Meal calendar",
        )

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(
            async_dispatcher_connect(self.hass, SIGNAL, self._async_touched)
        )

    def _async_touched(self) -> None:
        self._updated = dt_util.utcnow().isoformat()
        self.async_write_ha_state()

    @property
    def native_value(self) -> int:
        return sum(self._number(event, "calories") for event in self._today().values() if event)

    @property
    def extra_state_attributes(self) -> dict:
        meals = self._today()
        protein = sum(self._number(event, "protein") for event in meals.values() if event)
        goal = self._store.goal
        attributes: dict = {"protein": protein, "goal": goal or "", "updated": self._updated}
        planned = []
        for meal in MEALS:
            event = meals[meal]
            name = event["summary"].split(": ", 1)[-1] if event else ""
            attributes[meal.lower()] = name or "Open"
            if event:
                planned.append(
                    {
                        "meal": meal,
                        "name": name,
                        "summary": event.get("summary") or "",
                    }
                )
        attributes["meals"] = planned
        if self._store.feed_url:
            attributes["phone_plan"] = self._store.feed_url
        if goal:
            attributes["left"] = goal - self.native_value
        return attributes

    def _number(self, event: dict, field: str) -> int:
        if isinstance(event.get(field), int):
            return event[field]
        for line in str(event.get("description") or "").splitlines():
            if line.startswith(f"{field}:"):
                digits = "".join(ch for ch in line.split(":", 1)[1] if ch.isdigit())
                return int(digits or 0)
        return 0

    def _today(self) -> dict[str, dict | None]:
        today = dt_util.now().date()
        found: dict[str, dict | None] = {meal: None for meal in MEALS}
        for raw in self._store.events.values():
            start = _parse(raw["start"])
            if start.date() != today:
                continue
            summary = raw.get("summary") or ""
            for meal in MEALS:
                if summary.startswith(f"{meal}:"):
                    found[meal] = raw
        return found
