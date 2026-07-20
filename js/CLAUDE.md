# js/ 遊戲執行層維護手冊(Claude Code 用)

> 目的:**不用歷遍模組就能安全修改**。先查這裡的地圖/契約/食譜,再只讀要動的檔。
> v2(魔法事故報告·收容測試)= 現行開發焦點=**A 款爽鬥**(分類 B 款凍結在 commit `4c92837`;分家決策 docs/game-split.md);單機 = 穩定低改動的零件庫。
> 設計文件索引在 `docs/README.md`;repo 級規則(部署/工具/資產)在根 CLAUDE.md(不重複)。

## 模組地圖(分家族;行數 ±)

**共用核心(兩個遊戲都吃)**
| 檔 | 行 | 職責 |
|---|---|---|
| `constants.js` | 19 | W/H/TILE/COLS/ROWS + `TILE_*` 列舉 |
| `utils.js` | 14 | 純數學(rnd/clamp/dist/norm/circleRectOverlap) |
| `data.js` | 55 | 純資料+分類器(ELEMENT_INFO/fusionKind) |
| `state.js` | 94 | **`game` 單例**(唯一可變共享狀態;live-binding、只原地變異永不重新賦值)+ keys/mouse/CAM/touchInput |
| `fx.js` | ~135 | **共用回饋/格子原語**:addText/addShake/addHitstop(**帽 0.45**,feel-3 放開舊 0.12=反擊/封存頓點才生效)/addRing/hitSpark、**`addBurst`(hitfx-1 漫畫打擊爆花→`game.bursts`,參數包=v2-state `HIT_BURST` 分級;v2-hud `drawBursts` 消費)**、update{Particles,Rings,FloatingTexts}、isSolidTile/circleHitsSolid、overVoid/updateDeathTheater。DAG:state→fx→sim;**v2 只依賴 fx,絕不 import sim.js** |
| `strings.js` `audio.js` `touch.js` `platform.js` | ~370 | i18n 查表/SFX 合成(drain `game.sfx`)/單機觸控/CrazyGames SDK(只 index.html init) |

**單機(v1)**:`sim.js`(3318,整個單機模擬:法術/融合/敵人/boss/波次;**穩定勿大動**,BR 抽出時才拆)、`main.js`(app glue+`window.__game`)、`training-panel.js`/`camera-panel.js`。

**render 家族(門面=`render.js`,外部只 import 它;邊界見 docs/render-module-boundaries.md)**
`render-core`(renderer/scene/camera/快取/project)→ `render-world`(地板烘焙/牆/toybox decor)/`render-actors`(體素小人+brawler 委派)/`render-entities`(props/投射物/zones/粒子/地面標記;**風壓扇形/雷直線** `windSector`/`windStreak`=讀 `game.windFans`/`windAims`(風扇形)+`game.fireAims`(火扇形)+`game.boltAims`/`bolts`(雷直線起手預告+發射亮束))/`render-hud`(單機 2D HUD)/`render-lab`(**v2 專屬場景** 1175 行:工業回收中心、`labAnimated[]` 每幀 update、**地板化學動態 tile 層 `updateFloorFx`**(讀 v2-floor 格,粗色塊 MVP)、**四色地面指引:已整組拆除(2026-07-19 使用者反饋 GLB 箭頭牌太突兀)**——演進史:往外脈動導軌(違直覺+閃眼)→ 朝內靜態箭頭 buildSortingRoutes → THROW IN! 浮雕牌 loadSignGlb → 全拆(A 款艙=丟對手目標,四色元素語意屬凍結的 B 款分類玩法;實作找 git c63a0cf 前);`assets/scene/throw-in-sign.glb` 留庫未載入。**若要重加指引:走狀態驅動(扛人/對手暈時才亮的低調提示),別再放常駐地標**、**中央回收艙底座=使用者 GLB `assets/scene/recycling-pod.glb`(`loadPodGlb` async fetch+parse:轉平沉入近齊平微凸 ~4px、沉入基準=盤面 p90 非 bbox.max(輪頂不平,用 max 會全埋只露轂尖);載成拆舊分揀陣列貼圖(被輪盤蓋住);**舊環甲板保留**(使用者反饋:加回更立體)+ `buildRuneRing` 符文環帶(程序化符文 canvas,索引種子=確定性;雙層反向緩轉;**底下墊不透明深色艙底「環」y=0.4(RingGeometry 內2.55/外4.75)**——蓋住原始地磚格線(使用者反饋:符文縫隙透地面)、壓在地板化學 tile y=0.6 之下(艙內冰面/油膜照常顯示);**必須環形不能滿盤**:滿盤會蓋掉輪盤面 y=0.125 連中心回收標誌(使用者截圖抓到))填輪盤與甲板之間地面——三層:輪盤嵌件→符文帶→金屬甲板,失敗保留舊底座;場景 GLB 入庫規範=離線解 Draco+simplify+quantize,見 assets/README)**、**收容演出玻璃罩 `setPodPerform`**(v2.js 每幀驅動:加法薄殼+三圈緯線蝕刻+底圈+頂部反光點+掃描環;**不走 transmission**——SwiftShader/深色地板上近隱形,風格化力場玻璃到處都讀得出;LED 飄字在 v2-hud `drawPerformLED`)、`FX_LOW`=**手機自動開**(render-core `IS_MOBILE`:可觸控+粗指針/行動 UA;`?fx=low`/`?fx=full` 手動覆蓋;2026-07 手機卡頓診斷:18 點光+13 transmission 玻璃=主因,FX_LOW 主執行緒 2.1×、p99 3770ms→15.5ms;render-core 同時對手機把 dpr 2→1.5)、`window.__lab`(含 `podGlbReady()`、`domeVisible()`、`fxLow()`))。

**actor 家族(brawler 動作/角色)**
`actor-brawler.js`(關節化體素小人:吃編排器 **64 軸全姿勢**(含踝 `lX_ax`/腳尖 `lX_ty`/腿放大 `lX_scale`/墊腳 contact=1——腿鏈=髖→膝→lm→**踝→腳掌**,站高含 `foot.h`)、CLIPS 播放、punch/item/carry 三動畫頻道+**hit_flinch 受擊槽**(free 時短播,行動中維持 flinch overlay=拳不打斷行動,畫面不撒謊)+**walk_cycle 走路循環槽**(同 run_cycle 機制,tag walk/run=循環起點;跑=預設後出場率低)、`HAND_CAL`)、`brawler-clips.js`(**PUNCH STUDIO JSON 直貼**;POSE_KEYS=64=studio;`prepClip` 產 `impactT`+`tags`/`tagsLast`(grab/release/**hold**)——**判定時刻的單一真相**,v2-state 由此導出 `STRIKE_DELAY` 等時序常數,studio 移幀重貼即對齊)、`actor-avatar.js`(**預設開=正式產品外觀**,?avatar=0 退回方塊人:16 骨世界差量重定向(**含 foot←踝節點 driver**)、`av.standH`(真實站高,positionCarried 用)、`__avatars`;顯示 rigged 手時每幀 `applyFingerPose(av, pose)` 驅動指骨)、`actor-hands.js`(舊 chibi 手模掛手腕,grip/open 兩態,**方塊人專用**、`__hands`)、`actor-hands-rigged.js`(**avatar 專用** rigged 手:載 `chibi-hands-rigged.glb`、`mountRiggedHands(av)` 掛 `av.by.hand_l/hand_r.bone`、`setRiggedHandsVisible(av,on)` 切 rigged↔原生手、`applyFingerPose(av,pose)` 從手指軸驅動指骨)。**avatar 手切換(對齊舊設計:扛/丟才換手模)**:**一般/戰鬥=avatar 原生手**,**只在抓握物品(`e.carrying||e.carryObj`;放/丟後多留 0.3s 收招)才換 rigged 手**——切換在 actor-brawler `updateHands` avatar 分支(讀 `u.avatar`),`av.handShowingRigged` 為狀態旗。**手指彎曲=clip 姿勢的一部分**:PUNCH STUDIO clip 帶逐關鍵格軸 `aL_/aR_ f{base,mid,tip,thumb}`(骨局部 X 度、負=握),rigged 手顯示時驅動指骨(=punch-studio 同一份手 GLB+同軸,測試一致);方塊人(?avatar=0)/舊 chibi 手無視這些軸。**扛桶/丟桶**:撿桶=**雙臂舉過頭頂托住**(`ANIM.barrelHold` 程序姿勢=**使用者 studio 定稿的平鋪軸覆蓋表**(含腕/手指),重定稿抄該幀非零軸即可;`CLIPS.barrel_pickup` 為可選撿桶動畫槽,有就播、結尾幀對齊 barrelHold);`updateHeldBarrel`(actor-brawler)整個搬運期間把**扛著的投擲物(桶=橘箱/瓶=BOTTLE_TINT 元素色,換種類自動重建)**畫在**雙手腕中點**(丟時改由 clip 驅動);v2.js 幀尾對 `held` 的桶/瓶**略過 ground prop**(免雙重繪),放下/`launchBarrel` 甩出後交還地面/飛行 prop。`throwBarrel` 排程播 `barrel_throw` clip、release 幀甩出(桶瓶共用)。舊「背瓶/施法舉瓶」視覺(updateBackBottles/updateHeldBottle)隨投擲瓶退出道具系統一併移除。**扛人/丟人**:`throwCarried` 排程播 `person_throw` clip(**carryClip 頻道**,扛人期間覆蓋程序姿勢、跨 `free`),release 幀(`PERSON_THROW_DELAY=22/60`)`launchCarried` 甩飛;`carry_tilt/yaw/o*` 進遊戲 POSE_KEYS(非扛者骨軸,applyBrawlerPose 忽略)。**被扛者定位** = render-actors `syncActors` **後處理** `positionCarried`(等扛者本幀更新完再貼→無 1 幀延遲):被扛 actor 頭頂貼扛者**左手腕**(clip aL 過頂手)+`carry_o*` 手局部偏移(PS 單位×PX=25),繞頭以 `carry_tilt`(pitch)/`carry_yaw`(yaw)旋轉(同 punch-studio 幽靈數學);掙扎四肢仍由 updateBrawler 套 rig。`CARRY_HEAD=44`。

**v2 家族(DAG:v2-state → v2-terrain/v2-floor/v2-report → v2-combat → v2-items → v2-hud/v2-touch → v2.js)**
| 檔 | 行 | 職責 / 關鍵符號 |
|---|---|---|
| `v2-state.js` | 191 | **全部 tuning 常數+資料表住這**(改手感只開這檔):戰鬥常數、`ITEM_SPEC`、`FLOOR_LIFE`、桶/站常數、`STAGE_*`、`PERFORM_T/PERFORM_DOME_R/WASTE_CLASS`(回收演出)、`INTRO_T/INTRO_GO`(開場總長/「開始!」段長——就位期雙方靜止+鏡頭框兩人拉遠,AI 到「開始!」才開工,按任意鍵跳過;使用者拍板 2026-07)+ `v2s.tutorial/introT`;**垃圾瓶=戰鬥道具**:`GARBAGE_*`(四型元素瓶名/icon)+ `randGarbage/bottleRespawnT`(碎/清運後 4~6s respawn 換型;序列競速/能量閘/吐回/下班結局整套凍結在 B 款);共享單例 `fighters/barrels/bottles(場上投擲瓶:`BOTTLE_SPOTS` 六位、BOTTLE_LOB/BREAK_V;碎/清運後 respawn 走 `randGarbage` 換型)/stations/pads/labSwitch/inc/containLog/roundWins/camRig`;**`v2s`=唯一可重賦值純量容器**;`resetFighter`(fighter 全欄位)。**跳躍/下壓(brawl-2)**:`JUMP_LOB/AIR_CTRL/JUMP_CD/AIR_HIT_LOB` + `DIVE_T`(dive_punch clip impact 自動導出)`/DIVE_R/STAB/FWD/LAG/CD` + `AI_JUMP_*`;**跑=預設**:`RUN_MULT/RUN_STICK`(雙擊 RUN_TAP 退役;手機搖桿推程分檔);**衝刺攻擊(feel-1)**:`DASH_RUN_T/T/LUNGE/STAB/KNOCK/CD`(持續跑≥0.4s 出拳=突進拳;DASH_T 由 dash_punch clip 自動導出);**出拳承諾(feel-2/2b)**:`PUNCH_MOVE`(承諾期移動倍率,0=腳釘住;嫌連段追不上可調 0.2)+`PUNCH_RECOVER`(收招時長=clip 全長−impact,自動導出)。**頓點分級(feel-3)**:`HIT_STOP` 表(擋下 0.05→反擊 0.26→封存 0.4,輕重 2.6×)×`v2s.hitstopMul`(?tune 打擊感滑桿);玩家動詞頓點全走表(v2-combat `stopHit`),環境事故散值不進表。**AI 階級(tier-1)**:`AI_PROFILE` 旋鈕表(intern/senior:出拳率/猶豫/後撤/抓延遲/跳率/舉防/連段放棄率;領班/廠長=加列)+ 逃跑常數 `FLEE_STAB/FLEE_SPEED/CALL_T/FLEE_EXITS` + `v2s.aiTier/aiCalled/aiCallAt/aiCallPos`。**投擲彈道(B 案)**:`PERSON_LOB`/`BARREL_LOB`/`PUNCH_LAUNCH_LOB`(range/apex/T/h0 三參數語言;終結技=挑空)+`lobZ` 閉式高度+`LAND_SKID`/`BARREL_LAND_FUSE`(落地閃 1s 才爆);出手速度 range/T 與翻滾時長 T+0.1 **各 launch 點現算**(無衍生常數)→ LOB 物件=live 真相,控制台 `__v2.*_LOB.apex=…` / `?tune=1` 彈道滑桿即時生效;**被拋飛者 `f._lob` 記這次的 profile**(null 退 PERSON_LOB),整條管線(牆彈/打橫/入艙)自動繼承;z 感知稽核表在 docs/v2-carry-throw-system.md §5.2。**改任何時序常數前先讀 docs/v2-combat-rhythm.md(拍子總表+四鐵則+咬合關係)**。**import brawler-clips(純資料,DAG 安全)**:`STRIKE_DELAY`/`BARREL_THROW_DELAY`/`PERSON_HOLD_T`/`PERSON_THROW_DELAY` 由 clip 的 impact key/`release`/`hold` tag **自動導出**(studio 移幀→重貼 JSON 即對齊,不手動同步;詳 docs/animation-workflow.md §4) |
| `v2-terrain.js` | 103 | TERRAIN 旗標(flat/isles/grid)、建地、onSolid、橋導軌 |
| `v2-floor.js` | 115 | **地板化學狀態機**:`FL` 狀態集、`FLOOR_RX` 反應表(含 R4b 火融冰→水,對稱 R4)、**`applyElement`/`stampElement`=唯一注入 choke point**、`stepFloor`(火沿油滾動/衰退/電水雙計時器)、`floorEvents` 佇列(毒爆→combat drain,免循環)。只 import constants/utils/state/v2-state |
| `v2-combat.js` | 379 | 移動(**冰=鎖滑**:帶動量踩上鎖直線滑到撞牆暈/滑進艙,**滑撞另一角色=`slideCollide` 保齡球雙方摔倒**,靜止站上=`ICE_WALK` 小心走;`onSlipperyIce`)、三連擊(punch→`_strikeAt`→`resolveStrike`)、`freezeFighter`(冰凍=暈的冰凍皮,同 STUN_T/restun 規則;被扛保留、放開/丟/掙脫解凍)、**按住防禦架式**(`f.guarding`:擋普通鉤拳=無傷+扣耐力+後仰;終結技/元素穿防;耐力耗盡=`guardBreak`;定身;`canGuard`/`updateGuard`)、反擊拳(brawl-3.1:**擋下鉤拳→停頓→左鍵**=反暈,`doCounter`;無提示靠手感)/推開(Shift edge)、抓-搬-掙脫-投擲、收容裁定(三階段)→ **回收演出 V0.8**(`startPerform`/`updatePerform`/`finishPerform`:收容判定即計分+敗方 snap 艙心全保護(invuln 99+stunned=掙扎占位),五相位 capture→struggle→scan→classify→resolve,LED 字 sim 排進 `v2s.perform.line`(分類依 `f._lastItem` 個人化=WASTE_CLASS),**收尾才** softReintegrate/finalSeal;風味 #2=火花震開艙邊、#3=壓縮 `_hidden`+方塊北送清運;演出期間 containBy* 頂部+v2.js 自動收容迴圈**雙重 suspend**、敗方在 v2.js 迴圈 `_performing` continue 凍結)、**地板讀取 `floorHazards`(含著火 DoT `burnT`→削穩定歸零暈)+`drainFloorEvents`**、揍桶/揍總開關、AI(**純戰鬥對手** `aiMove`:接近→連擊→對手暈了抓→拖艙;中距離偶爾起跳半程下壓=活教學;分類同事 `demoMove` 凍結在 B 款=4c92837;**tier-1 階級化**:行為旋鈕全走 `AI_PROFILE[v2s.aiTier]`,`applyAiTier` 切檔案+NAMES;**實習生快輸=逃跑搬救兵**(聽牌+穩定值≤FLEE_STAB→跑向最近 FLEE_EXITS,AI 逃跑進跑速×FLEE_SPEED=衝刺才好追;**可被追擊**=暈/抓/收容照常;到出口=away+_hidden+排 `updateAiCall`,CALL_T 後**資深同事**同點進場比分保留,一場一次 v2s.aiCalled;資深=讀對手 `_strikeAt` 起手近距舉防,counter/dash 留給領班/廠長檔))、**跳躍+下壓拳(brawl-2)**:`jump`(自發小 lob,z 走 v2.js lobZ 管線;**鎖滑中起跳=冰滑主動解**)/`dive`(空中攻擊=鎖方向俯衝,`resolveDive` 落地幀 AoE 穿防+落空 `_diveLagT` 硬直)/`jumping`/`airborne`;**空中規則**:免地板化學+免鎖滑、不可防/抓/被抓(canGuard/doGuard/startCarry 都設 airborne 守衛)、空中挨鉤拳=`AIR_HIT_LOB` 小翻滾拍落(終結技照樣大挑飛)。**衝刺攻擊(feel-1)**:`dashPunch`(punch 門檻分派 `f._runT≥DASH_RUN_T`;kind 4=同一條 resolveStrike 管線,削 DASH_STAB+推、可擋開反擊窗、不入連段;起手 moveFighter 鎖方向前衝=揮空滑過頭)。**出拳承諾(feel-2/2b)**:承諾期=`punchLocked(f)`=起手(`_strikeAt>0`)**+收招(`_recoverT` 未到=clip 播完,resolveStrike 蓋章 PUNCH_RECOVER)**——moveFighter **面向硬鎖 `f.facing=f._strikeDir`**(蓋掉本機滑鼠+AI 轉向)+**移動 ×PUNCH_MOVE(0)**(衝刺/下壓自有承諾位移=排除)、jump/canGuard 加 punchLocked 守衛;**取消收招的動詞**:接段 punch(本機取「當下瞄準」設 `_strikeDir` 而非鎖住的 facing=連段可追)、useItem/startCarry/pickUpBarrel 皆清 `_recoverT`(拍子總表 docs/v2-combat-rhythm.md)。**爽鬥勝負(A 款)+ 連段(brawl-3)**:`resolveStrike` 三分層——有穩定值=純踉蹌不位移(連段黏臉)、打暈那拳=原地暈(`COMBO_STAB [25,25,50]`=三連擊一次暈)、**對「已暈」者(`wasStunned`)出拳=`PUNCH_LAUNCH_LOB` 挑飛 launcher**(接風壓接送/抓丟);**反擊拳**=擋下鉤拳開窗(resolveStrike 擋下分支設 `_counterFrom`)→ 停頓後左鍵 `doCounter` 反暈攻擊者(拿掉慢動作/灰屏/提示);`containByCarry/containByEnviron`→`resolveContain`(roundWins+containLog+三階段升級 applyStage)→ 收 `WIN_TARGET`(3)次=finalSeal→`endMatch`(`generateReport` 事故報告=分享引擎) |
| `v2-items.js` | ~300 | **手動撿道具(C 案,裝備類 wind/fire/water/lightning/teleport)**:補給座不再自動撿→`pickupItem`(mouseRight 分派,空手才撿補給座/地上掉落物)、被暈=`dropLooseItem`(逃脫類 whileDisabled 不掉)噴到地上=`groundItems`(帶剩餘次數、可搶、TTL `updateGroundItems` 消失)、**風壓手套**(`castWind`:**空中接送(brawl-3)**:打「已騰空」對手(`o.z>1||inThrowFlight`)=乾淨接送(`WIND_CARRY_LOB` 往瞄準方向直送/不 scatter/不墊穩定)→ 一路吹進艙、無落地反擊(連段收尾入口;進艙 cause 記 `wind`);地面目標維持吹翻滾(墊穩定防站樁)。**遠距扇形放射狀衝擊波** `windBlast`(力=距離衰減×角度衰減、方向從手心往外放射)一發吹對手/桶(吹飛+升壓)/瓶(**分強弱同風對人**:地上強命中 force>WIND_TUMBLE_MIN=擊飛進拋物弧→下風落地碎/空中砸中人冰凍、弱命中=地面吹滑;飛行中=反彈改歸風方=風剋冰投凍原主);排程施法 rhook 暫代 clip=預告窗;無自反噬)、teleport cast、**投擲瓶=場上物件**(2026-07 朋友反饋:跟爆桶同動詞——`bottles`(v2-state 對角點位 2冰2油)走 carryObj 撿丟管線(`grabbableBarrel`/`pickUpBarrel`/`throwBarrel`/`launchBarrel` **桶瓶共用**,`kind:'bottle'` 分支);`updateBottles`:瓶=脆,丟出落地/硬撞牆/硬撞人(>BOTTLE_BREAK_V 或空中)/被拳打(`_smash` 旗,combat 立旗免反向 import)/被爆炸波及 **全都碎**=`shatterBottle` 種元素地板;冰硬砸中人=freezeFighter 直擊冰凍、油只潑膜;**碰人迴圈每幀跑(對齊爆桶):靜止/慢瓶=走動 BARREL_PUSH 頂開,不碎**——所以「場上物件都能被走動推」一致;碎後 BOTTLE_RESPAWN 5s 回原點位)、**工業重錘**(`castWater`:前方 WATER_SLAM_DIST 落點圓形 AoE=造濕地(接雷 R2 電水)+砸中對手=短擊倒(stunFighter 好抓送進艙)+徑向擊退;起手窗 v2.js marks 畫落點圈教範圍)、**魔導電鞭**(`castLightning`:**直線電擊**(LIGHTNING_RANGE 260、半寬 LIGHTNING_WIDTH;使用者定調只能直線)命中線內對手=電擊擊暈(元素穿防)+沿線 applyElement 給水充電=R2 電水;起手窗 `game.boltAims` 畫直線、發射 `fx.addBolt`→`game.bolts` 亮束,render-entities 用 windStreak)、**噴火帽**(`castFire`:**貼臉短扇形**(FIRE_RANGE 100、風壓式錐判定;起手窗 `game.fireAims` 每幀重建=火色扇形+外緣射程弧教範圍,render-entities 複用 windSector)**噴火不留地形火**——逐格 applyElement 只作用扇內反應性地板(FL.OIL→R1 火海、FL.ICE→R4b 融水;乾淨地板不種火=無殘留)+ 直擊目標=著火 DoT(`burnT`/`burnBy`,floorHazards 每幀 FIRE_BURN_DPS 削穩定→歸零暈+身上火粒子);**引爆 prop**:扇內瓶先碎(油瓶潑膜被同一發點燃=瞬間火海)、桶=升壓——castWater(AoE 內瓶碎+桶升壓)/castLightning(線上瓶碎+桶升壓)同款,三近距道具都能引爆桶瓶)、**排程施放**(`useItem`→`resolveItemCast`;wind/fire=rhook impact)、**廢料桶**(charge 吸地板/`pressurizeBarrel`/撿丟推/撞擊爆/`explodeBarrel`→種地板+波及碎瓶)、**元素站**(`updateStations`:輪替/3s 預警/`eruptStation` 脈衝+殘留;雷=電擊無地板)、**瓶清運**(`recycleGarbage`:垃圾瓶 `z<=2 && inPod`=清運消失→`bottleRespawnT` 後 `randGarbage` 換型 respawn;瓶的主用途=砸人戰鬥道具,清運只是清場小獎勵;`updatePads` 補給座常開)、`elemColor` |
| `v2-report.js` | 53 | 事故報告生成(吃 `inc` 計數器) |
| `v2-hud.js` | ~330 | 2D HUD(穩定條/掙脫條/防禦耐力/道具次數/橫幅)+ **`drawBursts`(hitfx-2 漫畫打擊爆花:GetAmped 風白星+彩描邊,最上層蓋角色、3 格幀階跳格;**低清化**=星形+速度線先畫進 1/3 解析度離屏 `_bc` 再平滑放大(邊緣鬆軟=對齊 3D 場景柔和,使用者反饋:太清晰不搭)+**沸騰線**(頂點相位吃 step=每格微變形)+**殘影動態模糊**(重擊首格沿擊退方向 2 節遞減透明複本=smear frame,不走後處理);重擊帶黃色速度線+首格白閃、挑飛加全屏集中線;顏色=打擊類型 拳橘/打暈琥珀/反擊金/下壓紅;FX_LOW 留爆花砍線,經 render facade 讀 `FX_LOW`;元素爆炸維持發光粒子=能量感分工)** + **`drawPips`**(左右三格收容進度,填色=收容方式 METHOD_COL)+ **`drawReport`**(結算事故報告全屏卡:等級/標題/統計/封存序列/委員會評語/挑戰碼;R 再戰/C 複製)+ `drawPerformLED`(收容演出艙口 LED)+ `drawCoachLine` 爽鬥版(掙脫/可回收/瓶砸人/拉桿邀請)+ `drawIntro`(主管訓話=世界觀留+「把對手丟進中央回收口 ×3 就贏」) |
| `v2-touch.js` | ~195 | 手機:浮動搖桿(`touchInput.mag`=推程 0~1,跑步分檔)+4 鈕(揮拳/抓/格擋/跳)+報告鈕(寫 `touchInput`;`__touch`) |
| `v2.js` | 389 | glue:輸入 poll(**右鍵=攻擊直覺**(mouseRight:持 kind:'blast' 裝備→直接開火=引爆桶瓶手感;傳送 mobility 不佔優先)、**E/觸控=互動優先**(contextAction:撿/抓照舊,與右鍵分工)、J/K/**Shift=按住防禦**(pollGuard:edge→doGuard 推開、held→`f.guarding`;brawl-2 空白讓給跳;反擊拳改左鍵不走 doGuard)/**空白=跳**(pollJump edge→jump;空中左鍵=下壓)+觸控閂鎖(guard 另有 `touchInput.guardHeld` 按住旗、jump 閂鎖);**跑=預設**(step 每幀裁定:桌機有 WASD=跑、手機 `touchInput.mag`≥`RUN_STICK`=跑推一半=走;扛重物/暈/踉蹌不跑;雙擊偵測退役)、跑姿=程序 `ANIM.run` 或 **`CLIPS.run_cycle` 循環槽**(tag `run`=循環起點;相位吃位移 `ANIM.runClip.stridePx`)、**step() 迴圈**、渲染橋接(`game.props`/`setGroundMarkers` 每幀重建);**總開關=左右兩支緊急拉桿 `labSwitches`(玩家反饋:原埋中央回收艙圓環違直覺→移側邊;揍任一支 arm,真相=v2s.stationsArmed;render-entities `pr.sw` 畫拉桿=未啟動琥珀立起+地圈邀請、啟動壓下變暗;**可讀性三層(玩家反饋:看不出拉桿=四站總閘):v2-hud 拉桿浮標命名「元素站洩漏總閘」+走近 coach line、arm 因果演出=**場邊四座處理站被魔法光環觸發**(玩家反饋:電束不自然)——render-lab `addPowerHalo`/`setStationsPowered`(facade 匯出;v2.js step 幀尾偵測 v2s.stationsArmed 變化呼叫):拉閘瞬間站底元素色光環+擴散閃光+站頂光暈球通電甦醒,armed 期間常駐(靜態不脈動);`__lab.stationsPowered()` 供測試**)**、**對局編排**(step:失控入艙判定在 perform 期間 suspend;`resetRound`=位置/計時重置+resetFighter(roundWins/containLog 跨回合保留,restartMatch 才清);matchOver=凍結+R `restartMatch`/C 複製報告分享文字)、boot(AI 開場=`fight` 純戰鬥)、`window.__v2`(state 露 `roundWins/containLog/report/perform`;hook 露 `endMatch/generateReport/startCarry/resolveStrike`)。**測試旗**:`?grabany=1`(免擊暈隨時舉人+被舉不掙脫)、`?clip=名字`(任意 clip 循環試播+對手 AI 凍結;程式=`__v2.playClip(name)`)、`?slowmo=`、`?avatar=0`(退回方塊人;**avatar 預設開=正式外觀**)、`?fx=low`、`?tune=1`(A 款=元素系統全開,`?props=full` 旗已隨 B 款退役) |
| `v2-tuning.js` | 103 | ?tune=1 調參面板(投稿 build 會剝掉) |

## 不變式(改壞=架構回歸)

1. **sim.js 不 import render/input/main**(headless);**v2 任何檔不 import sim.js**(共用原語一律走 `fx.js`)。
2. **v2-floor 不 import v2-combat**(事件走 `floorEvents` 佇列);render→v2-floor 唯讀(同 render→sim 方向)。
3. `game`/`fighters`/`v2s` 等單例**原地變異、永不重新賦值**(live-binding import)。
4. 道具/元素站**注入地板一律走 `applyElement`/`stampElement`**,不得直寫 floor 格。
5. tuning 數字進 `v2-state.js`,不散落各檔。

## v2 step() 順序(時序敏感,插新邏輯前看這)

```
視覺計時器衰減 → matchOver freeze → 粒子/環/浮字 → hitstop?(只收格擋輸入)
→ poll 輸入(action/item/guard/context/jump/touch)
→ stepFloor(dt)                     ← 地板化學(移動前)
→ 每 fighter:冷卻計時 → AI 推開 → resolveStrike(_strikeAt 到)→ resolveItemCast(_itemCastAt 到)
   → 穩定值回復/暈眩倒數/死亡劇場 → floorHazards(f)(踩地板效果)→ moveFighter
→ drainFloorEvents()                ← 毒爆 AoE
→ 搬人 loop(跟隨/掙脫/拖進艙=containByCarry)→ 扛桶 loop(跟隨/暈→掉桶)
→ 失控入艙判定(stunned/thrown/速度>門檻 + inPod → containByEnviron;cause: throw/ice/barrel(-3)/wind)
→ updateBarrels → updateBottles(場上瓶物理/碎裂;冰面衰退=stepFloor)→ updateStations → updatePads → updateGroundItems
幀尾(step 外):game.enemies=fighters、game.props 重建(桶+瓶+總開關)、setGroundMarkers(艙/桶危險環/站收縮環/冰/補給座/瓶)
```

`lastHitBy` 慣例:>=0=玩家 pid、-3=桶、-4=毒爆、-5=元素站。

## 測試(headless;範式先抄再改)

- **落地的回歸套件在 `tests/`**(repo 內,非 scratchpad):`cd tests && npm i && npm test`(`run-all.mjs`
  自動起 server→**併發 3 跑**→匯總;套件 URL 帶 **`?turbo=8`**=v2.js 測試旗,每幀 8 次 step(dt) 對抗
  rAF 節流,全套 ~3.5min。短時間窗斷言的 turbo 紀律見 tests/README §提速)。核心套件 bottles/wind/oilfire/pickup/ice_slide/onboard/perform/brawl/jump 蓋投擲瓶/風壓/油火/撿道具/冰滑/上手開場/收容演出/爽鬥核心/跳躍下壓(跑=預設+空白跳 Shift 防+空中規則+穿防+拍落);
  **新系統落地時把驗收套件加進 `tests/` 並在 `run-all.mjs` 的 SUITES 補一行**(別只留在 scratchpad=session 一結束就沒)。
  陷阱總表在 `tests/README.md`。scratchpad 仍是**一次性探針/截圖**的地方。
- **純 Node sim 測**(最快,免瀏覽器):constants/utils/state/fx/v2-state/v2-floor/v2-combat/v2-items 的 import 圖**無 DOM/THREE**,
  直接 `import(pathToFileURL(...))`。先鋪 `game.map`(全 TILE_FLOOR)+ reset 單例 + 手動 fresh fighter 欄位。
- **瀏覽器測**(puppeteer + SwiftShader flags,見根 CLAUDE.md;`python3 -m http.server 8099`):
  **⚠ headless rAF 會節流——`game.time` 只走實時的 4~36%**,`page.bringToFront()` 後仍要**以 game.time 輪詢**,
  等引信/冷卻類邏輯**直接呼叫**(如 `v2.explodeBarrel(b)`)別等它自然到時。
  **凍結 clip 到某幀驗姿勢**(scratchpad `barrel_avatar.mjs` 範式):每輪「`itemFx=game.time-fr/60` 釘時鐘 +
  把 `evalClip` 目標**直接寫進 `g.userData.pose`**(繞過節流下的慢 blend)→ 等 1-2 渲染幀(指骨/avatar 才消費)→
  量測並**比對目標值**才放行」——只釘時鐘不寫 pose 會量到收斂中途的值;寫了 pose 不等渲染幀會量到舊骨。
- hooks:`__v2`(game/fighters/barrels/stations/labSwitch/castX/punch/endMatch…)、`__lab`(labGroup/`floorFx()`)、
  `__hands`、`__avatars`、`__touch`、單機 `__game`。
- 語法檢查:`cp js/x.js /tmp/_chk.mjs && node --check /tmp/_chk.mjs`(ESM 要 .mjs)。

## 常見任務食譜

- **加道具**:`v2-state.ITEM_TYPES`+`ITEM_INFO`+**`ITEM_SPEC` 加一列**(uses/clip/delay/whileDisabled/aim/kind)→ `v2-items.castItem` 分派 + `castX` 實作(碰地板走 `stampElement`)→ HUD/觸控標籤自動吃 `ITEM_INFO`。動畫後補:clip 名+delay(impact÷60)填表即切排程。
- **加地板反應**:`v2-floor.FLOOR_RX` 加一列(`'狀態|元素': {next, event?}`)+ 壽命進 `FLOOR_LIFE`;一次性事件=queue `floorEvents`、combat 的 `drainFloorEvents` 加 case。顏色進 render-lab `FLOOR_FX_COL/ALPHA`。
- **加場地危險物**:資料+常數進 v2-state(比照 barrels/stations)、行為進 v2-items(update 函式掛進 step 幀尾)、視覺=`game.props`(voxel 箱,charge 決定色)或 `setGroundMarkers`(圈)或 render-lab prop。
- **加 render 覆蓋層**:render-lab 建 group + updater 推進 `labAnimated[]`(只在 lab 主題跑;`ta` 時鐘吃 LOW_FLICKER 凍結=光敏無障礙)。
- **調手感**:只開 `v2-state.js`;階段升級改 `applyStage`。
- **大檔結構性搬移**(sim/render-lab):Python splice(anchor 斷言 count==1),別用長 Edit。

## 陷阱(踩過的)

1. headless rAF 節流(見上)——測試「沒反應」先懷疑這個,不是程式壞。
2. 本機玩家 `facing` 每幀從滑鼠重算(桌機)——測試要每 tick 重新斷言 facing。
3. `game.props`/ground markers **每幀重建**(v2.js 幀尾)——對它們的直接修改活不過一幀。
4. `POD.r=46` 是**判定**半徑;render-lab `CENTER_SCALE` 只縮**視覺**,兩者獨立。
5. 電水鐵則:充電**不刷新**水的 `waterTtl`;`charged` 到期退回 water(帶剩餘壽命)。
6. 桶 `charge` 只在 idle+未被扛時吸腳下地板;`thrownBy` 防炸自己人、`armGrace` 防出手瞬爆。
7. 撿桶/抓人互斥(`carryObj` vs `carrying`);在手上爆由 `explodeBarrel` 放開持有者。
8. sfx 用 `game.sfx.push(name)`,v2.js 幀尾 drain——別直接呼叫 audio。
9. 觸控按鈕是**閂鎖**(press 旗標),poll 消費一次一擊;格擋另抽一支在 hitstop 中也收。

## 設計文件對照(要「為什麼」看這些)

`docs/v2-element-floor-chemistry.md`(地板化學+道具對照+站+桶全設計)、`docs/v2-floor-state-architecture.md`(floor 工程藍圖)、
`docs/v2-item-cast-system.md`(道具次數+排程施放)、**`docs/v2-carry-throw-system.md`(扛/丟系統維護分析:桶+人共用架構、三時鐘同步、貼手模式、病因庫、測試陷阱——動 carry/throw 前必看)**、
`docs/v2-module-boundaries.md`(拆檔史)、`docs/animation-workflow.md`(clip↔impact)、`docs/v2-spec-*.md`(北極星/蠢死法/報告)。**改完系統記得回寫對應文件的「狀態」行。**
