// v2 live tuning panel — opt-in via v2.html?tune=1 (a repo-only dev tool; it never loads on the normal page,
// so the live v2 stays clean). Sliders for 角色大小 / 地板格線·顏色·搶眼度 / 攝影機, all applied instantly,
// plus a "複製設定" button that dumps the current values to paste back — mirrors the camera-sandbox workflow.
import { setFloorParams, getFloorParams, refreshActors } from './render.js';

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

header('v2 調整台', true);
const hint = document.createElement('div'); hint.textContent = '?tune=1 · 即時套用';
hint.style.cssText = 'color:#888;margin-bottom:2px;'; panel.appendChild(hint);

header('角色');
slider('大小 (r)', 12, 30, 1, fighters[0].r, (v) => { for (const f of fighters) f.r = v; refreshActors(); });

header('地板');
slider('格線濃度', 0, 0.6, 0.02, fp0.gridAlpha, (v) => setFloorParams({ gridAlpha: v }));
toggleRow('花紋雜點', fp0.motes, (v) => setFloorParams({ motes: v }));
colorRow('地板色 A', fp0.floorA, (v) => setFloorParams({ floorA: v }));
colorRow('地板色 B', fp0.floorB, (v) => setFloorParams({ floorB: v }));
colorRow('格線色', fp0.floorEdge, (v) => setFloorParams({ floorEdge: v }));

header('攝影機');
slider('fov', 20, 60, 1, CAM.fov, (v) => CAM.fov = v);
slider('angle', 10, 70, 1, CAM.angle, (v) => CAM.angle = v);
slider('dist', 300, 1200, 10, CAM.dist, (v) => CAM.dist = v);
slider('panZ', -200, 100, 5, CAM.panZ, (v) => CAM.panZ = v);
slider('lookY', -40, 60, 2, CAM.lookY, (v) => CAM.lookY = v);

const btn = document.createElement('button'); btn.textContent = '📋 複製設定';
btn.style.cssText = 'width:100%;margin-top:10px;padding:6px;border-radius:6px;border:1px solid #6a4a77;background:#2a2036;color:#ffd36d;font-weight:700;cursor:pointer;';
const out = document.createElement('textarea'); out.readOnly = true;
out.style.cssText = 'width:100%;height:88px;margin-top:6px;box-sizing:border-box;font:11px ui-monospace,monospace;background:#0d0b12;color:#9fe7ff;border:1px solid #333;border-radius:6px;display:none;';
btn.onclick = () => {
  const f = getFloorParams();
  const txt = `fighter r = ${fighters[0].r}\n`
    + `CAM = { fov:${CAM.fov}, angle:${CAM.angle}, dist:${CAM.dist}, azimuth:${CAM.azimuth}, panX:${CAM.panX}, panZ:${CAM.panZ}, lookY:${CAM.lookY} }\n`
    + `floor = { gridAlpha:${(+f.gridAlpha).toFixed(2)}, motes:${f.motes}, floorA:'${f.floorA}', floorB:'${f.floorB}', floorEdge:'${f.floorEdge}' }`;
  out.value = txt; out.style.display = 'block'; out.select();
  if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => { btn.textContent = '✓ 已複製'; setTimeout(() => btn.textContent = '📋 複製設定', 1200); });
};
panel.append(btn, out);
console.log('[v2-tuning] panel ready — drag sliders, then 複製設定 to paste back');
