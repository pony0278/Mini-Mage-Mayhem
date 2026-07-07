// v2-touch.js — 手機觸控控制層(完整規劃見 docs/mobile-touch.md)。
// Phase A:觸控偵測 + 橫向提示層(直向蓋「請轉橫」)。
// 桌機/筆電零影響(偵測不到觸控就整層不啟用;而且桌機永遠不會是直向)。
// 純 UI/輸入層,不 import sim。之後 Phase B/C 在這裡加浮動搖桿 + 3 顆動作按鈕。

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
  buildRotateGate();
  window.addEventListener('resize', syncOrientation);
  if (window.screen && screen.orientation && typeof screen.orientation.addEventListener === 'function')
    screen.orientation.addEventListener('change', syncOrientation);
  syncOrientation();
  if (typeof window !== 'undefined') window.__touch = { isTouch, syncOrientation, gate: () => gateEl }; // headless 健檢
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
