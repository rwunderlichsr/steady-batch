"""Config flow for Steady Batch."""

from __future__ import annotations

import voluptuous as vol
from homeassistant.config_entries import ConfigFlow

from .const import DOMAIN


class SteadyBatchConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a single-step setup."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        if user_input is None:
            return self.async_show_form(step_id="user", data_schema=vol.Schema({}))
        return self.async_create_entry(title="Steady Batch", data={})
