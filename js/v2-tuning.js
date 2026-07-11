// v2 live tuning panel — opt-in via v2.html?tune=1 (a repo-only dev tool; it never loads on the normal page,
// so the live v2 stays clean). Sliders for 角色大小 / 地板格線·顏色·搶眼度 / 攝影機, all applied instantly,
// plus a "複製設定" button that dumps the current values to paste back — mirrors the camera-sandbox workflow.
import { setFloorParams, getFloorParams, refreshActors, ANIM } from './render.js';

const v2 = window.__v2;
if (!v2) throw new Error('[v2-tuning] window.__v2 not ready');
const { fighters, CAM } = v2;
const fp0 = getFloorParams();

const panel = document.createElement('div');
panel.style.cssText = `position:fixed;top:10px;right:10px;z-index:9999;width:232px;max-height:94vh;overflow:auto;
  background:rgba(18,16,26,.92);border:1px solid #6a4a77;border-radius:10px;padding:10px 12px;
  font:12px system-ui,sans-serif;color:#eee;box-shadow:0 8px 30px rgba(0,0,0,.5);pointer-events:auto;`;
document.body.appendChild(panel);

function header(txt, big) {
  const e = document.createElement('div'); e.textContent = txt;
  e.style.cssText = big ? 'font-weight:800;color:#ffd36d;font-size:13px;margin-bottom:2px;'
    : 'font-weight:700;margin:9px 0 3px;color:#ffd36d;';
  panel.appendChild(e);
}
function slider(label, min, max, step, val, on) {
  const row = document.createElement('label'); row.style.cssText = 'display:block;margin:5px 0;';
  const lab = document.createElement('div'); lab.style.cssText = 'display:flex;justify-content:space-between;';
  const nm = document.createElement('span'); nm.textContent = label;
  const num = document.createElement('span'); num.style.color = '#9fe7ff';
  const fmt = (v) => step < 1 ? (+v).toFixed(2) : String(+v);
  num.textContent = fmt(val); lab.append(nm, num); row.appendChild(lab);
  const s = document.createElement('input'); s.type = 'range'; s.min = min; s.max = max; s.step = step; s.value = val;
  s.style.cssText = 'width:100%;'; s.oninput = () => { num.textContent = fmt(s.value); on(+s.value); };
  row.appendChild(s); panel.appendChild(row);
}
function colorRow(label, val, on) {
  const row = document.createElement('label');
  row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin:5px 0;';
  const nm = document.createElement('span'); nm.textContent = label;
  const c = document.createElement('input'); c.type = 'color'; c.value = val; c.oninput = () => on(c.value);
  row.append(nm, c); panel.appendChild(row);
}
function toggleRow(label, val, on) {
  const row = document.createElement('label');
  row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin:5px 0;';
  const nm = document.createElement('span'); nm.textContent = label;
  const c = document.createElement('input'); c.type = 'checkbox'; c.checked = val; c.onchange = () => on(c.checked);
  row.append(nm, c); panel.appendChild(row);
}
// a copy button + its own read-only output box, scoped to one section (so e.g. the camera line copies alone)
function copyButton(label, textFn) {
  const btn = document.createElement('button'); btn.textContent = '📋 ' + label;
  btn.style.cssText = 'width:100%;margin-top:8px;padding:6px;border-radius:6px;border:1px solid #6a4a77;background:#2a2036;color:#ffd36d;font-weight:700;cursor:pointer;';
  const out = document.createElement('textarea'); out.readOnly = true;
  out.style.cssText = 'width:100%;height:52px;margin-top:6px;box-sizing:border-box;font:11px ui-monospace,monospace;background:#0d0b12;color:#9fe7ff;border:1px solid #333;border-radius:6px;display:none;';
  btn.onclick = () => {
    const txt = textFn(); out.value = txt; out.style.display = 'block'; out.select();
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => { btn.textContent = '✓ 已複製'; setTimeout(() => btn.textContent = '📋 ' + label, 1200); });
  };
  panel.append(btn, out);
}

header('v2 調整台', true);
const hint = document.createElement('div'); hint.textContent = '?tune=1 · 即時套用';
hint.style.cssText = 'color:#888;margin-bottom:2px;'; panel.appendChild(hint);

header('對局');
// AI 對手 — default OFF while tuning so you're not shoved around; toggle on to test against the bot.
const setAI = (on) => fighters.forEach((f, i) => { if (i !== 0) f.ai = on; });
toggleRow('AI 對手', false, setAI);
setAI(false); // apply the default immediately (peaceful tuning)
// focus the camera on YOUR fighter on load. The camera pins X to arena centre (960/2=480), so putting the
// local player at x=480 makes it sit dead-centre; the opponent is parked off to the left for comparison.
// Snap the camera rig straight to the target too, so there's no pan-in from the spawn corner.
if (fighters[0]) { fighters[0].x = 480; fighters[0].y = 400; fighters[0].vx = 0; fighters[0].vy = 0; }
if (fighters[1]) { fighters[1].x = 330; fighters[1].y = 380; fighters[1].vx = 0; fighters[1].vy = 0; }
if (v2.camRig) { v2.camRig.x = 480; v2.camRig.y = 400; }

header('角色');
slider('大小 (r)', 12, 30, 1, fighters[0].r, (v) => { for (const f of fighters) f.r = v; refreshActors(); });

header('地板');
slider('格線濃度', 0, 0.6, 0.02, fp0.gridAlpha, (v) => setFloorParams({ gridAlpha: v }));
toggleRow('花紋雜點', fp0.motes, (v) => setFloorParams({ motes: v }));
colorRow('地板色 A', fp0.floorA, (v) => setFloorParams({ floorA: v }));
colorRow('地板色 B', fp0.floorB, (v) => setFloorParams({ floorB: v }));
colorRow('格線色', fp0.floorEdge, (v) => setFloorParams({ floorEdge: v }));
// copy for the look settings (角色 + 地板) — kept separate from the camera line
copyButton('複製 角色+地板', () => {
  const f = getFloorParams();
  return `fighter r = ${fighters[0].r}\n`
    + `floor = { gridAlpha:${(+f.gridAlpha).toFixed(2)}, motes:${f.motes}, floorA:'${f.floorA}', floorB:'${f.floorB}', floorEdge:'${f.floorEdge}' }`;
});

header('彈道(即時)');
// LOB 物件是 live tuning 真相:出手速度=range/T 在出手當下現算,拖滑桿後下一次出手就生效。
// 手感口訣:apex=挑/拋多高、range=往前多遠、T=滯空多久(也影響水平速度)。
const PL = v2.PUNCH_LAUNCH_LOB, PE = v2.PERSON_LOB, BA = v2.BARREL_LOB, IC = v2.ICE_LOB;
slider('挑空 range(前飛)', 10, 200, 5, PL.range, (x) => PL.range = x);
slider('挑空 apex(挑高)', 5, 100, 5, PL.apex, (x) => PL.apex = x);
slider('挑空 T(滯空秒)', 0.2, 0.8, 0.05, PL.T, (x) => PL.T = x);
slider('丟人 range', 80, 360, 10, PE.range, (x) => PE.range = x);
slider('丟人 apex', 10, 90, 2, PE.apex, (x) => PE.apex = x);
slider('丟桶 range', 80, 360, 10, BA.range, (x) => BA.range = x);
slider('丟桶 apex', 10, 90, 2, BA.apex, (x) => BA.apex = x);
slider('丟瓶 range', 80, 360, 10, IC.range, (x) => IC.range = x);
slider('丟瓶 apex', 10, 90, 2, IC.apex, (x) => IC.apex = x);
copyButton('複製 彈道', () =>
  `export const PERSON_LOB = { range: ${PE.range}, apex: ${PE.apex}, T: ${PE.T}, h0: ${PE.h0} };\n`
  + `export const BARREL_LOB = { range: ${BA.range}, apex: ${BA.apex}, T: ${BA.T}, h0: ${BA.h0} };\n`
  + `export const PUNCH_LAUNCH_LOB = { range: ${PL.range}, apex: ${PL.apex}, T: ${PL.T}, h0: ${PL.h0} };\n`
  + `export const ICE_LOB = { range: ${IC.range}, apex: ${IC.apex}, T: ${IC.T}, h0: ${IC.h0} };`);

header('跑步(即時)');
// 邊跑邊拖:雙擊方向鍵開跑後直接調,差異立刻看得到
slider('彈跳 bob(踩地感)', 0, 0.3, 0.01, ANIM.runClip.bob, (x) => ANIM.runClip.bob = x);
// stridePx=播放速度本體(位移驅動:擺動頻率=移速269÷stridePx 圈/秒)。大=擺動慢,但滑步率↑
// (腳觸地掃程固定~48px:60→20% 滑步、96→50%、144→67%)。要「慢+踩實」得回 studio 加大實際步幅。
slider('stridePx(大=擺動慢/滑步↑)', 40, 200, 2, ANIM.runClip.stridePx, (x) => ANIM.runClip.stridePx = x);
copyButton('複製 跑步', () => `runClip: { stridePx: ${ANIM.runClip.stridePx}, bob: ${ANIM.runClip.bob} },`);


header('攝影機');
slider('fov', 20, 60, 1, CAM.fov, (v) => CAM.fov = v);
slider('angle', 10, 70, 1, CAM.angle, (v) => CAM.angle = v);
slider('dist', 300, 1200, 10, CAM.dist, (v) => CAM.dist = v);
slider('panZ', -200, 100, 5, CAM.panZ, (v) => CAM.panZ = v);
slider('lookY', -40, 60, 2, CAM.lookY, (v) => CAM.lookY = v);
// camera copy — its OWN block, just the CAM line (matches the camera-sandbox paste format)
copyButton('複製 攝影機', () =>
  `CAM = { fov:${CAM.fov}, angle:${CAM.angle}, dist:${CAM.dist}, azimuth:${CAM.azimuth}, panX:${CAM.panX}, panZ:${CAM.panZ}, lookY:${CAM.lookY} }`);

console.log('[v2-tuning] panel ready — 攝影機 copies alone; 角色+地板 copies together');
