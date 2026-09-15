import { INDICATORS, FIELDS, UNSUPPORTED, marketsFor } from './indicators.js';
import { parseRules } from './parser.js';

const OPS = ['>', '>=', '<', '<=', '=', '!='];

// Daftar field dibangun dari registry, jadi menambah indikator di indicators.js
// otomatis ikut ke prompt tanpa menyunting teks di sini.
const fieldDocs = FIELDS.map(f => {
  const i = INDICATORS[f];
  const scope = i.where ? ` [HANYA ${i.where.join('/')}]` : '';
  return `- ${f.padEnd(11)}: ${i.desc}${scope}`;
}).join('\n');

const unsupportedDocs = Object.entries(UNSUPPORTED)
  .map(([k, v]) => `${k} (${v})`).join(', ');

const SCHEMA = `Kamu menerjemahkan permintaan screener saham/kripto jadi JSON.
Balas HANYA JSON valid, tanpa markdown fence, tanpa penjelasan di luar JSON.

{
  "markets": ["IDX"|"US"|"CRYPTO", ...],
  "filters": [{"field": <field>, "op": ">"|">="|"<"|"<="|"="|"!=", "value": <angka>}],
  "sort": {"field": <field>, "dir": "asc"|"desc"},
  "columns": [<field>, ...],
  "unsupported": [<nama indikator yang diminta user tapi tidak ada di daftar field>],
  "limit": <angka 1-100>,
  "explain": "<1 kalimat bahasa Indonesia menjelaskan kriteria yang dipakai>"
}

FIELD YANG TERSEDIA (satuan persen kecuali disebut lain):
${fieldDocs}

INDIKATOR YANG TIDAK TERSEDIA:
${unsupportedDocs}
Kalau user meminta salah satu dari ini, JANGAN mengarangnya jadi field lain dan
JANGAN menjadikannya filter. Masukkan namanya ke array "unsupported", lalu tetap
kerjakan sisa kriteria yang memang bisa. Kalau SELURUH permintaan user tidak
tersedia, kembalikan filters kosong dan isi "unsupported".

ATURAN:
- markets default ["IDX","US","CRYPTO"] kalau user tidak menyebut pasar.
- "saham indonesia"/"IHSG"/"BEI" -> ["IDX"]; "saham amerika"/"US"/"nasdaq" -> ["US"];
  "kripto"/"coin"/"altcoin"/"bitcoin" -> ["CRYPTO"].
- Field bertanda [HANYA ...] cuma punya data di pasar itu. Kalau user memintanya
  TANPA menyebut pasar, set markets ke pasar yang mendukung field tersebut.
  Kalau user MENYEBUT pasar yang tidak mendukung field itu (misalnya minta RSI
  untuk kripto), tetap hormati pasar pilihan user DAN tetap tulis filternya
  seperti biasa. Sistem yang akan melaporkan ketidakcocokan itu ke user.
  Field yang ada di daftar FIELD TERSEDIA tidak pernah masuk ke "unsupported",
  apa pun pasarnya.
- "columns" berisi field yang relevan dengan permintaan user, supaya tabel
  menampilkan angka yang dia tanyakan. Selalu sertakan field yang dipakai di
  filters dan sort. Maksimal 7 field. Kalau user tidak menyiratkan indikator
  tertentu, isi dengan field yang paling relevan untuk kriterianya.
- "oversold" -> rsi < 30. "overbought" -> rsi > 70.
- "murah"/"diskon"/"jauh dari puncak" -> fromHigh < -30.
- "momentum"/"lagi naik"/"kuat" -> change30d > 10.
- "di atas MA50"/"di atas rata-rata 50 hari" -> sma50Dist > 0. Begitu juga sma200Dist/sma20Dist.
- "ramai"/"volume tidak biasa"/"unusual volume" -> relVol > 2.
- "stabil"/"tidak volatil" -> volatility < 30. "liar"/"volatil" -> volatility > 60.
- "murah"/"undervalued" (konteks fundamental) -> pe < 15. "mahal" -> pe > 50.
- "PER"/"P/E" -> pe. "PBV" -> pbv. "PEG" -> peg.
- "profitable"/"untung" -> profitMargin > 0. "rugi" -> profitMargin < 0.
- "dividen tinggi"/"yield bagus" -> dividendYield > 3.
- "bluechip"/"perusahaan besar" -> marketCap > 10000000000.
- "tumbuh cepat"/"growth" -> revenueGrowth > 20.
- "utang rendah"/"sehat" -> der < 50.
- "MACD bullish"/"golden cross MACD" -> macdHist > 0.
- "menembus Bollinger atas" -> bbPosition > 100. "bawah" -> bbPosition < 0.
- "gap up" -> gap > 2. "gap down" -> gap < -2.
- "rekomendasi analis bagus"/"strong buy" -> recommendation < 2.
- "upside besar" -> upside > 20.
- limit default 25.`;

function parseJSON(text) {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('LLM tidak mengembalikan JSON');
  return JSON.parse(text.slice(s, e + 1));
}

// Output LLM adalah data tak terpercaya. Semuanya divalidasi terhadap registry
// sebelum dipakai; yang tidak dikenal dibuang, bukan dieksekusi.
function sanitize(q) {
  const markets = (Array.isArray(q.markets) ? q.markets : [])
    .filter(m => ['IDX', 'US', 'CRYPTO'].includes(m));

  const filters = (Array.isArray(q.filters) ? q.filters : [])
    .filter(f => FIELDS.includes(f?.field) && OPS.includes(f?.op)
      && typeof f?.value === 'number' && Number.isFinite(f.value))
    .slice(0, 8);

  const sort = FIELDS.includes(q.sort?.field)
    ? { field: q.sort.field, dir: q.sort.dir === 'asc' ? 'asc' : 'desc' }
    : { field: 'turnover', dir: 'desc' };

  // Kolom yang dipakai filter dan sort wajib tampil, supaya user bisa memverifikasi
  // sendiri kenapa satu baris lolos.
  const asked = Array.isArray(q.columns) ? q.columns.filter(c => FIELDS.includes(c)) : [];
  const columns = [...new Set([
    ...filters.map(f => f.field),
    sort.field,
    ...asked,
  ])].slice(0, 8);

  // LLM boleh menulis nama bebas di sini, jadi dibatasi panjang dan jumlahnya.
  const unsupported = (Array.isArray(q.unsupported) ? q.unsupported : [])
    .filter(u => typeof u === 'string' && u.trim())
    .map(u => u.trim())
    // Field yang sebenarnya ADA dibuang dari sini. Kalau field itu cuma tidak
    // punya data di pasar yang diminta, reconcile() yang melaporkannya, dengan
    // pesan yang menyebut pasar mana yang punya. Tanpa ini user diberi tahu
    // "RSI belum tersedia" padahal RSI ada, hanya tidak untuk kripto.
    .filter(u => !FIELDS.includes(u))
    .map(u => {
      const key = u.toLowerCase().replace(/[^a-z]/g, '');
      const hit = Object.keys(UNSUPPORTED).find(k => k.toLowerCase() === key);
      return hit ? UNSUPPORTED[hit] : u.slice(0, 40);
    })
    .slice(0, 8);

  return {
    markets: markets.length ? markets : ['IDX', 'US', 'CRYPTO'],
    filters, sort, columns, unsupported,
    limit: Math.min(100, Math.max(1, Math.trunc(q.limit) || 25)),
    explain: typeof q.explain === 'string' ? q.explain.slice(0, 200) : '',
  };
}

// Field yang tidak punya data di pasar terpilih dibuang dari filter, dan alasannya
// dilaporkan. Tanpa ini filter seperti rsi<30 atas CRYPTO diam-diam mengosongkan hasil.
export function reconcile(q) {
  const notes = [];
  const kept = [];

  for (const f of q.filters) {
    const ok = marketsFor(f.field);
    const usable = q.markets.filter(m => ok.includes(m));
    if (usable.length) { kept.push(f); continue; }
    notes.push({
      field: f.field,
      label: INDICATORS[f.field].label,
      only: ok,
      asked: q.markets,
    });
  }

  const columns = q.columns.filter(c => q.markets.some(m => marketsFor(c).includes(m)));
  const sortOk = q.markets.some(m => marketsFor(q.sort.field).includes(m));

  return {
    ...q,
    filters: kept,
    columns,
    sort: sortOk ? q.sort : { field: 'turnover', dir: 'desc' },
    mismatched: notes,
  };
}

export async function parsePrompt(prompt, apiKey, engine = 'auto') {
  // Tanpa API key, atau kalau user memaksa, pakai penerjemah aturan lokal.
  if (engine === 'rules' || !apiKey) return reconcile(parseRules(prompt));

  try {
    return await viaLlm(prompt, apiKey);
  } catch (e) {
    // LLM gagal (kuota habis, jaringan, model berubah): jangan bikin fitur mati,
    // jatuhkan ke aturan lokal dan beri tahu user lewat `fallback`.
    const r = reconcile(parseRules(prompt));
    r.fallback = e.message.slice(0, 160);
    return r;
  }
}

async function viaLlm(prompt, apiKey) {
  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const r = await fetch(url, {
    method: 'POST',
    // Key lewat header, bukan query string, supaya tidak ikut tercetak di log URL.
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SCHEMA }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const parts = (await r.json()).candidates?.[0]?.content?.parts ?? [];
  // Model "thinking" bisa mengirim part pikiran lebih dulu; ambil yang berisi teks JSON.
  const txt = parts.map(p => p.text ?? '').join('');
  return reconcile({ ...sanitize(parseJSON(txt)), engine: 'llm', unparsed: [] });
}
