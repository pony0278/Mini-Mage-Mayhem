// camp-0 主選單驗收(規格 H §14):①選單態(旗標/DOM/按鈕鎖)②小人在流水線上循環工作
// ③對手退場 ④HUD 整層收掉(只留 build tag)⑤開始遊戲=交還既有開場(對手歸位/introT/場景收掉)
// ⑥**自動化預設跳過選單**——這條是其餘 39 支回歸的命脈。
//
// ⚠ ⑥ 的背景:40 支回歸全都假設「開機即開打」。選單擋在前面會一次全紅,所以 MENU_ON 用四道獨立
//   訊號任一成立就跳過(?menu=0 / ?turbo / ?clip / navigator.webdriver)。這支測試同時**釘住
//   webdriver 那條**——它是唯一保護「沒帶 ?turbo 的 6 支套件」的訊號,悄悄失效的話會很難查。
//   反過來,要**看得到**選單就得明寫 `?menu=1`。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 180000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };

async function load(url, waitMenu) {
  const page = await B.newPage();
  const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
  await page.setViewport({ width: 1000, height: 700 });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__v2 && window.__lab && window.__menu', { timeout: 25000 });
  if (waitMenu) await page.waitForFunction('__menu().built', { timeout: 15000 });
  return { page, errs };
}

// ---------- ?menu=1:選單態 ----------
{
  const { page, errs } = await load('http://localhost:8099/v2.html?menu=1', true);
  const m = await page.evaluate(() => __menu());
  R('選單建好且顯示中(標題+兩顆鈕)', m.built && m.shown && m.title.length > 0 && m.buttons.length === 2, JSON.stringify(m));
  R('加班模式未通關=鎖定(不可點)', m.buttons[1].enabled === false && m.buttons[0].enabled === true, JSON.stringify(m.buttons));
  R('闖關狀態=menu(鑰匙 0/3)', await page.evaluate(() => { const c = __v2.state().camp; return c.phase === 'menu' && c.keys === 0 && c.level === 1; }),
    JSON.stringify(await page.evaluate(() => __v2.state().camp)));
  R('流水線工作站在場上(rim 預設本來一條輸送帶都沒有)', await page.evaluate(() => __lab.menuScene()));

  // 工作循環:角色釘在工作站、面向北(背對鏡頭)、itemClip 一直有東西在播
  // ⚠ 用輪詢不用固定 sleep:headless rAF 被節流,clip 何時重蓋時戳不可預期。
  const worked = await page.waitForFunction('__v2.fighters[0].itemClip === "overhand"', { timeout: 20000 }).then(() => true).catch(() => false);
  const me = await page.evaluate(() => { const f = __v2.fighters[0]; return { x: Math.round(f.x), y: Math.round(f.y), facing: +f.facing.toFixed(2), clip: f.itemClip }; });
  R('小人在工作站循環播工作動作', worked && me.clip === 'overhand', JSON.stringify(me));
  R('小人釘在工作站、面向北(背對鏡頭=第三人稱)', Math.abs(me.facing + Math.PI / 2) < 0.01 && me.y > 400 && me.x > 500, JSON.stringify(me));
  R('對手退場(選單只有你一個人)', await page.evaluate(() => { const o = __v2.fighters[1]; return o.state === 'away' && o._hidden === true; }));

  // HUD 整層收掉:只剩右下角 build tag。取樣「畫面中央大框」——標題列/教練行/狀態卡本來都在這裡。
  const hud = await page.evaluate(() => {
    const c = document.getElementById('hud');
    const d = c.getContext('2d').getImageData(60, 10, c.width - 120, c.height - 60).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++;
    return { opaque: n, total: d.length / 4 };
  });
  R('選單期 HUD 整層收掉(戰鬥 UI 不壓在選單上)', hud.opaque < hud.total * 0.005, JSON.stringify(hud));
  R('menu:無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// ---------- 開始遊戲:交還給既有開場 ----------
{
  const { page, errs } = await load('http://localhost:8099/v2.html?menu=1', true);
  await page.evaluate(() => __v2.startGame());
  await page.waitForFunction('__v2.state().camp.phase === "play"', { timeout: 15000 });
  const st = await page.evaluate(() => { const s = __v2.state(), [a, b] = __v2.fighters;
    return { phase: s.camp.phase, introT: s.introT, menuOut: s.menuOut, shown: __menu().shown, scene: __lab.menuScene(),
             f0: { x: Math.round(a.x), y: Math.round(a.y), state: a.state }, f1: { x: Math.round(b.x), y: Math.round(b.y), state: b.state, hidden: !!b._hidden } }; });
  R('開始遊戲 → 闖關態轉 play、選單收起、工作站移除', st.phase === 'play' && st.shown === false && st.scene === false, JSON.stringify(st));
  R('交還既有開場帶場(introT 起跳 + 鏡頭混合中)', st.introT > 1 && st.menuOut > 0, JSON.stringify({ introT: st.introT, menuOut: st.menuOut }));
  R('雙方歸位出生點、對手復活(選單的 away/_hidden 清乾淨)',
    st.f1.state === 'alive' && st.f1.hidden === false && st.f0.state === 'alive' && Math.abs(st.f0.x - st.f1.x) > 300, JSON.stringify(st));
  R('再按一次開始不會重入(狀態機單向)', await page.evaluate(() => { const t = __v2.state().introT; __v2.startGame(); return __v2.state().introT === t; }));
  R('start:無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// ---------- 自動化預設跳過選單(其餘 39 支回歸的命脈) ----------
{
  const { page, errs } = await load('http://localhost:8099/v2.html', false);
  R('navigator.webdriver 為真(webdriver 那道訊號還在)', await page.evaluate(() => navigator.webdriver === true));
  R('自動化下無旗標=直接開打(選單不擋回歸)', await page.evaluate(() => __v2.state().camp.phase === 'play' && !__menu().shown));
  R('無旗標:無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}
{
  const { page } = await load('http://localhost:8099/v2.html?menu=0', false);
  R('?menu=0 明示跳過', await page.evaluate(() => __v2.state().camp.phase === 'play'));
  await page.close();
}
{
  const { page } = await load('http://localhost:8099/v2.html?turbo=8', false);
  R('?turbo 一律跳過(回歸套件標配)', await page.evaluate(() => __v2.state().camp.phase === 'play'));
  await page.close();
}

console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
