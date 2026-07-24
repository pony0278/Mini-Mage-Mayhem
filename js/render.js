// render.js — 渲染層門面 (docs/render-module-boundaries.md):外部(main.js/v2*/panels)
// 永遠只從這裡 import;子模組(core/world/actors/entities/hud)是內部實作。
// 本檔持有 render3D() 每幀編排(場地→攝影機定位/震屏/鏡頭踹→角色→實體→穿牆淡出)。
import { W, H } from './constants.js';
import { rnd } from './utils.js';
import { game, CAM } from './state.js';
import { renderer, gl3dOk, scene, camera, setStockLights } from './render-core.js';
import { islandMode, freeIslands, syncIsland, drawGroundTexture, syncWalls, updateWallFade, setStockGroundVisible, setStockWallsVisible, setToyboxDecorVisible, setWallFade as _setWallFade } from './render-world.js';
import { initLabScene, updateLabScene } from './render-lab.js';
export { setLabFlicker } from './render-lab.js'; // 減閃爍(光敏無障礙):凍結 lab 脈動光
export { setStationsPowered } from './render-lab.js'; // 四角站通電光環(拉閘因果演出;v2.js 依 v2s.stationsArmed 切換)
export { setPodPerform } from './render-lab.js'; // 收容演出玻璃罩+掃描環(v2.js 每幀依 v2s.perform 驅動)
export { FX_LOW } from './render-lab.js'; // 低效能旗(手機自動/?fx= 覆蓋;v2-hud 用來砍爆花速度線/集中線)
import { syncActors } from './render-actors.js';
import { syncProps, syncProjectiles, syncZones } from './render-entities.js';
import { updateWindBlasts } from './render-wind-blast.js';

// 公開 API re-export(引用方 import 零改動)
export { project, mouseScreen, updateMouseWorld, camera, setActorShadow, setVividFx, setGroundMarkers } from './render-core.js';
export { setRichFloor, setFloorParams, getFloorParams, setFloorSubtle, setWallFade, setIslandMode, setIslandShapes, setApron } from './render-world.js';
export { refreshActors } from './render-actors.js';
export { ANIM } from './actor-brawler.js'; // 程序動作參數表(?tune=1 跑步彈跳/stridePx 等 live 調參用;物件可變)
export { draw, drawPanicFaces } from './render-hud.js';

// v2 實驗室場景(復刻原型):ACES 管線 + emissive 地板 + 魔法陣;藏舊地板、舊牆壓暗過渡
let labOn = false;
export function setLabTheme(on) {
  labOn = on;
  setStockLights(!on); // lab 燈組接管,關掉單機常設燈(疊加會過曝)
  if (on) { initLabScene(); setStockGroundVisible(false); setStockWallsVisible(false); setToyboxDecorVisible(false); _setWallFade(false); } // 舊牆+童趣裝飾整組隱藏;lab 邊界=力場矮緣,不擋視線無需淡出
  else { setStockGroundVisible(true); setStockWallsVisible(true); setToyboxDecorVisible(true); }
}

// camera-sandbox 的跟隨開關(camTarget 存在時被覆寫)
  // false = lock onto the arena centre (the v2 fixed-diorama framing). Toggled from the camera sandbox.
  let camFollow = true;
  export function setCamFollow(on) { camFollow = on; }

  export function render3D() {
    if (!gl3dOk) return;
    if (!freeIslands) { if (!labOn) drawGroundTexture(); syncWalls(); if (islandMode) syncIsland(); }
    if (labOn) updateLabScene(game.time); // lab 場景動畫(魔法陣/之後的元素站等)
    syncProps();
    // Camera target: an explicit game.camTarget (v2 follows one fighter) wins; else the player when
    // following; else the arena centre (fixed framing). camTarget overrides the sandbox follow toggle.
    const camObj = game.camTarget || (camFollow ? game.player : null);
    const px = camObj ? camObj.x : W / 2;
    const pz = camObj ? camObj.y : H / 2;
    let shx = 0, shz = 0;
    if (game.screenShake > 0) { shx = rnd(-game.screenShake, game.screenShake); shz = rnd(-game.screenShake, game.screenShake); }
    shx += game.kickX || 0; shz += game.kickY || 0; // 方向性鏡頭踹(命中瞬間往擊打方向頂一下,v2 sim 快速衰減)
    const _pit = CAM.angle * Math.PI / 180, _az = CAM.azimuth * Math.PI / 180;
    const _hr = Math.cos(_pit) * CAM.dist;
    const _tx = px + CAM.panX, _tz = pz + CAM.panZ;
    camera.position.set(_tx + Math.sin(_az) * _hr + shx, Math.sin(_pit) * CAM.dist, _tz + Math.cos(_az) * _hr + shz);
    camera.lookAt(_tx, CAM.lookY, _tz);
    if (camera.fov !== CAM.fov) { camera.fov = CAM.fov; camera.updateProjectionMatrix(); } // live fov (camera-sandbox); no-op otherwise
    syncActors();
    syncProjectiles();
    syncZones();
    updateWindBlasts(); // 風壓手套開火 3D 爆發(item-4e;persistent pool,不進 zoneGroup 每幀重建)
    updateWallFade(); // see-through walls: fade any wall between camera and the followed character
    renderer.render(scene, camera);
  }
