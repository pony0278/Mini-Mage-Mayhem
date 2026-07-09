// render-actors.js — 角色體素建模+程序動畫 (docs/render-module-boundaries.md):
// 單機巫師(buildPlayer/updatePlayerMesh)、敵人全型(slime/bug/imp/charger/boss/brawler)、
// updateActor(走路/三段拳/扛人/暈眩/flinch)、syncActors。人物比例/動作改這裡。
// 外部請走 render.js 門面。
import { W, H } from './constants.js';
import { game, mouse } from './state.js';
import { ELEMENT_INFO } from './data.js';
import { dashElement } from './sim.js';
import { scene, circleGeo, octaGeo, colorHex, matLambert, makeBox, makeGlowSphere, actorShadow } from './render-core.js';
import { freeIslands } from './render-world.js';
import { buildBrawler, updateBrawler, BRAWLER_SPEC } from './actor-brawler.js';

  // --- actor (player + enemy) voxel meshes ---
  const actorMeshes = new Map();
  let playerMesh = null;
  // 被扛者拎頭吊掛:頭頂貼扛者手、繞頭以 clip 的 carry_tilt(pitch)/carry_yaw(yaw)旋轉 + carry_o* 手局部偏移。
  // 掙扎姿勢(四肢亂踢)仍由 updateBrawler 套在 rig 上;這裡只覆蓋 g 的世界位置+朝向(比照 punch-studio 幽靈)。
  const _cD2R = Math.PI / 180, CARRY_HEAD = 44;   // 被扛者頭頂高度(px);拎頭把頭貼到手上
  const _cH = new THREE.Vector3(), _cQp = new THREE.Quaternion(), _cQh = new THREE.Quaternion(), _cHV = new THREE.Vector3(), _cOFF = new THREE.Vector3();
  const _cAX = new THREE.Vector3(1, 0, 0), _cAY = new THREE.Vector3(0, 1, 0);
  function positionCarried(e, g) {
    const cg = actorMeshes.get(e.carriedBy); if (!cg || !cg.userData.rig) return;
    const rig = cg.userData.rig, cp = cg.userData.pose || {};
    rig.armL.wr.getWorldPosition(_cH);                                    // 抓握手=左手腕(clip 的 aL 過頂手)
    rig.armL.wr.getWorldQuaternion(_cQh);
    _cOFF.set((cp.carry_ox || 0) * BRAWLER_SPEC.PX, (cp.carry_oy || 0) * BRAWLER_SPEC.PX, (cp.carry_oz || 0) * BRAWLER_SPEC.PX).applyQuaternion(_cQh);
    _cH.add(_cOFF);                                                       // 掛點 = 手 + 手局部偏移
    _cQp.setFromAxisAngle(_cAX, (cp.carry_tilt || 0) * _cD2R);            // pitch
    g.quaternion.setFromAxisAngle(_cAY, (cp.carry_yaw || 0) * _cD2R).multiply(_cQp);  // R = yaw ∘ pitch(繞頭)
    _cHV.set(0, CARRY_HEAD, 0).applyQuaternion(g.quaternion);
    g.position.set(_cH.x - _cHV.x, _cH.y - _cHV.y, _cH.z - _cHV.z);       // 頭貼掛點,腳沿身體軸擺出
    g.scale.set(1, 1, 1);
  }
  // drop cached voxel meshes so syncActors rebuilds them from the entity's current r (e.g. after resizing fighters)
  export function refreshActors() { for (const g of actorMeshes.values()) scene.remove(g); actorMeshes.clear(); }

  function tintable(group, list, m) { group.add(m); list.push({ mesh: m, base: m.material.color.getHex() }); return m; }

  function buildPlayer() {
    const g = new THREE.Group();
    const shadow = new THREE.Mesh(circleGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.7; shadow.scale.set(17, 11, 1); g.add(shadow);
    const bootL = makeBox(6, 5, 8, 0x1d1826); bootL.position.set(-5, 3, 0); g.add(bootL);
    const bootR = makeBox(6, 5, 8, 0x1d1826); bootR.position.set(5, 3, 0); g.add(bootR);
    const body = makeBox(22, 24, 16, 0x6c45ff, 0x22134a, 0.18); body.position.y = 16; g.add(body);
    const robeGlow = makeBox(24, 4, 17, 0xffd36d, 0xff9a4d, 0.18); robeGlow.position.y = 19; g.add(robeGlow);
    const scarf = makeBox(25, 5, 18, 0xffcc56); scarf.position.y = 27; g.add(scarf);
    const head = makeBox(15, 13, 13, 0xffd7b0); head.position.y = 35; g.add(head);
    const eyeL = makeBox(3, 3.5, 1.2, 0x76e7ff, 0x76e7ff, 0.55); eyeL.position.set(-4, 36, 6.8); g.add(eyeL);
    const eyeR = makeBox(3, 3.5, 1.2, 0x76e7ff, 0x76e7ff, 0.55); eyeR.position.set(4, 36, 6.8); g.add(eyeR);
    const brim = makeBox(34, 5, 30, 0x321b77, 0x160a38, 0.14); brim.position.y = 44; g.add(brim);
    const band = makeBox(25, 4, 23, 0xffc85a, 0xff9a4d, 0.15); band.position.y = 47; g.add(band);
    const hat2 = makeBox(20, 9, 20, 0x4c25bd, 0x160a38, 0.12); hat2.position.y = 53; g.add(hat2);
    const hat3 = makeBox(12, 10, 12, 0x6b35df, 0x260c54, 0.15); hat3.position.y = 63; g.add(hat3);
    const hat4 = makeBox(6, 7, 6, 0x9b6cff, 0x5c35d8, 0.18); hat4.position.y = 72; g.add(hat4);
    const orb = makeGlowSphere(10, 0xffcc56, 0.28); orb.position.y = 78; g.add(orb);
    const orbCore = new THREE.Mesh(octaGeo, matLambert(0xffcc56, 0xffcc56, 0.9)); orbCore.scale.set(5.5, 5.5, 5.5); orbCore.position.y = 78; g.add(orbCore);
    const staff = makeBox(3.2, 48, 3.2, 0x8a5f35); staff.position.set(15, 28, 9); g.add(staff);
    const sOrb = makeGlowSphere(11, 0xffcc56, 0.34); sOrb.position.set(15, 55, 9); g.add(sOrb);
    const sCore = new THREE.Mesh(octaGeo, matLambert(0xffcc56, 0xffcc56, 1)); sCore.scale.set(6.5, 6.5, 6.5); sCore.position.set(15, 55, 9); g.add(sCore);
    const familiar = new THREE.Mesh(octaGeo, matLambert(0x9fe7ff, 0x9fe7ff, 0.75)); familiar.scale.set(7, 7, 7); g.add(familiar);
    // brawler fists (shown only in fist mode; thrust forward when punching)
    const armL = makeBox(8, 8, 11, 0xffd7b0); armL.position.set(-13, 22, 6); armL.visible = false; g.add(armL);
    const armR = makeBox(8, 8, 11, 0xffd7b0); armR.position.set(13, 22, 6); armR.visible = false; g.add(armR);
    g.userData.orb = orb; g.userData.orbCore = orbCore; g.userData.sOrb = sOrb; g.userData.sCore = sCore; g.userData.familiar = familiar;
    g.userData.armL = armL; g.userData.armR = armR;
    g.userData.armLBase = armL.position.clone(); g.userData.armRBase = armR.position.clone();
    return g;
  }
  function updatePlayerMesh() {
    const p = game.player;
    playerMesh.position.set(p.x, 0, p.y);
    playerMesh.rotation.y = Math.atan2(mouse.x - p.x, mouse.y - p.y);
    const col = colorHex((ELEMENT_INFO[game.stats.spellKind] && ELEMENT_INFO[game.stats.spellKind].color) || '#ffcc56');
    for (const k of ['orb','orbCore','sOrb','sCore']) {
      const m = playerMesh.userData[k];
      if (m && m.material) {
        m.material.color.setHex(col);
        if (m.material.emissive) m.material.emissive.setHex(col);
      }
    }
    const fam = playerMesh.userData.familiar;
    if (fam) {
      const a = game.time * 2.2;
      fam.position.set(Math.cos(a) * 24, 31 + Math.sin(a * 1.7) * 5, Math.sin(a) * 18);
      fam.rotation.y += 0.05; fam.rotation.x += 0.035;
    }
    // brawler palm thrust: alternating hands shoot forward (local +Z = aim) on each punch
    const brawler = game.stats.mainMode !== 'spell';
    const armL = playerMesh.userData.armL, armR = playerMesh.userData.armR;
    if (armL && armR) {
      armL.visible = brawler; armR.visible = brawler;
      if (brawler) {
        const baseL = playerMesh.userData.armLBase, baseR = playerMesh.userData.armRBase;
        armL.position.copy(baseL); armR.position.copy(baseR);
        const active = p.fistHand ? armR : armL, idle = p.fistHand ? armL : armR;
        const base = p.fistHand ? baseR : baseL;
        const prog = p.fistAnim > 0 ? Math.sin((1 - p.fistAnim / p.fistAnimMax) * Math.PI) : 0; // 0→1→0
        active.position.z = base.z + prog * 34;          // thrust toward aim
        active.position.x = base.x * (1 - prog * 0.7);   // converge to centre
        active.position.y = base.y + prog * 3;
        // palm glow: stance colour for 雷掌/風掌, else the current element on the fist
        const palmTint = game.stats.mainMode === 'lightpalm' ? '#9fe7ff'
          : game.stats.mainMode === 'windpalm' ? '#dff3ff'
          : (ELEMENT_INFO[dashElement()] && ELEMENT_INFO[dashElement()].color) || '#ffe0bd';
        const ecol = colorHex(palmTint);
        active.material.color.setHex(prog > 0.2 ? ecol : 0xffd7b0);
        if (active.material.emissive) { active.material.emissive.setHex(ecol); active.material.emissiveIntensity = prog * 0.6; }
        idle.material.color.setHex(0xffd7b0);
        if (idle.material.emissive) idle.material.emissiveIntensity = 0;
      }
    }
    const blink = p.invuln > 0 && Math.floor(game.time * 20) % 2 === 0;
    playerMesh.visible = !blink;
  }
  function buildEnemy(e) {
    const g = new THREE.Group(); const r = e.r; const tints = [];
    const base = colorHex(e.color);
    const black = 0x17101c;
    if (e.type === 'slime') {
      const b = tintable(g, tints, makeBox(r * 2.05, r * 1.35, r * 2.05, base, base, 0.05)); b.position.y = r * 0.72;
      const shine = makeBox(r * 0.7, 3, r * 0.6, 0xb5ffb0); shine.position.set(-r * .25, r * 1.23, r * .35); g.add(shine);
      const eL = makeBox(3.8, 4.5, 1.3, black); eL.position.set(-r * 0.4, r * 1.0, r * 1.05); g.add(eL);
      const eR = makeBox(3.8, 4.5, 1.3, black); eR.position.set(r * 0.4, r * 1.0, r * 1.05); g.add(eR);
    } else if (e.type === 'bug') {
      const b = tintable(g, tints, makeBox(r * 1.65, r * 1.25, r * 2.05, base, 0x552a88, 0.14)); b.position.y = r * 0.9;
      const shell = makeBox(r * 1.25, 4, r * 1.7, 0x3c2855); shell.position.y = r * 1.55; g.add(shell);
      for (let i = -1; i <= 1; i++) { const legL = makeBox(3, 3, r * .7, 0x2a1a3d); legL.position.set(-r * .95, r * .55, i * r * .55); g.add(legL); const legR = makeBox(3, 3, r * .7, 0x2a1a3d); legR.position.set(r * .95, r * .55, i * r * .55); g.add(legR); }
      const eL = makeBox(4, 4, 1.2, 0xff7aff, 0xff7aff, 0.6); eL.position.set(-r * 0.42, r * 1.18, r * 1.05); g.add(eL);
      const eR = makeBox(4, 4, 1.2, 0xff7aff, 0xff7aff, 0.6); eR.position.set(r * 0.42, r * 1.18, r * 1.05); g.add(eR);
    } else if (e.type === 'imp') {
      const b = tintable(g, tints, makeBox(r * 1.55, r * 1.85, r * 1.55, base, 0x66220c, 0.12)); b.position.y = r * 0.95;
      const belly = makeBox(r * .75, r * .65, 2, 0xffbd66); belly.position.set(0, r * 0.95, r * .8); g.add(belly);
      const hornL = makeBox(3.4, r * 0.85, 3.4, 0xffe0a3); hornL.position.set(-r * 0.45, r * 2.02, 0); g.add(hornL);
      const hornR = makeBox(3.4, r * 0.85, 3.4, 0xffe0a3); hornR.position.set(r * 0.45, r * 2.02, 0); g.add(hornR);
      const eL = makeBox(3.7, 3.7, 1.2, 0xfff0a3, 0xffdf7a, 0.5); eL.position.set(-r * 0.35, r * 1.3, r * 0.75); g.add(eL);
      const eR = makeBox(3.7, 3.7, 1.2, 0xfff0a3, 0xffdf7a, 0.5); eR.position.set(r * 0.35, r * 1.3, r * 0.75); g.add(eR);
    } else if (e.type === 'brawler') {
      // v2 收容測試的關節化體素小人:建模規格表(BRAWLER_SPEC)+組裝都在 actor-brawler.js
      buildBrawler(g, tints, tintable, base);
    } else if (e.type === 'charger') {
      const b = tintable(g, tints, makeBox(r * 1.75, r * 1.65, r * 1.5, 0xb9925e)); b.position.y = r * 0.8;
      const helm = makeBox(r * 1.55, r * 0.75, r * 1.35, 0x81716b); helm.position.y = r * 1.88; g.add(helm);
      const crest = makeBox(r * .25, r * .65, r * 1.45, 0xffd36d, 0xff9a4d, 0.12); crest.position.y = r * 2.3; g.add(crest);
      const visor = makeBox(r * 1.05, 4.2, 1.4, 0xffd36d, 0xffd36d, 0.45); visor.position.set(0, r * 1.88, r * 0.76); g.add(visor);
      const shield = makeBox(r * 1.58, r * 1.65, 5, 0x9c7a4f); shield.position.set(0, r * 0.98, r * 0.98); g.add(shield);
    } else if (e.type === 'boss') {
      const robe = tintable(g, tints, makeBox(30, 32, 24, 0x33694f, 0x10261c, 0.1)); robe.position.y = 16;
      const head = makeBox(27, 22, 22, 0x66e0a6, 0x224b3a, 0.15); head.position.y = 42; g.add(head);
      const eL = makeBox(5.5, 6.5, 1.4, 0x2b1f34); eL.position.set(-8, 44, 11); g.add(eL);
      const eR = makeBox(5.5, 6.5, 1.4, 0x2b1f34); eR.position.set(8, 44, 11); g.add(eR);
      const hat = makeBox(38, 7, 35, 0x47228d, 0x1d0e38, 0.2); hat.position.y = 57; g.add(hat);
      const crown = makeBox(18, 7, 18, 0xffcc56, 0xff9a4d, 0.16); crown.position.y = 65; g.add(crown);
      const staff = makeBox(4, 54, 4, 0x8a5f35); staff.position.set(23, 31, 9); g.add(staff);
      const staffOrb = new THREE.Mesh(octaGeo, matLambert(0xd998ff, 0xd998ff, 0.9)); staffOrb.scale.set(8, 8, 8); staffOrb.position.set(23, 63, 9); g.add(staffOrb);
      const orbs = [];
      const oc = [0xffbd66, 0xbff4ff, 0x9fe7ff, 0xd998ff];
      for (let i = 0; i < 4; i++) { const o = new THREE.Mesh(octaGeo, matLambert(oc[i], oc[i], 0.85)); o.scale.set(7, 7, 7); g.add(o); orbs.push(o); }
      g.userData.orbs = orbs;
    }
    g.userData.tints = tints;
    // soft elliptical contact shadow grounds the fighter (角色腳下橢圓陰影) so it pops off the floor.
    // v2-only (freeIslands or setActorShadow); single-player enemies unchanged.
    if (freeIslands || actorShadow) {
      const sh = new THREE.Mesh(circleGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
      sh.rotation.x = -Math.PI / 2; sh.position.y = 1.6; sh.scale.set(r * 1.2, r * 0.82, 1); g.add(sh);
    }
    return g;
  }
  function updateActor(e, g) {
    if (e.falling) { // v2 死亡劇場 A: 縮小 + 旋轉 + 沉進洞裡
      const k = Math.max(0, Math.min(1, (e.fallT || 0) / 0.6));
      g.position.set(e.x, -120 * (1 - k), e.y);
      g.rotation.set(0, e.spin || 0, 0);
      g.scale.setScalar(Math.max(0.05, k));
      return;
    }
    g.position.set(e.x, 0, e.y);
    if (e.type === 'slime') g.position.y = Math.abs(Math.sin(game.time * 4 + e.x * 0.1)) * 4;
    if (e.type === 'boss') {
      g.position.y = 28 + Math.sin(game.time * 2) * 4;
      const orbs = g.userData.orbs || [];
      for (let i = 0; i < orbs.length; i++) {
        const a = game.time * (e.phase === 2 ? 2.8 : 1.8) + i * Math.PI / 2;
        orbs[i].position.set(Math.cos(a) * 42, 18 + Math.sin(a) * 12, Math.sin(a) * 42);
      }
    }
    // brawler 的姿勢狀態機(走路/三段拳/扛/被扛/暈眩/flinch)在 actor-brawler.js(ANIM 參數表驅動)
    if (e.type === 'brawler') updateBrawler(e, g);   // 被扛者定位在 syncActors 的後處理(等扛者本幀更新完,手骨才是最新)
    else if (e.type === 'charger') g.rotation.y = Math.atan2(Math.cos(e.facing), Math.sin(e.facing));
    else g.rotation.y = Math.atan2((game.player ? game.player.x - e.x : 0), (game.player ? game.player.y - e.y : 1));
    const tintHex = e.hurt > 0 ? 0xffffff : (e.slowTimer > 0 ? 0xd8fbff : null);
    for (const t of g.userData.tints) t.mesh.material.color.setHex(tintHex != null ? tintHex : t.base);
  }

  export function syncActors() {
    const seen = new Set();
    for (const e of game.enemies) {
      seen.add(e);
      let g = actorMeshes.get(e);
      if (!g) { g = buildEnemy(e); scene.add(g); actorMeshes.set(e, g); }
      updateActor(e, g);
    }
    // 後處理:被扛者定位貼扛者手上(此時所有 actor 本幀已更新,扛者手骨=最新,無 1 幀延遲)
    for (const e of game.enemies) { if (e.type === 'brawler' && e.carriedBy) { const g = actorMeshes.get(e); if (g) positionCarried(e, g); } }
    for (const [e, g] of actorMeshes) {
      if (!seen.has(e)) { scene.remove(g); actorMeshes.delete(e); }
    }
    if (game.player) {
      if (!playerMesh) { playerMesh = buildPlayer(); scene.add(playerMesh); }
      updatePlayerMesh();
    }
  }

