// ==UserScript==
// @name           Custom Favicon
// @version        2.1.0
// @description    Custom favicons — custom overrides → Google auto for all HTTP(S) sites → skip internal pages
// @author         Impre
// @include        main
// ==/UserScript==

(function () {
    'use strict';

    const MOD_ID = 'CustomFavicon';
    const MOD_DIR = PathUtils.join(PathUtils.profileDir, 'chrome', 'sine-mods', MOD_ID);
    const ICONS_DIR = PathUtils.join(MOD_DIR, 'icons');
    const MAP_FILE = PathUtils.join(MOD_DIR, 'favicon-map.json');

    // ═══════════════════════════════════════════════════════════════════════
    //  CONFIGURATION — favicon-map.json
    //
    //  {
    //      "custom": { "domain.com": "icon.png", ... }
    //  }
    //
    //  Logic:
    //    1. Custom override → local icon from icons/
    //    2. Any HTTP(S) site not in custom → Google favicon v2 (256px)
    //    3. about:*, chrome://, file:// → skip entirely (other mods handle them)
    //
    //  Domain matching: hostname === domain || hostname.endsWith('.' + domain)
    // ═══════════════════════════════════════════════════════════════════════

    let customUrlCache = {};  // domain → file:/// URL

    function buildCustomCache(customMap) {
        customUrlCache = {};
        for (const [domain, iconFile] of Object.entries(customMap)) {
            const iconPath = PathUtils.join(ICONS_DIR, iconFile);
            customUrlCache[domain] = 'file:///' + iconPath.replace(/\\/g, '/').replace(/ /g, '%20');
        }
    }

    function googleFaviconUrl(hostname) {
        return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${hostname}&size=256`;
    }

    /**
     * Resolves the icon URL for a tab's current URL.
     *
     * Tier 1: Custom override (local icon)
     * Tier 2: Google favicon v2 (256px) — auto for ALL HTTP(S) sites
     * Tier 3: null (skip) — about:*, chrome://, etc.
     */
    function getIconForTab(tab) {
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

        // Tier 1: Custom overrides
        for (const [domain, iconUrl] of Object.entries(customUrlCache)) {
            if (hostname === domain || hostname.endsWith('.' + domain)) {
                return iconUrl;
            }
        }

        // Tier 2: Google favicon for everything else
        return googleFaviconUrl(hostname);
    }

    // ── Config loading ─────────────────────────────────────────────────────

    async function loadConfig() {
        try {
            const config = await IOUtils.readJSON(MAP_FILE);
            const custom = config.custom || {};
            buildCustomCache(custom);
            applyToAllTabs();
            applyToUrlbar();
            console.log(`[CustomFavicon] Config rechargée — ${Object.keys(custom).length} custom, Google auto pour le reste`);
        } catch (e) {
            console.error('[CustomFavicon] Erreur chargement favicon-map.json:', e.message);
        }
    }

    // ── Tab icon override ──────────────────────────────────────────────────

    function applyToTab(tab) {
        if (!tab || !tab.linkedBrowser) return;
        const iconUrl = getIconForTab(tab);
        if (!iconUrl) return;
        if (tab.getAttribute('image') === iconUrl) return;
        tab.setAttribute('image', iconUrl);
    }

    function applyToAllTabs() {
        for (const tab of gBrowser.tabs) applyToTab(tab);
    }

    // ── Urlbar identity icon override ──────────────────────────────────────

    function applyToUrlbar() {
        const identityIcon = document.getElementById('identity-icon');
        if (!identityIcon) return;

        const iconUrl = getIconForTab(gBrowser.selectedTab);
        if (iconUrl) {
            identityIcon.style.setProperty('list-style-image', `url("${iconUrl}")`, 'important');
        } else {
            identityIcon.style.removeProperty('list-style-image');
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
        if (!window.gBrowser || !gBrowser.tabContainer) { setTimeout(init, 500); return; }
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

        console.log('[CustomFavicon] v2.1 initialized — custom overrides + Google auto');
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') init();
    else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
