// camera-sandbox.html only: on-screen camera-tuning panel. Mutates CAM (live
// binding → render reads it) and drives the main loop's pause via setPaused().
import { CAM, game } from './state.js';
import { setPaused } from './main.js';
import { spawnWave } from './sim.js';
import { setCamFollow } from './render.js';

(function camPanel() {
  const $ = (id) => document.getElementById(id);
  const sFov = $('s-fov'), sAng = $('s-angle'), sDist = $('s-dist'), sLook = $('s-looky');
  const sAzi = $('s-azi'), sPanX = $('s-panx'), sPanZ = $('s-panz');
  if (!sFov) return;
  const DEFAULT = { fov: 33, angle: 41, dist: 720, azimuth: -35, panX: 10, panZ: -10, lookY: -10 };
  function configLine() {
    return 'CAM = { fov:' + CAM.fov + ', angle:' + CAM.angle + ', dist:' + CAM.dist
      + ', azimuth:' + CAM.azimuth + ', panX:' + CAM.panX + ', panZ:' + CAM.panZ
      + ', lookY:' + CAM.lookY + ' }';
  }
  function refresh() {
    sFov.value = CAM.fov; sAng.value = CAM.angle; sDist.value = CAM.dist; sLook.value = CAM.lookY;
    sAzi.value = CAM.azimuth; sPanX.value = CAM.panX; sPanZ.value = CAM.panZ;
    $('v-fov').textContent = CAM.fov; $('v-angle').textContent = CAM.angle;
    $('v-dist').textContent = CAM.dist; $('v-looky').textContent = CAM.lookY;
    $('v-azi').textContent = CAM.azimuth; $('v-panx').textContent = CAM.panX; $('v-panz').textContent = CAM.panZ;
    const rad = CAM.angle * Math.PI / 180;
    const h = Math.round(Math.sin(rad) * CAM.dist), b = Math.round(Math.cos(rad) * CAM.dist);
    $('cp-readout').textContent = configLine() + '\n→ height:' + h + '  半徑:' + b + '   (貼這行給我也可)';
  }
  sFov.oninput = (e) => { CAM.fov = +e.target.value; refresh(); };
  sAng.oninput = (e) => { CAM.angle = +e.target.value; refresh(); };
  sDist.oninput = (e) => { CAM.dist = +e.target.value; refresh(); };
  sLook.oninput = (e) => { CAM.lookY = +e.target.value; refresh(); };
  sAzi.oninput = (e) => { CAM.azimuth = +e.target.value; refresh(); };
  sPanX.oninput = (e) => { CAM.panX = +e.target.value; refresh(); };
  sPanZ.oninput = (e) => { CAM.panZ = +e.target.value; refresh(); };
  $('cp-copy').onclick = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(configLine());
    $('cp-copy').textContent = '已複製!'; setTimeout(() => { $('cp-copy').textContent = '複製設定'; }, 1200);
  };
  $('cp-reset').onclick = () => { Object.assign(CAM, DEFAULT); refresh(); };

  // 取消怪物: keep the arena empty so monsters don't clutter / occlude the camera framing.
  let noMob = false;
  function setNoMob(on) {
    noMob = on;
    game.noMonsters = on;
    if (on) { game.enemies.length = 0; game.enemyProjectiles.length = 0; game.bossWarnings.length = 0; }
    else if (game.state === 'playing') spawnWave(); // bring foes back when turned off mid-run
    $('cp-nomob').textContent = on ? '👹 怪物：關' : '👹 怪物：開';
    $('cp-nomob').classList.toggle('on', on);
  }
  $('cp-nomob').onclick = () => setNoMob(!noMob);

  // 鏡頭跟隨 vs 固定:跟隨=追操控角色(單機預設);固定=鎖場地中心(v2 島取景)。
  let follow = true;
  function setFollow(on) {
    follow = on;
    setCamFollow(on);
    $('cp-follow').textContent = on ? '🎯 跟隨：開' : '🎯 跟隨：關';
    $('cp-follow').classList.toggle('on', !on); // highlight when in the non-default (fixed) mode
  }
  $('cp-follow').onclick = () => setFollow(!follow);

  // 參數帶入: paste a "CAM = { ... }" line (the copy output, or any key:value list) and apply it.
  const KEYS = ['fov', 'angle', 'dist', 'azimuth', 'panX', 'panZ', 'lookY'];
  $('cp-apply').onclick = () => {
    const txt = $('cp-import').value;
    let n = 0;
    for (const k of KEYS) {
      const m = txt.match(new RegExp(k + '\\s*[:=]\\s*(-?\\d+(?:\\.\\d+)?)', 'i'));
      if (m) { CAM[k] = +m[1]; n++; }
    }
    $('cp-apply').textContent = n ? `已套用 ${n} 項` : '沒讀到參數';
    setTimeout(() => { $('cp-apply').textContent = '套用貼入的參數'; }, 1300);
    refresh();
  };
  let paused = false;
  function setPause(p) {
    paused = p;
    setPaused(p); // drive the shared main loop
    $('cp-pause').textContent = p ? '▶ 繼續 (P)' : '⏸ 暫停 (P)';
    $('cp-pause').classList.toggle('on', p);
  }
  $('cp-pause').onclick = () => setPause(!paused);
  function toggle(hide) {
    $('cam-panel').classList.toggle('hidden', hide);
    $('cp-show').style.display = hide ? 'block' : 'none';
  }
  $('cp-hide').onclick = () => toggle(true);
  $('cp-show').onclick = () => toggle(false);
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'h') toggle(!$('cam-panel').classList.contains('hidden'));
    if (k === 'p') setPause(!paused);
  });
  refresh();
})();
