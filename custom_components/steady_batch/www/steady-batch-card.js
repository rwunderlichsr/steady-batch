const MEALS = ["Breakfast", "Lunch", "Dinner", "Snack"];

function amount(value) {
  const match = String(value).replace(/,/g, "").match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function esc(value) {
  return String(value).split("\u0026").join("\u0026amp;").split("<").join("\u0026lt;");
}

function planDays(goal, recipes) {
  const used = new Set();
  const days = [];
  const byMeal = Object.fromEntries(MEALS.map((meal) => [meal, recipes.filter((recipe) => recipe.meal === meal)]));
  for (let salt = 0; salt < 7; salt += 1) {
    const choices = (meal) => {
      const all = byMeal[meal];
      const fresh = all.filter((recipe) => !used.has(recipe.key));
      const source = fresh.length >= 4 ? fresh : all;
      const start = source.length ? (salt * 5) % source.length : 0;
      return Array.from({ length: Math.min(6, source.length) }, (_, index) => source[(start + index) % source.length]);
    };
    let best = null;
    for (const breakfast of choices("Breakfast")) {
      for (const lunch of choices("Lunch")) {
        for (const dinner of choices("Dinner")) {
          for (const bCount of [1, 2]) {
            for (const lCount of [1, 2]) {
              for (const dCount of [1, 2]) {
                const base = amount(breakfast.calories) * bCount + amount(lunch.calories) * lCount + amount(dinner.calories) * dCount;
                const protein = amount(breakfast.protein) * bCount + amount(lunch.protein) * lCount + amount(dinner.protein) * dCount;
                for (const snack of [null, ...choices("Snack")]) {
                  const calories = base + (snack ? amount(snack.calories) : 0);
                  const allProtein = protein + (snack ? amount(snack.protein) : 0);
                  const diff = calories - goal;
                  if (diff > 80) continue;
                  let score = Math.abs(diff);
                  if (diff < -100) score += 30;
                  if (allProtein < 100) score += 70;
                  if (!best || score < best.score) {
                    best = {
                      score,
                      Breakfast: { name: breakfast.name, servings: bCount, key: breakfast.key },
                      Lunch: { name: lunch.name, servings: lCount, key: lunch.key },
                      Dinner: { name: dinner.name, servings: dCount, key: dinner.key },
                      Snack: snack ? { name: snack.name, servings: 1, key: snack.key } : null,
                    };
                  }
                }
              }
            }
          }
        }
      }
    }
    if (best) {
      for (const meal of MEALS) if (best[meal]) used.add(best[meal].key);
    }
    days.push(best || {});
  }
  return days;
}

function shoppingLines(planned, recipes) {
  const counts = new Map();
  for (const slot of Object.values(planned || {})) {
    if (!slot || !slot.name) continue;
    const recipe = recipes.find((item) => item.name === slot.name);
    if (!recipe) continue;
    const servings = slot.servings === 2 ? 2 : 1;
    for (const line of recipe.ingredients) counts.set(line, (counts.get(line) || 0) + servings);
  }
  return [...counts.entries()].map(([line, count]) => (count > 1 ? `${count} × ${line}` : line));
}

class SteadyBatchCard extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    if (!this._loaded) {
      this._loaded = true;
      this._refresh();
    }
  }

  getCardSize() {
    return 12;
  }

  _build() {
    this._built = true;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <ha-card>
        <style>
          :host { display: block; }
          .wrap { padding: 16px; }
          h2 { margin: 0 0 4px; font-size: 1.3rem; }
          p.note, .status { margin: 0 0 12px; color: var(--secondary-text-color); font-size: 0.85rem; }
          label { display: block; margin: 0 0 8px; font-size: 0.8rem; }
          input, select, button { width: 100%; min-height: 44px; margin-top: 4px; border-radius: 10px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); font: inherit; }
          button.secondary { margin-top: 8px; background: var(--card-background-color); color: var(--primary-text-color); }
          #plan { background: var(--primary-color); color: var(--text-primary-color, #fff); font-weight: 600; }
          ul.shop { margin: 8px 0 0; padding-left: 18px; }
          li { margin: 0 0 6px; }
          .day { margin: 0 0 12px; padding: 10px 12px; border-radius: 12px; background: var(--secondary-background-color); }
          .day h3 { margin: 0 0 8px; font-size: 0.95rem; }
        </style>
        <div class="wrap">
          <h2>Steady Batch</h2>
          <p class="note">The calorie number from Hume or MyFitnessPal. The week is planned onto this Home Assistant calendar.</p>
          <label>Daily calories
            <input id="goal" inputmode="numeric" placeholder="1600" />
          </label>
          <button id="plan" type="button">Plan this week</button>
          <p class="status" id="status"></p>
          <div id="days"></div>
          <h2>Shopping list</h2>
          <p class="note">Built from the planned meals. Download it, or send it to the Home Assistant shopping list on your phone.</p>
          <ul class="shop" id="shop"></ul>
          <button id="download" class="secondary" type="button">Download shopping list</button>
          <button id="ha-list" class="secondary" type="button">Add to Home Assistant shopping list</button>
        </div>
      </ha-card>`;
    this._days = root.getElementById("days");
    this._status = root.getElementById("status");
    this._goal = root.getElementById("goal");
    this._shop = root.getElementById("shop");
    this._planned = {};
    root.getElementById("plan").addEventListener("click", () => this._plan());
    root.getElementById("download").addEventListener("click", () => this._download());
    root.getElementById("ha-list").addEventListener("click", () => this._toShoppingList());
    this._renderDays({});
  }

  _dates() {
    const dates = [];
    const now = new Date();
    for (let i = 0; i < 7; i += 1) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      dates.push({
        iso: day.toLocaleDateString("en-CA"),
        label: day.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      });
    }
    return dates;
  }

  _renderDays(planned) {
    this._planned = planned;
    const lines = shoppingLines(planned, this._recipes || []);
    this._shop.innerHTML = lines.length
      ? lines.map((line) => `<li>${esc(line)}</li>`).join("")
      : "<li>Plan the week first.</li>";
    this._days.innerHTML = this._dates().map(({ iso, label }) => `
      <section class="day">
        <h3>${label}</h3>
        ${MEALS.map((meal) => {
          const slot = planned[iso + "|" + meal];
          const current = slot && slot.name ? slot.name : "";
          const options = (this._recipes || []).filter((recipe) => recipe.meal === meal)
            .map((recipe) => `<option ${current === recipe.name ? "selected" : ""}>${esc(recipe.name)}</option>`)
            .join("");
          return `<label>${meal}
            <select data-date="${iso}" data-meal="${meal}">
              <option value="" ${current ? "" : "selected"}>Open</option>
              ${options}
            </select>
          </label>`;
        }).join("")}
      </section>`).join("");
    this._days.querySelectorAll("select").forEach((select) => {
      select.addEventListener("change", () => this._save(select));
    });
  }

  async _ensureRecipes() {
    if (this._recipes) return this._recipes;
    const response = await this._hass.callService(
      "steady_batch",
      "list_recipes",
      {},
      undefined,
      undefined,
      true,
    );
    const body = response?.response || response || {};
    this._recipes = body.recipes || [];
    return this._recipes;
  }

  async _refresh() {
    try {
      await this._ensureRecipes();
      const response = await this._hass.callService(
        "calendar",
        "get_events",
        { duration: { days: 8 } },
        { entity_id: "calendar.steady_batch" },
        undefined,
        true,
      );
      const body = response?.response || response || {};
      const events = body["calendar.steady_batch"]?.events || [];
      const planned = {};
      for (const event of events) {
        const start = String(event.start || "").slice(0, 10);
        const summary = String(event.summary || "");
        const meal = MEALS.find((name) => summary.startsWith(name + ":"));
        if (!meal) continue;
        const label = summary.slice(meal.length + 2);
        planned[start + "|" + meal] = {
          name: label.replace(/ ×2$/, ""),
          servings: label.endsWith("×2") ? 2 : 1,
        };
      }
      this._renderDays(planned);
      const sensor = this._hass.states["sensor.steady_batch_today"];
      if (sensor && sensor.state !== "unknown" && sensor.state !== "unavailable") {
        const protein = sensor.attributes.protein ?? "";
        const goal = sensor.attributes.goal ? ` of ${sensor.attributes.goal}` : "";
        this._status.textContent = `Today: ${sensor.state} cal${goal}${protein === "" ? "" : `, ${protein}g protein`}`;
        if (sensor.attributes.goal) this._goal.value = sensor.attributes.goal;
      }
    } catch (error) {
      this._status.textContent = "Add the Steady Batch integration, then reload this card.";
    }
  }

  async _save(select) {
    const date = select.dataset.date;
    const meal = select.dataset.meal;
    const recipe = select.value;
    this._status.textContent = "Saving…";
    try {
      if (!recipe) await this._hass.callService("steady_batch", "clear_meal", { date, meal });
      else await this._hass.callService("steady_batch", "set_meal", { date, meal, recipe, servings: 1 });
      this._status.textContent = "Saved on the Steady Batch calendar.";
    } catch (error) {
      this._status.textContent = "Couldn't save. Check that Steady Batch is set up.";
    }
  }

  async _plan() {
    const goal = Number(this._goal.value);
    if (!goal || goal < 800) {
      this._status.textContent = "Enter the daily calorie number from Hume or MyFitnessPal.";
      return;
    }
    this._status.textContent = "Planning the week…";
    const dates = this._dates();
    const days = planDays(goal, await this._ensureRecipes());
    try {
      await this._hass.callService("steady_batch", "set_goal", { calories: goal });
      for (let index = 0; index < dates.length; index += 1) {
        const date = dates[index].iso;
        for (const meal of MEALS) {
          const slot = days[index][meal];
          if (!slot) await this._hass.callService("steady_batch", "clear_meal", { date, meal });
          else await this._hass.callService("steady_batch", "set_meal", { date, meal, recipe: slot.name, servings: slot.servings });
        }
      }
      await this._refresh();
      this._status.textContent = "This week is on the Steady Batch calendar.";
    } catch (error) {
      this._status.textContent = "Couldn't plan the week. Add the Steady Batch integration first.";
    }
  }

  _download() {
    const lines = shoppingLines(this._planned, this._recipes || []);
    if (!lines.length) {
      this._status.textContent = "Plan the week first. The list comes from those meals.";
      return;
    }
    const file = new Blob([`${lines.join("\n")}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "steady-batch-shopping-list.txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    this._status.textContent = "Shopping list downloaded.";
  }

  async _toShoppingList() {
    const lines = shoppingLines(this._planned, this._recipes || []);
    if (!lines.length) {
      this._status.textContent = "Plan the week first. The list comes from those meals.";
      return;
    }
    this._status.textContent = "Adding items…";
    try {
      for (const name of lines) {
        await this._hass.callService("shopping_list", "add_item", { name });
      }
      this._status.textContent = `Added ${lines.length} items to the Home Assistant shopping list.`;
    } catch (error) {
      this._status.textContent = "Download still works. To send it to the phone, enable the Shopping List integration.";
    }
  }
}

if (!customElements.get("steady-batch-card")) {
  customElements.define("steady-batch-card", SteadyBatchCard);
}
window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "steady-batch-card")) {
  window.customCards.push({
    type: "steady-batch-card",
    name: "Steady Batch",
    description: "Plan a week of meals to a calorie goal.",
  });
}
