// 連段系統(brawl-3;使用者拍板 2026-07-15:連段黏臉→暈→挑飛→風壓接送進艙)驗收:
// ①三連擊全中=一次暈,且暈在原地不飛走(連段黏得住)②連段中每一拳都不位移(有穩定值時純踉蹌)
// ③對已暈者出拳=挑飛 launcher ④風壓打空中目標=乾淨接送(往瞄準方向直送/不墊穩定/換 WIND_CARRY_LOB)
// ⑤風壓打地面目標=維持吹翻滾(墊穩定防站樁,不搶連段接送)⑥全鏈:挑飛→風壓接送→進艙(記 wind)⑦無錯
// 陷阱:resolveStrike 直接呼叫(免輸入管線);角色放艙南 y≈540 防污染;全鏈把 o 挑飛朝 POD、半程補風壓。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 180000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* privacy */ } });
await page.goto('http://localhost:8099/v2.html', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };
await page.evaluate(() => { const v = __v2; v.v2s.introT = 0; v.fighters[1].ai = false; });

// ---------- ① 三連擊全中=一次暈,暈在原地(不飛走) ----------
const combo = await page.evaluate(() => { const v = __v2; const a = v.fighters[1], o = v.fighters[0];
  a.carryObj = null; a.carrying = null; a.stunned = false;
  a.x = 470; a.y = 540; o.x = 500; o.y = 540; o.vx = o.vy = 0; o.invuln = 0; o.restunT = 0; o.stability = 100; o.stunned = false; o.fumbleT = 0; o._lob = null; o._thrownT = -9;
  const ox0 = o.x;
  const drift = [];
  for (let k = 0; k < 3; k++) { a._strikeKind = k; a._strikeDir = Math.atan2(o.y - a.y, o.x - a.x); v.resolveStrike(a); drift.push(o.fumbleT > 0); if (k < 2) { o.x = 500; o.y = 540; } }
  return { stunned: o.stunned, stab: Math.round(o.stability), thrown: o.fumbleT > 0, driftX: Math.round(Math.abs(o.x - ox0)), midFlung: drift[0] || drift[1] };
});
R('三連擊全中=一次暈(25+25+50=100)', combo.stunned && combo.stab === 0, JSON.stringify(combo));
R('打暈那拳=暈在原地(不飛走,連段黏得住)', !combo.thrown && combo.driftX < 20, JSON.stringify(combo));

// ---------- ② 連段中的拳(有穩定值)都不位移 ----------
R('連段中每拳都純踉蹌不位移(前兩拳不觸發翻滾)', combo.midFlung === false);

// ---------- ③ 對已暈者出拳=挑飛 launcher ----------
const launch = await page.evaluate(() => { const v = __v2; const a = v.fighters[1], o = v.fighters[0];
  o.stunned = true; o.stunT = 5; o.restunT = 0; o.stability = 0; o.invuln = 0; o.fumbleT = 0; o._lob = null; o.carrying = null;
  a.x = 470; a.y = 540; o.x = 500; o.y = 540; o.vx = o.vy = 0; a.punchCd = 0;
  a._strikeKind = 0; a._strikeDir = Math.atan2(o.y - a.y, o.x - a.x); v.resolveStrike(a);
  return { lob: o._lob === v.PUNCH_LAUNCH_LOB, fumble: +o.fumbleT.toFixed(2), speed: Math.round(Math.hypot(o.vx, o.vy)) };
});
R('對已暈者出拳=挑飛(PUNCH_LAUNCH_LOB)', launch.lob && launch.fumble > 0 && launch.speed > 100, JSON.stringify(launch));

// ---------- ④ 風壓打空中目標=乾淨接送 ----------
const carry = await page.evaluate(() => { const v = __v2; const a = v.fighters[1], o = v.fighters[0];
  o.x = 480; o.y = 320; o.z = 30; o._lob = v.PUNCH_LAUNCH_LOB; o._thrownT = v.game.time - 0.1; o.fumbleT = 0.5; o.stability = 5; o.invuln = 0;
  a.x = 380; a.y = 320; a.facing = 0; a.item = 'wind'; a.itemUses = 3;                 // 瞄 +x
  v.castWind(a);
  return { lob: o._lob === v.WIND_CARRY_LOB, vx: Math.round(o.vx), vy: Math.round(o.vy), stab: Math.round(o.stability), toward: o.vx > 100 };
});
R('風壓打空中=乾淨接送(WIND_CARRY_LOB/往瞄準方向/不墊穩定)', carry.lob && carry.toward && carry.stab <= 5, JSON.stringify(carry));

// ---------- ⑤ 風壓打地面目標=維持吹翻滾(墊穩定,非接送) ----------
const ground = await page.evaluate(() => { const v = __v2; const a = v.fighters[1], o = v.fighters[0];
  o.x = 480; o.y = 320; o.z = 0; o._lob = null; o._thrownT = -9; o.fumbleT = 0; o.stability = 5; o.stunned = false; o.invuln = 0;
  a.x = 400; a.y = 320; a.facing = 0; a.item = 'wind'; a.itemUses = 3;
  v.castWind(a);
  return { notCarry: o._lob !== v.WIND_CARRY_LOB, apex: o._lob && o._lob.apex, stab: Math.round(o.stability) };
});
R('風壓打地面=吹翻滾(墊穩定防站樁,不搶連段接送)', ground.notCarry && ground.apex === 34 && ground.stab >= 25, JSON.stringify(ground));

// ---------- ⑥ 全鏈:挑飛→風壓接送→進艙(記 wind) ----------
const chain = await page.evaluate(() => new Promise(res => { const v = __v2; const a = v.fighters[1], o = v.fighters[0];
  v.v2s.perform = null; v.roundWins[0] = 0; v.roundWins[1] = 0; v.containLog.length = 0;
  o.stunned = true; o.stunT = 5; o.restunT = 0; o.invuln = 0; o.fumbleT = 0; o._lob = null; o._thrownT = -9; o.carrying = null; o.stability = 5;
  o.x = 360; o.y = 320; a.x = 300; a.y = 320; a.facing = 0; a.punchCd = 0; a.item = 'wind'; a.itemUses = 3;
  a._strikeKind = 0; a._strikeDir = 0; v.resolveStrike(a);                              // 挑飛往 +x(朝 POD 480,320)
  setTimeout(() => { a.x = o.x - 120; a.y = o.y; a.facing = Math.atan2(o.y - a.y, o.x - a.x); v.castWind(a); // 半程補風壓接送
    const t0 = v.game.time;
    const iv = setInterval(() => { const s = v.state();
      if (s.perform || s.roundWins[1] > 0 || v.game.time - t0 > 1.5) { clearInterval(iv);
        res({ perform: !!s.perform, wins: s.roundWins, log: s.containLog }); } }, 25);
  }, 250);
}));
const chainOk = (chain.perform || chain.wins[1] > 0) && chain.log.some(c => c.m === 'wind');
R('全鏈 挑飛→風壓接送→進艙(收容成功+記 wind)', chainOk, JSON.stringify(chain));

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
