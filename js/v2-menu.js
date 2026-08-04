// v2-menu.js — camp-0 主選單(規格 H §14;使用者提案 2026-08-04)。
//
// 設計主張:**把「開場說明」變成「開場畫面」**。舊開場是字卡講「你要記錄 3 次事故然後收容封存」;
// 選單版本直接演給玩家看——小人在流水線上機械地重複勞動,標題壓在上面,
// **按下「開始遊戲」的那一刻=他決定不幹了**。玩家還沒按任何鍵就理解了全部動機。
//
// 這一檔只管 **DOM 疊層**(標題/按鈕/狀態);場景那半在 render-lab 的 `setMenuScene`,
// 角色的工作循環在 v2.js 的 `stepMenu`。三邊都只讀 v2s,不互相 import(守 v2 DAG)。
//
// ⚠ DOM 慣例照既有的走(v2-touch 的結算按鈕 / v2.js 的慢動作 pill):
//   `position:fixed` + 高 z-index + **容器 `pointer-events:none`、只有按鈕 `auto`**
//   ——不然疊層會把整個畫布的滑鼠事件吃掉。

const CLEAR_KEY = 'mmm_camp_cleared';        // localStorage:通關過沒有(解鎖加班模式)

let root = null, onStart = null, _shown = false;

export function isCleared() {
  try { return localStorage.getItem(CLEAR_KEY) === '1'; } catch { return false; }
}
export function markCleared() {
  try { localStorage.setItem(CLEAR_KEY, '1'); } catch { /* privacy mode */ }
}

function button(label, sub, enabled, fn) {
  const b = document.createElement('div');
  b.className = 'mmBtn';
  b.style.cssText = 'pointer-events:' + (enabled ? 'auto' : 'none') + ';user-select:none;cursor:' + (enabled ? 'pointer' : 'default') + ';'
    + 'min-width:clamp(200px,26vw,300px);padding:clamp(8px,1.5vh,14px) clamp(18px,2.5vw,30px);border-radius:10px;text-align:center;'
    + 'font:800 clamp(15px,2.2vh,22px)/1.25 system-ui,sans-serif;letter-spacing:1px;transition:filter .12s,transform .12s;'
    + (enabled
      ? 'color:#eafff4;border:2px solid rgba(140,255,190,.75);background:linear-gradient(180deg,rgba(40,200,120,.32),rgba(20,120,80,.30));box-shadow:0 0 20px rgba(80,255,160,.30)'
      : 'color:#7d8794;border:2px solid rgba(125,135,148,.35);background:rgba(20,24,32,.45)');
  b.innerHTML = '<div>' + label + '</div>'
    + (sub ? '<div style="font:600 clamp(10px,1.4vh,13px) system-ui;letter-spacing:0;opacity:.72;margin-top:3px">' + sub + '</div>' : '');
  if (enabled) {
    b.addEventListener('pointerenter', () => { b.style.filter = 'brightness(1.25)'; b.style.transform = 'translateY(-1px)'; });
    b.addEventListener('pointerleave', () => { b.style.filter = ''; b.style.transform = ''; });
    // ⚠ pointerdown 而不是 click:這一下同時是 **WebAudio 的使用者手勢**(audio.js 要手勢才出得了聲),
    //   早一拍解鎖 → 逃跑的第一幀就有音效(舊開場是啞的)。
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
  }
  return b;
}

function build() {
  root = document.createElement('div');
  root.id = 'v2menu';
  // 容器不吃事件(見表頭);左側下三分之一放字,讓右邊的工作中小人露出來
  root.style.cssText = 'position:fixed;inset:0;z-index:9990;pointer-events:none;display:flex;'
    + 'flex-direction:column;justify-content:flex-end;align-items:flex-start;'
    + 'padding:0 0 clamp(28px,7vh,80px) clamp(28px,6vw,90px);'
    + 'background:linear-gradient(90deg,rgba(8,7,12,.78) 0%,rgba(8,7,12,.42) 42%,rgba(8,7,12,0) 72%)';

  const kicker = document.createElement('div');
  kicker.textContent = '18:47 · 今天第 11 個小時';
  kicker.style.cssText = 'font:700 clamp(11px,1.6vh,15px) system-ui,sans-serif;letter-spacing:3px;color:#ffd36d;opacity:.85;margin-bottom:6px';

  const title = document.createElement('div');
  title.id = 'v2menuTitle';
  title.textContent = '我要下班';
  title.style.cssText = 'font:900 clamp(34px,7.5vh,74px)/1 system-ui,sans-serif;letter-spacing:2px;color:#f8f3e8;'
    + 'text-shadow:0 3px 0 rgba(0,0,0,.55),0 0 30px rgba(120,200,255,.25)';

  const tagline = document.createElement('div');
  tagline.textContent = '三個同事擋在你和大門之間。';
  tagline.style.cssText = 'font:600 clamp(12px,1.9vh,18px) system-ui,sans-serif;color:#cfd8e6;opacity:.9;margin:10px 0 clamp(16px,3vh,30px)';

  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;flex-direction:column;gap:clamp(8px,1.4vh,14px)';
  btns.appendChild(button('開始遊戲', '', true, () => { if (onStart) onStart(); }));
  const cleared = isCleared();
  btns.appendChild(button('加班模式', cleared ? '無限對戰' : '通關後解鎖', cleared, () => { if (onStart) onStart({ overtime: true }); }));

  root.append(kicker, title, tagline, btns);
  document.body.appendChild(root);
}

// v2.js 開機呼叫:注入「開始」的回呼。
export function initMenu(startFn) { onStart = startFn; if (!root) build(); }

export function setMenuVisible(v) {
  if (!root) return;
  if (_shown === !!v) return;
  _shown = !!v;
  root.style.display = v ? 'flex' : 'none';
}

// 測試 hook(比照 __v2/__lab 慣例):選單狀態一行問完。
if (typeof window !== 'undefined') {
  window.__menu = () => ({
    built: !!root,
    shown: _shown,
    cleared: isCleared(),
    title: root ? root.querySelector('#v2menuTitle').textContent : null,
    buttons: root ? [...root.querySelectorAll('.mmBtn')].map(b => ({
      label: b.firstChild.textContent, enabled: b.style.pointerEvents === 'auto',
    })) : [],
  });
  window.__menuStart = () => { if (onStart) onStart(); };   // headless 用(puppeteer 的 click 要算座標,直接呼叫更穩)
}
