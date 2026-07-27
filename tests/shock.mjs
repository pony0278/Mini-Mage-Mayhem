// 觸電命中演出(shock-1;使用者「電擊命中特效 v1.1 X光閃現」移植)驗收:
// ①開機 prewarm(rig 先建好+預編譯,首次觸電不凍幀)②電鞭直擊=受害者 shockT 被設、電弧可見
// ③X光幀=骨架浮現 + 角色 mesh 全換剪影材質 ④非X光幀=骨架收、材質**完整還原**(avatar 材質是共用引用,
// 換指標而非改顏色,還原不能有殘留)⑤**骨架掛 avatar 骨不是 box rig**(病 3 回歸守衛:box rig 是隱形
// driver,掛它骷髏頭會跑到胸口)⑥演出到期收乾淨 ⑦純演出不改判定 ⑧無 console 錯誤。
// 陷阱:①閃爍 45ms 一擲,截圖/斷言抓不到指定相位 → 用 `__shockForce(true/false)` 釘住。
//       ②turbo=8 下 1.2s 演出只有幾個 rAF → 用 interval 釘住 shockT 才量得到。
//       ③電弧/星芒 group 掛 scene(非 actor g 內);骨頭掛 rig 節點(在 g 內)。可見性都要查祖鏈。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 180000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* privacy */ } });
await page.goto('http://localhost:8099/v2.html?turbo=8', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && window.__lab && __gl && window.__shock', { timeout: 20000 });
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };

await page.evaluate(() => {
  const v = __v2; v.v2s.introT = 0; v.fighters[1].ai = false;
  v.fighters[0].x = 430; v.fighters[0].y = 330; v.fighters[0].facing = 0;
  v.fighters[1].x = 560; v.fighters[1].y = 330;
});

// 可見計數(祖鏈全可見):__shock=電弧/星芒/節點、__shockbone=骨架
const CNT = `(()=>{const s=__lab.labGroup.parent;let arcs=0,bones=0;s.traverse(o=>{
  const vis=()=>{let v=o.visible,p=o.parent;while(v&&p){v=p.visible;p=p.parent;}return v;};
  if(o.userData&&o.userData.__shock&&vis())arcs++;
  if(o.userData&&o.userData.__shockbone&&vis())bones++;});return {arcs,bones};})()`;
// 受害者(shown 中的那副 rig)的剪影狀態
const VICT = `(()=>{const s=__lab.labGroup.parent;let g=null;s.traverse(o=>{if(!g&&o.userData&&o.userData.shock&&o.userData.shock.shown)g=o;});
 if(!g)return null;const r=g.userData.shock;let swapped=0;for(const x of r.sil) if(x.m.material!==x.mat) swapped++;
 return {xray:!!g.userData.xray, sil:r.sil.length, swapped, onAvatar:r.onAvatar};})()`;

// ---------- ① 開機 prewarm ----------
const warm = await page.waitForFunction('__shock().warmed === true', { timeout: 15000 }).then(() => true).catch(() => false);
const idle = await page.evaluate(CNT);
R('開機 prewarm(rig 預建+預編譯)且未觸電時全不可見', warm && idle.arcs === 0 && idle.bones === 0, JSON.stringify(idle));

// ---------- ② 電鞭直擊 = shockT 被設 + 電弧可見 ----------
await page.evaluate(() => { window.__pin = setInterval(() => { __v2.fighters[1].shockT = __v2.game.time + 2; }, 16); });
const hit = await page.evaluate(() => {
  const f = __v2.fighters[0], o = __v2.fighters[1];
  o.shockT = 0; o.stunned = false; o.restunT = 0; f.facing = 0;
  __v2.castLightning(f);
  return { shockT: o.shockT, now: __v2.game.time, stunned: o.stunned };
});
R('電鞭直擊=受害者 shockT 被設(且照常擊暈=判定不動)', hit.shockT > hit.now && hit.stunned === true, JSON.stringify(hit));
const arcsOn = await page.waitForFunction(`${CNT}.arcs > 0`, { timeout: 15000 }).then(() => true).catch(() => false);
R('觸電中=包裹電弧/星芒可見', arcsOn);

// ---------- ⑤ 骨架掛 avatar 骨(病 3 回歸守衛) ----------
await page.waitForFunction(`${VICT} && ${VICT}.sil > 0`, { timeout: 15000 });
const mount = await page.evaluate(() => {
  const s = __lab.labGroup.parent; let g = null;
  s.traverse(o => { if (!g && o.userData && o.userData.shock && o.userData.shock.shown) g = o; });
  const av = g && g.userData.avatar;
  if (!av) return { skip: true };
  const bones = new Set(Object.values(av.by).map(e => e.bone));
  let onAv = 0, onBox = 0;
  const R2 = g.userData.rig, boxNodes = new Set([R2.headPivot, R2.spine, R2.pelvis, R2.armL.sh, R2.armR.sh, R2.legL.hp, R2.legR.hp]);
  g.traverse(o => {
    if (!o.userData.__shockbone) return;
    let p = o.parent; while (p && !bones.has(p) && !boxNodes.has(p)) p = p.parent;
    if (!p) return; bones.has(p) ? onAv++ : onBox++;
  });
  return { onAv, onBox };
});
R('骨架掛 avatar 骨(不是 box rig 隱形 driver=病 3)', mount.skip || (mount.onAv > 0 && mount.onBox === 0), JSON.stringify(mount));

// ---------- ③ X光幀 = 骨架浮現 + 全 mesh 換剪影材質 ----------
await page.evaluate(() => window.__shockForce(true));
const xr = await page.waitForFunction(`(()=>{const v=${VICT};return v && v.xray && v.swapped===v.sil && ${CNT}.bones>0;})()`, { timeout: 15000 }).then(() => true).catch(() => false);
R('X光幀=骨架浮現 + 角色整組換剪影材質', xr, JSON.stringify(await page.evaluate(VICT)));

// ---------- ④ 非X光幀 = 骨架收 + 材質完整還原(共用材質不能有殘留) ----------
await page.evaluate(() => window.__shockForce(false));
const rest = await page.waitForFunction(`(()=>{const v=${VICT};return v && !v.xray && v.swapped===0 && ${CNT}.bones===0;})()`, { timeout: 15000 }).then(() => true).catch(() => false);
R('非X光幀=骨架收 + 材質完整還原(零殘留)', rest);
await page.evaluate(() => window.__shockForce(null));

// ---------- ⑦ 純演出:對手材質沒被波及(avatar 材質是 clone 共用引用) ----------
const other = await page.evaluate(() => {
  const s = __lab.labGroup.parent; let vic = null, att = null;
  s.traverse(o => { if (o.userData && o.userData.shock) { if (o.userData.shock.shown) vic = o; else att = o; } });
  if (!att) return { skip: true };
  let dark = 0; att.traverse(o => { if (o.isMesh && o.material && o.material.color && o.material.color.getHex() === 0x33200f) dark++; });
  return { dark };
});
R('剪影不外溢:另一個角色沒被一起變黑(共用材質陷阱)', other.skip || other.dark === 0, JSON.stringify(other));

// ---------- ⑥ 演出到期收乾淨 ----------
await page.evaluate(() => { clearInterval(window.__pin); __v2.fighters[1].shockT = 0; });
const off = await page.waitForFunction(`(()=>{const c=${CNT};return c.arcs===0 && c.bones===0;})()`, { timeout: 15000 }).then(() => true).catch(() => false);
R('演出到期=電弧+骨架全收', off);

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
