// ==UserScript==
// @name           Custom Favicon
// @version        1.0.0
// @description    Custom favicons for websites — override tab image + urlbar identity icon by domain
// @author         Impre
// @include        main
// ==/UserScript==

(function () {
    'use strict';

    const MOD_ID = 'CustomFavicon';
    const ICONS_DIR = PathUtils.join(PathUtils.profileDir, 'chrome', 'sine-mods', MOD_ID, 'icons');

    // ═══════════════════════════════════════════════════════════════════════
    //  CONFIGURATION — Map: domain pattern → icon filename
    //
    //  Le domain est matché contre le hostname de l'URL.
    //  "youtube.com" matche www.youtube.com, m.youtube.com, youtube.com
    //  Pour un sous-domaine spécifique : "chat.qwen.ai"
    // ═══════════════════════════════════════════════════════════════════════

    const FAVICON_MAP = {
        // ── IA ──
        'aistudio.google.com':     'gemini.png',
        'kimi.com':                'kimi.png',
        'chat.qwen.ai':            'qwen.png',
        'chat.deepseek.com':       'deepseek.png',
        'z.ai':                    'zai.png',
        'claude.ai':               'claude.png',
        'chatgpt.com':             'chatgpt.png',
        'grok.com':                'grok.png',
        'arena.ai':                'LMArena.png',
        'chat.mistral.ai':         'LeChat.png',
        'meta.ai':                 'metaai.png',
        'lumo.proton.me':          'lumo.png',

        // ── Outils ──
        'photoroom.com':           'photoroom.png',
        'labs.google':             'Whisk.png',
        'translate.google.fr':     'GTrad.png',
        'translate.google.com':    'GTrad.png',

        // ── General ──
        'app.raindrop.io':         'Raindrop.png',
        'youtube.com':             'youtube.png',
        'app.tvtime.com':          'TVShowTime.png',
        'soundcloud.com':          'Soundcloud.png',
        'nexusmods.com':           'nexus.png',
        'mod.io':                  'modio.png',
    };

    // Cache: domain pattern → file:// URL
    const iconUrlCache = {};

    function buildIconUrls() {
        for (const [domain, iconFile] of Object.entries(FAVICON_MAP)) {
            const iconPath = PathUtils.join(ICONS_DIR, iconFile);
            iconUrlCache[domain] = 'file:///' + iconPath.replace(/\\/g, '/').replace(/ /g, '%20');
        }
    }

    /**
     * Returns the custom icon URL if the hostname matches a pattern, null otherwise.
     * Match logic: hostname === domain || hostname.endsWith('.' + domain)
     */
    function matchDomain(hostname) {
        for (const [domain, iconUrl] of Object.entries(iconUrlCache)) {
            if (hostname === domain || hostname.endsWith('.' + domain)) {
                return iconUrl;
            }
        }
        return null;
    }

    /**
     * Get custom icon URL for a tab's current URL.
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
            identityIcon.style.listStyleImage = `url("${iconUrl}")`;
        } else {
            // Clear override — let Firefox use the real favicon
            identityIcon.style.listStyleImage = '';
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

        buildIconUrls();

        // Tab icon overrides
        gBrowser.tabContainer.addEventListener('TabAttrModified', onTabAttrModified);
        gBrowser.tabContainer.addEventListener('TabSelect', onTabSelect);
        gBrowser.tabContainer.addEventListener('TabOpen', (e) => {
            setTimeout(() => applyToTab(e.target), 200);
            setTimeout(() => applyToTab(e.target), 1000);
        });

        // Urlbar + cross-tab URL change detection
        gBrowser.addTabsProgressListener(progressListener);

        // Apply to all existing tabs + urlbar
        applyToAllTabs();
        applyToUrlbar();

        console.log(`[CustomFavicon] v1.0 initialized — ${Object.keys(FAVICON_MAP).length} sites configured`);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') init();
    else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
