export const STORAGE_KEY = "steady-batch-github-v1";
const MEALS = ["Breakfast", "Lunch", "Dinner", "Snack"];
const PROTEINS = ["Chicken", "Turkey", "Beef", "Pork", "Salmon", "Eggs", "Yogurt", "Cottage cheese", "Tuna", "Shrimp", "White fish", "Beans"];

export function createBrowserStore(recipes, storage) {
  const empty = () => ({ meals: [], goal: null, ratings: {}, skip_proteins: [] });
  let state = empty();
  const raw = storage.getItem(STORAGE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.meals)) throw new Error("The saved plan could not be read. Your saved data has not been overwritten.");
    state = { ...empty(), ...parsed };
  }
  const validMeal = item => item && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && MEALS.includes(item.meal) && recipes.some(recipe => recipe.name === item.recipe);
  const normalize = item => ({ date: item.date, meal: item.meal, recipe: item.recipe, servings: item.servings === 2 ? 2 : 1 });
  const key = item => item.date + "|" + item.meal;
  function save(next) {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
    state = next;
  }
  return {
    snapshot: () => structuredClone(state),
    states: {},
    async callService(domain, service, data = {}) {
      if (domain === "calendar" && service === "get_events") {
        return { response: { "calendar.steady_batch": { events: state.meals.map(item => ({
          start: item.date + "T12:00:00",
          summary: item.meal + ": " + item.recipe + (item.servings === 2 ? " ×2" : ""),
        })) } } };
      }
      if (domain !== "steady_batch") throw new Error("Home Assistant is not connected to this browser version.");
      if (service === "list_recipes") return { response: { recipes } };
      if (service === "get_ratings") return { response: { ratings: structuredClone(state.ratings), goal: state.goal, skip_proteins: [...state.skip_proteins] } };
      const next = structuredClone(state);
      if (service === "set_goal") {
        const goal = Number(data.calories);
        if (!Number.isInteger(goal) || goal < 800 || goal > 4000) throw new Error("Enter daily calories between 800 and 4000.");
        next.goal = goal;
      } else if (service === "set_preferences") {
        next.ratings = Object.fromEntries(Object.entries(data.ratings || {}).filter(([, value]) => ["like", "dislike"].includes(value)));
        next.skip_proteins = (data.skip_proteins || []).filter(value => PROTEINS.includes(value));
      } else if (service === "set_rating") {
        if (!["like", "dislike", "none"].includes(data.rating)) throw new Error("Invalid rating.");
        if (data.rating === "none") delete next.ratings[data.recipe];
        else next.ratings[data.recipe] = data.rating;
      } else if (service === "clear_meal") {
        next.meals = next.meals.filter(item => key(item) !== key(data));
      } else if (service === "set_meal") {
        if (!validMeal(data)) throw new Error("Invalid meal.");
        next.meals = next.meals.filter(item => key(item) !== key(data));
        next.meals.push(normalize(data));
      } else if (service === "import_plan") {
        if (!Array.isArray(data.meals) || !data.meals.every(validMeal)) throw new Error("The plan contains an unknown recipe, date, or meal.");
        const dates = new Set(data.dates?.length ? data.dates : data.meals.map(item => item.date));
        next.meals = data.replace === false ? next.meals.filter(item => !dates.has(item.date)) : [];
        const merged = new Map(next.meals.map(item => [key(item), item]));
        for (const item of data.meals) merged.set(key(item), normalize(item));
        next.meals = [...merged.values()];
      } else throw new Error("Unknown service: " + service);
      save(next);
      return { response: { saved: next.meals.length } };
    },
  };
}
