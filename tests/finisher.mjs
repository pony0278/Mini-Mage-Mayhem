// 規格 G(flow-1)驗收:事故記錄計分 + 收容終演(docs/v2-spec-G-records-finisher.md)
// ①中段擊暈=+1 記錄(不重置場地/不演出)②中段入艙=+1 記錄+拒收吐回(北管道彈出+短保護)
// ③集滿 RECORD_TARGET=收容指令(stage 3、無演出、比賽繼續)④賽末點擊暈=終演窗口(prompt+倒地延長)
// ⑤窗口過期(對手醒)=終演取消打續 ⑥按 X=自動駕駛 run→carry→throw→完整封存演出(final n=3)→報告
// ⑦letterbox 進度 ⑧restartMatch 清乾淨 ⑨無 console 錯誤
// 陷阱:rAF 節流(?turbo=8);AI 關掉(f1 亂跑會蹭出額外記錄);兩人擺位要離艙 >POD.r(擊暈貼艙=stun+入艙雙記錄);
//       擊暈之間要等醒+清 restunT(RESTUN_IMMUNE 防連刷=fresh 轉換才記錄)。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.goto('http://localhost:8099/v2.html?turbo=8', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();
await page.evaluate(() => { const v = __v2; v.v2s.introT = 0; v.fighters[1].ai = false; });
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };

const gwait = (sec) => page.evaluate(s => new Promise(res => { const t0 = __v2.game.time; const iv = setInterval(() => { if (__v2.game.time - t0 >= s) { clearInterval(iv); res(); } }, 20); }), sec);
// 遠離艙(480,320)擺位 + 擊暈 f1(fresh 轉換=+1 記錄)
const stunFar = () => page.evaluate(() => { const v = __v2;
  v.fighters[0].x = 200; v.fighters[0].y = 320; v.fighters[0].vx = 0; v.fighters[0].vy = 0;
  v.fighters[1].x = 260; v.fighters[1].y = 320; v.fighters[1].vx = 0; v.fighters[1].vy = 0; v.fighters[1]._lastItem = 'fire';
  v.stunFighter(v.fighters[1]); });
const wake1 = async () => { // 等 f1 醒 + 清可再暈狀態(restun 免疫/無敵/踉蹌)
  await page.waitForFunction('!__v2.fighters[1].stunned && __v2.fighters[1].invuln <= 0', { timeout: 120000 });
  await page.evaluate(() => { const f = __v2.fighters[1]; f.restunT = 0; f.fumbleT = 0; f.vx = 0; f.vy = 0; });
};

// ---------- ① 中段擊暈 = +1 記錄,不重置場地、不演出 ----------
await stunFar(); await gwait(0.3);
const s1 = await page.evaluate(() => { const v = __v2; const st = v.state(); return { wins: st.roundWins, stage: st.stage,
  p: !!st.perform, rej: !!st.reject, fin: !!st.finisher, over: st.matchOver,
  log: st.containLog.at(-1), f0x: Math.round(v.fighters[0].x), f1x: Math.round(v.fighters[1].x) }; });
R('中段擊暈=+1 記錄(1-0/stun 入 containLog)', s1.wins[0] === 1 && s1.wins[1] === 0 && s1.log && s1.log.m === 'stun' && s1.log.w === 0, JSON.stringify(s1));
R('不重置場地/不演出/未開終演', !s1.p && !s1.rej && !s1.fin && !s1.over && s1.f0x === 200 && Math.abs(s1.f1x - 260) < 20, JSON.stringify(s1));

// ---------- ② 中段入艙 = +1 記錄 + 拒收吐回 ----------
await page.evaluate(() => { const v = __v2; v.fighters[1].x = v.POD.x; v.fighters[1].y = v.POD.y; }); // 暈著被挪進艙=失控入艙
const gotReject = await page.waitForFunction('__v2.state().reject', { timeout: 60000 }).then(() => true).catch(() => false);
const s2 = await page.evaluate(() => { const v = __v2; const st = v.state(); return { wins: st.roundWins, p: !!st.perform, over: st.matchOver,
  pin: Math.round(v.fighters[1].x) === v.POD.x && Math.round(v.fighters[1].y) === v.POD.y }; });
R('中段入艙=+1 記錄(2-0)+拒收啟動(不封存)', gotReject && s2.wins[0] === 2 && !s2.p && !s2.over && s2.pin, JSON.stringify(s2));
await page.waitForFunction('!__v2.state().reject', { timeout: 120000 });
const s2b = await page.evaluate(() => { const v = __v2; return { y: Math.round(v.fighters[1].y), inv: +v.fighters[1].invuln.toFixed(1),
  stunned: v.fighters[1].stunned, podTop: v.POD.y - v.POD.r }; });
R('拒收吐回:北管道彈出+短保護+可行動', s2b.y < s2b.podTop && s2b.inv > 0 && !s2b.stunned, JSON.stringify(s2b));

// ---------- ③④ 第 3 筆記錄 = 收容指令 + 終演窗口(prompt) ----------
await wake1();
await stunFar(); await gwait(0.15);
const s3 = await page.evaluate(() => { const v = __v2; const st = v.state(); return { wins: st.roundWins, stage: st.stage, over: st.matchOver,
  p: !!st.perform, fin: st.finisher, stunT: +v.fighters[1].stunT.toFixed(1) }; });
R('集滿 3 筆=收容指令(stage 3/比賽未結束)', s3.wins[0] === 3 && s3.stage === 3 && !s3.over && !s3.p, JSON.stringify(s3));
R('賽末點擊暈=終演窗口開(prompt/倒地延長超過素 STUN_T)', s3.fin && s3.fin.phase === 'prompt' && s3.fin.w === 0 && s3.stunT + s3.fin.t >= 2.4, JSON.stringify(s3)); // stunT 在倒數:量到的值+已流逝 t 才是原始延長量(2.5)

// ---------- ⑤ 窗口過期(對手醒)= 終演取消,打續 ----------
await page.evaluate(() => { __v2.fighters[1].stunT = 0.06; });
await page.waitForFunction('!__v2.state().finisher', { timeout: 60000 });
const s5 = await page.evaluate(() => { const st = __v2.state(); return { p: !!st.perform, over: st.matchOver, wins: st.roundWins, lk: st.letterK }; });
R('窗口過期=取消打續(無演出/無 letterbox)', !s5.p && !s5.over && s5.wins[0] === 3 && s5.lk < 0.1, JSON.stringify(s5));

// ---------- ⑥⑦ 再開窗口 → 按 X = 自動駕駛 run→carry→throw→封存演出→報告 ----------
await wake1();
await stunFar();
await page.waitForFunction('(__v2.state().finisher||{}).phase === "prompt"', { timeout: 60000 });
await page.evaluate(() => { __v2.pressFinisher(__v2.fighters[0]); });
const s6 = await page.evaluate(() => { const v = __v2; const st = v.state(); return { ph: (st.finisher || {}).phase,
  inv: [Math.round(v.fighters[0].invuln), Math.round(v.fighters[1].invuln)], vStun: Math.round(v.fighters[1].stunT) }; });
R('按 X=終演啟動(run/雙方保護/受害者鎖倒地)', s6.ph === 'run' && s6.inv[0] > 90 && s6.inv[1] > 90 && s6.vStun > 90, JSON.stringify(s6));
const gotCarry = await page.waitForFunction('(__v2.state().finisher||{}).phase === "carry"', { timeout: 120000 }).then(() => true).catch(() => false);
const s6b = await page.evaluate(() => { const v = __v2; return { carrying: v.fighters[0].carrying ? v.fighters[0].carrying.pid : -1, lk: v.state().letterK }; });
R('自動抓起(carry/搬運鏈成立)', gotCarry && s6b.carrying === 1, JSON.stringify(s6b));
R('letterbox 進場(letterK 升起)', s6b.lk > 0.3, 'letterK=' + s6b.lk);
const gotPerform = await page.waitForFunction('__v2.state().perform', { timeout: 300000 }).then(() => true).catch(() => false);
const s6c = await page.evaluate(() => { const v = __v2; const st = v.state(); return { p: st.perform, fin: !!st.finisher,
  loser: { x: Math.round(v.fighters[1].x), y: Math.round(v.fighters[1].y) } }; });
R('拋入=完整封存演出(final n=3/終演交棒清空/敗方 snap 艙心)', gotPerform && s6c.p && s6c.p.final === true && s6c.p.n === 3 && !s6c.fin
  && s6c.loser.x === 480 && s6c.loser.y === 320, JSON.stringify(s6c));
await page.waitForFunction('__v2.state().matchOver', { timeout: 300000 });
const s6d = await page.evaluate(() => { const st = __v2.state(); return { over: st.matchOver, report: !!st.report }; });
R('封存 → matchOver(camp-2:事故報告退役,加班模式改極簡結算卡)', s6d.over && !s6d.report, JSON.stringify(s6d));

// ---------- ⑧ restartMatch 清乾淨(終演/拒收/letterbox/比分/鏡頭還原) ----------
const camBefore = await page.evaluate(() => ({ d: Math.round(__v2.CAM.dist) }));
await page.evaluate(() => { __v2.restartMatch(); });
await gwait(0.2);
const s8 = await page.evaluate(() => { const v = __v2; const st = v.state(); return { wins: st.roundWins, fin: !!st.finisher, rej: !!st.reject,
  lk: st.letterK, over: st.matchOver, cam: Math.round(v.CAM.dist), tgt: v.game.camTarget === v.camRig || v.game.camTarget === v.fighters[0] }; });
R('restartMatch 清乾淨(比分/終演/拒收/letterbox/鏡頭目標還原)', s8.wins[0] === 0 && s8.wins[1] === 0 && !s8.fin && !s8.rej && s8.lk < 0.1 && !s8.over && s8.tgt,
  JSON.stringify(s8) + ' camBefore=' + camBefore.d);

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
