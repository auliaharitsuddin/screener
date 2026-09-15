# Screener

A natural-language stock and crypto screener. Type your criteria as a plain sentence, an LLM (or a local rule-based parser) turns it into a structured filter, and the filter runs against public market data.

## Run it

```bash
npm start          # http://localhost:4900
node test.js       # self-check for filter logic, sort, RSI
```

No dependencies. Needs Node 20+ (uses built-in `fetch` and `--env-file`).
`GEMINI_API_KEY` is optional; without it, prompts are translated by the local rule-based parser (see below).

## Example prompts

- `saham indonesia PER di bawah 15 dengan ROE di atas 15` (Indonesian stocks, P/E under 15, ROE above 15)
- `saham amerika dividen di atas 3% dan utang rendah` (US stocks, dividend above 3%, low debt)
- `saham yang MACD bullish dan di atas MA200` (stocks with bullish MACD, above MA200)
- `saham indonesia paling volatil setahun terakhir` (most volatile Indonesian stocks over the last year)
- `kripto top market cap yang naik minggu ini` (top market cap crypto that's up this week)

Prompts can be written in Indonesian or English; the parser and the LLM both understand either.

## Working without an API key

Natural-language prompts still work with no LLM. If `GEMINI_API_KEY` is empty, or Gemini can't be reached (quota exhausted, network down, model removed), prompts fall back to the local rule-based translator in `parser.js`: a synonym dictionary for all 66 indicators, Indonesian-style number and operator patterns (`di bawah 15`, `2,5 triliun`, `antara 40 dan 60`, `200B`), idioms (`oversold`, `golden cross`, `bluechip`, `utang rendah`), direction with a timeframe (`anjlok lebih dari 20% sebulan terakhir`), negation (`belum overbought`), and ordering (`paling volatil`, `urutkan dari rsi terendah`, `10 saham dividen tertinggi`).

What keeps results honest isn't the translator's cleverness, it's that **any part of the prompt it doesn't recognize gets reported on screen, not guessed or silently dropped.** `saham bank yang oversold dan bagus buat jangka panjang` runs `RSI < 30`, then tells you "bank" (a sector) isn't available yet and "bagus buat jangka panjang" wasn't understood. The table you see is exactly the result of the criteria that were actually recognized, and you know which parts didn't make it into the filter.

The real limit: the local translator only knows the vocabulary in its dictionary. A new phrase that isn't there ("saham seperti NVDA tahun lalu") gets reported as not understood, where an LLM might be able to interpret it. With a key configured, the LLM runs first and the local rules become a fallback; check "Translate without LLM" under the prompt box to force local mode. The status indicator next to the tab names which engine actually ran.

Regression coverage lives in `node test.js`: 21 prompts with expected filters, plus cases that must be reported as unavailable or not understood.

## Data sources

| Market | Source | Coverage |
|--------|--------|----------|
| IDX | Yahoo Finance chart v8 | 40 liquid stocks |
| US | Yahoo Finance chart v8 | 40 liquid stocks |
| CRYPTO | CoinGecko markets | top 250 by market cap |

5-minute cache per market. The stock universe lives in `universe.js`, just add symbols there.

## Default view

The page shows a table the moment it loads, no prompt required. Layout mirrors a TradingView-style screener:

- **Market row** (US Stocks / ID Stocks / Crypto). More than one can be selected, at least one stays active.
- **Preset tabs**: Overview, Performance, Technicals, Volume. Each tab has its own column set and default sort (Technicals sorts by RSI ascending, Volume by relative volume descending).
- **Table headers are clickable** to sort; click again to reverse direction.
- **Symbol column stays pinned** when scrolling the table sideways.

This view is served by `GET /api/browse`, which never calls the LLM, so it's fast and keeps working even if the Gemini quota runs out. View state is saved in the URL (`?markets=US&preset=technicals&sort=rsi&dir=asc`), so a screen can be shared as a link and survives a page refresh.

Typing a prompt temporarily takes over the table's columns; the preset tab stops being highlighted since the prompt decides the columns now, not the tab. Touching the toolbar or clicking a header returns to browse mode.

Columns with no data for the selected markets are filtered out automatically. The Technicals preset on crypto, for example, only keeps columns that actually have values, and the default sort falls back to turnover since RSI isn't available there.

## Indicators

66 indicators across 6 categories. The registry in `indicators.js` is the single source of truth: the LLM prompt, validation, filter menu, table headers, and "not available" messages are all generated from it.

| Category | Contents |
|---|---|
| Market data | price, change %, performance 1W/1M/3M/6M/YTD/1Y, gap, daily range, volume, 10D average volume, relative volume, turnover, market cap |
| Technical | RSI 14 & 7, Stochastic %K, Williams %R, CCI, momentum, MACD + signal + histogram, vs SMA20/50/200, vs EMA20, Bollinger position & width, ATR %, volatility, distance from 52-week high/low |
| Valuation | P/E, forward P/E, PEG, P/BV, P/S, EPS, forward EPS, book value, analyst target, upside %, analyst rating |
| Financial | ROE, ROA, profit/operating/gross margin, D/E, current ratio, quick ratio, revenue, net income, EBITDA, FCF, cash, debt, beta |
| Growth | revenue growth, earnings growth |
| Dividend | dividend yield, payout ratio |

Technical indicators are computed from daily price series. Fundamental indicators come from Yahoo's quoteSummary and are only fetched when a column, filter, or sort actually needs them, since each one costs a separate request per symbol.

## Filters and columns

Mirrors a TradingView-style screener:

- **Filter pill row.** Click a pill to open a dropdown of ready-made thresholds ("Oversold below 30", "P/E below 15", "Mega cap above 200B") plus a manual setting with a free operator and value. The × button removes one filter, "Reset all" clears everything. 34 indicators have threshold presets.
- **+ button** opens the full indicator list, grouped by category with a search box. Indicators that don't apply to the active markets still show up, labeled with which markets actually have them.
- **8 preset tabs**: Overview, Performance, Technicals, Valuation, Financial, Growth, Dividend, Volume. Each has its own default column set and sort.
- **Column settings.** Click the arrow icon in a column header to change that column's timeframe (1D, 1W, 1M, 3M, 6M, YTD, 1Y), sort by it, add a column, or remove it. Performance columns can appear more than once with different timeframes.
- **Click a header** to sort; click again to reverse direction.

All state is saved in the URL, so a screening result can be shared as a link and survives a page refresh.

### Timeframe

Available: 1D, 1W, 1M, 3M, 6M, YTD, 1Y. Intraday timeframes (1m to 4h), available on TradingView, aren't offered here: the daily Yahoo endpoint this uses doesn't carry hourly data. Column settings says this explicitly instead of hiding the gap.

## When an indicator isn't available

Two different cases exist, and both surface a notification instead of an unexplained empty result.

**The indicator doesn't exist at all.** Sector, industry, earnings date, float, short interest, insider/institutional ownership, and ESG scores aren't available yet. A prompt asking for one of these shows a notification naming what got skipped, while the rest of the prompt's criteria still run.

**The indicator exists, but not for that market.** The prompt `kripto yang RSI nya oversold` (crypto that's RSI oversold) shows a notification: "RSI 14 not available for CRYPTO, only for IDX and US." This is a different case from the first and deliberately gets a different message.

Technical and fundamental indicators only apply to stocks. Computing RSI for crypto would mean 250 daily-series requests to the free CoinGecko tier, which hits the rate limit; fundamental data simply doesn't apply to crypto assets. Columns that don't apply are filtered from the table automatically, and rows with an empty value for a filtered field never pass that filter and always sort to the bottom.

## Structure

| File | Contents |
|---------------------|--------------------------------------------------|
| `server.js` | HTTP server, `/api/browse` and `/api/screen` endpoints |
| `llm.js` | Prompt to JSON via Gemini, falls back to the parser, reconciles both |
| `parser.js` | Rule-based prompt translator, no LLM |
| `indicators.js` | Registry of 66 indicators, threshold presets, column presets |
| `data.js` | Price fetching, technical indicators, caching |
| `fundamentals.js` | Yahoo quoteSummary (cookie + crumb) for fundamentals |
| `filter.js` | Filter, sort, and limit execution |
| `universe.js` | Stock symbol list |
| `public/index.html` | Single-page UI |
| `test.js` | Self-check |

## Note

LLM output is treated as untrusted data: field names, operators, and value types are validated against an allowlist in `llm.js` before use. Unrecognized filters are dropped, not executed.

This is a research tool, not investment advice.

---

## Bahasa Indonesia

Screener saham dan kripto berbasis prompt bahasa natural. Ketik kriteria dengan kalimat biasa, LLM (atau penerjemah aturan lokal) menerjemahkannya jadi filter terstruktur, lalu dijalankan atas data pasar publik.

## Jalankan

```bash
npm start          # http://localhost:4900
node test.js       # self-check logika filter, sort, RSI
```

Tanpa dependency. Butuh Node 20+ (pakai `fetch` dan `--env-file` bawaan).
`GEMINI_API_KEY` opsional; tanpa key, prompt diterjemahkan aturan lokal (lihat di bawah).

## Contoh prompt

- `saham indonesia PER di bawah 15 dengan ROE di atas 15`
- `saham amerika dividen di atas 3% dan utang rendah`
- `saham yang MACD bullish dan di atas MA200`
- `saham indonesia paling volatil setahun terakhir`
- `kripto top market cap yang naik minggu ini`

## Tanpa API key

Prompt bahasa natural tetap berfungsi tanpa LLM. Kalau `GEMINI_API_KEY` kosong, atau Gemini gagal dihubungi (kuota habis, jaringan putus, model dihapus), prompt diterjemahkan oleh penerjemah aturan lokal di `parser.js`: kamus sinonim untuk 66 indikator, pola angka dan operator gaya Indonesia (`di bawah 15`, `2,5 triliun`, `antara 40 dan 60`, `200B`), idiom (`oversold`, `golden cross`, `bluechip`, `utang rendah`), arah dengan timeframe (`anjlok lebih dari 20% sebulan terakhir`), negasi (`belum overbought`), dan urutan (`paling volatil`, `urutkan dari rsi terendah`, `10 saham dividen tertinggi`).

Yang menjamin hasil selalu sesuai input bukan kepintaran penerjemahnya, tapi kejujurannya: **bagian prompt yang tidak dikenali dilaporkan ke layar, bukan ditebak atau dibuang diam-diam.** `saham bank yang oversold dan bagus buat jangka panjang` menjalankan `RSI < 30`, lalu memberi tahu bahwa "bank" (sektor) belum tersedia dan "bagus buat jangka panjang" tidak dipahami. Tabel yang muncul persis hasil dari kriteria yang benar-benar dikenali, dan user tahu mana yang tidak ikut menyaring.

Batasnya nyata: penerjemah lokal hanya mengenali kosakata di kamusnya. Frasa baru yang tidak ada di sana ("saham seperti NVDA tahun lalu") akan dilaporkan tidak dipahami, sementara LLM mungkin bisa menafsirkannya. Dengan key terpasang, LLM dipakai lebih dulu dan aturan lokal jadi cadangan; centang "Terjemahkan tanpa LLM" di bawah kolom prompt untuk memaksa mode lokal. Status di kanan tab menyebut mesin mana yang dipakai.

Regresi kamus dijaga `node test.js`: 21 prompt dengan filter yang diharapkan, plus kasus yang wajib dilaporkan tidak tersedia atau tidak dipahami.

## Sumber data

| Pasar  | Sumber                       | Cakupan          |
|--------|------------------------------|------------------|
| IDX    | Yahoo Finance chart v8       | 40 saham likuid  |
| US     | Yahoo Finance chart v8       | 40 saham likuid  |
| CRYPTO | CoinGecko markets            | top 250 by mcap  |

Cache 5 menit per pasar. Universe saham ada di `universe.js`, tinggal tambah simbol.

## Tampilan default

Halaman langsung menampilkan tabel begitu dibuka, tanpa perlu mengetik prompt dulu. Susunannya meniru screener TradingView:

- **Baris pasar** (Saham US / Saham ID / Kripto). Bisa dipilih lebih dari satu, minimal satu tetap aktif.
- **Tab preset**: Overview, Performance, Technicals, Volume. Tiap tab punya set kolom dan urutan default sendiri (Technicals urut RSI menaik, Volume urut Rel vol menurun).
- **Header tabel bisa diklik** untuk mengurutkan; klik lagi membalik arah.
- **Kolom Simbol lengket** saat tabel digeser ke samping.

Tampilan ini dilayani `GET /api/browse` yang tidak memanggil LLM sama sekali, jadi cepat dan tetap jalan meski kuota Gemini habis. Kondisi tampilan tersimpan di URL (`?markets=US&preset=technicals&sort=rsi&dir=asc`), jadi bisa dibagikan lewat link dan bertahan saat halaman di-refresh.

Mengetik prompt akan mengambil alih kolom tabel sementara; tab preset otomatis tidak tersorot karena kolomnya ditentukan prompt, bukan tab. Menyentuh toolbar atau mengklik header mengembalikan ke mode browse.

Kolom yang tidak punya data di pasar terpilih otomatis disaring. Preset Technicals di kripto, misalnya, hanya menyisakan kolom yang memang ada isinya, dan urutan default jatuh ke Nilai transaksi karena RSI tidak tersedia di sana.

## Indikator

66 indikator dalam 6 kategori. Registry ada di `indicators.js` dan jadi satu sumber kebenaran: prompt LLM, validasi, menu filter, header tabel, dan pesan "tidak tersedia" semuanya dibangkitkan dari sana.

| Kategori | Isi |
|---|---|
| Market data | harga, Chg %, Perf 1W/1M/3M/6M/YTD/1Y, gap, range harian, volume, avg vol 10D, rel vol, nilai transaksi, market cap |
| Technical | RSI 14 & 7, Stochastic %K, Williams %R, CCI, momentum, MACD + signal + histogram, vs SMA20/50/200, vs EMA20, posisi & lebar Bollinger, ATR %, volatilitas, jarak dari puncak/dasar 52W |
| Valuation | P/E, P/E forward, PEG, PBV, P/S, EPS, EPS forward, nilai buku, target analis, upside %, rating analis |
| Financial | ROE, ROA, margin laba/operasi/kotor, DER, current ratio, quick ratio, revenue, laba bersih, EBITDA, FCF, kas, utang, beta |
| Growth | pertumbuhan revenue, pertumbuhan laba |
| Dividend | dividend yield, payout ratio |

Indikator teknikal dihitung sendiri dari seri harga harian. Indikator fundamental ditarik dari Yahoo quoteSummary dan hanya diambil kalau kolom, filter, atau urutan memang membutuhkannya, karena butuh satu request per simbol.

## Filter dan kolom

Meniru pola screener TradingView:

- **Baris pill filter.** Klik pill untuk membuka dropdown berisi ambang siap pakai ("Oversold di bawah 30", "PER di bawah 15", "Mega di atas 200B") plus setelan manual dengan operator dan nilai bebas. Tombol × menghapus satu filter, "Reset semua" menghapus seluruhnya. 34 indikator punya preset ambang.
- **Tombol +** membuka daftar seluruh indikator, dikelompokkan per kategori dengan kotak pencarian. Indikator yang tak berlaku di pasar aktif tetap terlihat, diberi keterangan pasar mana yang punya.
- **8 tab preset**: Overview, Performance, Technicals, Valuation, Financial, Growth, Dividend, Volume. Masing-masing punya set kolom dan urutan default sendiri.
- **Column settings.** Klik ikon panah di header kolom untuk mengganti timeframe kolom itu (1D, 1W, 1M, 3M, 6M, YTD, 1Y), mengurutkan, menambah kolom, atau menghapusnya. Kolom performa bisa muncul beberapa kali dengan timeframe berbeda.
- **Klik header** untuk mengurutkan; klik lagi membalik arah.

Semua keadaan tersimpan di URL, jadi hasil screening bisa dibagikan lewat link dan bertahan saat halaman di-refresh.

### Timeframe

Tersedia 1D, 1W, 1M, 3M, 6M, YTD, dan 1Y. Timeframe intraday (1m sampai 4h) yang ada di TradingView tidak disediakan: endpoint harian Yahoo yang dipakai tidak memuat data per jam. Column settings menyebut hal ini secara eksplisit alih-alih menyembunyikannya.

## Kalau indikator tidak ada

Ada dua kasus berbeda, dan keduanya memunculkan notifikasi, bukan hasil kosong tanpa penjelasan.

**Indikator tidak ada sama sekali.** Sektor, industri, tanggal earnings, float, short interest, kepemilikan insider/institusi, dan skor ESG belum tersedia. Prompt yang memintanya memunculkan notifikasi yang menyebut indikator mana yang dilewati, sementara kriteria lain di prompt yang sama tetap dijalankan.

**Indikator ada, tapi bukan untuk pasar itu.** Prompt `kripto yang RSI nya oversold` memunculkan notifikasi "RSI 14 tidak ada untuk CRYPTO, hanya punya data di IDX dan US". Ini berbeda dari kasus pertama dan sengaja dibedakan pesannya.

Indikator teknikal dan fundamental hanya berlaku untuk saham. Menghitung RSI untuk kripto berarti 250 request seri harian ke CoinGecko gratis, yang kena rate limit; data fundamental memang tidak berlaku untuk aset kripto. Kolom yang tak berlaku disaring otomatis dari tabel, dan baris dengan nilai kosong tak pernah lolos filter atas field itu serta selalu diurutkan paling bawah.

## Struktur

| File                | Isi                                              |
|---------------------|--------------------------------------------------|
| `server.js`         | HTTP server, endpoint /api/browse dan /api/screen  |
| `llm.js`            | Prompt to JSON via Gemini, fallback ke parser, reconcile |
| `parser.js`         | Penerjemah prompt berbasis aturan, tanpa LLM       |
| `indicators.js`     | Registry 66 indikator, preset ambang, preset kolom |
| `data.js`           | Fetch harga, indikator teknikal, cache             |
| `fundamentals.js`   | Yahoo quoteSummary (cookie + crumb) utk fundamental|
| `filter.js`         | Eksekusi filter, sort, limit                      |
| `universe.js`       | Daftar simbol saham                               |
| `public/index.html` | UI satu halaman                                   |
| `test.js`           | Self-check                                        |

## Catatan

Output LLM diperlakukan sebagai data tak terpercaya: nama field, operator, dan tipe nilai divalidasi terhadap allowlist di `llm.js` sebelum dipakai. Filter yang tidak dikenali dibuang, bukan dieksekusi.

Ini alat riset, bukan saran investasi.
