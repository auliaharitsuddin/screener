// Penerjemah prompt berbasis aturan, tanpa LLM. Dipakai saat tidak ada API key,
// atau sebagai cadangan saat LLM gagal.
//
// Prinsip akurasi: bagian prompt yang dikenali dieksekusi persis seperti kamus
// di bawah; bagian yang TIDAK dikenali dilaporkan ke user lewat `unparsed`,
// bukan ditebak atau diabaikan diam-diam. Jadi hasil tabel selalu bisa
// dipertanggungjawabkan terhadap teks yang diketik.
import { INDICATORS, FIELDS, marketsFor } from './indicators.js';

// --- Angka ---------------------------------------------------------------
const SCALE = {
  ribu: 1e3, rb: 1e3, k: 1e3,
  juta: 1e6, jt: 1e6, m: 1e6,
  miliar: 1e9, milyar: 1e9, b: 1e9,
  triliun: 1e12, t: 1e12,
};
// Angka opsional bertanda, diikuti satuan opsional. Satuan huruf tunggal wajib
// diakhiri batas kata supaya "15 dengan" tidak terbaca "15 d...".
const NUM = String.raw`(-?\d+(?:\.\d+)?)\s*(%|persen|ribu|rb|juta|jt|miliar|milyar|triliun|[kmbt](?![a-z])|x(?![a-z])|kali)?`;
const toNum = (n, unit) => {
  const v = parseFloat(n);
  const u = (unit || '').toLowerCase();
  return SCALE[u] ? v * SCALE[u] : v;
};

// --- Operator ------------------------------------------------------------
const LT = String.raw`(?:di bawah|kurang dari|lebih kecil dari|lebih rendah dari|maksimal|maksimum|maks\.?|max\.?|under|below|less than|lower than|tidak lebih dari|paling banyak|<=|<)`;
const GT = String.raw`(?:di atas|lebih dari|lebih besar dari|lebih tinggi dari|minimal|minimum|min\.?|over|above|more than|higher than|greater than|setidaknya|sekurang-kurangnya|paling sedikit|melebihi|>=|>)`;
const EQ = String.raw`(?:sama dengan|==|=|equal to|equals)`;
const SEP = String.raw`(?:dan|sampai|hingga|s\.d\.?|-|–|to|and)`;
const LEAD = String.raw`(?:adalah|yang|nya|-nya|:|sebesar|itu)?\s*`;

const RX_BETWEEN = new RegExp(String.raw`^\s*${LEAD}(?:antara|between)?\s*${NUM}\s*${SEP}\s*${NUM}`, 'i');
const RX_OPNUM   = new RegExp(String.raw`^\s*${LEAD}(${LT}|${GT}|${EQ})\s*${NUM}`, 'i');
const RX_NUMPOST = new RegExp(String.raw`^\s*${LEAD}${NUM}\s*(ke atas|keatas|atau lebih|\+|ke bawah|kebawah|atau kurang)`, 'i');
const RX_SIGN    = /^\s*(?:yang\s+)?(positif|negatif|positive|negative)\b/i;
const RX_HI      = /^\s*(?:yang\s+)?(tinggi|besar|bagus|kuat|sehat|high|good|strong)\b/i;
const RX_LO      = /^\s*(?:yang\s+)?(rendah|kecil|jelek|lemah|low|weak|minim)\b/i;
// Operator yang MENDAHULUI nama field: "di atas 3% dividen".
const RX_BEFORE  = new RegExp(String.raw`(${LT}|${GT})\s*${NUM}\s*$`, 'i');

const isLT = s => new RegExp(`^${LT}$`, 'i').test(s);
const isGT = s => new RegExp(`^${GT}$`, 'i').test(s);

// Preset ambang dari registry dipakai untuk kata kualitatif ("roe tinggi").
// Diambil yang di tengah supaya tidak ekstrem: roe tinggi -> >15, bukan >20.
function qualitative(field, dir) {
  const ps = (INDICATORS[field]?.preset ?? []).filter(p =>
    dir === 'HI' ? p.op === '>' : p.op === '<');
  if (!ps.length) return null;
  const sorted = ps.sort((a, b) => a.value - b.value);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

// Cari batasan numerik di awal `win`. Mengembalikan {filters, len} atau null.
function constraint(field, win) {
  let m;
  if ((m = RX_BETWEEN.exec(win))) {
    return { len: m[0].length, filters: [
      { field, op: '>=', value: toNum(m[1], m[2]) },
      { field, op: '<=', value: toNum(m[3], m[4]) },
    ] };
  }
  if ((m = RX_OPNUM.exec(win))) {
    const raw = m[1];
    const op = isLT(raw) ? (raw === '<=' ? '<=' : '<')
      : isGT(raw) ? (raw === '>=' ? '>=' : '>') : '=';
    return { len: m[0].length, filters: [{ field, op, value: toNum(m[2], m[3]) }] };
  }
  if ((m = RX_NUMPOST.exec(win))) {
    const op = /atas|lebih|\+/.test(m[3]) ? '>=' : '<=';
    return { len: m[0].length, filters: [{ field, op, value: toNum(m[1], m[2]) }] };
  }
  if ((m = RX_SIGN.exec(win))) {
    return { len: m[0].length, filters: [{ field, op: /pos/.test(m[1]) ? '>' : '<', value: 0 }] };
  }
  if ((m = RX_HI.exec(win)) || (m = RX_LO.exec(win))) {
    const p = qualitative(field, RX_HI.test(win) ? 'HI' : 'LO');
    if (p) return { len: m[0].length, filters: [{ field, op: p.op, value: p.value }] };
    // Tanpa preset, "tinggi/rendah" lebih jujur diartikan sebagai urutan.
    return { len: m[0].length, filters: [], sort: { field, dir: RX_HI.test(win) ? 'desc' : 'asc' } };
  }
  return null;
}

// --- Kamus field -----------------------------------------------------------
// Urutan penting: frasa spesifik sebelum yang umum (forward pe sebelum pe).
const FIELD_LEX = [
  [/\brsi\s?7\b/, 'rsi7'],
  [/\brsi(?:\s?14)?\b/, 'rsi'],
  [/\b(?:stochastic|stoch)\b/, 'stochK'],
  [/\bwilliams?(?:\s?%?r)?\b/, 'williamsR'],
  [/\bcci\b/, 'cci'],
  [/\bmacd\b/, 'macdHist'],
  [/\b(?:lebar bollinger|bb width|bollinger width)\b/, 'bbWidth'],
  [/\b(?:bollinger|bb)\b/, 'bbPosition'],
  [/\batr\b/, 'atr'],
  [/\b(?:volatilitas|volatility)\b/, 'volatility'],
  [/\b(?:dari puncak|jarak (?:ke |dari )?puncak|52 ?week high|52w high|ath|all[- ]time high)\b/, 'fromHigh'],
  [/\b(?:dari dasar|jarak (?:ke |dari )?dasar|52 ?week low|52w low|atl|all[- ]time low)\b/, 'fromLow'],
  [/\b(?:forward pe|pe forward|forward p\/e|per forward|forward per)\b/, 'forwardPe'],
  [/\b(?:p\/e ratio|p\/e|pe ratio|price[- ]to[- ]earnings?|price earnings?|rasio harga laba)\b/, 'pe'],
  // "per" juga preposisi ("per hari"); hanya diterima kalau bukan diikuti satuan waktu.
  [/\b(?:per|pe)\b(?!\s*(?:hari|minggu|bulan|tahun|saham|lembar|lot|unit))/, 'pe'],
  [/\bpeg\b/, 'peg'],
  [/\b(?:pbv|p\/b|price[- ]to[- ]book|price book|rasio harga buku)\b/, 'pbv'],
  [/\b(?:p\/s|price[- ]to[- ]sales|ps ratio)\b/, 'ps'],
  [/\b(?:eps forward|forward eps)\b/, 'epsForward'],
  [/\b(?:pertumbuhan (?:laba|eps|earnings?)|earnings? growth|eps growth|growth laba|laba tumbuh)\b/, 'earningsGrowth'],
  [/\beps\b/, 'eps'],
  [/\b(?:nilai buku|book value)\b/, 'bookValue'],
  [/\b(?:target harga|target price|price target|target analis)\b/, 'targetPrice'],
  [/\bupside\b/, 'upside'],
  [/\b(?:rating analis|rekomendasi analis|analyst rating|consensus)\b/, 'recommendation'],
  [/\b(?:roe|return on equity)\b/, 'roe'],
  [/\b(?:roa|return on assets?)\b/, 'roa'],
  [/\b(?:margin laba bersih|net margin|profit margin|margin laba|margin bersih|net profit margin|npm)\b/, 'profitMargin'],
  [/\b(?:margin operasi|operating margin|opm)\b/, 'operatingMargin'],
  [/\b(?:margin kotor|gross margin|gpm)\b/, 'grossMargin'],
  [/\b(?:der|debt[- ]to[- ]equity|d\/e|rasio utang|utang)\b/, 'der'],
  [/\b(?:current ratio|rasio lancar)\b/, 'currentRatio'],
  [/\bquick ratio\b/, 'quickRatio'],
  [/\b(?:pertumbuhan (?:revenue|pendapatan|penjualan|omzet)|revenue growth|sales growth|growth revenue|pendapatan tumbuh)\b/, 'revenueGrowth'],
  [/\b(?:revenue|pendapatan|omzet|penjualan)\b/, 'revenue'],
  [/\b(?:laba bersih|net income|net profit)\b/, 'netIncome'],
  [/\bebitda\b/, 'ebitda'],
  [/\b(?:fcf|free cash ?flow|arus kas bebas)\b/, 'freeCashflow'],
  [/\b(?:total kas|kas|cash)\b/, 'totalCash'],
  [/\bbeta\b/, 'beta'],
  [/\b(?:dividend yield|div yield|yield dividen|dividen|dividend|yield)\b/, 'dividendYield'],
  [/\b(?:payout ratio|payout|rasio pembayaran)\b/, 'payoutRatio'],
  [/\b(?:market ?cap|mkt ?cap|kapitalisasi(?: pasar)?|kap pasar)\b/, 'marketCap'],
  [/\b(?:rel(?:ative)? ?vol(?:ume)?|volume relatif|relvol)\b/, 'relVol'],
  [/\b(?:avg vol(?:ume)?|rata-rata volume|volume rata-rata|average volume)\b/, 'avgVol10d'],
  [/\b(?:nilai transaksi|turnover|nilai txn)\b/, 'turnover'],
  [/\bvolume\b/, 'volume'],
  [/\bgap\b/, 'gap'],
  [/\b(?:range harian|day range|rentang harian)\b/, 'dayRange'],
  [/\bmomentum\b(?=\s*(?:di atas|di bawah|>|<|lebih|kurang|antara|\d|positif|negatif))/, 'momentum'],
  [/\b(?:harga|price)\b/, 'price'],
];

// --- Timeframe -----------------------------------------------------------
const TF_LEX = [
  [/\b(?:3 ?bulan|90 ?hari|3 ?months?|kuartal|triwulan|quarter)\b/, 'change90d'],
  [/\b(?:6 ?bulan|180 ?hari|6 ?months?|setengah tahun|semester)\b/, 'change180d'],
  [/\b(?:ytd|year[- ]to[- ]date|sejak awal tahun|awal tahun|tahun berjalan|tahun ini)\b/, 'changeYtd'],
  [/\b(?:1 ?tahun|setahun|12 ?bulan|1 ?year|52 ?minggu|yoy|tahun terakhir|tahunan|setahun terakhir)\b/, 'change1y'],
  [/\b(?:1 ?bulan|sebulan|30 ?hari|1 ?month|bulanan|bulan ini|bulan terakhir|4 ?minggu|sebulan terakhir)\b/, 'change30d'],
  [/\b(?:1 ?minggu|seminggu|7 ?hari|1 ?week|mingguan|minggu ini|minggu terakhir|sepekan|pekan ini|weekly)\b/, 'change7d'],
  [/\b(?:hari ini|24 ?jam|harian|daily|today|sehari|kemarin)\b/, 'change24h'],
];
const findTf = s => { for (const [rx, f] of TF_LEX) { const m = rx.exec(s); if (m) return { m, field: f }; } return null; };

// --- Arah ("naik", "anjlok") -----------------------------------------------
const RX_UP   = /\b(?:naik|menguat|rally|melonjak|terbang|hijau|rebound|gain|up|cuan|untung)\b/;
const RX_DOWN = /\b(?:turun|anjlok|melemah|koreksi|jatuh|drop|merah|tumbang|longsor|ambles|boncos|rugi|down)\b/;

// --- Idiom: frasa lengkap yang langsung jadi filter ----------------------------
const F = (field, op, value) => ({ field, op, value });
const IDIOMS = [
  [/\b(?:oversold|jenuh jual|over ?sold)\b/, [F('rsi', '<', 30)]],
  [/\b(?:overbought|jenuh beli|over ?bought)\b/, [F('rsi', '>', 70)]],
  [/\b(?:undervalued|murah|cheap)\b/, [F('pe', '<', 15)]],
  [/\b(?:overvalued|mahal|expensive)\b/, [F('pe', '>', 50)]],
  [/\b(?:(?:turun |jatuh |anjlok )?jauh (?:dari|di bawah) puncak(?:nya)?|diskon|discount)\b/, [F('fromHigh', '<', -30)]],
  [/\b(?:dekat puncak(?:nya)?|mendekati puncak(?:nya)?|di sekitar puncak(?:nya)?|near high)\b/, [F('fromHigh', '>', -5)]],
  [/\b(?:dekat dasar|mendekati dasar|di sekitar dasar|near low)\b/, [F('fromLow', '<', 10)]],
  [/\b(?:volume tidak biasa|unusual volume|volume abnormal|volume tinggi|volume besar|volume melonjak|volume spike|ramai)\b/, [F('relVol', '>', 2)]],
  [/\b(?:volume sepi|volume rendah|sepi)\b/, [F('relVol', '<', 0.5)]],
  [/\b(?:stabil|tidak volatil|low volatility|tenang|kalem)\b/, [F('volatility', '<', 30)]],
  [/\b(?:volatil|liar|high volatility|bergejolak|fluktuatif)\b/, [F('volatility', '>', 60)]],
  [/\b(?:profitable|menguntungkan|laba positif|profit)\b/, [F('profitMargin', '>', 0)]],
  [/\b(?:merugi|loss making|tidak profitable|laba negatif)\b/, [F('profitMargin', '<', 0)]],
  [/\b(?:dividen (?:tinggi|besar|bagus|jumbo)|high dividend|yield (?:tinggi|bagus|besar)|dividend (?:tinggi|bagus)|rajin dividen|pembagi dividen)\b/, [F('dividendYield', '>', 3)]],
  [/\b(?:bluechip|blue chip|perusahaan besar|big cap|large cap|kapitalisasi besar|mega cap|saham besar)\b/, [F('marketCap', '>', 10e9)]],
  [/\b(?:small cap|kapitalisasi kecil|saham kecil|perusahaan kecil|gorengan)\b/, [F('marketCap', '<', 2e9)]],
  [/\bmid cap\b/, [F('marketCap', '>=', 2e9), F('marketCap', '<=', 10e9)]],
  [/\b(?:tumbuh cepat|high growth|growth tinggi|pertumbuhan tinggi|bertumbuh|growth stock|saham growth)\b/, [F('revenueGrowth', '>', 20)]],
  [/\b(?:utang rendah|low debt|minim utang|sedikit utang|bebas utang|tanpa utang|sehat)\b/, [F('der', '<', 50)]],
  [/\b(?:utang tinggi|high debt|banyak utang|utang besar|leverage tinggi)\b/, [F('der', '>', 200)]],
  [/\b(?:macd bullish|golden cross|macd positif|macd cross(?:ing)? up|bullish crossover)\b/, [F('macdHist', '>', 0)]],
  [/\b(?:macd bearish|death cross|macd negatif|macd cross(?:ing)? down|bearish crossover)\b/, [F('macdHist', '<', 0)]],
  [/\b(?:(?:menembus|tembus|breakout|break out|breaking) (?:bollinger |bb |band |pita )?(?:atas|upper)|(?:bollinger|bb) (?:atas|upper))\b/, [F('bbPosition', '>', 100)]],
  [/\b(?:(?:menembus|tembus|breakdown|break down|jebol) (?:bollinger |bb |band |pita )?(?:bawah|lower)|(?:bollinger|bb) (?:bawah|lower))\b/, [F('bbPosition', '<', 0)]],
  [/\b(?:gap up|gap naik)\b/, [F('gap', '>', 2)]],
  [/\b(?:gap down|gap turun)\b/, [F('gap', '<', -2)]],
  [/\b(?:strong buy|rekomendasi (?:bagus|beli|buy)|analis (?:suka|rekomendasikan)|buy rating|rating beli)\b/, [F('recommendation', '<', 2)]],
  [/\b(?:upside besar|upside tinggi|potensi naik besar|high upside)\b/, [F('upside', '>', 20)]],
  [/\b(?:defensif|defensive|beta rendah|low beta)\b/, [F('beta', '<', 1)]],
  [/\b(?:agresif|aggressive|beta tinggi|high beta)\b/, [F('beta', '>', 1.5)]],
];
// Negasi di depan idiom membalik operatornya: "belum overbought" -> rsi <= 70.
const RX_NEG = /\b(?:belum|tidak|bukan|nggak|gak|ga|non|not|no|jangan)\s*$/;
const INVERT = { '>': '<=', '<': '>=', '>=': '<', '<=': '>' };

// Idiom momentum bergantung timeframe, jadi ditangani terpisah dari tabel di atas.
const RX_MOMENTUM = /\b(?:momentum kuat|momentum bagus|momentum positif|momentum|lagi naik|sedang naik|uptrend|trending up|(?<!macd )bullish)\b/;

// --- MA: "di atas MA50 dan MA200" dijalankan pada teks utuh sebelum dipecah ---
const MA_FIELD = { 20: 'sma20Dist', 50: 'sma50Dist', 200: 'sma200Dist' };
const RX_MA = /\b(di atas|above|di bawah|below|menembus|tembus|cross(?:ing)? (?:above|below))\s+((?:(?:sma|ema|ma|moving average|rata-rata)\s?\d+(?:\s?hari)?)(?:\s*(?:dan|&|,|and|serta)\s*(?:(?:sma|ema|ma)\s?)?\d+(?:\s?hari)?)*)\b/g;

// --- Pasar ---------------------------------------------------------------
const MARKET_LEX = [
  [/\b(?:indonesia|ihsg|bei|idx|bursa efek|saham ri|lokal)\b/, 'IDX'],
  [/\b(?:amerika|as|us|usa|nasdaq|nyse|wall street|s&p|amrik)\b/, 'US'],
  [/\b(?:kripto|crypto|coin|koin|altcoin|bitcoin|btc|eth|ethereum|token)\b/, 'CRYPTO'],
];

// --- Tidak tersedia --------------------------------------------------------
const UNSUP_LEX = [
  [/\b(?:sektor|sector|industri|industry|perbankan|bank|teknologi|tech|energi|energy|properti|property|tambang|mining|batubara|farmasi|telko|telekomunikasi|consumer|ritel|retail|otomotif|migas|sawit|cpo|semen|rokok|konstruksi|infrastruktur|kesehatan|healthcare|keuangan|finance|fintech|ai)\b/, 'sektor/industri'],
  [/\b(?:tanggal earnings|earnings date|jadwal (?:lapkeu|laporan)|rilis laporan|earnings (?:minggu|bulan) (?:ini|depan))\b/, 'tanggal earnings'],
  [/\b(?:short interest|short float|shorted)\b/, 'short interest'],
  [/\bfloat\b/, 'float saham'],
  [/\b(?:insider|orang dalam)\b/, 'kepemilikan insider'],
  [/\b(?:institusi|institutional)\b/, 'kepemilikan institusi'],
  [/\b(?:karyawan|employees?)\b/, 'jumlah karyawan'],
  [/\bipo\b/, 'tanggal IPO'],
  [/\besg\b/, 'skor ESG'],
  [/\b(?:opsi|options?)\b/, 'volume opsi'],
  [/\b(?:(?!24)\d+ ?(?:menit|minute|min)|(?!24 )\d+ ?(?:jam|hours?)|intraday|scalping)\b/, 'timeframe intraday'],
];

// Kata yang boleh tersisa tanpa dianggap "tidak dipahami".
const STOP = new Set(('saham kripto koin coin crypto yang yg dengan dan atau serta cari carikan tampilkan ' +
  'tunjukkan tolong mohon list daftar screener screening filter saring mana apa saja ada di ke dari ' +
  'untuk pada itu ini nya punya memiliki sedang lagi masih tapi tetapi namun tetap juga dong ya ' +
  'please show me find get stocks stock all semua indonesia amerika us as idx ihsg bei nasdaq nyse ' +
  'bitcoin altcoin market pasar bursa emiten perusahaan company companies terakhir sekarang saat ' +
  'hari top terbaik bagus potensial menarik layak beli dibeli koleksi akumulasi watchlist yuk coba ' +
  'nih deh sih aja saja buat bikin kasih lihat liat cek check the a an of in on with for that which ' +
  'are is be to by ok oke ga gak nggak belum bukan tidak non not no jangan kali x usd idr rupiah ' +
  'dolar dollar persen % lokal amrik ri').split(/\s+/));

// --- Util ----------------------------------------------------------------
function normalize(s) {
  return ' ' + s.toLowerCase()
    .replace(/[“”"'’`]/g, '')
    .replace(/\bdibawah\b/g, 'di bawah').replace(/\bdiatas\b/g, 'di atas')
    .replace(/\bdgn\b/g, 'dengan').replace(/\byg\b/g, 'yang')
    .replace(/(\d)\.(\d{3})(?!\d)/g, '$1$2')   // 10.000 -> 10000 (ribuan gaya Indonesia)
    .replace(/(\d)\.(\d{3})(?!\d)/g, '$1$2')   // 10.000.000
    .replace(/(\d),(\d)/g, '$1.$2')            // 2,5 -> 2.5 (desimal gaya Indonesia)
    .replace(/,/g, ' , ')                        // koma sisa = pemisah klausa
    .replace(/[?!;]+|\.(?!\d)|(?<!\d)\./g, ' ')     // buang tanda baca, tapi jaga titik desimal 2.5
    .replace(/\s+/g, ' ') + ' ';
}
// Ganti bagian yang sudah diproses dengan spasi supaya tidak dihitung dua kali,
// dan supaya sisa teks yang belum dipahami bisa dilaporkan.
const blank = (s, start, len) => s.slice(0, start) + ' '.repeat(len) + s.slice(start + len);

const SPLIT = /\s(?:dan|serta|tapi|tetapi|namun|dengan|yang|,|;|&|\+|plus|sekaligus|juga)\s/;

// --- Parser utama ----------------------------------------------------------
export function parseRules(prompt) {
  let text = normalize(prompt)
    // "antara 40 dan 60" jangan terpotong di "dan" oleh pemecah klausa.
    .replace(new RegExp(String.raw`(antara|between)(\s*${NUM}\s*)dan(\s*${NUM})`, 'g'), '$1$2sampai$5');
  const filters = [];
  const columns = [];
  const unsupported = new Set();
  let sort = null;
  let limit = null;
  let marketsAsked = [];

  const add = (...fs) => { for (const f of fs) { filters.push(f); columns.push(f.field); } };

  // 1. Pasar (global, dikonsumsi).
  for (const [rx, id] of MARKET_LEX) {
    let m;
    while ((m = rx.exec(text))) {
      if (!marketsAsked.includes(id)) marketsAsked.push(id);
      text = blank(text, m.index, m[0].length);
    }
  }

  // 2. Limit: "top 10", "10 saham".
  let m;
  if ((m = /\b(?:top|teratas)\s*(\d{1,3})\b/.exec(text))
    || (m = /\b(\d{1,3})\s*(?:saham|koin|kripto|emiten|instrumen|teratas|terbesar|terbaik|besar|perusahaan|ticker|aset|coin)\b/.exec(text))) {
    limit = +m[1];
    text = blank(text, m.index, m[0].length);
  }

  // 3. MA lintas klausa: "di atas MA50 dan MA200".
  RX_MA.lastIndex = 0;
  while ((m = RX_MA.exec(text))) {
    const op = /bawah|below/.test(m[1]) ? '<' : '>';
    for (const seg of m[2].split(/\s*(?:dan|&|,|and|serta)\s*/)) {
      const n = +(seg.match(/\d+/)?.[0]);
      const field = /ema/.test(seg) ? (n === 20 ? 'ema20Dist' : null) : MA_FIELD[n];
      if (field) add(F(field, op, 0)); else unsupported.add(`MA ${n}`);
    }
    text = blank(text, m.index, m[0].length);
    RX_MA.lastIndex = 0;
  }

  // 4. Urutan eksplisit: "urutkan dari rsi terendah", "roe tertinggi", "paling volatil".
  const DIRW = /\b(terendah|terkecil|ascending|asc|menaik|terbesar|tertinggi|descending|desc|menurun)\b/;
  const dirOf = w => /rendah|kecil|asc|menaik/.test(w) ? 'asc' : 'desc';
  if ((m = /\b(?:(?:urut(?:kan)?|sort(?:ir)?|susun|rank(?:ing)?|order)(?:\s+(?:by|dari|berdasarkan|menurut))?|berdasarkan|menurut|sorted by)\s+/.exec(text))) {
    const rest = text.slice(m.index + m[0].length);
    const end = rest.search(SPLIT); const seg = end === -1 ? rest : rest.slice(0, end);
    const fm = FIELD_LEX.map(([rx, f]) => [rx.exec(seg), f]).find(([x]) => x);
    const dm = DIRW.exec(seg);
    if (fm) {
      sort = { field: fm[1], dir: dm ? dirOf(dm[1]) : 'desc' };
      text = blank(text, m.index, m[0].length + seg.length);
    }
  }
  if (!sort && (m = /\bpaling\s+(\w+)(?:\s+(\w+))?/.exec(text))) {
    const adj = m[1], next = m[2] || '';
    const tf = findTf(text)?.field ?? 'change24h';
    const table = {
      volatil: ['volatility', 'desc'], liar: ['volatility', 'desc'], bergejolak: ['volatility', 'desc'],
      stabil: ['volatility', 'asc'], tenang: ['volatility', 'asc'],
      murah: ['pe', 'asc'], mahal: ['pe', 'desc'],
      besar: ['marketCap', 'desc'], gede: ['marketCap', 'desc'], jumbo: ['marketCap', 'desc'], kecil: ['marketCap', 'asc'],
      ramai: ['turnover', 'desc'], aktif: ['turnover', 'desc'], likuid: ['turnover', 'desc'],
      untung: [tf, 'desc'], naik: [tf, 'desc'], menguat: [tf, 'desc'], cuan: [tf, 'desc'], hijau: [tf, 'desc'],
      rugi: [tf, 'asc'], turun: [tf, 'asc'], anjlok: [tf, 'asc'], merah: [tf, 'asc'], boncos: [tf, 'asc'],
      oversold: ['rsi', 'asc'], overbought: ['rsi', 'desc'],
      menguntungkan: ['profitMargin', 'desc'], profitable: ['profitMargin', 'desc'],
    };
    // "paling tinggi roe-nya" / "roe paling tinggi": field diambil dari sekitar.
    const around = text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30);
    const fm = FIELD_LEX.map(([rx, f]) => [rx.exec(around), f]).find(([x]) => x);
    if (/^(tinggi|besar|rendah|kecil|bagus|banyak|sedikit)$/.test(adj) && fm) {
      sort = { field: fm[1], dir: /tinggi|besar|bagus|banyak/.test(adj) ? 'desc' : 'asc' };
      const fi = FIELD_LEX.find(([, f]) => f === fm[1])[0].exec(text);
      if (fi) text = blank(text, fi.index, fi[0].length);
      text = blank(text, m.index, m[0].length);
    } else if (table[adj]) {
      sort = { field: table[adj][0], dir: table[adj][1] };
      text = blank(text, m.index, m[0].length - next.length - (next ? 1 : 0));
    }
  }
  if (!sort && (m = /\b(?:top|terbesar|tertinggi)\s+(?:market ?cap|mkt ?cap|kapitalisasi(?: pasar)?)|(?:market ?cap|mkt ?cap|kapitalisasi(?: pasar)?)\s+(?:terbesar|tertinggi)\b/.exec(text))) {
    sort = { field: 'marketCap', dir: 'desc' };
    text = blank(text, m.index, m[0].length);
  }

  // 5. Per klausa: field+angka, arah, idiom, "field tertinggi", tidak tersedia.
  const rawClauses = text.split(SPLIT);
  const unparsed = [];
  for (let clause of rawClauses) {
    const before = clause;
    let hit = false;

    // 5a. Field diikuti (atau didahului) batasan numerik/kualitatif.
    for (const [rx, field] of FIELD_LEX) {
      let fm;
      const r = new RegExp(rx.source, 'g');
      while ((fm = r.exec(clause))) {
        const after = clause.slice(fm.index + fm[0].length);
        const c = constraint(field, after);
        if (c) {
          if (c.filters.length) add(...c.filters);
          if (c.sort && !sort) sort = c.sort;
          clause = blank(clause, fm.index, fm[0].length + c.len);
          hit = true; r.lastIndex = 0; continue;
        }
        const bm = RX_BEFORE.exec(clause.slice(0, fm.index));
        if (bm) {
          const op = isLT(bm[1]) ? '<' : '>';
          add(F(field, op, toNum(bm[2], bm[3])));
          clause = blank(clause, bm.index, bm[0].length + fm[0].length);
          hit = true; r.lastIndex = 0; continue;
        }
        // "roe tertinggi" / "dividen terbesar" -> urutan.
        const dm = DIRW.exec(after.slice(0, 20));
        if (dm && after.slice(0, dm.index).trim() === '') {
          if (!sort) sort = { field, dir: dirOf(dm[1]) };
          clause = blank(clause, fm.index, fm[0].length + dm.index + dm[0].length);
          hit = true; r.lastIndex = 0; continue;
        }
      }
    }

    // 5d. Idiom, dengan negasi.
    for (const [rx, fs] of IDIOMS) {
      const im = rx.exec(clause);
      if (!im) continue;
      const neg = RX_NEG.test(clause.slice(0, im.index));
      add(...fs.map(f => neg ? { ...f, op: INVERT[f.op] ?? f.op } : f));
      clause = blank(clause, im.index, im[0].length);
      if (neg) { const nm = RX_NEG.exec(clause.slice(0, im.index)); if (nm) clause = blank(clause, nm.index, nm[0].length); }
      hit = true;
    }

    // 5c. Momentum, sadar timeframe.
    if ((m = RX_MOMENTUM.exec(clause))) {
      const t = findTf(clause);
      add(F(t?.field ?? 'change30d', '>', 10));
      clause = blank(clause, m.index, m[0].length);
      if (t) clause = blank(clause, t.m.index, t.m[0].length);
      hit = true;
    }

    // 5b. Arah + timeframe: "naik 20% minggu ini", "anjlok lebih dari 20% sebulan".
    const tf = findTf(clause);
    const up = RX_UP.exec(clause), down = RX_DOWN.exec(clause);
    const dirm = up && down ? (up.index < down.index ? up : down) : (up || down);
    // "untung/rugi" tanpa timeframe lebih cocok diartikan laba, ditangani idiom.
    if (dirm && !( /untung|rugi|cuan|boncos/.test(dirm[0]) && !tf)) {
      const field = tf?.field ?? 'change24h';
      const isUp = dirm === up;
      const tail = clause.slice(dirm.index + dirm[0].length);
      let c = constraint(field, tail);
      // Angka tanpa operator setelah kata arah tetap ambang: "naik 20%" = naik >= 20.
      const bare = !c && new RegExp(String.raw`^s*${LEAD}${NUM}`).exec(tail);
      if (bare) c = { len: bare[0].length, filters: [{ field, op: '>=', value: toNum(bare[1], bare[2]) }] };
      if (c && c.filters.length === 1 && c.filters[0].op !== '=') {
        const v = Math.abs(c.filters[0].value);
        const op = c.filters[0].op;
        // "turun lebih dari 20%" = change < -20; "naik kurang dari 5%" = 0 < change < 5.
        // Tanda "=" pada operator (>=, <=) dipertahankan: "naik 20%" berarti >= 20.
        const strong = /^>/.test(op);
        const eq = op.endsWith('=') ? '=' : '';
        if (isUp) add(F(field, (strong ? '>' : '<') + eq, v), ...(strong ? [] : [F(field, '>', 0)]));
        else add(F(field, (strong ? '<' : '>') + eq, -v), ...(strong ? [] : [F(field, '<', 0)]));
        clause = blank(clause, dirm.index, dirm[0].length + c.len);
      } else if (c && c.filters.length === 2) {
        add(...c.filters.map(f => ({ ...f, value: isUp ? f.value : -f.value })));
        clause = blank(clause, dirm.index, dirm[0].length + c.len);
      } else {
        add(F(field, isUp ? '>' : '<', 0));
        clause = blank(clause, dirm.index, dirm[0].length);
      }
      if (tf) { const t = findTf(clause); if (t) clause = blank(clause, t.m.index, t.m[0].length); }
      hit = true;
    }

    // 5e. Field yang cuma disebut (tanpa angka) tetap ditampilkan sebagai kolom.
    for (const [rx, field] of FIELD_LEX) {
      const fm = rx.exec(clause);
      if (fm) { columns.push(field); clause = blank(clause, fm.index, fm[0].length); hit = true; }
    }

    // 5f. Timeframe sisa hanya kualifikasi ("... 30 hari"), bukan kriteria.
    const t = findTf(clause);
    if (t) { clause = blank(clause, t.m.index, t.m[0].length); hit = true; }

    // 5g. Permintaan yang memang tidak tersedia.
    for (const [rx, label] of UNSUP_LEX) {
      const um = rx.exec(clause);
      if (um) { unsupported.add(label); clause = blank(clause, um.index, um[0].length); hit = true; }
    }

    // 5h. Sisa bermakna = tidak dipahami. Dilaporkan, bukan dibuang diam-diam.
    const leftover = clause.split(/\s+/).filter(w => w && !STOP.has(w));
    const hasDigit = leftover.some(w => /\d/.test(w));
    // Angka yang tersisa hampir pasti kriteria yang gagal dipahami. Kata biasa
    // dilaporkan kalau klausa itu tidak menghasilkan apa-apa, atau sisanya panjang.
    if (hasDigit || (leftover.length && !hit) || leftover.length >= 2) {
      const orig = before.trim();
      if (orig) unparsed.push(orig);
    }
  }

  // Dedup: field+op yang sama, yang terakhir (biasanya lebih spesifik) menang.
  const seen = new Map();
  for (const f of filters) seen.set(`${f.field}|${f.op}`, f);
  const finalFilters = [...seen.values()].slice(0, 12);

  // Pasar: kalau user tidak menyebut, sempitkan ke pasar yang punya semua field
  // yang dipakai, supaya filter saham tidak diam-diam menghapus semua kripto.
  let markets = marketsAsked.length ? marketsAsked : ['IDX', 'US', 'CRYPTO'];
  if (!marketsAsked.length) {
    const used = [...finalFilters.map(f => f.field), ...(sort ? [sort.field] : [])];
    const narrowed = markets.filter(mk => used.every(f => marketsFor(f).includes(mk)));
    if (narrowed.length) markets = narrowed;
  }

  const finalSort = sort ?? { field: 'turnover', dir: 'desc' };
  const cols = [...new Set([...finalFilters.map(f => f.field), finalSort.field, ...columns])]
    .filter(f => FIELDS.includes(f)).slice(0, 8);

  return {
    engine: 'rules',
    markets,
    filters: finalFilters,
    sort: finalSort,
    columns: cols,
    unsupported: [...unsupported],
    unparsed,
    limit: Math.min(100, Math.max(1, limit || 25)),
    explain: explain(markets, finalFilters, finalSort, marketsAsked.length > 0),
  };
}

const OPW = { '>': '>', '>=': '≥', '<': '<', '<=': '≤', '=': '=', '!=': '≠' };
function fmtV(field, v) {
  const fmt = INDICATORS[field]?.fmt;
  if (fmt === 'compact' && Math.abs(v) >= 1e6) {
    const u = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M']].find(([s]) => Math.abs(v) >= s);
    return `${+(v / u[0]).toFixed(1)}${u[1]}`;
  }
  return fmt === 'pct' ? `${v}%` : String(v);
}
function explain(markets, filters, sort, asked) {
  const mk = asked ? markets.join('/') : 'semua pasar';
  const fs = filters.map(f => `${INDICATORS[f.field].label} ${OPW[f.op]} ${fmtV(f.field, f.value)}`);
  const s = `urut ${INDICATORS[sort.field].label} ${sort.dir === 'asc' ? 'menaik' : 'menurun'}`;
  return `${mk}${fs.length ? ': ' + fs.join(', ') : ''}; ${s}.`.slice(0, 200);
}
