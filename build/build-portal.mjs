// Portal 投稿發佈:把 v2 打包成一份混淆 build,給 CrazyGames/Poki 上傳。
//
// 設計原則:**開發流程完全不動**。這支腳本只讀 repo 的原始檔,產出獨立的 dist/;
// js/ 底下永遠是可讀的原始 ES modules。dist/ 是拋棄式產物(gitignore),隨時重產。
//
// 管線:esbuild(bundle 整個 v2 import 樹 → 單檔 IIFE)→ javascript-obfuscator(混淆)
//      → 組 dist/(改寫過的 v2.html + vendor/three.min.js)。
//
// 用法:cd build && npm install && npm run build   →   產出 ../dist/
//
// 邊界:
//  - THREE 由 vendor/three.min.js 以全域載入,不進 bundle(external 全域)。
//  - v2-tuning.js(?tune=1 開發面板)排除,不隨投稿包外流。
//  - 遊戲全程序化,無 runtime 資產抓取,所以 dist/ 只需 html + bundle + vendor。

import { build } from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const p = (...s) => resolve(ROOT, ...s);
const log = (...a) => console.log('[portal]', ...a);

// ---- 0. 乾淨的 dist/ ----
rmSync(DIST, { recursive: true, force: true });
mkdirSync(resolve(DIST, 'vendor'), { recursive: true });

// ---- 1. esbuild:bundle v2 import 樹 → 單檔 IIFE(THREE 外部、tuning 排除) ----
log('esbuild bundling js/v2.js …');
const result = await build({
  entryPoints: [p('js/v2.js')],
  bundle: true,
  format: 'iife',
  target: 'es2019',
  charset: 'utf8',            // 保留中文 UI 字串,不轉 \u escape
  legalComments: 'none',
  write: false,
  // THREE 是 vendored UMD 全域;v2-tuning 是開發面板 → 兩者都不進 bundle。
  external: ['three'],
  plugins: [{
    name: 'drop-tuning',
    setup(b) {
      // ?tune=1 的動態 import('./v2-tuning.js') 標成 external:投稿包不含它,
      // 執行期若不存在,v2.js 內的 .catch 會安靜吞掉。
      b.onResolve({ filter: /v2-tuning\.js$/ }, () => ({ path: './v2-tuning.js', external: true }));
    },
  }],
});
const bundled = result.outputFiles[0].text;
log(`  bundled ${(bundled.length / 1024).toFixed(0)} KB (未混淆)`);

// ---- 2. javascript-obfuscator:混淆 ----
log('obfuscating …');
const obf = JavaScriptObfuscator.obfuscate(bundled, {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.6,   // 全開會太慢;0.6 對即時遊戲是體感/防護的平衡點
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  splitStrings: true,
  splitStringsChunkLength: 8,
  identifierNamesGenerator: 'mangled',
  selfDefending: true,                   // 被 beautify/改寫就自毀
  debugProtection: true,                 // 開 DevTools 除錯器就卡住
  disableConsoleOutput: false,           // 遊戲有 console.warn 診斷,保留
  numbersToExpressions: true,
  transformObjectKeys: true,
  renameGlobals: false,                  // 別動 THREE 這種外部全域
  reservedNames: ['^THREE$'],
}).getObfuscatedCode();
log(`  obfuscated ${(obf.length / 1024).toFixed(0)} KB`);
writeFileSync(resolve(DIST, 'game.min.js'), obf, 'utf8');

// ---- 3. vendor(three 已是 minified,原樣帶走) ----
cpSync(p('vendor/three.min.js'), resolve(DIST, 'vendor/three.min.js'));

// ---- 4. 改寫 v2.html:module 進入點 → 混淆過的 classic script ----
let html = readFileSync(p('v2.html'), 'utf8');
html = html.replace(
  '<script type="module" src="js/v2.js"></script>',
  '<script src="game.min.js"></script>'
);
if (html.includes('js/v2.js')) throw new Error('v2.html 進入點替換失敗,請檢查 <script> 標籤');
writeFileSync(resolve(DIST, 'index.html'), html, 'utf8');   // 投稿包的入口一律叫 index.html

log('✅ dist/ 完成:index.html + game.min.js + vendor/three.min.js');
log('   投稿前用本地伺服器實測:python3 -m http.server 8100 --directory dist');
