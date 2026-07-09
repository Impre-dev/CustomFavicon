// ==UserScript==
// @name           Custom Favicon
// @version        2.1.1
// @description    Custom favicons — custom overrides → Google auto for public sites → skip localhost/IPs/excluded
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
    //      "custom": { "domain.com": "icon.png", ... },
    //      "exclude": ["localhost", "example.com", ...]
    //  }
    //
    //  Logic:
    //    1. Custom override → local icon from icons/
    //    2. Public HTTP(S) site not excluded → Google favicon v2 (256px)
    //    3. about:*, chrome://, localhost, IPs, excluded → skip entirely
    //
    //  Domain matching: hostname === domain || hostname.endsWith('.' + domain)
    // ═══════════════════════════════════════════════════════════════════════

    let customUrlCache = {};  // domain → file:/// URL
    let excludePatterns = []; // domains to skip (no Google favicon)

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

    /** Check if hostname is an IP address (IPv4 or IPv6) */
    function isIPAddress(hostname) {
        // IPv4: x.x.x.x
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
        // IPv6: contains ':'
        if (hostname.includes(':')) return true;
        return false;
    }

    /** Check if hostname should be excluded from Google favicon */
    function isExcluded(hostname) {
        // Auto-exclude IP addresses
        if (isIPAddress(hostname)) return true;
        // Check user-configured exclude patterns
        for (const pattern of excludePatterns) {
            if (hostname === pattern || hostname.endsWith('.' + pattern)) return true;
        }
        return false;
    }

    /**
     * Resolves the icon URL for a tab's current URL.
     *
     * Tier 1: Custom override (local icon)
     * Tier 2: Google favicon v2 (256px) — auto for ALL public HTTP(S) sites
     * Tier 3: null (skip) — about:*, chrome://, localhost, IPs, excluded domains
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

        // Tier 1: Custom overrides (always takes priority, even for excluded domains)
        for (const [domain, iconUrl] of Object.entries(customUrlCache)) {
            if (hostname === domain || hostname.endsWith('.' + domain)) {
                return iconUrl;
            }
        }

        // Tier 2: Skip excluded domains (localhost, IPs, example.com, etc.)
        if (isExcluded(hostname)) return null;

        // Tier 3: Google favicon for everything else
        return googleFaviconUrl(hostname);
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
            console.log(`[CustomFavicon] Config rechargée — ${Object.keys(custom).length} custom, ${excludePatterns.length} exclus, Google auto pour le reste`);
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
