// 跳躍+下壓拳+移動改制(brawl-2;使用者拍板 2026-07-15:空白=跳/Shift=防/跑=預設)驗收:
// ①跑=預設(按住方向鍵 running;雙擊退役)②空白=跳(z 弧線起落+jumpCd)③Shift=防禦(edge+held)
// ④空中免地板化學(火海上方跳過不削穩定)⑤鎖滑中起跳=跳出冰面 ⑥下壓拳命中=大削穩定+穿防
// ⑦下壓落空=硬直 ⑧空中挨拳=拍落小翻滾(AIR_HIT_LOB)⑨跳躍飛越艙口不觸發失控收容 ⑩無 console 錯誤
// 陷阱:rAF 節流下 keyboard.press() 的 down/up 落在同一取樣幀=edge 吃不到 → 鍵測試一律 down/等待/up;
//       戰鬥判定直接呼叫 __v2.jump/dive/resolveStrike;角色遠離 POD(480,320,r46) 用 y≈540。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 180000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* privacy */ } });
await page.goto('http://localhost:8099/v2.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };
const W = (expr, s = 30) => page.waitForFunction(expr, { timeout: s * 1000 }).then(() => true).catch(() => false);

await page.evaluate(async () => {
  const v = __v2; v.v2s.introT = 0; v.fighters[1].ai = false; v.CAM.azimuth = 0;
  const M = await import('./js/v2-floor.js');
  window.__stamp = (x, y, r, e) => M.stampElement(x, y, r, e);
});

// ---------- ① 跑=預設 ----------
await page.keyboard.down('w');
const runOn = await W('__v2.state().running[0] === true', 10);
await page.keyboard.up('w');
const runOff = await W('__v2.state().running[0] === false', 10);
R('跑=預設(按住方向鍵=running;放開即停;雙擊退役)', runOn && runOff);

// ---------- ② 空白=跳:z 弧線起落 ----------
await page.keyboard.down(' ');
const rose = await W('__v2.state().z[0] > 10', 30);
await page.keyboard.up(' ');
const landed = await W('__v2.state().z[0] === 0 && !__v2.state().jumping[0]', 30);
const cd = await page.evaluate(() => __v2.fighters[0].jumpCd > -1);
R('空白=跳(z 升起→落地+再跳冷卻)', rose && landed && cd);

// ---------- ③ Shift=防禦 ----------
await page.evaluate(() => { const f = __v2.fighters[0]; f.guardStam = 100; });
await page.keyboard.down('Shift');
const gOn = await W('__v2.fighters[0].guarding === true', 10);
await page.keyboard.up('Shift');
const gOff = await W('__v2.fighters[0].guarding === false', 10);
R('Shift 按住=舉防(空白已讓給跳)', gOn && gOff);

// ---------- ④ 空中免地板化學:火海上跳過 ----------
const fireDodge = await page.evaluate(() => { const v = __v2; const f = v.fighters[0];
  f.x = 700; f.y = 540; f.vx = f.vy = 0; f.stability = 100; f.stunned = false; f.invuln = 0; f.jumpCd = 0; f.burnT = 0;
  __stamp(700, 540, 40, 'fire');
  v.jump(f);
  f._jumpT = v.game.time - 0.2;                     // 快轉到空中段(z>1)
  return { jumped: f._jumpT > -5, stab0: Math.round(f.stability) };
});
await page.evaluate(() => new Promise(res => { const v = __v2, t0 = v.game.time; const iv = setInterval(() => { if (v.game.time - t0 > 0.25) { clearInterval(iv); res(); } }, 25); })); // 站火 0.25s 遊戲時(在地面會被削 ~15 穩定)
const fireRes = await page.evaluate(() => { const f = __v2.fighters[0]; const s = Math.round(f.stability);
  f.x = 100; f.y = 100; f._jumpT = -9; return s; });
R('空中免地板化學(火海上方滯空,穩定值不掉)', fireDodge.jumped && fireRes === 100, 'stab=' + fireRes);

// ---------- ⑤ 鎖滑中起跳=跳出冰面 ----------
await page.evaluate(() => { const v = __v2; const f = v.fighters[0];
  __stamp(400, 520, 90, 'ice');
  f.x = 220; f.y = 520; f.vx = f.vy = 0; f.stunned = false; f.invuln = 0; f._onIce = false; f._slideVx = 0; f._slideVy = 0; f.jumpCd = 0; });
await page.keyboard.down('d');
const iceLocked = await W('__v2.fighters[0]._slideVx !== 0 || __v2.fighters[0]._slideVy !== 0', 20);
await page.keyboard.up('d');
const iceJump = await page.evaluate(() => { const v = __v2; const f = v.fighters[0];
  v.jump(f);
  return { jumped: f._jumpT > -5, slideCleared: !f._slideVx && !f._slideVy, keptMomentum: Math.hypot(f.vx, f.vy) > 50 };
});
R('鎖滑中起跳=解鎖跳出(動量帶上天)', iceLocked && iceJump.jumped && iceJump.slideCleared && iceJump.keptMomentum, JSON.stringify(iceJump));
await W('__v2.state().z[0] === 0 && !__v2.state().jumping[0]', 30);

// ---------- ⑥ 下壓拳命中=大削穩定+穿防 ----------
await page.evaluate(() => { const v = __v2; const a = v.fighters[1], o = v.fighters[0];
  a.x = 470; a.y = 540; o.x = 500; o.y = 540; o.vx = o.vy = 0; o.invuln = 0; o.stability = 100; o.restunT = 9; o.stunned = false; o.fumbleT = 0;
  o.guarding = true; o.guardStam = 100;
  a.stunned = false; a.fumbleT = 0; a.punchCd = 0; a.jumpCd = 0; a.facing = Math.atan2(o.y - a.y, o.x - a.x);
  v.jump(a); });
await W('__v2.state().z[1] > 8', 30);
await page.evaluate(() => { const a = __v2.fighters[1]; a.punchCd = 0; __v2.dive(a); });
const dived = await W('__v2.state().diving[1] === true', 10);
await W('__v2.state().diving[1] === false && __v2.state().z[1] === 0', 30);
const diveHit = await page.evaluate(() => { const o = __v2.fighters[0]; return { stab: Math.round(o.stability), pierced: !o.guarding }; });
R('下壓拳落地判定=削穩定 45+穿防(剋龜)', dived && diveHit.stab === 55 && diveHit.pierced, JSON.stringify(diveHit));

// ---------- ⑦ 下壓落空=硬直 ----------
await page.evaluate(() => { const v = __v2; const a = v.fighters[1], o = v.fighters[0];
  o.x = 100; o.y = 100; a.x = 470; a.y = 540; a.punchCd = 0; a.jumpCd = 0; a.fumbleT = 0; a.stunned = false; a._diveLagT = 0;
  v.jump(a); });
await W('__v2.state().z[1] > 8', 30);
await page.evaluate(() => { const a = __v2.fighters[1]; a.punchCd = 0; __v2.dive(a); });
await W('__v2.state().diving[1] === false', 30);
const lag = await page.evaluate(() => +__v2.fighters[1]._diveLagT.toFixed(2));
R('下壓落空=硬直(有承諾才有讀取)', lag > 0, 'lag=' + lag);

// ---------- ⑧ 空中挨拳=拍落小翻滾 ----------
const swat = await page.evaluate(() => { const v = __v2; const a = v.fighters[1], o = v.fighters[0];
  a.stunned = false; a.fumbleT = 0; a._diveLagT = 0; a.punchCd = 0;
  o.x = 500; o.y = 540; o.vx = o.vy = 0; o.stunned = false; o.fumbleT = 0; o.invuln = 0; o.restunT = 9; o.jumpCd = 0; o.guarding = false;
  a.x = 470; a.y = 540;
  v.jump(o); o._jumpT = v.game.time - 0.25;         // 快轉到弧頂附近
  a._strikeKind = 0; a._strikeDir = Math.atan2(o.y - a.y, o.x - a.x); v.resolveStrike(a);
  return { thrown: o._thrownT > -5, tumble: o.fumbleT > 0, jumpCleared: o._jumpT < -5, smallLob: o._lob && o._lob.T < 0.5 };
});
R('空中挨拳=拍落(小翻滾 AIR_HIT_LOB,跳躍戳清除)', swat.thrown && swat.tumble && swat.jumpCleared && swat.smallLob, JSON.stringify(swat));

// ---------- ⑨ 跳躍飛越艙口不觸發失控收容 ----------
const podSafe = await page.evaluate(() => new Promise(res => { const v = __v2; const f = v.fighters[0];
  f.x = v.POD.x; f.y = v.POD.y; f.vx = 300; f.vy = 0; f.stunned = false; f.fumbleT = 0; f._thrownT = -9; f.invuln = 0; f.jumpCd = 0;
  const wins0 = v.state().roundWins[1];
  v.jump(f);                                        // 帶著超過門檻的速度「跳過」艙心
  const t0 = v.game.time;
  const iv = setInterval(() => { if (v.game.time - t0 > 0.3 || v.state().perform) { clearInterval(iv);
    res({ contained: !!v.state().perform || v.state().roundWins[1] > wins0 }); } }, 25);
}));
await page.evaluate(() => { const f = __v2.fighters[0]; f.x = 100; f.y = 540; f.vx = 0; f._jumpT = -9; });
R('主動跳躍飛越艙口=受控,不觸發失控收容', !podSafe.contained);

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
