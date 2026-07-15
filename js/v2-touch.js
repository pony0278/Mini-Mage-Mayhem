// v2-touch.js — 手機觸控控制層(完整規劃見 docs/mobile-touch.md)。
// Phase A:觸控偵測 + 橫向提示層(直向蓋「請轉橫」)。
// 桌機/筆電零影響(偵測不到觸控就整層不啟用;而且桌機永遠不會是直向)。
// 純 UI/輸入層,不 import sim。之後 Phase B/C 在這裡加浮動搖桿 + 3 顆動作按鈕。

import { touchInput } from './state.js';

let touch = false;
export function isTouch() { return touch; }

// 觸控偵測:粗指標 / touch 事件 / 觸點數,任一為真即視為觸控裝置。
// 偏寬鬆沒關係——橫向提示層只在「直向」才出現,桌機/筆電永遠非直向,不會誤觸發。
function detectTouch() {
  return (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches)
    || ('ontouchstart' in window)
    || (navigator.maxTouchPoints > 0);
}

let gateEl = null;
export function initTouch() {
  touch = detectTouch();
  if (!touch) return;                       // 桌機/筆電:整層不啟用
  touchInput.enabled = true;                // 讓 v2-combat 切到「移動=面向」的觸控輸入模式
  buildRotateGate();
  buildJoystick();                          // Phase B:左半螢幕浮動搖桿
  buildButtons();                           // Phase C:右下 3 顆動作按鈕
  buildReport();                            // 結算畫面:再戰 / 複製(觸控保底出口)
  window.addEventListener('resize', syncOrientation);
  if (window.screen && screen.orientation && typeof screen.orientation.addEventListener === 'function')
    screen.orientation.addEventListener('change', syncOrientation);
  syncOrientation();
  if (typeof window !== 'undefined') window.__touch = { isTouch, syncOrientation, gate: () => gateEl, joy: () => ({ ...touchInput }), btns: () => ({ punch: btnPunch, context: btnContext, guard: btnGuard, jump: btnJump }), report: () => reportEl }; // headless 健檢
}

// ===== Phase B:浮動虛擬搖桿(左半螢幕,拇指按哪冒哪)→ 類比移動 + 面向 =====
const JOY_R = 58, JOY_DEAD = 0.14;          // 拇指行程半徑(px)/ 死區
let joyZone = null, joyBase = null, joyThumb = null, joyId = null, joyCx = 0, joyCy = 0;
function buildJoystick() {
  joyZone = document.createElement('div');  // 左半透明感應區:攔住左側觸點(順便擋掉相容 mousedown=不會誤揮拳)
  joyZone.id = 'joyZone';
  joyZone.style.cssText = 'position:fixed;left:0;top:0;width:50%;height:100%;z-index:60;touch-action:none;';
  const ring = 'position:fixed;border-radius:50%;pointer-events:none;display:none;';
  joyBase = document.createElement('div');
  joyBase.style.cssText = ring + `width:${JOY_R * 2}px;height:${JOY_R * 2}px;margin:${-JOY_R}px 0 0 ${-JOY_R}px;border:2px solid rgba(159,231,255,.4);background:rgba(10,14,22,.32);z-index:61;`;
  joyThumb = document.createElement('div');
  joyThumb.style.cssText = ring + 'width:52px;height:52px;margin:-26px 0 0 -26px;background:rgba(159,231,255,.5);box-shadow:0 0 12px rgba(19,224,212,.5);z-index:62;';
  document.body.appendChild(joyZone); document.body.appendChild(joyBase); document.body.appendChild(joyThumb);
  joyZone.addEventListener('pointerdown', joyDown);
  window.addEventListener('pointermove', joyMove);
  window.addEventListener('pointerup', joyUp);
  window.addEventListener('pointercancel', joyUp);
}
function joyDown(e) {
  if (joyId !== null) return;                // 已有一指在控搖桿
  joyId = e.pointerId; joyCx = e.clientX; joyCy = e.clientY;
  for (const el of [joyBase, joyThumb]) { el.style.left = joyCx + 'px'; el.style.top = joyCy + 'px'; el.style.display = 'block'; }
  touchInput.active = true; touchInput.x = 0; touchInput.y = 0;
  e.preventDefault();
}
function joyMove(e) {
  if (e.pointerId !== joyId) return;
  const dx = e.clientX - joyCx, dy = e.clientY - joyCy, mag = Math.hypot(dx, dy) || 1;
  const cl = Math.min(mag, JOY_R);           // thumb 視覺夾在 base 內
  joyThumb.style.left = (joyCx + dx / mag * cl) + 'px'; joyThumb.style.top = (joyCy + dy / mag * cl) + 'px';
  let nx = dx / JOY_R, ny = dy / JOY_R; const nm = Math.hypot(nx, ny);   // 類比向量:螢幕軸(上=−y=前),同 readMove 的 sx/sy
  if (nm < JOY_DEAD) { nx = 0; ny = 0; } else { const f = Math.min(nm, 1) / nm; nx *= f; ny *= f; }
  touchInput.x = nx; touchInput.y = ny;
  touchInput.mag = nm < JOY_DEAD ? 0 : Math.min(nm, 1); // 推程 0~1:v2.js 跑步分檔(推一半=走、到底=跑),取代雙擊(手感不順,使用者反饋 2026-07-15)
  e.preventDefault();
}
function joyUp(e) {
  if (e.pointerId !== joyId) return;
  joyId = null; touchInput.active = false; touchInput.x = 0; touchInput.y = 0; touchInput.mag = 0; // 放開:停止移動(facing 已保留,v2-combat 只在有移動時更新)
  joyBase.style.display = 'none'; joyThumb.style.display = 'none';
}

// ===== Phase C:右下 3 顆動作按鈕 → 邊緣觸發現有 mouseLeft/mouseRight/doGuard =====
// 按下只設 touchInput.press.X 閂鎖(v2.js step 消費),不 import sim/glue,避免與 v2.js 的動態 import 成環。
// 尺寸用 vmin 響應式;揮拳最大(主要輸出),抓/技能、格擋次之。字會依情境換(扛人=投擲、可抓=抓/否則技能)。
let btnPunch = null, btnContext = null, btnGuard = null, btnJump = null;
function makeBtn(label, sizeVmin, right, bottom, bg, glow, key) {
  const b = document.createElement('div');
  b.textContent = label;
  b.style.cssText = `position:fixed;right:${right};bottom:${bottom};width:${sizeVmin}vmin;height:${sizeVmin}vmin;`
    + `border-radius:50%;z-index:61;touch-action:none;user-select:none;display:flex;align-items:center;justify-content:center;`
    + `font:700 ${Math.round(sizeVmin * 0.28)}vmin system-ui,sans-serif;color:#eaf6ff;text-align:center;line-height:1.05;`
    + `border:2px solid ${glow};background:${bg};box-shadow:0 0 14px ${glow},inset 0 0 12px rgba(255,255,255,.06);`;
  const press = () => { b.style.transform = 'scale(0.9)'; b.style.filter = 'brightness(1.4)'; };
  const release = () => { b.style.transform = ''; b.style.filter = ''; if (key === 'guard') touchInput.guardHeld = false; }; // 格擋=按住(放開卸防)
  b.addEventListener('pointerdown', (e) => { touchInput.press[key] = true; if (key === 'guard') touchInput.guardHeld = true; press(); e.preventDefault(); e.stopPropagation(); });
  b.addEventListener('pointerup', (e) => { release(); e.preventDefault(); });
  b.addEventListener('pointercancel', release);
  b.addEventListener('pointerleave', release);
  document.body.appendChild(b);
  return b;
}
function buildButtons() {
  // 拇指弧:揮拳(主)最右下、格擋在其左上、抓/技能在其左、跳在抓與格擋之間——都在右手拇指可及區。
  btnPunch   = makeBtn('揮拳', 22, '5vmin',  '7vmin',  'rgba(255,92,84,.30)',  'rgba(255,120,110,.65)', 'punch');
  btnContext = makeBtn('抓',   15, '30vmin', '11vmin', 'rgba(120,190,255,.28)','rgba(140,200,255,.6)',  'context');
  btnGuard   = makeBtn('格擋', 15, '8vmin',  '33vmin', 'rgba(255,214,96,.26)', 'rgba(255,224,120,.6)',  'guard');
  btnJump    = makeBtn('跳',   15, '27vmin', '28vmin', 'rgba(154,255,208,.24)','rgba(154,255,208,.6)',  'jump'); // brawl-2:跳躍(空中按揮拳=下壓)
}

// v2.js 每幀依本機玩家情境呼叫:扛人→「投擲」、可抓→「抓」/否則「技能」。只在文字變動時寫 DOM。
export function syncLabels(punchLabel, contextLabel) {
  if (btnPunch && btnPunch.textContent !== punchLabel) btnPunch.textContent = punchLabel;
  if (btnContext && btnContext.textContent !== contextLabel) btnContext.textContent = contextLabel;
}

// ===== 結算/報告畫面觸控按鈕(matchOver 時顯示)=====
// 桌機靠鍵盤 R 再戰 / C 複製;觸控玩家沒鍵盤 → 打完一局會卡在報告畫面,這兩顆是保底出口。
// 動作直接回呼 v2.js 給的閉包(restartMatch / 複製分享文字)——報告畫面 sim 已凍結,不走 step 輪詢。
let reportEl = null, reportActions = null;
export function setReportActions(a) { reportActions = a; } // v2.js 開機時注入 { rematch, copy }
function buildReport() {
  reportEl = document.createElement('div');
  reportEl.id = 'touchReport';
  reportEl.style.cssText = 'position:fixed;left:0;right:0;bottom:6vmin;z-index:9998;display:none;justify-content:center;align-items:flex-end;gap:5vmin;pointer-events:none;';
  const mk = (label, primary, fn) => {
    const b = document.createElement('div');
    b.textContent = label;
    b.style.cssText = 'pointer-events:auto;touch-action:none;user-select:none;display:flex;align-items:center;justify-content:center;'
      + `min-width:${primary ? 34 : 24}vmin;height:${primary ? 14 : 12}vmin;padding:0 4vmin;border-radius:8vmin;`
      + `font:800 ${primary ? 5.5 : 4.2}vmin system-ui,sans-serif;color:#eaf6ff;text-align:center;`
      + (primary ? 'border:2px solid rgba(140,255,190,.7);background:rgba(40,200,120,.32);box-shadow:0 0 18px rgba(80,255,160,.5);'
                 : 'border:2px solid rgba(159,231,255,.55);background:rgba(30,50,70,.5);box-shadow:0 0 12px rgba(120,200,255,.3);');
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); b.style.filter = 'brightness(1.4)'; if (reportActions) fn(reportActions); });
    const rel = () => { b.style.filter = ''; };
    b.addEventListener('pointerup', rel); b.addEventListener('pointercancel', rel); b.addEventListener('pointerleave', rel);
    return b;
  };
  reportEl.appendChild(mk('再戰', true, a => a.rematch()));
  reportEl.appendChild(mk('複製', false, a => a.copy()));
  document.body.appendChild(reportEl);
}

// v2.js 每幀呼叫:matchOver→亮結算按鈕、收起對戰控制(搖桿/3 顆);回到對戰→反之。
let reportShown = false;
export function setReportVisible(v) {
  if (!touch || reportShown === v) return;
  reportShown = v;
  if (reportEl) reportEl.style.display = v ? 'flex' : 'none';
  const gp = v ? 'none' : '';                 // 結算時收起對戰控制:免誤觸 + 免殘留 latch 在重開第一幀誤發拳
  if (joyZone) joyZone.style.display = gp;
  for (const b of [btnPunch, btnContext, btnGuard, btnJump]) if (b) b.style.display = gp;
  if (v) {
    touchInput.press.punch = touchInput.press.context = touchInput.press.guard = false;
    touchInput.active = false; touchInput.x = 0; touchInput.y = 0; joyId = null;
    if (joyBase) joyBase.style.display = 'none';
    if (joyThumb) joyThumb.style.display = 'none';
  }
}

// 直向提示層(全螢幕蓋住,吃掉 pointer 事件=擋住底下遊戲)
function buildRotateGate() {
  gateEl = document.createElement('div');
  gateEl.id = 'rotateGate';
  gateEl.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:9999', 'display:none',
    'align-items:center', 'justify-content:center', 'flex-direction:column', 'gap:18px',
    'background:#0a0c14', 'color:#9fe7ff', 'font:600 18px system-ui,sans-serif',
    'text-align:center', 'padding:24px', 'touch-action:none', 'user-select:none',
  ].join(';');
  gateEl.innerHTML =
    '<div style="font-size:54px;animation:rg-spin 1.7s ease-in-out infinite">📱</div>' +
    '<div>請將手機轉為橫向<br>' +
    '<span style="font-size:13px;color:#5a7a92;letter-spacing:.5px">Rotate your device to landscape</span></div>' +
    '<style>@keyframes rg-spin{0%,100%{transform:rotate(-14deg)}50%{transform:rotate(76deg)}}</style>';
  document.body.appendChild(gateEl);
}

function isPortrait() {
  if (typeof window.matchMedia === 'function') return window.matchMedia('(orientation: portrait)').matches;
  return window.innerHeight > window.innerWidth;
}
function syncOrientation() {
  if (!gateEl) return;
  const portrait = isPortrait();
  gateEl.style.display = portrait ? 'flex' : 'none';
  if (!portrait) {                          // 橫向:best-effort 鎖定(僅全螢幕有效,失敗無妨,提示層才是保底)
    try {
      if (screen.orientation && typeof screen.orientation.lock === 'function')
        screen.orientation.lock('landscape').catch(() => {});
    } catch (_) { /* 不支援就算了 */ }
  }
}
