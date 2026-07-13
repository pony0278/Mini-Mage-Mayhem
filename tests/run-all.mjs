// v2 回歸套件總跑器:啟本機 server(repo root)→ 逐一跑各驗收套件的子行程 → 匯總 pass/fail。
// 用法:cd tests && npm i && npm test  (或 node run-all.mjs)
// 單跑一支:先在 repo root `python3 -m http.server 8099`,再 `cd tests && node bottles.mjs`。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..');

// 套件清單(對應各系統;新系統落地時在此加一行)。
const SUITES = [
  ['bottles',   '投擲瓶=場上物件(撿丟/碎裂/風吹擊飛/走動推)'],
  ['wind',      '風壓手套(扇形放射/距離角度衰減/翻滾/反彈/穿防)'],
  ['oilfire',   '油瓶+噴火帽(油膜/短扇形不留地形火/著火 DoT/R1 連段/起手預告)'],
  ['water',     '工業重錘+火融冰(火帽融冰成水/砸壓造濕地+短擊倒/濕地接雷 R2)'],
  ['lightning', '魔導電鞭(直線電擊擊暈/線外不中/沿線給水充電 R2/起手預告直線)'],
  ['detonate',  '右鍵=攻擊、E=互動 + 道具引爆桶/瓶(火帽瓶碎即燃/水錘砸碎/電鞭線上碎/傳送不佔右鍵)'],
  ['switches',  '總開關移左右兩側(揍任一支 arm 四站/舊中央位置失效/範圍外不觸發)'],
  ['podglb',    '回收艙底座 GLB(開局載入+擺位/換裝生效)'],
  ['sign',      'THROW IN! 指示牌 GLB(開局載入+四塊擺位/取代四色程序箭頭)'],
  ['pickup',    '手動撿道具 C 案(不自動撿/被暈掉落/地上可搶/TTL)'],
  ['ice_slide', '冰面鎖滑(直線滑/撞牆暈/滑進艙收容/小心走)'],
  ['perform',   '回收演出 V0.8(玻璃罩+掃描+分類字/期間不二次收容/收尾才彈回/失控火花/壓縮清運→報告)'],
  ['mobilefx',  '手機自動降級(觸控+行動UA→FX_LOW+dpr1.5/桌機不變/?fx=full 覆蓋)'],
  ['onboard',   '上手框架(首局教學旗標/AI 同事開場即開/開場字幕+鏡頭/就位靜止/localStorage)'],
  ['sorting',   '分類事故引擎(中央口需求制/餵對錯/AI 怒氣五階段/輪班倒數+暴走/AI 同事工作競賽)'],
];

// ⚠ server 一定要從 repo root 起(套件裡 import('./js/…') 由瀏覽器對 server 根解析;從 tests/ 起會 404)。
const server = spawn('python3', ['-m', 'http.server', '8099'], { cwd: root, stdio: 'ignore' });
const cleanup = () => { try { server.kill(); } catch { /* already gone */ } };
process.on('exit', cleanup); process.on('SIGINT', () => { cleanup(); process.exit(130); });

async function waitServer() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('http://localhost:8099/v2.html'); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

const runSuite = (name) => new Promise((res) => {
  const p = spawn('node', [join(__dir, name + '.mjs')], { cwd: __dir, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', d => (out += d));
  p.stderr.on('data', d => (out += d));
  p.on('close', (code) => res({ name, code, out }));
});

if (!(await waitServer())) { console.error('✗ 本機 server 起不來(port 8099)'); process.exit(2); }

let failed = 0;
for (const [name, desc] of SUITES) {
  const r = await runSuite(name);
  const summary = (r.out.match(/== .* ==/g) || ['(無匯總行)']).pop();
  console.log(`${r.code === 0 ? '✓ PASS' : '✗ FAIL'}  ${name.padEnd(11)} ${summary}   — ${desc}`);
  if (r.code !== 0) {
    failed++;
    for (const line of r.out.split('\n')) if (line.startsWith('FAIL')) console.log('        ' + line);
  }
}
console.log(`\n== ${SUITES.length - failed}/${SUITES.length} suites green ==`);
process.exit(failed ? 1 : 0);
