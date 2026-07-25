// ==UserScript==
// @name         [Twitter] Image Zoom on Hover
// @namespace    https://github.com/myouisaur/Twitter
// @icon         https://twitter.com/favicon.ico
// @version      5.6
// @description  Automatically enlarges images and videos on hover for a seamless browsing experience.
// @author       Xiv
// @match        *://*.twitter.com/*
// @match        *://*.x.com/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// @noframes
// @updateURL    https://myouisaur.github.io/Twitter/zoom-on-hover.user.js
// @downloadURL  https://myouisaur.github.io/Twitter/zoom-on-hover.user.js
// ==/UserScript==

(function () {
    'use strict';

    // --- Duplicate Execution Guard ---
    if (window.__xivImageZoomInitialized) return;
    window.__xivImageZoomInitialized = true;

    // --- Configuration ---
    const CONFIG = {
        // Feature Flags
        DEBUG: false,

        // Storage Keys
        STORAGE_KEY: 'xiv_settings',

        // Selectors
        SELECTORS: {
            REACT_ROOT: '#react-root',
            NAV: '[role="navigation"]',
            MORE_MENU: '[data-testid="AppTabBar_More_Menu"]',
            EXPLORE_LINK: '[data-testid="AppTabBar_Explore_Link"]',
            NEW_TWEET_BTN: '[data-testid="SideNav_NewTweet_Button"]',
            UNREAD_BADGE: '[aria-label*="unread"]',
            VIDEO_COMP: '[data-testid="videoComponent"]',
            PHOTO_COMP: '[data-testid="tweetPhoto"]',
            PHOTO_VIEWER: '[data-testid="photoViewer"]'
        },

        // CSS Classes (Dynamically Synced, Defaults Provided)
        CLASSES: {
            BTN: "css-175oi2r r-6koalj r-eqz5dr r-16y2uox r-1habvwh r-cnw61z r-13qz1uu r-1loqt21 r-1ny4l3l",
            FLEX_DIV: "css-175oi2r r-sdzlij r-dnmrzs r-1awozwy r-18u37iz r-1777fci r-q81ovl r-o7ynqc r-6416eg",
            ICON_WRAP: "css-175oi2r",
            SVG: "img-icon r-4qtqp9 r-yyyyoo r-dnmrzs r-bnwqim r-lrvibr r-m6rgpd r-1nao33i r-lwhw9o r-cnnz9e",
            LABEL_DIV: "css-146c3p1 r-dnmrzs r-1udh08x r-1udbk01 r-3s2u2q r-1ttztb7 r-qvutc0 r-1qd0xha r-1b6yd1w r-7ptqe7 r-16dba41 r-1wbh5a2 r-9p5ork r-1tfrt9a r-bcqeeo",
            SPAN: "css-1jxf684 r-bcqeeo r-1ttztb7 r-qvutc0 r-poiln3"
        },

        // Styling
        STYLE: {
            FALLBACK_COLOR: '#ffffff',
            CSS_VAR: '--xiv-img-accent',
            Z_INDEX: 99999,
            THEMES: {
                'rgb(29,155,240)': '#1d9bf0', 'rgb(255,212,0)': '#ffd400', 'rgb(249,24,128)': '#f91880',
                'rgb(120,86,255)': '#7856ff', 'rgb(255,122,0)': '#ff7a00', 'rgb(0,186,124)': '#00ba7c'
            }
        },

        // Timing Defaults
        TIMING: {
            FADE_DURATION_MS: 250,
            DEFAULT_HOVER_DELAY: 120,
            DEFAULT_HIDE_DELAY: 100
        },

        // Keyboard
        TOGGLE_HOTKEY: 'Control'
    };

    // --- State Management ---
    const defaultSettings = {
        enabled: true,
        themeColor: null,
        hoverDelay: CONFIG.TIMING.DEFAULT_HOVER_DELAY,
        hideDelay: CONFIG.TIMING.DEFAULT_HIDE_DELAY
    };

    let settings = { ...defaultSettings };
    try {
        const stored = GM_getValue(CONFIG.STORAGE_KEY);
        if (stored && typeof stored === 'object') {
            settings = { ...settings, ...stored };
        }
    } catch (e) {
        log('Failed to parse stored settings, using defaults.', e);
    }

    function saveSettings() {
        try {
            GM_setValue(CONFIG.STORAGE_KEY, settings);
        } catch (e) {
            log('Failed to save settings.', e);
        }
    }

    let currentImgUrl = null;
    let showTimer = null;
    let hideTimer = null;
    let scrollEndTimer = null;
    let loadingCleanupTimer = null;
    let currentHoverTarget = null;
    let isDismissedUntilMove = false;
    let scrollListenersAttached = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    const popupEl = document.createElement('div');

    document.documentElement.style.setProperty(CONFIG.STYLE.CSS_VAR, settings.themeColor || CONFIG.STYLE.FALLBACK_COLOR);

    // --- Utilities ---
    function log(msg, ...args) {
        if (CONFIG.DEBUG) {
            console.log(`[Twitter Image Zoom][UI] ${msg}`, ...args);
        }
    }

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    function createElement(tag, attrs = {}, styles = {}, text = null) {
        const el = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) {
            if (key === 'className') el.className = value;
            else el.setAttribute(key, value);
        }
        for (const [key, value] of Object.entries(styles)) {
            el.style[key] = value;
        }
        if (text !== null) el.textContent = text;
        return el;
    }

    function createSVGElement(tag, attrs = {}) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [key, value] of Object.entries(attrs)) {
            el.setAttribute(key, value);
        }
        return el;
    }

    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    function resolveMediaTarget(target) {
        if (!target) return null;
        if (target.tagName !== 'IMG' && target.tagName !== 'VIDEO') {
            const container = target.closest(`${CONFIG.SELECTORS.VIDEO_COMP}, ${CONFIG.SELECTORS.PHOTO_COMP}`);
            if (container) return container.querySelector('video, img') || target;
        }
        return target;
    }

    // --- Dynamic Class Extraction ---
    function syncDynamicClasses() {
        const template = document.querySelector(CONFIG.SELECTORS.MORE_MENU) ||
                         document.querySelector(CONFIG.SELECTORS.EXPLORE_LINK);
        if (!template) {
            log('Could not find template element to sync dynamic classes.');
            return false;
        }

        try {
            CONFIG.CLASSES.BTN = template.className;

            const flexDiv = template.firstElementChild;
            if (flexDiv) {
                CONFIG.CLASSES.FLEX_DIV = flexDiv.className;
                const iconWrap = flexDiv.firstElementChild;
                if (iconWrap) CONFIG.CLASSES.ICON_WRAP = iconWrap.className;
            }

            const labelDiv = template.querySelector('div[dir="ltr"]');
            if (labelDiv) CONFIG.CLASSES.LABEL_DIV = labelDiv.className;

            const span = template.querySelector('span');
            if (span) CONFIG.CLASSES.SPAN = span.className;

            return true;
        } catch (e) {
            log('syncDynamicClasses failed during extraction:', e);
            return false;
        }
    }

    // --- Dynamic Theme Extraction ---
    function updateThemeColor() {
        let foundColor = null;
        const bgElements = [
            ...document.querySelectorAll(`${CONFIG.SELECTORS.NEW_TWEET_BTN}, ${CONFIG.SELECTORS.NEW_TWEET_BTN} *`),
            ...document.querySelectorAll(`${CONFIG.SELECTORS.UNREAD_BADGE}, ${CONFIG.SELECTORS.UNREAD_BADGE} *`)
        ];

        for (const el of bgElements) {
            const bg = window.getComputedStyle(el).backgroundColor.replace(/\s/g, '');
            if (CONFIG.STYLE.THEMES[bg]) { foundColor = CONFIG.STYLE.THEMES[bg]; break; }
        }

        if (!foundColor) {
            const navElements = document.querySelectorAll(`${CONFIG.SELECTORS.NAV} svg`);
            for (const el of navElements) {
                const color = window.getComputedStyle(el).color.replace(/\s/g, '');
                if (CONFIG.STYLE.THEMES[color]) { foundColor = CONFIG.STYLE.THEMES[color]; break; }
            }
        }

        if (foundColor && foundColor !== settings.themeColor) {
            settings.themeColor = foundColor;
            saveSettings();
            document.documentElement.style.setProperty(CONFIG.STYLE.CSS_VAR, foundColor);
            const btn = document.getElementById('xiv-img-sidebar-toggle');
            if (btn && settings.enabled) btn.classList.add('xiv-active');
        }
    }
    const debouncedUpdateThemeColor = debounce(updateThemeColor, 200);

    // --- Styles Injection ---
    function injectStyles() {
        GM_addStyle(`
            .xiv-img-zoom-toggle-btn .xiv-inner-svg { transition: color 0.2s ease; }
            .xiv-img-zoom-toggle-btn.xiv-active .xiv-inner-svg { color: var(${CONFIG.STYLE.CSS_VAR}); }

            /* --- Mask Architecture --- */
            .xiv-img-zoom-toggle-btn .xiv-switch-mask {
                position: relative;
                width: 8.0rem; /* Compact resting state */
                height: 2.2rem;
                flex-shrink: 0;
                cursor: pointer;
                display: inline-block;
                vertical-align: middle;
                border-radius: 2rem;
                overflow: hidden;
                background-color: #333;
                /* Synced timing with inner container */
                transition: width 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            }

            .xiv-switch-mask.xiv-anim-elongated {
                width: 10.4rem; /* Expanded transition state */
            }

            .xiv-switch-mask.xiv-state-on {
                width: 8.0rem; /* Returns to compact */
            }

            /* --- Inner Translating Container --- */
            .xiv-img-zoom-toggle-btn .xiv-switch-container {
                position: absolute;
                top: 0;
                left: 0;
                width: 10.4rem;
                height: 2.2rem;
                /* Synced timing with mask width */
                transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                transform: translateX(0); /* Anchor left */
            }

            .xiv-switch-mask.xiv-state-on .xiv-switch-container {
                /* Pulls the 10.4 container left by 2.4 inside an 8.0 mask */
                /* Visually pins the right edge of the inner container to the mask's right edge */
                transform: translateX(-2.4rem);
            }

            .xiv-switch-mask.xiv-anim-elongated .xiv-switch-container {
                transform: translateX(0);
            }

            /* --- Wipe Tracks --- */
            .xiv-track-base, .xiv-track-overlay {
                position: absolute; top: 0; left: 0; right: 0; bottom: 0;
                display: flex; align-items: center;
            }
            .xiv-track-base {
                background-color: #333; z-index: 0;
            }
            .xiv-track-overlay {
                background-color: var(${CONFIG.STYLE.CSS_VAR}); z-index: 1;
                clip-path: inset(0 100% 0 0);
                transition: clip-path 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
            }
            .xiv-img-zoom-toggle-btn.xiv-active .xiv-track-overlay {
                clip-path: inset(0 0 0 0);
            }

            /* --- Dynamic Text Positioning --- */
            .xiv-switch-text {
                position: absolute; left: 3.2rem; /* The shared central anchor point for the transition */
                color: #fff; font-family: inherit; font-size: 0.85rem; font-weight: 700; letter-spacing: 0.05em;
                pointer-events: none; user-select: none; white-space: nowrap;
                transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                transform: translateX(0); /* Aligned during elongation */
            }

            /* Resting OFF: Slide left deeper to account for 'ZOOM OFF' width */
            .xiv-img-zoom-toggle-btn:not(.xiv-active) .xiv-switch-mask:not(.xiv-anim-elongated) .xiv-text-off {
                transform: translateX(-0.75rem);
            }

            /* Resting ON: Slide right into the free space */
            .xiv-img-zoom-toggle-btn.xiv-active .xiv-switch-mask:not(.xiv-anim-elongated) .xiv-text-on {
                transform: translateX(0.4rem);
            }

            /* --- Thumb Elements --- */
            .xiv-img-zoom-toggle-btn .xiv-switch-thumb {
                position: absolute; top: 0.2rem; left: 0.2rem; width: 1.8rem; height: 1.8rem;
                border-radius: 50%; background-color: #fff; box-shadow: 0 0.125rem 0.3125rem rgba(0,0,0,0.4);
                transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1); display: grid; place-items: center; z-index: 2;
            }
            .xiv-img-zoom-toggle-btn.xiv-active .xiv-switch-thumb {
                transform: translateX(8.4rem); /* 10.4 - 1.8 - 0.2 */
            }

            .xiv-img-zoom-toggle-btn .xiv-switch-icon {
                width: 1.1rem; height: 1.1rem; stroke: #333; stroke-width: 2.5; fill: none; stroke-linecap: round; stroke-linejoin: round;
                transition: stroke 0.25s ease;
            }
            .xiv-img-zoom-toggle-btn.xiv-active .xiv-switch-icon {
                stroke: var(${CONFIG.STYLE.CSS_VAR});
            }

            .xiv-icon-plus {
                transition: opacity 0.25s ease, transform 0.25s ease;
                transform-origin: center;
            }
            .xiv-img-zoom-toggle-btn:not(.xiv-active) .xiv-icon-plus {
                opacity: 0; transform: scale(0) rotate(-90deg);
            }

            .xiv-img-zoom-toggle-btn:hover, .xiv-img-zoom-toggle-btn:focus { opacity: 0.95; }
            .xiv-img-zoom-toggle-btn:focus-visible { outline: 0.125rem solid var(${CONFIG.STYLE.CSS_VAR}); outline-offset: 0.25rem; }

            /* --- Popup Overlays --- */
            #xiv-img-popup {
                position: fixed; z-index: ${CONFIG.STYLE.Z_INDEX}; top: 50%; left: 50%; pointer-events: none;
                border: 0.1875rem solid var(${CONFIG.STYLE.CSS_VAR}); background: #000;
                box-shadow: 0 0.5rem 2.5rem rgba(0,0,0,0.5), 0 0.125rem 0.625rem rgba(0,0,0,0.3); border-radius: 0.5rem; overflow: hidden;
                visibility: hidden; opacity: 0; transform: translate(-50%, -50%) scale(0.94);
                transition: opacity ${CONFIG.TIMING.FADE_DURATION_MS}ms ease-out, transform ${CONFIG.TIMING.FADE_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), visibility 0s linear ${CONFIG.TIMING.FADE_DURATION_MS}ms;
            }

            #xiv-img-popup.xiv-visible {
                visibility: visible; opacity: 1; transform: translate(-50%, -50%) scale(1);
                transition: opacity ${CONFIG.TIMING.FADE_DURATION_MS}ms ease-out, transform ${CONFIG.TIMING.FADE_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), visibility 0s linear 0s;
            }

            .xiv-media-wrapper { display: grid; place-items: center; background: #000; position: relative; }
            .xiv-thumb-blur, .xiv-target-media { grid-area: 1 / 1; max-width: 95vw; max-height: 95vh; }
            .xiv-thumb-blur { width: 100%; height: 100%; object-fit: cover; filter: blur(1rem) brightness(0.7); transform: scale(1.05); transition: opacity 0.4s ease; z-index: 1; }

            .xiv-target-media { object-fit: contain; opacity: 0; transform: scale(0.98); transition: opacity 0.3s ease, transform 0.4s cubic-bezier(0.22, 1, 0.36, 1); z-index: 2; }
            .xiv-target-media.xiv-loaded { opacity: 1; transform: scale(1); }

            .xiv-loading-bar {
                position: absolute; top: 0; left: 0; width: 100%; height: 0.375rem;
                background: rgba(0, 0, 0, 0.6); z-index: 10; opacity: 1;
                transition: opacity 0.4s ease; overflow: hidden;
            }
            .xiv-loading-bar-indicator {
                position: absolute; top: 0; left: -50%; height: 100%; width: 50%;
                background: linear-gradient(90deg, transparent, var(${CONFIG.STYLE.CSS_VAR}) 40%, #ffffff 50%, var(${CONFIG.STYLE.CSS_VAR}) 60%, transparent);
                box-shadow: 0 0 0.875rem var(${CONFIG.STYLE.CSS_VAR}), 0 0 0.25rem #ffffff;
                animation: xiv-sweep 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
            }
            @keyframes xiv-sweep { 0% { left: -50%; } 100% { left: 100%; } }

            .xiv-fallback-notice { color: #fff; background: #d9534f; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.9rem; margin-bottom: 0.5rem; display: inline-block; font-family: sans-serif; position: relative; z-index: 3; margin: 1rem; }
        `);
    }

    // --- Core Logic: Image URL parsing ---
    function shouldHandleImg(target) {
        if (!target) return false;

        if (target.tagName === 'IMG') {
            let src = target.src || '';
            if (target.srcset) {
                const firstSrcset = target.srcset.split(',')[0].trim().split(' ')[0];
                if (firstSrcset) src = firstSrcset;
            }
            if (!/twimg\.com\/media\//.test(src)) return false;
            if (target.closest('[aria-label="Profile"]') || target.closest('svg')) return false;
            if (/\/status\/\d+\/photo\/\d+/.test(location.pathname)) {
                if (target.closest(CONFIG.SELECTORS.PHOTO_VIEWER) || target.closest('[aria-label*="Image"]') || target.style.maxHeight === '100vh') return false;
            }
            return true;
        }

        if (target.tagName === 'VIDEO') {
            const src = target.src || (target.querySelector('source') && target.querySelector('source').src) || '';
            if (/tweet_video/.test(src) || /twimg\.com.*\.mp4/.test(src)) return true;
        }
        return false;
    }

    function getFullImageUrl(target) {
        if (target.tagName === 'VIDEO') {
            return target.src || (target.querySelector('source') && target.querySelector('source').src) || null;
        }
        function cleanImageUrl(url) {
            let basePart = url.split('?')[0];
            const formatMatch = url.match(/format=([a-zA-Z0-9]+)/);
            if (formatMatch) {
                basePart = basePart.replace(/\.[a-zA-Z0-9]+$/, '');
                basePart = `${basePart}.${formatMatch[1]}`;
            }
            return `${basePart}?name=orig`;
        }
        if (target.srcset) {
            let candidates = target.srcset.split(',').map(s => s.trim().split(' '));
            let biggest = candidates
                .map(([url, size]) => ({ url, size: parseInt((size || '0').replace('x', '')) }))
                .sort((a, b) => b.size - a.size)[0];
            if (biggest && biggest.url) return cleanImageUrl(biggest.url);
        }
        if (target.src && /twimg\.com\/media\//.test(target.src)) return cleanImageUrl(target.src);
        return null;
    }

    function getFallbackUrl(target) {
        if (target.tagName === 'VIDEO') return target.poster || '';
        return target.src || '';
    }

    // --- UI Generation ---
    function buildSidebarToggle() {
        syncDynamicClasses();

        const btn = createElement('button', {
            id: 'xiv-img-sidebar-toggle',
            type: 'button',
            className: `${CONFIG.CLASSES.BTN} xiv-img-zoom-toggle-btn`,
            role: 'switch',
            'aria-checked': settings.enabled ? 'true' : 'false',
            'aria-label': 'Image Zoom Toggle',
            'data-animating': 'false'
        });
        if (settings.enabled) btn.classList.add('xiv-active');

        const flexDiv = createElement('div', { className: CONFIG.CLASSES.FLEX_DIV });
        const iconWrap = createElement('div', { className: CONFIG.CLASSES.ICON_WRAP });

        const leftSvg = createSVGElement('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', class: `${CONFIG.CLASSES.SVG} xiv-inner-svg` });
        leftSvg.appendChild(createSVGElement('rect', { x: "3", y: "5", width: "18", height: "14", rx: "2.5", stroke: "currentColor", "stroke-width": "2", fill: "none" }));
        leftSvg.appendChild(createSVGElement('circle', { cx: "8.5", cy: "10.5", r: "1.5", fill: "currentColor" }));
        leftSvg.appendChild(createSVGElement('path', { d: "M21 19l-5.5-7-4.5 6-2-2.5L3 19", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", fill: "none" }));
        iconWrap.appendChild(leftSvg);

        const labelDiv = createElement('div', { dir: 'ltr', className: CONFIG.CLASSES.LABEL_DIV });

        const mask = createElement('div', { className: 'xiv-switch-mask' });
        if (settings.enabled) mask.classList.add('xiv-state-on');

        const switchContainer = createElement('div', { className: 'xiv-switch-container' });

        const trackBase = createElement('div', { className: 'xiv-track-base' });
        const textOff = createElement('span', { className: 'xiv-switch-text xiv-text-off' }, {}, 'ZOOM OFF');
        trackBase.appendChild(textOff);

        const trackOverlay = createElement('div', { className: 'xiv-track-overlay' });
        const textOn = createElement('span', { className: 'xiv-switch-text xiv-text-on' }, {}, 'ZOOM ON');
        trackOverlay.appendChild(textOn);

        const thumb = createElement('div', { className: 'xiv-switch-thumb' });
        const thumbSvg = createSVGElement('svg', {
            viewBox: '0 0 24 24',
            'aria-hidden': 'true',
            class: 'xiv-switch-icon'
        });
        thumbSvg.appendChild(createSVGElement('circle', { cx: '10', cy: '10', r: '7' }));
        thumbSvg.appendChild(createSVGElement('line', { x1: '21', y1: '21', x2: '15', y2: '15' }));
        thumbSvg.appendChild(createSVGElement('line', { x1: '7', y1: '10', x2: '13', y2: '10', class: 'xiv-icon-minus' }));
        thumbSvg.appendChild(createSVGElement('line', { x1: '10', y1: '7', x2: '10', y2: '13', class: 'xiv-icon-plus' }));
        thumb.appendChild(thumbSvg);

        switchContainer.appendChild(trackBase);
        switchContainer.appendChild(trackOverlay);
        switchContainer.appendChild(thumb);
        mask.appendChild(switchContainer);
        labelDiv.appendChild(mask);
        flexDiv.appendChild(iconWrap);
        flexDiv.appendChild(labelDiv);
        btn.appendChild(flexDiv);

        btn.addEventListener('click', handleToggleSequence);
        btn.addEventListener('mouseenter', debouncedUpdateThemeColor);
        return btn;
    }

    async function handleToggleSequence(e) {
        if (e && e.preventDefault) e.preventDefault();

        const btn = document.getElementById('xiv-img-sidebar-toggle');
        if (!btn || btn.dataset.animating === 'true') return;

        btn.dataset.animating = 'true';
        updateThemeColor();

        const mask = btn.querySelector('.xiv-switch-mask');
        const willEnable = !settings.enabled;

        if (willEnable) {
            // Stage 1: Elongate
            mask.classList.add('xiv-anim-elongated');
            await sleep(200);

            // Stage 2: Wipe
            settings.enabled = true;
            btn.classList.add('xiv-active');
            btn.setAttribute('aria-checked', 'true');
            saveSettings();
            await sleep(250);

            // Stage 3: Shorten (Left side pulls in)
            mask.classList.remove('xiv-anim-elongated');
            mask.classList.add('xiv-state-on');
        } else {
            // Stage 1: Elongate (Left side pushes out)
            mask.classList.remove('xiv-state-on');
            mask.classList.add('xiv-anim-elongated');
            await sleep(200);

            // Stage 2: Wipe
            settings.enabled = false;
            btn.classList.remove('xiv-active');
            btn.setAttribute('aria-checked', 'false');
            saveSettings();
            await sleep(250);

            // Stage 3: Shorten
            mask.classList.remove('xiv-anim-elongated');
        }

        await sleep(200); // Allow final mask transition to complete
        btn.dataset.animating = 'false';

        if (!settings.enabled) {
            hidePopup();
        } else {
            isDismissedUntilMove = false;
            reevaluateCursorPosition();
        }

        if (e && e.currentTarget && e.currentTarget.blur) e.currentTarget.blur();
    }

    function ensureSidebarToggle() {
        updateThemeColor();
        const nav = document.querySelector(CONFIG.SELECTORS.NAV);
        if (!nav) return;

        const existingBtn = document.getElementById('xiv-img-sidebar-toggle');
        if (existingBtn) return;
        nav.appendChild(buildSidebarToggle());
    }

    // --- Popup Rendering ---
    function setupPopupContainer() {
        popupEl.id = 'xiv-img-popup';
        document.body.appendChild(popupEl);
    }

    function showPopup(mediaUrl, fallbackUrl, isVideo) {
        manageScrollListeners(true);
        if (popupEl.classList.contains('xiv-visible')) {
            popupEl.classList.remove('xiv-visible');
            setTimeout(() => renderPopupContent(mediaUrl, fallbackUrl, isVideo), CONFIG.TIMING.FADE_DURATION_MS);
        } else {
            renderPopupContent(mediaUrl, fallbackUrl, isVideo);
        }
    }

    function renderPopupContent(mediaUrl, fallbackUrl, isVideo) {
        popupEl.replaceChildren();
        if (loadingCleanupTimer) { clearTimeout(loadingCleanupTimer); loadingCleanupTimer = null; }

        const wrapper = createElement('div', { className: 'xiv-media-wrapper' });
        let thumb = null;

        const loader = createElement('div', { className: 'xiv-loading-bar' });
        const indicator = createElement('div', { className: 'xiv-loading-bar-indicator' });
        loader.appendChild(indicator);
        wrapper.appendChild(loader);

        if (fallbackUrl) {
            thumb = createElement('img', { className: 'xiv-thumb-blur', src: fallbackUrl });
            wrapper.appendChild(thumb);
        }

        const media = createElement(isVideo ? 'video' : 'img', { className: 'xiv-target-media', src: mediaUrl });

        const handleLoad = () => {
            media.classList.add('xiv-loaded');

            loader.style.opacity = '0';
            if (thumb) thumb.style.opacity = '0';

            loadingCleanupTimer = setTimeout(() => {
                if (loader.parentNode) loader.parentNode.removeChild(loader);
                if (thumb && thumb.parentNode) thumb.parentNode.removeChild(thumb);
            }, 400);
        };

        if (isVideo) {
            media.autoplay = true;
            media.loop = true;
            media.muted = true;
            media.onloadeddata = handleLoad;
        } else {
            media.onload = handleLoad;
        }

        media.onerror = () => {
            wrapper.replaceChildren();
            const noticeText = (fallbackUrl && media.src !== fallbackUrl) ? 'Full size unavailable, showing thumbnail' : 'Media unavailable';
            const notice = createElement('span', { className: 'xiv-fallback-notice' }, {}, noticeText);
            popupEl.appendChild(notice);

            if (fallbackUrl && media.src !== fallbackUrl) {
                const thumbImg = createElement('img', { className: 'xiv-target-media xiv-loaded', src: fallbackUrl });
                popupEl.appendChild(thumbImg);
            }
        };

        wrapper.appendChild(media);
        popupEl.appendChild(wrapper);

        void popupEl.offsetWidth;
        popupEl.classList.add('xiv-visible');
    }

    function hidePopup() {
        if (showTimer) { clearTimeout(showTimer); showTimer = null; }
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        if (loadingCleanupTimer) { clearTimeout(loadingCleanupTimer); loadingCleanupTimer = null; }

        popupEl.classList.remove('xiv-visible');

        setTimeout(() => {
            if (!popupEl.classList.contains('xiv-visible')) {
                popupEl.replaceChildren();
            }
        }, CONFIG.TIMING.FADE_DURATION_MS + 20);

        currentImgUrl = null;
        manageScrollListeners(false);
    }

    function triggerPopupForImg(target) {
        if (!target || !shouldHandleImg(target)) return;
        if (isDismissedUntilMove && currentHoverTarget === target) return;

        currentHoverTarget = target;

        if (!settings.enabled) return;

        const fullImgUrl = getFullImageUrl(target);
        if (!fullImgUrl || currentImgUrl === fullImgUrl) return;

        debouncedUpdateThemeColor();
        currentImgUrl = fullImgUrl;

        if (hideTimer) clearTimeout(hideTimer);
        if (showTimer) clearTimeout(showTimer);

        manageScrollListeners(true);

        showTimer = setTimeout(() => {
            if (settings.enabled && currentHoverTarget === target && !isDismissedUntilMove) {
                showPopup(fullImgUrl, getFallbackUrl(target), target.tagName === 'VIDEO');
            }
        }, settings.hoverDelay);
    }

    // --- Contextual Target Resolution ---
    function reevaluateCursorPosition() {
        let target = document.elementFromPoint(lastMouseX, lastMouseY);
        target = resolveMediaTarget(target);

        if (target && shouldHandleImg(target)) {
            triggerPopupForImg(target);
        } else {
            currentHoverTarget = null;
        }
    }

    // --- Dynamic Listeners Management ---
    function manageScrollListeners(attach) {
        if (attach && !scrollListenersAttached) {
            window.addEventListener('scroll', handleScroll, { passive: true, capture: true });
            window.addEventListener('wheel', handleScroll, { passive: true, capture: true });
            scrollListenersAttached = true;
        } else if (!attach && scrollListenersAttached) {
            window.removeEventListener('scroll', handleScroll, { capture: true });
            window.removeEventListener('wheel', handleScroll, { capture: true });
            scrollListenersAttached = false;
        }
    }

    // --- Standalone Event Handlers ---
    function handleMouseMove(e) {
        if (Math.abs(e.clientX - lastMouseX) > 2 || Math.abs(e.clientY - lastMouseY) > 2) {
            if (isDismissedUntilMove) {
                isDismissedUntilMove = false;
                reevaluateCursorPosition();
            }
        }
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    }

    function handleMouseOver(e) {
        const target = resolveMediaTarget(e.target);
        triggerPopupForImg(target);
    }

    function handleMouseOut(e) {
        if (showTimer) { clearTimeout(showTimer); showTimer = null; }

        const target = resolveMediaTarget(e.target);
        if (target && shouldHandleImg(target)) {
            hideTimer = setTimeout(hidePopup, settings.hideDelay);
        }
    }

    function handleKeyDown(e) {
        if (e.key === 'Escape' && currentImgUrl) {
            isDismissedUntilMove = true;
            hidePopup();
        }
    }

    function handleKeyUp(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

        if (e.key === CONFIG.TOGGLE_HOTKEY && !e.repeat && !e.altKey && !e.shiftKey && !e.metaKey) {
            handleToggleSequence(); // Route through the async lock sequencer
        }
    }

    function handleScroll() {
        if (currentImgUrl || isDismissedUntilMove || showTimer) {
            isDismissedUntilMove = true;
            hidePopup();
        }

        clearTimeout(scrollEndTimer);
        scrollEndTimer = setTimeout(() => {
            isDismissedUntilMove = false;
            reevaluateCursorPosition();
        }, 150);
    }

    // --- Event Attachments ---
    function attachEventListeners() {
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseover', handleMouseOver, true);
        document.addEventListener('mouseout', handleMouseOut);

        window.addEventListener('mousedown', hidePopup, true);
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        const debouncedEnsureSidebar = debounce(() => {
            const nav = document.querySelector(CONFIG.SELECTORS.NAV);
            if (nav && !document.getElementById('xiv-img-sidebar-toggle')) {
                ensureSidebarToggle();
            }
        }, 150);

        const observer = new MutationObserver(debouncedEnsureSidebar);
        const reactRoot = document.querySelector(CONFIG.SELECTORS.REACT_ROOT) || document.body;
        observer.observe(reactRoot, { childList: true, subtree: true });

        window.addEventListener('popstate', ensureSidebarToggle);
        document.body.addEventListener('click', () => setTimeout(ensureSidebarToggle, 250), true);
    }

    // --- Initialization ---
    function init() {
        injectStyles();
        setupPopupContainer();
        attachEventListeners();
        updateThemeColor();
        log('Initialized successfully.');
    }

    init();

})();
