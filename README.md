# Steady Batch

A Home Assistant meal planner. Set the daily calorie number from Hume or MyFitnessPal, plan the week, download the shopping list, and open the same card in the Home Assistant phone app.

Repository: https://github.com/rwunderlichsr/steady-batch

## Website hosted from GitHub

The website uses the original dashboard card and the same complete recipe catalog.
The Home Assistant integration below remains unchanged. The website stores plans
and preferences in the visitor's browser; it does not connect to Home Assistant.
Use **Download plan backup** before moving devices or clearing browser data.
The original card's **Load plan backup** button imports the meals from that file.

GitHub Pages builds the site on every push to `main` using
`.github/workflows/pages.yml`. In this repository's **Settings → Pages**, select
**GitHub Actions** as the build source. Set the custom domain to
`mealplan.lawfaregroup.com` and enable HTTPS after DNS verification completes.
The DNS CNAME for `mealplan` must point to `rwunderlichsr.github.io`.

Edit the existing card in
`custom_components/steady_batch/www/steady-batch-card.js` or the recipe files in
`custom_components/steady_batch/recipes/`; both feed the website build directly.
The browser storage adapter and page shell are in `web/`.

To test and build locally with Node 22 or later:

```sh
node --test tests/*.test.mjs
node scripts/build-web.mjs
python -m http.server 8000 --directory _site
```

The generated `_site/` directory is not committed. It contains a byte-for-byte
copy of the original card and all recipe parts combined into `recipes.json`.

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
