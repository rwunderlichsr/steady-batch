import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, readdir } from 'node:fs/promises';
import { createBrowserStore } from '../web/store.mjs';

const dir = new URL('../custom_components/steady_batch/recipes/', import.meta.url);
const recipes = [];
for (const file of (await readdir(dir)).sort()) recipes.push(...JSON.parse(await readFile(new URL(file, dir), 'utf8')));
const code = await readFile(new URL('../custom_components/steady_batch/www/steady-batch-card.js', import.meta.url), 'utf8');
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
function originalPlanner() {
  const context = vm.createContext({ HTMLElement: class {}, customElements: { get: () => true }, window: {} });
  vm.runInContext(code, context);
  return (...args) => context.planDays(...args);
}

test('original planner uses the full catalog and honors exclusions and dislikes', () => {
  assert.equal(recipes.length, 214);
  const dislikes = new Set(recipes.filter(r => r.meal === 'Breakfast').slice(0, 3).map(r => r.key));
  const days = originalPlanner()(1800, recipes, 7, dislikes, new Set(), new Set(['Chicken']));
  assert.equal(days.length, 7);
  for (const day of days) {
    assert.ok(day.Breakfast && day.Lunch && day.Dinner);
    for (const meal of ['Breakfast', 'Lunch', 'Dinner', 'Snack']) {
      if (!day[meal]) continue;
      const recipe = recipes.find(r => r.name === day[meal].name);
      assert.ok(recipe);
      assert.notEqual(recipe.key.split('|')[1], 'Chicken');
      assert.ok(!dislikes.has(recipe.key));
    }
  }
});

test('browser adapter saves and reloads plan, servings, preferences and goal', async () => {
  const memory = storage();
  const store = createBrowserStore(recipes, memory);
  const call = (service, data) => store.callService('steady_batch', service, data);
  const meal = { date: '2026-11-12', meal: 'Breakfast', recipe: recipes[0].name, servings: 2 };
  await call('set_meal', meal);
  await call('set_goal', { calories: 1800 });
  await call('set_rating', { recipe: recipes[0].key, rating: 'like' });
  await call('set_preferences', { ratings: { [recipes[0].key]: 'like' }, skip_proteins: ['Chicken'] });
  const restored = createBrowserStore(recipes, memory);
  assert.deepEqual(restored.snapshot(), store.snapshot());
  const events = await restored.callService('calendar', 'get_events');
  assert.equal(events.response['calendar.steady_batch'].events[0].summary, 'Breakfast: ' + recipes[0].name + ' ×2');
  await call('clear_meal', meal);
  assert.equal(store.snapshot().meals.length, 0);
});

test('scoped plan replacement preserves unrelated dates; invalid imports preserve data', async () => {
  const store = createBrowserStore(recipes, storage());
  const meal = date => ({ date, meal: 'Breakfast', recipe: recipes[0].name, servings: 1 });
  await store.callService('steady_batch', 'import_plan', { meals: [meal('2026-11-12'), meal('2026-12-12')] });
  await store.callService('steady_batch', 'import_plan', { meals: [], replace: false, dates: ['2026-11-12'] });
  assert.deepEqual(store.snapshot().meals, [meal('2026-12-12')]);
  await assert.rejects(store.callService('steady_batch', 'import_plan', { meals: [{ ...meal('2026-11-12'), recipe: 'missing' }] }));
  assert.equal(store.snapshot().meals.length, 1);
});

test('storage failure does not report a successful save', async () => {
  const store = createBrowserStore(recipes, { getItem: () => null, setItem: () => { throw new Error('Storage full'); } });
  await assert.rejects(store.callService('steady_batch', 'set_goal', { calories: 1800 }), /Storage full/);
  assert.equal(store.snapshot().goal, null);
});
