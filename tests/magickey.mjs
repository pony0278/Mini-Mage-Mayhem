// camp-3 魔法鑰匙驗收(規格 H §5):打贏 → 艙口吐鑰匙 → 自動飛進左上角計數格。
// ①過關生成掉落動畫(n=第幾把)②動畫四節拍推進到底自動消失 ③**計數格在任何背景上都讀得到**
// (像素驗收)④飛行中該格先留空、落定才點亮 ⑤三把湊齊=整排解鎖脈動 ⑥加班模式沒有鑰匙這回事
// ⑦換關/重來清掉殘留動畫 ⑧無錯誤。
//
// ⚠ ③ 是這支的重點:第一版每格各自半透明,**空格疊在場景亮色機具上等於消失**——進度是絕對不能
//   看不到的訊息。所以用「整排底板」的像素占比當斷言,不是只驗 state 有沒有值。
// ⚠ 動畫節拍不能用真實時間等(headless rAF 節流):直接釘 `v2s.keyFx.t` 到指定進度再取樣。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 180000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };

async function open(url) {
  const page = await B.newPage();
  const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
  await page.setViewport({ width: 1000, height: 700 });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__v2 && window.__menu && __v2.fighters[0].state === "alive"', { timeout: 25000 });
  return { page, errs };
}
// 鑰匙格區域的不透明像素占比(HUD canvas 左上角;底板鋪好=占比高)
const rowInk = (page) => page.evaluate(() => {
  const c = document.getElementById('hud').getContext('2d');
  const d = c.getImageData(6, 4, 116, 44).data;      // 涵蓋三格 + 底板邊
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 60) n++;
  return { ink: n, total: d.length / 4 };
});

// ---------- ①②④⑤⑦ 闖關中的鑰匙 ----------
{
  const { page, errs } = await open('http://localhost:8099/v2.html?menu=1&turbo=8');
  await page.evaluate(() => { __v2.startGame(); __v2.v2s.introT = 0; __v2.fighters[1].ai = false; });
  // ⚠ 不能設完就取樣:headless rAF 被節流,HUD 可能還沒畫過任何一幀 → 輪詢等它真的畫出來。
  await page.waitForFunction(`(() => { const c = document.getElementById('hud').getContext('2d');
    const d = c.getImageData(6, 4, 116, 44).data; let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 60) n++; return n > 500; })()`, { timeout: 25000 });
  const before = await rowInk(page);
  R('闖關開場:鑰匙格已在畫面上(底板鋪好=讀得到)', before.ink > before.total * 0.3, JSON.stringify(before));

  await page.evaluate(() => __v2.campSeal(0));
  const k1 = await page.evaluate(() => __v2.state().keyFx);
  R('過關 → 生成掉落動畫(n=第 1 把)', k1 && k1.n === 1 && k1.t < k1.T, JSON.stringify(k1));

  // ④ 飛行中該格先留空(計數是 1,但畫面上還沒點亮)→ 用「已擁有格數」的視覺代理:釘在飛行中段取樣
  const mid = await page.evaluate(() => { const K = __v2.v2s.keyFx; K.t = K.T * 0.5;
    return { keys: __v2.state().camp.keys, flying: K.t < K.T * 0.88 }; });
  R('飛行途中:狀態已 +1 但視覺上還沒落格', mid.keys === 1 && mid.flying === true, JSON.stringify(mid));

  // ② 推到底 → 動畫自動消失
  await page.evaluate(() => { const K = __v2.v2s.keyFx; if (K) K.t = K.T + 0.01; });
  const gone = await page.waitForFunction('__v2.state().keyFx === null', { timeout: 20000 }).then(() => true).catch(() => false);
  R('節拍走完 → 動畫自動清除(不殘留)', gone);

  // ⑦ 換關清乾淨
  await page.waitForFunction('__v2.state().camp.phase === "fight"', { timeout: 60000 });
  R('進到下一關:沒有殘留的鑰匙動畫', await page.evaluate(() => __v2.state().keyFx === null && __v2.state().camp.keys === 1),
    JSON.stringify(await page.evaluate(() => ({ keyFx: __v2.state().keyFx, keys: __v2.state().camp.keys }))));

  // ⑤ 三把湊齊=整排脈動(取樣兩個相位,亮度會變)
  await page.evaluate(() => { __v2.v2s.camp.keys = 3; __v2.v2s.keyFx = null; __v2.v2s.lowFlicker = false; });
  const full = await rowInk(page);
  R('三把湊齊:整排仍在且更亮(解鎖脈動)', full.ink >= before.ink, JSON.stringify({ before: before.ink, full: full.ink }));
  R('闖關鑰匙:無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// ---------- ⑥ 加班模式沒有鑰匙 ----------
{
  const { page, errs } = await open('http://localhost:8099/v2.html?turbo=8');
  await page.evaluate(() => { __v2.v2s.introT = 0; });
  await page.evaluate(() => new Promise(r => setTimeout(r, 500)));
  const ink = await rowInk(page);
  R('加班模式(free):不畫鑰匙格', ink.ink < ink.total * 0.05, JSON.stringify(ink));
  R('free:無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// ---------- ③ 亮背景上的可讀性(第一版就是在這裡消失的) ----------
{
  const { page, errs } = await open('http://localhost:8099/v2.html?menu=1&turbo=8');
  await page.evaluate(() => { __v2.startGame(); __v2.v2s.introT = 0; __v2.v2s.camp.keys = 1; });
  await page.evaluate(() => new Promise(r => setTimeout(r, 600)));
  await page.waitForFunction(`(() => { const c = document.getElementById('hud').getContext('2d');
    const d = c.getImageData(6, 4, 116, 44).data; let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 60) n++; return n > 500; })()`, { timeout: 25000 });
  const px = await page.evaluate(() => {
    const c = document.getElementById('hud').getContext('2d');
    const d = c.getImageData(6, 4, 116, 44).data;
    let opaque = 0, gold = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 150) opaque++;                               // ⚠ 門檻不能設 >200:底板是 rgba(...,.78)=alpha 199,剛好卡在外面
      if (d[i] > 180 && d[i + 1] > 140 && d[i + 2] < 150) gold++; // 金色鑰匙/邊框
    }
    return { opaque, gold, total: d.length / 4 };
  });
  R('底板幾乎不透明(不管底下是亮機具還是暗地板都讀得到)', px.opaque > px.total * 0.6, JSON.stringify(px));
  R('已拿到的鑰匙以金色呈現', px.gold > 20, JSON.stringify(px));
  R('可讀性:無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
