// v2 的 2D HUD 繪製 (docs/v2-module-boundaries.md §3):持有 #hud 畫布的 2D context,
// 每幀由 v2.js 的 frame() 呼叫 drawHud()。只讀狀態(v2-state)不寫玩法狀態;
// 3D 世界點 → 螢幕座標用 render.js 的 project()。

import { clamp } from './utils.js';
import { game } from './state.js';
import { project } from './render.js';
import {
  v2s, fighters, LOCAL, COLORS, NAMES, inc, roundWins, containLog, WIN_TARGET,
  POD, STAB_MAX, CARRY_ESCAPE_NEED, pads, ITEM_INFO,
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
      if (!f.ai) { hctx.fillStyle = '#fff'; hctx.font = '900 13px system-ui, sans-serif'; hctx.fillText(f.mashSide === 0 ? '◀ A' : 'D ▶', s.x, s.y - 18); }
    }
    // 格擋推開提示:被打中的短窗內亮起(像掙脫指示),按對=把攻擊方推開
    if (!f.ai && f.pushWinT > 0 && f.pushCd <= 0 && !f.stunned && !f.carriedBy) {
      const pk = v2s.lowFlicker ? 0.95 : 0.75 + 0.25 * Math.sin(game.time * 18);
      hctx.fillStyle = `rgba(154,255,208,${pk})`; hctx.font = '900 14px system-ui, sans-serif';
      hctx.fillText((f.pid === 0 ? '空白鍵' : 'Enter') + ' 推開！', s.x, s.y - 18);
    }
  }
}
// 教練提示線(玩家反饋:「指示要更明顯地告訴我現在該做什麼」):
// 按優先序只顯示一條,大字置中脈動,告訴本機玩家當下最重要的行動。
function drawCoachLine() {
  const me = fighters[LOCAL], o = fighters[1 - LOCAL];
  let msg = null, col = '#ffd36d';
  if (me.carriedBy) { msg = '連打 ◀A D▶ 掙脫！'; col = '#9affd0'; }
  else if (me.carrying) { msg = '拖進中央魔法陣！或 左鍵拋擲'; col = '#c98cff'; }
  else if (o.state === 'alive' && o.stunned && !o.carriedBy && o.invuln <= 0) { msg = '⚡ 對手暈了！右鍵抓住他'; col = '#ffd36d'; }
  else if (me.pushWinT > 0 && me.pushCd <= 0 && !me.stunned) { msg = '空白鍵 推開！'; col = '#9affd0'; }
  else if (me.stunned) { msg = '你被打暈了…！'; col = '#ff9a9a'; }
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
  }
  const me = fighters[LOCAL]; // 本機持有 HUD
  hctx.textAlign = 'left'; hctx.font = '800 14px system-ui, sans-serif';
  if (me.item) { hctx.fillStyle = ITEM_INFO[me.item].color; hctx.fillText('持有：' + ITEM_INFO[me.item].name + '（右鍵使用）', 24, VH - 40); }
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
export function drawHud() {
  hctx.clearRect(0, 0, VW, VH);
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
  drawCoachLine();
  // stage / seal banner
  if (v2s.winBannerT > 0 && v2s.bannerText) {
    hctx.textAlign = 'center'; hctx.font = '900 40px system-ui, sans-serif';
    hctx.fillStyle = COLORS[v2s.winnerPid] || '#eafaff'; hctx.fillText(v2s.bannerText, VW / 2, VH / 2 - 30);
  }
  // controls hint
  hctx.textAlign = 'center'; hctx.font = '700 13px system-ui, sans-serif';
  hctx.fillStyle = 'rgba(234,250,255,.7)';
  hctx.fillText('藍（你）：WASD 移動 · 滑鼠瞄準 · 左鍵三連擊 · 右鍵抓／放技能 · 扛人左鍵拋擲 · 空白鍵推開（被打時）　B：開關 AI　L：減閃爍', VW / 2, VH - 18);
  if (v2s.matchOver && v2s.report) drawReport(); // end-of-match incident report overlay
  // build tag — bump on each gameplay change so you can confirm a fresh deploy loaded (hard-refresh if it's old)
  hctx.textAlign = 'right'; hctx.font = '700 11px ui-monospace, monospace'; hctx.fillStyle = 'rgba(234,250,255,.5)';
  hctx.fillText('build: field-1', VW - 10, VH - 4);
}
