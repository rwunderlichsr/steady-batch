# Steady Batch

After you install it and restart Home Assistant, **Meals** is in the sidebar. That page is the menu, the recipe, the grocery list, and the plan. You do not add a dashboard card.

High protein. Your calorie number from Hume or MyFitnessPal. Slow cooker, sous vide, casserole, no-cook plates, carnivore, and DASH.

## The card

One card. Four views across the top.

| View | What it does |
|---|---|
| Menu | Today’s meals, then the rest of the week one day at a time |
| Recipe | Ingredients, steps, calories, protein. Like or dislike. Swap the meal |
| Shop | Grocery list for today, the week, or the month. Check items off. Print or send |
| Plan | Calorie goal, how long to plan, which proteins to skip, which ways of cooking to keep |

```yaml
type: custom:steady-batch-card
```

Tap a meal on Menu. The recipe opens. Shop is the grocery list for the meals already on the menu.

## Plan options

- Day, week, or month
- Daily calories
- Leave out any protein: chicken, turkey, beef, pork, salmon, eggs, yogurt, cottage cheese, tuna, shrimp, white fish, beans
- Cook only the styles you turn on: Slow Cooker, Sous Vide, Casserole, No cook, Carnivore, DASH. Leave them all off to use every style
- Liked meals get picked first. Disliked meals are skipped

## Grocery card

Optional. The Shop view is already on the meal card.

```yaml
type: custom:steady-batch-grocery
```

## Install with HACS

1. HACS → three dots → **Custom repositories**.
2. `https://github.com/rwunderlichsr/steady-batch` — category **Integration**.
3. Download **Steady Batch**.
4. Restart Home Assistant.
5. Settings → Devices & services → Add integration → **Steady Batch**.

No separate dashboard resource. The card is included.

## Phone

Home Assistant companion app, same dashboard. Menu, recipe, and grocery list are on the card.
