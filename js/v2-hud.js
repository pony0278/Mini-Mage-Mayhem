// v2 的 2D HUD 繪製 (docs/v2-module-boundaries.md §3):持有 #hud 畫布的 2D context,
// 每幀由 v2.js 的 frame() 呼叫 drawHud()。只讀狀態(v2-state)不寫玩法狀態;
// 3D 世界點 → 螢幕座標用 render.js 的 project()。

import { clamp } from './utils.js';
import { game, touchInput } from './state.js';
import { project, FX_LOW, getPortrait, MARK_MODE } from './render.js';
import {
  v2s, fighters, LOCAL, COLORS, NAMES,
  POD, STAB_MAX, CARRY_ESCAPE_NEED, pads, PICKUP_R, groundItems, bottles, GRAB_RANGE, labSwitches, PUNCH_RANGE, ITEM_INFO, GUARD_STAM_MAX,
  INTRO_T, INTRO_GO,
  GARBAGE_NAME, inc, containLog, WIN_TARGET, STAGE_NAME, METHOD_COL, roundWins, FATIGUE, CAMP_LEVELS,
} from './v2-state.js';

const hud = document.getElementById('hud');
const hctx = hud.getContext('2d');
const VW = hud.width, VH = hud.height; // 視圖尺寸(v2.html 的 16:9 畫布);世界座標一律走 project()

/* ui-1(使用者反饋 2026-08-03:「角色底下的圈圈似乎會透視人物,能不能改到頭頂一個箭頭就好」)——
   **身分+面向合併成一個頭頂浮標**。舊版是腳下橢圓環(+地面朝向箭頭+「你」字):HUD 是 2D 疊層、
   **沒有深度測試**,所以環一定會壓在角色腿上=看起來「透視」;移到頭頂就沒有東西會被它蓋到。
   一個箭頭同時扛兩件事:①**指向 facing**(面向=移動方向,也是道具瞄準方向,不能拿掉)
   ②**顏色/大小=身分**(本機大而實心+白邊、對手小而半透明)——暈眩(黃)/低穩定(橘)把血條變色時
   仍一眼分得出誰是你(舊環的設計目的,這裡保住)。首局(教學)才多一個「你」字,之後靠顏色。 */
const HEAD_MK = { h: 30, lift: 14, bob: 2.4, bobRate: 3.2, me: 15, foe: 11 }; // 頭頂高/浮空距/呼吸幅度/大小(遠鏡頭 dist 630 下要夠大才讀得到)

/* ui-3(使用者反饋 2026-08-03,附百變恰吉截圖:「在玩家操作的角色上面標註倒三角代表正在操作的人物,
   我覺得更好,比起包裹人物輪廓」)——**預設標記=頭頂倒三角,而且只給本機**。
   三件事跟著改,都是照參考做法走:
   ① **形狀**:純倒三角(尖端朝下指著角色),不再是指向 facing 的風箏箭頭。
   ② **只標一個**:對手不給標(舊版對手有半透明小箭頭)。1v1 下「只有一個人頭上有標」本身
      就是最乾淨的身分訊號,不用比大小/透明度;畫面也少一個東西在動。
   ③ **面向承諾的補償**:facing 被形狀拿掉了,但**持道具時**面向仍決定整發打去哪(按下當刻鎖方向),
      所以拿著道具才在三角上方補一個小箭頭 = 平時乾淨、要瞄準時才有資訊(同 `?mark=outline` 的取捨)。
   A/B 都留著:`?mark=arrow`=ui-1 的風箏箭頭(雙方都標)、`?mark=outline`=ui-2 反殼描邊、`?mark=none`=全關。 */
const TRI = { w: 18, h: 16, lift: 23, bob: 2.4, bobRate: 3.2, aimS: 8, aimGap: 15 };

function drawHeadMarker(f) {
  const isMe = f.pid === LOCAL;
  // 模式閘:tri(預設)=只標本機;outline=身分交給角色身上的描邊,只在持道具時留小瞄準箭頭;none=全關。
  if (MARK_MODE === 'none') return;
  const itemAim = MARK_MODE === 'outline';
  if (itemAim && !(isMe && f.item)) return;
  const tri = MARK_MODE === 'tri';
  if (tri && !isMe) return;                                    // ui-3:對手不標(見上)
  const head = project(f.x, f.y, (f.r || 14) * 2.2 + HEAD_MK.h);
  if (head.behind) return;
  // 面向:投影一個「前方點」取螢幕方向(不能直接用 facing 的 sin/cos——45° 鏡頭下螢幕 y 是壓扁的)
  const ah = project(f.x + Math.cos(f.facing) * 40, f.y + Math.sin(f.facing) * 40, (f.r || 14) * 2.2 + HEAD_MK.h);
  let dx = ah.x - head.x, dy = ah.y - head.y;
  const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
  const MK = tri ? TRI : HEAD_MK;
  const bob = v2s.lowFlicker ? 0 : Math.sin(game.time * MK.bobRate + f.pid * 2.1) * MK.bob;
  const cx = head.x, cy = head.y - MK.lift + bob;
  const S = tri ? TRI.h : (isMe ? HEAD_MK.me : HEAD_MK.foe) * (itemAim ? 0.72 : 1); // outline 模式的瞄準箭頭再縮一號
  // 面向風箏箭頭(ui-1 形狀):tri 模式只在持道具時當「瞄準 pip」畫在三角上方
  const kite = (kx, ky, k) => {
    const px = -dy, py = dx;                                   // 螢幕空間法向
    hctx.beginPath();
    hctx.moveTo(kx + dx * k * 1.15, ky + dy * k * 1.15);       // 箭尖(朝面向)
    hctx.lineTo(kx - dx * k * 0.75 + px * k * 0.85, ky - dy * k * 0.75 + py * k * 0.85);
    hctx.lineTo(kx - dx * k * 0.25, ky - dy * k * 0.25);       // 尾端內凹=風箏形(比純三角好認方向)
    hctx.lineTo(kx - dx * k * 0.75 - px * k * 0.85, ky - dy * k * 0.75 - py * k * 0.85);
    hctx.closePath();
  };
  hctx.save();
  if (tri) {
    // 倒三角:尖端朝下指著角色。深色描邊 + 白邊兩層——地板明暗都有(木地板/暗磚),單一邊色會有一邊糊掉。
    const w = TRI.w, h = TRI.h;
    hctx.beginPath();
    hctx.moveTo(cx - w / 2, cy - h / 2); hctx.lineTo(cx + w / 2, cy - h / 2); hctx.lineTo(cx, cy + h / 2); hctx.closePath();
    hctx.lineJoin = 'round';
    hctx.strokeStyle = 'rgba(0,0,0,.55)'; hctx.lineWidth = 6; hctx.stroke();   // 外圈暗邊=亮地板上的對比
    hctx.fillStyle = COLORS[f.pid]; hctx.fill();
    hctx.strokeStyle = 'rgba(255,255,255,.95)'; hctx.lineWidth = 2.2; hctx.stroke();
    if (f.item) {                                              // 持道具=面向決定打去哪 → 補瞄準箭頭
      hctx.globalAlpha = 0.9;
      kite(cx, cy - TRI.aimGap, TRI.aimS);
      hctx.fillStyle = COLORS[f.pid]; hctx.fill();
      hctx.strokeStyle = 'rgba(0,0,0,.5)'; hctx.lineWidth = 2; hctx.stroke();
      hctx.globalAlpha = 1;
    }
  } else {
    kite(cx, cy, S);
    hctx.globalAlpha = isMe ? 1 : 0.62;
    hctx.fillStyle = COLORS[f.pid]; hctx.fill();
    hctx.strokeStyle = isMe ? 'rgba(255,255,255,.95)' : 'rgba(0,0,0,.5)'; // 本機=白邊(暗地板上也跳出來)
    hctx.lineWidth = isMe ? 2.5 : 2; hctx.lineJoin = 'round'; hctx.stroke();
  }
  if (typeof window !== 'undefined') {                         // 測試 hook:標記螢幕位置/朝向 + 腳下位置(驗「不在腳下」)
    const foot = project(f.x, f.y, 2);
    (window.__hudmk || (window.__hudmk = {}))[f.pid] = { x: Math.round(cx), y: Math.round(cy), dx: +dx.toFixed(2), dy: +dy.toFixed(2), s: S, kind: tri ? 'tri' : 'arrow', aim: !!(tri && f.item), footY: Math.round(foot.y), footX: Math.round(foot.x) };
  }
  if (isMe && v2s.tutorial) {                                  // 首局才標字,之後靠顏色/大小
    hctx.globalAlpha = 1; hctx.textAlign = 'center';
    hctx.font = '900 11px system-ui, sans-serif'; hctx.fillStyle = COLORS[f.pid];
    hctx.strokeStyle = 'rgba(0,0,0,.7)'; hctx.lineWidth = 3;
    const ty = cy - S - (tri && f.item ? TRI.aimGap + 2 : 4);
    hctx.strokeText('你', cx, ty); hctx.fillText('你', cx, ty);
  }
  hctx.restore();
}
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
    drawHeadMarker(f);   // ui-1:身分+面向=頭頂浮標(腳下光環退役,見函式註解)
    const s = project(f.x, f.y, (f.r || 14) * 2.2 + 16);
    if (s.behind) continue;
    const bw = 30;
    hctx.textAlign = 'center';
    // 穩定條/防禦耐力條已移到下方卡片(hud-1,使用者拍板 2026-07-27:身上不放數值條);
    // 留在身上的=動作提示/空間狀態:暈眩★、無敵盾環、掙脫條+交替鍵、Shift 推開窗(移走必漏看)。
    // ★ 只在暈眩期(shock-2):定格觸電期讓電弧演出說話,兩段分明——「電完了才是暈」
    if (f.stunned && !((f.shockT || 0) > game.time) && !f._burnCh) { hctx.fillStyle = '#ffd36d'; hctx.font = '900 16px system-ui, sans-serif'; hctx.fillText('★', s.x, s.y - 6); }
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
  if (v2s.letterK > 0.3) return;   // 終演/封存=過場,壓掉教練線(規格 G §4.3)
  const me = fighters[LOCAL], o = fighters[1 - LOCAL];
  let msg = null, col = '#ffd36d';
  // 爽鬥動態教學:依玩家實際行為即時切提示——一路引到「打暈→抓→丟進回收口」;待機時永遠給核心目標。
  if (me.carriedBy) { msg = '連打 ◀A D▶ 掙脫！'; col = '#9affd0'; }
  else if (me.carrying) { msg = '拖進中央回收口！或 C 拋擲'; col = '#c98cff'; }
  else if (o.state === 'alive' && o.stunned && !o.carriedBy && o.invuln <= 0) { msg = '♻ 對手可回收了！X 抓住 → 拖進回收口'; col = '#9affd0'; }
  else if (me.pushWinT > 0 && me.pushCd <= 0 && !me.stunned) { msg = 'Shift 推開！'; col = '#9affd0'; }
  else if (me.stunned) { msg = '你被打暈了…！'; col = '#ff9a9a'; }
  else if (o.state === 'alive' && !o.stunned && o.stability < STAB_MAX * 0.55) { msg = '⚡ 對手即將可回收！繼續打'; col = '#ffd36d'; } // 快暈了
  else if (o.state === 'alive' && (o.flinchT > 0 || (me.punchFx > 0 && game.time - me.punchFx < 0.7))) { msg = '有效！繼續攻擊讓他失衡'; col = '#ffd36d'; } // 剛命中
  else if (me.carryObj && me.carryObj.kind === 'bottle') { msg = 'C 把' + (GARBAGE_NAME[me.carryObj.elem] || '瓶子') + '砸向對手！'; col = '#9ee6ff'; }
  else if (!me.item && !me.carryObj && nearPickup(me)) { msg = 'X 撿道具'; col = '#9ee6ff'; } // 手動撿(C 案):附近有補給座/掉落道具且空手
  else if (!me.carrying && !me.carryObj && nearBottle(me)) { msg = 'E 撿元素瓶 → 砸人（冰凍／著火／電擊／毒地板）'; col = '#9ee6ff'; }
  else if (nearSwitch(me)) { msg = '⚠ 揍拉桿＝四角元素站開始洩漏（高風險高娛樂）'; col = '#ffab5a'; }
  else if (roundWins[0] >= WIN_TARGET) { msg = '⚠ 收容指令!打暈他 → 按 X 收容'; col = '#ffd36d'; }   // 規格 G 賽末點
  else { msg = 'C 三連擊 → 記錄對手 ' + WIN_TARGET + ' 次事故（打暈／打下場）'; col = '#9ee6ff'; }
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
}
// 「持有:」文字列已併入下方卡片(hud-1);補給座球/頭頂小球=空間資訊,留在世界裡。
const _pipAt = [[], []];                        // flow-2:每幀記下三格的螢幕位置(立案 beat 的印章卡要飛進去)
function drawPips(pid, x0, y0, size, gap, dir) { // 三格收容進度:填色=收容方式(hud-1 併入下方卡片)
  const mine = containLog.filter(c => c.winner === pid);
  const C = v2s.recordCard, landing = C && C.w === pid && C.t > C.T * 0.72; // 卡飛到=該格亮一下
  const brinkI = mine.length === WIN_TARGET - 1 ? mine.length : -1;         // flow-2c:只差一筆 → 下一格慢速脈動
  for (let i = 0; i < WIN_TARGET; i++) {
    const px = dir === 1 ? x0 + i * (size + gap) : x0 - size - i * (size + gap);
    _pipAt[pid][i] = { x: px + size / 2, y: y0 + size / 2 };
    hctx.fillStyle = mine[i] ? (METHOD_COL[mine[i].method] || COLORS[pid]) : 'rgba(255,255,255,.12)';
    hctx.fillRect(px, y0, size, size);
    if (i === brinkI && !v2s.lowFlicker) {                                  // 慢脈動(不閃爍:光敏無障礙照 lowFlicker 關掉)
      const q = 0.16 + 0.30 * (0.5 - 0.5 * Math.cos(game.time * FATIGUE.brink.pulse));
      hctx.fillStyle = 'rgba(255,211,109,' + q.toFixed(3) + ')'; hctx.fillRect(px, y0, size, size);
    }
    if (landing && i === C.n - 1) {               // 落格白閃(蓋在填色上,隨 beat 尾段淡出)
      const q = 1 - clamp((C.t - C.T * 0.72) / (C.T * 0.28), 0, 1);
      hctx.fillStyle = 'rgba(255,255,255,' + (0.85 * q).toFixed(3) + ')'; hctx.fillRect(px, y0, size, size);
      hctx.strokeStyle = '#ffd36d'; hctx.lineWidth = 2.5; hctx.strokeRect(px - 2, y0 - 2, size + 4, size + 4);
    }
    hctx.strokeStyle = COLORS[pid]; hctx.lineWidth = 1.5; hctx.strokeRect(px + 0.5, y0 + 0.5, size - 1, size - 1);
  }
}
/* ==== 下方狀態卡(hud-1,使用者拍板 2026-07-27):身上數值條全部集中到畫面下方——
   頭像(GLB 真臉快照,render-portrait)+ YOU 標(玩家卡;避免不知道看哪張)+ 名字 +
   穩定條 + 防禦耐力條 + 收容進度三格 + 持有道具。左=玩家(藍)、右=對手(紅,鏡像佈局)。
   **手機錨在上方兩角**:下方被虛擬搖桿(左)+四鈕(右)佔用,放下面會疊住(touchInput.enabled 判斷)。
   留在身上的=動作提示/空間狀態(掙脫條+交替鍵/Shift 推開窗/暈眩★/無敵盾環),移走必漏看。 */
const CW = 252, CH = 64, PSZ = 52;
function drawCard(f, x, y, dir) {
  const pid = f.pid, isMe = pid === LOCAL;
  hctx.fillStyle = 'rgba(10,14,22,.74)'; hctx.fillRect(x, y, CW, CH);
  hctx.strokeStyle = COLORS[pid]; hctx.lineWidth = 2; hctx.strokeRect(x + 1, y + 1, CW - 2, CH - 2);
  // 頭像(快照未好=佔位框;暈眩=壓暗+★)
  const px = dir === 1 ? x + 6 : x + CW - 6 - PSZ, py = y + 6;
  const port = getPortrait(f, COLORS[pid]);
  hctx.fillStyle = '#0c1018'; hctx.fillRect(px, py, PSZ, PSZ);
  if (port) hctx.drawImage(port.canvas, px, py, PSZ, PSZ);
  if (f.stunned) {
    hctx.fillStyle = 'rgba(0,0,0,.55)'; hctx.fillRect(px, py, PSZ, PSZ);
    hctx.fillStyle = '#ffd36d'; hctx.font = '900 22px system-ui, sans-serif'; hctx.textAlign = 'center';
    hctx.fillText('★', px + PSZ / 2, py + PSZ / 2 + 8);
  }
  hctx.strokeStyle = COLORS[pid]; hctx.lineWidth = 1.5; hctx.strokeRect(px + 0.5, py + 0.5, PSZ - 1, PSZ - 1);
  if (isMe) {                                       // YOU 小標(玩家卡;蓋頭像左上角)
    hctx.fillStyle = '#ffd36d'; hctx.fillRect(px - 2, py - 2, 30, 13);
    hctx.fillStyle = '#1a1408'; hctx.font = '900 9px system-ui, sans-serif'; hctx.textAlign = 'left';
    hctx.fillText('YOU', px + 3, py + 8);
  }
  // 條區(對手卡鏡像=條在頭像左邊)
  const bx = dir === 1 ? px + PSZ + 8 : x + 8, bw = CW - PSZ - 22;
  hctx.textAlign = dir === 1 ? 'left' : 'right'; const tx = dir === 1 ? bx : bx + bw;
  hctx.font = '800 11px system-ui, sans-serif'; hctx.fillStyle = '#eafaff';
  hctx.fillText(NAMES[pid], tx, y + 16);
  drawPips(pid, dir === 1 ? bx + bw - 3 * 14 + 4 : bx + 3 * 14 - 4, y + 7, 10, 4, dir); // 收容進度:名字列右端(鏡像=左端)
  const sp = clamp(f.stability / STAB_MAX, 0, 1);   // 穩定條(=舊身上血條配色:暈=黃/低=橘/其餘=陣營色)
  const sbx = dir === 1 ? bx : bx + bw * (1 - sp);
  hctx.fillStyle = 'rgba(0,0,0,.55)'; hctx.fillRect(bx, y + 22, bw, 9);
  hctx.fillStyle = f.stunned ? '#ffd36d' : (f.stability < 30 ? '#ff9a4a' : COLORS[pid]); hctx.fillRect(sbx, y + 22, bw * sp, 9);
  const gp = clamp(f.guardStam / GUARD_STAM_MAX, 0, 1), locked = f.guardLock > 0; // 防禦耐力條
  const gbx = dir === 1 ? bx : bx + bw * (1 - gp);
  hctx.fillStyle = 'rgba(0,0,0,.55)'; hctx.fillRect(bx, y + 34, bw, 5);
  hctx.fillStyle = locked ? '#ff6b6b' : (f.guarding ? '#7fd0ff' : '#4a7fa0'); hctx.fillRect(gbx, y + 34, bw * gp, 5);
  hctx.font = '800 11px system-ui, sans-serif';     // 持有道具列
  if (f.item) { hctx.fillStyle = ITEM_INFO[f.item].color; hctx.fillText(ITEM_INFO[f.item].name + ' ×' + f.itemUses + (isMe ? '（Z）' : ''), tx, y + 54); }
  else if (isMe) { hctx.fillStyle = 'rgba(234,250,255,.4)'; hctx.fillText('無道具（補給座撿）', tx, y + 54); }
}
function drawCards() {
  const touch = touchInput.enabled;                 // 手機:下方被搖桿/按鈕佔用 → 錨上方兩角
  const y = touch ? 58 : VH - CH - 34;
  drawCard(fighters[0], 16, y, 1);
  drawCard(fighters[1], VW - 16 - CW, y, -1);
  if (typeof window !== 'undefined') {              // 測試 hook:卡片幾何+頭像種類
    const p0 = getPortrait(fighters[0], COLORS[0]), p1 = getPortrait(fighters[1], COLORS[1]);
    window.__hud = { anchor: touch ? 'top' : 'bottom', cards: [
      { pid: 0, x: 16, y, w: CW, h: CH, you: true, portrait: p0 ? p0.kind : null },
      { pid: 1, x: VW - 16 - CW, y, w: CW, h: CH, you: false, portrait: p1 ? p1.kind : null },
    ] };
  }
}
/* camp-2:**事故報告退役**(規格 H §9)。使用者定調:「再也沒有魔法事故報告了,那是舊的想法。」
   `js/v2-report.js` 整檔 + S~E 等級 + 挑戰碼 + 分享文字 + 複製鈕全部拿掉;
   換成一張**極簡結算卡**——結局只回答三件事:結果、花多久、被回收幾次。
   ⚠ 這張卡是 camp-2 的最小可玩收尾;闖關版的「打卡下班演出」是 camp-6 的工作。
   ⚠ 保留 `containLog`(鑰匙進度 + 被回收次數)與 `inc.matchT`(通關計時)——報告死了但這兩個有新用途。*/
function drawEndCard() {
  const camp = v2s.camp.phase === 'clockout';
  hctx.fillStyle = 'rgba(8,10,16,.66)'; hctx.fillRect(0, 0, VW, VH);   // 凍結畫面壓暗
  const pw = 520, ph = camp ? 250 : 200, px = (VW - pw) / 2, py = (VH - ph) / 2;
  hctx.fillStyle = 'rgba(20,24,34,.97)'; hctx.fillRect(px, py, pw, ph);
  hctx.strokeStyle = camp ? 'rgba(154,255,208,.55)' : 'rgba(255,211,109,.45)';
  hctx.lineWidth = 2; hctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
  const cx = VW / 2; let y = py + 54;
  hctx.textAlign = 'center';
  if (camp) {
    hctx.font = '900 34px system-ui, sans-serif'; hctx.fillStyle = '#9affd0';
    hctx.fillText('下班打卡成功', cx, y); y += 40;
    hctx.font = '700 15px system-ui, sans-serif'; hctx.fillStyle = '#cfe0f0';
    hctx.fillText('🔑 ' + v2s.camp.keys + '/3　　三個同事都回收了。', cx, y); y += 34;
    hctx.font = '700 14px system-ui, sans-serif'; hctx.fillStyle = '#9fb6cd';
    hctx.fillText('用時 ' + inc.matchT.toFixed(0) + ' 秒　·　被丟回流水線 ' + v2s.camp.deaths + ' 次', cx, y); y += 32;
  } else {
    const w = v2s.winnerPid >= 0 ? v2s.winnerPid : 0;
    hctx.font = '900 30px system-ui, sans-serif'; hctx.fillStyle = COLORS[w];
    hctx.fillText(NAMES[w] + ' 獲勝', cx, y); y += 38;
    hctx.font = '700 14px system-ui, sans-serif'; hctx.fillStyle = '#9fb6cd';
    hctx.fillText('用時 ' + inc.matchT.toFixed(0) + ' 秒　·　回收 ' + containLog.length + ' 次', cx, y); y += 32;
  }
  hctx.font = '800 15px system-ui, sans-serif'; hctx.fillStyle = '#eafaff';
  hctx.fillText('按 R 再來一次', cx, py + ph - 22);
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
    hctx.strokeText('打暈.打下場＝記錄事故 ×' + WIN_TARGET + '　然後收容封存他', cx, cy);
    hctx.fillStyle = '#9affd0'; hctx.fillText('打暈.打下場＝記錄事故 ×' + WIN_TARGET + '　然後收容封存他', cx, cy);
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
  // camp-0:主選單期整層 HUD 收掉(標題/教練行/狀態卡/操作說明全部是戰鬥用的,壓在選單上=最吵的雜訊)。
  // 只留右下角 build tag——線上診斷靠它確認載到新版。
  if (v2s.camp.phase === 'menu') { drawBuildTag(); return; }
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
  hctx.fillText('魔法事故報告 · 收容測試　階段 ' + v2s.stage + '：' + STAGE_NAME[v2s.stage - 1] + '　記錄 ' + WIN_TARGET + ' 筆 → 收容封存', VW / 2, 28);
  // AI 狀態(練習模式)— 永遠可見,B 切換
  const aiOn = fighters[1 - LOCAL].ai;
  hctx.font = '800 13px system-ui, sans-serif';
  hctx.fillStyle = aiOn ? 'rgba(255,140,140,.92)' : 'rgba(154,255,208,.96)';
  hctx.fillText(aiOn ? '紅方：AI 同事　（按 B 關掉，練手感）' : '紅方：練習假人　（按 B 開 AI）', VW / 2, 48);
  drawContainHud();
  drawItems();
  drawBursts(); // 漫畫打擊爆花:最上層蓋過角色(hitfx-1;白閃/集中線也在這層)
  drawCards(); // 下方狀態卡(hud-1):頭像+YOU+穩定/防耐條+收容進度+道具(手機=上方兩角)
  drawSwitchLabels();
  if (v2s.introT <= INTRO_GO) drawCoachLine(); // 就位期讓位給開場字幕(反擊提示已移除=玩家自己體會)
  // stage / seal banner
  if (v2s.winBannerT > 0 && v2s.bannerText && v2s.letterK < 0.3) {   // 終演中壓橫幅(過場敘事交給鏡頭)
    hctx.textAlign = 'center'; hctx.font = '900 40px system-ui, sans-serif';
    hctx.fillStyle = COLORS[v2s.winnerPid] || '#eafaff'; hctx.fillText(v2s.bannerText, VW / 2, VH / 2 - 30);
  }
  drawPerformLED(); // 收容演出 LED 飄字(艙口上方;matchOver 前跑,照畫)
  drawIntro(); // 開場字幕:就位期=老闆訓話+目標 → 尾段=「開始!」
  // controls hint
  hctx.textAlign = 'center'; hctx.font = '700 13px system-ui, sans-serif';
  hctx.fillStyle = 'rgba(234,250,255,.7)';
  hctx.fillText('藍（你）：方向鍵／WASD 移動（＝跑，面向＝移動方向）· C＝攻擊（三連擊／跑久＝衝刺拳／空中＝下壓拳／扛著＝丟）· X＝抓／撿（裝備·瓶·桶）· Z＝道具 · Shift 按住＝防禦 · 空白＝跳　B：AI　L：減閃爍', VW / 2, VH - 18);
  if (v2s.matchOver) drawEndCard();              // camp-2:極簡結算卡(事故報告退役,規格 H §9)
  // build tag — bump on each gameplay change so you can confirm a fresh deploy loaded (hard-refresh if it's old)
  drawKeyRow(); drawKeyDrop();          // camp-3:鑰匙格 → 掉落/飛入(順序不可換:飛入的終點由 drawKeyRow 填)
  drawRecordBeat();
  drawFinisherUi();
  drawBuildTag();
}
// build tag — 每次改動就 bump,線上硬重整後靠它確認載到新版(選單期也畫=診斷不斷線)
function drawBuildTag() {
  hctx.textAlign = 'right'; hctx.font = '700 11px ui-monospace, monospace'; hctx.fillStyle = 'rgba(234,250,255,.5)';
  hctx.fillText('build: camp-3', VW - 10, VH - 4);
}

// ===== 規格 G §4.3/§5:終演 UI——letterbox(上下黑邊)+ 收容窗口提示 + 按下白閃 =====
// letterK 由 v2.js step 緩動(終演自動段+最終封存=1);prompt 期只有提示不進 letterbox。
function drawFinisherUi() {
  const F = v2s.finisher;
  if (v2s.letterK > 0.01) {
    const h = VH * 0.10 * Math.min(1, v2s.letterK);
    hctx.fillStyle = '#05060a';
    hctx.fillRect(0, 0, VW, h); hctx.fillRect(0, VH - h, VW, h);
  }
  if (F && F.phase === 'prompt') {
    const pk = 0.72 + 0.28 * Math.sin(game.time * 12);            // 快閃=緊急感
    hctx.save();
    hctx.textAlign = 'center';
    hctx.font = '900 40px system-ui, sans-serif';
    hctx.globalAlpha = pk;
    hctx.strokeStyle = 'rgba(0,0,0,.75)'; hctx.lineWidth = 7;
    hctx.strokeText('按 X 收容!', VW / 2, VH * 0.34);
    hctx.fillStyle = '#ffd36d'; hctx.fillText('按 X 收容!', VW / 2, VH * 0.34);
    hctx.globalAlpha = 1;
    hctx.font = '700 16px system-ui, sans-serif';
    hctx.fillStyle = '#eafaff';
    hctx.fillText('收容窗口開啟——錯過他就爬起來了', VW / 2, VH * 0.34 + 26);
    hctx.restore();
  }
  if (v2s.finFlash > 0) {                                          // 按下瞬間白閃
    hctx.fillStyle = 'rgba(255,255,255,' + Math.min(0.85, v2s.finFlash * 2.2).toFixed(3) + ')';
    hctx.fillRect(0, 0, VW, VH);
  }
}

// ===== flow-2 立案 beat(玩家反饋 2026-08-03「擊暈得分太不起眼,不知不覺就被記 3 次」)=====
// 主題直譯:這是《魔法事故報告》,每一筆記錄就是實驗室**拍照存證**。
// ①閃光燈打在受害者身上(0.14s)→ ②「事故記錄 #N」印章卡壓在他身上(蓋章:大→正,微傾)
// → ③卡飛進記錄者的三格計分格(落格白閃在 drawPips)。全長 ~1s,事件驅動=不佔常駐畫面。
// 位置:受害者世界座標經 project();專案慣例=鏡頭外/投影失敗就退到畫面中央上方。
/* ===== camp-3 魔法鑰匙(規格 H §5)=====
   使用者定調:「打贏回收 → 掉落魔法鑰匙(1/3)」。三把湊齊=開門下班。

   **為什麼整段畫在 HUD 而不是做成 3D 物件**:①鑰匙的終點本來就是 HUD 計數器,做成世界物件還是得
   接一段飛進 UI 的動畫;②ui-2d 的教訓——世界層的東西會被地板/罩子/色調映射吃掉,而「進度」是
   絕對不能看不到的訊息;③flow-2b 的印章卡已經證明「錨在世界座標的 HUD 動畫」讀起來就像在場上。
   起點用 `project(POD…)` 錨在回收艙口,所以它看起來確實是**從艙裡吐出來**的。

   節拍(佔 keyFx.T 的比例;T = CAMP_T.keydrop):
     0–30% 從艙口彈出(拋物線上升)→ 30–55% 落下+彈一下 → 55–70% 停在原地發亮(讓玩家看清楚)
     → 70–100% 加速飛進左上角的鑰匙格 + 該格白閃。
   **不用玩家撿**:規格 H §5——玩家的抱怨就是「東西太多、很亂」,再加一個必做步驟是逆向操作。 */
const KEY_ROW = { x: 16, y: 12, size: 26, gap: 6 };
const _keyAt = [];                                    // 每格螢幕座標(給飛入動畫當終點;同 _pipAt 慣例)
function drawKeyRow() {
  const ph = v2s.camp.phase;
  if (ph === 'free' || ph === 'menu') return;         // 加班模式沒有鑰匙這回事
  const K = v2s.keyFx;
  const flying = !!(K && K.t < K.T * 0.88);           // 還在飛=該格先留空,等它落進去才點亮
  const owned = v2s.camp.keys - (flying ? 1 : 0);
  const done = v2s.camp.keys >= CAMP_LEVELS;
  const pulse = done && !v2s.lowFlicker ? 0.5 + 0.5 * Math.sin(game.time * 6) : 0;
  hctx.save();
  hctx.textAlign = 'center'; hctx.textBaseline = 'middle';
  // ⚠ **整排要有一塊不透明底板**:計數格壓在場景左上角,那裡可能是黃色油桶也可能是暗地板——
  //   第一版每格各自半透明,空格(alpha .18)疊在亮色機具上等於消失,只看得到已拿到的那一格。
  //   進度是絕對不能看不到的訊息,所以底板先鋪滿,格子再畫上去。
  const PW = CAMP_LEVELS * KEY_ROW.size + (CAMP_LEVELS - 1) * KEY_ROW.gap;
  hctx.fillStyle = 'rgba(8,10,16,.78)';
  hctx.fillRect(KEY_ROW.x - 7, KEY_ROW.y - 6, PW + 14, KEY_ROW.size + 12);
  hctx.strokeStyle = 'rgba(255,211,109,.30)'; hctx.lineWidth = 1;
  hctx.strokeRect(KEY_ROW.x - 6.5, KEY_ROW.y - 5.5, PW + 13, KEY_ROW.size + 11);
  for (let i = 0; i < CAMP_LEVELS; i++) {
    const x = KEY_ROW.x + i * (KEY_ROW.size + KEY_ROW.gap), y = KEY_ROW.y, S = KEY_ROW.size;
    _keyAt[i] = { x: x + S / 2, y: y + S / 2 };
    hctx.fillStyle = i < owned ? 'rgba(255,211,109,.14)' : 'rgba(255,255,255,.05)';
    hctx.fillRect(x, y, S, S);
    hctx.strokeStyle = i < owned ? 'rgba(255,211,109,.9)' : 'rgba(255,255,255,.34)';
    hctx.lineWidth = 1.5; hctx.strokeRect(x + 0.5, y + 0.5, S - 1, S - 1);
    hctx.globalAlpha = i < owned ? 1 : 0.3;
    hctx.font = '700 15px system-ui, sans-serif';
    hctx.fillStyle = '#ffd36d'; hctx.fillText('🔑', x + S / 2, y + S / 2 + 1);
    hctx.globalAlpha = 1;
    if (pulse > 0) {                                  // 三把湊齊:整排閃(大門解鎖的視覺回應)
      hctx.strokeStyle = 'rgba(154,255,208,' + (0.35 + 0.55 * pulse).toFixed(3) + ')';
      hctx.lineWidth = 2.5; hctx.strokeRect(x - 1.5, y - 1.5, S + 3, S + 3);
    }
  }
  hctx.restore();
}
// 掉落 → 停留 → 飛進計數格。⚠ 一定要在 drawKeyRow 之後呼叫:終點座標由那支填 `_keyAt`(同 _pipAt 慣例)。
function drawKeyDrop() {
  const K = v2s.keyFx; if (!K) return;
  const k = clamp(K.t / K.T, 0, 1);
  const s = project(POD.x, POD.y, 20);                // ⚠ 慣例是 (世界x, 世界y, 高度)
  const p = s.behind ? { x: VW / 2, y: VH * 0.42 } : s;
  const dst = _keyAt[K.n - 1] || { x: KEY_ROW.x + 13, y: KEY_ROW.y + 13 };
  let cx, cy, sc = 1, al = 1, glow = 0;
  if (k < 0.55) {                                      // 彈出 → 落下(拋物線;0.30 處到頂)
    const q = k / 0.55, hop = Math.sin(q * Math.PI) * 78;
    cx = p.x; cy = p.y - 26 - hop;
    sc = 0.85 + 0.35 * Math.sin(q * Math.PI);
  } else if (k < 0.70) {                               // 停一下發亮(給玩家一拍看清楚「我拿到鑰匙了」)
    cx = p.x; cy = p.y - 26; glow = 1 - (k - 0.55) / 0.15;
  } else {                                             // 飛進計數格(ease-in=被吸過去)
    const q = (k - 0.70) / 0.30, e = q * q;
    cx = p.x + (dst.x - p.x) * e; cy = (p.y - 26) + (dst.y - (p.y - 26)) * e;
    sc = 1 - 0.55 * e; al = 1 - Math.max(0, (q - 0.8) / 0.2);
  }
  hctx.save();
  hctx.globalAlpha = clamp(al, 0, 1);
  if (glow > 0) {                                      // 停留期的光暈
    const g = hctx.createRadialGradient(cx, cy, 0, cx, cy, 40);
    g.addColorStop(0, 'rgba(255,211,109,' + (0.5 * glow).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,211,109,0)');
    hctx.fillStyle = g; hctx.beginPath(); hctx.arc(cx, cy, 40, 0, Math.PI * 2); hctx.fill();
  }
  hctx.translate(cx, cy); hctx.scale(sc, sc);
  hctx.textAlign = 'center'; hctx.textBaseline = 'middle';
  hctx.font = '700 30px system-ui, sans-serif';
  hctx.fillText('🔑', 0, 0);
  hctx.restore();
}
function drawRecordBeat() {
  const C = v2s.recordCard; if (!C) return;
  if (v2s.letterK > 0.3) return;                       // 終演鏡頭中不搶戲(同 coach line/banner 的壓制規則)
  const k = clamp(C.t / C.T, 0, 1);
  const s = project(C.x, C.y, 34);                     // ⚠ 慣例是 (世界x, 世界y, 高度),不是 (x,高,y)
  const p = s.behind ? { x: VW / 2, y: VH * 0.3 } : s; // 鏡頭外=退到畫面中央上方(beat 不能整個消失)
  const dst = _pipAt[C.w][C.n - 1] || { x: VW / 2, y: VH - 40 };
  // ① 閃光燈:受害者身上一圈白光炸開(短、局部——不做全屏白閃,那是終演按下鍵的語言)
  if (k < 0.2) {
    const q = 1 - k / 0.2, r = 26 + (1 - q) * 92;
    const g = hctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, 'rgba(255,255,255,' + (0.75 * q).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    hctx.fillStyle = g; hctx.beginPath(); hctx.arc(p.x, p.y, r, 0, Math.PI * 2); hctx.fill();
  }
  // ②③ 印章卡:前 38% 蓋在受害者身上(scale 1.9→1 的壓章),之後加速飛向計分格並縮小
  const HOLD = 0.38;
  let cx, cy, sc, rot, al = 1;
  if (k < HOLD) {
    const q = k / HOLD;
    cx = p.x; cy = p.y - 34;
    sc = 1 + 0.9 * Math.pow(1 - Math.min(1, q * 3.2), 2);            // 壓章:前 1/3 由大砸到正
    rot = -0.12 + 0.1 * Math.min(1, q * 3.2);
  } else {
    const q = (k - HOLD) / (1 - HOLD), e = q * q;                    // ease-in=被吸進格子
    cx = p.x + (dst.x - p.x) * e; cy = (p.y - 34) + (dst.y - (p.y - 34)) * e;
    sc = 1 - 0.72 * e; rot = -0.02 - 0.5 * e;
    al = 1 - Math.max(0, (q - 0.75) / 0.25);
  }
  const W = 132, H = 40;
  hctx.save();
  hctx.globalAlpha = clamp(al, 0, 1);
  hctx.translate(cx, cy); hctx.rotate(rot); hctx.scale(sc, sc);
  hctx.fillStyle = 'rgba(12,16,24,.92)'; hctx.fillRect(-W / 2, -H / 2, W, H);
  hctx.strokeStyle = '#ffd36d'; hctx.lineWidth = 2.5; hctx.strokeRect(-W / 2 + 1, -H / 2 + 1, W - 2, H - 2);
  hctx.textAlign = 'center';
  hctx.font = '900 15px system-ui, sans-serif'; hctx.fillStyle = '#ffd36d';
  hctx.fillText('事故記錄 #' + C.n, 0, -2);
  hctx.font = '800 12px system-ui, sans-serif'; hctx.fillStyle = '#eafaff';
  hctx.fillText(C.phrase, 0, 14);
  hctx.restore();
}
