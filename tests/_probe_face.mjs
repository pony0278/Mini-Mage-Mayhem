import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 180000, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await B.newPage();
await page.setViewport({ width: 1100, height: 260 });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('mmm_v2_played','1'); } catch {} });
await page.goto('http://localhost:8099/v2.html?turbo=8', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && window.__lab && __gl && window.__avatars && __avatars.length>0', { timeout: 20000 });
await page.evaluate(() => { __v2.v2s.introT = 0; __v2.fighters[1].ai = false; });
await page.evaluate(() => {
  const s = __lab.labGroup.parent;
  let g = null; s.traverse(o => { if (!g && o.userData && o.userData.avatar) g = o; });
  const av = g.userData.avatar;
  const cvs = document.createElement('canvas'); cvs.width = 120; cvs.height = 120;
  const rd = new THREE.WebGLRenderer({ canvas: cvs, alpha: true });
  rd.setSize(120, 120);
  const row = document.createElement('div'); row.style.cssText='position:fixed;top:0;left:0;z-index:9999;background:#111;display:flex;flex-wrap:wrap';
  document.body.appendChild(row);
  const temp = new THREE.Scene();
  let headBB = null;
  av.wrap.traverse(m => { if (!m.isMesh) return;
    for (let p=m; p&&p!==av.wrap; p=p.parent) if (!p.visible) return;
    const c = new THREE.Mesh(m.geometry, m.material); c.matrixAutoUpdate=false; c.matrix.copy(m.matrixWorld); temp.add(c);
    if (av.by.head && av.by.head.meshes.includes(m)) (headBB = headBB || new THREE.Box3()).expandByObject(c); });
  temp.updateMatrixWorld(true);
  const ctr = headBB.getCenter(new THREE.Vector3()), sz = headBB.getSize(new THREE.Vector3());
  const dim = Math.max(sz.x, sz.y, sz.z);
  temp.add(new THREE.AmbientLight(0xffffff, 1.0));
  const rotY = g.rotation.y;
  // 前方候選 ±Z × 俯仰 [-0.5, -0.25, 0, +0.35] × 目標下移 [0, 0.25dim]
  const cases = [];
  for (const sign of [1, -1]) for (const pitch of [-0.5, -0.25, 0, 0.35]) cases.push({ sign, pitch });
  for (const cse of cases) {
    const fx = cse.sign * -Math.sin(rotY), fz = cse.sign * -Math.cos(rotY);
    const look = ctr.clone(); look.y -= dim * 0.2;
    const cam = new THREE.PerspectiveCamera(28, 1, dim*0.1, dim*30);
    cam.position.set(look.x + fx*dim*2.6, look.y + cse.pitch*dim*2.6, look.z + fz*dim*2.6);
    cam.lookAt(look);
    rd.render(temp, cam);
    const img = document.createElement('img'); img.src = cvs.toDataURL(); img.style.cssText='width:120px;height:120px;border:1px solid #444';
    const wrap = document.createElement('div'); wrap.style.cssText='color:#fff;font:10px monospace;text-align:center';
    wrap.textContent = (cse.sign>0?'-Z':'+Z') + ' p' + cse.pitch; wrap.prepend(img);
    row.appendChild(wrap);
  }
});
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: '/tmp/face_dirs.png', clip: { x: 0, y: 0, width: 1000, height: 150 } });
await B.close();
