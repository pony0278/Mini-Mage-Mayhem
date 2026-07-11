// render-entities.js — 實體特效的每幀重建 (docs/render-module-boundaries.md):
// 箱子(syncProps)/投射物(syncProjectiles)/法陣·爆炸·粒子·地面標記(syncZones)。
// 新法術視覺特效加這裡。外部請走 render.js 門面。
import { W, H } from './constants.js';
import { rnd, clamp } from './utils.js';
import { game } from './state.js';
import { ELEMENT_INFO, isEarthKind } from './data.js';
import { scene, sphereGeo, boxGeo, circleGeo, coneGeo, tetraGeo, torusGeo, octaGeo, colorHex, basicMat, makeBox, makeGlowSphere, matLambert, tmpMat, actorShadow, vividFx, groundMarkers } from './render-core.js';

  // --- interactive props (crates) — rebuilt each frame (few of them) ---
  const propGroup = new THREE.Group(); scene.add(propGroup);
  export function syncProps() {
    propGroup.clear();
    for (const pr of game.props) {
      if (actorShadow && !pr.held) { // 箱子底部陰影
        const sh = new THREE.Mesh(circleGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }));
        sh.rotation.x = -Math.PI / 2; sh.position.set(pr.x, 1.5, pr.y); sh.scale.set(pr.r * 1.6, pr.r * 1.15, 1); propGroup.add(sh);
      }
      const charged = pr.charge === 'lightning', burning = pr.charge === 'fire';
      const cracked = pr.hp < pr.maxHp;
      const ice = pr.wall === 'ice', earth = pr.wall === 'earth'; // ★3 風掌牆碎塊（冰=藍/土=石灰）
      const col = burning ? 0xff7a3a : charged ? 0x6fb8d8 : ice ? 0x9fd8e8 : earth ? 0x8a8276 : (cracked ? 0x9c7038 : 0xb98a52);
      const emis = burning ? 0xff5a20 : charged ? 0x4fc8ff : (ice ? 0x2a6a88 : 0x000000);
      const s = pr.r * 1.9;
      const lift = (pr.held ? pr.r * 2.0 : 0) + (pr.fly || 0);   // held=浮在頭上;fly=被丟的拋物線視覺高度(v2.js 算;影子留地面讀高度)
      const box = makeBox(s, s, s, col, emis, (charged || burning || ice) ? 0.6 : 0);
      box.position.set(pr.x, pr.r * 0.95 + lift, pr.y);
      box.rotation.y = (pr.x + pr.y) * 0.01 + (pr.held ? game.time * 1.5 : 0) + (pr.fly ? game.time * 5 : 0);   // 飛行中快速翻滾
      propGroup.add(box);
      const cap = makeBox(s * 1.04, 3, s * 1.04, burning ? 0x9c4422 : charged ? 0x3a7a90 : ice ? 0x6aa8c0 : earth ? 0x5a564e : 0x7a5a32);
      cap.position.set(pr.x, pr.r * 1.9 + lift, pr.y); cap.rotation.y = box.rotation.y; propGroup.add(cap);
      if (charged) { const g = makeGlowSphere(pr.r * 1.7, 0x9fe7ff, 0.3); g.position.set(pr.x, pr.r + lift, pr.y); propGroup.add(g); }
      else if (ice) { const g = makeGlowSphere(pr.r * 1.7, 0xcdf2ff, 0.22); g.position.set(pr.x, pr.r + lift, pr.y); propGroup.add(g); }
      if (pr.held) { const g = makeGlowSphere(pr.r * 2.1, 0xdff3ff, 0.26); g.position.set(pr.x, pr.r * 0.95 + lift, pr.y); propGroup.add(g); }
    }
  }

  // --- projectiles + ground effect discs (rebuilt each frame) ---
  const PROJZ = 18;
  const projGroup = new THREE.Group(); scene.add(projGroup);
  const zoneGroup = new THREE.Group(); scene.add(zoneGroup);
  function clearDynamic(grp) {
    for (const c of grp.children) {
      if (c.geometry && c.geometry.__tmp) c.geometry.dispose();
      if (c.material && c.material.__tmp) c.material.dispose();
    }
    grp.clear();
  }
  function ball(x, y, r, hex) {
    const m = new THREE.Mesh(sphereGeo, basicMat(hex));
    m.position.set(x, PROJZ, y); m.scale.setScalar(r);
    projGroup.add(m);
  }
  function addProjectileModel(kind, x, y, r, hex, vx = 0, vy = 1) {
    const a = Math.atan2(vx, vy);
    let m;
    if (kind === 'ice' || kind === 'frost_shock' || kind === 'venom_frost') {
      m = new THREE.Mesh(octaGeo, tmpMat(hex, 1));
      m.scale.set(r * 1.05, r * 1.05, r * 2.2);
      m.rotation.y = a;
    } else if (kind === 'lightning' || kind === 'toxic_shock') {
      m = new THREE.Mesh(tetraGeo, tmpMat(hex, 1, true));
      m.scale.set(r * 1.0, r * 1.0, r * 1.8);
      m.rotation.y = a + game.time * 7;
    } else if (kind === 'steam') {
      m = new THREE.Mesh(sphereGeo, tmpMat(0xeaffff, 0.42, true));
      m.scale.set(r * 2.1, r * 1.25, r * 2.1);
    } else if (kind === 'poison' || kind === 'toxic_boom') {
      m = new THREE.Mesh(sphereGeo, tmpMat(hex, 0.82, true));
      m.scale.setScalar(r * 1.35);
    } else if (isEarthKind(kind)) {                 // a tumbling angular rock
      m = new THREE.Mesh(tetraGeo, tmpMat(hex, 1, kind === 'magma'));
      m.scale.setScalar(r * 1.55);
      m.rotation.set(game.time * 4, game.time * 5 + a, a);
    } else {
      m = new THREE.Mesh(sphereGeo, tmpMat(hex, 1, kind === 'plasma' || kind === 'fire'));
      m.scale.setScalar(r * 1.25);
    }
    m.position.set(x, PROJZ, y);
    projGroup.add(m);
    const glow = new THREE.Mesh(sphereGeo, tmpMat(hex, 0.18, true));
    glow.scale.setScalar(r * (kind === 'steam' ? 3.1 : 2.35));
    glow.position.set(x, PROJZ, y);
    projGroup.add(glow);
  }
  export function syncProjectiles() {
    clearDynamic(projGroup);
    if (game.plasmaOrb && game.state === 'playing' && game.stats.capstone === 'plasma') { // 電漿風暴: roaming plasma orb
      const o = game.plasmaOrb, R = 13 + game.stats.size * 1.5;
      addProjectileModel('plasma', o.x, o.y, R, 0x9fe7ff, o.vx, o.vy);
      const halo = new THREE.Mesh(sphereGeo, tmpMat(0xffb46a, 0.2, true)); halo.scale.setScalar(R * 3.2); halo.position.set(o.x, PROJZ, o.y); projGroup.add(halo);
    }
    for (const fb of game.fireballs) addProjectileModel(fb.kind, fb.x, fb.y, (fb.r || 7) * 1.25, colorHex(fb.color || '#ffffff'), fb.vx, fb.vy);
    for (const b of game.enemyProjectiles) addProjectileModel('fire', b.x, b.y, (b.r || 6) * 1.15, colorHex(b.color || '#ff8c4d'), b.vx, b.vy);
    for (const ib of game.iceBolts) addProjectileModel('ice', ib.x, ib.y, (ib.r || 6) * 1.3, 0xbff4ff, ib.vx, ib.vy);
    for (const lb of game.lightningBolts) {
      const midX = (lb.x1 + lb.x2) / 2 + Math.sin(game.time * 24 + lb.x1) * 8;
      const midY = (lb.y1 + lb.y2) / 2 + Math.cos(game.time * 21 + lb.y1) * 8;
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(lb.x1, PROJZ + 3, lb.y1),
        new THREE.Vector3(midX, PROJZ + 10, midY),
        new THREE.Vector3(lb.x2, PROJZ + 3, lb.y2)]);
      geo.__tmp = true;
      const mat = new THREE.LineBasicMaterial({ color: 0xe5fcff, transparent: true, opacity: clamp(lb.life / lb.maxLife, 0, 1) }); mat.__tmp = true;
      projGroup.add(new THREE.Line(geo, mat));
    }
  }
  function disc(x, y, r, hex, op) {
    const mat = tmpMat(hex, op, true);
    mat.depthWrite = false;
    const m = new THREE.Mesh(circleGeo, mat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, 1.5, y); m.scale.setScalar(Math.max(1, r));
    zoneGroup.add(m);
  }
  // Tier B 假扭曲(無 post-process):程序噪點貼圖(空氣 shimmer)+ 軟邊壓力透鏡;?fx=low 剝除(額外半透明繪製)。
  const WIND_FX_LOW = (typeof location !== 'undefined') && new URLSearchParams(location.search).get('fx') === 'low';
  function makeNoiseTex() { // 柔化白噪=紊流狀 shimmer 底(一次性)
    const s = 64, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const c = cv.getContext('2d'), img = c.createImageData(s, s);
    for (let i = 0; i < s * s; i++) { const v = Math.random() * 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    c.putImageData(img, 0, 0);
    try { c.filter = 'blur(2.5px)'; c.drawImage(cv, 0, 0); c.filter = 'none'; } catch (e) {}
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }
  function makeSoftTex() { // 徑向漸層軟點(壓力透鏡殼用)
    const s = 64, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const c = cv.getContext('2d'), g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.3)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, s, s);
    return new THREE.CanvasTexture(cv);
  }
  const windNoiseTex = (!WIND_FX_LOW && typeof document !== 'undefined') ? makeNoiseTex() : null;
  const softTex = (!WIND_FX_LOW && typeof document !== 'undefined') ? makeSoftTex() : null;
  function windHaze(cx, cy, a, cone, rOut, yy, op, scroll) { // 噪點扇形(往外滾=氣流 shimmer;加法混合)
    const segs = 22, pos = [], uv = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      const p = a - cone + 2 * cone * (i / segs), c = Math.cos(p), s = Math.sin(p), u = i / segs;
      pos.push(cx, yy, cy, cx + c * rOut, yy, cy + s * rOut); uv.push(u, 0, u, 3);
    }
    for (let i = 0; i < segs; i++) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.__tmp = true;
    windNoiseTex.offset.y = scroll;
    const mat = new THREE.MeshBasicMaterial({ map: windNoiseTex, color: 0xbfeaff, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }); mat.__tmp = true;
    zoneGroup.add(new THREE.Mesh(g, mat));
  }
  function softBloom(x, y, r, hex, op) { // 軟邊壓力透鏡殼(徑向漸層軟點,平鋪)
    const g = new THREE.PlaneGeometry(1, 1); g.__tmp = true;
    const mat = new THREE.MeshBasicMaterial({ map: softTex, color: hex, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }); mat.__tmp = true;
    const m = new THREE.Mesh(g, mat); m.rotation.x = -Math.PI / 2; m.position.set(x, 5, y); m.scale.set(r * 2, r * 2, 1);
    zoneGroup.add(m);
  }
  // 風壓手套扇形:頂點在 (cx,cy)、朝世界角 a 張開 ±cone、內外半徑 rIn..rOut,平鋪地板(quad strip;rIn=0=派形填充)。
  function windSector(cx, cy, a, cone, rIn, rOut, yy, hex, op) {
    const segs = 22, pos = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      const p = a - cone + 2 * cone * (i / segs), c = Math.cos(p), s = Math.sin(p);
      pos.push(cx + c * rIn, yy, cy + s * rIn, cx + c * rOut, yy, cy + s * rOut);   // 世界(x,y)→3D(x,高,z=y)
    }
    for (let i = 0; i < segs; i++) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.__tmp = true;
    const mat = tmpMat(hex, op, true); mat.depthWrite = false; mat.side = THREE.DoubleSide;
    zoneGroup.add(new THREE.Mesh(g, mat));
  }
  function windStreak(cx, cy, p, r0, r1, hex, op) { // 放射狀風絲(手心往外一條線)
    const g = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(cx + Math.cos(p) * r0, 6, cy + Math.sin(p) * r0),
      new THREE.Vector3(cx + Math.cos(p) * r1, 6, cy + Math.sin(p) * r1)]);
    g.__tmp = true;
    const m = new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: op }); m.__tmp = true;
    zoneGroup.add(new THREE.Line(g, m));
  }
  function puff(x, y, r, hex, op, n = 5, height = 14) {
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + game.time * 0.25;
      const d = r * (0.12 + (i % 3) * 0.13);
      const m = new THREE.Mesh(sphereGeo, tmpMat(hex, op, true));
      const s = r * (0.16 + (i % 2) * 0.05);
      m.scale.set(s * 1.25, s * 0.75, s * 1.25);
      m.position.set(x + Math.cos(a) * d, height + Math.sin(game.time * 2 + i) * 3, y + Math.sin(a) * d);
      zoneGroup.add(m);
    }
  }
  export function syncZones() {
    clearDynamic(zoneGroup);
    // ground markers: glowing ground rings — 青綠實驗艙光 / 橘·紫危險區提示 (v2 sets these each frame)
    for (const mk of groundMarkers) {
      const hex = colorHex(mk.color);
      const pulse = mk.pulse ? 0.55 + 0.45 * Math.sin(game.time * (mk.speed || 4)) : 1;
      disc(mk.x, mk.y, mk.r, hex, (mk.fill != null ? mk.fill : 0.12) * (0.6 + 0.4 * pulse));
      const ring = new THREE.Mesh(torusGeo, tmpMat(hex, (mk.op != null ? mk.op : 0.6) * (0.55 + 0.45 * pulse), true));
      ring.rotation.x = -Math.PI / 2; ring.position.set(mk.x, 3, mk.y); ring.scale.set(mk.r, mk.r, mk.r);
      zoneGroup.add(ring);
    }
    // capstone 凍毒領域: a frost-venom field that follows the player (radius kept in sync by sim)
    if (game.state === 'playing' && game.stats.capstone === 'frostpoison') {
      const p = game.player, r = game.frostAuraR || 116;
      const pulse = 0.17 + 0.06 * Math.sin(game.time * 3);
      disc(p.x, p.y, r, 0x6fd8c0, pulse);              // teal frost-venom field
      disc(p.x, p.y, r * 0.66, 0xa7ff45, pulse * 0.55); // toxic inner ring
      puff(p.x, p.y, r, 0xbff4ff, pulse * 0.7, 6, 12);
    }
    // capstone 劇毒電網: a charged poison field that follows the player
    if (game.state === 'playing' && game.stats.capstone === 'venomnet') {
      const p = game.player, r = game.venomNetR || 116;
      const pulse = 0.17 + 0.07 * Math.sin(game.time * 4);
      disc(p.x, p.y, r, 0x9a4fd0, pulse);               // purple poison field
      disc(p.x, p.y, r * 0.6, 0x79dcff, pulse * 0.5);   // electric inner core
      puff(p.x, p.y, r, 0xc98cff, pulse * 0.7, 6, 12);
    }
    // capstone 大地崩毀: a poison quagmire expanding under the player
    if (game.state === 'playing' && game.stats.capstone === 'quagmire') {
      const p = game.player, r = game.quagmireR || 90;
      const pulse = 0.2 + 0.05 * Math.sin(game.time * 2.5);
      disc(p.x, p.y, r, 0x6b7a3a, pulse);               // murky earthen swamp
      disc(p.x, p.y, r * 0.7, 0x8a36c8, pulse * 0.5);   // poison core
      puff(p.x, p.y, r, 0xa7c044, pulse * 0.7, 6, 9);
    }
    for (const pc of game.poisonClouds) {
      const a = 0.32 * clamp(pc.life / pc.maxLife, 0, 1);
      disc(pc.x, pc.y, pc.r, 0x8a36c8, a);
      puff(pc.x, pc.y, pc.r, 0xa7ff45, a * 0.75, 5, 18);
      if (Math.floor(game.time * 8 + pc.x) % 3 === 0) disc(pc.x, pc.y, pc.r * 0.42, 0xcfff6f, a * 0.5);
    }
    for (const sc of game.steamClouds) {
      const a = 0.28 * clamp(sc.life / sc.maxLife, 0, 1);
      disc(sc.x, sc.y, sc.r, 0xeaffff, a * 0.65);
      puff(sc.x, sc.y, sc.r, 0xf4ffff, a, 8, 24);
    }
    for (const fz of game.fireZones) {
      const a = 0.40 * clamp(fz.life / fz.maxLife, 0, 1);
      disc(fz.x, fz.y, fz.r, 0xff7a3e, a);
      for (let i = 0; i < 3; i++) {
        const flame = new THREE.Mesh(coneGeo, tmpMat(i % 2 ? 0xffd36d : 0xff673a, a * 1.2, true));
        const ang = game.time * 3 + i * 2.1;
        flame.scale.set(fz.r * .10, fz.r * .28, fz.r * .10);
        flame.position.set(fz.x + Math.cos(ang) * fz.r * .28, 9 + i * 2, fz.y + Math.sin(ang) * fz.r * .18);
        zoneGroup.add(flame);
      }
    }
    for (const ez of game.electricZones) {
      const a = 0.30 * clamp(ez.life / ez.maxLife, 0, 1);
      disc(ez.x, ez.y, ez.r, 0x79dcff, a);
      const ring = new THREE.Mesh(torusGeo, tmpMat(0xbdf5ff, a * 1.5, true));
      ring.rotation.x = -Math.PI / 2; ring.position.set(ez.x, 4, ez.y); ring.scale.set(ez.r, ez.r, ez.r);
      zoneGroup.add(ring);
    }
    for (const w of game.bossWarnings) {
      disc(w.x, w.y, w.r, 0xffd36d, 0.20);
      const ring = new THREE.Mesh(torusGeo, tmpMat(0xffd36d, 0.62, true));
      ring.rotation.x = -Math.PI / 2; ring.position.set(w.x, 5, w.y); ring.scale.set(w.r, w.r, w.r); zoneGroup.add(ring);
    }
    for (const ex of game.explosions) {
      const t = 1 - ex.life / ex.maxLife;
      disc(ex.x, ex.y, ex.r * (0.45 + t * 0.75), 0xffd36d, 0.28 * (ex.life / ex.maxLife));
      puff(ex.x, ex.y, ex.r, 0xff7640, 0.22 * (ex.life / ex.maxLife), 6, 30);
    }
    for (const rg of game.rings) { // expanding shockwave rings (shove/contain/boom). vivid adds a bright torus outline.
      const life = clamp(rg.life / rg.maxLife, 0, 1), rr = rg.r * (0.5 + (1 - life) * 0.7), hex = colorHex(rg.color);
      disc(rg.x, rg.y, rr, hex, (vividFx ? 0.24 : 0.16) * life);
      if (vividFx) { const ring = new THREE.Mesh(torusGeo, tmpMat(hex, 0.55 * life, true)); ring.rotation.x = -Math.PI / 2; ring.position.set(rg.x, 4, rg.y); ring.scale.set(rr, rr, rr); zoneGroup.add(ring); }
    }
    for (const s of game.slams) {
      const k = clamp(s.life / s.maxLife, 0, 1);   // 1→0 (fade)
      const t = 1 - k;                              // 0→1 (expand)
      const P = s.power;
      // leading shock ring punched out along the aim
      const lead = (40 + t * 70) * P;
      const lx = s.x + Math.cos(s.angle) * lead, ly = s.y + Math.sin(s.angle) * lead;
      const rr = (24 + t * 50) * P;
      const ring = new THREE.Mesh(torusGeo, tmpMat(s.hex, 0.95 * k, true));
      ring.rotation.x = -Math.PI / 2; ring.position.set(lx, 6, ly); ring.scale.set(rr, rr, rr * 0.85);
      zoneGroup.add(ring);
      const ring2 = new THREE.Mesh(torusGeo, tmpMat(s.hex, 0.6 * k, true)); // inner ring takes the stance colour (was always white)
      ring2.rotation.x = -Math.PI / 2; ring2.position.set(lx, 7, ly); ring2.scale.set(rr * 0.62, rr * 0.62, rr * 0.55);
      zoneGroup.add(ring2);
      // forward contact pop tinted by stance, + a SMALL white hot-core (so 土拳 reads earthy, not "a white circle")
      disc(s.x + Math.cos(s.angle) * 24 * P, s.y + Math.sin(s.angle) * 24 * P, 28 * P * (0.8 + t * 0.4), s.hex, 0.45 * k);
      disc(s.x + Math.cos(s.angle) * 20 * P, s.y + Math.sin(s.angle) * 20 * P, 11 * P, 0xffffff, 0.4 * k);
      for (let i = 0; i < 3; i++) {
        const d = ((22 + i * 28) + t * 56) * P;
        const dr = ((20 + i * 11) * (0.75 + t * 0.85)) * P;
        disc(s.x + Math.cos(s.angle) * d, s.y + Math.sin(s.angle) * d, dr, s.hex, 0.42 * k * (1 - i * 0.2));
      }
      puff(lx, ly, 26 * P, s.hex, 0.3 * k, 6, 14);
    }
    // 風壓手套起手預告:淡扇形 + 外緣射程弧(靜態、脈衝;讀範圍/多遠)
    for (const wa of game.windAims) {
      const pulse = 0.5 + 0.5 * Math.sin(game.time * 8);
      windSector(wa.x, wa.y, wa.angle, wa.cone, 0, wa.range, 2, 0xbfeaff, 0.07 + 0.05 * pulse);
      windSector(wa.x, wa.y, wa.angle, wa.cone, wa.range * 0.88, wa.range, 3, 0xdff3ff, 0.22 + 0.12 * pulse); // 外緣=射程邊界(讀「打多遠」)
    }
    // 風壓手套發射閃:扇形從頂點掃到滿射程(easeOut)+ 亮前緣 + 少量放射狀風絲,再淡出
    for (const wf of game.windFans) {
      const life = clamp(wf.life / wf.maxLife, 0, 1), t = 1 - life;                    // t 0→1
      const sweep = Math.min(1, t / 0.45), eo = 1 - (1 - sweep) * (1 - sweep);          // 前 45% 生命掃到滿(easeOut)
      const fr = wf.range * (0.12 + 0.88 * eo);
      windSector(wf.x, wf.y, wf.angle, wf.cone, 0, fr, 2, 0xbfeaff, 0.30 * life);       // 填充
      windSector(wf.x, wf.y, wf.angle, wf.cone, fr * 0.85, fr, 4, 0xffffff, 0.55 * life); // 亮掃描前緣
      const NS = 12;                                                                     // 風絲加密加長=更爆(半徑/濃淡錯開=陣風感)
      for (let i = 0; i < NS; i++) {
        const p = wf.angle - wf.cone + 2 * wf.cone * ((i + 0.5) / NS);
        windStreak(wf.x, wf.y, p, fr * (0.12 + (i % 3) * 0.06), fr * (0.9 + (i % 2) * 0.12), 0xe5fcff, 0.5 * life * (0.55 + 0.45 * (((i * 7) % 5) / 4)));
      }
      disc(wf.x + Math.cos(wf.angle) * fr * 0.08, wf.y + Math.sin(wf.angle) * fr * 0.08, 22 * life + 6, 0xffffff, 0.45 * life * life); // 槍口閃核心
      if (windNoiseTex) { // Tier B 假扭曲:氣流 shimmer + 前緣壓力透鏡殼(?fx=low 剝除)
        windHaze(wf.x, wf.y, wf.angle, wf.cone, fr, 3, 0.22 * life, -game.time * 0.9);
        softBloom(wf.x + Math.cos(wf.angle) * fr * 0.92, wf.y + Math.sin(wf.angle) * fr * 0.92, 55 + fr * 0.22, 0xdff3ff, 0.28 * life);
      }
    }
    for (const bh of game.blackHoles) {
      disc(bh.x, bh.y, bh.r, 0x2a0f3a, 0.34);
      const t = 1 - bh.life / bh.maxLife;
      const core = new THREE.Mesh(sphereGeo, tmpMat(0x140022, 0.95, false));
      core.scale.setScalar(10 + t * 8); core.position.set(bh.x, 16, bh.y); zoneGroup.add(core);
      const ringm = new THREE.Mesh(torusGeo, tmpMat(0xb07aff, 0.7, true));
      ringm.rotation.x = -Math.PI / 2; ringm.position.set(bh.x, 4, bh.y);
      const rr = bh.r * (0.62 - t * 0.4); ringm.scale.set(rr, rr, rr); zoneGroup.add(ringm);
    }
    // 雷印 (lightning mark): a crackling cyan ring hovering over marked foes — dash through them
    // while in 雷掌 (or a lightning dash) to detonate the mark. (雷掌 signature, B 招牌差異化)
    for (const e of game.enemies) {
      if (e.dead || !(e.lightMark > 0)) continue;
      const fl = 0.55 + 0.45 * Math.sin(game.time * 24 + e.x * 0.3); // electric crackle flicker
      const m = new THREE.Mesh(torusGeo, tmpMat(0x9fe7ff, 0.4 + fl * 0.45, true));
      m.rotation.x = -Math.PI / 2; const s = 8 + fl * 3;
      m.position.set(e.x, 32, e.y); m.scale.set(s, s, s * 0.9);
      zoneGroup.add(m);
    }
    // Particles (dust, rock bits, sparks, gust streaks, death bursts…). The sim emits + updates these,
    // but the 3D build never had a draw pass for them — so ALL particle FX were invisible. Draw them as
    // small element-coloured voxel chunks (on-brand with the voxel art); opacity fades with life.
    for (const pa of game.particles) {
      const op = clamp(pa.life / pa.maxLife, 0, 1);
      // non-additive so solid bits (rock/dust) read as their real colour instead of blowing out to white when they pile up
      const m = new THREE.Mesh(boxGeo, tmpMat(colorHex(pa.color), 0.92 * op, false));
      const s = Math.max(1.5, pa.r * 1.7);
      m.position.set(pa.x, 9, pa.y); m.scale.set(s, s, s);
      zoneGroup.add(m);
    }
  }
