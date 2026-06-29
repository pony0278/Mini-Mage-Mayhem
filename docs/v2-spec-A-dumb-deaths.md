# v2 規格 A — 蠢死法 + 畫面糖果（空洞墜落 / 誇張擊飛 / 凸眼）

> 對應：v2《環境處決 PvP》§0.5「漏掉清單 A（最痛・下一個動作）」、§5（�services慌張計時器）、§10。
> 目的：把「受害者被環境送死」的瞬間做成**一眼好笑、可截圖**的演出 —— 病毒分享的入口。
> 狀態：可執行規格（codebase 無關）。實作於醜原型或本 repo 皆可，見末節「零件對照」。
>
> **驗收門檻（這份規格的存在理由）：** 找 3–4 人（含至少一個非朋友）熱座，看「凸眼飛出界掉下去」是否**真的笑出聲**。這同時是回答紅燈一（陌生人笑不笑）最便宜的 Probe。

---

## 0. 設計目標（一句話）
被環境/對手送進死路的瞬間 = **無助掙扎（看得到死、逃不掉）→ 凸眼驚恐 → 滑稽飛出/掉下 → 鏡頭定格可截圖**。
慢半拍、誇張、卡通物理；秒殺=沒戲。

---

## 1. 權威 vs 演出（為了之後 netcode，先分乾淨）
| 類別 | 內容 | 由誰決定 |
|---|---|---|
| **權威（gameplay）** | 是否懸空→墜落、死亡、掉落結晶、`lastHitBy` 歸因 | 伺服器（單機時=sim） |
| **演出（cosmetic）** | 旋轉、縮放、下沉、凸眼臉、音效、鏡頭、粒子 | 客戶端/render（可由狀態+seed 自行播，不需同步） |

實作時把這兩層分開：權威只切換「狀態 + 結果」，演出讀狀態自己播。**現在單機做不用管同步，但別把演出寫進權威邏輯**，否則之後 netcode 會痛。

---

## 2. 實體死亡劇場狀態機

```
              big knockback impulse              over void (grace)            FALL_TIME 到
 ALIVE ───────────────────────────► LAUNCHED ───────────────────► FALLING ───────────────► DEAD
   │                                   │   │                          ▲
   │  walk off edge (over void) ───────┼───┘ slide crosses void edge  │
   │                                   │                              │
   │                                   └── hits wall fast ─► SPLAT ─► ALIVE (短暈)
   └── over void (grace) ─────────────────────────────────────────────┘
```

狀態欄位（掛在 entity 上）：
- `dt`：`'alive' | 'launched' | 'falling' | 'splat'`
- `dtT`：目前狀態計時
- `lvx, lvy`：committed 擊飛向量（launched 期間移動鎖定用）
- `faceT`：凸眼/驚恐臉倒數（**平行覆蓋層**，任何重擊都可點亮，不是獨立狀態）
- `spin`：演出旋轉角
- `dropZ`：墜落垂直位移（render 用；sim 2D，此為 cosmetic 欄位）
- `lastHitBy`：造成這次擊飛/致死的作者（玩家 id 或危險源 owner）→ 歸因/截圖標題

---

## 3. 觸發條件（transitions）

| 轉換 | 條件 |
|---|---|
| ALIVE → FALLING | 中心在 void 且無支撐，持續 `FALL_GRACE`（防邊緣抖動）。**走路掉下去也算**（不需被打）。 |
| ALIVE → LAUNCHED | 收到擊退衝量 `|impulse| ≥ LAUNCH_THRESH`（重擊：土拳打飛/真空氣爆/爆炸/衝鋒撞）。記 `lastHitBy`。 |
| LAUNCHED → FALLING | 擊飛滑行途中中心越過 void 邊緣。 |
| LAUNCHED → SPLAT | 高速撞到實心牆（`speed ≥ SPLAT_SPEED`）。 |
| LAUNCHED → ALIVE | 滑行速度衰減到 `< LAUNCH_END_SPEED`，且未進 void/牆。 |
| SPLAT → ALIVE | `SPLAT_STUN` 後恢復。 |
| FALLING → DEAD | `FALL_TIME` 到。 |
| 任意重擊瞬間 | `faceT = FACE_TIME`（凸眼，平行點亮） |

「無支撐」判定（MVP）：實體中心所在 tile 為 `VOID`、或中心超出場地/縮圈邊界。進階：橋/平台 tile 視為有支撐。

---

## 4. 數值（起始值，playtest 再調）

| 參數 | 值 | 說明 |
|---|---|---|
| `LAUNCH_THRESH` | 280 px/s | 衝量超過＝喜劇擊飛；以下＝普通滑步。（普通拳~77 不觸發；土拳打飛~520、真空~560、爆炸 觸發）|
| `LAUNCH_LOCK` | 0.18 s | 擊飛期間移動鎖在 `lvx/lvy`，不能操控（無助感來源）|
| `LAUNCH_END_SPEED` | 120 px/s | 滑行慢於此 → 回 ALIVE |
| `SPLAT_SPEED` | 320 px/s | 撞牆夠快才拍扁 |
| `SPLAT_STUN` | 0.4 s | 撞牆短暈 + 凸眼 |
| `FALL_GRACE` | 0.08 s | 懸空多久才確定墜落 |
| `FALL_TIME` | 0.6 s | hang + 縮小 + 下沉（懸空感）|
| `FACE_TIME`（凸眼）| 0.35 s | 驚恐臉持續 |
| spin（launched / falling）| 12 / 18 rad/s | 飛行旋轉、墜落更快 |
| falling scale | 1 → 0（ease-in）| 縮進洞裡 |
| falling dropZ | 0 → −120 | 沉到地面下 |
| falling alpha | 後 40% 才 1→0 | 先看得到掙扎再消失 |
| squash/stretch（launch）| 沿速 1.3 / 垂直 0.8 → lerp 回 1 | 卡通拉伸 |
| kill-beat hitstop | 0.06 s（擊飛瞬間）| 讓凸眼幀被看到 |
| 玩家致死鏡頭 | 拉近（dist −120 或 fov −6）+ hold 0.25s + 慢動作 timescale 0.4 ×0.3s | **只在玩家死亡用,不是每隻雜兵** |

---

## 5. 演出細節（畫面糖果的本體）

- **凸眼臉**：重擊/擊飛/開始墜落瞬間，把體素的眼睛換成**大白圈**（高對比、夠大，固定 45° 也讀得到）+ 跳「!」+ 慘叫音。`faceT` 期間維持。**這是 A 的靈魂**——沒有它，飛出去只是物理。
- **擊飛**：大弧、旋轉、squash/stretch；沿 `lvx/lvy` 飛，途中即時判 void/牆。
- **墜落**：縮小 + 旋轉 + 下沉 + 後段淡出 + **下墜口哨音**（音高下滑）。
- **撞牆**：反彈 `v*0.4` + 凸眼 + 短暈 + 灰塵（可接既有「撞牆!」）。
- **致死 beat**：擊飛瞬間 hitstop；玩家墜落死亡時短暫拉近 + 慢動作，讓凸眼臉落畫面中央（直接服務截圖 = 鋪 C 一鍵分享）。

---

## 6. 死亡結算（玩家）

- FALLING→DEAD（玩家）：標記出局；**把手上的結晶/獎盃掉在最後一格實地邊緣**（保持焦點物在場，別人能搶）；噴「X 墜落！」浮字；寫進**最大災難回顧**，cause = `lastHitBy`。
- **作者歸因**：致死的擊飛/危險源帶 `lastHitBy` → 結算顯示「你把 X 轟下去了」→ 截圖標題（看好戲/有作者軸）。自踩自爆 → `lastHitBy = self` → 「X 自己掉下去了」（自作自受軸，更好笑）。

---

## 7. 每幀更新（pseudo，codebase 無關）

```js
function updateDeathTheater(e, dt) {
  if (e.faceT > 0) e.faceT -= dt;                 // 凸眼倒數（平行）

  if (e.dt === 'launched') {
    e.dtT -= dt; e.spin += 12 * dt;
    // 移動鎖在擊飛向量（render 讀 squash/stretch）
    moveBy(e, e.lvx * dt, e.lvy * dt);
    if (overVoid(e)) return enter(e, 'falling');
    if (hitWallFast(e)) return enter(e, 'splat');
    e.lvx *= friction(dt); e.lvy *= friction(dt);
    if (speed(e) < LAUNCH_END_SPEED || e.dtT <= 0) return enter(e, 'alive');
  }
  else if (e.dt === 'falling') {
    e.dtT -= dt; e.spin += 18 * dt;
    e.scale = easeIn(e.dtT / FALL_TIME);          // 1→0
    e.dropZ = -120 * (1 - e.dtT / FALL_TIME);
    if (e.dtT <= 0) return die(e, e.lastHitBy);   // 權威：出局 + 掉結晶 + 歸因
  }
  else if (e.dt === 'splat') {
    e.dtT -= dt; if (e.dtT <= 0) enter(e, 'alive');
  }
  else { // alive
    if (overVoid(e)) { e.voidT = (e.voidT||0)+dt; if (e.voidT > FALL_GRACE) enter(e,'falling'); }
    else e.voidT = 0;
  }
}

// 擊退入口（取代/包住現有的 e.vx += ... 重擊）
function applyKnockback(e, ix, iy, by) {
  e.vx += ix; e.vy += iy;
  e.lastHitBy = by;
  if (Math.hypot(ix, iy) >= LAUNCH_THRESH) {
    e.lvx = ix; e.lvy = iy; e.faceT = FACE_TIME;
    enter(e, 'launched'); addHitstop(0.06);
  }
}
```

`overVoid(e)`：中心 tile==VOID 或超出場地/縮圈邊界。
`enter(e, s)`：設 `e.dt=s; e.dtT=該狀態時長`，並觸發對應 SFX/粒子/鏡頭。

---

## 8. 可調旋鈕（playtest 重點）
- 墜落**別太快**（沒有掙扎視窗就沒戲）：先調 `FALL_TIME` / launch 滑行長度。
- 凸眼**夠不夠大、夠不夠久**（截圖讀得到？）。
- 擊飛弧度與旋轉（誇張到好笑、但不到暈）。
- 鏡頭 beat 只在**玩家死亡**用，雜兵死不要狂拉鏡頭。

---

## 9. 零件對照（搬哪邊都便宜）
| A 的零件 | 醜原型現成 | 本 repo 現成 |
|---|---|---|
| 空洞墜落 | `T_VOID` / `goDown` | 需新增 VOID tile + 墜落狀態；有 `project()`/mesh scale |
| 擊飛 | `knockEntity` | 擊退衝量已遍布（土拳/真空/爆炸/衝鋒）、`addHitstop` |
| 凸眼臉 | （新做）| 體素 mesh、eye blocks 可換；`e.hurt` flash 框架 |
| 致死 beat / 鏡頭 | （新做）| 螢幕震動、`project()`、CAM（fov/dist 可動）|
| 歸因 / 回顧 | （新做）| `recordDisaster` / `makeRunStory` / `addText` |
| 設定常數 | `CFG` | `js/constants.js` |

---

## 10. 完成定義（DoD）
- [ ] 走路/被打進 void → 凸眼 + 旋轉縮小掉下 + 口哨音 + 出局。
- [ ] 重擊把人轟成大弧擊飛；撞牆拍扁、過邊緣接墜落。
- [ ] 玩家致死瞬間鏡頭微推 + 慢動作，凸眼臉在畫面中央。
- [ ] 死亡結算有 `lastHitBy` 歸因（「你把 X 轟下去了」/「X 自己掉下去」）。
- [ ] **3–4 人(含非朋友)熱座，至少有人笑出聲 / 主動再玩。** ← 真正的通關條件。
