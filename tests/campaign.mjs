// camp-1 闖關殼驗收(規格 H §3):三鑰逃生的關卡狀態機。
// ①開始遊戲=進第 1 關 ②危險等級**綁關卡**(不再由比分推)③**真的走完終演 → 掉鑰匙進下一關,
// 不再跳事故報告**(整合驗收,這支的重點)④敗北=重打本關、鑰匙保留、deaths+1
// ⑤三把湊齊 → 大門解鎖 → 下班打卡(matchOver + 記通關)⑥中離續玩(localStorage)
// ⑦**free/加班模式仍走舊路**(封存→事故報告)=既有 40 支回歸的保命符 ⑧闖關中逃跑退役 ⑨無錯誤。
//
// ⚠ ③ 為什麼要跑真流程而不是直接呼叫 campSeal:接手點在 v2-combat 的 finalSeal→sealOrCamp,
//   注入沒接上的話「單元」層面看起來全對、實際遊玩卻會跳出事故報告。這支必須從擊暈打到封存。
// ⚠ 造局同 finisher.mjs 的坑:AI 關掉、兩人擺位離艙 >POD.r、擊暈之間等醒+清 restunT。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 300000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };

async function open(url) {
  const page = await B.newPage();
  const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__v2 && window.__menu && __v2.fighters[0].state === "alive"', { timeout: 25000 });
  return { page, errs };
}
const camp = (page) => page.evaluate(() => __v2.state().camp);

// ---------- ①②③④⑤ 主線:選單 → 三關 → 下班 ----------
{
  const { page, errs } = await open('http://localhost:8099/v2.html?menu=1&turbo=8');
  R('開機=選單態(還沒進關)', (await camp(page)).phase === 'menu');
  await page.evaluate(() => { __v2.startGame(); __v2.v2s.introT = 0; __v2.fighters[1].ai = false; });
  const c1 = await camp(page);
  R('開始遊戲 → 第 1 關戰鬥中(鑰匙 0/3)', c1.phase === 'fight' && c1.level === 1 && c1.keys === 0, JSON.stringify(c1));
  R('危險等級綁關卡:第 1 關=stage 1', await page.evaluate(() => __v2.state().stage === 1));

  // ② 闖關模式下「記錄」不再把 stage 推上去(舊行為:記滿就 stage 3)
  await page.evaluate(() => { const v = __v2;
    v.fighters[0].x = 200; v.fighters[0].y = 320; v.fighters[1].x = 260; v.fighters[1].y = 320;
    v.roundWins[0] = 2; v.stunFighter(v.fighters[1]); });
  await page.waitForFunction('__v2.state().roundWins[0] >= 3', { timeout: 30000 }).catch(() => {});
  R('記錄不再推 stage(危險等級只由關卡決定)', await page.evaluate(() => __v2.state().stage === 1),
    JSON.stringify(await page.evaluate(() => ({ stage: __v2.state().stage, wins: __v2.state().roundWins }))));

  // ③ 真的走完終演:賽末點 → 按 X → 自動駕駛 → 封存 → **掉鑰匙**,而不是事故報告
  await page.waitForFunction('(__v2.state().finisher||{}).phase === "prompt"', { timeout: 60000 });
  await page.evaluate(() => __v2.pressFinisher(__v2.fighters[0]));
  const got = await page.waitForFunction('__v2.state().camp.phase !== "fight"', { timeout: 300000 }).then(() => true).catch(() => false);
  const s3 = await page.evaluate(() => { const st = __v2.state(); return { camp: st.camp, over: st.matchOver, report: !!st.report }; });
  R('真封存 → 掉鑰匙(1/3)而非事故報告', got && s3.camp.keys === 1 && s3.camp.phase === 'keydrop' && s3.over === false && s3.report === false, JSON.stringify(s3));
  R('闖關模式不產生事故報告(報告只屬加班模式)', s3.report === false);

  // 交接 → 第 2 關
  await page.waitForFunction('__v2.state().camp.phase === "fight"', { timeout: 60000 });
  const c2 = await page.evaluate(() => ({ camp: __v2.state().camp, stage: __v2.state().stage, wins: __v2.state().roundWins, tier: __v2.v2s.aiTier }));
  R('交接 → 第 2 關開打(比分清空/危險等級跟上/換對手檔案)',
    c2.camp.level === 2 && c2.camp.keys === 1 && c2.stage === 2 && c2.wins[0] === 0 && c2.wins[1] === 0, JSON.stringify(c2));

  // ④ 敗北:重打本關、鑰匙保留、deaths+1
  await page.evaluate(() => __v2.campSeal(1));
  const c3 = await camp(page);
  R('敗北 → retry 節拍(鑰匙不沒收、deaths+1)', c3.phase === 'retry' && c3.keys === 1 && c3.deaths === 1 && c3.level === 2, JSON.stringify(c3));
  await page.waitForFunction('__v2.state().camp.phase === "fight"', { timeout: 60000 });
  R('重打的是**同一關**(不是退回第 1 關)', (await camp(page)).level === 2, JSON.stringify(await camp(page)));

  // ⑤ 湊齊 3 把 → 大門解鎖 → 下班
  await page.evaluate(() => __v2.campSeal(0));
  await page.waitForFunction('__v2.state().camp.phase === "fight"', { timeout: 60000 });
  await page.evaluate(() => __v2.campSeal(0));
  const cleared = await page.waitForFunction('__v2.state().camp.phase === "clockout"', { timeout: 60000 }).then(() => true).catch(() => false);
  const s5 = await page.evaluate(() => ({ camp: __v2.state().camp, over: __v2.state().matchOver, cleared: __menu().cleared }));
  R('三把湊齊 → 大門解鎖 → 下班打卡(結局凍結畫面)', cleared && s5.camp.keys === 3 && s5.over === true, JSON.stringify(s5));
  R('通關記進 localStorage(解鎖加班模式)', s5.cleared === true);
  R('主線:無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// ---------- ⑥ 中離續玩 ----------
{
  const { page, errs } = await open('http://localhost:8099/v2.html?menu=1&turbo=8');
  await page.evaluate(() => { __v2.startGame(); __v2.v2s.introT = 0; });
  await page.evaluate(() => { __v2.campSeal(0); });                       // 打完第 1 關 → 存檔
  await page.waitForFunction('__v2.state().camp.phase === "fight"', { timeout: 60000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mmm_camp_run') || 'null'));
  R('進度寫進 localStorage(關卡+鑰匙)', saved && saved.level === 2 && saved.keys === 1, JSON.stringify(saved));
  await page.reload({ waitUntil: 'networkidle0' });                        // 中離
  await page.waitForFunction('window.__v2 && window.__menu', { timeout: 25000 });
  const labels = await page.evaluate(() => __menu().buttons.map(b => b.label));
  R('重開後選單出現「繼續」鈕', labels[0] === '繼續' && labels.includes('重新開始'), JSON.stringify(labels));
  await page.evaluate(() => __v2.startGame({ resume: true }));
  const c = await camp(page);
  R('續玩回到當時那一關、鑰匙帶著', c.level === 2 && c.keys === 1 && c.phase === 'fight', JSON.stringify(c));
  R('續玩:無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// ---------- ⑦ free/加班模式仍走舊路(既有 40 支回歸的保命符) ----------
{
  const { page, errs } = await open('http://localhost:8099/v2.html?turbo=8');
  R('自動化無旗標=free 模式(闖關不接管)', (await camp(page)).phase === 'free', JSON.stringify(await camp(page)));
  await page.evaluate(() => __v2.endMatch(0));
  const s = await page.evaluate(() => ({ over: __v2.state().matchOver, report: !!__v2.state().report, camp: __v2.state().camp.phase }));
  R('free 模式封存 → 舊路 matchOver + 事故報告', s.over === true && s.report === true && s.camp === 'free', JSON.stringify(s));
  R('free:無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

// ---------- ⑧ 闖關中逃跑退役(boss 跑掉就拿不到鑰匙) ----------
{
  const { page, errs } = await open('http://localhost:8099/v2.html?menu=1&turbo=8');
  await page.evaluate(() => { __v2.startGame(); __v2.v2s.introT = 0; });
  await page.evaluate(() => { const v = __v2, f = v.fighters[1];       // 觸發舊逃跑條件:賽末點前一步 + 低穩定
    v.roundWins[0] = 2; f.stability = 40; f.x = 500; f.y = 500; f.stunned = false; });
  await page.evaluate(() => new Promise(r => setTimeout(r, 900)));
  const fled = await page.evaluate(() => ({ fleeing: !!__v2.fighters[1]._fleeing, called: __v2.v2s.aiCalled, tier: __v2.v2s.aiTier }));
  R('闖關中對手不逃跑(逃跑戲只留給加班模式)', fled.fleeing === false && fled.called === false, JSON.stringify(fled));
  R('逃跑退役:無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.close();
}

console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
