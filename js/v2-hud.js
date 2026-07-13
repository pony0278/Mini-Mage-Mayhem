// v2 的 2D HUD 繪製 (docs/v2-module-boundaries.md §3):持有 #hud 畫布的 2D context,
// 每幀由 v2.js 的 frame() 呼叫 drawHud()。只讀狀態(v2-state)不寫玩法狀態;
// 3D 世界點 → 螢幕座標用 render.js 的 project()。

import { clamp } from './utils.js';
import { game } from './state.js';
import { project } from './render.js';
import {
  v2s, fighters, LOCAL, COLORS, NAMES, inc, roundWins, containLog, WIN_TARGET,
  POD, STAB_MAX, CARRY_ESCAPE_NEED, pads, PICKUP_R, groundItems, bottles, GRAB_RANGE, labSwitches, PUNCH_RANGE, ITEM_INFO, GUARD_STAM_MAX,
  STAGE_NAME, METHOD_COL, METHOD_ZH,
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
      hctx.fillText('空白鍵 推開！', s.x, s.y - 18);
    }
  }
}
// 精準格擋黃金時間:世界已被 frame() 去彩+緩速,這裡疊上大提示+倒數條(HUD 保持彩色)
function drawParryPrompt() {
  const me = fighters[LOCAL];
  if (me.parryWinT <= 0 || me.ai || v2s.matchOver) return false;
  const cx = VW / 2, cy = VH * 0.40;
  const pk = v2s.lowFlicker ? 1 : 0.85 + 0.15 * Math.sin(game.time * 30);
  hctx.save();
  hctx.textAlign = 'center';
  hctx.font = '900 44px system-ui, sans-serif';
  hctx.lineWidth = 6; hctx.strokeStyle = 'rgba(8,8,16,.85)';
  hctx.strokeText('⚡ 空白鍵 反擊！', cx, cy);
  hctx.globalAlpha = pk; hctx.fillStyle = '#ffe97a';
  hctx.fillText('⚡ 空白鍵 反擊！', cx, cy);
  // 倒數條:剩餘窗口比例
  const bw = 260, bh = 10, p = Math.max(0, Math.min(1, me.parryWinT / (me.parryWin0 || 0.15)));
  hctx.globalAlpha = 1;
  hctx.fillStyle = 'rgba(8,8,16,.72)'; hctx.fillRect(cx - bw / 2 - 2, cy + 16 - 2, bw + 4, bh + 4);
  hctx.fillStyle = '#ffe97a'; hctx.fillRect(cx - bw / 2, cy + 16, bw * p, bh);
  hctx.restore();
  return true;
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
  if (me.carriedBy) { msg = '連打 ◀A D▶ 掙脫！'; col = '#9affd0'; }
  else if (me.carrying) { msg = '拖進中央魔法陣！或 左鍵拋擲'; col = '#c98cff'; }
  else if (o.state === 'alive' && o.stunned && !o.carriedBy && o.invuln <= 0) { msg = '⚡ 對手暈了！右鍵 / E 抓住他'; col = '#ffd36d'; }
  else if (me.pushWinT > 0 && me.pushCd <= 0 && !me.stunned) { msg = '空白鍵 推開！'; col = '#9affd0'; }
  else if (me.stunned) { msg = '你被打暈了…！'; col = '#ff9a9a'; }
  else if (!me.item && !me.carryObj && nearPickup(me)) { msg = '右鍵 / E 撿道具'; col = '#9ee6ff'; } // 手動撿(C 案):附近有補給座/掉落道具且空手
  else if (!me.carryObj && nearBottle(me)) { msg = 'E 撿瓶丟他'; col = '#9ee6ff'; } // 場上投擲瓶:撿了丟(E=互動鍵;持攻擊裝備時右鍵=開火不撿)
  else if (nearSwitch(me)) { msg = '⚠ 揍拉桿 → 啟動四角元素站洩漏（高風險）'; col = '#ff9a4a'; } // 走近未啟動總閘:告訴玩家它控制四站
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
/* 收容演出:艙口 LED 飄字(使用者拍板:輕量融景,像招牌 LED,不做側邊終端面板)。
   文字由 sim 排好(v2s.perform.line);這裡只管 LED 樣式:深底描邊膠囊 + 青字(失控段轉橘紅)+ 掃描期微閃。 */
function drawPerformLED() {
  const p = v2s.perform; if (!p) return;
  const c = project(POD.x, POD.y, 82); if (c.behind) return;
  hctx.font = '700 15px ui-monospace, SFMono-Regular, Consolas, monospace'; hctx.textAlign = 'center'; hctx.textBaseline = 'middle';
  const w = hctx.measureText(p.line).width + 28, h = 24;
  const warn = p.n >= 2 && (p.phase === 'classify' || p.phase === 'resolve'); // 失控/清運段 → 警示色
  hctx.fillStyle = 'rgba(8,18,22,.78)'; hctx.fillRect(c.x - w / 2, c.y - h / 2, w, h);
  hctx.strokeStyle = warn ? 'rgba(255,110,80,.8)' : 'rgba(90,230,255,.55)'; hctx.lineWidth = 1;
  hctx.strokeRect(c.x - w / 2 + 0.5, c.y - h / 2 + 0.5, w - 1, h - 1);
  const blink = (!v2s.lowFlicker && p.phase === 'scan' && Math.floor(p.pk * 10) % 2 === 0) ? 0.72 : 1; // 掃描期微閃(減閃爍=常亮)
  hctx.fillStyle = warn ? `rgba(255,150,90,${blink})` : `rgba(140,235,255,${blink})`;
  hctx.fillText(p.line, c.x, c.y + 1);
  hctx.font = '700 10px ui-monospace, monospace'; hctx.fillStyle = 'rgba(160,220,235,.55)';
  hctx.fillText('MAGIC WASTE INTAKE · ' + ['SCAN', 'SORT', 'SEAL'][p.n - 1], c.x, c.y + h / 2 + 11);
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
  hctx.fillText(aiOn ? '紅方：AI 對手　（按 B 關掉，練手感）' : '紅方：練習假人　（按 B 開 AI）', VW / 2, 48);
  // 三格收容進度 (每格標收容方式)
  drawPips(0, 24, 1); drawPips(1, VW - 24, -1);
  drawContainHud();
  drawItems();
  drawSwitchLabels();
  drawPerformLED(); // 收容演出 LED 飄字(艙口上方)
  if (!drawParryPrompt()) drawCoachLine(); // 黃金時間大提示優先
  // stage / seal banner
  if (v2s.winBannerT > 0 && v2s.bannerText) {
    hctx.textAlign = 'center'; hctx.font = '900 40px system-ui, sans-serif';
    hctx.fillStyle = COLORS[v2s.winnerPid] || '#eafaff'; hctx.fillText(v2s.bannerText, VW / 2, VH / 2 - 30);
  }
  // controls hint
  hctx.textAlign = 'center'; hctx.font = '700 13px system-ui, sans-serif';
  hctx.fillStyle = 'rgba(234,250,255,.7)';
  hctx.fillText('藍（你）：WASD 移動（同向連按2下＝跑）· 滑鼠瞄準 · 左鍵三連擊 · 右鍵＝抓／放技能（持攻擊裝備優先開火）· E＝撿（裝備·瓶·桶）／抓 · 扛著左鍵＝丟 · 空白鍵按住＝防禦　B：AI　L：減閃爍', VW / 2, VH - 18);
  if (v2s.matchOver && v2s.report) drawReport(); // end-of-match incident report overlay
  // build tag — bump on each gameplay change so you can confirm a fresh deploy loaded (hard-refresh if it's old)
  hctx.textAlign = 'right'; hctx.font = '700 11px ui-monospace, monospace'; hctx.fillStyle = 'rgba(234,250,255,.5)';
  hctx.fillText('build: mobile-fx-1', VW - 10, VH - 4);
}
