import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { getRows, withFundamentals } from './data.js';
import { parsePrompt } from './llm.js';
import { apply } from './filter.js';
import {
  INDICATORS, BASE_COLUMNS, FIELDS, PRESETS, PRESET_SORT, GROUPS,
  TIMEFRAMES, INTRADAY, marketsFor, needsFundamentals,
} from './indicators.js';

// Dipakai kalau prompt tidak menyiratkan indikator apa pun.
const DEFAULT_COLUMNS = ['change7d', 'change30d', 'change1y', 'turnover'];

// Kolom yang tak punya data di pasar terpilih dibuang, lalu dilengkapi metadata
// dari registry supaya UI tahu cara merendernya.
const buildColumns = (fields, markets) =>
  [...new Set([...BASE_COLUMNS, ...fields])]
    .filter(f => markets.some(m => marketsFor(f).includes(m)))
    .map(f => ({ field: f, ...INDICATORS[f] }));

const OPS = ['>', '>=', '<', '<=', '=', '!='];

// Filter dari UI dikirim sebagai "field:op:value", mis. "rsi:<:30".
// Rentang dikirim sebagai dua filter terpisah, jadi parser ini tetap sederhana.
function parseFilters(list) {
  return list.flatMap(raw => {
    const [field, op, value] = String(raw).split(':');
    const v = Number(value);
    if (!FIELDS.includes(field) || !OPS.includes(op) || !Number.isFinite(v)) return [];
    return [{ field, op, value: v }];
  }).slice(0, 12);
}

const PORT = process.env.PORT || 4900;
const KEY = process.env.GEMINI_API_KEY || '';
if (!KEY) console.warn('GEMINI_API_KEY kosong: prompt diterjemahkan penerjemah aturan lokal.');

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
      const html = await readFile(new URL('./public/index.html', import.meta.url));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    // Tampilan default dan tab preset. Tanpa LLM, jadi jauh lebih cepat dan
    // tetap jalan meski kuota Gemini habis.
    if (req.method === 'GET' && req.url.startsWith('/api/browse')) {
      const p = new URL(req.url, 'http://x').searchParams;

      const markets = (p.get('markets') ?? 'US').split(',')
        .filter(m => ['IDX', 'US', 'CRYPTO'].includes(m));
      if (!markets.length) return json(res, 400, { error: 'Pasar tidak dikenal.' });

      const preset = PRESETS[p.get('preset')] ? p.get('preset') : 'overview';
      const usable = f => markets.some(m => marketsFor(f).includes(m));

      // Kolom tambahan dari tombol "+", di luar preset.
      const extra = (p.get('cols') ?? '').split(',').filter(c => FIELDS.includes(c));
      // Kolom preset yang dibuang user lewat "Remove column".
      const hidden = new Set((p.get('hide') ?? '').split(',').filter(Boolean));

      // Filter dari pill. Yang fieldnya tak ada di pasar ini dilaporkan, bukan
      // dijalankan diam-diam sampai hasilnya kosong tanpa penjelasan.
      const all = parseFilters(p.getAll('f'));
      const filters = all.filter(f => usable(f.field));
      const mismatched = all.filter(f => !usable(f.field)).map(f => ({
        field: f.field, label: INDICATORS[f.field].label,
        only: marketsFor(f.field), asked: markets,
      }));

      // Sort dari klik header, jatuh ke default preset kalau tidak valid atau
      // kolomnya tidak punya data di pasar ini.
      const asked = p.get('sort');
      const dir = p.get('dir') === 'asc' ? 'asc' : 'desc';
      // Default preset pun bisa tak terpakai: Technicals mengurutkan pakai RSI,
      // yang tidak ada di kripto. Tanpa fallback ini urutannya jadi sembarang.
      const fallback = usable(PRESET_SORT[preset].field)
        ? PRESET_SORT[preset]
        : { field: 'turnover', dir: 'desc' };
      const sort = (FIELDS.includes(asked) && usable(asked)) ? { field: asked, dir } : fallback;

      const wanted = [...PRESETS[preset].columns.filter(c => !hidden.has(c)), ...extra];
      const columns = buildColumns(wanted, markets);

      let rows = await getRows(markets);
      // Fundamental hanya ditarik kalau kolom, filter, atau sort memerlukannya:
      // satu request quoteSummary per simbol jauh lebih lambat dari data harga.
      const touched = [...wanted, ...filters.map(f => f.field), sort.field];
      if (needsFundamentals(touched)) rows = await withFundamentals(rows);

      const limit = Math.min(200, Math.max(1, Number(p.get('limit')) || 50));

      return json(res, 200, {
        query: {
          markets, preset, sort, limit, filters, mismatched,
          hidden: [...hidden], extra, unsupported: [], explain: '',
        },
        columns,
        rows: apply(rows, { filters, sort, limit }),
        scanned: rows.length,
      });
    }

    // Katalog indikator untuk menu tambah-filter dan tambah-kolom di UI.
    if (req.method === 'GET' && req.url.startsWith('/api/meta')) {
      return json(res, 200, {
        llm: Boolean(KEY),
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

    if (req.method === 'POST' && req.url === '/api/screen') {
      const chunks = [];
      for await (const c of req) {
        chunks.push(c);
        if (chunks.reduce((n, b) => n + b.length, 0) > 8_000) {
          return json(res, 413, { error: 'Prompt terlalu panjang.' });
        }
      }
      const { prompt, engine } = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      if (typeof prompt !== 'string' || !prompt.trim()) {
        return json(res, 400, { error: 'Prompt kosong.' });
      }

      const q = await parsePrompt(prompt.trim().slice(0, 500), KEY,
        engine === 'rules' ? 'rules' : 'auto');
      let rows = await getRows(q.markets);
      const touched = [...q.columns, ...q.filters.map(f => f.field), q.sort.field];
      if (needsFundamentals(touched)) rows = await withFundamentals(rows);
      return json(res, 200, {
        query: q,
        columns: buildColumns(q.columns.length ? q.columns : DEFAULT_COLUMNS, q.markets),
        rows: apply(rows, q),
        scanned: rows.length,
      });
    }

    json(res, 404, { error: 'Not found' });
  } catch (e) {
    json(res, 500, { error: e.message || 'Kesalahan server' });
  }
});

server.listen(PORT, () => console.log(`Screener jalan di http://localhost:${PORT}`));
