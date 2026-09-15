// Data fundamental dari Yahoo quoteSummary. Endpoint ini butuh cookie + crumb;
// tanpa keduanya balas "Invalid Crumb". Crumb dicache dan diambil ulang otomatis
// kalau kedaluwarsa.
const UA = { 'User-Agent': 'Mozilla/5.0' };

let auth = null; // { cookie, crumb, at }
const AUTH_TTL = 30 * 60_000;

async function getAuth(force = false) {
  if (!force && auth && Date.now() - auth.at < AUTH_TTL) return auth;

  const r = await fetch('https://fc.yahoo.com/', {
    headers: UA, redirect: 'manual', signal: AbortSignal.timeout(15000),
  });
  // Set-Cookie bisa banyak; ambil pasangan nama=nilai saja.
  const cookie = (r.headers.getSetCookie?.() ?? [])
    .map(c => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('Yahoo tidak memberi cookie');

  const cr = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { ...UA, cookie }, signal: AbortSignal.timeout(15000),
  });
  const crumb = (await cr.text()).trim();
  if (!crumb || crumb.includes('<')) throw new Error('Yahoo tidak memberi crumb');

  auth = { cookie, crumb, at: Date.now() };
  return auth;
}

const MODULES = 'defaultKeyStatistics,financialData,summaryDetail';

// Yahoo membungkus angka sebagai {raw, fmt}; kadang juga angka telanjang.
const raw = v => {
  const n = (v && typeof v === 'object') ? v.raw : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const asPct = v => { const n = raw(v); return n === null ? null : n * 100; };

export async function fetchFundamentals(symbol) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { cookie, crumb } = await getAuth(attempt > 0);
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/`
      + `${encodeURIComponent(symbol)}?modules=${MODULES}&crumb=${encodeURIComponent(crumb)}`;
    const r = await fetch(url, { headers: { ...UA, cookie }, signal: AbortSignal.timeout(15000) });

    if (r.status === 401 || r.status === 403) continue; // crumb basi, ambil baru
    if (!r.ok) throw new Error(`quoteSummary ${symbol} ${r.status}`);

    const res = (await r.json())?.quoteSummary?.result?.[0];
    if (!res) return {};
    const m = { ...res.defaultKeyStatistics, ...res.financialData, ...res.summaryDetail };

    return {
      marketCap: raw(m.marketCap),
      pe: raw(m.trailingPE),
      forwardPe: raw(m.forwardPE),
      peg: raw(m.pegRatio),
      pbv: raw(m.priceToBook),
      ps: raw(m.priceToSalesTrailing12Months),
      eps: raw(m.trailingEps),
      epsForward: raw(m.forwardEps),
      beta: raw(m.beta),
      // Yahoo memberi rasio 0-1 untuk field persen; dinormalkan ke persen di sini
      // supaya seluruh aplikasi memakai satu satuan.
      roe: asPct(m.returnOnEquity),
      roa: asPct(m.returnOnAssets),
      profitMargin: asPct(m.profitMargins),
      operatingMargin: asPct(m.operatingMargins),
      grossMargin: asPct(m.grossMargins),
      revenueGrowth: asPct(m.revenueGrowth),
      earningsGrowth: asPct(m.earningsGrowth),
      dividendYield: asPct(m.dividendYield),
      payoutRatio: asPct(m.payoutRatio),
      der: raw(m.debtToEquity),
      currentRatio: raw(m.currentRatio),
      quickRatio: raw(m.quickRatio),
      revenue: raw(m.totalRevenue),
      netIncome: raw(m.netIncomeToCommon),
      ebitda: raw(m.ebitda),
      freeCashflow: raw(m.freeCashflow),
      totalCash: raw(m.totalCash),
      totalDebt: raw(m.totalDebt),
      bookValue: raw(m.bookValue),
      targetPrice: raw(m.targetMeanPrice),
      recommendation: raw(m.recommendationMean),
    };
  }
  throw new Error(`quoteSummary ${symbol}: auth gagal`);
}
