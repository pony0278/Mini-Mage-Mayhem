# js/ 遊戲執行層維護手冊(Claude Code 用)

> 目的:**不用歷遍模組就能安全修改**。先查這裡的地圖/契約/食譜,再只讀要動的檔。
> v2(魔法事故報告·收容測試)= 現行開發焦點;單機 = 穩定低改動的零件庫。
> 設計文件索引在 `docs/README.md`;repo 級規則(部署/工具/資產)在根 CLAUDE.md(不重複)。

## 模組地圖(分家族;行數 ±)

**共用核心(兩個遊戲都吃)**
| 檔 | 行 | 職責 |
|---|---|---|
| `constants.js` | 19 | W/H/TILE/COLS/ROWS + `TILE_*` 列舉 |
| `utils.js` | 14 | 純數學(rnd/clamp/dist/norm/circleRectOverlap) |
| `data.js` | 55 | 純資料+分類器(ELEMENT_INFO/fusionKind) |
| `state.js` | 94 | **`game` 單例**(唯一可變共享狀態;live-binding、只原地變異永不重新賦值)+ keys/mouse/CAM/touchInput |
| `fx.js` | 105 | **共用回饋/格子原語**:addText/addShake/addHitstop/addRing/hitSpark、update{Particles,Rings,FloatingTexts}、isSolidTile/circleHitsSolid、overVoid/updateDeathTheater。DAG:state→fx→sim;**v2 只依賴 fx,絕不 import sim.js** |
| `strings.js` `audio.js` `touch.js` `platform.js` | ~370 | i18n 查表/SFX 合成(drain `game.sfx`)/單機觸控/CrazyGames SDK(只 index.html init) |

**單機(v1)**:`sim.js`(3318,整個單機模擬:法術/融合/敵人/boss/波次;**穩定勿大動**,BR 抽出時才拆)、`main.js`(app glue+`window.__game`)、`training-panel.js`/`camera-panel.js`。

**render 家族(門面=`render.js`,外部只 import 它;邊界見 docs/render-module-boundaries.md)**
`render-core`(renderer/scene/camera/快取/project)→ `render-world`(地板烘焙/牆/toybox decor)/`render-actors`(體素小人+brawler 委派)/`render-entities`(props/投射物/zones/粒子/地面標記;**風壓扇形/雷直線** `windSector`/`windStreak`=讀 `game.windFans`/`windAims`(風扇形)+`game.fireAims`(火扇形)+`game.boltAims`/`bolts`(雷直線起手預告+發射亮束))/`render-hud`(單機 2D HUD)/`render-lab`(**v2 專屬場景** 1175 行:工業回收中心、`labAnimated[]` 每幀 update、**地板化學動態 tile 層 `updateFloorFx`**(讀 v2-floor 格,粗色塊 MVP)、**四色地面箭頭 `buildSortingRoutes`(指向中央 POD 的靜態箭頭,不脈動;玩家反饋:原往外脈動導軌違直覺+閃眼)**、**中央回收艙底座=使用者 GLB `assets/scene/recycling-pod.glb`(`loadPodGlb` async fetch+parse:轉平沉入近齊平微凸 ~4px、沉入基準=盤面 p90 非 bbox.max(輪頂不平,用 max 會全埋只露轂尖);載成拆舊分揀陣列貼圖(被輪盤蓋住);**舊環甲板保留**(使用者反饋:加回更立體)+ `buildRuneRing` 符文環帶(程序化符文 canvas,索引種子=確定性;雙層反向緩轉;**底下墊不透明深色艙底「環」y=0.4(RingGeometry 內2.55/外4.75)**——蓋住原始地磚格線(使用者反饋:符文縫隙透地面)、壓在地板化學 tile y=0.6 之下(艙內冰面/油膜照常顯示);**必須環形不能滿盤**:滿盤會蓋掉輪盤面 y=0.125 連中心回收標誌(使用者截圖抓到))填輪盤與甲板之間地面——三層:輪盤嵌件→符文帶→金屬甲板,失敗保留舊底座;場景 GLB 入庫規範=離線解 Draco+simplify+quantize,見 assets/README)**、`FX_LOW`=?fx=low、`window.__lab`(含 `podGlbReady()`))。

**actor 家族(brawler 動作/角色)**
`actor-brawler.js`(關節化體素小人:吃編排器 **64 軸全姿勢**(含踝 `lX_ax`/腳尖 `lX_ty`/腿放大 `lX_scale`/墊腳 contact=1——腿鏈=髖→膝→lm→**踝→腳掌**,站高含 `foot.h`)、CLIPS 播放、punch/item/carry 三動畫頻道、`HAND_CAL`)、`brawler-clips.js`(**PUNCH STUDIO JSON 直貼**;POSE_KEYS=64=studio;`prepClip` 產 `impactT`+`tags`/`tagsLast`(grab/release/**hold**)——**判定時刻的單一真相**,v2-state 由此導出 `STRIKE_DELAY` 等時序常數,studio 移幀重貼即對齊)、`actor-avatar.js`(**預設開=正式產品外觀**,?avatar=0 退回方塊人:16 骨世界差量重定向(**含 foot←踝節點 driver**)、`av.standH`(真實站高,positionCarried 用)、`__avatars`;顯示 rigged 手時每幀 `applyFingerPose(av, pose)` 驅動指骨)、`actor-hands.js`(舊 chibi 手模掛手腕,grip/open 兩態,**方塊人專用**、`__hands`)、`actor-hands-rigged.js`(**avatar 專用** rigged 手:載 `chibi-hands-rigged.glb`、`mountRiggedHands(av)` 掛 `av.by.hand_l/hand_r.bone`、`setRiggedHandsVisible(av,on)` 切 rigged↔原生手、`applyFingerPose(av,pose)` 從手指軸驅動指骨)。**avatar 手切換(對齊舊設計:扛/丟才換手模)**:**一般/戰鬥=avatar 原生手**,**只在抓握物品(`e.carrying||e.carryObj`;放/丟後多留 0.3s 收招)才換 rigged 手**——切換在 actor-brawler `updateHands` avatar 分支(讀 `u.avatar`),`av.handShowingRigged` 為狀態旗。**手指彎曲=clip 姿勢的一部分**:PUNCH STUDIO clip 帶逐關鍵格軸 `aL_/aR_ f{base,mid,tip,thumb}`(骨局部 X 度、負=握),rigged 手顯示時驅動指骨(=punch-studio 同一份手 GLB+同軸,測試一致);方塊人(?avatar=0)/舊 chibi 手無視這些軸。**扛桶/丟桶**:撿桶=**雙臂舉過頭頂托住**(`ANIM.barrelHold` 程序姿勢=**使用者 studio 定稿的平鋪軸覆蓋表**(含腕/手指),重定稿抄該幀非零軸即可;`CLIPS.barrel_pickup` 為可選撿桶動畫槽,有就播、結尾幀對齊 barrelHold);`updateHeldBarrel`(actor-brawler)整個搬運期間把**扛著的投擲物(桶=橘箱/瓶=BOTTLE_TINT 元素色,換種類自動重建)**畫在**雙手腕中點**(丟時改由 clip 驅動);v2.js 幀尾對 `held` 的桶/瓶**略過 ground prop**(免雙重繪),放下/`launchBarrel` 甩出後交還地面/飛行 prop。`throwBarrel` 排程播 `barrel_throw` clip、release 幀甩出(桶瓶共用)。舊「背瓶/施法舉瓶」視覺(updateBackBottles/updateHeldBottle)隨投擲瓶退出道具系統一併移除。**扛人/丟人**:`throwCarried` 排程播 `person_throw` clip(**carryClip 頻道**,扛人期間覆蓋程序姿勢、跨 `free`),release 幀(`PERSON_THROW_DELAY=22/60`)`launchCarried` 甩飛;`carry_tilt/yaw/o*` 進遊戲 POSE_KEYS(非扛者骨軸,applyBrawlerPose 忽略)。**被扛者定位** = render-actors `syncActors` **後處理** `positionCarried`(等扛者本幀更新完再貼→無 1 幀延遲):被扛 actor 頭頂貼扛者**左手腕**(clip aL 過頂手)+`carry_o*` 手局部偏移(PS 單位×PX=25),繞頭以 `carry_tilt`(pitch)/`carry_yaw`(yaw)旋轉(同 punch-studio 幽靈數學);掙扎四肢仍由 updateBrawler 套 rig。`CARRY_HEAD=44`。

**v2 家族(DAG:v2-state → v2-terrain/v2-floor/v2-report → v2-combat → v2-items → v2-hud/v2-touch → v2.js)**
| 檔 | 行 | 職責 / 關鍵符號 |
|---|---|---|
| `v2-state.js` | 191 | **全部 tuning 常數+資料表住這**(改手感只開這檔):戰鬥常數、`ITEM_SPEC`、`FLOOR_LIFE`、桶/站常數、`STAGE_*`;共享單例 `fighters/barrels/bottles(場上投擲瓶:對角點位 2冰2油、BOTTLE_LOB/BREAK_V/RESPAWN)/stations/pads/labSwitch/inc/containLog/roundWins/camRig`;**`v2s`=唯一可重賦值純量容器**;`resetFighter`(fighter 全欄位)。**投擲彈道(B 案)**:`PERSON_LOB`/`BARREL_LOB`/`PUNCH_LAUNCH_LOB`(range/apex/T/h0 三參數語言;終結技=挑空)+`lobZ` 閉式高度+`LAND_SKID`/`BARREL_LAND_FUSE`(落地閃 1s 才爆);出手速度 range/T 與翻滾時長 T+0.1 **各 launch 點現算**(無衍生常數)→ LOB 物件=live 真相,控制台 `__v2.*_LOB.apex=…` / `?tune=1` 彈道滑桿即時生效;**被拋飛者 `f._lob` 記這次的 profile**(null 退 PERSON_LOB),整條管線(牆彈/打橫/入艙)自動繼承;z 感知稽核表在 docs/v2-carry-throw-system.md §5.2。**改任何時序常數前先讀 docs/v2-combat-rhythm.md(拍子總表+四鐵則+咬合關係)**。**import brawler-clips(純資料,DAG 安全)**:`STRIKE_DELAY`/`BARREL_THROW_DELAY`/`PERSON_HOLD_T`/`PERSON_THROW_DELAY` 由 clip 的 impact key/`release`/`hold` tag **自動導出**(studio 移幀→重貼 JSON 即對齊,不手動同步;詳 docs/animation-workflow.md §4) |
| `v2-terrain.js` | 103 | TERRAIN 旗標(flat/isles/grid)、建地、onSolid、橋導軌 |
| `v2-floor.js` | 115 | **地板化學狀態機**:`FL` 狀態集、`FLOOR_RX` 反應表(含 R4b 火融冰→水,對稱 R4)、**`applyElement`/`stampElement`=唯一注入 choke point**、`stepFloor`(火沿油滾動/衰退/電水雙計時器)、`floorEvents` 佇列(毒爆→combat drain,免循環)。只 import constants/utils/state/v2-state |
| `v2-combat.js` | 379 | 移動(**冰=鎖滑**:帶動量踩上鎖直線滑到撞牆暈/滑進艙,**滑撞另一角色=`slideCollide` 保齡球雙方摔倒**,靜止站上=`ICE_WALK` 小心走;`onSlipperyIce`)、三連擊(punch→`_strikeAt`→`resolveStrike`)、`freezeFighter`(冰凍=暈的冰凍皮,同 STUN_T/restun 規則;被扛保留、放開/丟/掙脫解凍)、**按住防禦架式**(`f.guarding`:擋普通鉤拳=無傷+扣耐力+後仰;終結技/元素穿防;耐力耗盡=`guardBreak`;定身;`canGuard`/`updateGuard`)、精準格擋/推開(同一鍵 edge:黃金窗=反暈)、抓-搬-掙脫-投擲、收容裁定(三階段)、**地板讀取 `floorHazards`(含著火 DoT `burnT`→削穩定歸零暈)+`drainFloorEvents`**、揍桶/揍總開關、AI |
| `v2-items.js` | ~300 | **手動撿道具(C 案,裝備類 wind/fire/water/lightning/teleport)**:補給座不再自動撿→`pickupItem`(mouseRight 分派,空手才撿補給座/地上掉落物)、被暈=`dropLooseItem`(逃脫類 whileDisabled 不掉)噴到地上=`groundItems`(帶剩餘次數、可搶、TTL `updateGroundItems` 消失)、**風壓手套**(`castWind`:**遠距扇形放射狀衝擊波** `windBlast`(力=距離衰減×角度衰減、方向從手心往外放射)一發吹對手/桶(吹飛+升壓)/瓶(**分強弱同風對人**:地上強命中 force>WIND_TUMBLE_MIN=擊飛進拋物弧→下風落地碎/空中砸中人冰凍、弱命中=地面吹滑;飛行中=反彈改歸風方=風剋冰投凍原主);排程施法 rhook 暫代 clip=預告窗;無自反噬)、teleport cast、**投擲瓶=場上物件**(2026-07 朋友反饋:跟爆桶同動詞——`bottles`(v2-state 對角點位 2冰2油)走 carryObj 撿丟管線(`grabbableBarrel`/`pickUpBarrel`/`throwBarrel`/`launchBarrel` **桶瓶共用**,`kind:'bottle'` 分支);`updateBottles`:瓶=脆,丟出落地/硬撞牆/硬撞人(>BOTTLE_BREAK_V 或空中)/被拳打(`_smash` 旗,combat 立旗免反向 import)/被爆炸波及 **全都碎**=`shatterBottle` 種元素地板;冰硬砸中人=freezeFighter 直擊冰凍、油只潑膜;**碰人迴圈每幀跑(對齊爆桶):靜止/慢瓶=走動 BARREL_PUSH 頂開,不碎**——所以「場上物件都能被走動推」一致;碎後 BOTTLE_RESPAWN 5s 回原點位)、**工業重錘**(`castWater`:前方 WATER_SLAM_DIST 落點圓形 AoE=造濕地(接雷 R2 電水)+砸中對手=短擊倒(stunFighter 好抓送進艙)+徑向擊退;起手窗 v2.js marks 畫落點圈教範圍)、**魔導電鞭**(`castLightning`:**直線電擊**(LIGHTNING_RANGE 260、半寬 LIGHTNING_WIDTH;使用者定調只能直線)命中線內對手=電擊擊暈(元素穿防)+沿線 applyElement 給水充電=R2 電水;起手窗 `game.boltAims` 畫直線、發射 `fx.addBolt`→`game.bolts` 亮束,render-entities 用 windStreak)、**噴火帽**(`castFire`:**貼臉短扇形**(FIRE_RANGE 100、風壓式錐判定;起手窗 `game.fireAims` 每幀重建=火色扇形+外緣射程弧教範圍,render-entities 複用 windSector)**噴火不留地形火**——逐格 applyElement 只作用扇內反應性地板(FL.OIL→R1 火海、FL.ICE→R4b 融水;乾淨地板不種火=無殘留)+ 直擊目標=著火 DoT(`burnT`/`burnBy`,floorHazards 每幀 FIRE_BURN_DPS 削穩定→歸零暈+身上火粒子);**引爆 prop**:扇內瓶先碎(油瓶潑膜被同一發點燃=瞬間火海)、桶=升壓——castWater(AoE 內瓶碎+桶升壓)/castLightning(線上瓶碎+桶升壓)同款,三近距道具都能引爆桶瓶)、**排程施放**(`useItem`→`resolveItemCast`;wind/fire=rhook impact)、**廢料桶**(charge 吸地板/`pressurizeBarrel`/撿丟推/撞擊爆/`explodeBarrel`→種地板+波及碎瓶)、**元素站**(`updateStations`:輪替/3s 預警/`eruptStation` 脈衝+殘留;雷=電擊無地板)、`elemColor` |
| `v2-report.js` | 53 | 事故報告生成(吃 `inc` 計數器) |
| `v2-hud.js` | 228 | 2D HUD(穩定條/道具次數/橫幅/報告) |
| `v2-touch.js` | 185 | 手機:浮動搖桿+3 鈕+報告鈕(寫 `touchInput`;`__touch`) |
| `v2.js` | 389 | glue:輸入 poll(**右鍵=攻擊直覺**(mouseRight:持 kind:'blast' 裝備→直接開火=引爆桶瓶手感;傳送 mobility 不佔優先)、**E/觸控=互動優先**(contextAction:撿/抓照舊,與右鍵分工)、J/K/**空白=按住防禦**(pollGuard:edge→doGuard 反暈/推開、held→`f.guarding`)+觸控閂鎖(guard 另有 `touchInput.guardHeld` 按住旗);**WASD 同向連按 2 下=跑** `RUN_TAP` 窗雙擊→`f.running`,速度 ×`RUN_MULT`、姿勢=程序跑姿 `ANIM.run`(屈肘泵臂+前傾)或 **`CLIPS.run_cycle` 循環槽**(有就取代程序;**tag `run`=循環起點**——0→run 起跑段播一次、run→尾無縫繞圈(run 幀=尾幀姿勢),沒 tag=整條循環;相位吃位移 `ANIM.runClip.stridePx`);桌面限定)、**step() 迴圈**、渲染橋接(`game.props`/`setGroundMarkers` 每幀重建);**總開關=左右兩支緊急拉桿 `labSwitches`(玩家反饋:原埋中央回收艙圓環違直覺→移側邊;揍任一支 arm,真相=v2s.stationsArmed;render-entities `pr.sw` 畫拉桿=未啟動琥珀立起+地圈邀請、啟動壓下變暗;**可讀性三層(玩家反饋:看不出拉桿=四站總閘):v2-hud 拉桿浮標命名「元素站洩漏總閘」+走近 coach line、arm 因果演出=**場邊四座處理站被魔法光環觸發**(玩家反饋:電束不自然)——render-lab `addPowerHalo`/`setStationsPowered`(facade 匯出;v2.js step 幀尾偵測 v2s.stationsArmed 變化呼叫):拉閘瞬間站底元素色光環+擴散閃光+站頂光暈球通電甦醒,armed 期間常駐(靜態不脈動);`__lab.stationsPowered()` 供測試**)**、boot、`window.__v2`。**測試旗**:`?grabany=1`(免擊暈隨時舉人+被舉不掙脫)、`?clip=名字`(任意 clip 循環試播+對手 AI 凍結;程式=`__v2.playClip(name)`)、`?slowmo=`、`?avatar=0`(退回方塊人;**avatar 預設開=正式外觀**)、`?fx=low`、`?tune=1` |
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
→ poll 輸入(action/item/guard/context/touch)
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
  自動起 server→逐套件跑→匯總)。核心套件 bottles/wind/oilfire/pickup/ice_slide 蓋投擲瓶/風壓/油火/撿道具/冰滑;
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
