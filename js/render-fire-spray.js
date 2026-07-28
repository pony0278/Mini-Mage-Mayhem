// render-fire-spray.js — 噴火帽開火 flipbook 噴射(burn-2):使用者「chibi_helmet_flipbook_fire」demo 的
// 2D 逐格火焰移植(9 幀 3×3 atlas 768²,assets/scene/fire-flipbook.png=demo 內嵌 base64 抽檔)。
// 定位(使用者拍板 2026-07-28):**動詞用漫畫、狀態用 shader**——攻擊噴射=flipbook 逐格跳動(跟 hitfx
// 漫畫爆花同一套語言);常燃帽口火/燒身火維持 render-burn 的 Gabriel shader 火。
// 形式:castFire 觸發(fx.addFireSpray→game.fireSprays,同 addWindBlast 純訊號),扇形判定區內
// 一排火 poof **由近而遠逐個點燃**(波往外推=「真的噴出去」),每個 poof 播一次 9 幀序列
// (首/末幀停留=demo 滑桿預設)後淡出。鏡頭固定 → billboard 完全成立(demo 同款 sprite 思路)。
// **判定不動**:sim castFire 的扇形=唯一真相,這裡純演出。
// perf(js/CLAUDE.md 特效鐵則):**不加燈**(demo 的 fireLight 拿掉)、pool(2)建一次+per-frame 只改
// uniform/transform、**全部 poof 共用同一張 GL 貼圖**(ShaderMaterial per-poof 只差 off/al uniform,
// 同 shader 原始碼=同 program;不用 texture.clone()=不重複上傳 768²)、載圖後 prewarm、FX_LOW 砍 poof 數。
import { game } from './state.js';
import { scene, renderer, camera } from './render-core.js';
import { FX_LOW } from './render-lab.js';

const COLS = 3, ROWS = 3, FRAMES = 9;
// 播放參數=demo 滑桿預設(fps 9 對攻擊太慢 → 提到 16;首幀停 2/末幀停 2,序列 13 步 ≈ 0.81s)
const FPS = 16, HOLD_FIRST = 2, HOLD_LAST = 2;
const SEQ = [];
for (let i = 0; i < HOLD_FIRST; i++) SEQ.push(0);
for (let i = 1; i < FRAMES - 1; i++) SEQ.push(i);
for (let i = 0; i < HOLD_LAST; i++) SEQ.push(FRAMES - 1);
const FADE_STEPS = 3;                        // 末尾幾步淡出(additive:al 直接乘色)
const POOFS = FX_LOW ? 4 : 7;                // 一發的 poof 數(帽口由近而遠)
const WAVE_V = 300;                          // 點燃波外推速度 px/s(≈ 粒子噴速上緣;100px 扇 0.33s 掃完)
const RISE = 16;                             // 尾段火苗上飄 px/s(火散逸向上;起手段不飄=噴射直進)
// 噴射弧(burn-2b,使用者拍板「從頭頂噴出火舌,不用鋪在地面」):鞠躬把帽口壓向前方,
// 火舌從帽口高度沿瞄準線往前、逐漸下落放大到目標軀幹高——近端=小火舌貼帽口、遠端=散開的火球。
const NEAR = 4, FAR = 92;                    // poof 距離帶(訊號點=sim 槍口 f.r+6 前;FIRE_RANGE 100 內)
const H0 = 70, H1 = 28;                      // 弧高:帽口(鞠躬壓頭後)→ 目標軀幹;ARC_P 前段撐高後段下墜
const ARC_P = 1.35;
const DRIFT = 46;                            // 燃燒中沿瞄準線前飄 px/s(噴流動量感;poof 靜止=火牆不是噴射)
const SIZE0 = 22, SIZE1 = 58;                // 近/遠端 poof 尺寸 px(帽口小舌→扇口大球)
const CONE_K = 0.78;                         // 橫向散開占 FIRE_CONE 的比例(留邊=不越過預告扇形=誠實)

// billboard vertex(render-burn GV 同款:在 view space 貼 quad,scale 取 modelMatrix 軸長)
const VS = `varying vec2 vUv;uniform float rot;
void main(){vUv=uv;
vec2 c=vec2(0.5);vec2 p2=uv-c;
float cs=cos(rot),sn=sin(rot);
p2=mat2(cs,-sn,sn,cs)*p2;
vec3 p=vec3(p2+c-0.5,0.0)*2.0;
vec4 mv=modelViewMatrix*vec4(0.,0.,0.,1.);
mv.xyz+=p*vec3(length(modelMatrix[0].xyz),length(modelMatrix[1].xyz),1.0)*0.5;
gl_Position=projectionMatrix*mv;}`;
const FS = `precision mediump float;varying vec2 vUv;
uniform sampler2D map;uniform vec2 off;uniform float al;
void main(){
vec3 c=texture2D(map,vUv/${COLS.toFixed(1)}+off).rgb;
gl_FragColor=vec4(c*al,1.0);}`;   // atlas 是黑底 RGB(無 alpha):additive 下黑=透明,al 乘色=淡出

const quad = new THREE.PlaneGeometry(1, 1);
let atlasTex = null, texOk = false;
function poofMat() {
  return new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, transparent: true,
    depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    uniforms: { map: { value: atlasTex }, off: { value: new THREE.Vector2(0, 1 - 1 / ROWS) }, al: { value: 0 }, rot: { value: 0 } },
  });
}
function setFrame(mat, i) {
  const c = i % COLS, r = Math.floor(i / COLS);
  mat.uniforms.off.value.set(c / COLS, 1 - (r + 1) / ROWS);
}

// pool(2 fighters=同時最多 2 發;第 3 發搶最舊的=永不掉演出)
const pool = [];
function buildSpray() {
  const poofs = [];
  for (let i = 0; i < POOFS; i++) {
    const m = new THREE.Mesh(quad, poofMat());
    m.visible = false; m.frustumCulled = false; m.renderOrder = 26; m.userData.__sprayfx = true;
    scene.add(m);
    poofs.push({ m, delay: 0, x: 0, y: 0, size: 30, rot: 0 });
  }
  return { poofs, t0: -9, active: false };
}
let _warmed = false;
function prewarm(sp) {
  if (_warmed) return; _warmed = true;
  for (const o of sp.poofs) o.m.visible = true;
  try { renderer.compile(scene, camera); } catch (e) { /* headless 無 GL:退回惰性編譯 */ }
  for (const o of sp.poofs) o.m.visible = false;
}

function spawn(x, y, angle) {
  if (!texOk) return;                                    // 圖還沒到:略過這發(不排隊=攻擊早過了)
  let sp = pool.find(s => !s.active);
  if (!sp) { if (pool.length < 2) { sp = buildSpray(); prewarm(sp); pool.push(sp); } else { sp = pool.reduce((a, b) => (a.t0 < b.t0 ? a : b)); } }
  sp.active = true; sp.t0 = game.time;
  const FIRE_CONE = 0.72;                                // 鏡射 v2-state(render 不進 sim DAG;改扇形要同步)
  for (let i = 0; i < sp.poofs.length; i++) {
    const o = sp.poofs[i];
    const f = sp.poofs.length > 1 ? i / (sp.poofs.length - 1) : 0;   // 0=近 1=遠
    const d = NEAR + (FAR - NEAR) * f;
    // 橫向:近端貼中線、遠端鋪滿扇口(交錯左右=毯狀覆蓋不重疊)
    const lat = (i === 0 ? 0 : (i % 2 ? 1 : -1) * (0.35 + 0.65 * f) * FIRE_CONE * CONE_K * (0.6 + 0.4 * Math.random()));
    const a = angle + lat;
    o.x = x + Math.cos(a) * d; o.y = y + Math.sin(a) * d;
    o.dx = Math.cos(a); o.dy = Math.sin(a);              // 前飄方向(各自的散開角=噴流放射)
    o.h = H0 - (H0 - H1) * Math.pow(f, ARC_P);           // 噴射弧高:帽口→前下方
    o.delay = d / WAVE_V;                                // 由近而遠點燃=噴射波
    o.size = SIZE0 + (SIZE1 - SIZE0) * f;
    o.rot = (Math.random() * 2 - 1) * 0.22;              // 微歪=每朵不同(rot 是 billboard 面內轉)
    o.m.visible = false;
  }
}

export function updateFireSprays() {
  if (!game.fireSprays) return;
  for (const b of game.fireSprays) if (!_seen.has(b)) { _seen.add(b); spawn(b.x, b.y, b.angle); }
  for (const sp of pool) {
    if (!sp.active) continue;
    let alive = false;
    for (const o of sp.poofs) {
      const t = game.time - sp.t0 - o.delay;             // game.time=hitstop 凍結一致(攻擊動詞)
      if (t < 0) { o.m.visible = false; alive = true; continue; }
      const step = Math.floor(t * FPS);
      if (step >= SEQ.length) { o.m.visible = false; continue; }
      alive = true;
      o.m.visible = true;
      const u = o.m.material.uniforms;
      setFrame(o.m.material, SEQ[step]);
      u.rot.value = o.rot;
      u.al.value = Math.min(1, step >= SEQ.length - FADE_STEPS ? (SEQ.length - step) / FADE_STEPS : 1);
      const s = o.size;
      o.m.scale.set(s, s, 1);
      const dr = t * DRIFT;                              // 沿瞄準線前飄=噴流動量;尾段(>0.25s)火苗散逸上飄
      o.m.position.set(o.x + o.dx * dr, o.h + Math.max(0, t - 0.25) * RISE, o.y + o.dy * dr);
    }
    if (!alive) sp.active = false;
  }
}
const _seen = new WeakSet();

new THREE.TextureLoader().load('assets/scene/fire-flipbook.png', tex => {
  tex.generateMipmaps = false;                           // atlas 幀縫:mipmap 會滲鄰幀
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.encoding = THREE.sRGBEncoding;
  atlasTex = tex; texOk = true;
  for (const sp of pool) for (const o of sp.poofs) { o.m.material.uniforms.map.value = tex; }
  if (!pool.length) { const sp = buildSpray(); prewarm(sp); pool.push(sp); }   // 載成即建+預編譯(首發不凍幀)
});

window.__fireSpray = () => ({ ready: texOk, pool: pool.length, active: pool.filter(s => s.active).length, poofs: POOFS, low: FX_LOW });
