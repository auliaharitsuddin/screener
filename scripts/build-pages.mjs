// Build statis untuk GitHub Pages: menarik data live SEKALI lewat kode
// produksi (data.js -> Yahoo Finance & CoinGecko), menyimpannya sebagai
// snapshot JSON, lalu merakit dist/ berisi index.html + parser/indicators/
// filter asli (murni ESM, tanpa API server) + shim yang meniru endpoint
// server.js dari snapshot itu. Tidak mengubah server.js/public/ produksi.
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getRows, withFundamentals } from '../data.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');

async function buildSnapshot() {
  console.log('Menarik snapshot data live (IDX + US + CRYPTO)...');
  let rows = await getRows(['IDX', 'US', 'CRYPTO']);
  rows = await withFundamentals(rows);
  console.log(`Snapshot: ${rows.length} instrumen.`);
  return { generatedAt: new Date().toISOString(), rows };
}

async function main() {
  await mkdir(dist, { recursive: true });

  const snapshot = await buildSnapshot();
  await writeFile(path.join(dist, 'demo-data.json'), JSON.stringify(snapshot));

  // Modul murni ESM, tanpa dependensi Node-only: bisa dipakai langsung di browser.
  for (const f of ['indicators.js', 'parser.js', 'filter.js']) {
    await copyFile(path.join(root, f), path.join(dist, f));
  }
  await copyFile(path.join(root, 'scripts/pages/demo-shim.js'), path.join(dist, 'demo-shim.js'));

  let html = await readFile(path.join(root, 'public/index.html'), 'utf8');

  const banner = `<div class="note" role="status"><div><b>Demo mode</b>
    <p>Data harga snapshot (bukan live), diambil sekali saat build ini.
    Fitur LLM dimatikan; kriteria diterjemahkan penerjemah aturan lokal saja.</p></div></div>\n`;
  if (!html.includes('</header>')) throw new Error('Anchor </header> tidak ditemukan di index.html');
  html = html.replace('</header>', '</header>\n' + banner);

  const shimTag = '<script type="module" src="./demo-shim.js"></script>\n';
  if (!html.includes('<script type="module">')) throw new Error('Anchor script module tidak ditemukan di index.html');
  html = html.replace('<script type="module">', shimTag + '<script type="module">');

  await writeFile(path.join(dist, 'index.html'), html);
  console.log('dist/ siap.');
}

main().catch(e => { console.error(e); process.exit(1); });
