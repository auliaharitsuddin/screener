// Satu sumber kebenaran untuk indikator: dipakai oleh prompt LLM, validasi,
// tabel, filter pill, dan pesan "tidak tersedia". Tambah indikator cukup di sini.
//
// fmt   : cara render di UI (pct | num | price | compact | plain | ratio)
// where : pasar yang punya data ini. null berarti semua pasar.
// group : kategori untuk menu tambah-filter dan tambah-kolom.
// tf    : true kalau indikator ini punya varian timeframe (lihat TIMEFRAMES).
// preset: ambang siap pakai di dropdown filter, meniru TradingView.

// Timeframe yang tersedia. Intraday (1m sampai 4h) sengaja tidak ada: butuh data
// per-jam yang tidak disediakan endpoint harian Yahoo yang kita pakai.
export const TIMEFRAMES = [
  { id: '1D',  label: '1 hari',    field: 'change24h' },
  { id: '1W',  label: '1 minggu',  field: 'change7d' },
  { id: '1M',  label: '1 bulan',   field: 'change30d' },
  { id: '3M',  label: '3 bulan',   field: 'change90d' },
  { id: '6M',  label: '6 bulan',   field: 'change180d' },
  { id: 'YTD', label: 'YTD',       field: 'changeYtd' },
  { id: '1Y',  label: '1 tahun',   field: 'change1y' },
];

// Timeframe intraday yang diminta user tapi tidak punya data. Disebut eksplisit
// supaya UI bisa menjelaskan alih-alih diam.
export const INTRADAY = ['1m', '5m', '15m', '30m', '1h', '2h', '4h'];

const STOCK = ['IDX', 'US'];

// Preset ambang yang dipakai berulang, meniru dropdown filter TradingView.
const PCT_PRESETS = [
  { label: '30% ke atas',    hint: 'Lompatan besar',    op: '>',  value: 30 },
  { label: '20% ke atas',    hint: 'Naik kencang',      op: '>',  value: 20 },
  { label: '10% ke atas',    hint: 'Menuju sesuatu',    op: '>',  value: 10 },
  { label: '5% ke atas',     hint: 'Momentum sedang',   op: '>',  value: 5 },
  { label: '0% sampai 5%',   hint: 'Nyaris diam',       op: 'between', value: [0, 5] },
  { label: '0% ke atas',     hint: 'Di zona hijau',     op: '>',  value: 0 },
  { label: '0% ke bawah',    hint: 'Di zona merah',     op: '<',  value: 0 },
  { label: '-5% sampai 0%',  hint: 'Turun tipis',       op: 'between', value: [-5, 0] },
  { label: '-5% ke bawah',   hint: 'Tekanan jual',      op: '<',  value: -5 },
];

export const INDICATORS = {
  // --- Market data ------------------------------------------------------
  price:      { label: 'Harga',       fmt: 'price',   where: null,  group: 'market', desc: 'harga terakhir' },
  change24h:  { label: 'Chg %',       fmt: 'pct',     where: null,  group: 'market', tf: '1D',  desc: 'perubahan 1 hari', preset: PCT_PRESETS },
  change7d:   { label: 'Perf % 1W',   fmt: 'pct',     where: null,  group: 'market', tf: '1W',  desc: 'perubahan 1 minggu', preset: PCT_PRESETS },
  change30d:  { label: 'Perf % 1M',   fmt: 'pct',     where: null,  group: 'market', tf: '1M',  desc: 'perubahan 1 bulan', preset: PCT_PRESETS },
  change90d:  { label: 'Perf % 3M',   fmt: 'pct',     where: STOCK, group: 'market', tf: '3M',  desc: 'perubahan 3 bulan', preset: PCT_PRESETS },
  change180d: { label: 'Perf % 6M',   fmt: 'pct',     where: STOCK, group: 'market', tf: '6M',  desc: 'perubahan 6 bulan', preset: PCT_PRESETS },
  changeYtd:  { label: 'Perf % YTD',  fmt: 'pct',     where: STOCK, group: 'market', tf: 'YTD', desc: 'perubahan sejak awal tahun', preset: PCT_PRESETS },
  change1y:   { label: 'Perf % 1Y',   fmt: 'pct',     where: null,  group: 'market', tf: '1Y',  desc: 'perubahan 1 tahun', preset: PCT_PRESETS },
  gap:        { label: 'Gap %',       fmt: 'pct',     where: STOCK, group: 'market', desc: 'selisih pembukaan terhadap penutupan kemarin', preset: [
    { label: 'Gap up di atas 3%', op: '>', value: 3 },
    { label: 'Gap up di atas 1%', op: '>', value: 1 },
    { label: 'Gap down di bawah -1%', op: '<', value: -1 },
    { label: 'Gap down di bawah -3%', op: '<', value: -3 },
  ] },
  dayRange:   { label: 'Range hari',  fmt: 'pct',     where: STOCK, group: 'market', desc: 'rentang tinggi-rendah hari ini, persen dari harga' },
  volume:     { label: 'Vol',         fmt: 'compact', where: null,  group: 'market', desc: 'volume terakhir' },
  avgVol10d:  { label: 'Avg vol 10D', fmt: 'compact', where: STOCK, group: 'market', desc: 'rata-rata volume 10 hari' },
  relVol:     { label: 'Rel vol',     fmt: 'ratio',   where: STOCK, group: 'market', desc: 'volume hari ini dibagi rata-rata 10 hari', preset: [
    { label: 'Di atas 5x',   hint: 'Sangat ramai', op: '>', value: 5 },
    { label: 'Di atas 3x',   hint: 'Ramai',        op: '>', value: 3 },
    { label: 'Di atas 2x',   hint: 'Tidak biasa',  op: '>', value: 2 },
    { label: 'Di atas 1x',   hint: 'Di atas normal', op: '>', value: 1 },
    { label: 'Di bawah 0,5x', hint: 'Sepi',        op: '<', value: 0.5 },
  ] },
  turnover:   { label: 'Nilai txn',   fmt: 'compact', where: null,  group: 'market', desc: 'volume dikali harga' },
  marketCap:  { label: 'Mkt cap',     fmt: 'compact', where: null,  group: 'market', desc: 'kapitalisasi pasar', preset: [
    { label: 'Mega di atas 200B', op: '>', value: 200e9 },
    { label: 'Large di atas 10B', op: '>', value: 10e9 },
    { label: 'Mid 2B sampai 10B', op: 'between', value: [2e9, 10e9] },
    { label: 'Small 300jt sampai 2B', op: 'between', value: [300e6, 2e9] },
    { label: 'Micro di bawah 300jt', op: '<', value: 300e6 },
  ] },

  // --- Technical --------------------------------------------------------
  rsi:        { label: 'RSI 14',      fmt: 'num',     where: STOCK, group: 'technical', desc: 'RSI 14 hari, 0-100', preset: [
    { label: 'Oversold di bawah 30', hint: 'Jenuh jual', op: '<', value: 30 },
    { label: 'Di bawah 40',          hint: 'Lemah',      op: '<', value: 40 },
    { label: 'Netral 40 sampai 60',  hint: 'Seimbang',   op: 'between', value: [40, 60] },
    { label: 'Di atas 60',           hint: 'Kuat',       op: '>', value: 60 },
    { label: 'Overbought di atas 70', hint: 'Jenuh beli', op: '>', value: 70 },
  ] },
  rsi7:       { label: 'RSI 7',       fmt: 'num',     where: STOCK, group: 'technical', desc: 'RSI 7 hari, lebih sensitif' },
  stochK:     { label: 'Stoch %K',    fmt: 'num',     where: STOCK, group: 'technical', desc: 'Stochastic %K 14 hari', preset: [
    { label: 'Oversold di bawah 20', op: '<', value: 20 },
    { label: 'Overbought di atas 80', op: '>', value: 80 },
  ] },
  williamsR:  { label: 'Williams %R', fmt: 'num',     where: STOCK, group: 'technical', desc: 'Williams %R 14 hari, -100 sampai 0' },
  cci:        { label: 'CCI 20',      fmt: 'num',     where: STOCK, group: 'technical', desc: 'Commodity Channel Index 20 hari' },
  momentum:   { label: 'Momentum',    fmt: 'pct',     where: STOCK, group: 'technical', desc: 'momentum 10 hari' },
  macd:       { label: 'MACD',        fmt: 'num',     where: STOCK, group: 'technical', desc: 'garis MACD 12-26' },
  macdSignal: { label: 'MACD signal', fmt: 'num',     where: STOCK, group: 'technical', desc: 'garis sinyal MACD 9 hari' },
  macdHist:   { label: 'MACD hist',   fmt: 'num',     where: STOCK, group: 'technical', desc: 'histogram MACD, positif berarti bullish', preset: [
    { label: 'Bullish di atas 0', op: '>', value: 0 },
    { label: 'Bearish di bawah 0', op: '<', value: 0 },
  ] },
  sma20Dist:  { label: 'vs SMA20',    fmt: 'pct',     where: STOCK, group: 'technical', desc: 'jarak harga ke SMA 20 hari' },
  sma50Dist:  { label: 'vs SMA50',    fmt: 'pct',     where: STOCK, group: 'technical', desc: 'jarak harga ke SMA 50 hari', preset: [
    { label: 'Di atas SMA50', op: '>', value: 0 },
    { label: 'Di bawah SMA50', op: '<', value: 0 },
  ] },
  sma200Dist: { label: 'vs SMA200',   fmt: 'pct',     where: STOCK, group: 'technical', desc: 'jarak harga ke SMA 200 hari', preset: [
    { label: 'Di atas SMA200', op: '>', value: 0 },
    { label: 'Di bawah SMA200', op: '<', value: 0 },
  ] },
  ema20Dist:  { label: 'vs EMA20',    fmt: 'pct',     where: STOCK, group: 'technical', desc: 'jarak harga ke EMA 20 hari' },
  bbPosition: { label: 'Posisi BB',   fmt: 'num',     where: STOCK, group: 'technical', desc: 'posisi dalam Bollinger Band, 0 batas bawah 100 batas atas', preset: [
    { label: 'Menembus batas bawah', op: '<', value: 0 },
    { label: 'Menembus batas atas', op: '>', value: 100 },
  ] },
  bbWidth:    { label: 'Lebar BB',    fmt: 'pct',     where: STOCK, group: 'technical', desc: 'lebar Bollinger Band, persen dari harga' },
  atr:        { label: 'ATR %',       fmt: 'pct',     where: STOCK, group: 'technical', desc: 'Average True Range 14 hari, persen dari harga' },
  volatility: { label: 'Volatilitas', fmt: 'pct',     where: STOCK, group: 'technical', desc: 'deviasi standar return harian disetahunkan', preset: [
    { label: 'Tenang di bawah 20%', op: '<', value: 20 },
    { label: 'Sedang 20% sampai 40%', op: 'between', value: [20, 40] },
    { label: 'Liar di atas 60%', op: '>', value: 60 },
  ] },
  fromHigh:   { label: 'Dari puncak', fmt: 'pct',     where: null,  group: 'technical', desc: 'jarak dari puncak 52 minggu, selalu <= 0', preset: [
    { label: 'Dekat puncak, di atas -5%', op: '>', value: -5 },
    { label: 'Turun lebih dari 20%', op: '<', value: -20 },
    { label: 'Turun lebih dari 50%', op: '<', value: -50 },
  ] },
  fromLow:    { label: 'Dari dasar',  fmt: 'pct',     where: null,  group: 'technical', desc: 'jarak dari dasar 52 minggu, selalu >= 0', preset: [
    { label: 'Dekat dasar, di bawah 10%', op: '<', value: 10 },
    { label: 'Naik lebih dari 100%', op: '>', value: 100 },
  ] },
  high52w:    { label: 'Tinggi 52W',  fmt: 'price',   where: null,  group: 'technical', desc: 'harga tertinggi 52 minggu' },
  low52w:     { label: 'Rendah 52W',  fmt: 'price',   where: null,  group: 'technical', desc: 'harga terendah 52 minggu' },

  // --- Valuation --------------------------------------------------------
  pe:         { label: 'P/E',         fmt: 'ratio',   where: STOCK, group: 'valuation', desc: 'price to earnings trailing', preset: [
    { label: 'Di bawah 10', hint: 'Sangat murah', op: '<', value: 10 },
    { label: 'Di bawah 15', hint: 'Murah',        op: '<', value: 15 },
    { label: 'Di bawah 25', hint: 'Wajar',        op: '<', value: 25 },
    { label: 'Di atas 50',  hint: 'Mahal',        op: '>', value: 50 },
  ] },
  forwardPe:  { label: 'P/E forward', fmt: 'ratio',   where: STOCK, group: 'valuation', desc: 'price to earnings proyeksi' },
  peg:        { label: 'PEG',         fmt: 'ratio',   where: STOCK, group: 'valuation', desc: 'PE dibagi pertumbuhan laba', preset: [
    { label: 'Di bawah 1', hint: 'Murah relatif pertumbuhan', op: '<', value: 1 },
    { label: 'Di bawah 2', op: '<', value: 2 },
  ] },
  pbv:        { label: 'PBV',         fmt: 'ratio',   where: STOCK, group: 'valuation', desc: 'price to book value', preset: [
    { label: 'Di bawah 1', hint: 'Di bawah nilai buku', op: '<', value: 1 },
    { label: 'Di bawah 3', op: '<', value: 3 },
  ] },
  ps:         { label: 'P/S',         fmt: 'ratio',   where: STOCK, group: 'valuation', desc: 'price to sales' },
  eps:        { label: 'EPS',         fmt: 'price',   where: STOCK, group: 'valuation', desc: 'laba per saham trailing' },
  epsForward: { label: 'EPS forward', fmt: 'price',   where: STOCK, group: 'valuation', desc: 'laba per saham proyeksi' },
  bookValue:  { label: 'Nilai buku',  fmt: 'price',   where: STOCK, group: 'valuation', desc: 'nilai buku per saham' },
  targetPrice:{ label: 'Target',      fmt: 'price',   where: STOCK, group: 'valuation', desc: 'target harga rata-rata analis' },
  upside:     { label: 'Upside %',    fmt: 'pct',     where: STOCK, group: 'valuation', desc: 'jarak harga ke target analis', preset: [
    { label: 'Upside di atas 20%', op: '>', value: 20 },
    { label: 'Upside di atas 50%', op: '>', value: 50 },
  ] },
  recommendation: { label: 'Rating',  fmt: 'ratio',   where: STOCK, group: 'valuation', desc: 'rating analis, 1 strong buy sampai 5 sell', preset: [
    { label: 'Strong buy di bawah 2', op: '<', value: 2 },
    { label: 'Buy di bawah 2,5', op: '<', value: 2.5 },
  ] },

  // --- Financial --------------------------------------------------------
  roe:        { label: 'ROE %',       fmt: 'pct',     where: STOCK, group: 'financial', desc: 'return on equity', preset: [
    { label: 'Di atas 20%', hint: 'Sangat baik', op: '>', value: 20 },
    { label: 'Di atas 15%', hint: 'Baik',        op: '>', value: 15 },
    { label: 'Di atas 10%', op: '>', value: 10 },
    { label: 'Negatif',     hint: 'Rugi',        op: '<', value: 0 },
  ] },
  roa:        { label: 'ROA %',       fmt: 'pct',     where: STOCK, group: 'financial', desc: 'return on assets', preset: [
    { label: 'Di atas 10%', op: '>', value: 10 },
    { label: 'Di atas 5%',  op: '>', value: 5 },
  ] },
  profitMargin:   { label: 'Margin laba',  fmt: 'pct', where: STOCK, group: 'financial', desc: 'margin laba bersih', preset: [
    { label: 'Di atas 20%', op: '>', value: 20 },
    { label: 'Di atas 10%', op: '>', value: 10 },
    { label: 'Negatif',     op: '<', value: 0 },
  ] },
  operatingMargin:{ label: 'Margin operasi', fmt: 'pct', where: STOCK, group: 'financial', desc: 'margin laba operasi' },
  grossMargin:    { label: 'Margin kotor', fmt: 'pct', where: STOCK, group: 'financial', desc: 'margin laba kotor' },
  der:        { label: 'DER',         fmt: 'ratio',   where: STOCK, group: 'financial', desc: 'debt to equity, dalam persen', preset: [
    { label: 'Di bawah 50',  hint: 'Utang rendah', op: '<', value: 50 },
    { label: 'Di bawah 100', op: '<', value: 100 },
    { label: 'Di atas 200',  hint: 'Utang tinggi', op: '>', value: 200 },
  ] },
  currentRatio: { label: 'Current ratio', fmt: 'ratio', where: STOCK, group: 'financial', desc: 'aset lancar dibagi utang lancar', preset: [
    { label: 'Di atas 2', hint: 'Likuiditas kuat', op: '>', value: 2 },
    { label: 'Di bawah 1', hint: 'Perlu dicermati', op: '<', value: 1 },
  ] },
  quickRatio: { label: 'Quick ratio', fmt: 'ratio',   where: STOCK, group: 'financial', desc: 'rasio kas cepat' },
  revenue:    { label: 'Revenue',     fmt: 'compact', where: STOCK, group: 'financial', desc: 'pendapatan 12 bulan' },
  netIncome:  { label: 'Laba bersih', fmt: 'compact', where: STOCK, group: 'financial', desc: 'laba bersih 12 bulan' },
  ebitda:     { label: 'EBITDA',      fmt: 'compact', where: STOCK, group: 'financial', desc: 'EBITDA 12 bulan' },
  freeCashflow:{ label: 'FCF',        fmt: 'compact', where: STOCK, group: 'financial', desc: 'arus kas bebas' },
  totalCash:  { label: 'Kas',         fmt: 'compact', where: STOCK, group: 'financial', desc: 'total kas' },
  totalDebt:  { label: 'Utang',       fmt: 'compact', where: STOCK, group: 'financial', desc: 'total utang' },
  beta:       { label: 'Beta',        fmt: 'ratio',   where: STOCK, group: 'financial', desc: 'sensitivitas terhadap pasar', preset: [
    { label: 'Defensif di bawah 1', op: '<', value: 1 },
    { label: 'Agresif di atas 1,5', op: '>', value: 1.5 },
  ] },

  // --- Growth -----------------------------------------------------------
  revenueGrowth:  { label: 'Growth revenue', fmt: 'pct', where: STOCK, group: 'growth', desc: 'pertumbuhan pendapatan tahunan', preset: [
    { label: 'Di atas 30%', hint: 'Tumbuh cepat', op: '>', value: 30 },
    { label: 'Di atas 15%', op: '>', value: 15 },
    { label: 'Di atas 0%',  op: '>', value: 0 },
    { label: 'Menyusut',    op: '<', value: 0 },
  ] },
  earningsGrowth: { label: 'Growth laba',  fmt: 'pct', where: STOCK, group: 'growth', desc: 'pertumbuhan laba tahunan', preset: [
    { label: 'Di atas 30%', op: '>', value: 30 },
    { label: 'Di atas 15%', op: '>', value: 15 },
    { label: 'Menyusut',    op: '<', value: 0 },
  ] },

  // --- Dividend ---------------------------------------------------------
  dividendYield: { label: 'Div yield %', fmt: 'pct',  where: STOCK, group: 'dividend', desc: 'imbal hasil dividen tahunan', preset: [
    { label: 'Di atas 5%', hint: 'Yield tinggi', op: '>', value: 5 },
    { label: 'Di atas 3%', op: '>', value: 3 },
    { label: 'Di atas 1%', op: '>', value: 1 },
    { label: 'Tidak membagi dividen', op: '=', value: 0 },
  ] },
  payoutRatio:   { label: 'Payout %',   fmt: 'pct',   where: STOCK, group: 'dividend', desc: 'porsi laba yang dibagikan', preset: [
    { label: 'Sehat di bawah 60%', op: '<', value: 60 },
    { label: 'Agresif di atas 80%', op: '>', value: 80 },
  ] },
};

export const FIELDS = Object.keys(INDICATORS);

export const GROUPS = {
  market:    'Market data',
  technical: 'Technical',
  valuation: 'Valuation',
  financial: 'Financial',
  growth:    'Growth',
  dividend:  'Dividend',
};

// Field yang butuh panggilan quoteSummary. Dipakai server untuk memutuskan
// apakah perlu menarik data fundamental, yang jauh lebih lambat dari harga.
export const FUNDAMENTAL_FIELDS = new Set(
  FIELDS.filter(f => ['valuation', 'financial', 'growth', 'dividend'].includes(INDICATORS[f].group))
);

// Indikator yang tetap tidak tersedia, supaya LLM melaporkannya alih-alih mengarang.
export const UNSUPPORTED = {
  sector: 'sektor', industry: 'industri',
  earningsDate: 'tanggal earnings', float: 'float saham',
  shortInterest: 'short interest', insiderOwnership: 'kepemilikan insider',
  institutionalOwnership: 'kepemilikan institusi',
  employees: 'jumlah karyawan', ipoDate: 'tanggal IPO',
  optionVolume: 'volume opsi', esg: 'skor ESG',
};

export const BASE_COLUMNS = ['price', 'change24h'];

export const PRESETS = {
  overview:    { label: 'Overview',    columns: ['change7d', 'change30d', 'changeYtd', 'volume', 'marketCap', 'turnover'] },
  performance: { label: 'Performance', columns: ['change7d', 'change30d', 'change90d', 'change180d', 'changeYtd', 'change1y'] },
  technicals:  { label: 'Technicals',  columns: ['rsi', 'macdHist', 'sma50Dist', 'sma200Dist', 'bbPosition', 'atr', 'fromHigh', 'fromLow'] },
  valuation:   { label: 'Valuation',   columns: ['marketCap', 'pe', 'forwardPe', 'peg', 'pbv', 'eps', 'upside'] },
  financial:   { label: 'Financial',   columns: ['marketCap', 'roe', 'roa', 'profitMargin', 'der', 'currentRatio', 'revenue', 'netIncome'] },
  growth:      { label: 'Growth',      columns: ['revenueGrowth', 'earningsGrowth', 'change1y', 'marketCap'] },
  dividend:    { label: 'Dividend',    columns: ['dividendYield', 'payoutRatio', 'eps', 'pe', 'marketCap'] },
  volume:      { label: 'Volume',      columns: ['volume', 'avgVol10d', 'relVol', 'turnover', 'marketCap'] },
};

export const PRESET_SORT = {
  overview:    { field: 'turnover',       dir: 'desc' },
  performance: { field: 'change30d',      dir: 'desc' },
  technicals:  { field: 'rsi',            dir: 'asc'  },
  valuation:   { field: 'pe',             dir: 'asc'  },
  financial:   { field: 'roe',            dir: 'desc' },
  growth:      { field: 'revenueGrowth',  dir: 'desc' },
  dividend:    { field: 'dividendYield',  dir: 'desc' },
  volume:      { field: 'relVol',         dir: 'desc' },
};

// Apakah indikator punya data di gabungan pasar ini.
export const availableIn = (field, markets) => {
  const w = INDICATORS[field]?.where;
  return !w || markets.some(m => w.includes(m));
};

// Daftar pasar yang mendukung indikator, untuk pesan error yang berguna.
export const marketsFor = field => INDICATORS[field]?.where ?? ['IDX', 'US', 'CRYPTO'];

// Apakah kumpulan field ini butuh data fundamental.
export const needsFundamentals = fields => fields.some(f => FUNDAMENTAL_FIELDS.has(f));
