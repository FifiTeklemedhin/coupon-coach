# Coupon Coach

A single-page app that builds CVS ExtraBucks "rolls" and coaches you through them in the store.

You pick categories, a cash limit and how many ExtraBucks you already have. It plans a chain of
transactions where each one is paid for by the ExtraBucks earned in the one before, then walks you
through each transaction step by step.

**Live app:** https://fifiteklemedhin.github.io/coupon-coach/ (GitHub Pages, deployed from `main`).

Each planned item links to CVS.com. Deals that cover a range of products show an expandable list of
eligible items, each with its own link.

## Files

- `index.html` - the whole app (HTML, CSS and JS, no build step). Open it in a browser.
- `tools/` - the weekly refresh scripts (`scrape-ad.mjs`, `convert.mjs`, `check-engine.mjs`).

## Deal data

The deals are embedded in `index.html` in the `DEALS` and `GROUPS` arrays (inside the
`//ENGINE-START` / `//ENGINE-END` block). They were read from CVS's weekly ad for
**Nov 22-28, 2026** (store: 215 Alewife Brook Pkwy, Cambridge MA, the store CVS defaulted to).

The app does not update itself. To refresh for a new week (run it on your Mac, about once a week):

```bash
npm install          # first time only
npm run refresh      # scrape the ad, rewrite the deals in index.html, run the engine check
```

`npm run refresh` opens Google Chrome in a visible window, loads the weekly ad, and saves what the
page loads to `data/raw-<week>.json`. It then rewrites `DEALS`, `GROUPS` and `AD` in `index.html` and
prints a short "Please check" list (also saved to `data/review-<week>.md`). Review that list and
`git diff index.html`, fix anything by hand, then push. It never signs in to CVS. If CVS asks you to
pick a store or do a check, do it in the Chrome window and the script carries on. Keep it to an
occasional personal run: scraping may conflict with CVS's terms of use. `data/` stays local.

- `npm run refresh -- --week "Nov. 29"` picks a specific week from CVS's dropdown (default: this week).
- `npm run convert -- --fresh --dry` re-parses without reusing last week's names and search terms.

## Known limits

- Deals with no shelf price in the ad only join a plan after you type a price in the app.
- Your personal coupons and ExtraBucks balance live in your CVS account and are not read by the app.
