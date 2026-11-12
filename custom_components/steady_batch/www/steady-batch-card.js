const MEALS = ["Breakfast", "Lunch", "Dinner", "Snack"];

function esc(value) {
  return String(value).split("\u0026").join("\u0026amp;").split("<").join("\u0026lt;").split('"').join("\u0026quot;");
}

function amount(value) {
  const match = String(value).replace(/,/g, "").match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function shoppingLines(planned, recipes, dates) {
  const counts = new Map();
  for (const iso of dates) {
    for (const meal of MEALS) {
      const slot = planned[iso + "|" + meal];
      if (!slot || !slot.name) continue;
      const recipe = recipes.find((item) => item.name === slot.name);
      if (!recipe) continue;
      const servings = slot.servings === 2 ? 2 : 1;
      for (const line of recipe.ingredients || []) counts.set(line, (counts.get(line) || 0) + servings);
    }
  }
  return [...counts.entries()].map(([line, count]) => (count > 1 ? `${count} × ${line}` : line));
}

function planDays(goal, recipes, count, disliked) {
  const blocked = disliked || new Set();
  const used = new Set();
  const byMeal = Object.fromEntries(MEALS.map((meal) => [meal, recipes.filter((recipe) => recipe.meal === meal)]));
  const days = [];
  for (let salt = 0; salt < count; salt += 1) {
    const choices = (meal) => {
      const all = (byMeal[meal] || []).filter((recipe) => !blocked.has(recipe.name));
      const fresh = all.filter((recipe) => !used.has(recipe.name));
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
                      Breakfast: { name: breakfast.name, servings: bCount },
                      Lunch: { name: lunch.name, servings: lCount },
                      Dinner: { name: dinner.name, servings: dCount },
                      Snack: snack ? { name: snack.name, servings: 1 } : null,
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
      for (const meal of MEALS) if (best[meal]) used.add(best[meal].name);
    }
    days.push(best || {});
  }
  return days;
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
    return 14;
  }

  _build() {
    this._built = true;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <ha-card>
        <style>
          :host { display: block; }
          .wrap { padding: 16px; }
          h2 { margin: 0 0 4px; font-size: 1.35rem; }
          h3 { margin: 0 0 8px; font-size: 1rem; }
          p.note, .status { margin: 0 0 12px; color: var(--secondary-text-color); font-size: 0.9rem; }
          label, select { display: block; margin: 0 0 10px; font-size: 0.85rem; }
          button, input, select { width: 100%; min-height: 44px; border-radius: 10px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); font: inherit; }
          select { margin-top: 4px; }
          .row { display: grid; gap: 8px; margin: 0 0 12px; }
          .row.two { grid-template-columns: 1fr 1fr; }
          .row.three { grid-template-columns: 1fr 1fr 1fr; }
          button[aria-pressed="true"] { background: var(--primary-color); color: var(--text-primary-color, #fff); }
          button.meal { text-align: left; padding: 8px 12px; margin: 0 0 8px; }
          .matches button small, button.meal small { display: block; font-size: 0.85rem; }
          .day { margin: 0 0 12px; padding: 10px 12px; border-radius: 12px; background: var(--secondary-background-color); }
          .recipe { margin: 0 0 16px; padding: 12px; border-radius: 12px; background: var(--secondary-background-color); }
          .recipe ol, .recipe ul, ul.shop { margin: 8px 0 0; padding-left: 1.2rem; }
          .recipe li, ul.shop li { margin: 0 0 8px; }
          label.check { display: flex; gap: 8px; align-items: flex-start; }
          label.check input { width: 1.1rem; min-height: 1.1rem; margin-top: 0.2rem; }
          #plan { background: var(--primary-color); color: var(--text-primary-color, #fff); font-weight: 600; }
          #file { display: none; }
          .matches { display: flex; flex-direction: column; gap: 8px; margin: 0 0 12px; }
          .rate { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 0 0 12px; }
        </style>
        <div class="wrap">
          <h2>Steady Batch</h2>
          <p class="note">This card plans on its own. The Steady Batch app is optional, and changes go both ways when it is connected.</p>
          <label>Daily calories
            <input id="goal" inputmode="numeric" placeholder="From Hume or MyFitnessPal" />
          </label>
          <button id="plan" type="button">Plan this week</button>
          <input id="file" type="file" accept="application/json,.json" />
          <button id="load" type="button">Load plan from the app</button>
          <p class="status" id="status"></p>
          <div class="row two" id="span">
            <button type="button" data-span="week" aria-pressed="true">Week</button>
            <button type="button" data-span="month" aria-pressed="false">Month</button>
          </div>
          <article class="recipe" id="recipe" hidden></article>
          <div id="days"></div>
          <h2>Shopping list</h2>
          <div class="row three" id="shop-span">
            <button type="button" data-shop="day" aria-pressed="false">Day</button>
            <button type="button" data-shop="week" aria-pressed="true">Week</button>
            <button type="button" data-shop="month" aria-pressed="false">Month</button>
          </div>
          <ul class="shop" id="shop"></ul>
          <button id="download" type="button">Download shopping list</button>
          <button id="ha-list" type="button">Add to Home Assistant shopping list</button>
        </div>
      </ha-card>`;
    this._status = root.getElementById("status");
    this._days = root.getElementById("days");
    this._shop = root.getElementById("shop");
    this._recipe = root.getElementById("recipe");
    this._planned = {};
    this._span = "week";
    this._shopSpan = "week";
    this._open = null;
    this._ratings = {};
    this._query = "";
    this._goal = root.getElementById("goal");
    this._planButton = root.getElementById("plan");
    root.getElementById("plan").addEventListener("click", () => this._plan());
    root.getElementById("load").addEventListener("click", () => root.getElementById("file").click());
    root.getElementById("file").addEventListener("change", (event) => this._loadFile(event.target.files && event.target.files[0]));
    root.getElementById("span").addEventListener("click", (event) => {
      const span = event.target && event.target.dataset && event.target.dataset.span;
      if (!span) return;
      this._span = span;
      this._mark(root.getElementById("span"), "span", span);
      this._planButton.textContent = span === "month" ? "Plan this month" : "Plan this week";
      this._render();
    });
    root.getElementById("shop-span").addEventListener("click", (event) => {
      const shop = event.target && event.target.dataset && event.target.dataset.shop;
      if (!shop) return;
      this._shopSpan = shop;
      this._mark(root.getElementById("shop-span"), "shop", shop);
      this._renderShop();
    });
    root.getElementById("download").addEventListener("click", () => this._download());
    root.getElementById("ha-list").addEventListener("click", () => this._toShoppingList());
    this._render();
  }

  _mark(container, key, value) {
    container.querySelectorAll("button").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset[key] === value ? "true" : "false");
    });
  }

  _dates(count) {
    const dates = [];
    const now = new Date();
    for (let i = 0; i < count; i += 1) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      dates.push({
        iso: day.toLocaleDateString("en-CA"),
        label: day.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      });
    }
    return dates;
  }

  _spanCount() {
    return this._span === "month" ? 31 : 7;
  }

  _shopCount() {
    if (this._shopSpan === "day") return 1;
    if (this._shopSpan === "month") return 31;
    return 7;
  }

  async _ensureRecipes() {
    if (this._recipes) return this._recipes;
    const response = await this._hass.callService("steady_batch", "list_recipes", {}, undefined, undefined, true);
    const body = response?.response || response || {};
    this._recipes = body.recipes || [];
    return this._recipes;
  }

  async _refresh() {
    try {
      await this._ensureRecipes();
      try {
        const rated = await this._hass.callService("steady_batch", "get_ratings", {}, undefined, undefined, true);
        const ratedBody = rated?.response || rated || {};
        this._ratings = ratedBody.ratings || {};
        if (ratedBody.goal && !this._goal.value) this._goal.value = ratedBody.goal;
      } catch (error) {
        this._ratings = this._ratings || {};
      }
      const response = await this._hass.callService(
        "calendar",
        "get_events",
        { duration: { days: 32 } },
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
      this._planned = planned;
      const sensor = this._hass.states["sensor.steady_batch_today"];
      if (sensor && sensor.attributes && sensor.attributes.goal && !this._goal.value) {
        this._goal.value = sensor.attributes.goal;
      }
      this._render();
      if (!Object.keys(planned).length) this._status.textContent = "No meals yet. Plan the week on this card, or load a plan from the app.";
    } catch (error) {
      this._status.textContent = "Add the Steady Batch integration, then reload this card.";
    }
  }

  _render() {
    const dates = this._dates(this._spanCount());
    this._days.innerHTML = dates
      .map(({ iso, label }) => {
        const meals = MEALS.map((meal) => {
          const slot = this._planned[iso + "|" + meal];
          const name = slot && slot.name ? slot.name : "Open";
          const pressed = this._open && this._open.iso === iso && this._open.meal === meal;
          return `<button class="meal" type="button" data-date="${iso}" data-meal="${meal}" aria-pressed="${pressed ? "true" : "false"}">${meal}<small>${esc(name)}</small></button>`;
        }).join("");
        return `<section class="day"><h3>${esc(label)}</h3>${meals}</section>`;
      })
      .join("");
    this._days.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        this._open = { iso: button.dataset.date, meal: button.dataset.meal };
        this._render();
      });
    });
    this._renderRecipe();
    this._renderShop();
  }

  _renderRecipe() {
    if (!this._open) {
      this._recipe.hidden = true;
      return;
    }
    const slot = this._planned[this._open.iso + "|" + this._open.meal];
    const recipe = slot && this._recipes ? this._recipes.find((item) => item.name === slot.name) : null;
    const choices = (this._recipes || []).filter((item) => item.meal === this._open.meal || String(item.key || "").startsWith(this._open.meal + "|"));
    const needle = this._query.trim().toLowerCase();
    const matches = choices
      .filter((item) => !needle || item.name.toLowerCase().includes(needle))
      .slice(0, 8);
    const matchButtons = matches
      .map(
        (item) =>
          `<button type="button" data-recipe="${esc(item.name)}" aria-pressed="${recipe && recipe.name === item.name ? "true" : "false"}">${esc(item.name)}<small>${esc(item.protein)} protein · ${esc(item.calories)} cal${this._ratings[item.name] === "dislike" ? " · disliked" : ""}</small></button>`,
      )
      .join("");
    const rating = recipe ? this._ratings[recipe.name] : "";
    const body = recipe
      ? `<div class="rate">
          <button type="button" data-rate="like" aria-pressed="${rating === "like" ? "true" : "false"}">Like</button>
          <button type="button" data-rate="dislike" aria-pressed="${rating === "dislike" ? "true" : "false"}">Dislike</button>
        </div>
        <p class="note">${esc(this._open.meal)} · ${esc(recipe.calories)} cal · ${esc(recipe.protein)} protein · ${esc(recipe.carbs)} carbs · ${esc(recipe.time || "")}</p>
      <h3>Ingredients</h3>
      <ul>${(recipe.ingredients || []).map((item) => `<li><label class="check"><input type="checkbox" /> <span>${esc(item)}</span></label></li>`).join("")}</ul>
      <h3>Make it</h3>
      <ol>${(recipe.instructions || []).map((step) => `<li>${esc(step)}</li>`).join("")}</ol>
      <p class="note">${esc(recipe.doneWhen || "")}</p>`
      : `<p class="note">Nothing planned for that ${esc(this._open.meal.toLowerCase())} yet. Search and tap one.</p>`;
    this._recipe.hidden = false;
    this._recipe.innerHTML = `
      <h2>${recipe ? esc(recipe.name) : esc(this._open.meal)}</h2>
      <label>Find a ${esc(this._open.meal.toLowerCase())}
        <input id="find" value="${esc(this._query)}" placeholder="Buffalo, eggs, yogurt" />
      </label>
      <div class="matches">${matchButtons || "<p class='note'>No match.</p>"}</div>
      <button type="button" id="clear-slot">Clear this meal</button>
      ${body}`;
    const opened = { iso: this._open.iso, meal: this._open.meal };
    const find = this._recipe.querySelector("#find");
    find.addEventListener("input", () => {
      this._query = find.value;
      this._renderRecipe();
      const next = this._recipe.querySelector("#find");
      if (next) {
        next.focus();
        const end = next.value.length;
        next.setSelectionRange(end, end);
      }
    });
    this._recipe.querySelectorAll("[data-recipe]").forEach((button) => {
      button.addEventListener("click", () => this._saveSlot(opened.iso, opened.meal, button.dataset.recipe));
    });
    this._recipe.querySelector("#clear-slot").addEventListener("click", () => this._saveSlot(opened.iso, opened.meal, ""));
    this._recipe.querySelectorAll("[data-rate]").forEach((button) => {
      button.addEventListener("click", () => this._rate(recipe.name, button.dataset.rate));
    });
  }

  async _saveSlot(date, meal, recipe) {
    this._status.textContent = "Saving…";
    try {
      if (!recipe) await this._hass.callService("steady_batch", "clear_meal", { date, meal });
      else await this._hass.callService("steady_batch", "set_meal", { date, meal, recipe, servings: 1 });
      await this._refresh();
      this._open = { iso: date, meal };
      this._render();
      this._status.textContent = recipe ? "Saved. The app will pick this up." : "Cleared. The app will pick this up.";
    } catch (error) {
      this._status.textContent = "Couldn't save that change.";
    }
  }

  async _plan() {
    const goal = Number(this._goal.value);
    if (!goal || goal < 800) {
      this._status.textContent = "Enter the daily calorie number from Hume or MyFitnessPal.";
      return;
    }
    const dates = this._dates(this._spanCount());
    this._status.textContent = "Planning…";
    try {
      const blocked = new Set(Object.entries(this._ratings || {}).filter((entry) => entry[1] === "dislike").map((entry) => entry[0]));
      const days = planDays(goal, await this._ensureRecipes(), dates.length, blocked);
      const meals = [];
      dates.forEach((day, index) => {
        for (const meal of MEALS) {
          const slot = days[index] && days[index][meal];
          if (slot) meals.push({ date: day.iso, meal, recipe: slot.name, servings: slot.servings });
        }
      });
      if (!meals.length) throw new Error("No meals fit that calorie number.");
      await this._hass.callService("steady_batch", "set_goal", { calories: goal });
      await this._hass.callService("steady_batch", "import_plan", {
        meals,
        replace: false,
        dates: dates.map((day) => day.iso),
      });
      await this._refresh();
      this._status.textContent = dates.length > 7 ? "This month is planned on the card." : "This week is planned on the card.";
    } catch (error) {
      this._status.textContent = error && error.message ? error.message : "Couldn't plan. Add the Steady Batch integration first.";
    }
  }

  _renderShop() {
    const dates = this._dates(this._shopCount()).map((day) => day.iso);
    const lines = shoppingLines(this._planned, this._recipes || [], dates);
    this._shop.innerHTML = lines.length ? lines.map((line) => `<li>${esc(line)}</li>`).join("") : "<li>No meals in this range.</li>";
  }

  _shopLines() {
    return shoppingLines(this._planned, this._recipes || [], this._dates(this._shopCount()).map((day) => day.iso));
  }

  _download() {
    const lines = this._shopLines();
    if (!lines.length) {
      this._status.textContent = "Plan a meal first. The list comes from those meals.";
      return;
    }
    const file = new Blob([`${lines.join("\n")}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "steady-batch-shopping-list.txt";
    link.click();
    URL.revokeObjectURL(url);
    this._status.textContent = "Shopping list downloaded.";
  }

  async _toShoppingList() {
    const lines = this._shopLines();
    if (!lines.length) {
      this._status.textContent = "Plan a meal first. The list comes from those meals.";
      return;
    }
    this._status.textContent = "Adding items…";
    try {
      for (const name of lines) await this._hass.callService("shopping_list", "add_item", { name });
      this._status.textContent = `Added ${lines.length} items to the Home Assistant shopping list.`;
    } catch (error) {
      this._status.textContent = "Download still works. To send it to your phone, enable the Shopping List integration.";
    }
  }

  async _rate(name, rating) {
    const next = this._ratings[name] === rating ? "none" : rating;
    try {
      await this._hass.callService("steady_batch", "set_rating", { recipe: name, rating: next });
      if (next === "none") delete this._ratings[name];
      else this._ratings[name] = next;
      this._renderRecipe();
      this._status.textContent = next === "dislike" ? "Disliked. The next plan will skip it." : next === "like" ? "Liked." : "Rating cleared.";
    } catch (error) {
      this._status.textContent = "Couldn't save that rating. Update Steady Batch and restart.";
    }
  }

  async _loadFile(file) {
    if (!file) return;
    this._status.textContent = "Loading…";
    try {
      const body = JSON.parse(await file.text());
      const meals = Array.isArray(body) ? body : body.meals;
      if (!Array.isArray(meals) || !meals.length) throw new Error("That file has no meals.");
      await this._hass.callService("steady_batch", "import_plan", { meals });
      await this._refresh();
      this._status.textContent = `Loaded ${meals.length} meals onto the Steady Batch calendar.`;
    } catch (error) {
      this._status.textContent = error && error.message ? error.message : "Couldn't load that plan. Update Steady Batch, then try the file again.";
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
    description: "Shows the meal plan sent from the Steady Batch app.",
  });
}
