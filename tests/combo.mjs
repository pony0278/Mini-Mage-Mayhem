// 連段系統(brawl-3;使用者拍板 2026-07-15:連段黏臉→暈→挑飛→風壓接送進艙;
// feel-4 增修 2026-07-21:三段「終結技」打暈=連帶挑飛(GetAmped 式);前段打暈仍原地=停兩段可就地抓)驗收:
// ①三連擊全中=一次暈+終結挑飛 ①b 前段(非終結)打暈=原地暈 ②連段中每一拳都不位移(有穩定值時純踉蹌)
// ③對已暈者出拳=挑飛 launcher ④風壓打空中目標=乾淨接送(往瞄準方向直送/不墊穩定/換 WIND_CARRY_LOB)
// ⑤風壓打地面目標=維持吹翻滾(墊穩定防站樁,不搶連段接送)⑥全鏈:挑飛→風壓接送→進艙(記 wind)
// ⑦出拳承諾(feel-2):面向硬鎖+不能跳/舉防——起手+收招=整段揮拳(⑦b _recoverT 蓋章/演完放開)⑧本機起手鎖腳→收招恢復 ⑨無錯
// 陷阱:resolveStrike 直接呼叫(免輸入管線);角色放艙南 y≈540 防污染;全鏈把 o 挑飛朝 POD、半程補風壓。
import puppeteer from 'puppeteer';
const B = await puppeteer.launch({ headless: 'new', protocolTimeout: 180000, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await B.newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGE ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* privacy */ } });
await page.goto('http://localhost:8099/v2.html?turbo=8', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__v2 && __v2.fighters[0].state === "alive"', { timeout: 20000 });
await page.bringToFront();
let pass = 0, fail = 0; const R = (n, ok, e = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (e ? ' [' + e + ']' : '')); ok ? pass++ : fail++; };
await page.evaluate(() => { const v = __v2; v.v2s.introT = 0; v.fighters[1].ai = false; });

// ---------- ① 三連擊全中=一次暈,終結技連帶挑飛(feel-4) ----------
const combo = await page.evaluate(() => { const v = __v2; const a = v.fighters[1], o = v.fighters[0];
  a.carryObj = null; a.carrying = null; a.stunned = false;
  a.x = 470; a.y = 540; o.x = 500; o.y = 540; o.vx = o.vy = 0; o.invuln = 0; o.restunT = 0; o.stability = 100; o.stunned = false; o.fumbleT = 0; o._lob = null; o._thrownT = -9;
  const drift = [];
  for (let k = 0; k < 3; k++) { a._strikeKind = k; a._strikeDir = Math.atan2(o.y - a.y, o.x - a.x); v.resolveStrike(a); drift.push(o.fumbleT > 0); if (k < 2) { o.x = 500; o.y = 540; } }
  return { stunned: o.stunned, stab: Math.round(o.stability), thrown: o.fumbleT > 0, lob: o._lob === v.PUNCH_LAUNCH_LOB, midFlung: drift[0] || drift[1] };
});
R('三連擊全中=一次暈(25+25+50=100)', combo.stunned && combo.stab === 0, JSON.stringify(combo));
R('第三段終結打暈=連帶挑飛(PUNCH_LAUNCH_LOB)', combo.thrown && combo.lob, JSON.stringify(combo));

// ---------- ①b 前段(非終結)打暈=原地暈(停在兩段暈=就地抓的窗口) ----------
const early = await page.evaluate(() => { const v = __v2; const a = v.fighters[1], o = v.fighters[0];
  o.stunned = false; o.restunT = 0; o.stability = 20; o.invuln = 0; o.fumbleT = 0; o._lob = null; o._thrownT = -9; o.vx = o.vy = 0;
  a.x = 470; a.y = 540; o.x = 500; o.y = 540;
  a._strikeKind = 0; a._strikeDir = Math.atan2(o.y - a.y, o.x - a.x); v.resolveStrike(a); // 第一段就打暈(穩定值只剩 20)
  return { stunned: o.stunned, thrown: o.fumbleT > 0 };
});
R('前段(非終結)打暈=原地暈不飛(就地抓窗口保留)', early.stunned && !early.thrown, JSON.stringify(early));

// ---------- ② 連段中的拳(有穩定值)都不位移 ----------
R('連段中每拳都純踉蹌不位移(前兩拳不觸發翻滾)', combo.midFlung === false);

// ---------- ③ 對已暈者出拳=挑飛 launcher ----------
const launch = await page.evaluate(() => { const v = __v2; const a = v.fighters[1], o = v.fighters[0];
  o.stunned = true; o.stunT = 5; o.restunT = 0; o.stability = 0; o.invuln = 0; o.fumbleT = 0; o._lob = null; o.carrying = null;
  a.x = 470; a.y = 540; o.x = 500; o.y = 540; o.vx = o.vy = 0; a.punchCd = 0;
  a._strikeKind = 0; a._strikeDir = Math.atan2(o.y - a.y, o.x - a.x); v.resolveStrike(a);
  return { lob: o._lob === v.PUNCH_LAUNCH_LOB, fumble: +o.fumbleT.toFixed(2), speed: Math.round(Math.hypot(o.vx, o.vy)) };
});
R('對已暈者出拳=挑飛(PUNCH_LAUNCH_LOB)', launch.lob && launch.fumble > 0 && launch.speed > 20, JSON.stringify(launch)); // feel-6 豎直挑空:range 80→18,F=30px/s(舊斷言 >100 配 range 80;挑飛主體在垂直 apex,水平速度小是特性)

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

// ---------- ⑦ 出拳承諾(feel-2):起手面向硬鎖+鎖腳+不能跳/舉防,收招放開 ----------
await page.evaluate(() => { const v = __v2; const a = v.fighters[1];
  a.stunned = false; a.fumbleT = 0; a.punchCd = 0; a.carrying = null; a.carryObj = null; a._dashT0 = -9; a._diveT0 = -9; a._jumpT = -9; a.z = 0; a.guarding = false; a._runT = 0;
  a.x = 300; a.y = 540; a.facing = 0;
  v.punch(a); a._strikeAt = v.game.time + 9; });                       // 撐住起手期
const commit = await page.evaluate(() => { const v = __v2; const a = v.fighters[1];
  a.facing = 2.5;                                                      // 硬轉面向(模擬持續瞄準輸入)
  return { dir: a._strikeDir }; });
await page.waitForFunction('Math.abs(__v2.fighters[1].facing - __v2.fighters[1]._strikeDir) < 0.01', { timeout: 10000 }).catch(() => {});
const locked = await page.evaluate(() => { const v = __v2; const a = v.fighters[1];
  const faceLocked = Math.abs(a.facing - a._strikeDir) < 0.01;
  const x0 = a.x;
  v.jump(a);                                                           // 起手中不能跳
  const noJump = !(a._jumpT > -5);
  const noGuard = !v.canGuard(a);                                      // 起手中不能舉防
  return { faceLocked, noJump, noGuard, x0: Math.round(x0) }; });
await new Promise(r => setTimeout(r, 400));                            // 多等幾幀(無移動輸入的 f1 本就不動;鎖腳由本機案驗)
// ---------- ⑦b 收招承諾:impact 後鎖到 clip 播完(_recoverT 蓋章),清掉即放開 ----------
const recover = await page.evaluate(() => { const v = __v2; const a = v.fighters[1];
  a._strikeAt = v.game.time; v.resolveStrike(a);                       // impact 幀=收招開始
  const rec = a._recoverT > v.game.time;                               // 收招承諾已蓋章(=clip 全長−impact)
  const stillNoGuard = !v.canGuard(a);                                 // 收招中仍不能舉防
  v.jump(a); const stillNoJump = !(a._jumpT > -5);                     // 收招中仍不能跳
  a._recoverT = 0;                                                     // 清掉承諾(=收招演完)
  const freedGuard = v.canGuard(a);
  const why = { st: a.state, stun: a.stunned, cb: !!a.carriedBy, cy: !!(a.carrying || a.carryObj), fum: +a.fumbleT.toFixed(2),
    lock: +a.guardLock.toFixed(2), stam: Math.round(a.guardStam), slide: !!(a._slideVx || a._slideVy), z: +a.z.toFixed(1), jT: a._jumpT,
    dT0: a._diveT0, gt: +v.game.time.toFixed(2), sAt: a._strikeAt, rT: a._recoverT }; // canGuard 全輸入(診斷 flake 用;dT0=airborne 的下壓分量)
  return { rec, stillNoGuard, stillNoJump, freedGuard, why }; });
R('出拳承諾:起手面向硬鎖(轉回出拳方向)+不能跳/舉防', locked.faceLocked && locked.noJump && locked.noGuard, JSON.stringify(locked));
R('收招承諾:impact 後仍鎖(不能跳/舉防)到 clip 播完,演完即放開', recover.rec && recover.stillNoGuard && recover.stillNoJump && recover.freedGuard, JSON.stringify(recover));

// ---------- ⑧ 起手鎖腳(本機玩家按住方向鍵,x 不動;收招後恢復移動) ----------
await page.keyboard.down('d');
await page.evaluate(() => { const v = __v2; const f = v.fighters[0];
  v.v2s.perform = null; f._performing = false; f._hidden = false; f.invuln = 0; // 清掉案例⑥殘留的收容演出(否則 f 被釘在艙心 x=480,鎖腳斷言讀錯人)
  v.game.hitstop = 0; // 清累積頓幀:feel-3 加長後,rAF 節流下 0.1s hitstop ≈ 數秒實時的 sim 凍結,會吃光移動等待窗(陷阱 #10)
  v.fighters[1].x = 700; v.fighters[1].y = 200; // 把對手挪遠:⑦ 留他在 (300,540),收招那記 resolveStrike 會打中他=又生一段 hitstop 凍結
  f.stunned = false; f.fumbleT = 0; f.punchCd = 0; f.carrying = null; f.carryObj = null; f._dashT0 = -9; f._diveT0 = -9; f._jumpT = -9; f.z = 0; f.guarding = false; f._runT = 0; f.vx = 0; f.vy = 0;
  f.x = 300; f.y = 540; v.CAM.azimuth = 0;
  v.punch(f); f._strikeAt = v.game.time + 9; });                       // 起手撐住+按住 d
await new Promise(r => setTimeout(r, 500));
const rooted = await page.evaluate(() => Math.round(__v2.fighters[0].x));
await page.evaluate(() => { const f = __v2.fighters[0]; f._strikeAt = __v2.game.time; __v2.resolveStrike(f); f._recoverT = 0; __v2.game.hitstop = 0; }); // 收招+清承諾+清頓幀(收招鎖由 ⑦b 驗,這裡保持確定性)
await page.waitForFunction('__v2.fighters[0].x > 310', { timeout: 15000 }).catch(() => {});
const freed = await page.evaluate(() => Math.round(__v2.fighters[0].x));
await page.keyboard.up('d');
R('出拳承諾:起手鎖腳(按住方向不滑步)+收招恢復移動', Math.abs(rooted - 300) <= 4 && freed > 310, `起手 x=${rooted} 收招後 x=${freed}`);

// ---------- ⑨ 頓點=時間停(feel-4 治打飛跳幀):hitstop 期間 game.time 凍結,絕對時間彈道/clip 不被偷時鐘 ----------
const t0 = await page.evaluate(() => { __v2.game.hitstop = 60; return __v2.game.time; }); // 直塞大值(addHitstop 帽 0.45 擋不到直寫)
await new Promise(r => setTimeout(r, 400));
const t1 = await page.evaluate(() => { const t = __v2.game.time; __v2.game.hitstop = 0; return t; });
R('頓點期間 game.time 凍結(打飛彈道不再解凍瞬移)', t1 === t0, `t0=${t0.toFixed(3)} t1=${t1.toFixed(3)}`);

R('無 page/console 錯誤', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`== ${pass} pass / ${fail} fail ==`);
await B.close();
process.exit(fail ? 1 : 0);
