// v2-smokeroom.js — SMOKE ROOM 道具測試間(smoke-1,使用者要求「自由測試道具」)。
// smokeroom.html 專屬面板(repo-only;正式頁 v2.html 不載=遊戲保持乾淨;portal build 只捆 v2.js 樹=自動排除)。
// 定位:v2 版的 training.html——給自己任何道具(含彈藥無限)、假人狀態控制(AI/無敵/解狀態/擺位)、
// 地板化學快速鋪設、重開。走 v2-tuning 同款 DOM 面板模式;所有操作走 __v2 hook + v2 模組直接 import
// (與 headless 測試同一組入口=面板能做的,測試腳本也能做)。
// 快捷鍵:1~5=給道具(風/火/錘/鞭/傳送)、0=清道具;K=慢動作循環(v2.js 內建)。
import { game } from './state.js';
import { ITEM_INFO, ITEM_SPEC, resetFighter, v2s } from './v2-state.js';
import { stampElement, resetFloor, stateAtPixel } from './v2-floor.js';

const v2 = window.__v2;
if (!v2) throw new Error('[smokeroom] window.__v2 not ready(v2.js 要先載)');
const { fighters } = v2;
const ME = fighters[0], DUMMY = fighters[1];

// ---- 開房即測:跳過開場訓話/教學、AI 關閉=假人立正 ----
v2s.introT = 0; v2s.tutorial = false;
DUMMY.ai = false;
try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* privacy mode */ }

/* ==== 面板骨架(v2-tuning 同款) ==== */
const panel = document.createElement('div');
panel.id = 'smokeroom';
panel.style.cssText = `position:fixed;top:10px;right:10px;z-index:9999;width:220px;max-height:94vh;overflow:auto;
  background:rgba(20,22,26,.93);border:1px solid #57606a;border-radius:10px;padding:10px 12px;
  font:12px system-ui,sans-serif;color:#eee;box-shadow:0 8px 30px rgba(0,0,0,.5);pointer-events:auto;`;
document.body.appendChild(panel);

function header(txt, big) {
  const e = document.createElement('div'); e.textContent = txt;
  e.style.cssText = big ? 'font-weight:800;color:#ff9a5a;font-size:13px;margin-bottom:2px;'
    : 'font-weight:700;margin:9px 0 3px;color:#ff9a5a;';
  panel.appendChild(e);
}
function note(txt) {
  const e = document.createElement('div'); e.textContent = txt;
  e.style.cssText = 'color:#9aa4af;font-size:11px;margin:2px 0 4px;line-height:1.35;';
  panel.appendChild(e);
}
function btnRow(defs) { // defs = [[label, onClick, color?], ...]
  const row = document.createElement('div'); row.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin:3px 0;';
  for (const [label, on, color] of defs) {
    const b = document.createElement('button'); b.textContent = label;
    b.style.cssText = `flex:1 0 30%;padding:5px 4px;font:12px system-ui;border-radius:6px;cursor:pointer;
      background:#262b31;color:${color || '#eee'};border:1px solid #454c55;white-space:nowrap;`;
    b.onclick = () => { on(); b.style.background = '#3a424c'; setTimeout(() => { b.style.background = '#262b31'; }, 140); };
    row.appendChild(b);
  }
  panel.appendChild(row);
  return row;
}
function checkRow(label, init, on) {
  const row = document.createElement('label');
  row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin:4px 0;cursor:pointer;';
  const nm = document.createElement('span'); nm.textContent = label;
  const c = document.createElement('input'); c.type = 'checkbox'; c.checked = init;
  c.onchange = () => on(c.checked);
  row.append(nm, c); panel.appendChild(row);
  return c;
}

/* ==== 道具 ==== */
header('SMOKE ROOM', true);
note('道具測試間:假人立正、無開場。1~5=給道具、0=清、K=慢動作。');

header('道具(給自己)');
const TYPES = ['wind', 'fire', 'water', 'lightning', 'teleport'];
function giveItem(type) {
  ME.item = type; ME.itemUses = ITEM_SPEC[type].uses;
  ME.itemCastCd = 0; ME._itemCastAt = 0;                 // 直接可放(清承諾殘留)
}
btnRow(TYPES.map(t => [ITEM_INFO[t].name.replace('工業', '').replace('魔導', ''), () => giveItem(t), ITEM_INFO[t].color]));
btnRow([['清道具', () => { ME.item = null; ME._itemVisType = null; }]]);
// 彈藥無限:持有道具時每 tick 補滿次數(不動 itemCastCd=施法節奏維持真實)
let infinite = false;
checkRow('彈藥無限', false, on => { infinite = on; });
setInterval(() => { if (infinite && ME.item) ME.itemUses = Math.max(ME.itemUses, ITEM_SPEC[ME.item].uses); }, 100);

/* ==== 假人 ==== */
header('假人(對手)');
checkRow('AI 開', false, on => { DUMMY.ai = on; });
let invin = false;
checkRow('無敵', false, on => { invin = on; if (!on) DUMMY.invuln = 0; });
setInterval(() => { if (invin) DUMMY.invuln = 99; }, 100);
// 解除狀態:清光暈眩/冰凍/觸電/燃燒鏈/擊飛=隨時回到可再測的乾淨假人(保留位置與 AI 設定)
function cureDummy() {
  DUMMY.state = 'alive'; DUMMY._hidden = false;
  DUMMY.stunned = false; DUMMY.stunT = 0; DUMMY.restunT = 0; DUMMY.fumbleT = 0;
  DUMMY.frozen = false; DUMMY.shockT = 0;
  DUMMY.burnT = 0; DUMMY._burnCh = null; DUMMY._burnLie = false;
  DUMMY.stability = 100; DUMMY.guardStam = 100;
  DUMMY.vx = 0; DUMMY.vy = 0; DUMMY._slideVx = 0; DUMMY._slideVy = 0;
  DUMMY.z = 0; DUMMY._thrownT = -9; DUMMY._lob = null; DUMMY._lying = false;
  if (!invin) DUMMY.invuln = 0;
}
// 擺位:假人站到玩家面向的正前方(近=貼臉扇形內、遠=電鞭射程邊)
function place(d) {
  cureDummy();
  DUMMY.x = ME.x + Math.cos(ME.facing) * d; DUMMY.y = ME.y + Math.sin(ME.facing) * d;
}
btnRow([
  ['解除狀態', cureDummy],
  ['近(70)', () => place(70)],
  ['遠(240)', () => place(240)],
]);
btnRow([['雙方歸位', () => { resetFighter(ME); resetFighter(DUMMY); cureDummy(); DUMMY.ai = false; }]]);

/* ==== 場地 ==== */
header('場地(鋪在假人腳下)');
note('火要有油才燒得起來(R1)——用「油+火」一鍵鋪火海。');
const stamp = (el) => stampElement(DUMMY.x, DUMMY.y, 44, el);
btnRow([
  ['油', () => stamp('oil'), '#c9a86a'],
  ['冰', () => stamp('ice'), '#9fd8ff'],
  ['水', () => stamp('water'), '#4da6ff'],
  ['油+火', () => { stamp('oil'); stamp('fire'); }, '#ff7a3a'],
]);
btnRow([['清地板', resetFloor]]);

/* ==== 房間 ==== */
header('房間');
btnRow([['重開一局', () => { v2.restartMatch(); v2s.introT = 0; DUMMY.ai = false; }]]);
note('收容計分照常(丟進艙會演出);測乾淨手感就開無敵。');

/* ==== 快捷鍵 ==== */
window.addEventListener('keydown', (e) => {
  const i = '12345'.indexOf(e.key);
  if (i >= 0) giveItem(TYPES[i]);
  else if (e.key === '0') { ME.item = null; ME._itemVisType = null; }
});

// headless 測試 hook(面板=測試同入口)
window.__smokeroom = { giveItem, cureDummy, place, stamp, stateAtPixel: (x, y) => stateAtPixel(x, y), game };
console.log('[smokeroom] ready');
