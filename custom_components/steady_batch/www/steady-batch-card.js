const MEALS = ["Breakfast", "Lunch", "Dinner", "Snack"];
const PROTEINS = ["Chicken", "Turkey", "Beef", "Pork", "Salmon", "Eggs", "Yogurt", "Cottage cheese", "Tuna", "Shrimp", "White fish", "Beans"];
const STYLES = ["Slow Cooker", "Sous Vide", "Casserole", "No cook", "Carnivore", "DASH"];

function esc(value) {
  return String(value).split("\u0026").join("\u0026amp;").split("<").join("\u0026lt;").split('"').join("\u0026quot;");
}

function prepLabel(recipe) {
  const plate = /1 plate/i.test(recipe.servings || "") || String(recipe.key || "").includes("|No cook|");
  if (plate) return "Assemble when you eat it. Not a cook-ahead meal.";
  const days = (String(recipe.tips || "").match(/Fridge (\d+)/i) || [])[1] || (/salmon|shrimp|tuna/i.test(recipe.name) ? "2" : "4");
  const portions = (String(recipe.servings || "").match(/(\d+)\s+portion/i) || [])[1] || "4";
  return `Make ahead. One cook makes ${portions} portions. Fridge ${days} days.`;
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

function numberSource(recipe) {
  const published = String(recipe.key || "").includes("|DASH|") || String(recipe.tips || "").indexOf("NHLBI") === 0;
  return published ? "NHLBI published serving. Log this number." : "Estimated. Weigh a cooked portion before you treat this as exact.";
}

function marked(set, recipe) {
  return Boolean(set && recipe && (set.has(recipe.name) || set.has(recipe.key)));
}

function ratingOf(map, recipe) {
  if (!map || !recipe) return "";
  return map[recipe.key] || map[recipe.name] || "";
}

function planDays(goal, recipes, count, disliked, liked, skipped, styles) {
  const blocked = disliked || new Set();
  const loved = liked || new Set();
  const out = skipped || new Set();
  const only = styles && styles.size ? styles : null;
  const used = new Set();
  const byMeal = Object.fromEntries(MEALS.map((meal) => [meal, recipes.filter((recipe) => recipe.meal === meal)]));
  const days = [];
  for (let salt = 0; salt < count; salt += 1) {
    const choices = (meal) => {
      const all = (byMeal[meal] || []).filter((recipe) => {
        if (marked(blocked, recipe)) return false;
        const parts = String(recipe.key || "").split("|");
        if (out.has(parts[1])) return false;
        if (only && !only.has(parts[2])) return false;
        return true;
      });
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
                  if (marked(loved, breakfast)) score -= 25;
                  if (marked(loved, lunch)) score -= 25;
                  if (marked(loved, dinner)) score -= 25;
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

function recipeFromDescription(description, name) {
  const text = String(description || "");
  if (text.indexOf("Ingredients") === -1) return null;
  const ingredients = [];
  const instructions = [];
  let mode = "";
  let done = "";
  for (const line of text.split("\n")) {
    if (line === "Ingredients") {
      mode = "ing";
      continue;
    }
    if (line === "Steps") {
      mode = "step";
      continue;
    }
    if (line.startsWith("Done when:")) {
      done = line.slice(10).trim();
      mode = "";
      continue;
    }
    if (line.startsWith("calories:") || line.startsWith("protein:") || line.startsWith("servings:") || line.startsWith("recipe_key:")) {
      mode = "";
      continue;
    }
    if (mode === "ing" && line.startsWith("- ")) ingredients.push(line.slice(2).trim());
    if (mode === "step" && /^\d+\./.test(line)) instructions.push(line.replace(/^\d+\.\s*/, ""));
  }
  if (!ingredients.length && !instructions.length) return null;
  return {
    name,
    key: "",
    calories: (text.match(/(\d[\d,]*)\s*cal/i) || [])[1] || "",
    protein: (text.match(/(\d[\d,]*)\s*g protein/i) || [])[1] ? `${(text.match(/(\d[\d,]*)\s*g protein/i) || [])[1]}g` : "",
    carbs: (text.match(/(\d[\d,]*g)\s*carbs/i) || [])[1] || "",
    ingredients,
    instructions,
    doneWhen: done,
    time: "",
    tips: "",
    servings: "",
  };
}

function unwrap(response) {
  if (!response || typeof response !== "object") return {};
  if (response.response && typeof response.response === "object") return response.response;
  if (response.service_response && typeof response.service_response === "object") return response.service_response;
  return response;
}

async function serviceData(hass, domain, service, data, target) {
  const response = await hass.callService(domain, service, data || {}, target, false, true);
  return unwrap(response);
}

async function fetchStaticRecipes() {
  const all = [];
  for (let index = 1; index <= 12; index += 1) {
    const name = String(index).padStart(2, "0");
    let response;
    try {
      response = await fetch(`/steady_batch/recipes/part-${name}.json`, { cache: "no-store" });
    } catch (error) {
      break;
    }
    if (!response.ok) break;
    const data = await response.json();
    if (Array.isArray(data)) all.push(...data);
  }
  return all;
}

async function loadRecipes(hass) {
  const bundled = await fetchStaticRecipes();
  if (bundled.length) return bundled;
  try {
    const body = await serviceData(hass, "steady_batch", "list_recipes");
    return Array.isArray(body.recipes) ? body.recipes : [];
  } catch (error) {
    return [];
  }
}

function absorbDescriptions(planned, recipes) {
  const names = new Set(recipes.map((recipe) => recipe.name));
  for (const slot of Object.values(planned)) {
    if (!slot || !slot.name || names.has(slot.name)) continue;
    const parsed = recipeFromDescription(slot.description, slot.name);
    if (!parsed) continue;
    recipes.push(parsed);
    names.add(slot.name);
  }
}

function findRecipe(recipes, name) {
  return (recipes || []).find((item) => item.name === name) || null;
}

const CARD_CSS = `
  :host { display: block; }
  .wrap { padding: 4px 0 8px; }
  .head { padding: 14px 16px 12px; }
  .kicker { margin: 0; font-size: 0.68rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--secondary-text-color); }
  .headrow { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; }
  h2 { margin: 2px 0 0; font-size: 1.45rem; line-height: 1.1; letter-spacing: -0.02em; }
  .goalnum { text-align: right; }
  .goalnum strong { display: block; font-size: 1.55rem; line-height: 1; font-variant-numeric: tabular-nums; letter-spacing: -0.03em; }
  .goalnum span, .muted { color: var(--secondary-text-color); font-size: 0.78rem; }
  .bar { height: 6px; margin-top: 12px; border-radius: 99px; overflow: hidden; background: color-mix(in srgb, var(--primary-text-color) 12%, transparent); }
  .bar i { display: block; height: 100%; width: 0; border-radius: 99px; background: var(--primary-color); }
  .bar.over i { background: var(--error-color, #c4473a); }
  .nav { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin: 0 12px 12px; padding: 4px; border-radius: 14px; background: color-mix(in srgb, var(--primary-text-color) 7%, transparent); }
  .nav button { min-height: 36px; border: 0; border-radius: 10px; background: transparent; color: var(--primary-text-color); font: inherit; font-size: 0.78rem; font-weight: 750; }
  .nav button[aria-pressed="true"] { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .panel { padding: 0 16px 8px; }
  .seg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; padding: 4px; margin: 0 0 10px; border-radius: 12px; background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
  .seg button { min-height: 34px; border: 0; border-radius: 9px; background: transparent; color: var(--primary-text-color); font: inherit; font-size: 0.85rem; font-weight: 650; }
  .seg button[aria-pressed="true"] { background: var(--card-background-color); color: var(--primary-color); box-shadow: 0 1px 2px rgba(0,0,0,.15); }
  .planrow { display: grid; grid-template-columns: 7.5rem 1fr; gap: 8px; align-items: end; margin: 0 0 8px; }
  label.field, p.field { display: block; margin: 8px 0 0; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--secondary-text-color); }
  .status.pad { padding: 0 16px; }
  input, select { width: 100%; min-height: 42px; margin-top: 4px; border-radius: 12px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); font: inherit; font-size: 1rem; padding: 0 10px; }
  #plan, #print { min-height: 42px; border: 0; border-radius: 12px; background: var(--primary-color); color: var(--text-primary-color, #fff); font: inherit; font-weight: 700; }
  .status { min-height: 1.2em; margin: 0 0 8px; color: var(--secondary-text-color); font-size: 0.82rem; }
  #days { display: grid; gap: 10px; padding: 0 12px; }
  .day { margin: 0; padding: 8px; border: 1px solid var(--divider-color); border-radius: 14px; background: color-mix(in srgb, var(--primary-text-color) 3%, var(--card-background-color)); }
  .day.today { border-color: color-mix(in srgb, var(--primary-color) 50%, var(--divider-color)); }
  button.dayhead { width: 100%; display: block; text-align: left; min-height: 42px; margin: 0; padding: 8px 10px; border: 0; border-radius: 10px; background: transparent; color: inherit; font: inherit; }
  button.dayhead strong { display: block; font-size: 0.95rem; }
  button.dayhead em { display: block; margin-top: 2px; font-style: normal; font-size: 0.8rem; color: var(--secondary-text-color); }
  .daytop { display: flex; justify-content: space-between; align-items: baseline; padding: 2px 6px 4px; }
  .daytop h3 { margin: 0; font-size: 0.95rem; }
  .tally { font-size: 0.75rem; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  button.meal { width: 100%; display: grid; grid-template-columns: 4.8rem minmax(0, 1fr) auto; gap: 8px; align-items: center; text-align: left; min-height: 42px; margin: 0; padding: 6px 8px; border: 0; border-radius: 10px; background: transparent; color: inherit; font: inherit; }
  button.meal[aria-pressed="true"], button.meal:hover { background: color-mix(in srgb, var(--primary-color) 12%, transparent); }
  .slotname { font-size: 0.66rem; font-weight: 750; letter-spacing: 0.05em; text-transform: uppercase; color: var(--secondary-text-color); }
  .dish { font-size: 0.95rem; font-weight: 650; line-height: 1.25; }
  button.meal.empty .dish { font-weight: 500; color: var(--secondary-text-color); }
  .kcal { font-size: 0.75rem; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .sheet { margin: 4px 4px 6px; padding: 10px 10px 6px; border-radius: 12px; background: var(--card-background-color); border: 1px solid var(--divider-color); }
  .sheet h3, .sheet h4 { margin: 12px 0 6px; font-size: 0.95rem; }
  .macros { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px; }
  .macros span { font-size: 0.75rem; font-weight: 700; padding: 3px 8px; border-radius: 999px; background: color-mix(in srgb, var(--primary-color) 14%, transparent); }
  .note { margin: 0 0 8px; color: var(--secondary-text-color); font-size: 0.82rem; }
  .sheet ul, .sheet ol { margin: 0; padding-left: 1.15rem; }
  .sheet li { margin: 0 0 6px; }
  label.check { display: flex; gap: 8px; align-items: flex-start; }
  label.check input { width: 1.05rem; min-height: 1.05rem; margin: 0.15rem 0 0; }
  .rate, .links { display: flex; gap: 8px; margin: 8px 0; }
  .rate button, .links button, #clear-slot, .matches button, #send { min-height: 36px; border-radius: 999px; border: 1px solid var(--divider-color); background: transparent; color: var(--primary-text-color); font: inherit; font-size: 0.85rem; font-weight: 650; }
  .rate button { flex: 1; }
  .rate button[aria-pressed="true"] { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: transparent; }
  .matches { display: grid; gap: 6px; margin: 8px 0; }
  .matches button { text-align: left; padding: 8px 10px; border-radius: 12px; }
  .matches small { display: block; font-weight: 500; color: var(--secondary-text-color); }
  #clear-slot { width: 100%; color: var(--error-color, #c4473a); }
  details.tools { margin: 8px 16px 4px; }
  details summary { cursor: pointer; font-weight: 700; padding: 8px 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 4px; }
  .chips button { width: auto; min-height: 30px; padding: 2px 10px; border-radius: 999px; border: 1px solid var(--divider-color); background: transparent; color: inherit; font: inherit; font-size: 0.78rem; }
  .chips button[aria-pressed="true"] { background: color-mix(in srgb, var(--primary-color) 16%, transparent); border-color: var(--primary-color); color: var(--primary-color); }
  #skip button[aria-pressed="true"] { text-decoration: line-through; color: var(--secondary-text-color); background: transparent; border-color: var(--divider-color); }
  .links button { border: 0; padding: 0 2px; min-height: 32px; color: var(--primary-color); background: transparent; }
  .shop { margin: 12px 16px 8px; padding-top: 8px; border-top: 1px solid var(--divider-color); }
  .shop h2 { font-size: 1.2rem; }
  ul.list { list-style: none; margin: 0 0 10px; padding: 0; }
  ul.list li { border-bottom: 1px solid var(--divider-color); }
  ul.list label { display: flex; gap: 8px; align-items: flex-start; padding: 8px 0; font-size: 0.92rem; }
  ul.list input { width: 1.05rem; min-height: 1.05rem; margin-top: 0.2rem; }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  #file { display: none; }
`;

class SteadyBatchCard extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    const span = this._config.span;
    if (span === "day" || span === "week" || span === "month") this._fixedSpan = span;
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
        <style>${CARD_CSS}</style>
        <div class="wrap">
          <div class="head">
            <p class="kicker">Steady Batch</p>
            <div class="headrow">
              <h2 id="title">Today's menu</h2>
              <p class="goalnum"><strong id="today-cal">—</strong><span id="today-meta">calories today</span></p>
            </div>
            <div class="bar" aria-hidden="true"><i id="bar"></i></div>
          </div>
          <p class="status pad" id="status">Loading your menu…</p>
          <nav class="nav" id="views">
            <button type="button" data-view="menu" aria-pressed="true">Menu</button>
            <button type="button" data-view="recipe">Recipe</button>
            <button type="button" data-view="shop">Shop</button>
            <button type="button" data-view="plan">Plan</button>
          </nav>
          <div id="view-menu"><div id="days"></div></div>
          <div id="view-recipe" hidden>
            <div class="panel" id="recipe-body"><p class="note">Tap a meal on the menu.</p></div>
          </div>
          <section class="shop" id="view-shop" hidden>
            <div class="panel">
              <h2>Grocery list</h2>
              <p class="status" id="gstatus"></p>
              <div class="seg" id="gspan">
                <button type="button" data-span="day">Today</button>
                <button type="button" data-span="week" aria-pressed="true">Week</button>
                <button type="button" data-span="month">Month</button>
              </div>
              <ul class="list" id="glist"></ul>
              <div class="actions">
                <button id="print" type="button">Print</button>
                <button id="send" type="button">Send</button>
              </div>
            </div>
          </section>
          <section id="view-plan" hidden>
            <div class="panel">
              <h2>Build the menu</h2>
              <p class="note">Calories from Hume or MyFitnessPal. Styles and proteins limit the next plan. Likes are used first. Dislikes are left out.</p>
              <div class="seg" id="span">
                <button type="button" data-span="day">Day</button>
                <button type="button" data-span="week" aria-pressed="true">Week</button>
                <button type="button" data-span="month">Month</button>
              </div>
              <div class="planrow">
                <label class="field">Calories
                  <input id="goal" inputmode="numeric" placeholder="1600" />
                </label>
                <button id="plan" type="button">Plan the week</button>
              </div>
              <p class="field">How it is cooked</p>
              <div class="chips" id="styles"></div>
              <p class="field">Leave a protein out</p>
              <div class="chips" id="skip"></div>
              <div class="links">
                <button id="refresh" type="button">Refresh</button>
                <button id="load" type="button">Load a plan file</button>
              </div>
            </div>
          </section>
          <input id="file" type="file" accept="application/json,.json" />
        </div>
      </ha-card>`;
    this._status = root.getElementById("status");
    this._days = root.getElementById("days");
    this._goal = root.getElementById("goal");
    this._planButton = root.getElementById("plan");
    this._gstatus = root.getElementById("gstatus");
    this._glist = root.getElementById("glist");
    this._todayCal = root.getElementById("today-cal");
    this._todayMeta = root.getElementById("today-meta");
    this._bar = root.getElementById("bar");
    this._planned = {};
    this._recipes = [];
    this._span = this._fixedSpan || "week";
    this._gspan = "week";
    this._open = null;
    this._ratings = {};
    this._query = "";
    this._skip = new Set();
    this._styles = new Set();
    this._view = "menu";
    const titles = { day: "Today", week: "This week", month: "This month" };
    if (this._fixedSpan) {
      root.getElementById("span").hidden = true;
      root.getElementById("title").textContent = titles[this._fixedSpan];
      this._planButton.textContent = this._fixedSpan === "month" ? "Plan the month" : this._fixedSpan === "day" ? "Plan today" : "Plan the week";
      this._span = this._fixedSpan;
    }
    try {
      const saved = JSON.parse(localStorage.getItem("steady-batch-skip") || "[]");
      if (Array.isArray(saved)) saved.filter((name) => PROTEINS.includes(name)).forEach((name) => this._skip.add(name));
    } catch (error) {
      this._skip = new Set();
    }
    const skip = root.getElementById("skip");
    PROTEINS.forEach((name) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.protein = name;
      button.addEventListener("click", () => {
        if (this._skip.has(name)) this._skip.delete(name);
        else this._skip.add(name);
        localStorage.setItem("steady-batch-skip", JSON.stringify([...this._skip]));
        this._paintSkip();
        this._hass.callService("steady_batch", "set_preferences", { ratings: this._ratings || {}, skip_proteins: [...this._skip] }).catch(() => {});
      });
      skip.appendChild(button);
    });
    this._paintSkip = () => {
      skip.querySelectorAll("button").forEach((button) => {
        const off = this._skip.has(button.dataset.protein);
        button.textContent = button.dataset.protein;
        button.setAttribute("aria-pressed", off ? "true" : "false");
      });
    };
    this._paintSkip();
    const styles = root.getElementById("styles");
    try {
      const savedStyles = JSON.parse(localStorage.getItem("steady-batch-styles") || "[]");
      if (Array.isArray(savedStyles)) savedStyles.filter((name) => STYLES.includes(name)).forEach((name) => this._styles.add(name));
    } catch (error) {
      this._styles = new Set();
    }
    STYLES.forEach((name) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.style = name;
      button.addEventListener("click", () => {
        if (this._styles.has(name)) this._styles.delete(name);
        else this._styles.add(name);
        localStorage.setItem("steady-batch-styles", JSON.stringify([...this._styles]));
        this._paintStyles();
      });
      styles.appendChild(button);
    });
    this._paintStyles = () => {
      styles.querySelectorAll("button").forEach((button) => {
        const on = this._styles.has(button.dataset.style);
        button.textContent = button.dataset.style;
        button.setAttribute("aria-pressed", on ? "true" : "false");
      });
    };
    this._paintStyles();
    root.getElementById("views").addEventListener("click", (event) => {
      const view = event.target && event.target.dataset && event.target.dataset.view;
      if (!view) return;
      this._show(view);
      if (view === "recipe") this._fillSheet();
    });
    root.getElementById("plan").addEventListener("click", () => this._plan());
    root.getElementById("refresh").addEventListener("click", () => {
      this._recipes = [];
      this._status.textContent = "Refreshing…";
      this._refresh();
    });
    root.getElementById("load").addEventListener("click", () => root.getElementById("file").click());
    root.getElementById("file").addEventListener("change", (event) => this._loadFile(event.target.files && event.target.files[0]));
    root.getElementById("span").addEventListener("click", (event) => {
      const span = event.target && event.target.dataset && event.target.dataset.span;
      if (!span || this._fixedSpan) return;
      this._span = span;
      this._mark(root.getElementById("span"), "span", span);
      this._planButton.textContent = span === "month" ? "Plan the month" : span === "day" ? "Plan today" : "Plan the week";
      this._render();
    });
    root.getElementById("gspan").addEventListener("click", (event) => {
      const span = event.target && event.target.dataset && event.target.dataset.span;
      if (!span) return;
      this._gspan = span;
      this._mark(root.getElementById("gspan"), "span", span);
      this._paintGrocery();
    });
    root.getElementById("print").addEventListener("click", () => this._print());
    root.getElementById("send").addEventListener("click", () => this._send());
    this._show("menu");
    this._render();
  }

  _show(view) {
    this._view = view;
    const root = this.shadowRoot;
    ["menu", "recipe", "shop", "plan"].forEach((name) => {
      const panel = root.getElementById(`view-${name}`);
      if (panel) panel.hidden = name !== view;
    });
    this._mark(root.getElementById("views"), "view", view);
    const titles = { menu: "Today's menu", recipe: "Recipe", shop: "Grocery list", plan: "Plan" };
    const title = root.getElementById("title");
    if (title) title.textContent = titles[view] || "Today's menu";
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
    const span = this._fixedSpan || this._span;
    if (span === "day") return 1;
    if (span === "month") return 31;
    return 7;
  }

  _gcount() {
    if (this._gspan === "day") return 1;
    if (this._gspan === "month") return 31;
    return 7;
  }

  async _refresh() {
    try {
      this._recipes = await loadRecipes(this._hass);
      try {
        const ratedBody = await serviceData(this._hass, "steady_batch", "get_ratings");
        this._ratings = ratedBody.ratings || {};
        if (Array.isArray(ratedBody.skip_proteins)) {
          this._skip = new Set(ratedBody.skip_proteins.filter((name) => PROTEINS.includes(name)));
          if (this._paintSkip) this._paintSkip();
        }
        if (ratedBody.goal && !this._goal.value) this._goal.value = ratedBody.goal;
      } catch (error) {
        this._ratings = this._ratings || {};
      }
      const body = await serviceData(this._hass, "calendar", "get_events", { duration: { days: 32 } }, { entity_id: "calendar.steady_batch" });
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
          servings: /×2$/.test(label) ? 2 : 1,
          description: event.description || "",
        };
      }
      this._planned = planned;
      absorbDescriptions(planned, this._recipes);
      const sensor = this._hass.states["sensor.steady_batch_today"];
      if (sensor && sensor.attributes && sensor.attributes.goal && !this._goal.value) this._goal.value = sensor.attributes.goal;
      this._render();
      const count = Object.keys(planned).length;
      if (!count) this._status.textContent = this._recipes.length ? `${this._recipes.length} meals ready. Open Plan to build the menu.` : "Meals did not load. Update Steady Batch, then restart Home Assistant.";
      else this._status.textContent = `${count} meals on the menu. Tap one for the recipe.`;
    } catch (error) {
      this._status.textContent = "Add the Steady Batch integration, then restart Home Assistant.";
    }
  }

  _dayTotals(iso) {
    let calories = 0;
    let protein = 0;
    for (const meal of MEALS) {
      const slot = this._planned[iso + "|" + meal];
      if (!slot) continue;
      const recipe = findRecipe(this._recipes, slot.name) || recipeFromDescription(slot.description, slot.name);
      const count = slot.servings === 2 ? 2 : 1;
      if (!recipe) continue;
      calories += amount(recipe.calories) * count;
      protein += amount(recipe.protein) * count;
    }
    return { calories, protein };
  }

  _paintHeader(dates) {
    const today = dates[0];
    const totals = today ? this._dayTotals(today.iso) : { calories: 0, protein: 0 };
    const goal = Number(this._goal && this._goal.value) || 0;
    this._todayCal.textContent = totals.calories ? String(Math.round(totals.calories)) : "—";
    this._todayMeta.textContent = goal ? `of ${goal} · ${Math.round(totals.protein)}g protein` : `${Math.round(totals.protein)}g protein today`;
    const pct = goal ? Math.min(100, Math.round((totals.calories / goal) * 100)) : 0;
    this._bar.style.width = `${pct}%`;
    this._bar.parentElement.classList.toggle("over", Boolean(goal && totals.calories > goal));
  }

  _render() {
    const dates = this._dates(this._spanCount());
    this._paintHeader(dates);
    const todayIso = dates[0] && dates[0].iso;
    this._days.innerHTML = dates
      .map(({ iso, label }) => {
        const totals = this._dayTotals(iso);
        const isToday = iso === todayIso;
        const expanded = isToday || this._openDay === iso || this._spanCount() === 1;
        const preview = MEALS.map((meal) => {
          const slot = this._planned[iso + "|" + meal];
          return slot && slot.name ? slot.name : "";
        }).filter(Boolean).join(" · ");
        const meals = MEALS.map((meal) => {
          const slot = this._planned[iso + "|" + meal];
          if (!expanded) return "";
          if (!isToday && !(slot && slot.name) && !(this._open && this._open.iso === iso && this._open.meal === meal)) return "";
          const recipe = slot ? findRecipe(this._recipes, slot.name) || recipeFromDescription(slot.description, slot.name) : null;
          const count = slot && slot.servings === 2 ? 2 : 1;
          const open = this._open && this._open.iso === iso && this._open.meal === meal;
          const title = slot && slot.name ? `${slot.name}${count === 2 ? " ×2" : ""}` : "Add";
          const kcal = recipe ? `${Math.round(amount(recipe.calories) * count)}` : "";
          return `<div class="slotwrap">
            <button class="meal${slot && slot.name ? "" : " empty"}" type="button" data-date="${iso}" data-meal="${meal}" aria-pressed="${open ? "true" : "false"}">
              <span class="slotname">${meal}</span>
              <span class="dish">${esc(title)}</span>
              <span class="kcal">${kcal}</span>
            </button>
          </div>`;
        }).join("");
        if (!isToday && !preview && !expanded) return "";
        const head = isToday
          ? `<div class="daytop"><h3>Today</h3><span class="tally">${totals.calories ? `${Math.round(totals.calories)} cal` : esc(label)}</span></div>`
          : `<button class="dayhead" type="button" data-day="${iso}" aria-expanded="${expanded ? "true" : "false"}"><strong>${esc(label)}${totals.calories ? ` · ${Math.round(totals.calories)} cal` : ""}</strong><em>${esc(preview || "Nothing planned")}</em></button>`;
        return `<section class="day${isToday ? " today" : ""}">${head}${expanded ? meals : ""}</section>`;
      })
      .join("");
    this._days.querySelectorAll("button.dayhead").forEach((button) => {
      button.addEventListener("click", () => {
        this._openDay = this._openDay === button.dataset.day ? null : button.dataset.day;
        this._render();
      });
    });
    this._days.querySelectorAll("button.meal").forEach((button) => {
      button.addEventListener("click", () => {
        const same = this._open && this._open.iso === button.dataset.date && this._open.meal === button.dataset.meal;
        this._open = same ? null : { iso: button.dataset.date, meal: button.dataset.meal };
        this._query = "";
        this._swapOpen = false;
        this._render();
        if (this._open) {
          this._show("recipe");
          this._fillSheet();
        }
      });
    });
    this._paintGrocery();
  }

  _fillSheet() {
    const sheet = this.shadowRoot && this.shadowRoot.getElementById("recipe-body");
    if (!sheet) return;
    if (!this._open) {
      sheet.innerHTML = `<p class="note">Tap a meal on the menu. The recipe, the ingredients, and the steps open here.</p>`;
      return;
    }
    const slot = this._planned[this._open.iso + "|" + this._open.meal];
    const recipe = slot ? findRecipe(this._recipes, slot.name) || recipeFromDescription(slot.description, slot.name) : null;
    const choices = (this._recipes || []).filter((item) => item.meal === this._open.meal || String(item.key || "").startsWith(this._open.meal + "|"));
    const needle = this._query.trim().toLowerCase();
    const matches = choices.filter((item) => !needle || item.name.toLowerCase().includes(needle)).slice(0, 6);
    const matchButtons = matches
      .map(
        (item) =>
          `<button type="button" data-recipe="${esc(item.name)}">${esc(item.name)}<small>${esc(item.protein)} protein · ${esc(item.calories)} cal</small></button>`,
      )
      .join("");
    const count = slot && slot.servings === 2 ? 2 : 1;
    const rating = recipe ? ratingOf(this._ratings, recipe) : "";
    const body = recipe
      ? `<div class="macros">
          <span>${esc(Math.round(amount(recipe.calories) * count))} cal</span>
          <span>${esc(Math.round(amount(recipe.protein) * count))}g protein</span>
          <span>${esc(recipe.carbs || "")} carbs</span>
        </div>
        <p class="note">${esc(numberSource(recipe))}</p>
        <h4>Ingredients</h4>
        <ul>${(recipe.ingredients || []).map((item) => `<li><label class="check"><input type="checkbox" /> <span>${esc(count === 2 ? item : item)}</span></label></li>`).join("") || "<li>No ingredients on this one.</li>"}</ul>
        <h4>Make it</h4>
        <ol>${(recipe.instructions || []).map((step) => `<li>${esc(step)}</li>`).join("") || "<li>No steps on this one.</li>"}</ol>
        <p class="note">${esc(prepLabel(recipe))}</p>
        ${recipe.doneWhen ? `<p class="note">${esc(recipe.doneWhen)}</p>` : ""}
        <div class="rate">
          <button type="button" data-rate="like" aria-pressed="${rating === "like" ? "true" : "false"}">Like</button>
          <button type="button" data-rate="dislike" aria-pressed="${rating === "dislike" ? "true" : "false"}">Dislike</button>
        </div>`
      : `<p class="note">${this._recipes.length ? "Nothing planned yet. Pick one below." : "Recipes are not on this card yet. Update Steady Batch in HACS and restart Home Assistant."}</p>`;
    sheet.innerHTML = `
      <h3>${recipe ? esc(recipe.name) : esc(this._open.meal)}</h3>
      ${body}
      <details>
        <summary>Change this meal</summary>
        <label class="field">Find a ${esc(this._open.meal.toLowerCase())}
          <input id="find" value="${esc(this._query)}" placeholder="Buffalo, eggs, yogurt" />
        </label>
        <div class="matches">${matchButtons || "<p class='note'>No match in the recipe list.</p>"}</div>
        ${slot && slot.name ? `<button type="button" id="clear-slot">Clear this meal</button>` : ""}
      </details>`;
    const opened = { iso: this._open.iso, meal: this._open.meal };
    const swap = sheet.querySelector("details");
    if (swap) swap.open = Boolean(this._swapOpen);
    const find = sheet.querySelector("#find");
    find.addEventListener("input", () => {
      this._query = find.value;
      this._swapOpen = true;
      this._fillSheet();
      const next = this.shadowRoot.getElementById("recipe-body").querySelector("#find");
      if (next) {
        next.focus();
        const end = next.value.length;
        next.setSelectionRange(end, end);
      }
    });
    sheet.querySelectorAll("[data-recipe]").forEach((button) => {
      button.addEventListener("click", () => this._saveSlot(opened.iso, opened.meal, button.dataset.recipe));
    });
    const clear = sheet.querySelector("#clear-slot");
    if (clear) clear.addEventListener("click", () => this._saveSlot(opened.iso, opened.meal, ""));
    sheet.querySelectorAll("[data-rate]").forEach((button) => {
      button.addEventListener("click", () => recipe && this._rate(recipe.name, button.dataset.rate));
    });
  }

  _groceryDates() {
    return this._dates(this._gcount()).map((day) => day.iso);
  }

  _lines() {
    return shoppingLines(this._planned || {}, this._recipes || [], this._groceryDates());
  }

  _paintGrocery() {
    const lines = this._lines();
    this._glist.innerHTML = lines.length
      ? lines.map((line) => `<li><label class="check"><input type="checkbox" /> <span>${esc(line)}</span></label></li>`).join("")
      : "";
    this._gstatus.textContent = lines.length
      ? `${lines.length} items from the meals above.`
      : "The list fills in after you plan the week.";
  }

  _print() {
    const lines = this._lines();
    if (!lines.length) {
      this._gstatus.textContent = "Nothing to print until the week is planned.";
      return;
    }
    const page = window.open("", "_blank", "noopener,width=720,height=900");
    if (!page) {
      this._gstatus.textContent = "The browser blocked the print window. Allow pop-ups, then press Print again.";
      return;
    }
    const items = lines.map((line) => `<li>${esc(line)}</li>`).join("");
    page.document.write(`<!doctype html><title>Grocery list</title><style>body{font:16px system-ui;margin:32px}h1{font-size:22px}li{margin:0 0 8px}</style><h1>Grocery list</h1><ul>${items}</ul>`);
    page.document.close();
    page.focus();
    page.print();
  }

  async _send() {
    const lines = this._lines();
    if (!lines.length) return;
    const text = lines.join("\n");
    if (navigator.share) {
      try {
        await navigator.share({ title: "Grocery list", text });
        return;
      } catch (error) {
        if (error && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      this._gstatus.textContent = "Grocery list copied.";
    } catch (error) {
      window.location.href = `mailto:?subject=${encodeURIComponent("Grocery list")}&body=${encodeURIComponent(text)}`;
    }
  }

  async _saveSlot(date, meal, recipe) {
    this._status.textContent = "Saving…";
    try {
      if (!recipe) await this._hass.callService("steady_batch", "clear_meal", { date, meal });
      else await this._hass.callService("steady_batch", "set_meal", { date, meal, recipe, servings: 1 });
      await this._refresh();
      this._open = { iso: date, meal };
      this._render();
      this._status.textContent = recipe ? "Saved." : "Cleared.";
    } catch (error) {
      this._status.textContent = "Couldn't save that change.";
    }
  }

  async _plan() {
    const goal = Number(this._goal.value) || 1600;
    if (!this._goal.value) this._goal.value = "1600";
    if (goal < 800) {
      this._status.textContent = "Enter the daily calorie number from Hume or MyFitnessPal.";
      return;
    }
    const dates = this._dates(this._spanCount());
    this._status.textContent = "Planning…";
    try {
      if (!this._recipes.length) this._recipes = await loadRecipes(this._hass);
      if (!this._recipes.length) throw new Error("Recipes did not load. Update Steady Batch in HACS and restart Home Assistant.");
      const blocked = new Set(Object.entries(this._ratings || {}).filter((entry) => entry[1] === "dislike").map((entry) => entry[0]));
      const loved = new Set(Object.entries(this._ratings || {}).filter((entry) => entry[1] === "like").map((entry) => entry[0]));
      const days = planDays(goal, this._recipes, dates.length, blocked, loved, this._skip, this._styles);
      const meals = [];
      dates.forEach((day, index) => {
        for (const meal of MEALS) {
          const slot = days[index] && days[index][meal];
          if (slot) meals.push({ date: day.iso, meal, recipe: slot.name, servings: slot.servings });
        }
      });
      if (!meals.length) throw new Error("No meals fit that calorie number.");
      await this._hass.callService("steady_batch", "set_goal", { calories: goal });
      await this._hass.callService("steady_batch", "import_plan", { meals, replace: false, dates: dates.map((day) => day.iso) });
      this._didAuto = false;
      await this._refresh();
      this._show("menu");
      this._status.textContent = dates.length > 7 ? "Month is on the menu. Tap a meal for the recipe." : "Menu is ready. Tap a meal for the recipe. Shop has the grocery list.";
    } catch (error) {
      this._status.textContent = error && error.message ? error.message : "Couldn't plan. Add the Steady Batch integration first.";
    }
  }

  async _rate(name, rating) {
    const recipe = findRecipe(this._recipes, name);
    const id = recipe && recipe.key ? recipe.key : name;
    const next = ratingOf(this._ratings, recipe || { name, key: id }) === rating ? "none" : rating;
    try {
      await this._hass.callService("steady_batch", "set_rating", { recipe: id, rating: next });
      if (recipe) {
        delete this._ratings[recipe.name];
        delete this._ratings[recipe.key];
      }
      delete this._ratings[name];
      if (next !== "none") this._ratings[id] = next;
      this._fillSheet();
      this._status.textContent = next === "dislike" ? "Disliked. The next plan will skip it." : next === "like" ? "Liked." : "Rating cleared.";
    } catch (error) {
      this._status.textContent = "Couldn't save that rating.";
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
      this._didAuto = false;
      await this._refresh();
      this._status.textContent = `Loaded ${meals.length} meals.`;
    } catch (error) {
      this._status.textContent = error && error.message ? error.message : "Couldn't load that plan.";
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
    description: "Meal plan, recipe, and grocery list.",
  });
}

class SteadyBatchGroceryCard extends HTMLElement {
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
    return 6;
  }

  _build() {
    this._built = true;
    this._span = "week";
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <ha-card>
        <style>${CARD_CSS}</style>
        <div class="wrap">
          <div class="head"><p class="kicker">Steady Batch</p><h2>Grocery list</h2></div>
          <div class="pad">
            <p class="status" id="status"></p>
            <div class="seg" id="span">
              <button type="button" data-span="day">Today</button>
              <button type="button" data-span="week" aria-pressed="true">Week</button>
              <button type="button" data-span="month">Month</button>
            </div>
            <ul class="list" id="list"></ul>
            <div class="actions">
              <button id="print" type="button">Print</button>
              <button id="send" type="button">Send</button>
            </div>
          </div>
        </div>
      </ha-card>`;
    this._status = root.getElementById("status");
    this._list = root.getElementById("list");
    this._planned = {};
    this._recipes = [];
    root.getElementById("span").addEventListener("click", (event) => {
      const span = event.target && event.target.dataset && event.target.dataset.span;
      if (!span) return;
      this._span = span;
      root.querySelectorAll("#span button").forEach((button) => {
        button.setAttribute("aria-pressed", button.dataset.span === span ? "true" : "false");
      });
      this._render();
    });
    root.getElementById("print").addEventListener("click", () => {
      const lines = this._lines();
      if (!lines.length) return;
      const page = window.open("", "_blank", "noopener,width=720,height=900");
      if (!page) {
        this._status.textContent = "Allow pop-ups, then press Print again.";
        return;
      }
      page.document.write(`<!doctype html><title>Grocery list</title><style>body{font:16px system-ui;margin:32px}li{margin:0 0 8px}</style><h1>Grocery list</h1><ul>${lines.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`);
      page.document.close();
      page.focus();
      page.print();
    });
    root.getElementById("send").addEventListener("click", async () => {
      const lines = this._lines();
      if (!lines.length) return;
      const text = lines.join("\n");
      if (navigator.share) {
        try {
          await navigator.share({ title: "Grocery list", text });
          return;
        } catch (error) {
          if (error && error.name === "AbortError") return;
        }
      }
      try {
        await navigator.clipboard.writeText(text);
        this._status.textContent = "Grocery list copied.";
      } catch (error) {
        window.location.href = `mailto:?subject=${encodeURIComponent("Grocery list")}&body=${encodeURIComponent(text)}`;
      }
    });
  }

  _count() {
    if (this._span === "day") return 1;
    if (this._span === "month") return 31;
    return 7;
  }

  _dates() {
    const dates = [];
    const now = new Date();
    for (let i = 0; i < this._count(); i += 1) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      dates.push(day.toLocaleDateString("en-CA"));
    }
    return dates;
  }

  async _refresh() {
    try {
      this._recipes = await loadRecipes(this._hass);
      const body = await serviceData(this._hass, "calendar", "get_events", { duration: { days: 32 } }, { entity_id: "calendar.steady_batch" });
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
          servings: /×2$/.test(label) ? 2 : 1,
          description: event.description || "",
        };
      }
      this._planned = planned;
      absorbDescriptions(planned, this._recipes);
      this._render();
    } catch (error) {
      this._status.textContent = "Add the Steady Batch integration, then restart Home Assistant.";
    }
  }

  _lines() {
    return shoppingLines(this._planned || {}, this._recipes || [], this._dates());
  }

  _render() {
    const lines = this._lines();
    this._list.innerHTML = lines.length
      ? lines.map((line) => `<li><label class="check"><input type="checkbox" /> <span>${esc(line)}</span></label></li>`).join("")
      : "";
    this._status.textContent = lines.length ? `${lines.length} items from the planned meals.` : "Nothing to buy until the week is planned.";
  }
}

if (!customElements.get("steady-batch-grocery")) {
  customElements.define("steady-batch-grocery", SteadyBatchGroceryCard);
}
if (!window.customCards.some((card) => card.type === "steady-batch-grocery")) {
  window.customCards.push({
    type: "steady-batch-grocery",
    name: "Steady Batch grocery list",
    description: "Grocery list for the planned meals, with print and send.",
  });
}
