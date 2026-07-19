// v2 的 2D HUD 繪製 (docs/v2-module-boundaries.md §3):持有 #hud 畫布的 2D context,
// 每幀由 v2.js 的 frame() 呼叫 drawHud()。只讀狀態(v2-state)不寫玩法狀態;
// 3D 世界點 → 螢幕座標用 render.js 的 project()。

import { clamp } from './utils.js';
import { game } from './state.js';
import { project, FX_LOW } from './render.js';
import {
  v2s, fighters, LOCAL, COLORS, NAMES,
  POD, STAB_MAX, CARRY_ESCAPE_NEED, pads, PICKUP_R, groundItems, bottles, GRAB_RANGE, labSwitches, PUNCH_RANGE, ITEM_INFO, GUARD_STAM_MAX,
  INTRO_T, INTRO_GO,
  GARBAGE_NAME, inc, containLog, WIN_TARGET, STAGE_NAME, METHOD_COL, METHOD_ZH,
} from './v2-state.js';

const hud = document.getElementById('hud');
const hctx = hud.getContext('2d');
const VW = hud.width, VH = hud.height; // 視圖尺寸(v2.html 的 16:9 畫布);世界座標一律走 project()

function drawContainHud() {
  // 實驗艙地面光環 + 穩定值小條 + 暈眩冒星 + 搬運掙脫條/交替指示
  const pulse = v2s.lowFlicker ? 0.5 : 0.6 + 0.4 * Math.sin(game.time * 5); // 減閃爍:艙環常亮
  const c = project(POD.x, POD.y, 2), edge = project(POD.x + POD.r, POD.y, 2);
  if (!c.behind) {
    const rad = Math.max(14, Math.abs(edge.x - c.x));
    hctx.save();
    hctx.strokeStyle = `rgba(154,255,208,${0.5 + pulse * 0.3})`;
    hctx.lineWidth = 4; hctx.beginPath(); hctx.ellipse(c.x, c.y, rad, rad * 0.5, 0, 0, Math.PI * 2); hctx.stroke();
    hctx.restore();
  }
  for (const f of fighters) {
    if (f.state !== 'alive') continue;
    // 身分光環:每個角色腳下永遠畫「自身顏色」的環(本機更亮更粗＋朝向箭頭＋「你」),
    // 這樣就算暈眩(黃)/低穩定(橘)把血條變色,誰是你也永遠一眼可辨。
    const gc = project(f.x, f.y, 2), ge = project(f.x + (f.r || 14), f.y, 2);
    if (!gc.behind) {
      const gr = Math.max(10, Math.abs(ge.x - gc.x)), isMe = f.pid === LOCAL;
      hctx.save();
      hctx.strokeStyle = COLORS[f.pid]; hctx.globalAlpha = isMe ? 0.95 : 0.5; hctx.lineWidth = isMe ? 3 : 2;
      hctx.beginPath(); hctx.ellipse(gc.x, gc.y, gr, gr * 0.5, 0, 0, Math.PI * 2); hctx.stroke();
      if (isMe) { // 朝向箭頭(配合滑鼠瞄準,畫在地面橢圓上)＋「你」標
        hctx.globalAlpha = 1;
        const ax = Math.cos(f.facing), ay = Math.sin(f.facing) * 0.5;         // y 壓扁對齊橢圓地面
        const al = Math.hypot(ax, ay) || 1, nx = ax / al, ny = ay / al;        // 單位方向
        const tipX = gc.x + ax * (gr + 15), tipY = gc.y + ay * (gr + 15);      // 箭尖伸出環外
        hctx.beginPath(); hctx.moveTo(gc.x + ax * gr * 0.5, gc.y + ay * gr * 0.5); hctx.lineTo(tipX - nx * 9, tipY - ny * 9); hctx.lineWidth = 4; hctx.stroke(); // 箭桿
        const hw = 8, bx = tipX - nx * 13, by = tipY - ny * 13, px = -ny, py = nx; // 箭頭三角
        hctx.beginPath(); hctx.moveTo(tipX, tipY); hctx.lineTo(bx + px * hw, by + py * hw); hctx.lineTo(bx - px * hw, by - py * hw); hctx.closePath();
        hctx.fillStyle = COLORS[f.pid]; hctx.fill();
        hctx.font = '900 12px system-ui, sans-serif'; hctx.textAlign = 'center';
        hctx.fillText('你', gc.x, gc.y + gr * 0.5 + 13);
      }
      hctx.restore();
    }
    const s = project(f.x, f.y, (f.r || 14) * 2.2 + 16);
    if (s.behind) continue;
    const bw = 30, p = clamp(f.stability / STAB_MAX, 0, 1);
    hctx.textAlign = 'center';
    hctx.fillStyle = 'rgba(0,0,0,.5)'; hctx.fillRect(s.x - bw / 2, s.y, bw, 4);
    // 血條:暈眩=黃、低穩定=橘(危險色,刻意不用紅色以免撞到紅方身分色)、其餘=自身身分色
    hctx.fillStyle = f.stunned ? '#ffd36d' : (f.stability < 30 ? '#ff9a4a' : COLORS[f.pid]); hctx.fillRect(s.x - bw / 2, s.y, bw * p, 4);
    if (f.stunned) { hctx.fillStyle = '#ffd36d'; hctx.font = '900 16px system-ui, sans-serif'; hctx.fillText('★', s.x, s.y - 6); }
    if (f.invuln > 0 && (v2s.lowFlicker || Math.floor(game.time * 12) % 2 === 0)) { // 出艙無敵:閃爍護盾環(減閃爍=常亮)
      const g = project(f.x, f.y, 10);
      if (!g.behind) { hctx.strokeStyle = '#7fe9ff'; hctx.lineWidth = 3; hctx.beginPath(); hctx.arc(g.x, g.y, 22, 0, Math.PI * 2); hctx.stroke(); }
    }
    if (f.carriedBy) { // 掙脫條 + 左右交替指示
      const ep = clamp(f.escape / CARRY_ESCAPE_NEED, 0, 1);
      hctx.fillStyle = 'rgba(0,0,0,.5)'; hctx.fillRect(s.x - bw / 2, s.y - 13, bw, 5);
      hctx.fillStyle = '#9affd0'; hctx.fillRect(s.x - bw / 2, s.y - 13, bw * ep, 5);
      if (f.pid === LOCAL) { hctx.fillStyle = '#fff'; hctx.font = '900 13px system-ui, sans-serif'; hctx.fillText(f.mashSide === 0 ? '◀ A' : 'D ▶', s.x, s.y - 18); }
    }
    // 防禦耐力條(本機玩家):舉防中或耐力未滿時顯示;破防鎖定=紅、正常=藍
    if (f.pid === LOCAL && (f.guarding || f.guardStam < GUARD_STAM_MAX)) {
      const gp = clamp(f.guardStam / GUARD_STAM_MAX, 0, 1), locked = f.guardLock > 0;
      hctx.fillStyle = 'rgba(0,0,0,.5)'; hctx.fillRect(s.x - bw / 2, s.y - 20, bw, 4);
      hctx.fillStyle = locked ? '#ff6b6b' : (f.guarding ? '#7fd0ff' : '#4a7fa0'); hctx.fillRect(s.x - bw / 2, s.y - 20, bw * gp, 4);
    }
    // 格擋推開提示:被打中的短窗內亮起(像掙脫指示),按對=把攻擊方推開(只對本機玩家顯示)
    if (f.pid === LOCAL && f.pushWinT > 0 && f.pushCd <= 0 && !f.stunned && !f.carriedBy) {
      const pk = v2s.lowFlicker ? 0.95 : 0.75 + 0.25 * Math.sin(game.time * 18);
      hctx.fillStyle = `rgba(154,255,208,${pk})`; hctx.font = '900 14px system-ui, sans-serif';
      hctx.fillText('Shift 推開！', s.x, s.y - 18);
    }
  }
}
// 反擊拳改制(brawl-3.1):拿掉大字提示/倒數條/慢動作/灰屏——反擊靠「擋下瞬間 hitstop」的手感抓,讓玩家自己體會。
/* 漫畫打擊爆花(hitfx-1,使用者拍板 2026-07-16 選 GetAmped 風=圖 2):平塗白星+彩色粗描邊,畫「最上層蓋過角色」
   (遮住命中瞬間=腦補補幀更痛);幀階式跳格播放(彈大→定住→縮小,不平滑淡出=漫畫感);顏色=打擊類型。
   重擊帶速度線(往擊退反向甩的錐形線)+第一格全屏白閃;挑飛加全屏邊緣集中線。FX_LOW 留爆花、砍線(便宜的留)。
   sim 推 fx.addBurst → game.bursts,這裡消費;元素爆炸維持既有發光粒子(能量感 vs 拳頭=漫畫感,分工)。 */
const _bc = document.createElement('canvas');  // 爆花離屏畫布(低清降採樣;每次重設 width=清空)
const BURST_Q = 3;                             // 降清倍率:1/3 解析度畫→平滑放大貼回(hitfx-2,使用者反饋:太清晰跟場景不搭)
function drawBursts() {
  for (const b of game.bursts) {
    const s = project(b.x, b.y, 24); if (s.behind) continue;
    const e = project(b.x + b.size, b.y, 24);
    const step = Math.min(2, Math.floor(b.t / (b.life / 3)));          // 3 格幀階(跳格,無補間)
    const R = Math.max(12, Math.abs(e.x - s.x)) * [1.28, 1.0, 0.8][step];
    // 擊退方向(螢幕空間):殘影拖影+速度線都用它
    let kx = 1, ky = 0;
    {
      const p2 = project(b.x + Math.cos(b.streakA) * 40, b.y + Math.sin(b.streakA) * 40, 24);
      const dx = p2.x - s.x, dy = p2.y - s.y, dl = Math.hypot(dx, dy) || 1; kx = dx / dl; ky = dy / dl;
    }
    // --- 星形+速度線先畫進 1/BURST_Q 解析度離屏 → 平滑放大=邊緣鬆軟的「印刷貼圖感」(對齊 3D 場景的柔和) ---
    const M = Math.ceil(R * 2.9);                                      // 半幅(要裝得下速度線)
    const lw = Math.max(8, Math.ceil((M * 2) / BURST_Q));
    _bc.width = lw; _bc.height = lw;                                   // 重設=清空
    const c = _bc.getContext('2d'), k = lw / (M * 2), cx = lw / 2, cy = lw / 2;
    // 速度線(重擊;FX_LOW 砍):往擊退反方向甩 3~6 條錐形線(圖 2 的黃色拖尾;低清後自帶鬆軟)
    if (b.streaks > 0 && !FX_LOW && step < 2) {
      const ux = -kx, uy = -ky;
      c.fillStyle = '#ffe14a';
      for (let i = 0; i < b.streaks; i++) {
        const sp = (i / (b.streaks - 1) - 0.5) * 0.8 + Math.sin(b.seed * 5 + i * 2.7 + step) * 0.14; // 扇形展開±0.4rad(相位吃 step=每格微跳)
        const ca = Math.atan2(uy, ux) + sp;
        const len = R * k * (1.7 + (i % 2) * 0.7), w = R * k * 0.16;
        const tx = cx + Math.cos(ca) * len, ty = cy + Math.sin(ca) * len;
        const px = -Math.sin(ca) * w, py = Math.cos(ca) * w;
        c.beginPath(); c.moveTo(tx, ty); c.lineTo(cx + px, cy + py); c.lineTo(cx - px, cy - py); c.closePath(); c.fill();
      }
    }
    // 爆花本體:不規則星形,兩層=彩色粗描邊+白色實心;頂點相位吃 step=沸騰線(手繪動畫的 boiling,每格重畫微變形)
    c.beginPath();
    const rot = b.seed + step * 0.06;                                  // 每格微轉一點(跳格感)
    for (let i = 0; i < b.pts * 2; i++) {
      const a = rot + (i / (b.pts * 2)) * Math.PI * 2;
      const rr = (i % 2 === 0
        ? R * k * (0.86 + 0.28 * Math.sin(b.seed * 7 + i * 3.7 + step * 2.1))
        : R * k * 0.42 * (1 + 0.12 * Math.sin(step * 3.1 + i * 1.9)));
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr * 0.92; // 輕微壓扁貼視角
      i === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
    }
    c.closePath();
    c.lineWidth = Math.max(1.2, R * k * 0.22); c.lineJoin = 'miter';
    c.strokeStyle = b.col; c.stroke();
    c.fillStyle = '#fffdf5'; c.fill();
    // --- 貼回主畫布:重擊首格先貼 2 節沿擊退方向的殘影(smear frame=低成本動態模糊,不走後處理) ---
    const dst = M * 2;
    if (b.streaks > 0 && step === 0) {
      hctx.globalAlpha = 0.26; hctx.drawImage(_bc, s.x - M + kx * R * 0.55, s.y - M + ky * R * 0.55, dst, dst);
      hctx.globalAlpha = 0.12; hctx.drawImage(_bc, s.x - M + kx * R * 1.15, s.y - M + ky * R * 1.15, dst, dst);
      hctx.globalAlpha = 1;
    }
    hctx.drawImage(_bc, s.x - M, s.y - M, dst, dst);                   // 本體(平滑放大=柔邊)
  }
  // 全屏層:第一格白閃(重擊)+ 邊緣集中線(挑飛;FX_LOW 砍線留閃)
  for (const b of game.bursts) {
    const step = Math.floor(b.t / (b.life / 3));
    if (b.flash > 0 && step === 0) { hctx.fillStyle = `rgba(255,255,255,${b.flash})`; hctx.fillRect(0, 0, VW, VH); }
    if (b.focus && !FX_LOW && step < 2 && !v2s.lowFlicker) {           // 集中線也吃減閃爍旗(光敏無障礙)
      const s = project(b.x, b.y, 24); if (s.behind) continue;
      hctx.strokeStyle = 'rgba(255,250,235,.6)'; hctx.lineWidth = 4; // 亮色集中線(場地是深色工業地板,黑線看不見)
      for (let i = 0; i < 14; i++) {
        const a = b.seed + (i / 14) * Math.PI * 2;
        const ex = s.x + Math.cos(a) * VW, ey = s.y + Math.sin(a) * VW;          // 射向畫面外
        const ix = s.x + Math.cos(a) * VW * 0.32, iy = s.y + Math.sin(a) * VW * 0.32; // 內端留空(中心乾淨)
        hctx.beginPath(); hctx.moveTo(ex, ey); hctx.lineTo(ix, iy); hctx.stroke();
      }
    }
  }
}
// 教練提示線(玩家反饋:「指示要更明顯地告訴我現在該做什麼」):
// 按優先序只顯示一條,大字置中脈動,告訴本機玩家當下最重要的行動。
function nearPickup(f) { // 附近有可撿的補給座道具或地上掉落道具(手動撿提示用;空手才撿得到)
  for (const p of pads) if (p.item && Math.hypot(f.x - p.x, f.y - p.y) < PICKUP_R + f.r + 6) return true;
  for (const g of groundItems) if (Math.hypot(f.x - g.x, f.y - g.y) < PICKUP_R + f.r + 6) return true;
  return false;
}
function nearBottle(f) { // 附近有場上投擲瓶(撿了丟提示用;有裝備也能撿,只要雙手沒扛東西)
  for (const t of bottles) if (t.alive && !t.held && t.z <= 0 && Math.hypot(f.x - t.x, f.y - t.y) < GRAB_RANGE + t.r + 6) return true;
  return false;
}
function nearSwitch(f) { // 附近有未啟動的緊急拉桿(教學提示用;揍它=啟動四角元素站)
  if (v2s.stationsArmed) return false;
  for (const sw of labSwitches) if (Math.hypot(f.x - sw.x, f.y - sw.y) < PUNCH_RANGE + sw.r + 24) return true;
  return false;
}
function drawCoachLine() {
  const me = fighters[LOCAL], o = fighters[1 - LOCAL];
  let msg = null, col = '#ffd36d';
  // 爽鬥動態教學:依玩家實際行為即時切提示——一路引到「打暈→抓→丟進回收口」;待機時永遠給核心目標。
  if (me.carriedBy) { msg = '連打 ◀A D▶ 掙脫！'; col = '#9affd0'; }
  else if (me.carrying) { msg = '拖進中央回收口！或 左鍵拋擲'; col = '#c98cff'; }
  else if (o.state === 'alive' && o.stunned && !o.carriedBy && o.invuln <= 0) { msg = '♻ 對手可回收了！右鍵 / E 抓住 → 拖進回收口'; col = '#9affd0'; }
  else if (me.pushWinT > 0 && me.pushCd <= 0 && !me.stunned) { msg = 'Shift 推開！'; col = '#9affd0'; }
  else if (me.stunned) { msg = '你被打暈了…！'; col = '#ff9a9a'; }
  else if (o.state === 'alive' && !o.stunned && o.stability < STAB_MAX * 0.55) { msg = '⚡ 對手即將可回收！繼續打'; col = '#ffd36d'; } // 快暈了
  else if (o.state === 'alive' && (o.flinchT > 0 || (me.punchFx > 0 && game.time - me.punchFx < 0.7))) { msg = '有效！繼續攻擊讓他失衡'; col = '#ffd36d'; } // 剛命中
  else if (me.carryObj && me.carryObj.kind === 'bottle') { msg = '左鍵把' + (GARBAGE_NAME[me.carryObj.elem] || '瓶子') + '砸向對手！'; col = '#9ee6ff'; }
  else if (!me.item && !me.carryObj && nearPickup(me)) { msg = '右鍵 / E 撿道具'; col = '#9ee6ff'; } // 手動撿(C 案):附近有補給座/掉落道具且空手
  else if (!me.carrying && !me.carryObj && nearBottle(me)) { msg = 'E 撿元素瓶 → 砸人（冰凍／著火／電擊／毒地板）'; col = '#9ee6ff'; }
  else if (nearSwitch(me)) { msg = '⚠ 揍拉桿＝四角元素站開始洩漏（高風險高娛樂）'; col = '#ffab5a'; }
  else { msg = '左鍵三連擊 → 打暈對手 → 抓去中央回收口 ×' + WIN_TARGET; col = '#9ee6ff'; }
  if (!msg) return;
  const pk = v2s.lowFlicker ? 1 : 0.8 + 0.2 * Math.sin(game.time * 10);
  hctx.save();
  hctx.textAlign = 'center'; hctx.font = '900 24px system-ui, sans-serif';
  const w = hctx.measureText(msg).width;
  hctx.fillStyle = 'rgba(8,8,16,.72)';
  const bx = VW / 2 - w / 2 - 16, by = 62;
  hctx.beginPath(); hctx.roundRect ? hctx.roundRect(bx, by, w + 32, 38, 10) : hctx.rect(bx, by, w + 32, 38); hctx.fill();
  hctx.strokeStyle = col; hctx.globalAlpha = 0.7; hctx.lineWidth = 2;
  hctx.beginPath(); hctx.roundRect ? hctx.roundRect(bx, by, w + 32, 38, 10) : hctx.rect(bx, by, w + 32, 38); hctx.stroke();
  hctx.globalAlpha = pk; hctx.fillStyle = col;
  hctx.fillText(msg, VW / 2, by + 27);
  hctx.restore();
}
// 緊急拉桿世界浮標(未啟動時):命名 + 一句功能,讓玩家一眼知道「這是控制四角元素站的總閘」。
function drawSwitchLabels() {
  if (v2s.stationsArmed) return;
  const pulse = v2s.lowFlicker ? 1 : 0.7 + 0.3 * Math.sin(game.time * 4);
  hctx.textAlign = 'center'; hctx.textBaseline = 'alphabetic';
  for (const sw of labSwitches) {
    const s = project(sw.x, sw.y, sw.r * 3 + 18); if (s.behind) continue;
    hctx.font = '900 12px system-ui, sans-serif';
    const t1 = '⚠ 元素站洩漏總閘', w = hctx.measureText(t1).width;
    hctx.fillStyle = 'rgba(20,14,6,.72)'; hctx.beginPath();
    (hctx.roundRect ? hctx.roundRect(s.x - w / 2 - 7, s.y - 15, w + 14, 20, 6) : hctx.rect(s.x - w / 2 - 7, s.y - 15, w + 14, 20)); hctx.fill();
    hctx.globalAlpha = pulse; hctx.fillStyle = '#ff9a4a'; hctx.fillText(t1, s.x, s.y); hctx.globalAlpha = 1;
    hctx.font = '700 10px system-ui, sans-serif'; hctx.fillStyle = 'rgba(255,211,109,.82)'; hctx.fillText('揍它→四角開始洩漏', s.x, s.y + 15);
  }
}
function drawItems() {
  hctx.textAlign = 'center'; hctx.textBaseline = 'alphabetic';
  for (const p of pads) { // 補給座上的道具球 + 名稱
    if (!p.item) continue;
    const s = project(p.x, p.y, 20 + Math.sin(game.time * 3) * 3); if (s.behind) continue;
    hctx.fillStyle = ITEM_INFO[p.item].color; hctx.beginPath(); hctx.arc(s.x, s.y, 9, 0, Math.PI * 2); hctx.fill();
    hctx.strokeStyle = 'rgba(255,255,255,.8)'; hctx.lineWidth = 2; hctx.stroke();
    hctx.fillStyle = '#eafaff'; hctx.font = '700 10px system-ui, sans-serif'; hctx.fillText(ITEM_INFO[p.item].name, s.x, s.y - 14);
  }
  for (const f of fighters) { // 持有道具:頭頂小球
    if (!f.item || f.state !== 'alive') continue;
    const s = project(f.x, f.y, (f.r || 14) * 2.2 + 34); if (s.behind) continue;
    hctx.fillStyle = ITEM_INFO[f.item].color; hctx.beginPath(); hctx.arc(s.x, s.y, 7, 0, Math.PI * 2); hctx.fill();
    hctx.strokeStyle = 'rgba(255,255,255,.8)'; hctx.lineWidth = 1.5; hctx.stroke();
    if (f.itemUses > 1) { hctx.textAlign = 'left'; hctx.font = '800 11px system-ui, sans-serif'; hctx.fillStyle = '#eafaff'; hctx.fillText('×' + f.itemUses, s.x + 10, s.y + 4); } // 多次數:球旁標剩餘
  }
  const me = fighters[LOCAL]; // 本機持有 HUD
  hctx.textAlign = 'left'; hctx.font = '800 14px system-ui, sans-serif';
  if (me.item) { hctx.fillStyle = ITEM_INFO[me.item].color; hctx.fillText('持有：' + ITEM_INFO[me.item].name + ' ×' + me.itemUses + '（右鍵 / E 使用）', 24, VH - 40); }
  else { hctx.fillStyle = 'rgba(234,250,255,.45)'; hctx.fillText('持有：無（走到補給座撿）', 24, VH - 40); }
}
function drawPips(pid, x0, dir) { // 三格收容進度:填色=收容方式
  const size = 22, gap = 6, y0 = 26;
  const mine = containLog.filter(c => c.winner === pid);
  for (let i = 0; i < WIN_TARGET; i++) {
    const px = dir === 1 ? x0 + i * (size + gap) : x0 - size - i * (size + gap);
    hctx.fillStyle = mine[i] ? (METHOD_COL[mine[i].method] || COLORS[pid]) : 'rgba(255,255,255,.12)';
    hctx.fillRect(px, y0, size, size);
    hctx.strokeStyle = COLORS[pid]; hctx.lineWidth = 2; hctx.strokeRect(px + 1, y0 + 1, size - 2, size - 2);
  }
}
// 事故報告結算(分享引擎;規格 E 北極星「輸了也好笑」——分家後 A 款的招牌收尾,docs/game-split.md)
const LEVEL_COL = { 'S+': '#ff5ce0', S: '#ff7b72', A: '#ffb14a', B: '#ffd36d', C: '#9fe7ff', D: '#bcd', E: '#9aa' };
function drawReport() {
  const r = v2s.report;
  hctx.fillStyle = 'rgba(8,10,16,.62)'; hctx.fillRect(0, 0, VW, VH); // dim the frozen world
  const pw = 640, ph = 446, px = (VW - pw) / 2, py = (VH - ph) / 2;
  hctx.fillStyle = 'rgba(20,24,34,.97)'; hctx.fillRect(px, py, pw, ph);
  hctx.strokeStyle = 'rgba(255,211,109,.5)'; hctx.lineWidth = 2; hctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
  let y = py + 40; const cx = VW / 2;
  hctx.textAlign = 'center';
  hctx.font = '900 24px system-ui, sans-serif'; hctx.fillStyle = '#eafaff';
  hctx.fillText('魔法事故報告 #' + r.num, cx, y); y += 40;
  // level badge
  hctx.font = '900 52px system-ui, sans-serif'; hctx.fillStyle = LEVEL_COL[r.level] || '#fff';
  hctx.fillText(r.level + ' 級', cx, y + 6); y += 50;
  hctx.font = '800 22px system-ui, sans-serif'; hctx.fillStyle = '#ffd36d';
  hctx.fillText(r.name, cx, y); y += 36;
  hctx.font = '600 15px system-ui, sans-serif'; hctx.fillStyle = '#cfe0f0';
  hctx.fillText(r.summary, cx, y); y += 34;
  // stats line
  hctx.font = '700 14px system-ui, sans-serif'; hctx.fillStyle = '#9fb6cd';
  hctx.fillText(`勝者：${NAMES[r.winner]}　損害 ${r.damage}%　搬 ${inc.carries[0] + inc.carries[1]}·拋 ${inc.throwContains}·吹 ${inc.accidentContains.wind}·滑 ${inc.accidentContains.ice}·爆 ${inc.accidentContains.barrel}　反向 ${inc.reverseContains}　自傷 ${inc.itemBackfires}　主要道具 ${r.mostUsed}　${r.time.toFixed(0)}s`, cx, y); y += 30;
  if (containLog.length) { // 三幕封存序列
    hctx.font = '800 15px system-ui, sans-serif'; hctx.fillStyle = '#cfe0f0';
    hctx.fillText('封存序列：' + containLog.map(c => NAMES[c.winner][0] + '·' + (METHOD_ZH[c.method] || c.method)).join('　→　'), cx, y); y += 30;
  }
  hctx.font = '800 16px system-ui, sans-serif'; hctx.fillStyle = COLORS[r.winner];
  hctx.fillText('稱號：' + r.title, cx, y); y += 34;
  // committee comment (the share juice)
  hctx.font = 'italic 700 17px system-ui, sans-serif'; hctx.fillStyle = '#9affd0';
  hctx.fillText('「' + r.comment + '」', cx, y); y += 28;
  hctx.font = '600 12px ui-monospace, monospace'; hctx.fillStyle = '#8a7d96';
  hctx.fillText('挑戰碼 ' + r.code, cx, y); y += 30;
  hctx.font = '800 15px system-ui, sans-serif'; hctx.fillStyle = '#eafaff';
  hctx.fillText('按 R 再來一場　·　按 C 複製分享文字', cx, py + ph - 18);
}
// 風壓爆風:發射中從兩側邊緣往內掃的速度線(爆風 whoosh;強度=windFan 剩餘壽命)
function drawWindSpeedLines() {
  let k = 0; for (const w of game.windFans) k = Math.max(k, w.life / w.maxLife);
  if (k <= 0.02) return;
  hctx.save(); hctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 12; i++) {
    const edge = Math.random() < 0.5, y = Math.random() * VH, x0 = edge ? 0 : VW, dir = edge ? 1 : -1;
    const len = (70 + Math.random() * 170) * k;
    hctx.strokeStyle = `rgba(223,243,255,${(0.10 + Math.random() * 0.16) * k})`; hctx.lineWidth = 1 + Math.random() * 2.2;
    hctx.beginPath(); hctx.moveTo(x0, y); hctx.lineTo(x0 + dir * len, y + (Math.random() - 0.5) * 22); hctx.stroke();
  }
  hctx.restore();
}
/* 開場目標字幕(使用者上手文檔:進場一頭霧水的頭號解法=一進場就把「怎麼贏」講清楚)。
   大字置中,最後 0.7s 淡出;鏡頭同時由 updateCamRig 帶場到對手再回玩家(看得到對手)。 */
function drawIntro() {
  if (v2s.introT <= 0) return;
  hctx.save(); hctx.textAlign = 'center';
  const cx = VW / 2, cy = VH * 0.32;
  if (v2s.introT > INTRO_GO) {              // 就位期:老闆訓話+目標字幕(按任何鍵直接開始)
    hctx.fillStyle = 'rgba(6,12,18,.66)'; hctx.fillRect(0, cy - 76, VW, 132);
    hctx.font = '900 20px system-ui, sans-serif'; hctx.fillStyle = '#ffd36d';
    hctx.fillText('🧑‍💼 主管：都給我好好工作！', cx, cy - 46); // 老闆開場監督(世界觀留=喜劇土壤;開始後就消失)
    hctx.font = '900 34px system-ui, sans-serif'; hctx.lineWidth = 6; hctx.strokeStyle = 'rgba(6,12,18,.85)';
    hctx.strokeText('把對手丟進中央回收口 ×' + WIN_TARGET + '　就贏', cx, cy);
    hctx.fillStyle = '#9affd0'; hctx.fillText('把對手丟進中央回收口 ×' + WIN_TARGET + '　就贏', cx, cy);
    hctx.font = '800 17px system-ui, sans-serif'; hctx.fillStyle = 'rgba(200,235,255,.92)';
    hctx.fillText('打暈 → 抓起 → 丟進去 · 元素瓶／爆桶／冰面 都能幫你收容他', cx, cy + 30);
    hctx.font = '700 13px system-ui, sans-serif'; hctx.fillStyle = 'rgba(200,235,255,.55)';
    hctx.fillText('按任意鍵開始', cx, cy + 52);
  } else {                                   // 「開始!」:AI 從這一刻開工(到處回收垃圾=活教學),字放大彈出+淡出
    const k = 1 - v2s.introT / INTRO_GO;     // 0→1
    const a = Math.min(1, v2s.introT / 0.35), pop = 1 + 0.25 * Math.max(0, 1 - k * 5); // 前 20% 彈一下
    hctx.globalAlpha = a;
    hctx.font = `900 ${Math.round(64 * pop)}px system-ui, sans-serif`;
    hctx.lineWidth = 8; hctx.strokeStyle = 'rgba(6,12,18,.9)';
    hctx.strokeText('開始！', cx, VH * 0.38);
    hctx.fillStyle = '#ffe97a'; hctx.fillText('開始！', cx, VH * 0.38);
  }
  hctx.restore();
}
/* 收容演出:艙口 LED 飄字(使用者拍板:輕量融景,像招牌 LED,不做側邊終端面板)。
   文字由 sim 排好(v2s.perform.line);這裡只管 LED 樣式:深底描邊膠囊 + 青字(失控段轉橘紅)+ 掃描期微閃。 */
function drawPerformLED() {
  const p = v2s.perform; if (!p) return;
  const c = project(POD.x, POD.y, 82); if (c.behind) return;
  hctx.font = '700 15px ui-monospace, SFMono-Regular, Consolas, monospace'; hctx.textAlign = 'center'; hctx.textBaseline = 'middle';
  const w = hctx.measureText(p.line).width + 28, h = 24;
  const warn = (p.n || 1) >= 2 && (p.phase === 'classify' || p.phase === 'resolve'); // 失控/清運段 → 警示色
  hctx.fillStyle = 'rgba(8,18,22,.78)'; hctx.fillRect(c.x - w / 2, c.y - h / 2, w, h);
  hctx.strokeStyle = warn ? 'rgba(255,110,80,.8)' : 'rgba(90,230,255,.55)'; hctx.lineWidth = 1;
  hctx.strokeRect(c.x - w / 2 + 0.5, c.y - h / 2 + 0.5, w - 1, h - 1);
  const blink = (!v2s.lowFlicker && p.phase === 'scan' && Math.floor(p.pk * 10) % 2 === 0) ? 0.72 : 1; // 掃描期微閃(減閃爍=常亮)
  hctx.fillStyle = warn ? `rgba(255,150,90,${blink})` : `rgba(140,235,255,${blink})`;
  hctx.fillText(p.line, c.x, c.y + 1);
  hctx.font = '700 10px ui-monospace, monospace'; hctx.fillStyle = 'rgba(160,220,235,.55)';
  hctx.fillText('MAGIC WASTE INTAKE · ' + ['SCAN', 'SORT', 'SEAL'][(p.n || 1) - 1], c.x, c.y + h / 2 + 11);
  hctx.textBaseline = 'alphabetic';
}

export function drawHud() {
  hctx.clearRect(0, 0, VW, VH);
  drawWindSpeedLines();
  // red edge pulse when YOU get knocked — so a hit is never invisible
  if (v2s.localFlash > 0) {
    const g = hctx.createRadialGradient(VW / 2, VH / 2, VH * 0.3, VW / 2, VH / 2, VH * 0.75);
    g.addColorStop(0, 'rgba(255,60,60,0)'); g.addColorStop(1, `rgba(255,40,40,${Math.min(0.5, v2s.localFlash * 1.6)})`);
    hctx.fillStyle = g; hctx.fillRect(0, 0, VW, VH);
  }
  hctx.textAlign = 'center'; hctx.textBaseline = 'alphabetic';
  // why you fell (diagnostic + feedback, isles)
  if (v2s.fallReasonT > 0) { hctx.font = '900 30px system-ui, sans-serif'; hctx.fillStyle = '#ff9a9a'; hctx.fillText(v2s.fallReason, VW / 2, VH / 2 - 40); }
  // title
  hctx.font = '900 18px system-ui, sans-serif';
  hctx.fillStyle = '#eafaff';
  hctx.fillText('魔法事故報告 · 收容測試　階段 ' + v2s.stage + '：' + STAGE_NAME[v2s.stage - 1] + '　封存 ' + WIN_TARGET + ' 次獲勝', VW / 2, 28);
  // AI 狀態(練習模式)— 永遠可見,B 切換
  const aiOn = fighters[1 - LOCAL].ai;
  hctx.font = '800 13px system-ui, sans-serif';
  hctx.fillStyle = aiOn ? 'rgba(255,140,140,.92)' : 'rgba(154,255,208,.96)';
  hctx.fillText(aiOn ? '紅方：AI 同事　（按 B 關掉，練手感）' : '紅方：練習假人　（按 B 開 AI）', VW / 2, 48);
  // 三格收容進度(每格填色=收容方式)= 勝利進度
  drawPips(0, 24, 1); drawPips(1, VW - 24, -1);
  drawContainHud();
  drawItems();
  drawBursts(); // 漫畫打擊爆花:最上層蓋過角色/血條(hitfx-1;白閃/集中線也在這層)
  drawSwitchLabels();
  if (v2s.introT <= INTRO_GO) drawCoachLine(); // 就位期讓位給開場字幕(反擊提示已移除=玩家自己體會)
  // stage / seal banner
  if (v2s.winBannerT > 0 && v2s.bannerText) {
    hctx.textAlign = 'center'; hctx.font = '900 40px system-ui, sans-serif';
    hctx.fillStyle = COLORS[v2s.winnerPid] || '#eafaff'; hctx.fillText(v2s.bannerText, VW / 2, VH / 2 - 30);
  }
  drawPerformLED(); // 收容演出 LED 飄字(艙口上方;matchOver 前跑,照畫)
  drawIntro(); // 開場字幕:就位期=老闆訓話+目標 → 尾段=「開始!」
  // controls hint
  hctx.textAlign = 'center'; hctx.font = '700 13px system-ui, sans-serif';
  hctx.fillStyle = 'rgba(234,250,255,.7)';
  hctx.fillText('藍（你）：WASD 移動（＝跑）· 左鍵三連擊（跑久＝衝刺拳／空中＝下壓拳）· 空白＝跳 · Shift 按住＝防禦 · 右鍵＝抓／放技能 · E＝撿（裝備·瓶·桶）／抓 · 扛著左鍵＝丟　B：AI　L：減閃爍', VW / 2, VH - 18);
  if (v2s.matchOver && v2s.report) drawReport(); // 結算:事故報告全屏卡(分享引擎)
  // build tag — bump on each gameplay change so you can confirm a fresh deploy loaded (hard-refresh if it's old)
  hctx.textAlign = 'right'; hctx.font = '700 11px ui-monospace, monospace'; hctx.fillStyle = 'rgba(234,250,255,.5)';
  hctx.fillText('build: decor-1', VW - 10, VH - 4);
}
