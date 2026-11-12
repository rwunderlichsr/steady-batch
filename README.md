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

Add a card:

```yaml
type: custom:steady-batch-card
```

You get `calendar.steady_batch` and `sensor.steady_batch_today`. The sensor state is today's calories. Attributes include protein, the goal, and each meal.

The card also builds the week's shopping list. Download it as a text file, or add the items to Home Assistant's Shopping List so they show in the phone app. Enable **Shopping List** under Settings → Devices & services if that button says it is missing.

## Install without HACS

Copy `custom_components/steady_batch` to `/config/custom_components/steady_batch`, restart, and add the integration.

## Phone

Install the Home Assistant companion app, sign into this Home Assistant, and open the dashboard that has the Steady Batch card.
