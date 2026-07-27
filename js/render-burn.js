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
function mkFlame(flag, tile) {
  const m = new THREE.Mesh(quad, flameMat());
  if (tile) { m.material.uniforms.dAmt.value = 0.95; m.material.uniforms.dTile.value.set(2.6, 2.2); }
  m.visible = false; m.frustumCulled = false; m.renderOrder = 26; m.userData[flag] = true;
  scene.add(m);
  return m;
}

const FT = FX_LOW ? 4 : 8;          // 包身火舌(demo 16;遊戲兩人份+尺寸小=砍半)
const SM = FX_LOW ? 0 : 4;          // 熄滅黑煙
const rnd = Math.random;

/* ==== 每 fighter 一副:包身火(core+火舌+黑煙)+ 帽口火(小 core+火舌)==== */
function buildRig() {
  const tongues = [];
  for (let i = 0; i < FT; i++) tongues.push({ m: mkFlame('__burnfx', true), seed: rnd(), rs: (rnd() * 2 - 1) * 3, life: 1.1 * (0.7 + rnd() * 0.6), a0: rnd() * 6.283, r0: 0.42 * Math.sqrt(rnd()) });
  const smoke = [];
  for (let i = 0; i < SM; i++) smoke.push({ m: new THREE.Mesh(quad, smokeMat()), seed: rnd(), rs: (rnd() * 2 - 1) * 1.5, life: 1.6 * (0.7 + rnd() * 0.6) });
  for (const o of smoke) { o.m.visible = false; o.m.frustumCulled = false; o.m.renderOrder = 27; o.m.userData.__burnfx = true; scene.add(o.m); }
  const hatCore = mkFlame('__hatflame');
  const hatT = [];
  if (!FX_LOW) for (let i = 0; i < 3; i++) hatT.push({ m: mkFlame('__hatflame', true), seed: rnd(), rs: (rnd() * 2 - 1) * 3, life: 0.9 * (0.7 + rnd() * 0.6), a0: rnd() * 6.283, r0: 0.3 });
  return { core: mkFlame('__burnfx'), tongues, smoke, hatCore, hatT };
}

let _warmed = false;
function prewarm(rig) {
  if (_warmed) return; _warmed = true;
  const all = [rig.core, rig.hatCore, ...rig.tongues.map(o => o.m), ...rig.smoke.map(o => o.m), ...rig.hatT.map(o => o.m)];
  for (const m of all) m.visible = true;
  try { renderer.compile(scene, camera); } catch (e) { /* headless 無 GL:退回惰性編譯 */ }
  for (const m of all) m.visible = false;
}

const _wp = new THREE.Vector3(), _hbb = new THREE.Box3();
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
const BODY_R = 0.42;                 // 包身火基準=站高×此比例(shock-1b 同款教訓:固定 px 只合方塊人,avatar 站高 1.3×)

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
  let fireInt = 0, smokeK = 0, sizeMul = 1;
  if (e._burnCh) { const c = chainFire(e, now); fireInt = c.fire; smokeK = c.smoke; }
  // 全黑焦炭:黑定格→熄滅段全黑(站起=還原);觸電 X 光佔用材質時讓位(restun 鐵則下不會同時發生,守底)
  const wantChar = !!e._burnCh && (now - e._burnCh.t0) < BC.black + BC.T + BC.out && !u.xray;
  if (wantChar && !rig.charred) { rig.charList = collectChar(g); CHAR_MAT.color.setHex(0x171310); for (const c of rig.charList) c.m.material = CHAR_MAT; rig.charred = true; u.charred = true; }
  else if (!wantChar && rig.charred) { for (const c of rig.charList) c.m.material = c.mat; rig.charList = null; rig.charred = false; u.charred = false; }   // u.charred=render-actors tint pass 的閘(同 u.xray)
  else if (e.burnT > 0) { fireInt = Math.min(0.8, e.burnT * 1.6); sizeMul = 0.62; }   // DoT=小一號(地形火/油海)
  g.getWorldPosition(_wp);
  const H = (u.avatar && u.avatar.standH) || 47.6;                         // 實際站高(方塊人退 47.6;shock-1b 教訓)
  const cy = _wp.y + (e._lying ? H * 0.14 : H * 0.34);                     // 火焰錨=身體中心(趴=貼地;火永遠朝上)
  const bs = H * BODY_R * sizeMul * (0.55 + 0.45 * fireInt);
  const on = fireInt > 0.01;
  rig.core.visible = on;
  if (on) {
    const uc = rig.core.material.uniforms;
    uc.t.value = tr; uc.inten.value = fireInt;
    rig.core.position.set(_wp.x, cy + bs * 0.35, _wp.z);
    rig.core.scale.set(1.35 * bs, 1.95 * bs, 1);
  }
  for (const o of rig.tongues) {
    o.m.visible = on;
    if (!on) continue;
    const uu = o.m.material.uniforms;
    const lf = (tr / o.life + o.seed * 7) % 1;
    uu.t.value = tr; uu.age.value = lf; uu.rot.value = o.rs * lf; uu.inten.value = fireInt;
    const sc = (0.21 + Math.sin(Math.min(lf / 0.27, 1) * 1.5708) * 0.79) * (1 - Math.max(0, (lf - 0.6) / 0.4));
    const rr = o.r0 * (1 - lf * 0.6) * bs;
    o.m.position.set(_wp.x + Math.cos(o.a0) * rr, cy - bs * 0.3 + lf * bs * 1.55, _wp.z + Math.sin(o.a0) * rr);
    o.m.scale.set((0.62 * sc + 0.04) * bs, (0.9 * sc + 0.04) * bs, 1);
  }
  for (const o of rig.smoke) {
    const vis = smokeK > 0.01;
    o.m.visible = vis;
    if (!vis) continue;
    const uu = o.m.material.uniforms;
    const lf = (tr / o.life + o.seed * 9) % 1;
    uu.t.value = tr; uu.rot.value = o.rs * lf; uu.al.value = smokeK * Math.sin(lf * 3.1416) * 0.5;
    const sc = (0.45 + lf * 1.1) * H * BODY_R;
    o.m.position.set(_wp.x + Math.sin(o.seed * 20 + tr * 0.7) * 5, cy + 6 + lf * H * 0.55, _wp.z + Math.cos(o.seed * 17) * 4);
    o.m.scale.set(sc, sc, 1);
  }

  // ---- ③ 帽口火:常燃小火苗;施法窗(itemCastCd)火變大=蓄力讀條(使用者拍板:還沒攻擊也要冒火) ----
  const hatOn = !!wantHat;
  rig.hatCore.visible = hatOn;
  for (const o of rig.hatT) o.m.visible = hatOn;
  if (hatOn) {
    _hbb.setFromObject(hg);                                                // 帽世界 bbox 頂=帽口(The Golden Maw 開口朝上)
    const hx = (_hbb.min.x + _hbb.max.x) / 2, hy = _hbb.max.y, hz = (_hbb.min.z + _hbb.max.z) / 2;
    const casting = e._itemVisType === 'fire' && e.itemCastCd > 0;
    const hs = casting ? 15 : 6.5;                                         // 施法=火柱;閒置=小火苗
    const hi = casting ? 1.0 : 0.65 + 0.15 * Math.sin(tr * 7);             // 閒置微呼吸
    const uh = rig.hatCore.material.uniforms;
    uh.t.value = tr; uh.inten.value = hi;
    rig.hatCore.position.set(hx, hy + hs * 0.55, hz);
    rig.hatCore.scale.set(1.1 * hs, 1.8 * hs, 1);
    for (const o of rig.hatT) {
      const uu = o.m.material.uniforms;
      const lf = (tr / o.life + o.seed * 7) % 1;
      uu.t.value = tr; uu.age.value = lf; uu.rot.value = o.rs * lf; uu.inten.value = hi;
      const sc = (0.21 + Math.sin(Math.min(lf / 0.27, 1) * 1.5708) * 0.79) * (1 - Math.max(0, (lf - 0.6) / 0.4));
      const rr = o.r0 * (1 - lf * 0.6) * hs;
      o.m.position.set(hx + Math.cos(o.a0) * rr, hy + lf * hs * 1.4, hz + Math.sin(o.a0) * rr);
      o.m.scale.set((0.62 * sc + 0.05) * hs, (0.9 * sc + 0.05) * hs, 1);
    }
  }
}
// 測試 hook
export function __burnInfo() { return { low: FX_LOW, warmed: _warmed, tongues: FT, smoke: SM }; }
if (typeof window !== 'undefined') window.__burn = __burnInfo;
