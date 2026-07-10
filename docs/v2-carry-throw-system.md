# v2 扛/丟系統維護分析(桶 + 人)

> **目的**:「拿起一個東西 → 舉著 → 排程甩出去」這套機制現在有**兩個消費者**——**廢料桶**(`barrel`)和**扛人**(`carrying`)——
> 共用同一套架構(動畫頻道 + 排程 launch + render 把物件貼到手上),但**細節有差**,散落 7 個檔。
> 這份文件是**避免每次都重查**的單一真相:狀態機、三個時鐘與同步鐵則、render 貼手模式、踩過的坑(含「站旁邊沒打橫」病因)、headless 測試陷阱、加新可扛物的食譜。
> 程式碼細節在各檔;這裡只講「為什麼這樣、改哪裡會連鎖、坑在哪」。維護手冊速查在 `js/CLAUDE.md`。

---

## 0. 一句話架構

拿起 = 設「拿著什麼」+「播哪支動畫(頻道)」;舉著 = 動畫**定格**在 hold 姿勢、render 每幀把物件**貼到手上**;
丟 = **排程**一個 launch 時刻(release 幀)、到時才給速度甩出。**sim 是 2D**(x/y/速度),**3D 高度/旋轉/貼手全在 render**。

---

## 1. 檔案地圖(誰負責扛/丟的哪一塊)

| 檔 | 桶(barrel) | 人(carrying) |
|---|---|---|
| `v2-state.js` | `BARREL_THROW_DELAY=22/60`、桶常數、`resetFighter` 的 `carryObj`/`_barrelThrowAt` | `PERSON_HOLD_T=16/60`、`PERSON_THROW_DELAY=(22-16)/60`、`carrying`/`_carryThrowAt`/`carryClip`/`carryFx`/`carryHold` |
| `v2-combat.js` | — | `startCarry`(播 clip+定格)、`throwCarried`(解定格+排程)、`launchCarried`(甩飛物理)、`dropCarry`/`breakFree`/`containByCarry`(取消) |
| `v2-items.js` | `pickUpBarrel`/`throwBarrel`(排程)/`launchBarrel`(甩飛)/`dropBarrel`、`updateBarrels` | — |
| `v2.js` step | 幀尾 resolve `_barrelThrowAt`→`launchBarrel`;`b.held` 的桶**略過 ground prop** | 幀尾 resolve `_carryThrowAt`→`launchCarried`;搬人 loop(跟隨/掙脫/拖艙) |
| `brawler-clips.js` | `barrel_throw` clip | `person_throw` clip;POSE_KEYS 含 `carry_tilt/yaw/o{x,y,z}`(非骨軸) |
| `actor-brawler.js` | `ANIM.barrelHold` 程序姿勢 + `updateHeldBarrel`(桶貼**雙腕中點**,child of g) | **carryClip 頻道**(跨 free)+ hold 定格(`cpt` 夾在 `carryHold`) |
| `render-actors.js` | — | `positionCarried`(**syncActors 後處理**:被扛 actor 貼扛者**左手**+繞頭 `carry_tilt/yaw` 旋轉) |

---

## 2. 狀態機(每個 fighter 的欄位)

| 欄位 | 意義 | 桶 | 人 |
|---|---|---|---|
| `carryObj` / `carrying` | 拿著什麼(桶物件 / 對手 fighter) | `carryObj` | `carrying`(對方 `carriedBy=我`) |
| `carryClip` / `itemClip` | 播哪支動畫 | `itemClip='barrel_throw'` | `carryClip='person_throw'` |
| `carryFx` / `itemFx` | 動畫時鐘起點(`cpt=game.time-carryFx`) | `itemFx` | `carryFx` |
| `carryHold` | **定格秒**(`cpt` 夾在此;0=不定格) | 無(桶用程序姿勢不需定格) | `PERSON_HOLD_T`(扛著走時定格在 hold 幀) |
| `_barrelThrowAt` / `_carryThrowAt` | **排程 launch 時刻**(0=沒在丟) | `_barrelThrowAt` | `_carryThrowAt` |

**桶與人為何用不同動畫頻道(關鍵差異):**
- **桶走 `itemClip` 頻道**:扛桶時 `carrying`(扛人)=null → `free=true` → itemClip 頻道生效。扛著走的姿勢是**程序** `ANIM.barrelHold`(不是 clip)。
- **人走 `carryClip` 頻道**:扛人時 `carrying` 有值 → `free=false`,itemClip/punch 頻道都不播 → 需要一條**跨 free、最優先**的 `carryClip` 頻道。扛著走的姿勢是 **clip 定格**在 hold 幀(不是程序)。

> 加新「可扛物」時先問:扛它的時候 `free` 是不是 false?是 → 得走 carryClip 式的跨-free 頻道;否 → 可沿用 itemClip。

---

## 3. 三個時鐘與**同步鐵則**(最容易錯)

1. **動畫時鐘**:`cpt = game.time - carryFx`,夾 `carryHold`。決定 clip 播到第幾幀。
2. **排程 launch**:`_carryThrowAt` / `_barrelThrowAt`,到時 `launchXxx`。決定「人/桶幾時真的飛出去」。
3. **clip 的 release tag 幀**(`prepClip` 算出 `clip.tags.release` 秒)。

**鐵則:launch 延遲必須對齊 clip 的 release 幀**(否則動畫「甩」的瞬間跟物件飛出的瞬間對不上)。但兩個消費者的「延遲」算法**不同**,因為播法不同:

| | clip 從哪幀開始播 | launch 延遲常數 |
|---|---|---|
| **桶** | 從 0 幀整段播(按下即從頭) | `BARREL_THROW_DELAY = release/60 = 22/60` |
| **人** | **抓起就播 0→hold(16),定格;按丟才從 16 續播** | `PERSON_THROW_DELAY = (release-hold)/60 = (22-16)/60` |

> ⚠ **移動 clip 的 release/hold 幀 = 同步改 v2-state 的常數**。人的是 `(release-hold)/60`,不是 `release/60`——因為按丟時時鐘已經在 hold 幀(`throwCarried` 把 `carryFx` 對到 `game.time - PERSON_HOLD_T`,cpt 從 hold 續走)。

---

## 4. 生命週期(人;桶對照類似)

```
抓起 startCarry(f,o):
  carrying=o, o.carriedBy=f
  carryClip='person_throw', carryFx=game.time, carryHold=PERSON_HOLD_T   ← 播 0→16(reach→抓→舉→翻橫)然後定格
  _carryThrowAt=0
  → 扛著走:clip 定格在 16(舉過頭頂+打橫);positionCarried 每幀把 o 貼到 f 左手、繞頭旋轉;o 播掙扎

按丟 throwCarried(f):
  carryHold=0                         ← 解除定格
  carryFx=game.time - PERSON_HOLD_T   ← 時鐘對到 hold 幀 → cpt 從 16 續走
  _carryThrowAt=game.time + PERSON_THROW_DELAY   ← 排程 release@22

release 幀 launchCarried(f)(v2.js step 判定 _carryThrowAt 到):
  _carryThrowAt=0
  **carryClip 不清**(讓 clip 續播 16→22→38 收招!)
  f.stunned? → dropCarry(掉人不甩)
  否則:carrying=null, o.carriedBy=null, o 給速度+翻滾(THROW_FORCE)

打斷(dropCarry/breakFree/containByCarry):清 carrying + carryClip + carryHold + _carryThrowAt
```

**launch 幀不清 carryClip 是刻意的**:release@22 之後 clip 還有 22→38 的收招,要讓它播完。`carryClip` 只在**抓起(重設)**和**打斷**時清。

---

## 5. render 貼手模式(3D 定位)

**桶**(`updateHeldBarrel`,actor-brawler):桶 mesh 是**扛者 g 的 child**,每幀貼到**雙腕中點**;`b.held` 的桶 v2.js **略過 ground prop**(免雙重繪),甩出後交還飛行 prop。

**人**(`positionCarried`,render-actors,**syncActors 後處理**):被扛者是**另一個完整 actor**,把它的 g **覆蓋**成:
- 位置 = 扛者**左手腕**(clip 的 aL 過頂手)+ `carry_o*` 手局部偏移(PS 單位×`PX=25`);
- 旋轉 = 繞被拎的頭 `R = yaw(carry_yaw) ∘ pitch(carry_tilt)`;原點(腳底)= 頭 − R·(0,`CARRY_HEAD=44`,0);
- 掙扎四肢仍由 `updateBrawler` 套在 rig 上(只覆蓋 g 的世界位置+朝向)。

**為何被扛者定位要放 syncActors 後處理**:被扛者的位置要讀**扛者本幀更新完**的手骨世界座標。若在 `updateActor` 內順手做,遇到「被扛者先於扛者處理」就吃到**上一幀**的手位置 → 頭跟手差一格(快速丟人時頭會脫手)。後處理等所有 actor 更新完再貼 → dist 0 無延遲。

**`carry_tilt/yaw/o*` = 非骨姿勢軸**:在 POSE_KEYS 裡(所以隨 clip 內插、blend),但 `applyBrawlerPose` 忽略(它們不是扛者的骨)。消費者是 render(positionCarried 讀扛者 `g.userData.pose.carry_*`)與 punch-studio 幽靈。

### 5.1 手部切換(抓握才換 rigged 手)

**設計通則(對齊舊 `actor-hands.js`):一般/戰鬥用預設手,只有抓握物品才換成握持手模。** 兩條路各自的「預設手」不同:

| 模式 | 一般/戰鬥 | 抓握物品(扛人/扛桶)| 切換點 |
|---|---|---|---|
| **方塊人**(預設)| 方塊拳套(`arm.fist`)| 舊 chibi 手模 `chibi-hands.glb`(grip/open 兩態)| `updateHands`(actor-brawler)`e.carrying`→grip、丟出開手窗口→open |
| **avatar**(`?avatar=1`)| avatar 原生手(`av.handNative`)| **rigged 手** `chibi-hands-rigged.glb`(逐關鍵格手指軸)| `updateHands` avatar 分支 → `setRiggedHandsVisible(av,on)` |

**avatar rigged 手**(`actor-hands-rigged.js`,與 punch-studio 同一份 GLB+同軸,測試一致):
- `mountRiggedHands(av)`:掛到 `av.by.hand_l/hand_r.bone`(identity;同出 base rig 故手骨已帶 rest)。**掛載後預設藏**(rigged 藏、原生手顯)。
- `setRiggedHandsVisible(av,on)`:切 rigged↔原生手(旗 `av.handShowingRigged`)。**顯條件**=`e.carrying || e.carryObj`,**放/丟後多留 0.3s**(`u.hand.rigT = now+0.3`)讓手指張開的收招跟隨播完,再切回原生手。
- `applyFingerPose(av,pose)`:**只在顯示 rigged 時**每幀跑,從 clip 手指軸 `aL_/aR_ f{base,mid,tip,thumb}`(骨局部 X、負=往掌心捲)驅動指骨。抓握 clip(person_throw/barrel_throw)帶捲指→放手張開,自然演出握持。
- **順序**:`updateHands`(切可見)在 `updateBrawler` 內**先於** `retargetAvatar`(驅指骨)跑 → 先定顯示、再驅動。首幀 `u.avatar` 尚未建 → 略過,不炸。

**為何不常駐掛 rigged 手**:曾一版常駐顯 rigged、常駐藏原生手,不符原設計(戰鬥時手指全張的 rigged 手不如原生手自然),且 clip 手指軸在非抓握狀態=0(平張)無意義。改成只在抓握切換。

---

## 6. 踩過的坑(病因庫)

1. **「抓起沒打橫、站旁邊」(本次病因)**:`startCarry` 曾把 `carryClip` 清成 null,只有**按丟**才播 clip → 平常扛人沒動畫,被扛者 `carry_tilt=0` 直吊,看起來像站旁邊。
   **修**:`startCarry` 就播 clip 並**定格在 hold 幀**(舉過頭頂+打橫)。**通則**:「持有狀態」的視覺要**持續**驅動,不能只在「動作瞬間」驅動——桶同理(扛桶時就 `ANIM.barrelHold`+`updateHeldBarrel`,不是丟才貼)。
2. **launch 幀誤清 carryClip** → 收招(release 後的 22→38)不播,動作戛然而止。只在抓起/打斷清。
3. **兩時鐘同步**:人的 `PERSON_THROW_DELAY=(release-hold)/60` 不是 `release/60`(桶才是)。搞錯 → 甩出時機跟動畫對不上。
4. **render 貼手 1 幀延遲**:被扛者定位沒放後處理 → 頭脫手。放 syncActors 後處理。
5. **頭「貼手」其實是貼 hand+`carry_o*` 偏移**:驗證「頭在哪」要算上手局部偏移(×PX),不是裸手位置。
6. **尺標校準(studio↔game)**:`carry_o*` 是 PS 單位,遊戲 ×`PX=25`;`CARRY_HEAD=44` 是遊戲小人頭高。studio 幽靈身高(~60px)≠ 遊戲小人(~44px),所以 studio 喬好的偏移到遊戲會有幾 px 誤差 → **實機眼睛微調**這兩個數。
7. **左手固定**:被扛者吊在**左手**(clip aL 過頂)。改右手拎 = `positionCarried` 的 `armL`→`armR`。
8. **桶/人互斥**:`carryObj`(桶)與 `carrying`(人)互斥;都會讓移動變 `CARRY_SLOW`。

---

## 7. headless 測試陷阱(測這系統必看)

- **純 Node sim 測**(排程邏輯,最快):鋪 flat map + fresh fighters,直接呼叫 `startCarry`/`throwCarried`/`launchCarried`,斷言欄位轉移(排程/防重複/release 甩飛/打斷取消)。**不需要 clip/render**(carryClip 只是字串)。範本:scratchpad `carry_throw_sched.mjs`。
- **瀏覽器 render 測**(貼手/旋轉):**兩個 rAF 節流陷阱**——
  1. **`game.time` 只走實時的 ~24%** → clip 時鐘爬不到 hold 幀(16f=0.267s 要等好幾秒實時)。**直接把 `carryFx` 設成 `game.time - 1`** 讓 `cpt` 立刻夾到 hold 幀,再等 blend 收斂。
  2. **非本機被扛者會自動掙脫**(`o.escape += CARRY_MASH_AI*dt`,填滿→`breakFree`→掉人重抓→`carryFx` 被重設)→ 每 poll 設 **`o.escape = -1e6`** 硬壓住。
- **辨識扛者/被扛者**:兩個 brawler actor 都在場時,**扛者 = `g.userData.pose.carry_tilt` 非 0** 的那個(它在播 clip);被扛者的 pose carry_tilt=0(它播掙扎)。別用 position.y 猜。
- 斷言「頭貼手」= `head.distanceTo(hand + carry_o*×PX 手局部)` < 幾 px(要算偏移)。

---

## 8. 調參速查(哪個數字在哪)

| 想調 | 改哪裡 |
|---|---|
| 甩飛初速 / 翻滾時長 | `v2-state` `THROW_FORCE` / `THROW_TUMBLE`(人)、`BARREL_THROW`/`BARREL_FRICTION`(桶) |
| 丟人「按下→甩飛」時機 | clip 的 hold/release 幀 + `PERSON_HOLD_T`/`PERSON_THROW_DELAY`(一起改) |
| 被扛者打橫/轉向角度 | clip 的 `carry_tilt`/`carry_yaw`(punch-studio 逐關鍵格) |
| 被扛者貼手位置 | clip 的 `carry_o{x,y,z}`(studio)+ render `CARRY_HEAD`/`PX`(遊戲尺標微調) |
| 扛哪隻手 | `positionCarried` 的 `armL`↔`armR` |
| 扛桶姿勢 | `ANIM.barrelHold`(actor-brawler) |

---

## 9. 加一個新的「可扛/可丟物」食譜

1. **拿的時候 `free` 是否 false?**(扛人=false、扛桶=true)決定用 carryClip(跨 free)還是 itemClip 頻道。
2. **sim**:`v2-state` 加 `_xThrowAt` + 延遲常數(=clip release 幀對齊);`pick/throw/launch/drop` 動詞(排程版,參照 `throwBarrel`/`throwCarried`);打斷路徑清排程。
3. **clip**:`brawler-clips` 加一支;要 hold 就記 hold 幀 + `carryHold`。
4. **render**:物件是自身 mesh → child of g(桶式 `updateHeldBarrel`);是別的 actor → syncActors 後處理覆蓋(人式 `positionCarried`)。要旋轉/偏移 → 加 `carry_*` 類非骨姿勢軸。
5. **v2.js step**:幀尾 resolve `_xThrowAt`→`launchX`;`held` 者略過重複繪製。
6. **驗**:純 Node sim(排程)+ 瀏覽器(貼手,記得節流兩陷阱)+ 雙遊戲開機 0 error。
