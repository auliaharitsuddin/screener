// Self-check logika murni. Jalankan: node test.js
import assert from 'node:assert/strict';
import { apply } from './filter.js';
import { rsi14 } from './data.js';

// RSI: seri naik terus -> 100, turun terus -> 0, data kurang dari 15 -> null.
const naik = Array.from({ length: 30 }, (_, i) => 100 + i);
const turun = Array.from({ length: 30 }, (_, i) => 130 - i);
assert.equal(rsi14(naik), 100, 'seri naik monoton harus RSI 100');
assert.ok(rsi14(turun) < 0.001, 'seri turun monoton harus RSI ~0');
assert.equal(rsi14([1, 2, 3]), null, 'data kurang dari 15 titik harus null');
assert.ok(rsi14(Array(30).fill(50)) === 50, 'seri datar harus RSI 50');

const rows = [
  { symbol: 'A', rsi: 25, change30d: 5, turnover: 100 },
  { symbol: 'B', rsi: 80, change30d: 40, turnover: 300 },
  { symbol: 'C', rsi: null, change30d: 12, turnover: 200 }, // kripto: rsi tidak ada
  { symbol: 'D', rsi: 45, change30d: -8, turnover: 400 },
];
const q = (filters, sort, limit = 25) => ({ filters, sort, limit });

// Filter numerik dasar.
assert.deepEqual(
  apply(rows, q([{ field: 'rsi', op: '<', value: 30 }], { field: 'turnover', dir: 'desc' }))
    .map(r => r.symbol),
  ['A'], 'filter rsi < 30');

// Baris dengan field null TIDAK lolos filter atas field itu.
assert.deepEqual(
  apply(rows, q([{ field: 'rsi', op: '>', value: 0 }], { field: 'turnover', dir: 'desc' }))
    .map(r => r.symbol),
  ['D', 'B', 'A'], 'null tidak boleh lolos filter rsi');

// Dua filter digabung dengan AND.
assert.deepEqual(
  apply(rows, q(
    [{ field: 'change30d', op: '>', value: 0 }, { field: 'rsi', op: '<=', value: 70 }],
    { field: 'change30d', dir: 'desc' })).map(r => r.symbol),
  ['A'], 'filter AND');

// Sort desc dan asc.
assert.deepEqual(
  apply(rows, q([], { field: 'turnover', dir: 'desc' })).map(r => r.symbol),
  ['D', 'B', 'C', 'A'], 'sort desc');
assert.deepEqual(
  apply(rows, q([], { field: 'turnover', dir: 'asc' })).map(r => r.symbol),
  ['A', 'C', 'B', 'D'], 'sort asc');

// Null selalu di bawah, termasuk saat sort asc.
assert.equal(
  apply(rows, q([], { field: 'rsi', dir: 'asc' })).at(-1).symbol,
  'C', 'baris null harus paling bawah saat asc');
assert.equal(
  apply(rows, q([], { field: 'rsi', dir: 'desc' })).at(-1).symbol,
  'C', 'baris null harus paling bawah saat desc');

// Limit memotong hasil.
assert.equal(apply(rows, q([], { field: 'turnover', dir: 'desc' }, 2)).length, 2, 'limit');

console.log('semua check lolos');

// --- Registry indikator dan reconcile -----------------------------------

import { reconcile } from './llm.js';
import { INDICATORS, FIELDS, availableIn, marketsFor } from './indicators.js';

// Setiap indikator wajib punya label, fmt, dan desc; UI bergantung pada ketiganya.
for (const [k, v] of Object.entries(INDICATORS)) {
  assert.ok(v.label && v.fmt && v.desc, `${k} harus punya label, fmt, desc`);
  assert.ok(['pct', 'num', 'price', 'compact', 'plain', 'ratio'].includes(v.fmt), `${k} fmt tidak dikenal`);
  assert.ok(v.where === null || Array.isArray(v.where), `${k} where harus null atau array`);
}

assert.ok(availableIn('rsi', ['IDX']), 'rsi ada di IDX');
assert.ok(!availableIn('rsi', ['CRYPTO']), 'rsi tidak ada di CRYPTO');
assert.ok(availableIn('rsi', ['CRYPTO', 'US']), 'rsi ada kalau salah satu pasar mendukung');
assert.ok(availableIn('price', ['CRYPTO']), 'field tanpa batasan ada di semua pasar');
assert.deepEqual(marketsFor('rsi'), ['IDX', 'US'], 'rsi hanya saham');
assert.deepEqual(marketsFor('marketCap'), ['IDX', 'US', 'CRYPTO'],
  'marketCap kini ada di semua pasar lewat quoteSummary');

const base = { markets: ['CRYPTO'], columns: [], unsupported: [], limit: 25, explain: '' };

// Filter atas field yang tidak ada di pasar terpilih harus dibuang dan dilaporkan,
// bukan diam-diam mengosongkan hasil.
const r1 = reconcile({
  ...base,
  filters: [{ field: 'rsi', op: '<', value: 30 }, { field: 'change7d', op: '>', value: 0 }],
  sort: { field: 'turnover', dir: 'desc' },
});
assert.equal(r1.filters.length, 1, 'filter rsi dibuang untuk CRYPTO');
assert.equal(r1.filters[0].field, 'change7d', 'filter yang valid dipertahankan');
assert.equal(r1.mismatched.length, 1, 'satu laporan mismatch');
assert.equal(r1.mismatched[0].field, 'rsi');
assert.deepEqual(r1.mismatched[0].only, ['IDX', 'US'], 'laporan menyebut pasar yang benar');

// Sort atas field yang tak tersedia jatuh ke default, bukan bikin kolom kosong.
const r2 = reconcile({
  ...base, markets: ['CRYPTO'], filters: [],
  sort: { field: 'sma50Dist', dir: 'desc' },
});
assert.equal(r2.sort.field, 'turnover', 'sort tak tersedia jatuh ke turnover');

// Sort yang valid tidak diganggu.
const r3 = reconcile({
  ...base, markets: ['US'], filters: [], sort: { field: 'rsi', dir: 'asc' },
});
assert.equal(r3.sort.field, 'rsi', 'sort valid dipertahankan');
assert.equal(r3.mismatched.length, 0, 'tidak ada mismatch untuk pasar yang cocok');

// Kolom yang tidak punya data di pasar terpilih dibuang dari tabel.
const r4 = reconcile({
  ...base, markets: ['CRYPTO'], filters: [],
  sort: { field: 'turnover', dir: 'desc' },
  columns: ['marketCap', 'rsi', 'change7d'],
});
assert.deepEqual(r4.columns, ['marketCap', 'change7d'], 'kolom rsi dibuang untuk CRYPTO');

// Pasar campuran: field tetap dipakai selama salah satu pasar mendukung.
const r5 = reconcile({
  ...base, markets: ['US', 'CRYPTO'],
  filters: [{ field: 'rsi', op: '<', value: 30 }],
  sort: { field: 'turnover', dir: 'desc' },
});
assert.equal(r5.filters.length, 1, 'rsi dipertahankan kalau US ikut dipilih');
assert.equal(r5.mismatched.length, 0, 'tidak ada mismatch di pasar campuran');

console.log('check indikator lolos');

// --- Preset kolom -------------------------------------------------------

import { PRESETS, PRESET_SORT } from './indicators.js';

// Tiap preset harus punya sort default, dan semua kolomnya harus field yang dikenal.
for (const [id, p] of Object.entries(PRESETS)) {
  assert.ok(p.label, `preset ${id} harus punya label`);
  assert.ok(p.columns.length, `preset ${id} harus punya kolom`);
  for (const c of p.columns) {
    assert.ok(FIELDS.includes(c), `preset ${id}: kolom "${c}" bukan field yang dikenal`);
  }
  assert.ok(PRESET_SORT[id], `preset ${id} harus punya sort default`);
  assert.ok(FIELDS.includes(PRESET_SORT[id].field), `sort default ${id} bukan field dikenal`);
  assert.ok(['asc', 'desc'].includes(PRESET_SORT[id].dir), `arah sort ${id} tidak valid`);
}

// Tiap preset harus menyisakan minimal satu kolom di setiap pasar, kalau tidak
// tabnya jadi tabel kosong yang membingungkan.
for (const [id, p] of Object.entries(PRESETS)) {
  for (const m of ['IDX', 'US', 'CRYPTO']) {
    const usable = p.columns.filter(c => availableIn(c, [m]));
    assert.ok(usable.length, `preset ${id} tidak punya kolom apa pun untuk ${m}`);
  }
}

console.log('check preset lolos');

// --- Indikator teknikal dan registry lengkap ----------------------------

import { GROUPS, TIMEFRAMES, UNSUPPORTED as UNSUP, FUNDAMENTAL_FIELDS, needsFundamentals } from './indicators.js';

// Setiap indikator harus punya group yang dikenal; UI mengelompokkan menu dari sini.
for (const [k, v] of Object.entries(INDICATORS)) {
  assert.ok(GROUPS[v.group], `${k} punya group tak dikenal: ${v.group}`);
}

// Preset ambang harus punya bentuk yang bisa dieksekusi UI.
for (const [k, v] of Object.entries(INDICATORS)) {
  for (const p of v.preset ?? []) {
    assert.ok(p.label, `${k}: preset tanpa label`);
    if (p.op === 'between') {
      assert.ok(Array.isArray(p.value) && p.value.length === 2, `${k}: between butuh 2 nilai`);
      assert.ok(p.value[0] < p.value[1], `${k}: batas bawah harus lebih kecil`);
    } else {
      assert.ok(['>', '>=', '<', '<=', '=', '!='].includes(p.op), `${k}: op tak dikenal`);
      assert.equal(typeof p.value, 'number', `${k}: nilai preset harus angka`);
    }
  }
}

// Tiap timeframe harus menunjuk field yang benar-benar ada.
for (const t of TIMEFRAMES) {
  assert.ok(FIELDS.includes(t.field), `timeframe ${t.id} menunjuk field tak dikenal`);
  assert.equal(INDICATORS[t.field].tf, t.id, `${t.field} harus menandai tf ${t.id}`);
}

// UNSUPPORTED tidak boleh memuat field yang sebenarnya sudah tersedia, kalau
// tidak user diberi tahu "tidak tersedia" untuk sesuatu yang ada.
for (const k of Object.keys(UNSUP)) {
  assert.ok(!FIELDS.includes(k), `"${k}" ada di FIELDS tapi juga di UNSUPPORTED`);
}

// Deteksi kebutuhan fundamental menentukan apakah request lambat dijalankan.
assert.ok(needsFundamentals(['pe']), 'pe butuh fundamental');
assert.ok(needsFundamentals(['change7d', 'roe']), 'satu field fundamental sudah cukup');
assert.ok(!needsFundamentals(['change7d', 'rsi', 'volume']), 'teknikal tidak butuh fundamental');
assert.ok(!FUNDAMENTAL_FIELDS.has('rsi'), 'rsi bukan fundamental');
assert.ok(FUNDAMENTAL_FIELDS.has('dividendYield'), 'dividendYield fundamental');

// Indikator teknikal murni: dihitung dari seri harga buatan dengan nilai yang
// hasilnya bisa diperiksa dengan tangan.
const seriNaik = Array.from({ length: 60 }, (_, i) => 100 + i);
const seriDatar = Array(60).fill(50);

assert.equal(rsi14(seriNaik, 7), 100, 'RSI 7 pada seri naik monoton = 100');
assert.equal(rsi14(seriDatar, 7), 50, 'RSI 7 pada seri datar = 50');
assert.equal(rsi14(seriNaik.slice(0, 5), 7), null, 'data kurang dari periode+1 = null');

console.log('check indikator lanjutan lolos');

// --- Penerjemah aturan (tanpa LLM) --------------------------------------

import { parseRules } from './parser.js';

// Tiap baris: prompt -> filter yang diharapkan (field op value), pasar, sort.
// Kalau kamus di parser.js berubah dan salah satu ini pecah, itu regresi nyata.
const CASES = [
  ['saham indonesia PER di bawah 15 dengan ROE di atas 15',
    ['pe<15', 'roe>15'], ['IDX']],
  ['saham amerika dividen di atas 3% dan utang rendah',
    ['dividendYield>3', 'der<50'], ['US']],
  ['saham yang MACD bullish dan di atas MA200',
    ['sma200Dist>0', 'macdHist>0'], ['IDX', 'US']],
  ['kripto top market cap yang naik minggu ini',
    ['change7d>0'], ['CRYPTO'], 'marketCap desc'],
  ['saham amerika di atas MA50 dan MA200 dengan volume tidak biasa',
    ['sma50Dist>0', 'sma200Dist>0', 'relVol>2'], ['US']],
  ['saham indonesia oversold tapi masih di atas rata-rata 200 hari',
    ['sma200Dist>0', 'rsi<30'], ['IDX']],
  ['saham indonesia paling volatil setahun terakhir',
    [], ['IDX'], 'volatility desc'],
  ['kripto yang anjlok lebih dari 20% sebulan terakhir',
    ['change30d<-20'], ['CRYPTO']],
  ['saham amerika momentum kuat 30 hari tapi belum overbought',
    ['change30d>10', 'rsi<=70'], ['US']],
  ['10 saham dividen tertinggi di indonesia',
    [], ['IDX'], 'dividendYield desc', 10],
  ['market cap di atas 10 miliar dan pbv kurang dari 1',
    ['marketCap>10000000000', 'pbv<1'], ['IDX', 'US']],
  // rsi hanya ada di saham, jadi pasar disempitkan otomatis ke IDX/US.
  ['rsi antara 40 dan 60 dan harga di bawah 1000',
    ['rsi>=40', 'rsi<=60', 'price<1000'], ['IDX', 'US']],
  ['saham indonesia yang oversold dan turun jauh dari puncaknya',
    ['rsi<30', 'fromHigh<-30'], ['IDX']],
  ['urutkan dari rsi terendah', [], ['IDX', 'US'], 'rsi asc'],
  ['kripto naik 20% minggu ini', ['change7d>=20'], ['CRYPTO']],
  ['PER < 10, ROE > 20%, DER < 100', ['pe<10', 'roe>20', 'der<100'], ['IDX', 'US']],
  ['saham US gap up dengan rel vol di atas 3x', ['gap>2', 'relVol>3'], ['US']],
  ['kripto yang turun 10% hari ini', ['change24h<=-10'], ['CRYPTO']],
  ['top 5 saham amerika berdasarkan market cap', [], ['US'], 'marketCap desc', 5],
  ['saham yang menembus bollinger atas', ['bbPosition>100'], ['IDX', 'US']],
  ['saham dengan upside besar dan strong buy', ['upside>20', 'recommendation<2'], ['IDX', 'US']],
];

for (const [prompt, want, markets, sort, limit] of CASES) {
  const r = parseRules(prompt);
  const got = r.filters.map(f => `${f.field}${f.op}${f.value}`).sort();
  assert.deepEqual(got, [...want].sort(), `filter salah untuk: "${prompt}"\n  dapat ${got}`);
  assert.deepEqual(r.markets, markets, `pasar salah untuk: "${prompt}"`);
  if (sort) assert.equal(`${r.sort.field} ${r.sort.dir}`, sort, `sort salah untuk: "${prompt}"`);
  if (limit) assert.equal(r.limit, limit, `limit salah untuk: "${prompt}"`);
  assert.equal(r.unparsed.length, 0, `tidak boleh ada bagian tak dipahami di: "${prompt}" -> ${r.unparsed}`);
}

// Kejujuran: yang tidak dikenali WAJIB dilaporkan, bukan dibuang diam-diam.
let r = parseRules('saham sektor teknologi dengan short interest tinggi');
assert.ok(r.unsupported.includes('sektor/industri'), 'sektor harus dilaporkan tidak tersedia');
assert.ok(r.unsupported.includes('short interest'), 'short interest harus dilaporkan');
assert.equal(r.filters.length, 0, 'tidak boleh mengarang filter dari sektor');

r = parseRules('saham yang bagus buat jangka panjang');
assert.equal(r.filters.length, 0, 'prompt tanpa kriteria terukur tidak boleh menghasilkan filter');
assert.ok(r.unparsed.length === 1, 'prompt kabur harus dilaporkan sebagai tidak dipahami');

r = parseRules('saham bank dengan roe positif');
assert.deepEqual(r.filters.map(f => f.field + f.op + f.value), ['roe>0'], 'kriteria yang dikenali tetap jalan');
assert.ok(r.unsupported.includes('sektor/industri'), 'sisanya dilaporkan');

// Angka gaya Indonesia dan satuan.
r = parseRules('market cap di atas 2,5 triliun');
assert.equal(r.filters[0].value, 2.5e12, '2,5 triliun = 2.5e12');
r = parseRules('harga di bawah 10.000');
assert.equal(r.filters[0].value, 10000, '10.000 = sepuluh ribu');
r = parseRules('market cap > 200B');
assert.equal(r.filters[0].value, 200e9, '200B = 2e11');

console.log('check penerjemah aturan lolos');
