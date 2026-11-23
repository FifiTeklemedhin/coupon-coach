// Turn data/raw-<week>.json (from scrape-ad.mjs) into the DEALS / GROUPS data and AD dates in index.html.
//
// Usage:  node tools/convert.mjs [data/raw-YYYY-MM-DD.json] [--fresh] [--dry]
//   default input: the newest data/raw-*.json
//   --fresh  don't carry over names/hints/opts/ids from the deals already in index.html
//   --dry    print the result and the review list, but don't write index.html
//
// Anything it can't read confidently goes on a review list (printed, and saved to
// data/review-<week>.md) instead of being guessed. Notes the shopper should see in the store
// (an unconfirmed condition, coupon terms) also go in the deal's `flag`, which the app shows.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, 'index.html');
const argv = process.argv.slice(2);
const FRESH = argv.includes('--fresh'), DRY = argv.includes('--dry');
let rawFile = argv.find((a) => !a.startsWith('--'));
if (!rawFile) {
  const files = fs.readdirSync(path.join(ROOT, 'data')).filter((f) => /^raw-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!files.length) { console.error('No data/raw-*.json. Run: npm run scrape'); process.exit(1); }
  rawFile = path.join('data', files.at(-1));
}
const raw = JSON.parse(fs.readFileSync(path.resolve(ROOT, rawFile), 'utf8'));
const html = fs.readFileSync(HTML, 'utf8');

// ---------- current data in index.html ----------
const eng = html.slice(html.indexOf('//ENGINE-START'), html.indexOf('//ENGINE-END'));
const cur = vm.runInNewContext(eng + ';({DEALS, GROUPS, CATS})');
const CATS = cur.CATS;

// ---------- helpers ----------
const review = []; // {name, why}
const R = (name, why) => review.push({ name, why });
const money = (s) => (s == null ? null : +s);
const STOP = new Set('any or and the of with for in to a oz ct pk excludes exclude select only'.split(' '));
const norm = (s) => s.toLowerCase().replace(/[’']/g, "'").replace(/[®™◆♦⧫⬧◊†*^]/g, ' ').replace(/l'or[eé]al/g, 'loreal').normalize('NFD').replace(/[̀-ͯ]/g, '');
const toks = (s) => new Set(norm(s).replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9+ ]/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t) && !/^\d+(\.\d+)?$/.test(t)).map((t) => t.replace(/(?<=[a-z]{3})s$/, '')));
// share of a's words that also appear in b
const within = (a, b) => { const A = toks(a), B = toks(b); let i = 0; A.forEach((t) => B.has(t) && i++); return i / (A.size || 1); };
const jacc = (a, b) => { const A = toks(a), B = toks(b); let i = 0; A.forEach((t) => B.has(t) && i++); return i / (A.size + B.size - i || 1); };
const most = (arr) => { const c = new Map(); arr.forEach((x) => { const k = JSON.stringify(x); c.set(k, (c.get(k) || 0) + 1); }); let best = null, n = 0; c.forEach((v, k) => { if (v > n) { n = v; best = k; } }); return best == null ? undefined : JSON.parse(best); };

function cleanName(n) {
  return n.replace(/^\s*WITH CARD\s+/i, '').replace(/^\s*N?Y\s+(?=[A-Z])/, (m) => (m.trim() === 'NY' ? '' : m)).replace(/^\s*(ANY|Select)\s+/i, '')
    .replace(/[†*]+/g, '').replace(/\s+/g, ' ').replace(/\s*\.\s*$/, '').replace(/,?\s+or$/, '').replace(/\s+,/g, ',').trim();
}

// ---------- parse one feed item ----------
function parseItem(p) {
  const name = cleanName(p.name || '');
  const txt = [p.sale_story, p.pre_price_text, p.post_price_text].filter(Boolean).join(' ').replace(/\s+/g, ' ');
  const d = { name, rawName: p.name, text: txt, cats: p.categories || [], brand: p.brand || '' };
  d.card = /WITH CARD/i.test(txt + ' ' + p.name);
  d.bogo = /Buy 1 get 1 50% off/i.test(txt);
  const m = txt.match(/\b(buy|spend)\s*\$?\s*(\d+(?:\.\d+)?)\s*get\s*\$\s*(\d+(?:\.\d+)?)\s*extra\s*bucks/i);
  if (m) { d.type = m[1].toLowerCase(); d.amt = +m[2]; d.ecb = +m[3]; }
  else {
    const e = txt.match(/\$\s*(\d+(?:\.\d+)?)\s*extra\s*bucks/i);
    if (e) { d.type = 'buy'; d.amt = d.bogo ? 2 : 1; d.ecb = +e[1]; d.unsure = `The ad says "$${e[1]} ExtraBucks" without saying how many to buy. The plan assumes ${d.amt}, so check the shelf tag.`; }
  }
  // other promos the engine doesn't model (shown as a hint)
  const promo = txt.match(/buy \d+ get (?:\d+(?:st|nd|rd|th)? ?(?:for \$?[\d.]+|free)|3rd free)\*?/i);
  if (promo && !d.bogo) d.promo = promo[0].replace(/\*$/, '');
  // manufacturer coupons: "$5.00 on 2 Digital mfr coupon", "$2.00 Digital mfr coupon"
  d.mfrs = [...txt.matchAll(/\$\s*(\d+(?:\.\d+)?)\s*(?:on\s*(\d+)\s*)?digital mfr coupon/gi)].map((x) => (x[2] ? { v: +x[1], onQty: +x[2] } : { v: +x[1] }));
  d.mfrNoAmt = !d.mfrs.length && /digital mfr coupon/i.test(txt);
  const sc = txt.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:off\s*)?ExtraCare coupon\^?\s*in the CVS app/i);
  if (sc) d.store = { v: +sc[1], note: `$${sc[1]} off ExtraCare coupon in the CVS app` };
  // price
  let price = money(p.price_text || p.current_price || null);
  const per = (p.pre_price_text || '').match(/(\d+)\s*\//);
  if (price && per) { d.multi = `${per[1]} for $${price.toFixed(0)}`; price = Math.round((price / +per[1]) * 100) / 100; }
  d.price = price > 0 ? price : null;
  if (/regular retail/i.test((p.pre_price_text || '') + (p.post_price_text || ''))) d.regRetail = true;
  return d;
}

const all = raw.feed.filter((p) => p.custom_id_field_1 === 'Extrabucks' && (p.item_type == null || p.item_type === 1));
const excluded = [];
const parsed = [];
for (const p of all) {
  const d = parseItem(p);
  if (/gift card|applebee|regal cinemas/i.test(d.name + ' ' + d.text)) { excluded.push(`${d.name.slice(0, 60)}... (gift cards)`); continue; }
  if (/^(spend|buy) \$?\d+ get|^find these offers/i.test(d.name)) { excluded.push(`"${d.name}" (a section header in the ad, not a product)`); continue; }
  parsed.push(d);
}

// ---------- dedupe (the ad lists many deals two or three times) ----------
const clusters = [];
for (const d of parsed) {
  const key = `${d.type}|${d.amt}|${d.ecb}|${d.bogo}`;
  const c = clusters.find((c) => c.key === key && (c.price == null || d.price == null || c.price === d.price)
    && c.items.some((x) => jacc(x.name, d.name) >= 0.5));
  if (c) { c.items.push(d); if (c.price == null) c.price = d.price; } else clusters.push({ key, price: d.price, items: [d] });
}
const merged = clusters.map((c) => {
  const it = c.items;
  const pick = (f) => most(it.map(f).filter((x) => x != null && x !== ''));
  // name: most common, ties -> longest
  const names = it.map((x) => x.name); const best = most(names);
  const name = names.filter((n) => n === best).length > 1 ? best : names.slice().sort((a, b) => b.length - a.length)[0];
  const mfrSets = it.map((x) => JSON.stringify(x.mfrs));
  const m = {
    name, type: it[0].type, amt: it[0].amt, ecb: it[0].ecb, price: pick((x) => x.price) ?? null,
    card: it.some((x) => x.card), bogo: it.some((x) => x.bogo), store: pick((x) => x.store),
    promo: pick((x) => x.promo), multi: pick((x) => x.multi), regRetail: it.some((x) => x.regRetail),
    unsure: it.every((x) => x.unsure) ? it[0].unsure : null, mfrNoAmt: it.every((x) => x.mfrNoAmt),
    cats: it.flatMap((x) => x.cats), brand: pick((x) => x.brand), n: it.length,
  };
  // mfr coupon: the set most cards agree on; a card that lists two amounts is ambiguous
  const ms = most(mfrSets.map((s) => JSON.parse(s)).filter((s) => s.length === 1)) || most(it.map((x) => x.mfrs).filter((s) => s.length));
  if (ms && ms.length === 1) m.mfr = ms[0];
  else if (ms && ms.length > 1) { m.mfr = ms.reduce((a, b) => (b.v > a.v ? b : a)); m.mfrAmbig = ms.map((x) => '$' + x.v).join(' and '); }
  return m;
});

// ---------- categories ----------
const KW = [ // product words first: they decide better than brand names
  ['Hair Care', /hair colou?r|shampoo|conditioner|hair care|curling|flat iron|dryer|waver|hair styl|styling/],
  ['Oral Care', /toothpaste|tooth ?brush|mouthwash|floss|oral|whitening strips|denture|polident|poligrip|biot[eè]ne|dry mouth/],
  ['Shave & Deodorant', /deodorant|dry spray|body spray|razor|cartridge|shave|shaving/],
  ['Makeup & Nails', /nails?\b|eyelash|lashes|nail polish/],
  ['Beauty', /cosmetic|makeup|mascara|lipstick|towelettes|makeup remover/],
  ['Baby', /diaper|baby|pull-?ups|goodnites|luvs|pampers|huggies/],
  ['Feminine & Adult Care', /pads|liners|tampon|kotex|adult care|depend|poise|discreet|incontinence/],
  ['Vitamins & Nutrition', /vitamin|supplement|nutrition|protein|ensure/],
  ['Health & Medicine', /pain|tylenol|motrin|digestive|test strips|lancet|kt tape|biofreeze|allergy|cold|cough/],
  ['Personal Care', /lotion|body wash|bar soap|hand soap|facial|serum|acne|moistur|skin|cleanser/],
  ['Household', /detergent|tide|gain|downy|bounce|paper towels?|bath tissue|tissues|dish|disinfect|lysol|charmin|bounty|scott|kleenex|puffs|cleaner/],
  ['Grocery', /gum bottle|soda|candy|mini cans|snack|chocolate/],
];
// Brands that always belong to one of the app's categories (checked before the keyword rules).
// Add to this when the review list shows a brand landing in the wrong place.
const BRANDS = [
  ['Hair Care', /head & shoulders|pantene|elvive|fructis|nutrisse|olia|clairol|kaleidoscope|pardon my fro|watch & sea|conair|infinitipro|loreal ever/],
  ['Oral Care', /crest|colgate|sensodyne|pronamel|parodontax|oral-b|therabreath|guru nanda|biotene|polident|poligrip|hello kids|scope/],
  ['Shave & Deodorant', /gillette|venus|schick|skintimate|old spice|secret|\baxe\b|norelco|dove men\+care/],
  ['Makeup & Nails', /\bnyx\b|sally hansen|\bkiss\b|ardell/],
  ['Vitamins & Nutrition', /natrol|irwin naturals|ensure/],
  ['Baby', /pampers|huggies|luvs|millie moon/],
  ['Feminine & Adult Care', /kotex|always discreet|depend|poise|cvs brand pads/],
  ['Grocery', /mentos|trident|coke|sprite|dr pepper/],
];
const FEEDCAT = { 'Skin & Sun Care': 'Personal Care', Candy: 'Grocery', 'Baby Care': 'Baby' };
function categorize(m) {
  const n = norm(m.name);
  const bh = [...new Set(BRANDS.filter(([, re]) => re.test(n)).map(([c]) => c))];
  if (bh.length === 1) return { cat: bh[0] };
  const hits = KW.filter(([, re]) => re.test(n)).map(([c]) => c);
  const fv = most(m.cats.map((c) => FEEDCAT[c] || c).filter((c) => CATS.includes(c)));
  if (hits.length === 1) return { cat: hits[0] };
  if (hits.length > 1) {
    if (fv && hits.includes(fv)) return { cat: fv };
    return { cat: hits[0], why: `category: matched ${hits.join(' / ')}; picked ${hits[0]}` };
  }
  if (fv) return { cat: fv, why: `category: no keyword matched; used the ad feed's "${fv}"` };
  return { cat: null, why: 'category: could not tell' };
}

// ---------- carry over from current index.html ----------
const sameOffer = (old, m) => old.type === m.type && (old.type === 'buy' ? old.n === m.amt : old.min === m.amt) && old.ecb === m.ecb;
const oldMatch = new Map(); // merged deal -> old deal, assigned one-to-one, best score first
function assignOld(list) {
  if (FRESH) return;
  const pairs = [];
  for (const m of list) for (const o of cur.DEALS) {
    if (!(sameOffer(o, m) || (o.ecb == null && o.type === m.type))) continue;
    if (!!o.bogo !== !!m.bogo) continue;
    if (o.price != null && m.price != null && Math.abs(o.price - m.price) > 0.005) continue;
    const s = Math.max(jacc(o.name, m.name), within(o.name, m.name) * 0.8, ...(o.opts || []).map((x) => jacc(x, m.name) * 0.9));
    if (s >= 0.35) pairs.push({ m, o, s });
  }
  pairs.sort((a, b) => b.s - a.s);
  const taken = new Set();
  for (const { m, o } of pairs) if (!oldMatch.has(m) && !taken.has(o)) { oldMatch.set(m, o); taken.add(o); }
}

// ---------- groups: spend deals where several priced products count toward one threshold ----------
const wk = raw.week.start.slice(5).replace('-', '');
const PFX = { 'Hair Care': 'hc', 'Oral Care': 'oc', 'Shave & Deodorant': 'sd', Beauty: 'b', 'Makeup & Nails': 'm', 'Personal Care': 'pc', 'Health & Medicine': 'hm', 'Vitamins & Nutrition': 'vn', Baby: 'ba', 'Feminine & Adult Care': 'fa', Household: 'hh', Grocery: 'gr' };
const usedIds = new Set();
const newId = (cat) => { let i = 1, id; do { id = `${PFX[cat] || 'x'}${wk}_${i++}`; } while (usedIds.has(id)); usedIds.add(id); return id; };

merged.forEach((m) => { Object.assign(m, categorize(m)); });
const DEALS = [], GROUPS = [];
const spendKeys = new Map();
for (const m of merged.filter((m) => m.type === 'spend')) {
  const k = `${m.amt}|${m.ecb}|${m.cat}`; (spendKeys.get(k) || spendKeys.set(k, []).get(k)).push(m);
}
const inGroup = new Set();
for (const [k, ms] of spendKeys) {
  const priced = ms.filter((m) => m.price);
  if (priced.length < 2) continue;
  const [min, ecb, cat] = k.split('|');
  const old = FRESH ? null : cur.GROUPS.find((g) => g.min === +min && g.ecb === +ecb && g.cat === cat);
  const brands = [...new Set(priced.flatMap((m) => (m.brand || m.name.split(' ')[0]).split('|').map((s) => s.trim()).filter(Boolean)))];
  // match this week's items to last week's one-to-one (same price, best name overlap first)
  const itemMatch = new Map(), pairs = [];
  if (old) for (const m of priced) for (const i of old.items) {
    if (Math.abs(i.price - m.price) > 0.005) continue;
    const sc = Math.max(jacc(i.name, m.name), within(i.name, m.name) * 0.8, ...(i.opts || []).map((x) => within(x, m.name) * 0.9));
    if (sc >= 0.2) pairs.push({ m, i, sc });
  }
  pairs.sort((x, y) => y.sc - x.sc);
  const takenI = new Set();
  for (const { m, i } of pairs) if (!itemMatch.has(m) && !takenI.has(i)) { itemMatch.set(m, i); takenI.add(i); }
  const g = {
    id: old?.id || newId(cat), cat, label: old?.label || `Spend $${min} on ${brands.slice(0, -1).join(', ')}${brands.length > 1 ? ' or ' : ''}${brands.at(-1)}, get $${ecb} back`,
    min: +min, ecb: +ecb, card: priced.some((m) => m.card) ? 1 : 0,
    items: priced.sort((a, b) => a.price - b.price).map((m) => {
      const oi = itemMatch.get(m);
      if (m.mfrAmbig) R(m.name, `ad lists two coupon amounts (${m.mfrAmbig}); used $${m.mfr.v}`);
      return { name: oi?.name || m.name, price: m.price, mfr: m.mfr?.v, opts: oi?.opts || makeOpts(m) };
    }),
  };
  if (old) usedIds.add(old.id);
  GROUPS.push(g); priced.forEach((m) => inGroup.add(m));
  ms.filter((m) => !m.price).forEach((m) => { inGroup.add(m); R(m.name, `counts toward "${g.label}" but the ad shows no price, so it was left out of that group`); });
}

// ---------- deals ----------
assignOld(merged.filter((m) => !inGroup.has(m)));
for (const m of merged) {
  if (inGroup.has(m)) continue;
  const old = oldMatch.get(m);
  const cat = old?.cat || m.cat;
  if (!old && m.why) R(m.name, m.why);
  if (!cat) continue;
  const d = { id: old ? old.id : newId(cat), cat, name: old?.name || m.name + (m.multi ? ` (${m.multi})` : m.bogo ? ' (BOGO 50% off)' : '') };
  usedIds.add(d.id);
  d.price = m.price;
  d.type = m.type || 'buy';
  if (d.type === 'buy') d.n = m.amt || 1; else d.min = m.amt;
  d.ecb = m.ecb ?? null;
  if (m.card) d.card = 1;
  if (m.bogo) d.bogo = 1;
  if (m.mfr) d.mfr = m.mfr;
  if (m.store) d.store = m.store;
  const hints = [];
  if (old?.hint) hints.push(old.hint);
  else {
    if (m.regRetail) hints.push('Listed as regular retail price.');
    if (m.promo) hints.push(`Also ${m.promo} in the ad.`);
    if (m.mfrNoAmt) hints.push('The ad mentions a digital manufacturer coupon but not its amount.');
  }
  if (hints.length) d.hint = hints.join(' ');
  const flags = [];
  if (m.unsure) { flags.push(m.unsure); R(m.name, m.unsure); }
  if (m.store) flags.push(`Check the terms of the $${m.store.v} ExtraCare coupon in the CVS app. The plan applies it once.`);
  if (m.mfrAmbig) { flags.push(`The ad lists two coupon amounts (${m.mfrAmbig}). The plan uses $${m.mfr.v}.`); R(m.name, `two coupon amounts (${m.mfrAmbig})`); }
  if (d.ecb == null) R(m.name, 'no ExtraBucks amount found, so plans skip it');
  if (flags.length) d.flag = flags.join(' ');
  d.opts = old?.opts || makeOpts(m);
  DEALS.push(d);
}
DEALS.sort((a, b) => CATS.indexOf(a.cat) - CATS.indexOf(b.cat));

// ---------- eligible-product search terms ----------
function makeOpts(m) {
  const n = m.name.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  const brands = (m.brand || '').split('|').map((x) => norm(x.trim())).filter(Boolean);
  const bl = (m.brand || '').split('|').map((x) => x.trim()).find((x) => x && norm(n).startsWith(norm(x)));
  const lead = bl ? n.slice(0, bl.length) : n.split(/[\s,]/)[0];
  const SIZE = /^[\d.\s-]+(oz|ct|pk|ml|l|in|rolls?|count)?\.?$/i;
  let parts = n.split(/,\s*|\s+or\s+/).map((x) => x.trim()).filter((x) => x.length > 1 && !SIZE.test(x));
  // "Garnier Nutrisse or Olia hair color": give bare names the last part's trailing noun phrase
  const last = parts.at(-1) || '';
  let tail = (last.match(/(?:\s[a-z][\w&'-]*)+$/) || [''])[0].trim();
  if (!/[a-z]{3,}/.test(tail.replace(/\b(oz|ct|pk|ml|count|rolls?)\b/g, ''))) tail = '';
  if (tail) parts = parts.map((x, k) => (k < parts.length - 1 && !/\s[a-z]/.test(' ' + x.split(' ').slice(1).join(' ')) ? `${x} ${tail}` : x));
  const out = [];
  for (const x of parts) {
    const nx = norm(x);
    const ownBrand = brands.some((b) => nx.startsWith(b)) || nx.startsWith(norm(lead));
    const q = ownBrand || (/^[A-Z]/.test(x) && x.includes(' ')) ? x : `${lead} ${x}`;
    if (!out.includes(q)) out.push(q);
  }
  return out.length ? out.slice(0, 6) : [n];
}

// ---------- write ----------
const q = (s) => (s.includes("'") ? JSON.stringify(s) : `'${s.replace(/\\/g, '\\\\')}'`);
const arr = (a) => JSON.stringify(a).replace(/","/g, '", "');
const val = (v) => (v == null ? 'null' : typeof v === 'string' ? q(v) : Array.isArray(v) ? arr(v) : typeof v === 'object' ? '{' + Object.entries(v).map(([k, x]) => `${k}:${val(x)}`).join(',') + '}' : String(v));
const ORDER = ['id', 'cat', 'name', 'price', 'type', 'n', 'min', 'ecb', 'card', 'bogo', 'mfr', 'store', 'hint', 'flag', 'opts'];
const obj = (d) => '{' + ORDER.filter((k) => k in d && d[k] !== undefined).map((k) => `${k}:${k === 'price' && d[k] != null ? d[k].toFixed(2) : val(d[k])}`).join(',') + '}';
let dealsSrc = '  var DEALS = [\n    // type \'buy\': buy n get ecb. type \'spend\': spend min get ecb. price = unit shelf price from the ad (null = not shown).\n';
let lastCat = null;
dealsSrc += DEALS.map((d) => { const sep = lastCat && d.cat !== lastCat ? '\n' : ''; lastCat = d.cat; return sep + '    ' + obj(d); }).join(',\n') + '\n  ];\n';
const groupsSrc = '  // Spend deals where several products count toward one threshold, with prices from the ad.\n  var GROUPS = [\n' + GROUPS.map((g) =>
  `    {id:${q(g.id)},cat:${q(g.cat)},label:${q(g.label)},min:${g.min},ecb:${g.ecb}${g.card ? ',card:1' : ''},items:[\n` +
  g.items.map((i) => `      {name:${q(i.name)},price:${i.price.toFixed(2)}${i.mfr ? `,mfr:${i.mfr}` : ''},opts:${arr(i.opts)}}`).join(',\n') + ']}').join(',\n') + '\n  ];\n';

const fmt = (s) => { const d = new Date(s + 'T12:00:00'); return { m: d.toLocaleString('en-US', { month: 'short' }), d: d.getDate(), y: d.getFullYear() }; };
const a = fmt(raw.week.start), b = fmt(raw.week.end);
const label = a.m === b.m ? `${a.m} ${a.d}–${b.d}, ${b.y}` : `${a.m} ${a.d}–${b.m} ${b.d}, ${b.y}`;
const title = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bParkway\b/, 'Pkwy').replace(/\b(Ma|Ny|Ca|Nj|Ct|Ri|Nh|Vt|Me)$/, (x) => x.toUpperCase());
const oldAd = html.match(/var AD = \{[^}]*\};/)[0];
const store = raw.store ? `${title(raw.store.split(', ')[0])}, ${title(raw.store.split(', ')[1] || '')} ${raw.store.split(', ')[2] || ''} (CVS default)`.replace(/\s+/g, ' ')
  : 'the store CVS picked by default (location not recorded; check shelf prices)'; // e.g. a cloud run
const adSrc = `var AD = { start:'${raw.week.start}', end:'${raw.week.end}', label:'${label}', store:${q(store)} };`;

const s0 = html.indexOf('  var DEALS = ['), s1 = html.indexOf('  var CATS =');
if (s0 < 0 || s1 < 0) throw new Error('Could not find DEALS/CATS in index.html');
const out = html.slice(0, s0) + dealsSrc + '\n' + groupsSrc + html.slice(s1);
const out2 = out.replace(oldAd, adSrc);

// sanity: the new engine block must still evaluate
const eng2 = out2.slice(out2.indexOf('//ENGINE-START'), out2.indexOf('//ENGINE-END'));
const chk = vm.runInNewContext(eng2 + ';({DEALS, GROUPS})');
if (chk.DEALS.length !== DEALS.length) throw new Error('Generated code did not evaluate as expected');

// ---------- report ----------
const oldIds = new Set([...cur.DEALS.map((d) => d.id), ...cur.GROUPS.map((g) => g.id)]);
const newIds = new Set([...DEALS.map((d) => d.id), ...GROUPS.map((g) => g.id)]);
const gone = [...cur.DEALS, ...cur.GROUPS].filter((d) => !newIds.has(d.id)).map((d) => `${d.id} ${d.name || d.label}`);
const added = [...DEALS, ...GROUPS].filter((d) => !oldIds.has(d.id)).map((d) => `${d.id} ${d.name || d.label}`);

// cross-check against the List View cards
let cardNote = '';
if (raw.cards?.length) {
  const eb = raw.cards.filter((c) => /extrabucks/i.test(c.text));
  const miss = eb.filter((c) => !all.some((p) => jacc(cleanName(p.name), (c.aria || c.text.split('\n')[0]).replace(/^Shop now, opens Product Listing Page to shop /, '')) >= 0.5));
  cardNote = `List View cross-check: ${eb.length} ExtraBucks cards, ${miss.length} not found in the feed.` + (miss.length ? '\n' + miss.map((c) => '  - ' + c.text.split('\n').slice(0, 2).join(' | ')).join('\n') : '');
}
const lines = [
  `# Deal refresh: ${label}`, '',
  `Source: ${rawFile} (${all.length} ExtraBucks feed items -> ${merged.length} distinct deals)`,
  `Result: ${DEALS.length} deals, ${GROUPS.length} groups. ${FRESH ? 'Fresh run (nothing carried over).' : ''}`, '',
  `## Please check (${review.length})`, ...(review.length ? review.map((r) => `- ${r.name}: ${r.why}`) : ['- nothing']), '',
  `## New this week (${added.length})`, ...added.map((x) => '- ' + x), '',
  `## Gone since last week (${gone.length})`, ...gone.map((x) => '- ' + x), '',
  `## Left out (${new Set(excluded).size})`, ...[...new Set(excluded)].map((x) => "- " + x), '',
  cardNote,
];
const report = lines.join('\n');
console.log(report);
if (!DRY) {
  fs.writeFileSync(HTML, out2);
  fs.writeFileSync(path.join(ROOT, 'data', `review-${raw.week.start}.md`), report + '\n');
  console.log(`\nWrote index.html and data/review-${raw.week.start}.md. Next: npm run check, then look over git diff.`);
}
