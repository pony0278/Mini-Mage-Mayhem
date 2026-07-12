// 總開關移到左右兩側(玩家反饋:原本埋中央回收艙圓環內違反直覺)驗收:
// ①開場 stationsArmed=false、labSwitches 兩支在 (80,320)/(880,320) ②揍左開關=arm 四站
// ③reset 後揍右開關=也 arm ④揍舊中央位置(480,250,現無開關)=不 arm ⑤範圍外揍=不 arm
// 陷阱:揍開關判定在 resolveStrike(用 f._strikeDir 當面向);rAF 節流無關(直接呼叫)
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.goto('http://localhost:8099/v2.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };
const armed = () => page.evaluate(() => import('./js/v2-state.js').then(M => M.v2s.stationsArmed));
const setArmed = v => page.evaluate(x => import('./js/v2-state.js').then(M => { M.v2s.stationsArmed = x; }), v);
await page.evaluate(() => { __v2.fighters[1].ai = false; });

// 揍某座標:把施放者擺到該點旁、_strikeDir 面向它,直接 resolveStrike(impact 幀)
const whack = (tx, ty, fromX, fromY) => page.evaluate(([tx, ty, fromX, fromY]) => {
  const v = __v2, f = v.fighters[1];
  f.x = fromX; f.y = fromY; f.stunned = false; f.carrying = null; f.carriedBy = null; f.carryObj = null; f.fumbleT = 0; f.state = 'alive';
  f._strikeKind = 0; f._strikeDir = Math.atan2(ty - f.y, tx - f.x); f._strikeAt = 0.0001;
  v.fighters[0].x = 60; v.fighters[0].y = 600;
  v.resolveStrike(f);
  return true;
}, [tx, ty, fromX, fromY]);

// ---------- ① 開場配置 ----------
await setArmed(false);
const s1 = await page.evaluate(() => ({ n: __v2.labSwitches.length, xs: __v2.labSwitches.map(s => s.x).join(','), ys: __v2.labSwitches.map(s => s.y).join(',') }));
R(`開場兩支開關在左右(x=${s1.xs}、y=${s1.ys})`, s1.n === 2 && s1.xs === '80,880' && s1.ys === '320,320');
R('開場未 arm', (await armed()) === false);

// ---------- ② 揍左開關 = arm ----------
await setArmed(false);
await whack(80, 320, 140, 320);   // 貼左開關(d=60<62)
R('揍左開關=arm 四站', (await armed()) === true);

// ---------- ③ reset 後揍右開關 = 也 arm ----------
await setArmed(false);
await whack(880, 320, 820, 320);  // 貼右開關
R('揍右開關=也 arm(任一支都行)', (await armed()) === true);

// ---------- ④ 揍舊中央位置(480,250)= 不 arm(開關已移走)----------
await setArmed(false);
await whack(480, 250, 480, 300);  // 舊 labSwitch 位置,現在沒東西
R('揍舊中央位置=不 arm(開關已從中央移走)', (await armed()) === false);

// ---------- ⑤ 範圍外揍 = 不 arm ----------
await setArmed(false);
await whack(80, 320, 300, 320);   // 離左開關 220px,遠超 PUNCH_RANGE+r
R('範圍外揍開關=不 arm', (await armed()) === false);

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
