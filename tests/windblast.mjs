// 風壓開火 3D 爆發(item-4e;使用者火砲特效 azure 移植)驗收:
// ①castWind 發動幀 push game.windBlasts → render 生成實例(pool 2、active≥1)②播完(>BLAST_DUR)清除(active=0)
// ③FX_LOW 仍生成、砍重層、無錯 ④無 console 錯誤 ⑤純演出=不改判定(castWind 擊退照舊)
// 陷阱:爆發實例=persistent pool(非 zoneGroup 每幀重建);clock=game.time,rAF 節流下以 game.time 輪詢。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 180000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };

async function run(url, tag, expectLow) {
  const page = await B.newPage();
  const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* privacy */ } });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__v2 && window.__lab && __gl && window.__windBlast', { timeout: 20000 });
  // 觸發一發:走真 castWind(內部槍口 addWindBlast,life 0.8>turbo 批次 8×dt=render 每 rAF 一次仍看得到);比手動 push 忠於實戰路徑
  await page.evaluate(() => {
    const v = __v2, f = v.fighters[0]; v.v2s.introT = 0; f.x = 380; f.y = 340; f.facing = 0; f.state = 'alive'; f.item = 'wind'; f.stunned = false;
    window.__t0 = v.game.time; v.castWind(f);
  });
  const active = await page.waitForFunction('__windBlast().active >= 1', { timeout: 10000 }).then(() => true).catch(() => false);
  const info = await page.evaluate(() => __windBlast());
  R(`${tag}:發動幀生成實例(pool ${info.pool}/active ${info.active})`, active && info.pool >= 1 && info.active >= 1);
  R(`${tag}:FX_LOW=${expectLow}`, info.low === expectLow);
  // 播完清除:直接輪詢 active→0(clock=startTime,非 push 時間 __t0;負載下 startTime 會漂,不能用 __t0 錨定)
  const cleared = await page.waitForFunction('__windBlast().active === 0', { timeout: 40000 }).then(() => true).catch(() => false);
  R(`${tag}:播完清除(active→0)`, cleared);
  R(`${tag}:無 page/console 錯誤`, errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// 純演出=不改判定:castWind 擊退照舊(沿用既有 wind 判定,爆發只是視覺)
const page0 = await B.newPage();
await page0.evaluateOnNewDocument(() => { try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* privacy */ } });
await page0.goto('http://localhost:8099/v2.html?turbo=8', { waitUntil: 'networkidle0' });
await page0.waitForFunction('window.__v2', { timeout: 20000 });
const knock = await page0.evaluate(() => {
  const v = __v2, C = v.fighters[1], O = v.fighters[0];
  C.x = 400; C.y = 300; C.facing = 0; C.stunned = false; O.x = 470; O.y = 300; O.vx = O.vy = 0; O.invuln = 0; O.stunned = false;
  v.castWind(C); return Math.round(v.fighters[0].vx);
});
R('純演出:castWind 擊退不受影響(oVx>0)', knock > 0);
await page0.close();

// ?turbo=8:game.time 每幀×8 步進,清除判定不受重特效拖慢 render 幀率影響(併發下桌機全特效實例很重)
await run('http://localhost:8099/v2.html?turbo=8', '桌機', false);
await run('http://localhost:8099/v2.html?fx=low&turbo=8', 'FX_LOW', true);

console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
