// camp-5 換皮 + HUD 資訊層級重整驗收(規格 H §7/§8)。
// ①標題列=「關 n · 關卡名　對手 擋住去路」(闖關)/「加班模式」(free)②第二行只在練習模式出現
// ③教練行目標提示**只在第 1 關**(之後卡關才回來)④動作提示不受此限 ⑤去閃爍:換句話有最短停留
// ⑥對手顯示名/進場台詞隨關卡走 ⑦第 2 關開場不再附教學行 ⑧舊框架用語絕跡 ⑨無錯誤。
//
// ⚠ 文案類斷言靠 `window.__hudtext`(v2-hud 在 fillText **當下**寫入=回報實況不是意圖;
//   camp-2 那個「選單 DOM 卡在畫面上」就是敗在 hook 只回報意圖)。
// ⚠ 讀 __hudtext 前一定要等**真的畫過一幀**(rAF 節流),不然全是 null。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 180000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };

async function open(url) {
  const page = await B.newPage();
  const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
  await page.setViewport({ width: 1000, height: 700 });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__v2 && window.__hudtext && __v2.fighters[0].state === "alive"', { timeout: 25000 });
  // ⚠ 這裡**不能**等 `__hudtext().title`:`?menu=1` 開機停在選單態,HUD 整層不畫(camp-0)→ title 永遠 null。
  //   各區塊自己在進遊戲之後等它需要的欄位。
  return { page, errs };
}
const txt = (page) => page.evaluate(() => __hudtext());

// ---------- ①②③⑤⑥⑦ 闖關 HUD ----------
{
  const { page, errs } = await open('http://localhost:8099/v2.html?menu=1&turbo=8');
  await page.evaluate(() => { __v2.startGame(); __v2.v2s.introT = 0; __v2.fighters[1].ai = true; });
  await page.waitForFunction('/關 1/.test(__hudtext().title)', { timeout: 25000 }).catch(() => {});
  const t1 = await txt(page);
  R('標題列=關卡 + 擋路的人(不再解釋制度)', /關 1/.test(t1.title) && /加班時間/.test(t1.title) && /老油條員工/.test(t1.title) && /擋住去路/.test(t1.title), JSON.stringify(t1.title));
  R('標題列不再出現舊框架用語(事故報告/收容測試/記錄 N 筆)', !/事故報告|收容測試|記錄 \d 筆/.test(t1.title), JSON.stringify(t1.title));
  R('AI 開著時第二行不畫(正式流程裡它是純雜訊)', t1.sub === null, JSON.stringify(t1.sub));

  await page.evaluate(() => { __v2.fighters[1].ai = false; });
  const prac = await page.waitForFunction('__hudtext().sub !== null', { timeout: 25000 }).then(() => true).catch(() => false);
  R('關掉 AI(練習模式)才出現第二行', prac, JSON.stringify((await txt(page)).sub));
  await page.evaluate(() => { __v2.fighters[1].ai = false; });

  // ③ 第 1 關:待機時給目標提示
  await page.evaluate(() => { const v = __v2;
    v.fighters[0].x = 200; v.fighters[0].y = 300; v.fighters[1].x = 760; v.fighters[1].y = 300;
    for (const f of v.fighters) { f.stunned = false; f.stunT = 0; f.carriedBy = null; f.carrying = null; f.stability = 100; } });
  const goal1 = await page.waitForFunction('/搶回鑰匙/.test(__hudtext().coach || "")', { timeout: 25000 }).then(() => true).catch(() => false);
  R('第 1 關:待機時給目標提示「打倒他,搶回鑰匙」', goal1, JSON.stringify((await txt(page)).coach));
  R('教練行不再說「記錄對手 N 次事故」', !/記錄對手|收容指令/.test((await txt(page)).coach || ''), JSON.stringify((await txt(page)).coach));

  // ③ 第 2 關:同樣待機,但目標提示收起來(已經打過一關的人不用一直被教)
  await page.evaluate(() => { const v = __v2; v.v2s.camp.keys = 1; v.startLevel(2); v.v2s.introT = 0;
    v.fighters[1].ai = false;
    v.fighters[0].x = 200; v.fighters[0].y = 300; v.fighters[1].x = 760; v.fighters[1].y = 300;
    for (const f of v.fighters) { f.stunned = false; f.stunT = 0; f.stability = 100; } });
  await page.waitForFunction('/關 2/.test(__hudtext().title)', { timeout: 25000 });
  await page.evaluate(() => new Promise(r => setTimeout(r, 1200)));
  const t2 = await txt(page);
  R('第 2 關:目標提示收起(卡關才回來)', !/搶回鑰匙/.test(t2.coach || ''), JSON.stringify(t2.coach));
  R('第 2 關標題換人(領班擋住去路)', /關 2/.test(t2.title) && /領班/.test(t2.title), JSON.stringify(t2.title));
  R('對手卡片名同步換(NAMES[1])', await page.evaluate(() => __v2.NAMES[1] === '領班'), await page.evaluate(() => __v2.NAMES[1]));

  // ④ 動作提示不受第 2 關的限制(它們有時效,照舊)
  await page.evaluate(() => { const v = __v2; const o = v.fighters[1];
    o.x = 240; o.y = 300; o.stunned = true; o.stunT = 99; o.invuln = 0; });
  const act = await page.waitForFunction('/可回收|抓住/.test(__hudtext().coach || "")', { timeout: 25000 }).then(() => true).catch(() => false);
  R('動作提示照舊(對手可抓時仍會提示)', act, JSON.stringify((await txt(page)).coach));
  R('闖關 HUD:無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// ---------- ⑥⑦ 開場台詞隨關卡走 ----------
{
  const { page, errs } = await open('http://localhost:8099/v2.html?menu=1&turbo=8');
  await page.evaluate(() => __v2.startGame());
  await page.waitForFunction('__hudtext().introLine !== null', { timeout: 25000 });
  const i1 = await txt(page);
  R('第 1 關開場=老油條的台詞 + 附教學行', /六點/.test(i1.introLine) && i1.teach === true, JSON.stringify(i1));
  R('開場不再是「主管:都給我好好工作」', !/都給我好好工作/.test(i1.introLine), JSON.stringify(i1.introLine));

  await page.evaluate(() => { __v2.v2s.camp.keys = 1; __v2.startLevel(2); });
  await page.waitForFunction('/公司財產/.test(__hudtext().introLine || "")', { timeout: 25000 });
  const i2 = await txt(page);
  R('第 2 關開場=領班的台詞,且**不再附教學行**', /公司財產/.test(i2.introLine) && i2.teach === false, JSON.stringify(i2));
  R('開場台詞:無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// ---------- ① free/加班模式維持舊語意 ----------
{
  const { page, errs } = await open('http://localhost:8099/v2.html?turbo=8');
  await page.waitForFunction('__hudtext().title !== null', { timeout: 25000 });
  const t = await txt(page);
  R('加班模式標題=「加班模式 · 無限對戰」(那條路就是舊遊戲)', /加班模式/.test(t.title), JSON.stringify(t.title));
  R('free:無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
