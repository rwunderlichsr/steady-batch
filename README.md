# Steady Batch

A Home Assistant meal planner. Set the daily calorie number from Hume or MyFitnessPal, plan the week, download the shopping list, and open the same card in the Home Assistant phone app.

Repository: https://github.com/rwunderlichsr/steady-batch

## Install with HACS

1. In HACS, open the three-dot menu and choose **Custom repositories**.
2. Paste `https://github.com/rwunderlichsr/steady-batch`. Category: **Integration**.
3. HACS → Integrations → **Steady Batch** → Download.
4. Restart Home Assistant.
5. **Settings → Devices & services → Add integration → Steady Batch**.

The dashboard card is included. No separate resource file.

Add the meal card:

```yaml
type: custom:steady-batch-card
```

Add the grocery list:

```yaml
type: custom:steady-batch-grocery
```

The meal card shows the week, opens the recipe under the meal you tap, and builds the grocery list on the same card.

Add the meal card:

## Install without HACS

Copy `custom_components/steady_batch` to `/config/custom_components/steady_batch`, restart, and add the integration.

## Phone

Install the Home Assistant companion app, sign into this Home Assistant, and open the dashboard that has the Steady Batch card.
