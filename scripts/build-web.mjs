import { mkdir, readFile, readdir, copyFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = path.join(root, "_site");
await mkdir(out, { recursive: true });
for (const name of await readdir(path.join(root, "web"))) {
  await copyFile(path.join(root, "web", name), path.join(out, name));
}
await copyFile(path.join(root, "custom_components/steady_batch/www/steady-batch-card.js"), path.join(out, "steady-batch-card.js"));
const recipeDir = path.join(root, "custom_components/steady_batch/recipes");
const recipes = [];
for (const name of (await readdir(recipeDir)).filter(name => /^part-.*\.json$/.test(name)).sort()) {
  recipes.push(...JSON.parse(await readFile(path.join(recipeDir, name), "utf8")));
}
await writeFile(path.join(out, "recipes.json"), JSON.stringify(recipes));
await writeFile(path.join(out, ".nojekyll"), "");
await writeFile(path.join(out, "CNAME"), "mealplan.lawfaregroup.com\n");
console.log(`Built original card with ${recipes.length} recipes.`);
