// Engine check from CLAUDE.md: evaluate the ENGINE block of index.html and run planRoll over several setups.
// Checks every step's eBefore equals the previous eAfter, apply <= eBefore, and total cash <= budget.
// Usage: node tools/check-engine.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const eng = html.slice(html.indexOf('//ENGINE-START'), html.indexOf('//ENGINE-END'));
const E = vm.runInNewContext(eng + ';({DEALS, GROUPS, CATS, planRoll, buildOffers})');
const ad = html.match(/var AD = (\{[^}]*\});/)[1];

let fail = 0;
const bad = (m) => { fail++; console.log('  FAIL', m); };

// data shape
const ids = new Set();
for (const d of [...E.DEALS, ...E.GROUPS]) {
  if (ids.has(d.id)) bad(`duplicate id ${d.id}`); ids.add(d.id);
  if (!E.CATS.includes(d.cat)) bad(`${d.id}: unknown category ${d.cat}`);
}
for (const d of E.DEALS) {
  if (!['buy', 'spend'].includes(d.type)) bad(`${d.id}: type ${d.type}`);
  if (d.type === 'buy' && !(d.n >= 1)) bad(`${d.id}: missing n`);
  if (d.type === 'spend' && !(d.min > 0)) bad(`${d.id}: missing min`);
  if (!Array.isArray(d.opts) || !d.opts.length) bad(`${d.id}: no opts`);
}
for (const g of E.GROUPS) for (const i of g.items) if (!(i.price > 0) || !i.opts?.length) bad(`${g.id}: item ${i.name} needs price and opts`);
console.log(`AD ${ad}`);
console.log(`${E.DEALS.length} deals, ${E.GROUPS.length} groups, ${E.DEALS.filter((d) => d.ecb > 0 && d.price > 0).length} deals plannable without typed prices`);

const setups = [
  { cats: E.CATS, budget: 30, ecb0: 0, tax: 6.25, maxSteps: 4, clip: true, conservative: true },
  { cats: E.CATS, budget: 50, ecb0: 0, tax: 7, maxSteps: 5, clip: true, conservative: false },
  { cats: E.CATS, budget: 20, ecb0: 10, tax: 0, maxSteps: 3, clip: false, conservative: true },
  { cats: ['Hair Care', 'Oral Care'], budget: 40, ecb0: 0, tax: 7, maxSteps: 4, clip: true, conservative: true },
  { cats: ['Household'], budget: 25, ecb0: 0, tax: 6.25, maxSteps: 3, clip: true, conservative: true },
];
for (const s of setups) {
  const r = E.planRoll({ ...s, prices: {}, used: [] });
  let prev = s.ecb0, cash = 0;
  r.steps.forEach((st, k) => {
    if (Math.abs(st.eBefore - prev) > 1e-9) bad(`step ${k + 1}: eBefore ${st.eBefore} != previous eAfter ${prev}`);
    if (st.apply > st.eBefore + 1e-9) bad(`step ${k + 1}: apply ${st.apply} > eBefore ${st.eBefore}`);
    prev = st.eAfter; cash += st.cash;
  });
  if (cash > s.budget + 1e-9) bad(`cash ${cash} > budget ${s.budget}`);
  console.log(`budget $${s.budget}, ${s.cats.length} cats: ${r.steps.length} steps, cash $${r.cash.toFixed(2)}, ExtraBucks left $${r.eLeft.toFixed(2)}, offers ${r.offersCount}` +
    `\n    ${r.steps.map((st) => st.offers.map((o) => o.id).join('+')).join(' -> ')}`);
}

// hand-checked example from CLAUDE.md (only when those deals are in this week's data)
const conair = E.DEALS.find((d) => d.id === 'hc1'), colgate = E.DEALS.find((d) => d.id === 'oc2');
if (conair?.price === 14.99 && colgate?.price === 4.99 && colgate.mfr?.v === 2) {
  const offers = E.buildOffers({ cats: E.CATS, clip: true, conservative: true, prices: {}, used: [] });
  const a = offers.find((o) => o.id === 'hc1'), b = offers.find((o) => o.id === 'oc2');
  const total = a.after + b.after, taxed = Math.round(total * 1.07 * 100) / 100;
  const ok = Math.abs(total - 22.97) < 0.005 && Math.abs(taxed - 24.58) < 0.005 && a.ecb + b.ecb === 15;
  if (!ok) bad(`hand example: got $${total.toFixed(2)} / $${taxed} / earn $${a.ecb + b.ecb}`);
  else console.log('Hand example (Conair + 2 Colgate Total): $22.97, $24.58 with 7% tax, earns $15. OK');
}
console.log(fail ? `\n${fail} problem(s).` : '\nAll checks passed.');
process.exit(fail ? 1 : 0);
