# v2 headless 回歸套件

`js/` 遊戲本體維持**零 build/test/lint**;真正要「看到」行為對不對,靠這裡的 puppeteer + SwiftShader
headless 套件驗收。測試依賴(puppeteer)隔離在本資料夾(比照 `build/`,repo 內唯一另一個 npm 角落),
`tests/node_modules` 已 gitignore。

## 跑

```bash
cd tests
npm i            # 裝 puppeteer + 下載 chromium 到 ~/.cache/puppeteer(僅第一次)
npm test         # = node run-all.mjs:自動起 server → 併發跑套件 → 匯總(CONC=3 平行,環境變數可調;CONC=1 退回序列)
```

單跑一支(debug 時)——**server 一定從 repo root 起**:

```bash
python3 -m http.server 8099 >/dev/null 2>&1 & SRV=$!   # **在 repo 根目錄**(不是 tests/!)
sleep 3 && cd tests && node bottles.mjs                # 各套件自帶 pass/fail 斷言 + process.exit(fail?1:0)
kill $SRV                                              # ⚠ 收尾**用 PID**,別用 `pkill -f "http.server"`(陷阱 12:會殺到自己)
```

## 套件對照(對應各系統;新系統落地時 `run-all.mjs` 的 SUITES 加一行)

| 套件 | 蓋的系統 |
|---|---|
| `bottles.mjs`   | 投擲瓶=場上物件:撿丟(桶瓶共用管線)、落地/撞牆/撞人/拳打/爆炸波及碎裂、風吹擊飛落地碎、走動頂開 |
| `wind.mjs`      | 風壓手套:排程施法、距離/角度衰減、近中心翻滾 vs 邊緣吹歪、反彈飛行瓶、吹桶升壓、穿防、無自反噬 |
| `oilfire.mjs`   | 油瓶=油膜不凍人;噴火帽=短扇形**不留地形火**(只點油)、著火 DoT 續燒、油+火 R1 火海、起手預告扇形 |
| `pickup.mjs`    | 手動撿道具(C 案):不自動撿、被暈掉地上帶剩餘次數、地上可搶、傳送(逃脫類)不掉、TTL 消失 |
| `ice_slide.mjs` | 冰面鎖滑:帶動量直線滑、撞牆停+暈、滑進艙=收容、靜止站上=小心走 |
| `mobilefx.mjs`  | 手機自動降級:觸控+行動 UA → FX_LOW 自動開(點光剝除/無 transmission)+ dpr 夾 1.5;桌機完整;`?fx=full` 覆蓋 |
| `onboard.mjs`   | 上手開場框架(只驗易讀層):首局教學旗標(localStorage)、AI 對手開場即開(fight 純戰鬥)、開場字幕/鏡頭帶場計時、就位期 AI 靜止、首局打完記 localStorage |
| `perform.mjs`   | 收容封存演出(規格 G 改版):中段(記錄<3)入艙=**拒收吐回不封存**、賽末點入艙=完整演出(n=3/final/罩/釘艙心/受保護)、演出中不二次收容、壓縮→matchOver+報告。記錄累積規則歸 finisher.mjs,這裡 pin `__v2.roundWins` 造局 |
| `fatigue.mjs`   | flow-2 疲態+立案 beat+瀕界(2c):瀕界心跳只給本機玩家(對手瀕界不響)、首次一次性提示橫幅、演出中靜音、restart 重置旗;疲態檔位=被記錄數(0/1/2 封頂)、記錄方自己不疲態、冒汗 1 檔起+滿檔更密+帶高度軸、暈眩中不冒汗、印章卡(#N/事由/記錄方/受害者座標)+快門音+短頓點、beat 自動過期、restart 歸零。⚠ **汗滴壽命 0.5s < 生成間隔 0.62s → 單點取樣常數到 0**(第一版假 FAIL);要開時間窗用 Set 收集粒子物件。`recordCard` 在 turbo 下只活 ~0.13s 實時=造完立刻讀。⚠ **`game.sfx` 外部輪詢永遠是空的**(v2.js 同一個 JS turn 內 step×turbo 完就 `sfx.length=0`)→ 數音效要 patch `sfx.push`(陣列本體不換,patch 活得過 drain) |
| `finisher.mjs`  | 規格 G flow-1 全機:中段擊暈=+1 記錄不重置場地、中段入艙=記錄+拒收(釘艙心→北管道彈出+短保護)、集滿 3=收容指令(stage 3 比賽繼續)、賽末點擊暈=終演窗口(prompt/倒地延長)、窗口過期=取消打續、`pressFinisher`(hook 直呼,鍵盤在 rAF 節流下漏拍)→自動 run→carry→throw→封存(final n=3)→報告、letterbox letterK、restartMatch 清乾淨。⚠ 兩人擺位離艙 >POD.r(貼艙擊暈=stun+入艙雙記錄);擊暈之間等醒+清 restunT(fresh 轉換才記錄) |
| `jump.mjs`      | 跳躍+下壓拳 brawl-2:跑=預設(雙擊退役)、空白跳/Shift防、空中免地板化學+鎖滑中起跳解鎖、下壓命中削45穿防/落空硬直、空中挨拳拍落、跳越艙口不觸發失控收容。⚠ ④「空中免地板化學」**直接餵 dt 呼叫 `__v2.floorHazards(f,dt)`**(規則的唯一實作點就是它開頭的 `if (airborne(f)) return`),不追跳躍弧線的時間窗——弧線自己會結束、turbo=8 一批可跨 0.5s,追時間窗註定假 FAIL(門檻放寬到 90 之後 CONC=3 還是量到 88)。滯空/落地各跑一次 = 自帶對照組(100 vs 70) |
| `dash.mjs`      | 衝刺攻擊 feel-1:持續跑 ≥ DASH_RUN_T 出拳=衝刺(kind4 不入連段)、短移動=普通拳、命中削30+推、可擋+擋下開反擊窗、起手前衝、對已暈者=推不飛(combo-4)、揮空冷卻;clip 槽位 dash_punch/hit_flinch/walk_cycle 缺槽安全 |
| `hitfx.mjs`     | 漫畫打擊爆花 hitfx-1:命中推 game.bursts(鉤=小橘/挑飛=size46+集中線+白閃/打暈=琥珀/反擊=金/下壓=紅)、壽命到移除、揮空無爆花 |
| `combo.mjs`     | 連段系統 brawl-3+combo-4(2026-08-03 拍板「只有 combo3 可以有擊飛效果」):三連擊黏臉=一次暈不飛走、連段中純踉蹌不位移、**終結技(kind2)=唯一挑飛**、鉤拳/衝刺打已暈=不飛、**空中(含被挑飛中)補任何拳=AIR_HIT_LOB 拍落倒地**(舊病:被挑飛者暈著,wasStunned 分支先吃到=一拳又打上天)、風壓打空中=乾淨接送(WIND_CARRY_LOB 不墊穩定)、地面=吹翻滾墊穩定、全鏈終結挑飛→風壓→進艙記 wind |
| `skinrig.mjs`   | 蒙皮 GLB 角色 ugc-1(玩家自製角色路線 B):骨名別名表(遊戲原生 + VRoid/VRM `J_Bip_*` 各收滿 16 骨)、clone 後**重綁骨架**(skeleton 不共用+bones 落在自己 wrap 底下+蒙皮真的形變)、渲染定位/踩地/站高、per-part 縮放對蒙皮=**縮骨頭**(hand 為子骨不重複縮=不 s²)、**蒙皮版骨局部 bbox ugc-2b**(`by[k].meshes` 對蒙皮恆空 → 火帽/X光顱球/頭像取景全踩雷;`localBox`=exact 給火帽、`localBoxDeep`=含髮給頭像;⑩ 鎖住「火帽掛在 avatar 頭骨」)、**A-pose rest 校正**(45°→殘差 0°,校正後骨頭方向 = T-pose 版;內建角色預設不校正)、**chibi 比例正規化 ugc-1c**(匯入角色壓成 chibi 骨架比例:頭身比 21.2→3.4、真實蒙皮腳底貼地、站高與內建一致、`?chibi=0` 可關、內建不套、root 取到真髖骨)、**ugc-2d 頭要坐在脖子上 ⑫**(舊 ③ 只拿「頭骨關節以上」的高度算放大倍率、繞關節原點縮放 → 真人骨架的 head 骨在顱底、下巴在它下面,放大 2.7× 連下巴一起下拉 = 頭陷進胸口;⑫ 鎖住「下巴高於脖子關節」+「頭還是大頭」+軀幹長度壓到 30.4% + 頭身比貼齊內建。**頭身比自此量真頭高(下巴→頭頂)、基準 2.95**,舊定義的 3.08/3.15/3.18 作廢)、**ugc-2e rest yaw 正規化 ⑬**(慣例=rest 面向 +Z,VRM0/VRoid 出廠 −Z=整隻反 180°+左右鏡像而 normalizeRest 看不見 yaw;量腳尖朝向貼齊 90° 檔位轉回、**重收骨頭**左右重判;fixture 的腳因此有前伸腳尖盒、`-yaw180` 變體=整副骨架反著擺。⚠ 驗面向要跟世界空間的 `f.facing` 比,在 wrap-local 比會被 g 的反向抵銷=看起來永遠朝前)、**ugc-3 常戴拳套 ⑪**(蒙皮=rigged 手當拳套裝備永遠顯示罩住自己的手;朝向 qComp=bQT⁻¹·wrapQT·GLOVE_REST(錯基準踩過 qT 與 GLB 陳列朝向)、尺寸照身高佔比 0.28×standH 不跟細手走;斷言=常戴+朝向 offset 左右對稱+尺寸佔比;剛體照舊抓握才顯)、**ugc-4 肢段粗細 ⑭**(白針腿:粗細烤進蒙皮頂點,bind 骨局部橫向外推+weight 加權;⚠ 防重烤旗標掛 position attribute——多 primitive/多 fighter 共用 attribute,掛 geometry=係數連乘頂點飛出去;⑭ 鎖「f0 有真係數、f1 重量到已加粗幾何=係數≈1」的單烤簽名)、剛體 `base-avatar.glb` 那條路不受影響。⚠ 量蒙皮角色的身高/腳底**不能用 `Box3.setFromObject`**——它回傳 bind pose 的盒子,比例改完誤差 18%;要逐頂點 `boneTransform` 才是真的。⚠ 跨分頁比姿勢要**比夾角不比逐分量**——idle 呼吸相位差本來就有 ~4° 抖動。**GLB fixture 由 `fixtures/mkskin.mjs` 當場產**(不放二進位進 repo;那支檔就是骨名版本的規格書),用 puppeteer request 攔截餵給 `assets/rigs/base-avatar.glb` |
| `psimport.mjs`  | punch-studio **匯入實驗室** ugc-1/1b:蒙皮 GLB 載得進(舊版 VRM 命名被 `AVATAR_REQUIRED` 硬擋)、別名表 native+VRM 各 16 骨、A-pose rest 校正 45°→0° 且骨頭方向對齊 T-pose 版、**內建 base-avatar 不套校正**(與遊戲同規則=WYSIWYG 命脈)、匯入檢查報告(骨頭對照/面數/提醒)、缺骨頭=明確失敗、**chibi 比例正規化與遊戲一致**(21.2→3.4 頭身、腳骨推算踩地、內建不套)。⚠ 量蒙皮腳底要在**雙腳著地的幀**(idle 0f)——anti 那格單腳抬起,拿「最低頂點=地面」會量出假浮空。⚠ 造「壞模型」要**等長替換**骨名(GLB 檔頭記著 JSON chunk 長度,改長度變成「壞檔」就測錯東西了) |
| `psslim.mjs`    | 匯出遊戲角色檔(瘦身)ugc-2:morph target/動畫/VRM extension 全拔、貼圖 ≤512 **一律 PNG**、孤兒縮圖(VRM thumbnail)空殼成 1×1、GLB 空殼化不重排索引(惰性載入下孤兒條目沒人讀)、瘦身檔載回 r128 + 進遊戲 r149 且蒙皮會動、Draco/KTX2/meshopt 明確拒絕。⚠ **JPEG 禁用**:Chrome 的 JPEG ImageBitmap 是 YUV 底,SwiftShader WebGL 上傳會**全黑**——2D canvas 取樣看不出來(軟體轉 RGB 顏色全對),要 readRenderTargetPixels 量化才現形(⑥b 就是這支迴歸鉤)。fixture= mkskin `-fat` 變體(雜訊貼圖=PNG 最壞情況,尺寸門檻照此校) |
| `gauntlet.mjs`(補註) | gaunt-2/3 剪影+解剖契約:程序化手套 proto 要照 GLB 的**軸系**(−z袖口/+z指尖/+y手背渦輪/**−y掌心噴口**)+長寬比(z=1.5~2×高、寬 0.9~1.3×高)+張開的手指+掌心噴口發光+手背渦輪發光。兩輪都是使用者抓到:只對長寬比不對軸系=戴上像管子;有軸系但做成沒噴口的方拳=**發射瞬間玩家看到的掌心那面是一塊空白**(施法 clip 側掌外推、鏡頭在角色後方,掌心正對玩家)。⚠ 判「有沒有發光」不能用 `emissiveIntensity`(MeshStandardMaterial 預設 1.0,黑 emissive 也通過=斷言失效),要看 `emissive.getHex() !== 0`。**gaunt-4 ②c 兩條掛載路等價**:`WIND_CAL`(box 腕)是 avatar 當預設時期的佔位值,ugc-6 翻預設後上線=掌心朝側面+大 26%;在 ?avatar=1 下兩個掛點同時存在,驗「box 腕套 WIND_CAL 的世界變換 ≡ avatar 手骨那條」。⚠ 量施法姿勢:turbo 下釘 `itemFx` 會量到待機(game.time 跳過 clip 尾),用 **`?clip=item_wind` 循環試播**;rig 要從 GAUNTLET 往上找祖先(traverse 全場會抓到閒置的對手);`getWorldQuaternion` 不含縮放,只比朝向會漏掉尺寸病 |
| `frostbottle.mjs` | 冰霜瓶三狀態 + **ugc-5 道具風格契約**:程序化道具=**無 map** + roughness .85 + metalness 0 + 低多邊形(冰瓶 32 面,原 GLB 上萬);`?props=glb` A/B 路仍載得起來且守住「去圖別 prune 砍 UV」那個入庫坑。⚠ 改場上物件配色前先跑 `scratchpad/curve.mjs` 量 source→rendered:lab 是 ACES+曝光 1.16,亮色飽和度會被吃光(l .82 只留 14%),亮點只能靠 emissive |
| `brawl.mjs`     | 爽鬥核心(A 款 brawl-1;docs/game-split.md):開局系統全醒(桶/補給座/瓶/拉桿)+charter 純量殘留清除、穩定值歸零=擊暈(無能量閘)、終結技=PUNCH_LAUNCH_LOB 打飛、完美格擋=反暈、搬進艙=+1 記錄+拒收(規格 G 中段;**前面的擊暈也各記一筆**——抓「containLog 長出 carry」別等 roundWins,不然舊斷言被 stun 記錄搶跑)、endMatch=事故報告 |
| `hudcards.mjs`(補註) | 頭頂身分標記:`?mark=arrow`=ui-1 風箏箭頭(標記在頭頂/跟 facing 轉/腳下乾淨);**預設 ui-3 倒三角**(kind=tri、**對手完全不標**、腳下仍乾淨、無道具不畫瞄準箭頭、持道具才補)。⚠ 驗「箭頭轉向」一定要明寫 `?mark=arrow`——ui-3 之後預設是不轉向的倒三角,不寫旗標會變成空跑。⚠ `__hudmk` 是 HUD canvas 座標(960×540),要拿去切 `page.screenshot` 的 clip(CSS 座標)得先用 `getBoundingClientRect` 換算 |
| (camp-2 註記) | **事故報告退役**後,`brawl`/`perform`/`ring`/`finisher`/`campaign` 五支的報告斷言改成「`matchOver` 成立但 `state().report` 不存在」。⚠ **debug hook 回報「意圖」不等於「實況」**:`__menu().shown` 是內部旗標,`?menu=0` 那條路其實從沒真的設過 `display`(選單整片卡在畫面上),測試照 `shown` 斷言照樣全綠——所以 `__menu()` 多回一個 `display`(真的讀 `getComputedStyle`),跳過選單的三條斷言全改驗 DOM。**寫 hook 時想一下:這個欄位是「我以為」還是「畫面上真的」** |
| `skin.mjs`      | camp-5 換皮 + HUD 層級重整(規格 H §7/§8):標題列=關卡+擋路的人、第二行只在練習模式、**目標提示只在第 1 關**(之後卡關才回來)、動作提示照舊、開場台詞隨關卡、free 模式維持舊語意、舊框架用語絕跡。⚠ 文案類斷言靠 **`window.__hudtext()`**——它在 `fillText` 的**當下**寫入(回報實況不是意圖,camp-2 的教訓);沒有它就只能 OCR。⚠ `open()` **不能**等 `__hudtext().title`:`?menu=1` 開機停在選單態、HUD 整層不畫 → title 永遠 null,要各區塊進遊戲後自己等 |
| `magickey.mjs`  | camp-3 魔法鑰匙(規格 H §5):過關生成掉落動畫、四節拍走完自清、飛行中該格先留空落定才點亮、三把湊齊脈動、加班模式不畫、換關清殘留。⚠ **重點是可讀性的像素驗收**:第一版每格各自半透明,空格疊在場景亮色機具上**等於消失**——進度是絕對不能看不到的訊息,所以斷言「整排底板的不透明像素占比」而不是只驗 state 有值。⚠ 兩個測試自身的坑:設完狀態**不能立刻取樣**(rAF 節流下 HUD 可能還沒畫過任何一幀 → 要輪詢等它畫出來);量底板別把門檻設 `alpha>200`,底板是 `rgba(...,.78)`=199 剛好卡在外面 |
| `campaign.mjs`  | camp-1 闖關殼(規格 H §3):選單→三關→下班的完整狀態機、危險等級**綁關卡**(記錄不再推 stage)、**真的從擊暈打到封存**驗「掉鑰匙而不是跳事故報告」、敗北=重打本關+鑰匙保留+deaths、三把湊齊→大門解鎖→通關寫 localStorage、中離續玩(「繼續」鈕)、闖關中逃跑退役。⚠ **③ 一定要跑真流程**:封存接手點是 `v2-combat` 的 `finalSeal→sealOrCamp`(注入回呼),只單元呼叫 `campSeal` 會漏掉「注入沒接上」這種病。⚠ **⑦ free 模式那段是既有 40 支的保命符**:沒有選單時一律進 `free`=舊行為(封存→事故報告),闖關只在玩家真的按下開始後才接管 |
| `menu.mjs`      | camp-0 主選單(規格 H §14):選單態(旗標/DOM/加班模式鎖)、小人在流水線工作站循環播 clip、對手退場、**HUD 整層收掉**、開始遊戲=交還既有開場(雙方歸位/introT/工作站移除)、以及 **⑥ 自動化預設跳過選單**。⚠ **⑥ 是其餘 40 支的命脈**:所有回歸都假設「開機即開打」,選單擋前面會一次全紅 → `MENU_ON` 用四道獨立訊號任一成立就跳過(`?menu=0` / `?turbo` / `?clip` / `navigator.webdriver`,外加 smokeroom 路徑)。**沒帶 `?turbo` 的 6 支**(barrel/burn/firespray/frostbottle/gauntlet/hat)已另外明寫 `?menu=0` 當第二層保險,不倚賴 webdriver 單一訊號。要**看得到**選單必須明寫 `?menu=1` |
| `outline.mjs`   | 輪廓線身分標記 ui-2(`?mark=outline` 反殼描邊):旗標三態(outline/none/預設 arrow 且不建殼)、只描本機的方塊人身體(裝備/特效/蒙皮跳過;殼歸戶用**世界座標找最近 fighter**——`actorMeshes` 是 render-actors 私有 Map,外面拿不到 rig)、殼材質不變式、放大率夾在 maxGrow、`?fx=low` 整組關,以及**像素回歸**(見下)。⚠ 這支存在的理由=ui-2d:`depthWrite:false`+`renderOrder:-1` 讓殼先畫又不留深度 → **之後畫的地板整條蓋掉**,而 `__outline()` 旗標全綠、結構斷言全過,只有像素看得出來(注入 bug 實測 on 89 = off 89,一個像素都沒多)。主畫布 `preserveDrawingBuffer:false` 讀不到 → 自開 `WebGLRenderTarget` 用 `__gl.scene()/.camera()` 重畫再 `readRenderTargetPixels`(同 render-portrait 回讀路子);判準用**開殼/關殼對照組**而非絕對門檻,取樣只框角色(地板符文/艙體一堆藍紫,掃全畫面底噪 458=沒鑑別力),且 `readRenderTargetPixels` 是**由下往上**的 row order。⚠ **鏡頭要每幀重釘+輪詢收斂**:`updateCamRig` 在 intro 結束那一幀做一次性 `Object.assign(CAM, CAM_FIGHT)`,會蓋掉測試寫的 dist/angle——單跑時序剛好過、CONC=3 下就踩在蓋回去之前=量到遠鏡頭、角色小到線次像素(實測 on 3 = off 3 的假 FAIL) |

## 提速(2026-07-20:全套 10min+ → ~3.5min)

- **`?turbo=8`**(v2.js 測試旗):每個 rAF 幀跑 8 次 `step(dt)`——每步 dt 不變=物理/計時/輸入語意
  全保真,只是畫面少畫;game.time 推進 ×8,等待類斷言收斂 ~8×。所有套件的 goto URL 已帶。
  背景:headless rAF 節流到 ~5% 實時且反節流 flags 實測無效,唯一解=每幀多走模擬。
- **run-all 併發 3**(`CONC` 環境變數;套件各自開瀏覽器、共用一個靜態 server)。
- **寫新套件的 turbo 紀律**:短時間窗(施法預告/落空硬直/引信)在 turbo 下一幀就流完——
  「先觸發再隔 evaluate 抓拍」會撲空;要嘛撐住窗(`_itemCastAt = time+9` 類)、要嘛觸發+取樣
  寫在**同一個 evaluate**(手動 resolveStrike/resolveItemCast 後同步讀)。

## Headless 陷阱(踩過的;寫新套件先讀,`js/CLAUDE.md` §測試 有完整版)

0. **收容=2.1~3.6s 演出(V0.8 起)**:任何 case 讓「暈眩/高速/拋飛」角色出現在 POD 半徑內都會開演出——敗方被**釘在艙心到演出結束**(位置每幀覆蓋、invuln 99),污染後續 case(wind ⑧ 事故:②的牆暈殘留+瞬移進艙)。**部署角色前清 stunned/frozen、座標避開 (480,320)±46**;真要測收容,等 `!state().perform` 再繼續。
1. **rAF 節流**:headless 下 `requestAnimationFrame` 只走實時的 4~36%。等時間**一律輪詢 `__v2.game.time`**,
   別用 `setTimeout` 當遊戲時鐘;引信/冷卻類邏輯**直接呼叫**(如 `__v2.explodeBarrel(b)`)別等它自然到。
   套件裡的 `advance(sec)` helper 就是 game.time 輪詢。
2. ~~本機玩家 facing 每幀吃滑鼠重算~~ **keys-1(2026-07-21)滑鼠退役**:facing=移動方向(8 向,停下保留最後面向)
   → 直接設 `f.facing` 即可久留(沒按方向鍵就不會被蓋);施放者用 `fighters[1]` 的舊慣例仍可沿用。
   鍵盤驅動測試範式見 `keys.mjs`(C=攻擊/X=互動/Z=道具/方向鍵 8 向)。
3. **POD 在 (480,320) r46**:凍住/高速的角色進艙半徑=捕捉(拒收吐回演出 ~2.5s,受害者被釘艙心+受保護)
   →污染測試。測冰凍/擊飛時把角色擺**南邊空地**(如 y=540)避開。**反過來要測「滑進艙=捕捉」**:冰帶必須 `stampElement` **蓋過艙心**
   (非只到艙邊)——鎖滑貫穿入艙才在艙半徑內仍 >`slideContainCur` 門檻;停在艙前=洩速到門檻下=永不收容,
   `waitFor` 空轉到 game-time 逾時→在單一長 `page.evaluate` 內會爆 puppeteer protocolTimeout(整支掛死)。
4. **hitstop 0.12s** 會凍住 per-fighter step 迴圈 → `advance` 要給足(≥0.3s)跨過。
5. **server 從 repo root 起**:套件用 `import('./js/v2-floor.js')` 由瀏覽器對 server 根解析,從 `tests/` 起會 404。
6. **狀態污染**:上一個 case 留下的升壓桶引信到點會爆、`stampElement` 留的地板會殘留 → 新 case 先 `resetFloor()` /
   關掉別的桶 / 把無關角色挪遠(`x=60,y=60`)。

7. ~~元素系統休眠~~(B 款憲章時期的旗;A 款爽鬥=系統預設全開,`?props=full` 已退役——別再給 URL 加旗)。
8. **AI 對手預設開**:會走位/出拳干擾判定——出拳/搬運類 case 開頭把 `fighters[1].ai=false` 並清掉
   `carryObj/carrying`(扛著東西不能出拳,punch 會靜默 no-op;判定測試直接呼叫 `resolveStrike`)。
8c. **「等一段遊戲時間再看狀態」對會自己結束的暫態(跳躍弧線/翻滾/無敵窗)是死路**:turbo=8 下一個 rAF
   批次可跨 ~0.5s 遊戲時,暫態早結束了才取樣。**改成直接餵 dt 呼叫那條規則的實作函式**
   (如 `__v2.floorHazards(f, dt)`),並在同一條件下跑「該生效 / 不該生效」兩次當對照組——決定性、
   而且比模糊門檻更有鑑別力。要新函式就加到 `js/v2.js` 的 `window.__v2` hook。

8b. **async 載入的資產(GLB/atlas)不能用固定 sleep 等**:`await sleep(900)` 在單跑時剛好夠、CONC=3 下就假 FAIL
   (skinrig ⑩ 火帽踩過:全跑 40/41、單跑 41/41)。一律 `page.waitForFunction(條件, {timeout: 25000})` 輪詢,
   並在 `.catch()` 裡吞掉逾時讓下面的斷言去報失敗(別讓 waitForFunction 直接炸掉整支)。

9. **鍵盤 edge 測試要 down/等待/up**:rAF 節流下 `keyboard.press()` 的 down+up 常落在同一取樣幀,
   `keys.has()` 邊緣觸發(跳/格擋)整個吃不到——先 `keyboard.down()`,waitForFunction 等狀態成立再 `up()`。
10. **hitstop=節流放大鏡**(feel-3 後致命):hitstop 期間整個 sim 凍結,rAF 節流下每 0.1s 頓幀
   ≈ 數秒實時——前面案例累積的 hitstop 會把你的移動/計時等待窗整個吃光(waitForFunction 空轉超時)。
   對策:case 設定時 `game.hitstop = 0`;手動 `resolveStrike` 前把無關角色挪出拳距(命中=又生頓幀);
   斷言含 canGuard 一類複合條件時,把輸入旗標 dump 進回傳值(combo.mjs ⑦b 的 `why` 範式)。
11. **game.time 可能是負的(已修根因,教訓留檔)**:headless 的 rAF 時間戳偶爾倒退,舊主迴圈
   dt 沒下夾 → 負 dt 累積 → `game.time` 變負(獵獲值 −1.36s)。症狀=「同步不可能」:`useItem` 後
   同行寫入的 `_itemCastType` 讀得到、`_itemCastAt > 0` 卻 false(= 負 time + delay 仍 < 0);相對比較
   全正常所以其他案照過=只有「絕對時戳 > 0」類斷言偶發炸。根因已修(v2.js/main.js dt 下夾 0);
   排程施放案仍保留重試×3 當環境保險。**寫新斷言別假設 game.time ≥ 0 以外的絕對值性質。**
12. **`pkill -f "http.server"` 會殺到自己**(2026-08-03 連害兩次執行結果全失):`pkill -f` 是拿**整條命令列**
   比對,而你那條複合指令的 shell 本身命令列裡就含 `http.server` → pkill 把自己的父 shell 一起殺掉,
   後面的 `node xxx.mjs` 沒跑完、輸出檔留 0 bytes、任務標成 failed(看起來像「測試掛了」,其實根本沒跑)。
   **單跑套件一律用 PID 管理 server**:
   ```bash
   python3 -m http.server 8099 >/dev/null 2>&1 & SRV=$!
   sleep 3 && cd tests && node bottles.mjs
   kill $SRV
   ```
   全套跑 `npm test` 不會踩到(run-all 自己 spawn/kill server)。**另一個連帶症狀**:探針留下的殘留
   server 佔著 8099,下一輪 `npm test` 的 goto 會逾時=前幾支套件出現「(無匯總行)」的假 FAIL
   (實測 bottles/wind/oilfire 一起中槍,清乾淨後各 21/14/13 全過)——看到開頭幾支集體 goto timeout,
   先查殘留程序,別急著改測試。

13. **測「畫面上真的看得到嗎」要回讀離屏 RT,而且鏡頭要釘住**(ui-2d 描邊線踩到):顏色/遮擋/繪製順序這種病
   結構斷言全綠也照樣看不到(`__outline()` 四個旗標都對、線一個像素都沒畫出來)。主畫布是
   `preserveDrawingBuffer:false`,`readPixels`/`toDataURL` 讀不到 → 用 `__gl.scene()/.camera()` 自開
   `WebGLRenderTarget` 重畫再 `readRenderTargetPixels`(同 render-portrait 頭像回讀)。三條紀律:
   ①判準用**對照組**(把待測物 `visible=false` 再拍一張)不用絕對門檻;②取樣**只框待測物**
   (場景一堆同色系底噪,掃全畫面沒鑑別力:實測背景就吃掉 458 個「藍」像素);
   ③RT 長寬比要對齊畫面(方形 RT 配 1000×700 視角 = 再壓一次解析度,細線容易掉到次像素)。
   **外加**:改 `CAM` 要開 interval 每幀重釘 + 輪詢「角色在畫面上夠大」才取樣——`updateCamRig`
   在 intro 結束那一幀會 `Object.assign(CAM, CAM_FIGHT)` 蓋掉你寫的值(單跑時序剛好過、CONC=3 假 FAIL)。

## Debug hooks(頁內 `window.*`)

`__v2`(game/fighters/barrels/bottles/stations/castX/punch/…)、`__lab`(labGroup/floorFx)、`__avatars`、`__hands`、`__touch`、`__outline`、`__gl`(renderer/`scene()`/`camera()`/info)。
