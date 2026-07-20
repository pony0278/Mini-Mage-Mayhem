// AI 階級 tier-1(使用者拍板 2026-07-20:實習生→快輸逃跑搬救兵→資深同事)驗收:
// ①開局檔案=實習生(aiTier/NAMES 同步)②快輸(聽牌+穩定值≤FLEE_STAB)=逃跑(_fleeing,朝最近出口)
// ③逃跑可被追擊(抓住照常成立=不是過場)④到出口=消失(state away+_hidden)+排資深進場(aiCallAt)
// ⑤資深同點進場:檔案/名字切換、比分保留 ⑥資深讀起手舉防(o._strikeAt>0 近距=guarding)⑦逃跑一場只演一次 ⑧無錯
// 陷阱:aiMove 要 fighters[1].ai=true 才跑;CALL_T 等待用 fast-forward aiCallAt(rAF 節流);出口到達=teleport 到出口旁。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 180000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* privacy */ } });
await page.goto('http://localhost:8099/v2.html?turbo=8', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };

// ---------- ① 開局=實習生檔案 ----------
const boot = await page.evaluate(() => ({ tier: __v2.v2s.aiTier, name: __v2.NAMES[1], guard: __v2.AI_PROFILE.intern.guard }));
R('開局對手=實習生(aiTier/NAMES 同步,檔案不會防)', boot.tier === 'intern' && boot.name === '實習生' && boot.guard === false, JSON.stringify(boot));

// ---------- ② 快輸=逃跑(聽牌+穩定值低 → _fleeing 朝最近出口) ----------
await page.evaluate(() => { const v = __v2; const a = v.fighters[0], f = v.fighters[1];
  v.v2s.introT = 0; f.ai = true;
  v.roundWins[0] = 2; v.roundWins[1] = 0;                              // 你聽牌
  a.x = 200; a.y = 320; f.x = 700; f.y = 320;
  f.stunned = false; f.carriedBy = null; f.fumbleT = 0; f.stability = 40; }); // 被打殘(≤FLEE_STAB 50)
await page.waitForFunction('__v2.fighters[1]._fleeing === true', { timeout: 15000 }).catch(() => {});
const flee = await page.evaluate(() => { const f = __v2.fighters[1];
  return { fleeing: f._fleeing, to: f._fleeTo, called: __v2.v2s.aiCalled }; });
R('快輸=逃跑(_fleeing+目標出口+一場一次旗)', flee.fleeing && Array.isArray(flee.to) && flee.called, JSON.stringify(flee));

// ---------- ③ 逃跑可被追擊(抓住照常成立,不是無敵過場) ----------
const chase = await page.evaluate(() => { const v = __v2; const a = v.fighters[0], f = v.fighters[1];
  a.x = f.x - 30; a.y = f.y;                                           // 追上
  v.startCarry(a, f);
  const caught = f.carriedBy === a && a.carrying === f;
  v.dropCarry(a);                                                      // 放開讓他繼續跑(下一案驗出場)
  return { caught, stillFleeing: f._fleeing }; });
R('逃跑中可被抓住(追擊玩法)+放開後繼續逃', chase.caught && chase.stillFleeing, JSON.stringify(chase));

// ---------- ④ 到出口=白煙消失+排資深進場 ----------
await page.evaluate(() => { const f = __v2.fighters[1];
  f.fumbleT = 0; f.stunned = false;
  f.x = f._fleeTo[0] - 30; f.y = f._fleeTo[1]; });                     // teleport 到出口旁(免等長跑)
await page.waitForFunction('__v2.fighters[1].state === "away"', { timeout: 15000 }).catch(() => {});
const out = await page.evaluate(() => { const v = __v2; const f = v.fighters[1];
  return { state: f.state, hidden: f._hidden, callAt: v.v2s.aiCallAt > 0, pos: v.v2s.aiCallPos }; });
R('到出口=消失(away+_hidden)+資深進場已排程', out.state === 'away' && out.hidden && out.callAt && Array.isArray(out.pos), JSON.stringify(out));

// ---------- ⑤ 資深同事同點進場:檔案切換+比分保留 ----------
await page.evaluate(() => { __v2.v2s.aiCallAt = __v2.game.time; });    // fast-forward(免等 CALL_T 實時)
await page.waitForFunction('__v2.v2s.aiTier === "senior"', { timeout: 15000 }).catch(() => {});
const senior = await page.evaluate(() => { const v = __v2; const f = v.fighters[1];
  return { tier: v.v2s.aiTier, name: v.NAMES[1], state: f.state, hidden: f._hidden,
    wins: [v.roundWins[0], v.roundWins[1]], nearExit: Math.hypot(f.x - v.v2s.aiCallPos[0], f.y - v.v2s.aiCallPos[1]) < 5 }; });
R('資深同事進場(檔案/名字切換、同點、比分保留 2:0)', senior.tier === 'senior' && senior.name === '資深同事' && senior.state === 'alive' && !senior.hidden && senior.wins[0] === 2 && senior.nearExit, JSON.stringify(senior));

// ---------- ⑥ 資深讀起手舉防(實習生檔不會) ----------
await page.evaluate(() => { const v = __v2; const a = v.fighters[0], f = v.fighters[1];
  f.invuln = 0; f.guardStam = 100; f.guardLock = 0; f.stunned = false; f.fumbleT = 0; f._jumpT = -9; f.z = 0;
  a.x = 400; a.y = 320; f.x = 460; f.y = 320;                          // 近距(< PUNCH_RANGE+r+30)
  a._strikeAt = v.game.time + 9; a._strikeDir = 0; });                 // 玩家出拳起手撐住(feel-2 承諾=可讀預告)
await page.waitForFunction('__v2.fighters[1].guarding === true', { timeout: 15000 }).catch(() => {});
const guardUp = await page.evaluate(() => __v2.fighters[1].guarding);
await page.evaluate(() => { const a = __v2.fighters[0]; a._strikeAt = __v2.game.time; __v2.resolveStrike(a); a._recoverT = 0; }); // 收招
await page.waitForFunction('__v2.fighters[1].guarding === false', { timeout: 15000 }).catch(() => {});
const guardDown = await page.evaluate(() => __v2.fighters[1].guarding);
R('資深讀起手舉防(起手中=舉防/收招後=放下)', guardUp === true && guardDown === false, `up=${guardUp} down=${guardDown}`);

// ---------- ⑦ 逃跑一場只演一次(資深不會再跑) ----------
await page.evaluate(() => { const f = __v2.fighters[1]; f.stability = 30; });
await new Promise(r => setTimeout(r, 800));
const once = await page.evaluate(() => ({ fleeing: __v2.fighters[1]._fleeing, tier: __v2.v2s.aiTier }));
R('資深快輸不再逃跑(一場一次)', once.fleeing === false && once.tier === 'senior', JSON.stringify(once));

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
