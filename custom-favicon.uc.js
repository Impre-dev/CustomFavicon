// ==UserScript==
// @name           Custom Favicon
// @version        2.2.0
// @description    Custom favicons — custom overrides → Google auto (quality-checked) → skip internal/local
// @author         Impre
// @include        main
// ==/UserScript==

(function () {
  'use strict';

  const MOD_ID = 'CustomFavicon';
  const MOD_DIR = PathUtils.join(PathUtils.profileDir, 'chrome', 'sine-mods', MOD_ID);
  const ICONS_DIR = PathUtils.join(MOD_DIR, 'icons');
  const MAP_FILE = PathUtils.join(MOD_DIR, 'favicon-map.json');

  // Minimum acceptable favicon dimension from Google (filters placeholder/globe)
  const QUALITY_THRESHOLD = 64;

  // ═══════════════════════════════════════════════════════════════════════
  //  CONFIGURATION — favicon-map.json
  //
  //  {
  //      "custom": { "domain.com": "icon.png", ... },
  //      "exclude": ["localhost", "example.com", ...]
  //  }
  //
  //  Logic:
  //    1. Custom override → local icon from icons/ (applied immediately)
  //    2. Public HTTP(S) site not excluded → Google favicon v2 (256px)
  //       → Quality check: preload image, only apply if naturalWidth >= 64
  //    3. about:*, chrome://, localhost, IPs, excluded, low-quality → skip
  //
  //  Domain matching: hostname === domain || hostname.endsWith('.' + domain)
  // ═══════════════════════════════════════════════════════════════════════

  let customUrlCache = {}; // domain → file:/// URL
  let excludePatterns = []; // domains to skip (no Google favicon)
  const googleQualityCache = {}; // hostname → true (good) | false (bad quality)

  function buildCustomCache(customMap) {
    customUrlCache = {};
    for (const [domain, iconFile] of Object.entries(customMap)) {
      // Sous-chemins ("Chatbots/LeChat.png"): join() ET joinRelative()
      // rejettent les segments avec séparateur (NS_ERROR_FILE_UNRECOGNIZED_PATH)
      // → split en segments purs + join() multi-arguments, robuste partout
      const iconPath = PathUtils.join(
        ICONS_DIR,
        ...String(iconFile)
          .split(/[\\/]+/)
          .filter(Boolean),
      );
      customUrlCache[domain] = 'file:///' + iconPath.replace(/\\/g, '/').replace(/ /g, '%20');
    }
  }

  function googleFaviconUrl(hostname) {
    return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${hostname}&size=256`;
  }

  /** Check if hostname is an IP address (IPv4 or IPv6) */
  function isIPAddress(hostname) {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
    if (hostname.includes(':')) return true;
    return false;
  }

  /** Check if hostname should be excluded from Google favicon */
  function isExcluded(hostname) {
    if (isIPAddress(hostname)) return true;
    for (const pattern of excludePatterns) {
      if (hostname === pattern || hostname.endsWith('.' + pattern)) return true;
    }
    return false;
  }

  /**
   * Preload Google favicon and check its quality.
   * Callback receives the URL if quality >= threshold, null otherwise.
   * Result is cached per hostname.
   */
  function checkGoogleQuality(hostname, url, callback) {
    // Already checked — return cached result
    if (hostname in googleQualityCache) {
      callback(googleQualityCache[hostname] ? url : null);
      return;
    }

    const img = new Image();
    img.onload = function () {
      const good = img.naturalWidth >= QUALITY_THRESHOLD;
      googleQualityCache[hostname] = good;
      callback(good ? url : null);
    };
    img.onerror = function () {
      googleQualityCache[hostname] = false;
      callback(null);
    };
    img.src = url;
  }

  /**
   * Resolves the icon for a tab's current URL.
   * Returns { url, hostname, isCustom } or null.
   */
  function resolveIcon(tab) {
    if (!tab || !tab.linkedBrowser) return null;
    const url = tab.linkedBrowser.currentURI.spec;

    // Skip non-HTTP(S) — about:*, chrome://, file://, etc.
    if (!url.startsWith('http://') && !url.startsWith('https://')) return null;

    let hostname;
    try {
      hostname = new URL(url).hostname;
    } catch (e) {
      return null;
    }

    // Tier 1: Custom overrides (always priority, even for excluded domains)
    for (const [domain, iconUrl] of Object.entries(customUrlCache)) {
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        return { url: iconUrl, hostname, isCustom: true };
      }
    }

    // Tier 2: Skip excluded domains (localhost, IPs, example.com, etc.)
    if (isExcluded(hostname)) return null;

    // Tier 3: Google favicon (quality-checked at apply time)
    return { url: googleFaviconUrl(hostname), hostname, isCustom: false };
  }

  // ── Config loading ─────────────────────────────────────────────────────

  async function loadConfig() {
    try {
      const config = await IOUtils.readJSON(MAP_FILE);
      const custom = config.custom || {};
      excludePatterns = Array.isArray(config.exclude) ? config.exclude : [];
      buildCustomCache(custom);
      applyToAllTabs();
      applyToUrlbar();
      console.log(
        `[CustomFavicon] Config rechargée — ${Object.keys(custom).length} custom, ${excludePatterns.length} exclus, Google auto (quality ≥ ${QUALITY_THRESHOLD}px)`,
      );
    } catch (e) {
      console.error('[CustomFavicon] Erreur chargement favicon-map.json:', e.message);
    }
  }

  // ── Tab icon override ──────────────────────────────────────────────────

  function applyToTab(tab) {
    const result = resolveIcon(tab);
    if (!result) return;

    if (result.isCustom) {
      // Custom: apply immediately
      if (tab.getAttribute('image') !== result.url) {
        tab.setAttribute('image', result.url);
      }
    } else {
      // Google: check quality first
      checkGoogleQuality(result.hostname, result.url, (goodUrl) => {
        if (!goodUrl) return;
        // Tab might have navigated since — verify it's still the same hostname
        const currentResult = resolveIcon(tab);
        if (!currentResult || currentResult.hostname !== result.hostname) return;
        if (tab.getAttribute('image') !== goodUrl) {
          tab.setAttribute('image', goodUrl);
        }
      });
    }
  }

  function applyToAllTabs() {
    for (const tab of gBrowser.tabs) applyToTab(tab);
  }

  // ── Urlbar identity icon override ──────────────────────────────────────

  function applyToUrlbar() {
    const identityIcon = document.getElementById('identity-icon');
    if (!identityIcon) return;

    const result = resolveIcon(gBrowser.selectedTab);
    if (!result) {
      identityIcon.style.removeProperty('list-style-image');
      return;
    }

    if (result.isCustom) {
      identityIcon.style.setProperty('list-style-image', `url("${result.url}")`, 'important');
    } else {
      // Google: check quality
      checkGoogleQuality(result.hostname, result.url, (goodUrl) => {
        // Re-check: user might have switched tabs
        const currentResult = resolveIcon(gBrowser.selectedTab);
        if (!currentResult || currentResult.hostname !== result.hostname) return;

        if (goodUrl) {
          identityIcon.style.setProperty('list-style-image', `url("${goodUrl}")`, 'important');
        } else {
          identityIcon.style.removeProperty('list-style-image');
        }
      });
    }
  }

  // ── Event handlers ─────────────────────────────────────────────────────

  function onTabAttrModified(event) {
    const tab = event.target;
    if (!tab || !tab.linkedBrowser) return;

    const changed = event.detail?.changed;
    if (!changed) return;

    if (changed.includes('image') || changed.includes('label') || changed.includes('busy')) {
      applyToTab(tab);
    }
    if (tab === gBrowser.selectedTab) {
      applyToUrlbar();
    }
  }

  function onTabSelect() {
    applyToUrlbar();
  }

  const progressListener = {
    onLocationChange(browser, webProgress, request, location, flags) {
      const tab = gBrowser.getTabForBrowser(browser);
      if (tab) applyToTab(tab);

      if (browser === gBrowser.selectedBrowser) {
        setTimeout(applyToUrlbar, 150);
        setTimeout(applyToUrlbar, 500);
      }
    },
    QueryInterface: ChromeUtils.generateQI(['nsIWebProgressListener', 'nsISupportsWeakReference']),
  };

  // ── Init ───────────────────────────────────────────────────────────────

  function init() {
    if (window.__customFaviconPatched) return;
    if (!window.gBrowser || !gBrowser.tabContainer) {
      setTimeout(init, 500);
      return;
    }
    window.__customFaviconPatched = true;

    // Hot-reload: __reloadFavicons() in console
    window.__reloadFavicons = loadConfig;

    gBrowser.tabContainer.addEventListener('TabAttrModified', onTabAttrModified);
    gBrowser.tabContainer.addEventListener('TabSelect', onTabSelect);
    gBrowser.tabContainer.addEventListener('TabOpen', (e) => {
      setTimeout(() => applyToTab(e.target), 200);
      setTimeout(() => applyToTab(e.target), 1000);
    });

    gBrowser.addTabsProgressListener(progressListener);

    loadConfig().then(() => {
      applyToAllTabs();
      applyToUrlbar();
    });

    console.log(`[CustomFavicon] v2.2 initialized — custom + Google auto (quality ≥ ${QUALITY_THRESHOLD}px)`);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') init();
  else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
