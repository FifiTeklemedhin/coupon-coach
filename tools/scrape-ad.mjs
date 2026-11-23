// Scrape CVS's weekly ad (ExtraBucks deals) into data/raw-<start>.json.
//
// Personal, run-on-demand tool: run it by hand about once a week. It opens your installed
// Google Chrome in a visible window with its own profile (tools/.chrome-profile), loads the weekly ad
// the same way you would, and saves what the page loads. It never signs in. If CVS asks you to
// pick a store or prove you're human, do that yourself in the window and the script carries on.
//
// Usage:  node tools/scrape-ad.mjs [--week "Nov. 29"]
//   --week  part of the week label in CVS's "This week's ad" dropdown. Default: the week that
//           contains today, otherwise the next one that starts.
//
// Sources saved:
//   feed  - the ad's product feed (from Flipp, CVS's weekly-ad provider) that the page itself downloads.
//           It has the full, untruncated offer text. ExtraBucks deals carry custom_id_field_1 =
//           "Extrabucks", which is what the site's "Extrabucks" filter uses.
//   cards - the List View cards' text plus the "Shop now" aria-label, kept as a cross-check.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = 'https://www.cvs.com/weeklyad/pageview';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const WEEK = arg('--week');
const log = (...a) => console.log('[scrape]', ...a);

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// "Nov. 22 - Nov. 28" -> {start: Date, end: Date}; the year is inferred around today.
function parseRange(label) {
  const m = label.match(/([A-Za-z]{3})[a-z]*\.?\s*(\d{1,2})\s*-\s*([A-Za-z]{3})[a-z]*\.?\s*(\d{1,2})/);
  if (!m) return null;
  const now = new Date(), y = now.getFullYear();
  const mk = (mon, d, yr) => new Date(yr, MONTHS[mon.toLowerCase()], +d);
  let s = mk(m[1], m[2], y);
  if (s - now > 200 * 864e5) s = mk(m[1], m[2], y - 1); // Jan ad seen in Dec etc.
  if (now - s > 200 * 864e5) s = mk(m[1], m[2], y + 1);
  let e = mk(m[3], m[4], s.getFullYear());
  if (e < s) e = mk(m[3], m[4], s.getFullYear() + 1);
  return { start: s, end: e };
}
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function pickWeek(options) {
  if (WEEK) {
    const o = options.find((x) => x.text.replace(/\s+/g, ' ').includes(WEEK));
    if (!o) throw new Error(`No week matching "${WEEK}". Options: ${options.map((x) => x.text).join(' | ')}`);
    return o;
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekly = options.map((o) => ({ ...o, r: parseRange(o.text) }))
    .filter((o) => o.r && (o.r.end - o.r.start) / 864e5 <= 7); // skip multi-week guides (e.g. holiday gift guide)
  return weekly.find((o) => o.r.start <= today && today <= o.r.end)
    || weekly.filter((o) => o.r.start > today).sort((a, b) => a.r.start - b.r.start)[0]
    || (() => { throw new Error(`No weekly ad found. Options: ${options.map((x) => x.text).join(' | ')}`); })();
}

const KEEP = ['id', 'name', 'brand', 'sale_story', 'pre_price_text', 'price_text', 'post_price_text', 'current_price',
  'categories', 'custom_id_field_1', 'description', 'valid_from', 'valid_to', 'page', 'sku', 'item_type', 'web_url', 'item_web_url'];

const ctx = await chromium.launchPersistentContext(path.join(ROOT, 'tools/.chrome-profile'), {
  channel: 'chrome', headless: false, viewport: { width: 1280, height: 900 },
});
try {
  const page = ctx.pages()[0] || await ctx.newPage();
  const feeds = {}; // publication id -> products[]
  let store = null;
  page.on('response', async (r) => {
    const u = r.url();
    const m = u.match(/flipp[^/]*\/(?:[^?]*\/)?publication\/(\d+)\/products/);
    if (m) {
      try {
        const j = await r.json(); const arr = Array.isArray(j) ? j : (j.products || j.items || []);
        (feeds[m[1]] ||= new Map()); arr.forEach((p) => feeds[m[1]].set(p.id, { ...(feeds[m[1]].get(p.id) || {}), ...p }));
      } catch {}
    }
    if (/\/api\/locator\/v2\/stores\/\d+/.test(u)) { try { store = await r.json(); } catch {} }
  });

  log('Opening', URL);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  log('Waiting for the ad to load. If CVS shows a store picker or a check, handle it in the Chrome window.');
  await page.waitForSelector('#publications', { timeout: 5 * 60000 });
  await page.waitForTimeout(3000);

  const options = await page.locator('#publications option').evaluateAll((os) => os.map((o) => ({ value: o.value, text: o.textContent.trim() })));
  const wk = pickWeek(options);
  log('Week:', wk.text);
  const pubBefore = new Set(Object.keys(feeds));
  const current = await page.locator('#publications').inputValue();
  if (current !== wk.value) { await page.selectOption('#publications', wk.value); }
  // Wait for this week's feed. Its publication id is whichever new one shows up with dated products.
  let pubId = null;
  for (let t = 0; t < 60 && !pubId; t++) {
    await page.waitForTimeout(1000);
    const r = parseRange(wk.text);
    pubId = Object.keys(feeds).find((id) => [...feeds[id].values()].some((p) => p.valid_from === ymd(r.start)))
      || (current !== wk.value ? Object.keys(feeds).find((id) => !pubBefore.has(id) && feeds[id].size > 20) : null);
  }
  if (!pubId) throw new Error('The ad feed for that week never loaded. Try again, or open the page by hand to see what CVS is showing.');
  await page.waitForTimeout(3000); // let the second feed request land too
  const products = [...feeds[pubId].values()];
  log(`Feed: ${products.length} items, ${products.filter((p) => p.custom_id_field_1 === 'Extrabucks').length} tagged Extrabucks.`);

  // Cross-check: List View cards (text + Shop-now aria-label). Best effort.
  let cards = [];
  try {
    await page.locator('button.wk-show-list-btn').click({ timeout: 15000 });
    await page.waitForSelector('#grid-scroll-content li', { timeout: 30000 });
    let last = -1;
    for (let i = 0; i < 80; i++) {
      const n = await page.evaluate(() => { const ul = document.querySelector('#grid-scroll-content'); ul.scrollTop = ul.scrollHeight; return ul.querySelectorAll('li').length; });
      if (n === last && i > 3) break; last = n; await page.waitForTimeout(700);
    }
    cards = await page.$$eval('#grid-scroll-content li', (lis) => lis.map((li) => ({
      text: li.innerText.replace(/\n{2,}/g, '\n').trim(),
      aria: li.querySelector('a[aria-label^="Shop now"]')?.getAttribute('aria-label') || null,
    })).filter((c) => c.text));
    log(`List View: ${cards.length} cards, ${cards.filter((c) => /extrabucks/i.test(c.text)).length} mention ExtraBucks.`);
  } catch (e) { log('List View cross-check skipped:', e.message.split('\n')[0]); }

  const r = parseRange(wk.text);
  const start = products.find((p) => p.valid_from)?.valid_from || ymd(r.start);
  const end = products.find((p) => p.valid_to)?.valid_to || ymd(r.end);
  const a = store?.storeList?.address || null;
  const out = {
    scrapedAt: new Date().toISOString(), source: URL, publicationId: pubId,
    week: { start, end, label: wk.text },
    store: a ? [a.street, a.city, a.state].filter(Boolean).join(', ') : null,
    feed: products.filter((p) => p.custom_id_field_1 === 'Extrabucks').map((p) => Object.fromEntries(KEEP.filter((k) => k in p).map((k) => [k, p[k]]))),
    cards,
  };
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  const file = path.join(ROOT, 'data', `raw-${start}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  log('Saved', path.relative(ROOT, file));
} finally {
  await ctx.close();
}
