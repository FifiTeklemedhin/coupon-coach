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

## Deal data

The deals are embedded in `index.html` in the `DEALS` and `GROUPS` arrays (inside the
`//ENGINE-START` / `//ENGINE-END` block). They were read from CVS's weekly ad for
**Nov 22-28, 2026** (store: 215 Alewife Brook Pkwy, Cambridge MA, the store CVS defaulted to).

The app does not update itself. To refresh for a new week, replace those arrays and the `AD`
object near the top of the script with the new ad's deals and dates.

## Known limits

- Deals with no shelf price in the ad only join a plan after you type a price in the app.
- Three ExtraBucks amounts (Colgate, Old Spice, Pampers wipes) were cut off in the ad list and
  were filled in from a TikTok. They are flagged in the app.
- Your personal coupons and ExtraBucks balance live in your CVS account and are not read by the app.
