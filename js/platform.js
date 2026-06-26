// CrazyGames SDK adapter (client-only). Dynamically loads the SDK and degrades to no-ops when it
// isn't reachable / not inside CrazyGames (local dev, github.io, itch) so the game runs everywhere.
// Docs: https://docs.crazygames.com/ (SDK v3). Only index.html (the shipped game) calls init().
let sdk = null, ready = false;
let hooks = { pause() {}, resume() {} };
const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';

export function configure(h) { hooks = { ...hooks, ...h }; }
const call = (fn) => { try { return fn(); } catch (e) { /* SDK hiccup — never let it break the game */ } };

function loadScript() {
  return new Promise((resolve) => {
    if (window.CrazyGames && window.CrazyGames.SDK) return resolve(true);
    const s = document.createElement('script');
    s.src = SDK_URL; s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);                                  // blocked / offline → standalone
    document.head.appendChild(s);
    setTimeout(() => resolve(!!(window.CrazyGames && window.CrazyGames.SDK)), 4000); // safety timeout
  });
}

export async function init() {
  await loadScript();
  sdk = (window.CrazyGames && window.CrazyGames.SDK) || null;
  if (!sdk) { console.info('[platform] CrazyGames SDK absent — running standalone'); return; }
  try { await sdk.init(); ready = true; console.info('[platform] CrazyGames SDK ready'); }
  catch (e) { console.warn('[platform] SDK init failed — standalone', e); sdk = null; }
}

// loading phase done (call once the game can be played)
export function loadingStop() { if (sdk) call(() => sdk.game && sdk.game.sdkGameLoadingStop && sdk.game.sdkGameLoadingStop()); }
// active gameplay started / stopped (menus, pause, ad breaks count as stopped)
export function gameplayStart() { if (ready) call(() => sdk.game && sdk.game.gameplayStart && sdk.game.gameplayStart()); }
export function gameplayStop() { if (ready) call(() => sdk.game && sdk.game.gameplayStop && sdk.game.gameplayStop()); }

// a midgame ad at a natural break — pauses the game + ducks audio around it (via hooks), and always
// resumes (adFinished / adError / a safety timeout) so a flaky ad can never soft-lock the game.
export function midgameAd() {
  if (!ready || !sdk.ad || !sdk.ad.requestAd) return;
  hooks.pause();
  let resumed = false; const done = () => { if (resumed) return; resumed = true; hooks.resume(); };
  call(() => sdk.ad.requestAd('midgame', { adStarted: () => {}, adFinished: done, adError: done }));
  setTimeout(done, 30000);
}
