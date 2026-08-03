// v2 回歸套件總跑器:啟本機 server(repo root)→ 逐一跑各驗收套件的子行程 → 匯總 pass/fail。
// 用法:cd tests && npm i && npm test  (或 node run-all.mjs)
// 單跑一支:先在 repo root `python3 -m http.server 8099`,再 `cd tests && node bottles.mjs`。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..');

// 套件清單(對應各系統;新系統落地時在此加一行)。
const SUITES = [
  ['bottles',   '投擲瓶=場上物件(撿丟/碎裂/風吹擊飛/走動推)'],
  ['wind',      '風壓手套(扇形放射/距離角度衰減/翻滾/反彈/穿防)'],
  ['oilfire',   '油瓶+噴火帽(油膜/短扇形不留地形火/著火 DoT/R1 連段/起手預告)'],
  ['water',     '工業重錘+火融冰(火帽融冰成水/砸壓造濕地+短擊倒/濕地接雷 R2)'],
  ['lightning', '魔導電鞭(直線電擊擊暈/線外不中/沿線給水充電 R2/起手預告直線)'],
  ['detonate',  'Z=開火、X=互動分工 + 道具引爆桶/瓶(火帽瓶碎即燃/水錘砸碎/電鞭線上碎/傳送不擋互動)'],
  ['keys',      '鍵盤操作 keys-1(滑鼠退役:C拳/X互動/Z道具/方向鍵8向面向=移動方向/停下保留/滑鼠點擊無效)'],
  ['itemlock',  '道具施法承諾 item-4g/4i(施法中鎖腳不能走+鎖面向不能瞬轉/teleport 瞬發不鎖)'],
  ['switches',  '總開關移左右兩側(揍任一支 arm 四站/舊中央位置失效/範圍外不觸發)'],
  ['podglb',    '回收艙底座 GLB(開局載入+擺位/換裝生效)'],
  ['frostbottle','冰霜瓶三狀態 + ugc-5 風格契約(程序化=無貼圖/霧面/低多邊形;?props=glb A/B 路仍守 UV-prune 坑)'],
  ['barrel',    '爆桶 GLB 三狀態 item-2(載成/地面兩桶掛GLB/引信疊加光暈/握持掛GLB)'],
  ['hat',       '火帽 GLB 頭戴 item-3/3b/3c(載成/掛 avatar 頭骨=病3/包覆規則三取 max=頭不露出帽口/無道具=隱藏)'],
  ['skinrig',   '蒙皮 GLB 角色 ugc-1/1b(骨名別名表 native+VRM 各 16 骨/clone 重綁骨架/蒙皮真變形/定位/縮骨頭/A-pose rest 校正/剛體不受影響)'],
  ['psimport',  'punch-studio 匯入實驗室 ugc-1/1b(蒙皮載得進/別名表 native+VRM/A-pose rest 校正/內建角色不校正=WYSIWYG/匯入檢查報告/缺骨明確失敗)'],
  ['psslim',    '匯出遊戲角色檔(瘦身)ugc-2(morph/動畫/VRM 全拔/貼圖≤512 一律 PNG(JPEG=SwiftShader 上傳全黑)/孤兒縮圖 1×1/空殼化不重排/載回 r128+進遊戲 r149/Draco 拒絕)'],
  ['psheadgear','punch-studio 頭戴掛點 item-3b(掛 avatar 頭骨補償 group/世界位置與舊掛法一致=校準值語意不變/清角色退素體)'],
  ['whip',      '魔導電鞭 Verlet 垂鞭/甩鞭 whip-1+whip-2(持電鞭=垂鞭/無道具=隱藏/施放走完/最後一發甩完自動收/鞭梢到位對齊判定幀/爆發必觸發)'],
  ['shock',     '觸電演出 shock-1/1b/2(prewarm/電弧包身/X光骨架掛 avatar 骨/剪影零殘留/定格1.6→暈1.2兩段/姿勢分段/restun 鐵則)'],
  ['smokeroom', 'SMOKE ROOM 道具測試間 smoke-1(開房即測/給道具/彈藥無限/假人無敵+解狀態/地板鋪設/快捷鍵)'],
  ['firespray', '噴火帽 flipbook 噴射 burn-2/2b(atlas 載成/帽口噴射弧由近而遠/前飄下落/逐格播放/播完全收)'],
  ['burn',      '燃燒動作鏈 burn-1(item_fire clip/直擊六段鏈 3.8s/挑飛 z/趴姿/焦黑換材質+還原/restun 鐵則/地形火維持 DoT/帽口常燃火)'],
  ['hudcards',  '下方狀態卡 hud-1(雙卡桌機下方/手機上方/YOU 標/GLB 頭像快照/2D 退路/像素取樣)'],
  ['outline',   '輪廓線身分標記 ui-2(?mark 三態/只描本機身體/殼材質不變式 depthWrite/maxGrow 夾制/背景是地板仍看得到=離屏回讀/fx=low 關)'],
  ['gauntlet',  '風壓手套 GLB 右手裝備 item-4b(載成/持風壓手套=戴右手/掛 avatar 手骨出拳貼手/無道具=隱藏)'],
  ['windblast', '風壓開火 3D 爆發 item-4e(發動幀生成/播完清除/FX_LOW 分級/純演出不改判定)'],
  ['pickup',    '手動撿道具 C 案(不自動撿/被暈掉落/地上可搶/TTL)'],
  ['ice_slide', '冰面鎖滑(直線滑/撞牆暈/滑進艙=捕捉/小心走)'],
  ['ring',      '開放邊緣+墜落記錄 ring-1+規格G(rim 地形/走出邊=fall 記錄/自摔·擊落歸因/第3筆=收容指令·賽末點再墜=廢料井封存/AI 邊緣迴避/道具落井)'],
  ['perform',   '收容封存演出 規格G(中段入艙=拒收不封存/賽末點入艙=完整演出 n=3/不二次收容/壓縮→報告)'],
  ['mobilefx',  '手機自動降級(觸控+行動UA→FX_LOW+dpr1.5/桌機不變/?fx=full 覆蓋)'],
  ['onboard',   '上手框架(首局教學旗標/AI 對手開場即開/開場字幕+鏡頭/就位靜止/localStorage)'],
  ['brawl',     '爽鬥核心 brawl-1+規格G(系統全醒/穩定值歸零暈/終結技打飛/反暈/搬進艙=記錄+拒收/事故報告)'],
  ['jump',      '跳躍+下壓拳 brawl-2(跑=預設/空白跳/Shift防/空中免地板免鎖滑/下壓穿防+落空硬直/拍落/跳過艙口)'],
  ['combo',     '連段系統 brawl-3+combo-4(三連黏臉/終結技=唯一挑飛/鉤拳打已暈不飛/空中補拳=拍落倒地/風壓接送/頓點=時間停)'],
  ['hitfx',     '漫畫打擊爆花 hitfx-1(鉤=小橘/挑飛=最大檔集中線/打暈=琥珀/反擊=金/下壓=紅/老化移除/揮空無)'],
  ['dash',      '衝刺攻擊 feel-1+combo-4(突進拳/門檻分派/削30+推/可擋開反擊窗/前衝/對已暈=推不飛/揮空懲罰/clip 槽位)'],
  ['intern',    'AI 階級 tier-1(實習生檔案/快輸逃跑可追擊/到出口消失/資深同點進場比分保留/讀起手舉防/一場一次)'],
  ['fatigue',   'flow-2 疲態+立案 beat+瀕界(疲態檔位=被記錄數/冒汗分級/印章卡+快門+頓點/心跳只給本機瀕界/首次提示一次性/演出中靜音)'],
  ['finisher',  '規格 G flow-1(中段擊暈/入艙=記錄+拒收/收容指令/終演窗口 prompt→X→自動 run-carry-throw→封存/過期取消/restart 清乾淨)'],
];

// ⚠ server 一定要從 repo root 起(套件裡 import('./js/…') 由瀏覽器對 server 根解析;從 tests/ 起會 404)。
const server = spawn('python3', ['-m', 'http.server', '8099'], { cwd: root, stdio: 'ignore' });
const cleanup = () => { try { server.kill(); } catch { /* already gone */ } };
process.on('exit', cleanup); process.on('SIGINT', () => { cleanup(); process.exit(130); });

async function waitServer() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('http://localhost:8099/v2.html?turbo=8'); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

const runSuite = (name) => new Promise((res) => {
  const p = spawn('node', [join(__dir, name + '.mjs')], { cwd: __dir, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', d => (out += d));
  p.stderr.on('data', d => (out += d));
  p.on('close', (code) => res({ name, code, out }));
});

if (!(await waitServer())) { console.error('✗ 本機 server 起不來(port 8099)'); process.exit(2); }

// 併發池(2026-07-20 提速):套件彼此獨立(各自開瀏覽器、共用靜態 server)→ 同時跑 CONC 套。
// 搭配 ?turbo=8(v2.js 測試旗:每幀 8 次 step)把 10min+ 的全套壓進分鐘級;CONC=1 可退回序列。
const CONC = Math.max(1, parseInt(process.env.CONC || '3', 10) || 3);
const results = new Array(SUITES.length);
let next = 0;
async function worker() {
  while (next < SUITES.length) {
    const my = next++;
    const t0 = Date.now();
    results[my] = await runSuite(SUITES[my][0]);
    results[my].secs = Math.round((Date.now() - t0) / 1000);
    process.stderr.write(`  ▸ ${SUITES[my][0]} done(${results[my].secs}s)\n`); // 進度心跳(stderr,不進匯總)
  }
}
const wall0 = Date.now();
await Promise.all(Array.from({ length: CONC }, worker));
let failed = 0;
for (let i = 0; i < SUITES.length; i++) {
  const [name, desc] = SUITES[i]; const r = results[i];
  const summary = (r.out.match(/== .* ==/g) || ['(無匯總行)']).pop();
  console.log(`${r.code === 0 ? '✓ PASS' : '✗ FAIL'}  ${name.padEnd(11)} ${summary}   — ${desc}`);
  if (r.code !== 0) {
    failed++;
    const lines = r.out.split('\n');
    for (const line of lines) if (line.startsWith('FAIL')) console.log('        ' + line);
    // 「(無匯總行)」=行程在印出匯總前就死了(protocolTimeout/瀏覽器起不來/未捕捉例外)——
    // 只印 FAIL 行會什麼都看不到,把尾巴倒出來才查得下去。
    if (!/== .* ==/.test(r.out)) for (const line of lines.filter(Boolean).slice(-8)) console.log('        · ' + line);
  }
}
console.log(`\n== ${SUITES.length - failed}/${SUITES.length} suites green ==(${Math.round((Date.now() - wall0) / 1000)}s,CONC=${CONC},turbo=8)`);
process.exit(failed ? 1 : 0);
