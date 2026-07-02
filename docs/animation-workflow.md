# 動作工作流(PUNCH STUDIO → 遊戲)

> v2 小人的招式動作**不寫程式**:在動作編排器裡編 → JSON 匯出 → 貼進 `js/brawler-clips.js` 的
> `CLIPS`。骨架與播放器已移植為同構(`js/actor-brawler.js`),編排器裡看到的姿勢=遊戲裡的姿勢。
> 唯一的耦合點是 **impact 影格 ↔ 傷害判定時刻**(§4)。

## 1. 工具

- **編排器本體**:[`tools/punch-studio.html`](../tools/punch-studio.html)(repo 內收藏版;開發工具,不隨遊戲部署)。
  用一般瀏覽器直接開(它從 CDN 載 three r128 + Google Fonts,需要網路;與遊戲 vendored r149 無關、互不影響)。
- 內建:47 軸姿勢 slider、自由時間軸(拖 key 調 timing)、per-limb LAG、打擊感試打台(hitstop/震動/沙包)、
  JSON 匯出/匯入、CANCEL 點 combo 串接。

## 2. 工作流(五步)

1. 編排器裡編動作(建議從內建 preset 出發改)
2. 「JSON」匯出 → 複製整份 snapshot
3. 貼進 `js/brawler-clips.js` 對應的 `CLIPS` entry:`prepClip({ ...貼這裡... })`
   (或直接把 JSON 貼給 Claude 並說明是哪個招式)
4. 若 **impact key 的 frame 位置變了** → 同步改 `js/v2-state.js` 的 `STRIKE_DELAY`(§4)
5. 重新整理 v2.html 驗證(或跑 headless 姿勢截圖)

## 3. 資料格式(編排器 JSON snapshot)

```
{ seq:   [{ name, frame, ease, impact, cancel }...],   // 時間軸(frame @60fps;seq[0]=idle,frame 0)
  phases:{ name: { 47 軸姿勢... } },                    // 每個 key 的姿勢
  lags:  { aL, aR, lL, lR } }                           // per-limb 跟隨延遲(0..1;impact 段自動歸零)
```
- 每個 key = 一段「前一 key → 此 key」的過渡;`ease` = `in`/`out`/`lin`。
- 播放完最後一個 key 後,自動用 `seq[0].frames` 的時長收回 idle(戰鬥站姿)。
- `poseKeys`/`dim`/`version` 等其餘欄位遊戲端忽略(DIM 角色比例由遊戲的 `BRAWLER_SPEC` 決定)。

## 4. ⚠ impact 影格 ↔ STRIKE_DELAY 對齊(唯一要記的規則)

傷害判定在**模擬層**(`v2-combat.js`):點擊=起手,`STRIKE_DELAY[段數]` 秒後才判定命中;
動作在**渲染層**播 clip。兩邊靠「約定」對齊,不靠 import(sim 保持 headless):

```
STRIKE_DELAY[段] ≈ clip impact key 的 frame ÷ 60
```
- 現值:鉤拳 0.15(impact @9f 附近)、終結直拳 0.22(@13f 附近)。
- 你把 impact key 拖到別的 frame → `js/v2-state.js` 的 `STRIKE_DELAY` 跟著改,否則「看到打中」和「實際掉血」會脫節。
- 起手中被打暈/被抓/被推開踉蹌 → 打擊取消(格擋推開=真反制),這由模擬層守衛,動作資料不用管。

## 5. 招式插槽(現有 CLIPS)

| CLIPS key | 遊戲觸發 | 狀態 |
|---|---|---|
| `hookl` | 三連擊第 1 段(左鉤) | 引導自編排器 preset,待重編 |
| `hookr` | 三連擊第 2 段(右鉤) | 同上 |
| `cross` | 三連擊第 3 段(終結直拳);**投擲暫借用** | 同上;投擲需要專屬過肩摔 clip(最優先缺口) |

新招式=新 entry + 在 `actor-brawler.js` 的 `PUNCH_CLIPS` / 狀態機掛上觸發。

## 6. 軸支援表(47 軸在遊戲端的落地)

| 軸 | 遊戲端 |
|---|---|
| `root_x/y`(根旋轉)、`root_py/pz`(升降/前移)、`sq`(擠壓)、`body_scale`、`squat` | ✅ 全支援(位移軸 ×25px/編排器單位) |
| `spine_x/y`、`pelvis_y`、`head_x/y/pz` | ✅ |
| 肩 `sx/sy/sz`、肘 `ex`、腕 `wx/wy`、`aX_idle`、`aX_scale`(命中放大:前臂+拳) | ✅ |
| 髖 `hx/hy/hz`、膝 `kx`、`lX_idle`、`lX_scale` | ✅(lX_scale 目前僅預留) |
| `lX_contact`(接觸鎖) | ✅ 吃進自動踩地(2=該腿不當地面錨點) |
| 踝 `ax`、腳尖 `ty` | ❌ 忽略(遊戲小人沒有腳掌;編動作時不用調) |

## 7. 驗證協定

- 快看:本地 `python3 -m http.server 8099` → `v2.html?fx=low` 實際出拳。
- headless 姿勢截圖:scratchpad 的 `animclose.mjs` 模式(拉近鏡頭,分別截 anti/impact/stun)。
- 判定時序:`anim.mjs` 模式(按下不掉血 → impact 掉血;起手被暈=取消)。
- 改了 clip 後至少跑三連擊回歸(`combo.mjs` 模式;注意 SwiftShader ≈4 倍慢動作,等待要抓 impact 之後)。
