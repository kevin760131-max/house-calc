// 重新產生 lvr-taichung.zip：下載內政部實價登錄開放資料（臺中市 b_lvr_land_a.csv），
// 用 valuation.html 裡 <script id="core"> 的同一套 parseLvr 解析，與現有資料合併後輸出。
// 用法：node build-lvr.mjs [--seasons 115S2,115S3] [--csv 檔案.csv|.zip ...] [--no-current] [--dry-run]
// 不帶參數時 = 本期 + 上一季整季檔。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const HTML = path.join(ROOT, 'valuation.html');
const OUT = path.join(ROOT, 'lvr-taichung.zip');
const JSON_NAME = 'lvr-taichung.json';
const BASE = 'https://plvr.land.moi.gov.tw';
// 與 valuation.html 的 PACK 相同順序
const PACK = ['id','dist','addr','road','key','g','type','date','price','area','land','parkP','parkN','parkUnpriced','age','floor','tfloor','layout','note','special'];
const KEEP_MS = 5 * 365.25 * 86400000;

const args = process.argv.slice(2);
const opt = { seasons: [], csv: [], current: true, dry: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--seasons') opt.seasons = args[++i].split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  else if (a === '--csv') while (args[i + 1] && !args[i + 1].startsWith('--')) opt.csv.push(args[++i]);
  else if (a === '--no-current') opt.current = false;
  else if (a === '--dry-run') opt.dry = true;
  else { console.error(`未知參數：${a}`); process.exit(2); }
}
for (const s of opt.seasons) if (!/^\d{3}S[1-4]$/.test(s)) { console.error(`季別格式錯誤：${s}（例：115S3）`); process.exit(2); }
opt.auto = opt.current && !opt.seasons.length && !opt.csv.length;

/* ===== 從 valuation.html 取出解析邏輯，確保與網頁匯入結果一致 ===== */
function loadCore() {
  const html = fs.readFileSync(HTML, 'utf8');
  const m = html.match(/<script id="core">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('valuation.html 找不到 <script id="core">');
  const ctx = vm.createContext({ TextDecoder });
  return vm.runInContext(m[1] + '\n;({parseLvr, PING})', ctx);
}

/* ===== 最小 ZIP 讀寫（只需 stored / deflate） ===== */
function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('不是有效的 ZIP 檔');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const data = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(data, data + csize);
    files[name] = () => method === 0 ? raw : zlib.inflateRawSync(raw);
    p += 46 + nlen + xlen + clen;
  }
  return files;
}
function zipOne(name, content) {
  const nm = Buffer.from(name, 'utf8'), crc = zlib.crc32(content);
  const comp = zlib.deflateRawSync(content, { level: 9 });
  const loc = Buffer.alloc(30);
  loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x0800, 6); loc.writeUInt16LE(8, 8);
  loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(content.length, 22); loc.writeUInt16LE(nm.length, 26);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
  cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(content.length, 24); cen.writeUInt16LE(nm.length, 28);
  const cdOff = 30 + nm.length + comp.length, cdLen = 46 + nm.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(cdLen, 12); end.writeUInt32LE(cdOff, 16);
  return Buffer.concat([loc, nm, comp, cen, nm, end]);
}

// 與網頁 decode() 相同：UTF-8 亂碼過多時改用 Big5
function decode(buf) {
  let t = new TextDecoder('utf-8').decode(buf);
  if ((t.slice(0, 4000).match(/�/g) || []).length > 3) t = new TextDecoder('big5').decode(buf);
  return t;
}
function csvFromZip(buf, label) {
  const files = unzip(buf);
  let names = Object.keys(files).filter(n => /(^|\/)b_lvr_land_a\.csv$/i.test(n));
  if (!names.length) names = Object.keys(files).filter(n => /_lvr_land_a\.csv$/i.test(n));
  if (!names.length) throw new Error(`${label}：找不到臺中市不動產買賣檔（b_lvr_land_a.csv）`);
  return names.map(n => [`${label}/${n}`, decode(files[n]())]);
}
async function download(url, label) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label}：下載失敗 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error(`${label}：回傳的不是 ZIP（該季可能尚未發布）`);
  return buf;
}

const { parseLvr } = loadCore();

// 1. 現有資料
const map = new Map();
let made0 = null;
if (fs.existsSync(OUT)) {
  const f = unzip(fs.readFileSync(OUT))[JSON_NAME];
  if (!f) throw new Error(`${OUT} 裡沒有 ${JSON_NAME}`);
  const pk = JSON.parse(f().toString('utf8'));
  if (pk.v !== 1 || !Array.isArray(pk.rows)) throw new Error('現有 lvr-taichung.json 格式不符（v!==1）');
  made0 = pk.made;
  for (const row of pk.rows) map.set(row[0], row);
}
const before = map.size;
console.log(`現有資料：${before.toLocaleString()} 筆（上次產生 ${made0 ? new Date(made0).toLocaleString('zh-TW') : '—'}）`);

// 2. 收集要匯入的 CSV
const texts = [];
if (opt.current) texts.push(...csvFromZip(await download(`${BASE}/Download?type=zip&fileName=lvr_landcsv.zip`, '本期'), '本期'));
for (const s of opt.seasons)
  texts.push(...csvFromZip(await download(`${BASE}/DownloadSeason?season=${s}&type=zip&fileName=lvr_landcsv.zip`, s), s));
// 沒指定季別時自動補上一季整季檔，避免漏掉沒跑到的本期批次（尚未發布就略過）
if (opt.auto) {
  const d = new Date(), q = Math.floor(d.getMonth() / 3);
  const s = q ? `${d.getFullYear() - 1911}S${q}` : `${d.getFullYear() - 1912}S4`;
  try { texts.push(...csvFromZip(await download(`${BASE}/DownloadSeason?season=${s}&type=zip&fileName=lvr_landcsv.zip`, s), s)); }
  catch (e) { console.log(`（略過上一季 ${s}：${e.message}）`); }
}
for (const p of opt.csv) {
  const buf = fs.readFileSync(p);
  if (/\.zip$/i.test(p)) texts.push(...csvFromZip(buf, path.basename(p)));
  else texts.push([path.basename(p), decode(buf)]);
}
if (!texts.length) { console.error('沒有任何資料來源'); process.exit(2); }

// 3. 解析並合併（同編號以新資料為準，實價登錄會修正舊紀錄）
const before_ids = new Set(map.keys());
let added = 0, updated = 0;
for (const [name, t] of texts) {
  const { recs, skipped, err } = parseLvr(t);
  if (err) throw new Error(`${name}：${err}`);
  let a = 0, u = 0;
  for (const r of recs) {
    const row = PACK.map(k => k === 'parkUnpriced' || k === 'special' ? (r[k] ? 1 : 0) : (r[k] ?? null));
    if (map.has(r.id)) { if (JSON.stringify(map.get(r.id)) !== JSON.stringify(row)) u++; } else a++;
    map.set(r.id, row);
  }
  added += a; updated += u;
  console.log(`${name}：可用 ${recs.length} 筆（新增 ${a}、更新 ${u}），略過土地／車位／多棟等 ${skipped} 筆`);
}

// 4. 篩選臺中市、近 5 年，依日期排序後輸出
const since = Date.now() - KEEP_MS;
const iAddr = PACK.indexOf('addr'), iDate = PACK.indexOf('date');
const all = [...map.values()];
const rows = all.filter(r => /^臺中市/.test(r[iAddr]) && r[iDate] >= since).sort((a, b) => a[iDate] - b[iDate]);
const dropped = all.length - rows.length;
const made = Date.now();
const zip = zipOne(JSON_NAME, Buffer.from(JSON.stringify({ v: 1, made, rows }), 'utf8'));
const ym = t => { const d = new Date(t); return `${d.getFullYear() - 1911}/${String(d.getMonth() + 1).padStart(2, '0')}`; };

const kept = rows.filter(r => !before_ids.has(r[0])).length;
console.log(`---\n實際新增 ${kept.toLocaleString()} 筆（另有 ${(added - kept).toLocaleString()} 筆是超過 5 年的補登案件，不收）、更新 ${updated.toLocaleString()} 筆`);
console.log(`移除超過 5 年或非臺中 ${dropped.toLocaleString()} 筆（含上述補登）`);
console.log(`輸出 ${rows.length.toLocaleString()} 筆（${ym(rows[0][iDate])} ～ ${ym(rows.at(-1)[iDate])}），ZIP ${(zip.length / 1048576).toFixed(1)} MB`);
if (opt.dry) console.log('（--dry-run：未寫入檔案）');
else { fs.writeFileSync(OUT, zip); console.log(`已寫入 ${OUT}`); }
