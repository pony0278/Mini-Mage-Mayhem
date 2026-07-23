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
  ['detonate',  'Z=開火、X=互動分工 + 道具引爆桶/瓶(火帽瓶碎即燃/水錘砸碎/電鞭線上碎/傳送不擋互動)'],
  ['keys',      '鍵盤操作 keys-1(滑鼠退役:C拳/X互動/Z道具/方向鍵8向面向=移動方向/停下保留/滑鼠點擊無效)'],
  ['switches',  '總開關移左右兩側(揍任一支 arm 四站/舊中央位置失效/範圍外不觸發)'],
  ['podglb',    '回收艙底座 GLB(開局載入+擺位/換裝生效)'],
  ['frostbottle','冰霜瓶 GLB 三狀態(載成/地面冰瓶掛GLB/油瓶留方塊/握持冰瓶掛GLB)'],
  ['barrel',    '爆桶 GLB 三狀態 item-2(載成/地面兩桶掛GLB/引信疊加光暈/握持掛GLB)'],
  ['hat',       '火帽 GLB 頭戴 item-3(載成/持噴火帽=戴頭上跟頭動/無道具=隱藏)'],
  ['whip',      '魔導電鞭 Verlet 垂鞭/甩鞭 whip-1(持電鞭=垂鞭/無道具=隱藏/施放走完/最後一發甩完自動收)'],
  ['gauntlet',  '風壓手套 GLB 右手裝備 item-4(載成/持風壓手套=戴右手/無道具=隱藏)'],
  ['pickup',    '手動撿道具 C 案(不自動撿/被暈掉落/地上可搶/TTL)'],
  ['ice_slide', '冰面鎖滑(直線滑/撞牆暈/滑進艙=捕捉/小心走)'],
  ['perform',   '回收演出 V0.8(收容→罩+計分/不二次收容/收尾彈回/第2次風味/第3次壓縮→報告)'],
  ['mobilefx',  '手機自動降級(觸控+行動UA→FX_LOW+dpr1.5/桌機不變/?fx=full 覆蓋)'],
  ['onboard',   '上手框架(首局教學旗標/AI 對手開場即開/開場字幕+鏡頭/就位靜止/localStorage)'],
  ['brawl',     '爽鬥核心 brawl-1(系統全醒/穩定值歸零暈/終結技打飛/反暈/收容計分/事故報告)'],
  ['jump',      '跳躍+下壓拳 brawl-2(跑=預設/空白跳/Shift防/空中免地板免鎖滑/下壓穿防+落空硬直/拍落/跳過艙口)'],
  ['combo',     '連段系統 brawl-3+feel-4(三連黏臉/終結打暈=連帶挑飛/前段暈原地/已暈再擊挑飛/風壓接送/頓點=時間停)'],
  ['hitfx',     '漫畫打擊爆花 hitfx-1(鉤=小橘/挑飛=最大檔集中線/打暈=琥珀/反擊=金/下壓=紅/老化移除/揮空無)'],
  ['dash',      '衝刺攻擊 feel-1(持續跑≥0.4s 出拳=突進拳/門檻分派/削30+推/可擋開反擊窗/前衝/揮空懲罰/clip 槽位)'],
  ['intern',    'AI 階級 tier-1(實習生檔案/快輸逃跑可追擊/到出口消失/資深同點進場比分保留/讀起手舉防/一場一次)'],
];

// ⚠ server 一定要從 repo root 起(套件裡 import('./js/…') 由瀏覽器對 server 根解析;從 tests/ 起會 404)。
const server = spawn('python3', ['-m', 'http.server', '8099'], { cwd: root, stdio: 'ignore' });
const cleanup = () => { try { server.kill(); } catch { /* already gone */ } };
process.on('exit', cleanup); process.on('SIGINT', () => { cleanup(); process.exit(130); });

async function waitServer() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('http://localhost:8099/v2.html?turbo=8'); if (r.ok) return true; } catch { /* not up yet */ }
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

// 併發池(2026-07-20 提速):套件彼此獨立(各自開瀏覽器、共用靜態 server)→ 同時跑 CONC 套。
// 搭配 ?turbo=8(v2.js 測試旗:每幀 8 次 step)把 10min+ 的全套壓進分鐘級;CONC=1 可退回序列。
const CONC = Math.max(1, parseInt(process.env.CONC || '3', 10) || 3);
const results = new Array(SUITES.length);
let next = 0;
async function worker() {
  while (next < SUITES.length) {
    const my = next++;
    const t0 = Date.now();
    results[my] = await runSuite(SUITES[my][0]);
    results[my].secs = Math.round((Date.now() - t0) / 1000);
    process.stderr.write(`  ▸ ${SUITES[my][0]} done(${results[my].secs}s)\n`); // 進度心跳(stderr,不進匯總)
  }
}
const wall0 = Date.now();
await Promise.all(Array.from({ length: CONC }, worker));
let failed = 0;
for (let i = 0; i < SUITES.length; i++) {
  const [name, desc] = SUITES[i]; const r = results[i];
  const summary = (r.out.match(/== .* ==/g) || ['(無匯總行)']).pop();
  console.log(`${r.code === 0 ? '✓ PASS' : '✗ FAIL'}  ${name.padEnd(11)} ${summary}   — ${desc}`);
  if (r.code !== 0) {
    failed++;
    for (const line of r.out.split('\n')) if (line.startsWith('FAIL')) console.log('        ' + line);
  }
}
console.log(`\n== ${SUITES.length - failed}/${SUITES.length} suites green ==(${Math.round((Date.now() - wall0) / 1000)}s,CONC=${CONC},turbo=8)`);
process.exit(failed ? 1 : 0);
