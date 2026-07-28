// render-burn.js — 火焰演出(burn-1):使用者「elemental_hit v2.3」demo 的火焰模組移植。
// 三個消費者共用同一套火舌 rig:
//  ① 燃燒動作鏈火焰包裹(f._burnCh:挑飛→倒地全程火包身,熄滅段轉黑煙)——判定在 v2-combat,這裡純演出。
//  ② 著火 DoT 小火(f.burnT>0,地形火/油海:比鏈小一號,配既有身上火粒子)。
//  ③ 噴火帽帽口火(戴著=小火苗常燃(使用者拍板:還沒攻擊也要冒火);施法窗=火變大=蓄力讀條)。
// 火舌=demo 的 Gabriel 程序火焰 shader(Voronoi 溶解+cel 色階;render-wind-blast 同源已 r149 相容),
// 火焰永遠朝上(demo:倒地時火仍向上竄=真實);billboard 在 vertex shader 內做(demo GV 原樣)。
// perf(js/CLAUDE.md 特效鐵則):**不加燈**(demo 的 fireLight 拿掉)、每 fighter 一副 rig 建一次+
// per-frame 只改 uniform/transform、開機 prewarm 預編譯、FX_LOW 砍火舌數/黑煙/帽火只留核心。
import { game } from './state.js';
import { scene, renderer, camera } from './render-core.js';
import { FX_LOW } from './render-lab.js';

/* ==== demo shader(GV/GF/SF 原樣;r128→r149 無 API 差異)==== */
const GCOM = `
vec2 h2(vec2 p){return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);}
float voro(vec2 p){vec2 i=floor(p),f=fract(p);float m=8.0;
for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 g=vec2(float(x),float(y));vec2 r=g+h2(i+g)-f;m=min(m,dot(r,r));}
return clamp(sqrt(m),0.0,1.0);}
float hn(vec2 p){return fract(sin(dot(p,vec2(41.3,289.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
return mix(mix(hn(i),hn(i+vec2(1,0)),f.x),mix(hn(i+vec2(0,1)),hn(i+vec2(1,1)),f.x),f.y);}
float flameTex(vec2 uv){
vec2 st=vec2(uv.x-0.5,uv.y);
st.x+=sin(uv.y*9.0)*0.045*(1.0-uv.y)+(vn(vec2(uv.y*4.0,3.7))-0.5)*0.12*uv.y;
float w=0.34*pow(1.0-uv.y,0.55)+0.02;
float d=1.0-abs(st.x)/w;
d*=smoothstep(1.02,0.72,uv.y)*smoothstep(-0.02,0.14,uv.y);
d-=(vn(uv*7.0)-0.5)*0.16*uv.y;
return clamp(d,0.0,1.0);}`;
const GV = `varying vec2 vUv;uniform float rot;
void main(){vUv=uv;
vec2 c=vec2(0.5);vec2 p2=uv-c;
float cs=cos(rot),sn=sin(rot);
p2=mat2(cs,-sn,sn,cs)*p2;
vec3 p=vec3(p2+c-0.5,0.0)*2.0;
vec4 mv=modelViewMatrix*vec4(0.,0.,0.,1.);
mv.xyz+=p*vec3(length(modelMatrix[0].xyz),length(modelMatrix[1].xyz),1.0)*0.5;
gl_Position=projectionMatrix*mv;}`;
const GF = `precision mediump float;varying vec2 vUv;
uniform float t,dAmt,dPow,age,inten;
uniform vec2 dTile,dSpd;
uniform vec3 cCore,cMid,cOut,tint;` + GCOM + `
void main(){
float d=flameTex(vUv);
vec3 col=vec3(0.0);
col=mix(col,cOut,step(0.12,d));
col=mix(col,cMid,step(0.42,d));
col=mix(col,cCore,step(0.72,d));
col=mix(col,vec3(1.0,0.99,0.9),step(0.9,d));
float v=voro(vUv*dTile*4.0+dSpd*t*4.0+vec2(0.0,age*1.2));
float k=pow(v,dPow);
col*=mix(1.0,k*2.2,dAmt);
col*=tint*inten;
float a=step(0.12,d);
gl_FragColor=vec4(col*a,1.0);}`;
const SF = `precision mediump float;varying vec2 vUv;uniform float t,al;uniform vec3 scol;` + GCOM + `
void main(){
float d=1.0-length(vUv-0.5)*2.0;
d-=vn(vUv*5.0+t*0.3)*0.4;
float a=clamp(d,0.0,1.0)*al;
gl_FragColor=vec4(scol,a);}`;

const quad = new THREE.PlaneGeometry(1, 1);
function flameMat() {
  return new THREE.ShaderMaterial({
    vertexShader: GV, fragmentShader: GF, transparent: true,
    depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    uniforms: {
      t: { value: 0 }, rot: { value: 0 }, dAmt: { value: 1 }, dPow: { value: 5.3 },
      age: { value: 0 }, inten: { value: 0 },
      dTile: { value: new THREE.Vector2(1.6, 1.3) }, dSpd: { value: new THREE.Vector2(0, -0.1) },
      cCore: { value: new THREE.Color(1, 0.85, 0.35) },
      cMid: { value: new THREE.Color(1, 0.42, 0.08) },
      cOut: { value: new THREE.Color(0.75, 0.1, 0.02) },
      tint: { value: new THREE.Color(1.6, 1.1, 0.9) },
    },
  });
}
function smokeMat() {
  return new THREE.ShaderMaterial({
    vertexShader: GV, fragmentShader: SF, transparent: true,
    depthWrite: false, blending: THREE.NormalBlending,
    uniforms: { t: { value: 0 }, rot: { value: 0 }, al: { value: 0 }, scol: { value: new THREE.Color(0.10, 0.09, 0.085) } },
  });
}
function mkFlame(flag, tile, parent) {
  const m = new THREE.Mesh(quad, flameMat());
  if (tile) { m.material.uniforms.dAmt.value = 0.95; m.material.uniforms.dTile.value.set(2.6, 2.2); }
  m.visible = false; m.frustumCulled = false; m.renderOrder = 26; m.userData[flag] = true;
  (parent || scene).add(m);
  return m;
}

const FT = FX_LOW ? 9 : 18;         // 包身火舌(demo 16;burn-1d 8→12;burn-2e 拔掉 core 後 12→18 撐體積)
const SM = FX_LOW ? 0 : 4;          // 熄滅黑煙
const rnd = Math.random;

// 包身火場尺寸表(**全部 ×受害者實際站高 standH**,換模型/改 AVATAR_SCALE 自動跟;shock-1b 同款教訓)。
// burn-1d(使用者:「火焰包身的範圍可以做得更大更明顯嗎」)整體放大 ~1.3× 並提亮:
// 火柱包過頭頂、火舌環繞半徑外推到剪影邊緣、上竄行程加長。改觀感只調這張表。
// burn-2e(使用者:「燃燒包身的 core 也拔掉」,承 burn-2d 帽口火):**包身火也只剩火舌、沒有 core**。
// 同一個病:core 是形狀不動的大 quad(`flameTex` 剪影每幀相同)=實體感。fieldH/fieldW 保留為
// **火場尺寸純量**(火舌的散佈/上竄行程照它算),只是不再有一張 quad 把它畫出來。
const BODY = {
  fieldH: 1.45, fieldHLie: 0.95,    // 火場高(站立/躺平)——火舌上竄行程的基準
  fieldW: 1.26, fieldWLie: 1.72,    // 火場寬(保留給躺姿散佈用)
  ring: 0.88,                       // 火舌環繞半徑(包住身體剪影)
  tongue: 0.82,                     // 單束火舌尺寸
  rise: 1.25,                       // 火舌上竄行程 ÷ 火場高
  inten: 1.3,                       // 亮度增益(shader col×tint×inten)
  dot: 0.55,                        // DoT 小火倍率(明顯低於鏈=兩者讀得出差別)
};

// 帽口火尺寸表(**全部 ×帽口實際寬度**=每幀從帽 bbox 現量;換帽模型/改 item-3c 包覆規則自動跟——
// 舊版是固定 px(閒置 6.5)配方塊人時代的小帽,item-3c 把帽放大到 ~50px 寬後火苗只剩帽口的 1/7=看不見)。
// burn-2c(使用者:「火帽頭頂的火焰可以更明顯嗎」):閒置火苗 ×2.6、施法火柱 ×2、提亮到 1.35、火舌 3→5 且角度均分。
const HAT = {
  idle: 0.68,                       // 閒置火苗基準 ÷ 帽口寬(舊固定 6.5px ≈ 0.13 → 火苗只有帽口 1/7 寬=看不見)
  cast: 1.05,                       // 施法火柱(蓄力讀條:一眼看出「要噴了」)
  ring: 0.52,                       // 火舌環繞半徑 ÷ hs(散在帽口內緣一圈舔,不是全擠在中軸)
  rise: 1.45,                       // 火舌上竄行程 ÷ hs
  sink: 0.12,                       // 火舌起點壓進帽口 ÷ hs(火從口裡竄出來,不是浮在口上方)
  inten: 1.35,                      // 亮度增益(同 BODY.inten 級)
  breathe: 0.16,                    // 閒置呼吸振幅(火苗活著的感覺)
};
// burn-2d(使用者:「取消燃燒中央那根靜止的火柱,看起來像有一根物體」):**帽口火拔掉 core**。
// 病根=core 是一張**形狀完全不動**的大 quad(shader 只有 voronoi 在流,`flameTex` 剪影每幀相同)→
// 一根不生不滅的柱子插在會生滅的火舌中間=讀成實體物件。火舌有 life 循環(生→竄→淡)才像火。
// 補償:火舌數 5→9(FX_LOW 2→5)+ 壽命錯開(life 亂數範圍加大)→ 體積補回來、任一瞬間都有幾束正盛。
const HTG = FX_LOW ? 5 : 9;         // 帽口火舌數(拔 core 後由火舌獨撐體積)

/* ==== 每 fighter 一副:包身火(core+火舌+黑煙)+ 帽口火(小 core+火舌)==== */
// **錨=身體中心經身體變換(demo `_fireCenter` 原式),火掛 scene 永遠直立**(burn-1c)。
// 為什麼不能掛 g 底下:拋飛/趴姿時 g **整個帶 pitch 旋轉**(層級 dump 實證),火會跟著身體翻滾,
// 違反 demo 鐵則「火焰錨點=身體中心隨倒地姿態變換,**火焰本身永遠朝上**」;也不能錨 g 原點(腳)——
// 趴姿時可見身體繞到別處(lieDir 軸心補償再偏 ~30px)=火不在人身上(使用者兩輪反饋的病根)。
function buildRig() {
  const tongues = [];
  // burn-1d:角度**均分**(原本純亂數會結團=某一側光禿禿)、半徑 sqrt 分佈=偏外(貼剪影邊緣才叫包身)
  // burn-2e:拔掉 core 後半徑下限放寬到 0.3(core 原本填的身體內側改由內圈火舌接手)、壽命錯開加大
  for (let i = 0; i < FT; i++) tongues.push({ m: mkFlame('__burnfx', true), seed: rnd(), rs: (rnd() * 2 - 1) * 3, life: 1.1 * (0.55 + rnd() * 0.9), a0: (i + rnd() * 0.7) / FT * 6.283, r0: 0.3 + 0.7 * Math.sqrt(rnd()) });
  const smoke = [];
  for (let i = 0; i < SM; i++) smoke.push({ m: new THREE.Mesh(quad, smokeMat()), seed: rnd(), rs: (rnd() * 2 - 1) * 1.5, life: 1.6 * (0.7 + rnd() * 0.6) });
  for (const o of smoke) { o.m.visible = false; o.m.frustumCulled = false; o.m.renderOrder = 27; o.m.userData.__burnfx = true; scene.add(o.m); }
  const hatT = [];
  // burn-2c:角度均分(同 BODY 火舌;純亂數會結團=帽口某一側光禿禿)、半徑外偏=繞著帽口整圈舔
  // burn-2d:壽命錯開加大(0.55~1.45×)——拔掉 core 後全靠火舌撐,同步生滅會整叢一起消失=閃爍
  for (let i = 0; i < HTG; i++) hatT.push({ m: mkFlame('__hatflame', true), seed: rnd(), rs: (rnd() * 2 - 1) * 3, life: 0.9 * (0.55 + rnd() * 0.9), a0: (i + rnd() * 0.7) / HTG * 6.283, r0: 0.35 + 0.65 * Math.sqrt(rnd()) });
  return { tongues, smoke, hatT };
}

let _warmed = false;
function prewarm(rig) {
  if (_warmed) return; _warmed = true;
  const all = [...rig.tongues.map(o => o.m), ...rig.smoke.map(o => o.m), ...rig.hatT.map(o => o.m)];
  for (const m of all) m.visible = true;
  try { renderer.compile(scene, camera); } catch (e) { /* headless 無 GL:退回惰性編譯 */ }
  for (const m of all) m.visible = false;
}

const _ctr = new THREE.Vector3(), _bAx = new THREE.Vector3(), _hbb = new THREE.Box3();
// 全黑焦炭(demo 動作鏈第①段 applyCharColor):黑定格→熄滅全程角色換扁平炭黑,站起瞬間還原。
// 同 render-shock 剪影的手法:**換 mesh.material 指標**不改顏色(avatar clone 共用材質,改色會兩人一起黑);
// demo 的漸變還原需要 per-instance 材質=放棄(站起時火/煙蓋著,瞬間還原讀不出來)。
let CHAR_MAT = null;
function collectChar(g) {
  CHAR_MAT = CHAR_MAT || new THREE.MeshBasicMaterial({ color: 0x171310, fog: false });
  const list = [];
  g.traverse(o => { if (o.isMesh && !o.userData.__equip && !o.userData.__shockbone && !o.userData.__burnfx && !o.userData.__hatflame) list.push({ m: o, mat: o.material }); });
  return list;
}

// 燃燒鏈相位 → 火強度/黑煙(時長=v2-state BURN_CHAIN/BURN_LOB;**不 import v2-state**=render 不進 sim DAG,
// 由呼叫端 actor-brawler 也拿不到……直接讀 f._burnCh 時戳 + 這裡鏡射時長。改鏈時長要同步這兩個數。)
const BC = { black: 0.4, T: 1.05, out: 0.55 };   // 鏡射 BURN_CHAIN.black / BURN_LOB.T / BURN_CHAIN.out
function chainFire(f, now) {
  const t = now - f._burnCh.t0;
  if (t < BC.black) return { fire: 0, smoke: 0 };                          // ①全黑定格:還沒起火
  if (t < BC.black + BC.T) return { fire: Math.min((t - BC.black) / 0.15, 1), smoke: 0 };  // ②③挑飛+下墜:火全開(0.15s ramp)
  const k = (t - BC.black - BC.T) / BC.out;
  if (k < 1) return { fire: Math.max(1 - k * 1.25, 0), smoke: Math.sin(Math.min(k * 1.3, 1) * Math.PI) };  // ④熄滅:火滅冒黑煙
  return { fire: 0, smoke: Math.max(0, 1 - (k - 1) * 3) * 0.35 };          // ⑤站起:餘煙散去
}

export function updateBurnFx(e, g, R) {
  const u = g.userData;
  let rig = u.burnfx;
  const now = game.time, tr = performance.now() / 1000;                    // 火閃爍吃真實時鐘(hitstop 火照樣舔)
  const wantBody = e.state === 'alive' && (e._burnCh || e.burnT > 0);
  const hg = u.headgear;
  const wantHat = e.state === 'alive' && hg && hg.visible;
  if (!rig) {
    if (!wantBody && !wantHat && _warmed) return;
    rig = u.burnfx = buildRig();
    prewarm(rig);
  }

  // ---- ①② 包身火/DoT 小火 ----
  // ⚠ 鏈判斷和 DoT 判斷是**獨立的兩個 if**,不能鏈在焦炭的 if/else 上——burn-1 首版把 DoT 分支黏進
  // 焦炭鏈的 else if,鏈中 burnT>0 走進去把火強度蓋成 DoT 小火(0.62×)=「只有一小部分燃燒」(使用者抓到)。
  let fireInt = 0, smokeK = 0, sizeMul = 1;
  if (e._burnCh) { const c = chainFire(e, now); fireInt = c.fire; smokeK = c.smoke; }
  else if (e.burnT > 0) { fireInt = Math.min(0.8, e.burnT * 1.6); sizeMul = BODY.dot; } // DoT=小一號(地形火/油海)
  // 全黑焦炭:黑定格→熄滅段全黑(站起=還原);觸電 X 光佔用材質時讓位(restun 鐵則下不會同時發生,守底)
  const wantChar = !!e._burnCh && (now - e._burnCh.t0) < BC.black + BC.T + BC.out && !u.xray;
  if (wantChar && !rig.charred) { rig.charList = collectChar(g); CHAR_MAT.color.setHex(0x171310); for (const c of rig.charList) c.m.material = CHAR_MAT; rig.charred = true; u.charred = true; }
  else if (!wantChar && rig.charred) { for (const c of rig.charList) c.m.material = c.mat; rig.charList = null; rig.charred = false; u.charred = false; }   // u.charred=render-actors tint pass 的閘(同 u.xray)
  const H = (u.avatar && u.avatar.standH) || 47.6;                         // 實際站高(方塊人退 47.6;shock-1b 教訓)
  const on = fireInt > 0.01;
  // **錨=身體中心經身體姿態變換**(demo _fireCenter=(0,0.85,0)×quaternion 的原式):
  // 站立=胸口、拋飛翻滾/趴姿=跟著身體到正確位置;火在世界空間永遠直立。
  _ctr.set(0, H * 0.52, 0); g.localToWorld(_ctr);
  // 躺下身體軸=g local +Y(站立的「上」)投影到地面 → 火沿趴著的身體散開;站立時投影≈0 自然退化
  _bAx.set(0, 1, 0).transformDirection(g.matrixWorld); _bAx.y = 0;
  const axL = _bAx.length(); if (axL > 0.3) _bAx.divideScalar(axL); else _bAx.set(0, 0, 0);
  const k = sizeMul * (0.55 + 0.45 * fireInt);
  const lying = axL > 0.5;                                                 // 身體躺平的程度(用姿態算,不猜旗)
  const fH = H * (lying ? BODY.fieldHLie : BODY.fieldH) * k;               // 火場高(burn-2e:純量;core 已拔除)
  const fW = H * (lying ? BODY.fieldWLie : BODY.fieldW) * k;               // 火場寬(躺姿沿身體軸散得更開)
  for (const o of rig.tongues) {
    o.m.visible = on;
    if (!on) continue;
    const uu = o.m.material.uniforms;
    const lf = (tr / o.life + o.seed * 7) % 1;
    uu.t.value = tr; uu.age.value = lf; uu.rot.value = o.rs * lf; uu.inten.value = fireInt * BODY.inten;
    const sc = (0.21 + Math.sin(Math.min(lf / 0.27, 1) * 1.5708) * 0.79) * (1 - Math.max(0, (lf - 0.6) / 0.4));
    const rr = o.r0 * H * BODY.ring * (1 - lf * 0.5) * k;                  // 環繞半徑(貼剪影邊緣往中心收=火舌爬上身)
    const along = lying ? (o.seed * 2 - 1) * fW * 0.29 : 0;                // 躺下:沿身體軸散開滿火場寬(躺著身長≈standH)
    o.m.position.set(
      _ctr.x + Math.cos(o.a0) * rr + _bAx.x * along,
      _ctr.y - fH * 0.45 + lf * fH * BODY.rise,
      _ctr.z + Math.sin(o.a0) * rr + _bAx.z * along);
    const ts = H * BODY.tongue * k;
    o.m.scale.set((0.62 * sc + 0.05) * ts, (0.9 * sc + 0.05) * ts, 1);
  }
  for (const o of rig.smoke) {
    const vis = smokeK > 0.01;
    o.m.visible = vis;
    if (!vis) continue;
    const uu = o.m.material.uniforms;
    const lf = (tr / o.life + o.seed * 9) % 1;
    uu.t.value = tr; uu.rot.value = o.rs * lf; uu.al.value = smokeK * Math.sin(lf * 3.1416) * 0.5;
    const sc = (0.45 + lf * 1.1) * H * 0.42;
    o.m.position.set(_ctr.x + Math.sin(o.seed * 20 + tr * 0.7) * 5, _ctr.y + lf * H * 0.6, _ctr.z + Math.cos(o.seed * 17) * 4);
    o.m.scale.set(sc, sc, 1);
  }

  // ---- ③ 帽口火:常燃小火苗;施法窗(itemCastCd)火變大=蓄力讀條(使用者拍板:還沒攻擊也要冒火) ----
  const hatOn = !!wantHat;
  for (const o of rig.hatT) o.m.visible = hatOn;
  if (hatOn) {
    _hbb.setFromObject(hg);                                                // 帽世界 bbox 頂=帽口(The Golden Maw 開口朝上)
    const hx = (_hbb.min.x + _hbb.max.x) / 2, hy = _hbb.max.y, hz = (_hbb.min.z + _hbb.max.z) / 2;
    const hatW = Math.max(_hbb.max.x - _hbb.min.x, _hbb.max.z - _hbb.min.z) || 40; // 帽口寬=火苗尺寸基準(burn-2c)
    const casting = e._itemVisType === 'fire' && e.itemCastCd > 0;
    const hs = hatW * (casting ? HAT.cast : HAT.idle);                     // 施法=火柱;閒置=火苗(都照帽口寬現算)
    const hi = (casting ? 1.0 : 0.82 + HAT.breathe * Math.sin(tr * 7)) * HAT.inten; // 閒置微呼吸;×增益=更明顯
    for (const o of rig.hatT) {
      const uu = o.m.material.uniforms;
      const lf = (tr / o.life + o.seed * 7) % 1;
      uu.t.value = tr; uu.age.value = lf; uu.rot.value = o.rs * lf; uu.inten.value = hi;
      const sc = (0.21 + Math.sin(Math.min(lf / 0.27, 1) * 1.5708) * 0.79) * (1 - Math.max(0, (lf - 0.6) / 0.4));
      const rr = o.r0 * HAT.ring * (1 - lf * 0.6) * hs;                    // 往上收=火舌向中軸聚攏(burn-2d 拔 core 後的體積來源)
      o.m.position.set(hx + Math.cos(o.a0) * rr, hy - hs * HAT.sink + lf * hs * HAT.rise, hz + Math.sin(o.a0) * rr);
      o.m.scale.set((0.62 * sc + 0.05) * hs, (0.9 * sc + 0.05) * hs, 1);
    }
  }
}
// 測試 hook
export function __burnInfo() { return { low: FX_LOW, warmed: _warmed, tongues: FT, smoke: SM }; }
if (typeof window !== 'undefined') window.__burn = __burnInfo;
