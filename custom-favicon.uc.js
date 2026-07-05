// ==UserScript==
// @name           Custom Favicon
// @version        2.0.0
// @description    Custom favicons for websites — 3-tier: custom icons → Google auto → Firefox default
// @author         Impre
// @include        main
// ==/UserScript==

(function () {
    'use strict';

    const MOD_ID = 'CustomFavicon';
    const MOD_DIR = PathUtils.join(PathUtils.profileDir, 'chrome', 'sine-mods', MOD_ID);
    const ICONS_DIR = PathUtils.join(MOD_DIR, 'icons');
    const MAP_FILE = PathUtils.join(MOD_DIR, 'favicon-map.json');

    // Google Favicon v2 — max resolution
    const GOOGLE_FAVICON_URL = 'https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://DOMAIN&size=256';

    // ═══════════════════════════════════════════════════════════════════════
    //  CONFIGURATION — Loaded from favicon-map.json
    //
    //  JSON structure:
    //  {
    //      "custom": { "domain.com": "icon.png", ... },  // Override with local icon
    //      "auto": ["domain.com", ...]                    // Auto-fetch from Google
    //  }
    //
    //  Domain matching: hostname === domain || hostname.endsWith('.' + domain)
    //  "youtube.com" matches www.youtube.com, m.youtube.com, youtube.com
    // ═══════════════════════════════════════════════════════════════════════

    // Caches: domain pattern → resolved URL
    let customUrlCache = {};  // domain → file:/// URL
    let autoDomains = [];     // array of domain patterns

    function buildCustomCache(customMap) {
        customUrlCache = {};
        for (const [domain, iconFile] of Object.entries(customMap)) {
            const iconPath = PathUtils.join(ICONS_DIR, iconFile);
            customUrlCache[domain] = 'file:///' + iconPath.replace(/\\/g, '/').replace(/ /g, '%20');
        }
    }

    function googleFaviconUrl(domain) {
        return GOOGLE_FAVICON_URL.replace('DOMAIN', domain);
    }

    /**
     * Resolves the icon URL for a given hostname using 3-tier priority:
     *   1. Custom (local icon file)
     *   2. Auto (Google favicon v2)
     *   3. null (Firefox handles it)
     */
    function matchDomain(hostname) {
        // Tier 1: Custom overrides
        for (const [domain, iconUrl] of Object.entries(customUrlCache)) {
            if (hostname === domain || hostname.endsWith('.' + domain)) {
                return iconUrl;
            }
        }
        // Tier 2: Auto (Google)
        for (const domain of autoDomains) {
            if (hostname === domain || hostname.endsWith('.' + domain)) {
                return googleFaviconUrl(domain);
            }
        }
        // Tier 3: Firefox default
        return null;
    }

    /**
     * Get icon URL for a tab's current URL.
     * Returns null if no match or invalid URL.
     */
    function getIconForTab(tab) {
        if (!tab || !tab.linkedBrowser) return null;
        const url = tab.linkedBrowser.currentURI.spec;
        try {
            const hostname = new URL(url).hostname;
            return matchDomain(hostname);
        } catch (e) {
            return null;
        }
    }

    // ── Config loading ─────────────────────────────────────────────────────

    async function loadConfig() {
        try {
            const config = await IOUtils.readJSON(MAP_FILE);
            const custom = config.custom || {};
            autoDomains = Array.isArray(config.auto) ? config.auto : [];

            buildCustomCache(custom);
            applyToAllTabs();
            applyToUrlbar();

            const customCount = Object.keys(custom).length;
            const autoCount = autoDomains.length;
            console.log(`[CustomFavicon] Config rechargée — ${customCount} custom, ${autoCount} auto`);
        } catch (e) {
            console.error('[CustomFavicon] Erreur chargement favicon-map.json:', e.message);
        }
    }

    // ── Tab icon override ──────────────────────────────────────────────────

    function applyToTab(tab) {
        if (!tab || !tab.linkedBrowser) return;
        const iconUrl = getIconForTab(tab);
        if (!iconUrl) return;
        // Skip if already set (prevents loop with TabAttrModified)
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
            // !important beats Firefox's own identity-icon CSS updates (verifiedDomain, etc.)
            identityIcon.style.setProperty('list-style-image', `url("${iconUrl}")`, 'important');
        } else {
            // Clear override — let Firefox use the real favicon
            identityIcon.style.removeProperty('list-style-image');
        }
    }

    // ── Event handlers ─────────────────────────────────────────────────────

    function onTabAttrModified(event) {
        const tab = event.target;
        if (!tab || !tab.linkedBrowser) return;

        const changed = event.detail?.changed;
        if (!changed) return;

        // Re-apply tab icon if image/label/busy changed
        if (changed.includes('image') || changed.includes('label') || changed.includes('busy')) {
            applyToTab(tab);
        }

        // Update urlbar if the selected tab changed
        if (tab === gBrowser.selectedTab) {
            applyToUrlbar();
        }
    }

    function onTabSelect() {
        applyToUrlbar();
    }

    // Progress listener — catches URL changes on ALL tabs
    const progressListener = {
        onLocationChange(browser, webProgress, request, location, flags) {
            const tab = gBrowser.getTabForBrowser(browser);
            if (tab) applyToTab(tab);

            // Update urlbar for the selected tab (with delay to override Firefox's favicon fetch)
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

        // Expose hot-reload function
        window.__reloadFavicons = loadConfig;

        // Tab icon overrides
        gBrowser.tabContainer.addEventListener('TabAttrModified', onTabAttrModified);
        gBrowser.tabContainer.addEventListener('TabSelect', onTabSelect);
        gBrowser.tabContainer.addEventListener('TabOpen', (e) => {
            setTimeout(() => applyToTab(e.target), 200);
            setTimeout(() => applyToTab(e.target), 1000);
        });

        // Urlbar + cross-tab URL change detection
        gBrowser.addTabsProgressListener(progressListener);

        // Load config then apply
        loadConfig().then(() => {
            applyToAllTabs();
            applyToUrlbar();
        });

        console.log('[CustomFavicon] v2.0 initialized — lecture de favicon-map.json');
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') init();
    else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
