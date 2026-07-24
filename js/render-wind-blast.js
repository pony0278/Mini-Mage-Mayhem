// render-wind-blast.js — 風壓手套開火 3D 爆發(item-4e):使用者「火砲衝擊波」demo 移植 + azure 風系 recolor。
// 內容:槍口閃光 + 程序火舌(Gabriel 風 shader:交叉平面+Voronoi 溶解+cel 色階,改 azure 氣流羽)+
// 漫畫衝擊波環(3 環+16 錐刃)+ 地面塵環 + 卡通煙圈(逐幀頂點變形)+ 火花 + 短暫槍口點光。
// **判定不動**:純演出。觸發=sim castWind 在槍口 push game.windBlasts(fx.addWindBlast),這裡首見即生成一個
// 池中實例、之後自管播放(clock=game.time−spawn,hitstop 一致);render→sim/state 唯讀,不破不變式。
// 座標:世界(x,y)→3D(x,高,z=y);rig 外層 group 縮 SCALE(px/demo 單位)+ rotation.y=−facing 對齊發射方向。
// FX_LOW(手機):只留閃光+衝擊波環+塵環,砍火舌/煙圈/火花/點光(fill/CPU 大戶)。r128→r149 相容。
import { game } from './state.js';
import { scene } from './render-core.js';
import { FX_LOW } from './render-lab.js';

const SCALE = 16;      // px / demo 單位(火舌前伸 ~4 單位≈64px=手噴一小段;衝擊波 ~5.7≈91px;風扇形預告已示 WIND_RANGE 260,爆發只是槍口拳)
const MUZY = 1.9;      // 局部槍口高(×SCALE=世界高≈30px=手/胸高)
const RATE = 1.15;     // 播放速率(demo 時間軸×此=遊戲節奏;略快)
const BLAST_DUR = 1.5; // 實例壽命(秒;煙圈拖尾到此清除)
const POOL = 2;        // 池大小(兩名 fighter 同時開火的上限)

// ── azure 風系配色 ──
const C_FLASH_CORE = 0xeaffff, C_FLASH_MID = 0x7fd8ff;
const AZ_CORE = [0.52, 0.86, 1.0], AZ_MID = [0.18, 0.52, 1.0], AZ_OUTER = [0.05, 0.22, 0.64], AZ_OUTLINE = [0.02, 0.06, 0.18]; // 深飽和 azure(核心留青、非全白=風非蒸汽)
const C_WAVE_OUTLINE = 0x0a1a33, C_WAVE_OUTER = 0x2f9fff, C_WAVE_INNER = 0xdff4ff;
const C_BLADE_A = 0x8fe0ff, C_BLADE_B = 0x2f9fff, C_BLADE_OUTLINE = 0x0a1a33;
const C_DUST = 0xbcd8e8;
const C_SMOKE = 0x9fb4c4, C_SMOKE_OUT = 0x1a2530, C_PUFF = 0x9fb4c4, C_PUFF_OUT = 0x1f2a35;
const C_SPARK = 0xbfeaff, C_MUZLIGHT = 0x6fc0ff;

function toonGradient(cols) {
  const c = document.createElement('canvas'); c.width = cols.length; c.height = 1;
  const g = c.getContext('2d');
  cols.forEach((col, i) => { g.fillStyle = col; g.fillRect(i, 0, 1, 1); });
  const t = new THREE.CanvasTexture(c); t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter;
  return t;
}
let _gradSmoke = null;
function gradSmoke() { return _gradSmoke || (_gradSmoke = toonGradient(['#39434f', '#5f6f7d', '#93a4b2', '#d6e6f0'])); } // 冷藍灰煙

// ── 程序火舌 shader(demo 逐字移植;顏色全走 uniform → recolor 只改 makeFlameMat) ──
const FIRE_COMMON = `
  vec2 h2(vec2 p){ return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453); }
  float voro(vec2 p){ vec2 i=floor(p),f=fract(p); float m=8.0;
    for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){ vec2 g=vec2(float(x),float(y)); vec2 r=g+h2(i+g)-f; m=min(m,dot(r,r)); }
    return clamp(sqrt(m),0.0,1.0); }
  float hn(vec2 p){ return fract(sin(dot(p,vec2(41.3,289.7)))*43758.5453); }
  float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hn(i),hn(i+vec2(1.0,0.0)),f.x),mix(hn(i+vec2(0.0,1.0)),hn(i+vec2(1.0,1.0)),f.x),f.y); }
  float muzzleFlameShape(vec2 uv, float tm, float seed, float progress){
    float x=uv.x, y=uv.y-0.5;
    float width=mix(0.47,0.025,pow(clamp(x,0.0,1.0),0.70));
    float steppedTime=floor(tm*18.0)/18.0;
    float largeBend=sin(x*8.5+steppedTime*22.0+seed*17.0)*(0.035+x*0.095);
    float brokenFlow=(vn(vec2(x*5.0-steppedTime*4.4,seed*9.0))-0.5)*(0.05+x*0.16);
    y+=largeBend+brokenFlow;
    float d=1.0-abs(y)/max(width,0.001);
    d*=smoothstep(-0.015,0.07,x);
    d*=1.0-smoothstep(0.74+progress*0.08,1.03,x);
    float breakup=(vn(vec2(x*8.0-steppedTime*6.0,y*8.0+seed*13.0))-0.5)*(0.10+x*0.24);
    d-=breakup; return clamp(d,0.0,1.0);
  }`;
const FIRE_VERT = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const FIRE_FRAG = `precision highp float; varying vec2 vUv;
  uniform float uTime,uProgress,uOpacity,uSeed,uDissolvePower,uDissolveTiling,uLayerBias;
  uniform vec3 uCore,uMid,uOuter,uOutline;
  ${FIRE_COMMON}
  void main(){
    float d=muzzleFlameShape(vUv,uTime,uSeed,uProgress);
    vec2 cellUv=vec2(vUv.x*uDissolveTiling*5.0-uTime*6.0, vUv.y*uDissolveTiling*3.6+uSeed*11.0);
    float cell=voro(cellUv);
    float dissolve=pow(clamp(cell*1.28,0.0,1.0),uDissolvePower);
    float breakupAmount=smoothstep(0.18,0.86,uProgress)*(0.48+uLayerBias*0.28);
    float dissolveMask=mix(1.0,smoothstep(0.10,0.56,dissolve+d*0.32),breakupAmount);
    float silhouette=step(0.045,d)*dissolveMask;
    if(silhouette<0.01) discard;
    vec3 col=uOutline;
    col=mix(col,uOuter,step(0.13,d));
    col=mix(col,uMid,step(0.40,d));
    col=mix(col,uCore,step(0.70,d));
    col=mix(col,vec3(0.80,0.95,1.0),step(0.93,d));
    float flicker=0.92+0.08*step(0.48,vn(vec2(floor(uTime*18.0)+uSeed*23.0,uSeed*31.0)));
    col*=flicker;
    float tipFade=1.0-smoothstep(0.80,1.02,vUv.x);
    gl_FragColor=vec4(col, silhouette*tipFade*uOpacity);
  }`;
function makeFlameMat(seed, layerBias) {
  return new THREE.ShaderMaterial({
    vertexShader: FIRE_VERT, fragmentShader: FIRE_FRAG,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 }, uProgress: { value: 0 }, uOpacity: { value: 0 }, uSeed: { value: seed },
      uDissolvePower: { value: 5.2 }, uDissolveTiling: { value: 1.8 }, uLayerBias: { value: layerBias },
      uCore: { value: new THREE.Color(...AZ_CORE) }, uMid: { value: new THREE.Color(...AZ_MID) },
      uOuter: { value: new THREE.Color(...AZ_OUTER) }, uOutline: { value: new THREE.Color(...AZ_OUTLINE) },
    },
  });
}

// 煙圈頂點變形用的 3D value noise(demo 逐字)
function h3(x, y, z) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }
function vn3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const a = h3(ix, iy, iz), b = h3(ix + 1, iy, iz), c = h3(ix, iy + 1, iz), d = h3(ix + 1, iy + 1, iz);
  const e = h3(ix, iy, iz + 1), f = h3(ix + 1, iy, iz + 1), g = h3(ix, iy + 1, iz + 1), hh = h3(ix + 1, iy + 1, iz + 1);
  const n0 = (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
  const n1 = (e * (1 - ux) + f * ux) * (1 - uy) + (g * (1 - ux) + hh * ux) * uy;
  return n0 * (1 - uz) + n1 * uz;
}
const easeOut = x => 1 - Math.pow(1 - x, 3);
const clamp01 = x => Math.max(0, Math.min(1, x));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ── 建一個爆發實例(所有 mesh 掛進 grp;heavy 層在 FX_LOW 不建)──
function buildRig() {
  const low = FX_LOW;
  const grp = new THREE.Group(); grp.visible = false; grp.userData.__windblast = true;
  const MUZ = new THREE.Vector3(0, MUZY, 0);
  const rig = { grp, active: false, startTime: -99, low };

  // 閃光(雙層 icosahedron)
  const flashCore = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshBasicMaterial({ color: C_FLASH_CORE, transparent: true, depthWrite: false }));
  const flashMid = new THREE.Mesh(new THREE.IcosahedronGeometry(0.82, 1), new THREE.MeshBasicMaterial({ color: C_FLASH_MID, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  flashCore.position.copy(MUZ); flashMid.position.copy(MUZ); grp.add(flashCore, flashMid);
  rig.flashCore = flashCore; rig.flashMid = flashMid;

  // 程序火舌:多張交叉平面(local X=0→1)+ 分離火舌;FX_LOW 減張數、砍火舌
  const plane = new THREE.PlaneGeometry(1, 1); plane.translate(0.5, 0, 0);
  const muzzleFire = new THREE.Group(); muzzleFire.position.copy(MUZ); grp.add(muzzleFire); rig.muzzleFire = muzzleFire;
  const sheetRolls = low ? [0, Math.PI / 3, Math.PI * 2 / 3] : [0, Math.PI / 3, Math.PI * 2 / 3, Math.PI / 2, Math.PI * 5 / 6];
  rig.sheets = sheetRolls.map((roll, i) => {
    const material = makeFlameMat(0.13 + i * 0.173, i / (sheetRolls.length - 1));
    const mesh = new THREE.Mesh(plane, material); mesh.rotation.x = roll; mesh.renderOrder = 4 + i; muzzleFire.add(mesh);
    return { mesh, material, widthMul: 0.84 + (i % 3) * 0.10, lengthMul: 0.92 + (i % 2) * 0.11, wobble: i * 1.7 };
  });
  rig.tongues = [];
  if (!low) for (let i = 0; i < 10; i++) {
    const root = new THREE.Group();
    root.rotation.set((i / 10) * Math.PI * 2 + (i % 2) * 0.18, (h3(i, 3, 1) - 0.5) * 0.20, (h3(i, 7, 2) - 0.5) * 0.24);
    muzzleFire.add(root);
    const material = makeFlameMat(1.7 + i * 0.211, 0.75);
    const mesh = new THREE.Mesh(plane, material); mesh.renderOrder = 12 + i; root.add(mesh);
    rig.tongues.push({ root, mesh, material, angle: (i / 10) * Math.PI * 2, delay: 0.03 + (i % 4) * 0.018, forward: 0.14 + h3(i, 1, 9) * 0.36, width: 0.22 + h3(i, 2, 8) * 0.22, length: 0.52 + h3(i, 4, 6) * 0.62, phase: h3(i, 5, 5) * Math.PI * 2 });
  }
  muzzleFire.visible = false;

  // 衝擊波環(3 環,永遠建)+ 16 錐刃(FX_LOW 砍)
  const waveGroup = new THREE.Group(); grp.add(waveGroup); rig.waveGroup = waveGroup;
  const torusMat = (color, additive) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  rig.waveOutline = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.17, 12, 48), torusMat(C_WAVE_OUTLINE, false)); rig.waveOutline.rotation.y = Math.PI / 2; waveGroup.add(rig.waveOutline);
  rig.waveOuter = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.14, 10, 48), torusMat(C_WAVE_OUTER, true)); rig.waveOuter.rotation.y = Math.PI / 2; waveGroup.add(rig.waveOuter);
  rig.waveInner = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.07, 8, 48), torusMat(C_WAVE_INNER, true)); rig.waveInner.rotation.y = Math.PI / 2; waveGroup.add(rig.waveInner);
  rig.waveFlames = [];
  if (!low) for (let i = 0; i < 16; i++) {
    const root = new THREE.Group(); waveGroup.add(root);
    const outline = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.95, 4), new THREE.MeshBasicMaterial({ color: C_BLADE_OUTLINE, transparent: true, opacity: 0 })); outline.scale.setScalar(1.2); root.add(outline);
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.82, 4), new THREE.MeshBasicMaterial({ color: i % 2 ? C_BLADE_A : C_BLADE_B, transparent: true, opacity: 0 })); root.add(blade);
    rig.waveFlames.push({ root, outline, blade, angle: (i / 16) * Math.PI * 2, seed: h3(i, 9, 3) * 10 });
  }

  // 地面塵環 ×2(local y≈0.03=貼地)
  const dustMat1 = new THREE.MeshBasicMaterial({ color: C_DUST, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  const dustMat2 = dustMat1.clone();
  rig.dust = new THREE.Mesh(new THREE.RingGeometry(0.82, 1.0, 36), dustMat1); rig.dust.rotation.x = -Math.PI / 2; rig.dust.position.set(0, 0.03, 0); grp.add(rig.dust);
  rig.dust2 = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 36), dustMat2); rig.dust2.rotation.x = -Math.PI / 2; rig.dust2.position.set(0, 0.03, 0); grp.add(rig.dust2);

  // 卡通煙圈 + 爆炸煙塵(FX_LOW 砍:逐幀頂點變形是 CPU 大戶)
  if (!low) {
    const R0 = 1.0, TUBE = 0.36;
    const smokeGeo = new THREE.TorusGeometry(R0, TUBE, 12, 56); smokeGeo.rotateY(Math.PI / 2);
    rig.smokeGeo = smokeGeo; rig.smokeOrig = Float32Array.from(smokeGeo.attributes.position.array); rig.R0 = R0; rig.TUBE = TUBE;
    rig.smokeMat = new THREE.MeshToonMaterial({ color: C_SMOKE, gradientMap: gradSmoke(), transparent: true, opacity: 0 });
    rig.smokeOutMat = new THREE.MeshBasicMaterial({ color: C_SMOKE_OUT, side: THREE.BackSide, transparent: true, opacity: 0 });
    rig.smokeRing = new THREE.Mesh(smokeGeo, rig.smokeMat); rig.smokeRingOut = new THREE.Mesh(smokeGeo, rig.smokeOutMat); grp.add(rig.smokeRing, rig.smokeRingOut);
    rig.puffRoot = new THREE.Group(); grp.add(rig.puffRoot); rig.puffs = [];
    for (let i = 0; i < 13; i++) {
      const g2 = new THREE.Group(); rig.puffRoot.add(g2);
      const outline = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24 + h3(i, 2, 1) * 0.12, 1), new THREE.MeshBasicMaterial({ color: C_PUFF_OUT, transparent: true, opacity: 0 })); outline.scale.setScalar(1.12); g2.add(outline);
      const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22 + h3(i, 3, 2) * 0.10, 1), new THREE.MeshToonMaterial({ color: C_PUFF, gradientMap: gradSmoke(), transparent: true, opacity: 0 })); g2.add(body);
      rig.puffs.push({ grp: g2, outline, body, delay: i * 0.03 + h3(i, 4, 3) * 0.04, ang: h3(i, 5, 4) * Math.PI * 2, rad: 0.18 + h3(i, 6, 5) * 0.45, up: 0.35 + h3(i, 7, 6) * 0.55, fwd: 1.2 + h3(i, 8, 7) * 1.4, spin: (h3(i, 9, 8) - 0.5) * 0.06, baseScale: 0.55 + h3(i, 1, 9) * 0.55 });
    }
    // 火花
    const SPARKS = 28; const sparkGeo = new THREE.BufferGeometry(); const sparkPos = new Float32Array(SPARKS * 3); rig.sparkV = [];
    for (let i = 0; i < SPARKS; i++) { sparkPos[i * 3 + 1] = -40; const a = h3(i, 2, 4) * Math.PI * 2, r = h3(i, 3, 5) * 0.55; rig.sparkV.push([7 + h3(i, 4, 6) * 7, Math.cos(a) * r * 4 + 1.2, Math.sin(a) * r * 4]); }
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    rig.sparkGeo = sparkGeo; rig.sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: C_SPARK, size: 0.11, transparent: true, depthWrite: false })); grp.add(rig.sparks);
    // 槍口點光(短暫;暗場提亮,遊戲已亮→強度收斂)
    rig.light = new THREE.PointLight(C_MUZLIGHT, 0, SCALE * 4); rig.light.position.copy(MUZ); grp.add(rig.light);
  }
  scene.add(grp);
  return rig;
}

function deformSmokeRing(rig, t) {
  const pos = rig.smokeGeo.attributes.position, uv = rig.smokeGeo.attributes.uv, orig = rig.smokeOrig, R0 = rig.R0, TUBE = rig.TUBE;
  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i), v = uv.getY(i), a = u * Math.PI * 2;
    const cx = 0, cy = R0 * Math.sin(a), cz = -R0 * Math.cos(a);
    let dx = orig[i * 3] - cx, dy = orig[i * 3 + 1] - cy, dz = orig[i * 3 + 2] - cz;
    const L = Math.hypot(dx, dy, dz) || 1e-5; dx /= L; dy /= L; dz /= L;
    const n1 = vn3(u * 8 + 5, t * 0.45, v * 2.1) - 0.5, n2 = vn3(u * 19 + 17, t * 0.9, v * 4.2) - 0.5;
    const rad = TUBE * 1.05 + Math.sign(n1) * Math.abs(n1) * 0.22 + n2 * 0.09 + Math.sin(a * 6 + t * 4) * 0.02;
    pos.array[i * 3] = cx + dx * rad; pos.array[i * 3 + 1] = cy + dy * rad; pos.array[i * 3 + 2] = cz + dz * rad;
  }
  pos.needsUpdate = true; rig.smokeGeo.computeVertexNormals();
}

// ── 播放一幀(demo frame() body 移植:去掉相機/後座/砲身/地板;t=elapsed×RATE)──
const _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3();
function playRig(rig, elapsed) {
  const t = elapsed * RATE;

  // 閃光
  const FL = 0.09;
  if (t < FL) { const k = 1 - t / FL; rig.flashCore.visible = rig.flashMid.visible = true; rig.flashCore.scale.setScalar(0.7 + k * 1.6); rig.flashMid.scale.setScalar(0.9 + k * 2.3); rig.flashCore.material.opacity = 0.95; rig.flashMid.material.opacity = 0.8; }
  else rig.flashCore.visible = rig.flashMid.visible = false;

  // 程序火舌
  const CL = 0.265;
  if (t < CL) {
    const k = t / CL, grow = easeOut(clamp01(k / 0.30)), vanish = 1 - THREE.MathUtils.smoothstep(k, 0.58, 1.0), burstPulse = 0.88 + Math.sin(k * 19.0) * 0.08;
    rig.muzzleFire.visible = true;
    rig.sheets.forEach((o, i) => {
      const length = (0.55 + grow * 3.15) * o.lengthMul * (1.0 - k * 0.14), width = (0.42 + grow * 1.18) * o.widthMul * burstPulse * (1.0 - k * 0.18);
      o.mesh.scale.set(length, width, 1);
      o.mesh.position.set(0.02, Math.sin(k * 22 + o.wobble) * 0.025, Math.cos(k * 18 + o.wobble) * 0.018);
      const u = o.material.uniforms; u.uTime.value = t; u.uProgress.value = k; u.uOpacity.value = vanish * (0.86 - i * 0.045);
    });
    rig.tongues.forEach((o, i) => {
      const local = clamp01((k - o.delay) / (1.0 - o.delay)), tongueLife = Math.sin(Math.min(local, 1.0) * Math.PI);
      const forward = o.forward + grow * (0.22 + i * 0.018) + Math.sin(k * 16 + o.phase) * 0.025;
      o.root.position.set(forward, Math.cos(o.angle) * (0.05 + grow * 0.16), Math.sin(o.angle) * (0.05 + grow * 0.16));
      o.mesh.scale.set(o.length * (0.50 + grow * 1.60) * (0.60 + tongueLife * 0.65), o.width * (0.55 + grow * 1.35) * (0.65 + tongueLife * 0.70), 1);
      const u = o.material.uniforms; u.uTime.value = t + o.phase * 0.02; u.uProgress.value = clamp01(k * 1.08 + i * 0.012); u.uOpacity.value = vanish * tongueLife * 0.86;
    });
  } else rig.muzzleFire.visible = false;

  // 衝擊波環
  const WL = 0.34;
  if (t < WL) {
    const k = t / WL, R = 0.32 + easeOut(k) * 5.7, x = 0.18 + easeOut(k) * 2.7;
    rig.waveGroup.visible = true; rig.waveGroup.position.set(x, MUZY, 0);
    rig.waveOutline.scale.set(1.12, R * 1.02, R * 1.02); rig.waveOuter.scale.set(1 + R * 0.12, R, R); rig.waveInner.scale.set(1 + R * 0.18, R * 0.84, R * 0.84);
    rig.waveOutline.material.opacity = (1 - k) * 0.65; rig.waveOuter.material.opacity = (1 - k) * 0.90; rig.waveInner.material.opacity = (1 - k) * 0.75;
    rig.waveFlames.forEach((f, i) => {
      _dir.set(0.14, Math.cos(f.angle), Math.sin(f.angle)).normalize();
      f.root.position.set(x, MUZY + Math.cos(f.angle) * R, Math.sin(f.angle) * R);
      f.root.quaternion.setFromUnitVectors(_up, _dir);
      const len = (1 - k) * (0.85 + (0.70 + Math.sin(k * 18 + f.seed + i * 0.4) * 0.16) * 0.65);
      f.root.scale.set(1, len, 1); f.blade.material.opacity = (1 - k) * 0.95; f.outline.material.opacity = (1 - k) * 0.45;
    });
  } else rig.waveGroup.visible = false;

  // 地面塵環
  const DL = 0.58;
  if (t < DL) {
    const k = t / DL, R = 0.55 + easeOut(k) * 6.8; rig.dust.visible = rig.dust2.visible = true;
    rig.dust.scale.set(R, R, 1); rig.dust.material.opacity = (1 - k) * 0.52;
    const k2 = Math.max(0, (t - 0.08) / DL), R2 = 0.42 + easeOut(Math.min(k2, 1)) * 4.8;
    rig.dust2.scale.set(R2, R2, 1); rig.dust2.material.opacity = Math.max(0, 1 - k2) * 0.35;
  } else rig.dust.visible = rig.dust2.visible = false;

  // 煙圈 + 爆炸煙塵(!low)
  if (rig.smokeRing) {
    const S0 = 0.05, S1 = 1.65, sT = (t - S0) / (S1 - S0);
    if (sT > 0 && sT < 1) {
      const st = clamp01(sT); deformSmokeRing(rig, t * 1.1);
      const R = 0.72 + easeOut(Math.min(st * 1.35, 1)) * 2.45, fwd = 0.32 + easeOut(Math.min(st * 1.18, 1)) * 3.95;
      const op = st < 0.58 ? Math.min(st * 7.5, 1) : Math.max(0, 1 - (st - 0.58) / 0.42), rise = st * 0.6; // rise 收斂=煙較貼地往前飄,不像地火柱
      rig.smokeRing.visible = rig.smokeRingOut.visible = true;
      rig.smokeRing.scale.set(1 + st * 0.95, R, R); rig.smokeRing.position.set(fwd, MUZY + rise, 0);
      rig.smokeRingOut.scale.set((1 + st * 0.95) * 1.08, R * 1.08, R * 1.08); rig.smokeRingOut.position.copy(rig.smokeRing.position);
      rig.smokeMat.opacity = op * 0.9; rig.smokeOutMat.opacity = op * 0.5;
      rig.puffRoot.visible = true;
      rig.puffs.forEach((p, idx) => {
        const lp = clamp01((st - p.delay) / (1 - p.delay)), alive = st > p.delay && lp < 1; p.grp.visible = alive; if (!alive) return;
        const puffRad = 0.26 + easeOut(lp) * p.rad * 2.4, puffX = 0.28 + easeOut(lp) * p.fwd + Math.sin(idx + t * 1.3) * 0.05, puffY = 0.10 + lp * p.up * 1.65 + Math.sin(lp * 8 + idx) * 0.04;
        p.grp.position.set(puffX, MUZY + puffY + Math.cos(p.ang) * puffRad * 0.72, Math.sin(p.ang) * puffRad);
        p.grp.rotation.x += p.spin; p.grp.rotation.y += p.spin * 1.2;
        const fade = lp < 0.68 ? 1 : Math.max(0, 1 - (lp - 0.68) / 0.32), s = p.baseScale * (0.70 + easeOut(lp) * 2.4);
        p.grp.scale.setScalar(s); p.outline.material.opacity = fade * 0.52; p.body.material.opacity = fade * 0.95;
      });
    } else { rig.smokeRing.visible = rig.smokeRingOut.visible = false; rig.puffRoot.visible = false; }
  }

  // 火花
  if (rig.sparks) {
    const pp = rig.sparkGeo.attributes.position.array;
    if (t < 1.3) {
      rig.sparks.visible = true;
      for (let i = 0; i < rig.sparkV.length; i++) { pp[i * 3] = rig.sparkV[i][0] * t; pp[i * 3 + 1] = MUZY + rig.sparkV[i][1] * t - 5.2 * t * t; pp[i * 3 + 2] = rig.sparkV[i][2] * t; if (pp[i * 3 + 1] < 0.04) pp[i * 3 + 1] = -40; }
      rig.sparks.material.opacity = Math.max(0, 1 - t / 1.2); rig.sparkGeo.attributes.position.needsUpdate = true;
    } else rig.sparks.visible = false;
  }

  // 槍口點光
  if (rig.light) rig.light.intensity = t < 0.24 ? Math.pow(1 - t / 0.24, 2) * 8 : 0;
}

let pool = null;
function ensurePool() { if (!pool) { pool = []; for (let i = 0; i < POOL; i++) pool.push(buildRig()); } }

function spawn(x, y, angle) {
  ensurePool();
  const rig = pool.find(r => !r.active) || pool.reduce((a, b) => (a.startTime < b.startTime ? a : b)); // 空閒優先,否則搶最舊
  rig.grp.position.set(x, 0, y); rig.grp.rotation.y = -angle; rig.grp.scale.setScalar(SCALE);
  rig.grp.visible = true; rig.active = true; rig.startTime = game.time;
  playRig(rig, 0);
}

const _seen = new WeakSet();
// 每幀由 render3D 呼叫:首見的 windBlast 生成實例、推進所有 active 實例、播完隱藏。
export function updateWindBlasts() {
  if (!game.windBlasts) return;
  if (game.windBlasts.length && !pool) ensurePool();
  for (const b of game.windBlasts) if (!_seen.has(b)) { _seen.add(b); spawn(b.x, b.y, b.angle); }
  if (!pool) return;
  for (const rig of pool) {
    if (!rig.active) continue;
    const t = game.time - rig.startTime;
    if (t < 0 || t > BLAST_DUR) { rig.grp.visible = false; rig.active = false; continue; }
    playRig(rig, t);
  }
}
// 測試/除錯 hook
export function __windBlastInfo() { return { pool: pool ? pool.length : 0, active: pool ? pool.filter(r => r.active).length : 0, low: FX_LOW }; }
if (typeof window !== 'undefined') window.__windBlast = __windBlastInfo;
