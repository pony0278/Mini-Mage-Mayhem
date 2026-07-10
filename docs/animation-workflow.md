# 動作工作流(PUNCH STUDIO → 遊戲)

> 上游還有一站:第三方工具產的**整塊模型**先用 [`tools/mesh-part-extractor.html`](../tools/mesh-part-extractor.html)
> 圈選拆部位 → **「匯出規範 GLB」**(原點=接縫圓心/+Y=遠端/+Z=正面/命名=slot,對規格自動檢查)→
> PUNCH STUDIO 掛載。完整管線:**Extractor(切+規範化)→ PUNCH STUDIO(掛+編動作)→ 遊戲(JSON 接入)**。
> 部位建模約定與規格表見 [part-authoring.md](part-authoring.md)。
> 注意:給 PUNCH STUDIO 的部位一律走「匯出規範 GLB」,**不要**用「分檔匯出」(那會保留世界位置);
> **抽取前先用「模型方向(擺正)」面板把模型轉到面向 +Z、頭朝上**(規範匯出的正面寫死世界 +Z,
> 第三方模型常見 Z-up 或面向 -Z,不擺正則所有部位匯出後朝向全錯);規格檢查全面同比例偏離=尺度
> 問題(縮放係數=規格半徑÷實測半徑)。
> **對稱部位只切一側**:規範匯出勾「同時匯出鏡像側」→ 一刀產左右一對,接縫數學上完全一致
> (15 件只要圈 9 次)。貼圖會左右翻轉,有文字/徽章的部位取消勾選改手動雙側。

> v2 小人的招式動作**不寫程式**:在動作編排器裡編 → JSON 匯出 → 貼進 `js/brawler-clips.js` 的
> `CLIPS`。骨架與播放器已移植為同構(`js/actor-brawler.js`),編排器裡看到的姿勢=遊戲裡的姿勢。
> 唯一的耦合點是 **impact 影格 ↔ 傷害判定時刻**(§4)。

## 1. 工具

- **編排器本體**:[`tools/punch-studio.html`](../tools/punch-studio.html)(repo 內收藏版;開發工具,不隨遊戲部署)。
  **線上即開**:Vercel 正式網址的 `/tools/punch-studio`
  (它從 CDN 載 three r128 + Google Fonts,需要網路;與遊戲 vendored r149 無關、互不影響)。
  JS 主體拆檔在 [`tools/ps/`](../tools/ps/)——古典 script 共享全域、依 HTML 順序載入;
  改碼唯一規則(每檔 hoisting:載入期程式不得前向呼叫後面的檔案)見 `tools/ps/README.md`。
- 內建:47 軸姿勢 slider、自由時間軸(拖 key 調 timing)、per-limb LAG、打擊感試打台(hitstop/震動/沙包)、
  JSON 匯出/匯入、CANCEL 點 combo 串接、GLB 部位替換(整包 bundle 或分檔,按節點/檔名對應 15 slot)。
- **基底角色(rigged avatar,預設)**:punch-studio 開機自動掛載 `assets/rigs/base-avatar.glb`
  ——**未來所有角色的基座**。原理:素體照常被 47 軸驅動(隱藏),每幀把各關節「相對 T-pose
  的世界旋轉差量」轉寫到角色骨頭(`tools/ps/avatar.js`),蹲下/踩地/接觸鎖全部自動繼承。
  **角色基座慣例**(照做即可丟進「👤 載入角色 GLB」直接用):16 骨、命名含
  Root/Torso/Neck/Head/UpperArm/Forearm/Hand/Thigh/Shin(Calf)/Foot+L/R 字樣、rest=T-pose、
  面向 +Z、網格=骨頭的剛體子節點(不蒙皮;Bone 或空節點皆可)、比例任意(自動縮放;
  左右以世界 X 判定,不信名字)。
  **「腳踝跟隨」滑桿**(角色列):0=腳鎖死跟小腿、1=完全吃編排器腳踝壓平。高筒靴角色
  (靴身在 Shin 骨、鞋頭在 Foot 骨,接縫重疊小)腳踝轉太多會在接縫開口——建議 0.2~0.4
  (基底角色預設 0.35);短鞋+裸踝的角色可以拉高。偏好記進 localStorage。
  **「關節填充」開關**(角色列,預設開):剛體部位骨架的關節在大角度旋轉時會露出樞紐周圍
  的空殼(部件近端是平蓋、非以樞紐為圓心的球)。開啟後每個關節(肩/肘/腕/髖/膝/踝/頸)在
  樞紐處生一顆低模球——以樞紐為圓心 → 旋轉不變 → 永不露縫;半徑實測該部件近端橫截半徑、
  顏色取該部件近端頂點色、掛在骨頭 local 原點。對**任何**剛體角色免費生效,零重新建模。
  「球大小」全域滑桿定總體基準;「逐關節微調」可折疊面板有 13 個倍率滑桿(左右可不同,
  0=關掉該關節)疊在全域上,對付單一腫/縫關節。半徑與顏色只在 rest(T-pose)量一次快取
  (含骨頭世界縮放——live decompose 會隨姿勢漂移),拉滑桿不重掃幾何、pose 彎曲不影響。
  想要藝術品質更高的關節,可在建模端把部件近端做成以樞紐為圓心的半球(球關節帽)取代之。
- **退路人偶**:基底角色缺席時自動退回 `meshy-mannequin.glb`(13 部位掛載),再缺退內建素體。
  拿到新的 Meshy 分件模型時用 `tools/meshy-convert.mjs` 重產。
- **「遊戲整合」面板**(repo 版加掛):
  - **招式庫**——具名槽存/載/刪(localStorage),編一整套招式不互相覆蓋;「全部匯出」產生
    `{clips:{招式名:snapshot}}` 一份 JSON,整份交給遊戲端接入。
  - **🎮 遊戲視角**——一鍵切到遊戲取景(fov32/俯角44°/看角色背面)驗動作在實戰鏡頭下的可讀性。
  - **impact 秒數讀出**——`frame÷60` 即時顯示,就是遊戲 `STRIKE_DELAY` 要填的值。
  - **連招預覽**——把多招串成一條臨時時間軸循環播放,看整套連招的實戰表現。來源:貼上
    `{clips:{…}}`/`[snap,…]`,或留空用招式庫(存入順序)。兩種接招:**取消接招**(下一招從
    上一招 CANCEL/impact 點切入=遊戲式連打手感)/ **完整播放**(每招播到收招再接)。非破壞式:
    停止(Esc/按鈕)後回到原本編輯的動作,招式庫不受影響。

## 2. 工作流(五步)

1. 編排器裡編動作(建議從內建 preset 出發改)
2. 「JSON」匯出 → 複製整份 snapshot
3. 貼進 `js/brawler-clips.js` 對應的 `CLIPS` entry:`prepClip({ ...貼這裡... })`
   (或直接把 JSON 貼給 Claude 並說明是哪個招式)
4. **判定時刻自動同步**:`STRIKE_DELAY`/`BARREL_THROW_DELAY`/`PERSON_HOLD_T`/`PERSON_THROW_DELAY` 由
   clip 的 impact key / `release`/`hold` tag **自動導出**(v2-state import CLIPS)——移動影格重貼 JSON 即對齊,
   **不再手動改常數**。扛人 clip 記得把定格幀標 tag `hold`、甩出幀標 `release`(§4)
5. 重新整理 `v2.html?clip=招式名` 驗證(任意 clip 循環試播,不用綁玩法;或跑 headless 姿勢截圖)

## 3. 資料格式(編排器 JSON snapshot)

```
{ seq:   [{ name, frame, ease, impact, cancel, tag }...],   // 時間軸(frame @60fps;seq[0]=idle,frame 0)
  phases:{ name: { 64 軸姿勢... } },                    // 每個 key 的姿勢(含手指 aX_f*、被扛者 carry_*)
  lags:  { aL, aR, lL, lR } }                           // per-limb 跟隨延遲(0..1;impact 段自動歸零)
```
- 每個 key = 一段「前一 key → 此 key」的過渡;`ease` = `in`/`out`/`lin`。
- 播放完最後一個 key 後,自動用 `seq[0].frames` 的時長收回 idle(戰鬥站姿)。
- `poseKeys`/`dim`/`version`/`cancel` 遊戲端忽略(DIM 角色比例由遊戲的 `BRAWLER_SPEC` 決定;
  cancel 接招取消點目前遊戲用自己的 combo 常數,尚未消費)。

## 4. 判定時刻自動同步(impact / release / hold tag)

傷害判定在**模擬層**(`v2-combat.js`):點擊=起手,`STRIKE_DELAY[段數]` 秒後才判定命中;
動作在**渲染層**播 clip。兩邊由 **clip 資料自動對齊**(v2-state import CLIPS——brawler-clips 是
純資料模組,sim headless 不破):

| v2-state 常數 | 來源(prepClip 導出) | fallback |
|---|---|---|
| `STRIKE_DELAY[段]` | 該 punch clip 第一個 **impact key** 的 frame÷60(`clip.impactT`) | 17f/14f/23f |
| `BARREL_THROW_DELAY` | `barrel_throw` 的 **`release` tag** 秒數 | 22f |
| `PERSON_HOLD_T` | `person_throw` 的 **`hold` tag**(缺席退回最後一個 `grab` tag) | 16f |
| `PERSON_THROW_DELAY` | `release` tag − hold | 6f |

- **studio 匯出後的慣例**:扛人/丟物 clip 的「定格幀」(舉著走的姿勢)標 tag `hold`、
  「甩出幀」標 `release`——studio 幽靈只認第一個 `grab`/`release`,中段 key 改標 `hold` 無副作用。
- 移動影格 → 重貼 JSON → 常數自動跟,**不再手動同步**。
- 起手中被打暈/被抓/被推開踉蹌 → 打擊取消(格擋推開=真反制),這由模擬層守衛,動作資料不用管。

## 5. 招式插槽(現有 CLIPS)

| CLIPS key | 遊戲觸發 | 狀態 |
|---|---|---|
| `rhook` | 三連擊第 1 段(右鉤拳) | ✅ 使用者 PUNCH STUDIO 定稿(impact @17f) |
| `lhook` | 三連擊第 2 段(左鉤拳) | ✅ 使用者定稿(impact @14f) |
| `overhand` | 三連擊第 3 段(過頂重擊=終結技) | ✅ 使用者定稿(impact @23f) |
| `barrel_throw` | 丟桶(itemClip 頻道;release 幀甩出) | ✅ 使用者定稿(release@22f;含手指軸) |
| `person_throw` | 扛人/丟人(carryClip 頻道;抓起播 0→hold 定格,丟續播→release 甩飛) | ✅ 使用者定稿 v2(hold@16f/release@22f;含手指軸,抓時捲、收招放開) |
| `barrel_pickup` | 撿桶(itemClip 頻道;**可選槽**——CLIPS 有就播,沒有=瞬間抓起) | 🕳 空槽,遊戲端已接線等 studio 匯出 |
| `run_cycle` | 跑步循環(雙擊跑 `e.running` 時**循環播放**;**可選槽**——沒有=程序跑姿 `ANIM.run`) | 🕳 空槽,遊戲端已接線 |

`run_cycle` 編排注意(**第一個循環播放槽**,規則跟一次性動作不同):
- **tag `run` = 循環起點**:0→`run` 是「起跑」過渡段(站姿加速進入,只播一次),
  `run`→結尾無縫繞圈。**`run` 幀與結尾幀姿勢要一致**(循環接縫);起跑段自由發揮。
  沒標 tag → 整條循環(此時=首尾幀要一致)。
- **相位吃位移**:循環段一圈=`ANIM.runClip.stridePx`(96px;跑速 269px/s ≈ 0.36s 一圈=左右各一步)。
  studio 裡編幾幀都行,遊戲端按位移縮放——想改步幅只調 stridePx,不用重排。
- 只在「跑步中+真的在移動」播;停下/放開鍵自動 blend 回站姿、下次起跑重播過渡段;
  跑中出拳 → 拳 clip 優先,收招接回循環(相位不重置)。無 impact。
- 建議內容:起跑段=前傾蹬地一步;循環段=屈肘泵臂+雙腳交替離地(頂點兩腳同時離地一格=衝刺感)。

`barrel_pickup` 編排注意:桶從第 0 幀就貼在雙手中點(`updateHeldBarrel`),所以**起始幀雙手往下
往前撈**(幽靈桶位,前方 ~31px 近地)桶才會從地上被撈起、跟著手升到頭頂;**結尾幀對齊
`ANIM.barrelHold`(actor-brawler)= 使用者 studio 定稿的過頂 hold 姿勢**(aL:sx −79/sy 64/sz 105/
wx 50/stretch 1.91/fbase −49;aR:sx −79/sy −65/sz 101/wx 63/wy 10/stretch 1.91/fbase −48)→
播完落回程序扛桶姿勢無縫。不需要 tag。建議短(0.3~0.5s,撿桶是輕承諾拍,見 `docs/v2-combat-rhythm.md`)。
> `barrelHold` 是**軸名→值**的平鋪覆蓋表(Object.assign 蓋在站姿上,含腕/手指)——之後重定稿舉桶姿勢,
> 直接把 studio 匯出該幀的**非零軸**抄進去即可。注意 `barrel_throw` 的 grab_hold 幀(13f)仍是舊姿勢,
> 起手丟桶時會先過渡到 clip 自己的姿勢(blend 平滑);要完全無縫可在 studio 把 barrel_throw 的
> grab/grab_hold 幀更新成同一姿勢再重匯。

新招式=新 entry + 掛上觸發頻道(punch 三槽 `PUNCH_CLIPS` / 道具 `ITEM_SPEC.clip` / 扛人 `carryClip`)。
**先驗後接**:`v2.html?clip=名字` 任意 clip 循環試播(對手 AI 凍結),或 `__v2.playClip(名字)` 播一次——
編完貼進 CLIPS 立刻看,不用先綁玩法。

## 6. 軸支援表(64 軸在遊戲端的落地)

| 軸 | 遊戲端 |
|---|---|
| `root_x/y`(根旋轉)、`root_py/pz`(升降/前移)、`sq`(擠壓)、`body_scale`、`squat` | ✅ 全支援(位移軸 ×25px/編排器單位) |
| `spine_x/y`、`pelvis_y`、`head_x/y/pz` | ✅ |
| 肩 `sx/sy/sz`、肘 `ex`、腕 `wx/wy`、`aX_idle`、`aX_scale`(命中放大:前臂+拳,繞肘) | ✅ box+avatar 皆生效 |
| 髖 `hx/hy/hz`、膝 `kx`、`lX_idle`、`lX_scale`(命中放大:小腿+腳,繞膝) | ✅ box+avatar 皆生效 |
| 踝 `lX_ax`(微調)、腳尖 `lX_ty`(踝 Y,正=外八) | ✅ box(踝節點+腳掌,含自動壓平)+avatar(foot driver) |
| `aX_stretch`/`lX_stretch`(整肢從肩/髖等比伸展;遠鏡頭伸手更明顯,1=原長) | ✅ box+avatar 皆生效(踩地自動補償腿長) |
| `lX_contact`(接觸鎖) | ✅ 自動踩地(2=該腿不當地面錨點)+ **1=墊腳**(踝抬跟 55°,同編排器) |
| 手指 `aX_f{base,mid,tip,thumb}`(骨局部 X 度,負=握) | ✅ avatar(**預設**)抓握時驅動 rigged 指骨;box(?avatar=0)忽略 |
| 被扛者 `carry_tilt/yaw/o{x,y,z}` | ✅ render `positionCarried` 消費(非扛者骨軸,applyBrawlerPose 忽略) |

## 7. 驗證協定

- 快看:本地 `python3 -m http.server 8099` → `v2.html?clip=招式名&fx=low` 循環試播(或不帶 `clip` 實際出拳)。
- headless 姿勢截圖:scratchpad 的 `animclose.mjs` 模式(拉近鏡頭,分別截 anti/impact/stun)。
- 判定時序:`anim.mjs` 模式(按下不掉血 → impact 掉血;起手被暈=取消)。
- 改了 clip 後至少跑三連擊回歸(`combo.mjs` 模式;注意 SwiftShader ≈4 倍慢動作,等待要抓 impact 之後)。
