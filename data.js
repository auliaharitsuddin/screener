import { IDX, US } from './universe.js';
import { fetchFundamentals } from './fundamentals.js';

const UA = { 'User-Agent': 'Mozilla/5.0' };
const cache = new Map(); // key -> { at, rows }
const TTL = 5 * 60_000;

const pct = (a, b) => (a == null || !b) ? null : ((a - b) / b) * 100;

// RSI Wilder. Butuh >= n+1 closes, kalau kurang balikin null.
export function rsi14(closes, n = 14) {
  if (closes.length < n + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) g += d; else l -= d;
  }
  let ag = g / n, al = l / n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (n - 1) + (d > 0 ? d : 0)) / n;
    al = (al * (n - 1) + (d < 0 ? -d : 0)) / n;
  }
  if (al === 0) return ag === 0 ? 50 : 100;
  return 100 - 100 / (1 + ag / al);
}

// Ambil closes ke-N hari lalu dari ujung, clamp ke data terlama yang ada.
const back = (c, n) => c[Math.max(0, c.length - 1 - n)];

const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;

// SMA N periode terakhir. Butuh data penuh, kalau kurang balikin null supaya
// tidak memalsukan SMA200 dari 60 hari data.
const sma = (c, n) => c.length < n ? null : mean(c.slice(-n));

// Deviasi standar return harian, disetahunkan (252 hari bursa).
function annualVol(closes) {
  if (closes.length < 30) return null;
  const rets = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1]) rets.push(closes[i] / closes[i - 1] - 1);
  }
  if (rets.length < 20) return null;
  const m = mean(rets);
  const variance = mean(rets.map(r => (r - m) ** 2));
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

// EMA. Seed pakai SMA periode pertama, lalu smoothing biasa.
function ema(c, n) {
  if (c.length < n) return null;
  const k = 2 / (n + 1);
  let e = mean(c.slice(0, n));
  for (let i = n; i < c.length; i++) e = c[i] * k + e * (1 - k);
  return e;
}

// Seluruh seri EMA, dibutuhkan MACD karena garis sinyal adalah EMA dari MACD.
function emaSeries(c, n) {
  if (c.length < n) return [];
  const k = 2 / (n + 1);
  const out = [mean(c.slice(0, n))];
  for (let i = n; i < c.length; i++) out.push(c[i] * k + out[out.length - 1] * (1 - k));
  return out;
}

function macd(c) {
  if (c.length < 35) return { macd: null, signal: null, hist: null };
  const f = emaSeries(c, 12), s = emaSeries(c, 26);
  // Kedua seri beda panjang karena beda periode seed; sejajarkan dari ujung.
  const n = Math.min(f.length, s.length);
  const line = Array.from({ length: n }, (_, i) =>
    f[f.length - n + i] - s[s.length - n + i]);
  if (line.length < 9) return { macd: line.at(-1), signal: null, hist: null };
  const sig = emaSeries(line, 9);
  const m = line.at(-1), g = sig.at(-1);
  return { macd: m, signal: g, hist: m - g };
}

// Stochastic %K: posisi close dalam rentang high-low n hari.
function stochastic(highs, lows, closes, n = 14) {
  if (closes.length < n) return null;
  const hi = Math.max(...highs.slice(-n));
  const lo = Math.min(...lows.slice(-n));
  return hi === lo ? 50 : ((closes.at(-1) - lo) / (hi - lo)) * 100;
}

// CCI: simpangan harga tipikal dari rata-ratanya, diskalakan deviasi absolut.
function cci(highs, lows, closes, n = 20) {
  if (closes.length < n) return null;
  const tp = closes.map((c, i) => (highs[i] + lows[i] + c) / 3).slice(-n);
  const avg = mean(tp);
  const dev = mean(tp.map(v => Math.abs(v - avg)));
  return dev === 0 ? 0 : (tp.at(-1) - avg) / (0.015 * dev);
}

// ATR Wilder, dikembalikan sebagai persen harga supaya bisa dibandingkan antar saham.
function atrPct(highs, lows, closes, n = 14) {
  if (closes.length < n + 1) return null;
  const tr = [];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    ));
  }
  let a = mean(tr.slice(0, n));
  for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n;
  const last = closes.at(-1);
  return last ? (a / last) * 100 : null;
}

// Bollinger Band 20 hari, 2 deviasi. Mengembalikan posisi harga dalam pita
// (0 = batas bawah, 100 = batas atas) dan lebar pita sebagai persen harga.
function bollinger(c, n = 20, mult = 2) {
  if (c.length < n) return { pos: null, width: null };
  const win = c.slice(-n);
  const m = mean(win);
  const sd = Math.sqrt(mean(win.map(v => (v - m) ** 2)));
  if (!sd || !m) return { pos: null, width: null };
  const up = m + mult * sd, lo = m - mult * sd;
  return {
    pos: ((c.at(-1) - lo) / (up - lo)) * 100,
    width: ((up - lo) / m) * 100,
  };
}

// Close terakhir sebelum 1 Januari tahun berjalan, untuk basis YTD.
function ytdBase(closes, stamps) {
  const jan1 = Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000;
  for (let i = stamps.length - 1; i >= 0; i--) {
    if (stamps[i] < jan1) return closes[i];
  }
  return closes[0] ?? null; // seluruh seri sudah di tahun ini
}

async function yahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`yahoo ${symbol} ${r.status}`);
  const res = (await r.json())?.chart?.result?.[0];
  if (!res) throw new Error(`yahoo ${symbol} empty`);
  const m = res.meta;
  const q = res.indicators?.quote?.[0] ?? {};
  const stamps = res.timestamp ?? [];

  // Buang hari libur/suspend, tapi jaga closes, volumes, dan stamps tetap sejajar
  // supaya basis YTD diambil dari tanggal yang benar.
  const closes = [], volumes = [], days = [], highs = [], lows = [], opens = [];
  (q.close ?? []).forEach((c, i) => {
    if (typeof c !== 'number') return;
    closes.push(c);
    volumes.push(typeof q.volume?.[i] === 'number' ? q.volume[i] : 0);
    days.push(stamps[i] ?? 0);
    // High/low bisa bolong walau close ada; jatuhkan ke close supaya seri tetap sejajar.
    highs.push(typeof q.high?.[i] === 'number' ? q.high[i] : c);
    lows.push(typeof q.low?.[i] === 'number' ? q.low[i] : c);
    opens.push(typeof q.open?.[i] === 'number' ? q.open[i] : c);
  });

  const price = m.regularMarketPrice;
  const avgVol10d = volumes.length >= 10 ? mean(volumes.slice(-10)) : null;
  const s50 = sma(closes, 50), s200 = sma(closes, 200);
  const md = macd(closes);
  const bb = bollinger(closes);
  const prevClose = m.chartPreviousClose ?? back(closes, 1);
  const dayHigh = m.regularMarketDayHigh, dayLow = m.regularMarketDayLow;

  return {
    kind: 'stock',
    symbol: m.symbol.replace('.JK', ''),
    ySymbol: m.symbol, // simbol asli Yahoo, dipakai saat menarik fundamental
    market: m.symbol.endsWith('.JK') ? 'IDX' : 'US',
    name: m.longName || m.shortName || m.symbol,
    currency: m.currency,
    price,
    change24h: m.regularMarketChangePercent ?? null,
    volume: m.regularMarketVolume ?? null,
    // Nilai transaksi harian, satu-satunya proxy "ukuran" yang tersedia tanpa API berbayar.
    turnover: (m.regularMarketVolume ?? 0) * (price ?? 0),
    avgVol10d,
    relVol: avgVol10d ? (m.regularMarketVolume ?? 0) / avgVol10d : null,
    change7d: pct(price, back(closes, 5)),
    change30d: pct(price, back(closes, 21)),
    change90d: pct(price, back(closes, 63)),
    change180d: pct(price, back(closes, 126)),
    changeYtd: pct(price, ytdBase(closes, days)),
    change1y: pct(price, closes[0]),
    gap: pct(m.regularMarketOpen ?? opens.at(-1), back(closes, 1)),
    dayRange: (dayHigh && dayLow && price) ? ((dayHigh - dayLow) / price) * 100 : null,
    rsi: rsi14(closes),
    rsi7: rsi14(closes, 7),
    stochK: stochastic(highs, lows, closes),
    // Williams %R adalah Stochastic %K digeser ke rentang -100..0.
    williamsR: (() => { const k = stochastic(highs, lows, closes); return k === null ? null : k - 100; })(),
    cci: cci(highs, lows, closes),
    momentum: pct(price, back(closes, 10)),
    macd: md.macd,
    macdSignal: md.signal,
    macdHist: md.hist,
    sma20Dist: pct(price, sma(closes, 20)),
    sma50Dist: pct(price, s50),
    sma200Dist: pct(price, s200),
    ema20Dist: pct(price, ema(closes, 20)),
    bbPosition: bb.pos,
    bbWidth: bb.width,
    atr: atrPct(highs, lows, closes),
    volatility: annualVol(closes),
    high52w: m.fiftyTwoWeekHigh ?? null,
    low52w: m.fiftyTwoWeekLow ?? null,
    fromHigh: pct(price, m.fiftyTwoWeekHigh),
    fromLow: pct(price, m.fiftyTwoWeekLow),
    // Field fundamental diisi belakangan oleh withFundamentals() kalau memang
    // dibutuhkan; menariknya selalu akan melipatgandakan waktu muat.
    marketCap: null,
  };
}

async function crypto() {
  const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc'
    + '&per_page=250&page=1&price_change_percentage=7d,30d,1y';
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`coingecko ${r.status}`);
  return (await r.json()).map(c => ({
    kind: 'crypto',
    symbol: c.symbol.toUpperCase(),
    market: 'CRYPTO',
    name: c.name,
    currency: 'USD',
    price: c.current_price,
    change24h: c.price_change_percentage_24h,
    change7d: c.price_change_percentage_7d_in_currency,
    change30d: c.price_change_percentage_30d_in_currency,
    change1y: c.price_change_percentage_1y_in_currency,
    volume: c.total_volume,
    turnover: c.total_volume,
    marketCap: c.market_cap,
    // Semua di bawah ini butuh seri harga harian per-koin. Mengambilnya untuk 250 koin
    // berarti 250 request ke CoinGecko gratis, yang kena rate limit. Registry indicators.js
    // menandai field ini milik IDX/US saja, jadi UI memberi tahu user alih-alih diam.
    change90d: null, change180d: null, changeYtd: null,
    avgVol10d: null, relVol: null, gap: null, dayRange: null,
    rsi: null, rsi7: null, stochK: null, williamsR: null, cci: null,
    momentum: null, macd: null, macdSignal: null, macdHist: null,
    sma20Dist: null, sma50Dist: null, sma200Dist: null, ema20Dist: null,
    bbPosition: null, bbWidth: null, atr: null, volatility: null,
    high52w: c.ath,
    low52w: c.atl,
    fromHigh: c.ath_change_percentage,
    fromLow: c.atl_change_percentage,
  }));
}

// Batasi konkurensi biar Yahoo tidak nge-throttle.
async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const item = items[i++];
      try { out.push(await fn(item)); } catch { /* skip simbol yang gagal */ }
    }
  }));
  return out;
}

export async function getRows(markets) {
  const want = new Set(markets);
  const jobs = [];
  if (want.has('CRYPTO')) jobs.push(['CRYPTO', () => crypto()]);
  if (want.has('IDX')) jobs.push(['IDX', () => pool(IDX, 8, yahoo)]);
  if (want.has('US')) jobs.push(['US', () => pool(US, 8, yahoo)]);

  const parts = await Promise.all(jobs.map(async ([key, run]) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.rows;
    const rows = await run();
    cache.set(key, { at: Date.now(), rows });
    return rows;
  }));
  return parts.flat();
}

// --- Fundamental --------------------------------------------------------
// Ditarik terpisah dari harga karena butuh satu request quoteSummary per simbol.
// Hanya dipanggil kalau kolom/filter memang memerlukannya.
const fCache = new Map(); // symbol -> { at, data }
const F_TTL = 60 * 60_000; // fundamental berubah kuartalan, 1 jam sudah longgar

export async function withFundamentals(rows) {
  const stocks = rows.filter(r => r.kind === 'stock');
  if (!stocks.length) return rows;

  const now = Date.now();
  const stale = stocks.filter(r => {
    const hit = fCache.get(r.ySymbol);
    return !hit || now - hit.at > F_TTL;
  });

  await pool(stale, 6, async r => {
    try {
      fCache.set(r.ySymbol, { at: Date.now(), data: await fetchFundamentals(r.ySymbol) });
    } catch {
      // Simbol yang gagal dicache sebagai kosong supaya tidak dicoba terus
      // dalam satu jam ke depan dan memperlambat setiap request.
      fCache.set(r.ySymbol, { at: Date.now(), data: {} });
    }
  });

  for (const r of stocks) {
    Object.assign(r, fCache.get(r.ySymbol)?.data ?? {});
    // Turunan yang butuh harga terkini, jadi dihitung di sini bukan di cache.
    r.upside = pct(r.targetPrice, r.price);
  }
  return rows;
}
