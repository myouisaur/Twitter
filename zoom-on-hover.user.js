// ==UserScript==
// @name         [Twitter] Image Zoom on Hover
// @namespace    https://github.com/myouisaur/Twitter
// @icon         https://twitter.com/favicon.ico
// @version      4.8
// @description  Advanced on-hover image zoom for a smoother browsing experience, with a robust and stylized toggle.
// @author       Xiv
// @match        *://*.twitter.com/*
// @match        *://*.x.com/*
// @noframes
// @grant        GM_addStyle
// @updateURL    https://myouisaur.github.io/Twitter/zoom-on-hover.user.js
// @downloadURL  https://myouisaur.github.io/Twitter/zoom-on-hover.user.js
// ==/UserScript==

(function () {
    'use strict';

    // --- Duplicate Execution Guard ---
    if (window.__tmImageZoomInitialized) return;
    window.__tmImageZoomInitialized = true;

    // --- Configuration ---
    const CONFIG = {
        FALLBACK_COLOR: '#ffffff',
        CSS_VAR: '--tm-img-accent',
        FADE_DURATION_MS: 200,
        HOVER_DELAY_MS: 120,
        HIDE_DELAY_MS: 100,
        STORAGE_KEY: 'tm-img-hover-enabled',
        THEME_STORAGE_KEY: 'tm-img-theme-color',
        TOGGLE_HOTKEY: 'Control',
        Z_INDEX: 99999,
        THEMES: {
            'rgb(29,155,240)': '#1d9bf0', 'rgb(255,212,0)': '#ffd400', 'rgb(249,24,128)': '#f91880',
            'rgb(120,86,255)': '#7856ff', 'rgb(255,122,0)': '#ff7a00', 'rgb(0,186,124)': '#00ba7c'
        },
        CLASSES: {
            BTN: "css-175oi2r r-6koalj r-eqz5dr r-16y2uox r-1habvwh r-cnw61z r-13qz1uu r-1loqt21 r-1ny4l3l",
            FLEX_DIV: "css-175oi2r r-sdzlij r-dnmrzs r-1awozwy r-18u37iz r-1777fci r-q81ovl r-o7ynqc r-6416eg",
            ICON_WRAP: "css-175oi2r",
            SVG: "img-icon r-4qtqp9 r-yyyyoo r-dnmrzs r-bnwqim r-lrvibr r-m6rgpd r-1nao33i r-lwhw9o r-cnnz9e",
            LABEL_DIV: "css-146c3p1 r-dnmrzs r-1udh08x r-1udbk01 r-3s2u2q r-1ttztb7 r-qvutc0 r-1qd0xha r-1b6yd1w r-7ptqe7 r-16dba41 r-1wbh5a2 r-9p5ork r-1tfrt9a r-bcqeeo",
            SPAN: "css-1jxf684 r-bcqeeo r-1ttztb7 r-qvutc0 r-poiln3"
        }
    };

    // --- State ---
    let storedState = localStorage.getItem(CONFIG.STORAGE_KEY);
    let hoverEnabled = storedState === null ? true : (storedState === 'true');
    let currentImgUrl = null;
    let hideTimer = null;
    let scrollEndTimer = null;
    let loadingCleanupTimer = null;
    let currentHoverTarget = null;
    let isDismissedUntilMove = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let cachedThemeColor = localStorage.getItem(CONFIG.THEME_STORAGE_KEY) || null;
    const popupEl = document.createElement('div');

    document.documentElement.style.setProperty(CONFIG.CSS_VAR, cachedThemeColor || CONFIG.FALLBACK_COLOR);

    // --- Utilities ---
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

    // Abstracted helper to prevent repetition
    function resolveMediaTarget(target) {
        if (!target) return null;
        if (target.tagName !== 'IMG' && target.tagName !== 'VIDEO') {
            const container = target.closest('[data-testid="videoComponent"], [data-testid="tweetPhoto"]');
            if (container) return container.querySelector('video, img') || target;
        }
        return target;
    }

    // --- Dynamic Class Extraction ---
    function syncDynamicClasses() {
        const template = document.querySelector('[data-testid="AppTabBar_More_Menu"]') ||
                         document.querySelector('[data-testid="AppTabBar_Explore_Link"]');
        if (!template) return false;

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
            return false;
        }
    }

    // --- Dynamic Theme Extraction ---
    function updateThemeColor() {
        let foundColor = null;
        const bgElements = [
            ...document.querySelectorAll('[data-testid="SideNav_NewTweet_Button"], [data-testid="SideNav_NewTweet_Button"] *'),
            ...document.querySelectorAll('[aria-label*="unread"], [aria-label*="unread"] *')
        ];

        for (const el of bgElements) {
            const bg = window.getComputedStyle(el).backgroundColor.replace(/\s/g, '');
            if (CONFIG.THEMES[bg]) { foundColor = CONFIG.THEMES[bg]; break; }
        }

        if (!foundColor) {
            const navElements = document.querySelectorAll('[role="navigation"] svg');
            for (const el of navElements) {
                const color = window.getComputedStyle(el).color.replace(/\s/g, '');
                if (CONFIG.THEMES[color]) { foundColor = CONFIG.THEMES[color]; break; }
            }
        }

        if (foundColor && foundColor !== cachedThemeColor) {
            cachedThemeColor = foundColor;
            localStorage.setItem(CONFIG.THEME_STORAGE_KEY, foundColor);
            document.documentElement.style.setProperty(CONFIG.CSS_VAR, foundColor);
            updateSidebarToggleUI();
        }
    }
    const debouncedUpdateThemeColor = debounce(updateThemeColor, 200);

    // --- Styles Injection ---
    function injectStyles() {
        GM_addStyle(`
            .tm-img-zoom-toggle-btn .tm-inner-svg { transition: color 0.2s ease; }
            .tm-img-zoom-toggle-btn.tm-active .tm-inner-svg { color: var(${CONFIG.CSS_VAR}); }

            .tm-img-zoom-toggle-btn .tm-switch-container {
                position: relative; width: 7.5rem; height: 2.2rem;
                flex-shrink: 0; cursor: pointer; display: inline-block; vertical-align: middle;
            }
            .tm-img-zoom-toggle-btn .tm-switch-track {
                position: absolute; top: 0; left: 0; right: 0; bottom: 0;
                border-radius: 2rem; background-color: #333; transition: background-color 0.25s ease;
            }
            .tm-img-zoom-toggle-btn.tm-active .tm-switch-track {
                background-color: var(${CONFIG.CSS_VAR});
            }

            .tm-img-zoom-toggle-btn .tm-switch-text {
                position: absolute; top: 50%; transform: translateY(-50%);
                color: #fff; font-family: inherit; font-size: 0.85rem; font-weight: 700;
                pointer-events: none; user-select: none; transition: opacity 0.25s ease; white-space: nowrap;
            }
            .tm-switch-text-on { left: 0.9rem; opacity: 0; }
            .tm-switch-text-off { right: 0.9rem; opacity: 1; }
            .tm-img-zoom-toggle-btn.tm-active .tm-switch-text-on { opacity: 1; }
            .tm-img-zoom-toggle-btn.tm-active .tm-switch-text-off { opacity: 0; }

            .tm-img-zoom-toggle-btn .tm-switch-thumb {
                position: absolute; top: 0.2rem; left: 0.2rem; width: 1.8rem; height: 1.8rem;
                border-radius: 50%; background-color: #fff; box-shadow: 0 2px 5px rgba(0,0,0,0.4);
                transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1); display: grid; place-items: center; z-index: 2;
            }
            .tm-img-zoom-toggle-btn.tm-active .tm-switch-thumb {
                transform: translateX(5.3rem);
            }

            .tm-img-zoom-toggle-btn .tm-switch-icon {
                width: 1.1rem; height: 1.1rem; stroke: #000; stroke-width: 2.5; fill: none; stroke-linecap: round; stroke-linejoin: round;
                transition: stroke 0.18s ease;
            }
            .tm-img-zoom-toggle-btn.tm-active .tm-switch-icon {
                stroke: var(${CONFIG.CSS_VAR});
            }

            .tm-img-zoom-toggle-btn:hover, .tm-img-zoom-toggle-btn:focus { opacity: 0.95; }
            .tm-img-zoom-toggle-btn:focus-visible { outline: 2px solid var(${CONFIG.CSS_VAR}); outline-offset: 4px; }

            #tm-img-popup {
                position: fixed; z-index: ${CONFIG.Z_INDEX}; top: 50%; left: 50%; pointer-events: none;
                border: 3px solid var(${CONFIG.CSS_VAR}); background: #000;
                box-shadow: 0 8px 40px rgba(0,0,0,0.5), 0 2px 10px rgba(0,0,0,0.3); border-radius: 8px; overflow: hidden;
                visibility: hidden; opacity: 0; transform: translate(-50%, -50%) scale(0.96);
                transition: opacity ${CONFIG.FADE_DURATION_MS}ms ease-out, transform ${CONFIG.FADE_DURATION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1);
            }
            #tm-img-popup.tm-visible { visibility: visible; opacity: 1; transform: translate(-50%, -50%) scale(1); }

            .tm-media-wrapper { display: grid; place-items: center; background: #000; position: relative; }
            .tm-thumb-blur, .tm-target-media { grid-area: 1 / 1; max-width: 95vw; max-height: 95vh; }
            .tm-thumb-blur { width: 100%; height: 100%; object-fit: cover; filter: blur(15px) brightness(0.7); transform: scale(1.05); transition: opacity 0.4s ease; z-index: 1; }
            .tm-target-media { object-fit: contain; opacity: 0; transition: opacity 0.3s ease; z-index: 2; }
            .tm-target-media.tm-loaded { opacity: 1; }

            .tm-loading-bar { position: absolute; top: 0; left: 0; width: 100%; height: 4px; background: rgba(0, 0, 0, 0.5); z-index: 10; overflow: hidden; opacity: 1; transition: opacity 0.3s ease; }
            .tm-loading-bar-indicator { position: absolute; top: 0; left: 0; height: 100%; width: 50%; background: linear-gradient(90deg, transparent, #ffffff, transparent); box-shadow: 0 0 10px var(${CONFIG.CSS_VAR}), 0 0 5px var(${CONFIG.CSS_VAR}); animation: tm-sweep 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite; }
            @keyframes tm-sweep { 0% { transform: translateX(-150%); } 100% { transform: translateX(250%); } }

            .tm-fallback-notice { color: #fff; background: #d9534f; padding: 4px 8px; border-radius: 4px; font-size: 0.9em; margin-bottom: 8px; display: inline-block; font-family: sans-serif; position: relative; z-index: 3; margin: 16px; }
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
                if (target.closest('[data-testid="photoViewer"]') || target.closest('[aria-label*="Image"]') || target.style.maxHeight === '100vh') return false;
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
            id: 'tm-img-sidebar-toggle',
            type: 'button',
            className: `${CONFIG.CLASSES.BTN} tm-img-zoom-toggle-btn`,
            role: 'switch',
            'aria-checked': hoverEnabled ? 'true' : 'false',
            'aria-label': 'Image Zoom Toggle'
        });
        if (hoverEnabled) btn.classList.add('tm-active');

        const flexDiv = createElement('div', { className: CONFIG.CLASSES.FLEX_DIV });
        const iconWrap = createElement('div', { className: CONFIG.CLASSES.ICON_WRAP });

        const leftSvg = createSVGElement('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', class: `${CONFIG.CLASSES.SVG} tm-inner-svg` });
        leftSvg.appendChild(createSVGElement('rect', { x: "3", y: "5", width: "18", height: "14", rx: "2.5", stroke: "currentColor", "stroke-width": "2", fill: "none" }));
        leftSvg.appendChild(createSVGElement('circle', { cx: "8.5", cy: "10.5", r: "1.5", fill: "currentColor" }));
        leftSvg.appendChild(createSVGElement('path', { d: "M21 19l-5.5-7-4.5 6-2-2.5L3 19", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", fill: "none" }));
        iconWrap.appendChild(leftSvg);

        const labelDiv = createElement('div', { dir: 'ltr', className: CONFIG.CLASSES.LABEL_DIV });
        const switchContainer = createElement('div', { className: 'tm-switch-container' });
        const track = createElement('div', { className: 'tm-switch-track' });

        const textOn = createElement('span', { className: 'tm-switch-text tm-switch-text-on' }, {}, 'ZOOM ON');
        const textOff = createElement('span', { className: 'tm-switch-text tm-switch-text-off' }, {}, 'ZOOM OFF');

        const thumb = createElement('div', { className: 'tm-switch-thumb' });
        const thumbSvg = createSVGElement('svg', {
            viewBox: '0 0 24 24',
            'aria-hidden': 'true',
            class: 'tm-switch-icon'
        });
        thumbSvg.appendChild(createSVGElement('circle', { cx: '11', cy: '11', r: '8' }));
        thumbSvg.appendChild(createSVGElement('line', { x1: '21', y1: '21', x2: '16.65', y2: '16.65' }));

        track.appendChild(textOn);
        track.appendChild(textOff);
        thumb.appendChild(thumbSvg);
        switchContainer.appendChild(track);
        switchContainer.appendChild(thumb);
        labelDiv.appendChild(switchContainer);
        flexDiv.appendChild(iconWrap);
        flexDiv.appendChild(labelDiv);
        btn.appendChild(flexDiv);

        btn.addEventListener('click', handleToggleClick);
        btn.addEventListener('mouseenter', debouncedUpdateThemeColor);
        return btn;
    }

    function updateSidebarToggleUI() {
        const btn = document.getElementById('tm-img-sidebar-toggle');
        if (!btn) return;

        btn.setAttribute('aria-checked', hoverEnabled ? 'true' : 'false');
        if (hoverEnabled) {
            btn.classList.add('tm-active');
        } else {
            btn.classList.remove('tm-active');
        }
    }

    function handleToggleClick(e) {
        e.preventDefault();
        updateThemeColor();
        hoverEnabled = !hoverEnabled;
        localStorage.setItem(CONFIG.STORAGE_KEY, hoverEnabled);
        updateSidebarToggleUI();

        if (!hoverEnabled) {
            hidePopup();
        } else {
            isDismissedUntilMove = false;
            reevaluateCursorPosition();
        }

        if (e.currentTarget && e.currentTarget.blur) e.currentTarget.blur();
    }

    function ensureSidebarToggle() {
        updateThemeColor();
        const nav = document.querySelector('[role="navigation"]');
        if (!nav) return;

        const existingBtn = document.getElementById('tm-img-sidebar-toggle');
        if (existingBtn) {
            updateSidebarToggleUI();
            return;
        }
        nav.appendChild(buildSidebarToggle());
    }

    // --- Popup Rendering ---
    function setupPopupContainer() {
        popupEl.id = 'tm-img-popup';
        document.body.appendChild(popupEl);
    }

    function showPopup(mediaUrl, fallbackUrl, isVideo) {
        if (popupEl.classList.contains('tm-visible')) {
            popupEl.classList.remove('tm-visible');
            setTimeout(() => renderPopupContent(mediaUrl, fallbackUrl, isVideo), CONFIG.FADE_DURATION_MS);
        } else {
            renderPopupContent(mediaUrl, fallbackUrl, isVideo);
        }
    }

    function renderPopupContent(mediaUrl, fallbackUrl, isVideo) {
        popupEl.replaceChildren();
        if (loadingCleanupTimer) { clearTimeout(loadingCleanupTimer); loadingCleanupTimer = null; }

        const wrapper = createElement('div', { className: 'tm-media-wrapper' });
        let thumb = null;

        const loader = createElement('div', { className: 'tm-loading-bar' });
        const indicator = createElement('div', { className: 'tm-loading-bar-indicator' });
        loader.appendChild(indicator);
        wrapper.appendChild(loader);

        if (fallbackUrl) {
            thumb = createElement('img', { className: 'tm-thumb-blur', src: fallbackUrl });
            wrapper.appendChild(thumb);
        }

        const media = createElement(isVideo ? 'video' : 'img', { className: 'tm-target-media', src: mediaUrl });

        const handleLoad = () => {
            media.classList.add('tm-loaded');

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
            const notice = createElement('span', { className: 'tm-fallback-notice' }, {}, noticeText);
            popupEl.appendChild(notice);

            if (fallbackUrl && media.src !== fallbackUrl) {
                const thumbImg = createElement('img', { className: 'tm-target-media tm-loaded', src: fallbackUrl });
                popupEl.appendChild(thumbImg);
            }
        };

        wrapper.appendChild(media);
        popupEl.appendChild(wrapper);

        void popupEl.offsetWidth;
        popupEl.classList.add('tm-visible');
    }

    function hidePopup() {
        if (loadingCleanupTimer) { clearTimeout(loadingCleanupTimer); loadingCleanupTimer = null; }
        popupEl.classList.remove('tm-visible');
        setTimeout(() => {
            if (!popupEl.classList.contains('tm-visible')) {
                popupEl.replaceChildren();
            }
        }, CONFIG.FADE_DURATION_MS);
        currentImgUrl = null;
    }

    function triggerPopupForImg(target) {
        if (!target || !shouldHandleImg(target)) return;
        if (isDismissedUntilMove && currentHoverTarget === target) return;

        currentHoverTarget = target;

        if (!hoverEnabled) return;

        const fullImgUrl = getFullImageUrl(target);
        if (!fullImgUrl || currentImgUrl === fullImgUrl) return;

        debouncedUpdateThemeColor();
        currentImgUrl = fullImgUrl;
        if (hideTimer) clearTimeout(hideTimer);

        setTimeout(() => {
            if (hoverEnabled && currentHoverTarget === target && !isDismissedUntilMove) {
                showPopup(fullImgUrl, getFallbackUrl(target), target.tagName === 'VIDEO');
            }
        }, CONFIG.HOVER_DELAY_MS);
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
        const target = resolveMediaTarget(e.target);
        if (target && shouldHandleImg(target)) {
            hideTimer = setTimeout(hidePopup, CONFIG.HIDE_DELAY_MS);
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
            hoverEnabled = !hoverEnabled;
            localStorage.setItem(CONFIG.STORAGE_KEY, hoverEnabled);
            updateThemeColor();
            updateSidebarToggleUI();

            if (!hoverEnabled) {
                hidePopup();
            } else {
                isDismissedUntilMove = false;
                reevaluateCursorPosition();
            }
        }
    }

    function handleWheel() {
        if (currentImgUrl || isDismissedUntilMove) {
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
        window.addEventListener('wheel', handleWheel, { passive: true });

        // MutationObserver debounced to prevent thrashing
        const debouncedEnsureSidebar = debounce(() => {
            const nav = document.querySelector('[role="navigation"]');
            if (nav && !document.getElementById('tm-img-sidebar-toggle')) {
                ensureSidebarToggle();
            }
        }, 150);

        const observer = new MutationObserver(debouncedEnsureSidebar);
        observer.observe(document.body, { childList: true, subtree: true });

        window.addEventListener('popstate', ensureSidebarToggle);
        document.body.addEventListener('click', () => setTimeout(ensureSidebarToggle, 250), true);
    }

    // --- Initialization ---
    function init() {
        injectStyles();
        setupPopupContainer();
        attachEventListeners();
        updateThemeColor();
    }

    init();

})();
