"""Calendar entity for planned meals."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from homeassistant.components.calendar import (
    CalendarEntity,
    CalendarEntityFeature,
    CalendarEvent,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_connect, async_dispatcher_send
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import DOMAIN, SIGNAL
from .store import MealStore


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    store: MealStore = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([SteadyCalendar(entry, store)])


def _parse(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return dt_util.as_local(parsed)
    return parsed


def _to_event(raw: dict) -> CalendarEvent:
    return CalendarEvent(
        start=_parse(raw["start"]),
        end=_parse(raw["end"]),
        summary=raw.get("summary") or "Meal",
        description=raw.get("description") or None,
        uid=raw.get("uid"),
    )


class SteadyCalendar(CalendarEntity):
    """One calendar of breakfast, lunch, and dinner."""

    _attr_has_entity_name = False
    _attr_name = "Steady Batch"
    _attr_icon = "mdi:pot-steam"
    _attr_supported_features = (
        CalendarEntityFeature.CREATE_EVENT | CalendarEntityFeature.DELETE_EVENT
    )

    def __init__(self, entry: ConfigEntry, store: MealStore) -> None:
        self._store = store
        self._attr_unique_id = f"{entry.entry_id}-calendar"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name="Steady Batch",
            manufacturer="Steady Batch",
            model="Meal calendar",
        )
        self._event: CalendarEvent | None = None

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass,
                SIGNAL,
                lambda: self.schedule_update_ha_state(True),
            )
        )
        await self._async_refresh()

    async def _async_refresh(self) -> None:
        await self.async_update_ha_state(force_refresh=True)

    @property
    def event(self) -> CalendarEvent | None:
        return self._event

    async def async_update(self) -> None:
        now = dt_util.now()
        upcoming = [
            _to_event(raw)
            for raw in self._store.events.values()
            if _parse(raw["end"]) >= now
        ]
        upcoming.sort(key=lambda item: item.start)
        active = next(
            (item for item in upcoming if item.start <= now <= item.end),
            None,
        )
        self._event = active or (upcoming[0] if upcoming else None)

    async def async_get_events(
        self,
        hass: HomeAssistant,
        start_date: datetime,
        end_date: datetime,
    ) -> list[CalendarEvent]:
        found: list[CalendarEvent] = []
        for raw in self._store.events.values():
            event = _to_event(raw)
            if event.end > start_date and event.start < end_date:
                found.append(event)
        found.sort(key=lambda item: item.start)
        return found

    async def async_create_event(self, **kwargs: Any) -> None:
        start = kwargs.get("start") or kwargs.get("dtstart")
        end = kwargs.get("end") or kwargs.get("dtend")
        if not isinstance(start, datetime) or not isinstance(end, datetime):
            return
        uid = str(kwargs.get("uid") or f"ha-{start.isoformat()}")
        self._store.upsert(
            {
                "uid": uid,
                "summary": kwargs.get("summary") or "Meal",
                "description": kwargs.get("description") or "",
                "start": start.isoformat(),
                "end": end.isoformat(),
                "recipe_key": "",
            }
        )
        await self._store.async_save()
        async_dispatcher_send(self.hass, SIGNAL)
        await self._async_refresh()

    async def async_delete_event(
        self,
        uid: str,
        recurrence_id: str | None = None,
        recurrence_range: str | None = None,
    ) -> None:
        self._store.remove(uid)
        await self._store.async_save()
        async_dispatcher_send(self.hass, SIGNAL)
        await self._async_refresh()
