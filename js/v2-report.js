// v2 事故報告生成 (spec E / V0.8;docs/v2-module-boundaries.md §3)。
// Phase 1「把事故做雜做好笑」的主要擴充點:事故名稱/安全委員會吐槽/稱號都在這裡加。
// 只讀 v2-state 的計數器(inc),不碰玩法/繪製。
import { inc, NAMES } from './v2-state.js';

export function mostUsedItem() {
  const u = inc.itemUses, max = Math.max(u.wind, u.teleport, u.ice);
  if (max === 0) return inc.barrelBooms > 0 ? '爆桶' : '（徒手)';
  return u.teleport === max ? '傳送符' : u.ice === max ? '冰霜瓶' : '風壓手套';
}
export function pickComment() {
  if (inc.reverseContains >= 1) return '技術上來說，有人被成功收容了。只是收錯人。';
  if (inc.throwContains >= 2) return '收容規範沒有規定受測體必須用走的進艙。委員會正在補這一條。';
  if (inc.itemBackfires >= 2) return '受測體最大的敵人，始終是自己手上的道具。';
  if (inc.accidentContains.ice >= 1) return '冰面很滑，收容艙很近。剩下的是物理問題。';
  if (inc.accidentContains.wind >= 1) return '風的方向，有時比法術更難預測。';
  if (inc.barrelBooms >= 3) return '魔法倉庫的爆桶不是裝飾品。雖然你們把它當成了。';
  if (inc.itemUses.teleport >= 3) return '請停止濫用傳送符。空間結構有它的極限。';
  return '收容程序完成。過程恕不予置評。';
}
export function generateReport(winner) {
  const ac = inc.accidentContains, accTotal = ac.wind + ac.ice + ac.barrel;
  const dangerKinds = (inc.itemUses.teleport > 0 ? 1 : 0) + (inc.barrelBooms > 0 ? 1 : 0); // 涉案危險級道具種類(概念§8)
  const chaos = inc.carries[0] + inc.carries[1] + accTotal * 2 + inc.reverseContains * 3
    + inc.throwContains * 2 + inc.itemBackfires + inc.barrelBooms + dangerKinds;
  const level = chaos >= 14 ? 'S+' : chaos >= 10 ? 'S' : chaos >= 7 ? 'A' : chaos >= 5 ? 'B' : chaos >= 3 ? 'C' : 'D';
  let name, summary;
  if (inc.reverseContains >= 2) { name = '反向收容拉鋸事件'; summary = `收容員與受測體多次互換身分，反向收容共 ${inc.reverseContains} 次。`; }
  else if (inc.reverseContains >= 1) { name = '反向收容事件'; summary = `有人剛要完成收容，轉眼自己被關了進去。`; }
  else if (inc.throwContains >= 2) { name = '人體拋射事件'; summary = `受測體被憑空拋進收容艙 ${inc.throwContains} 次，拋物線堪稱教科書。`; }
  else if (inc.barrelBooms >= 3) { name = '連環爆破事件'; summary = `爆桶連環引爆 ${inc.barrelBooms} 次，現場已無「桶」的概念。`; }
  else if (inc.itemBackfires >= 2) { name = '自體事故頻發事件'; summary = `受測體被自己的道具害到 ${inc.itemBackfires} 次，展現高度自我毀滅天賦。`; }
  else if (ac.ice >= 1) { name = '自投羅網事件'; summary = `${ac.ice} 次有人在冰面上一路滑進了收容艙。`; }
  else if (ac.wind >= 1) { name = '強風收容事件'; summary = `${ac.wind} 次有人被一陣風直接吹進收容艙。`; }
  else if (inc.itemUses.teleport >= 3) { name = '空間錯亂事件'; summary = `傳送符被使用 ${inc.itemUses.teleport} 次，沒人確定自己現在站在哪。`; }
  else if (inc.barrelBooms >= 1) { name = '倉庫起火事件'; summary = `爆桶被引爆 ${inc.barrelBooms} 次，安全規範表示遺憾。`; }
  else { name = '標準收容測試'; summary = '收容程序大致完成，僅輕微失控。'; }
  const title = inc.reverseContains >= 1 ? '換位藝術家'
    : inc.throwContains >= 2 ? '人體投籃選手'
    : inc.itemBackfires >= 2 ? '自助受測體'
    : inc.barrelBooms >= 3 ? '爆破藝術家'
    : ac.ice >= 1 ? '滑冰收容大師'
    : inc.carries[winner] >= 2 ? '王牌收容員' : '合格但不可取';
  const damage = Math.min(99, chaos * 8);
  const code = 'MIR-' + Math.floor(Math.random() * 0x10000).toString(16).toUpperCase().padStart(4, '0');
  const comment = pickComment();
  const mostUsed = mostUsedItem();
  const num = 100 + ((chaos * 7 + inc.contains[0] * 3 + inc.contains[1] * 5 + inc.reverseContains * 11) % 900);
  const share = `我在《魔法事故報告》觸發了 ${level} 級事故：${name}。\n${NAMES[winner]} 完成收容，基地損害 ${damage}%，主要涉案道具「${mostUsed}」。\n安全委員會：「${comment}」\n挑戰碼：${code}`;
  return { num, name, level, winner, summary, comment, title, code, damage, mostUsed, share, time: inc.matchT };
}
