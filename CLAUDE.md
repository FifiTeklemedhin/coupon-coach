# Coupon Coach - project context

## What this is
A single-page app (`index.html`, no build step) that plans CVS ExtraBucks "rolls" and coaches the
user through them in the store. A roll is a chain of transactions where each one is paid for by the
ExtraBucks earned in the previous one (the pattern in CVS couponing TikToks).

The user picks categories, a total cash limit, and any ExtraBucks they already have (usually $0).
The app builds the plan, then the "In store" tab walks through one transaction at a time with
tick-boxes, asks what they actually paid and their real ExtraBucks balance, and re-plans the rest.

## What the user wants (keep this in mind)
- It should be easy and usable live in the store on a phone. Not a static planner.
- They worry about spending more than expected, so always show worst-case cash and a stop rule.
- They want to choose categories (matching CVS's site filters) plus a budget and get strong deals.
- They asked to be asked questions before large builds, not surprised by big builds.
- They may later want other stores (Walgreens, Target). Current scope is CVS only.

## Files
- `index.html` - whole app: CSS, HTML, JS.
- `README.md` - short overview.

## Code layout (inside index.html)
- `//ENGINE-START` ... `//ENGINE-END`: pure logic with no DOM access. Contains `DEALS`, `GROUPS`,
  `CATS`, `buildOffers`, `planRoll`. It can be extracted and tested in Node.
- `AD` object near the top of the script: ad week dates and store label (drives the "ended" banner).
- UI code below the engine: plan tab, coach tab (`renderStore`, `advance`), deals tab, localStorage
  persistence under key `cc2` (wrapped in try/catch).

## How the plan is computed
- Each deal becomes an "offer": items, cash cost after coupons (`after`), shelf value (`shelf`),
  ExtraBucks earned (`ecb`).
- `planRoll` runs a beam search (width 40) over up to N transactions. A transaction is one offer or
  a pair of offers. ExtraBucks earned in a transaction can only be spent in later transactions.
- Score = shelf value + ExtraBucks balance - cash spent. Total cash must stay within the budget.
- Tax is applied to the post-coupon total at the entered rate. ExtraBucks pay tax too.
- "Play it safe" counts coupons against spend-threshold deals (CVS "98% rule").
- Deals with no shelf price in the ad are skipped until the user types a price (state in `S.prices`).

## Product links
- Every `DEALS` entry and every `GROUPS` item has `opts`: a list of eligible products, each used as a
  CVS.com search (`https://www.cvs.com/search?searchTerm=...`, built by `cvsUrl`/`itemLinks` in the UI).
- One option shows as a single "Find on CVS.com" link; several show as an expandable "N eligible
  items" list. Links appear on plan step cards, under each "Pick up" task in the coach, and in All deals.
- When refreshing deals, write `opts` for each new deal (specific product names work best as queries).

## Testing the engine
Extract the text between `//ENGINE-START` and `//ENGINE-END`, evaluate it in Node, and call
`planRoll({cats, budget, ecb0, tax, maxSteps, clip, conservative, prices:{}, used:[]})`.
Check: step N's `eBefore` equals step N-1's `eAfter`, `apply <= eBefore`, and total cash <= budget.
Hand-checked example: Conair $14.99 + 2 Colgate Total at $4.99 minus a $2 coupon = $22.97, which is
$24.58 at 7% tax, and earns $10 + $5 = $15.

## Weekly data refresh (the app does not update itself)
The deals were read from CVS's weekly ad for Nov 22-28, 2026 (store: 215 Alewife Brook Pkwy,
Cambridge MA, the store CVS defaulted to). To refresh for a new week:
1. Open `https://www.cvs.com/weeklyad/pageview` in a browser, pick the new week in the date
   dropdown, switch to List View, and apply the "Extrabucks" filter.
2. Read each deal card's text. The list view truncates long lines, so some reward amounts are cut
   off; the product name is in the "Shop now" link's aria-label.
3. Update `DEALS` / `GROUPS` (shelf price from the ad, or `null` if not shown) and the `AD` object.
4. Categories are assigned by hand to match CVS's site filters. Clicking CVS's category chips from
   a script was too slow and unreliable, so do not rely on it.
Notes: CVS's own pages were not readable by simple page fetch tools; a real browser worked. The
user's personal coupons and ExtraBucks balance require their CVS login, which Claude must never
type in. The user signs in themselves if account data is needed.

## Known gaps
- Three ExtraBucks amounts were cut off in the ad list and filled in from a TikTok (Colgate $6,
  Old Spice $4, Pampers wipes $5). They are flagged in the app. Verify against shelf tags.
- Secret, Axe and Puffs deals show no ExtraBucks amount, so they are excluded from plans.
- The ad's gift-card deal (spend $100 get $20) is excluded.
- Group deals (Tide/Charmin etc.) pick the cheapest combination of up to 5 units that reaches the
  threshold. Coupon use is assumed to be one per product per transaction.
- Maybelline and Revlon "ExtraCare coupon in the app" terms are not fully known; the plan applies
  them once per transaction.

## Deployment
This repo's `index.html` is the source of truth. It is deployed with GitHub Pages from `main`
(public repo `FifiTeklemedhin/coupon-coach`): https://fifiteklemedhin.github.io/coupon-coach/
Pushing to `main` redeploys within about a minute.

An older copy is also published at https://claude.ai/artifact/VQwEsz7tJuj4MjJPS9moct (private). It
does not sync and predates the product links; GitHub Pages is the copy to use.

## Git
`main` is pushed to GitHub. The author is a placeholder (`Coupon Coach <coupon-coach@localhost>`); the
user can run `git commit --amend --reset-author` after setting their own name and email.
