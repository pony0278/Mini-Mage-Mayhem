# build/ — Portal 投稿發佈工具

**這是整個 repo 唯一用 npm 的地方。** 遊戲本體維持零 build:`js/` 永遠是可讀的
原始 ES modules,你照舊直接改、hard-refresh 看效果。這個資料夾只做一件事——
**把 v2 打包成一份混淆過的投稿包**,給 CrazyGames / Poki 上傳。

## 為什麼要有它

client-side JS 無法真正保密(瀏覽器一定拿得到原始碼),但可以**提高門檻**,
擋掉「整包扒走 re-host / rip-and-reskin」這類自動化盜取:

- **esbuild** 把整個 v2 import 樹 bundle 成單檔(不再是一棵漂亮好讀的模組樹)。
- **javascript-obfuscator** 做控制流扁平化、字串陣列加密、self-defending
  (被 beautify 就自毀)、debug protection(開除錯器就卡住)。

真正的防禦護城河仍是**平台 SDK 網域鎖 + DMCA 下架**(讓盜站賺不到廣告錢);
混淆只是把「隨手抄」變得不划算。細節見 `docs/publishing.md`。

## 用法

```bash
cd build
npm install          # 只需第一次(node_modules 已 gitignore)
npm run build        # 產出 ../dist/
```

產物 `dist/`(gitignore,拋棄式,隨時重產):

```
dist/
  index.html                          # v2.html 改寫版,入口改叫 index.html、指向混淆檔
  game.min.js                         # bundle + 混淆後的整個 v2(~640KB;gz ~246KB)
  vendor/three.min.js                 # THREE 全域
  vendor/GLTFLoader.js                # avatar/rigged 手載入 GLB 需要
  assets/rigs/base-avatar.glb         # 角色(avatar 預設開,開局 fetch)
  assets/rigs/chibi-hands-rigged.glb  # rigged 手
  assets/rigs/chibi-hands.glb         # 方塊人手(?avatar=0 才用;順帶帶走)
```

**over-the-wire 總量 ~0.68 MB(gzip)——Poki 8MB 初始下載門檻下用不到 9%,餘裕極大。**

投稿前本地實測:

```bash
python3 -m http.server 8100 --directory dist   # → http://localhost:8100/
```

## 邊界(build-portal.mjs 的假設)

- **THREE** 由 `vendor/three.min.js` 全域載入,不進 bundle(esbuild `external`)。
- **v2-tuning.js**(`?tune=1` 開發面板)排除,不隨投稿包外流。
- **執行時資產**:avatar 預設開 → 開局 `fetch('assets/rigs/*.glb')`(角色 + rigged 手 + 方塊人手)。
  build 腳本已複製 `vendor/GLTFLoader.js` + `assets/rigs/`;`assets/raw`、`assets/parts`
  是建模來源檔,**不進部署**(同 `.vercelignore`)。
  ⚠ 日後 v2 再 `fetch` 新的外部資產(元素道具 GLB 等),記得在 build-portal.mjs §3.5 補複製,
  否則投稿包 404。**每次改完務必 headless 實測 dist/**(scratchpad `dist_boot.mjs`:確認
  avatar 建成 + GLB 皆 200,混淆器 selfDefending/debugProtection 只有實跑才驗得出)。

## 天花板(誠實話)

混淆擋得住 99% 的自動化 rip 和隨手抄,擋不住鐵了心的逆向工程師——但配上平台
網域鎖,那個工程師逆向成功也變不出錢,所以不會來。要的「防禦」到這裡就成立,
不是靠絕對保密,是靠「抄了也沒好處」。
