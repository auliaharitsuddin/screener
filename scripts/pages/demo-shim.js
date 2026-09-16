// Shim untuk GitHub Pages: GitHub Pages hanya menyajikan file statis, jadi
// server.js (endpoint HTTP nyata + fetch Yahoo/CoinGecko/Gemini) tidak bisa
// jalan di sana. Modul ini meniru /api/browse, /api/meta, /api/screen persis
// seperti server.js, tapi memakai snapshot statis demo-data.json alih-alih
// menarik data live, dan parseRules (aturan lokal) alih-alih Gemini.
//
// Logikanya sengaja disalin dari server.js supaya perilaku UI identik; kalau
// server.js berubah, sesuaikan juga di sini.
import {
  INDICATORS, FIELDS, PRESETS, PRESET_SORT, GROUPS,
  TIMEFRAMES, INTRADAY, marketsFor, BASE_COLUMNS,
} from './indicators.js';
import { apply } from './filter.js';
import { parseRules } from './parser.js';

const DEFAULT_COLUMNS = ['change7d', 'change30d', 'change1y', 'turnover'];
const OPS = ['>', '>=', '<', '<=', '=', '!='];

let rowsPromise = null;
const rows = () => rowsPromise ??= fetch('./demo-data.json').then(r => r.json()).then(d => d.rows);

const buildColumns = (fields, markets) =>
  [...new Set([...BASE_COLUMNS, ...fields])]
    .filter(f => markets.some(m => marketsFor(f).includes(m)))
    .map(f => ({ field: f, ...INDICATORS[f] }));

function parseFilters(list) {
  return list.flatMap(raw => {
    const [field, op, value] = String(raw).split(':');
    const v = Number(value);
    if (!FIELDS.includes(field) || !OPS.includes(op) || !Number.isFinite(v)) return [];
    return [{ field, op, value: v }];
  }).slice(0, 12);
}

const json = body => new Response(JSON.stringify(body), {
  status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' },
});

async function handleMeta() {
  return json({
    llm: false,
    groups: GROUPS,
    timeframes: TIMEFRAMES,
    intraday: INTRADAY,
    presets: Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label })),
    indicators: FIELDS.map(f => ({
      field: f,
      label: INDICATORS[f].label,
      desc: INDICATORS[f].desc,
      group: INDICATORS[f].group,
      fmt: INDICATORS[f].fmt,
      where: INDICATORS[f].where,
      tf: INDICATORS[f].tf ?? null,
      preset: INDICATORS[f].preset ?? null,
    })),
  });
}

async function handleBrowse(urlStr) {
  const p = new URL(urlStr, location.origin).searchParams;
  const markets = (p.get('markets') ?? 'US').split(',')
    .filter(m => ['IDX', 'US', 'CRYPTO'].includes(m));
  if (!markets.length) return json({ error: 'Pasar tidak dikenal.' });

  const preset = PRESETS[p.get('preset')] ? p.get('preset') : 'overview';
  const usable = f => markets.some(m => marketsFor(f).includes(m));

  const extra = (p.get('cols') ?? '').split(',').filter(c => FIELDS.includes(c));
  const hidden = new Set((p.get('hide') ?? '').split(',').filter(Boolean));

  const all = parseFilters(p.getAll('f'));
  const filters = all.filter(f => usable(f.field));
  const mismatched = all.filter(f => !usable(f.field)).map(f => ({
    field: f.field, label: INDICATORS[f.field].label,
    only: marketsFor(f.field), asked: markets,
  }));

  const asked = p.get('sort');
  const dir = p.get('dir') === 'asc' ? 'asc' : 'desc';
  const fallback = usable(PRESET_SORT[preset].field)
    ? PRESET_SORT[preset]
    : { field: 'turnover', dir: 'desc' };
  const sort = (FIELDS.includes(asked) && usable(asked)) ? { field: asked, dir } : fallback;

  const wanted = [...PRESETS[preset].columns.filter(c => !hidden.has(c)), ...extra];
  const columns = buildColumns(wanted, markets);

  const scanned = (await rows()).filter(r => markets.includes(r.market));
  const limit = Math.min(200, Math.max(1, Number(p.get('limit')) || 50));

  return json({
    query: {
      markets, preset, sort, limit, filters, mismatched,
      hidden: [...hidden], extra, unsupported: [], explain: '',
    },
    columns,
    rows: apply(scanned, { filters, sort, limit }),
    scanned: scanned.length,
  });
}

async function handleScreen(init) {
  const { prompt } = JSON.parse((init && init.body) || '{}');
  if (typeof prompt !== 'string' || !prompt.trim()) return json({ error: 'Prompt kosong.' });

  const q = parseRules(prompt.trim().slice(0, 500));
  const scanned = (await rows()).filter(r => q.markets.includes(r.market));
  return json({
    query: q,
    columns: buildColumns(q.columns.length ? q.columns : DEFAULT_COLUMNS, q.markets),
    rows: apply(scanned, q),
    scanned: scanned.length,
  });
}

const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('/api/browse')) return handleBrowse(url);
  if (url.startsWith('/api/meta')) return handleMeta();
  if (url.startsWith('/api/screen')) return handleScreen(init);
  return realFetch(input, init);
};
