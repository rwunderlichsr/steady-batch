import { createBrowserStore } from "./store.mjs";

const startup = document.getElementById("startup");
try {
  const response = await fetch("./recipes.json");
  if (!response.ok) throw new Error("The recipe catalog could not load. Please reload.");
  const recipes = await response.json();
  const store = createBrowserStore(recipes, localStorage);
  const card = document.querySelector("steady-batch-card");
  card.setConfig({});
  card.hass = store;
  const root = card.shadowRoot;
  root.querySelector("p.note").textContent = "Plan from the full recipe catalog. Your meals and preferences stay in this browser.";
  root.getElementById("ha-list").hidden = true;
  root.getElementById("load").textContent = "Load plan backup";
  // Keep the original card and planning code; adapt only Home Assistant-specific messages.
  const observer = new MutationObserver(() => {
    const status = root.getElementById("status");
    const replacements = {
      "Saved. The app will pick this up.": "Saved in this browser.",
      "Cleared. The app will pick this up.": "Cleared in this browser.",
      "No meals yet. Plan the week on this card, or load a plan from the app.": "No meals yet. Plan the week, or load a plan backup.",
    };
    if (replacements[status.textContent]) status.textContent = replacements[status.textContent];
  });
  observer.observe(root.getElementById("status"), { childList: true, subtree: true });
  document.getElementById("backup").addEventListener("click", () => {
    const state = store.snapshot();
    const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "steady-batch-plan.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  startup.remove();
} catch (error) {
  startup.textContent = error.message;
}
