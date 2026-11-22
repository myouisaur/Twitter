// ==UserScript==
// @name         [Twitter] Image Zoom on Hover
// @namespace    https://github.com/myouisaur/Twitter
// @icon         https://twitter.com/favicon.ico
// @version      6.7
// @description  Automatically enlarges images and videos on hover for a seamless browsing experience.
// @author       Xiv
// @match        *://*.twitter.com/*
// @match        *://*.x.com/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @run-at       document-end
// @noframes
// @updateURL    https://myouisaur.github.io/Twitter/zoom-on-hover.user.js
// @downloadURL  https://myouisaur.github.io/Twitter/zoom-on-hover.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ---------------------------------------------------------------
    // CONFIG
    // ---------------------------------------------------------------
    const CONFIG = {
        // Feature Flags
        DEBUG: false,
        PAUSE_ZOOM_FOR_PLAYING_VIDEO: true, // a video that already started playing is left alone; only a still poster is zoomed
        HONOR_REDUCED_MOTION: false,        // true makes the script's motion follow the system "reduce motion" setting (the zoom and switch then jump instead of slide)

        // Identity
        LOG_PREFIX: '[Twitter Image Zoom]',
        INIT_FLAG: 'xivImageZoomInitialized',

        // Storage Keys
        STORAGE_KEY: 'xiv_settings',

        // Element IDs
        IDS: {
            POPUP: 'xiv-img-popup',
            TOGGLE: 'xiv-img-sidebar-toggle'
        },

        // Selectors (each list is tried in order, so a site change only breaks the first entry)
        SELECTORS: {
            NAV: ['nav[aria-label="Primary"]', '[role="navigation"][aria-label="Primary"]', 'header nav'],
            // A native sidebar item whose look the toggle copies
            NAV_TEMPLATE: ['button[aria-label="More menu items"]', '[data-slot="xds-menu-trigger"]', 'a[href="/explore"]'],
            PHOTO_LINK: 'a[href*="/photo/"]',
            // X's transparent "Play" / "View media" buttons sit in a sibling of the <video>, not on it
            VIDEO_CONTROL_HOST: '[data-slot="xds-context-menu-trigger"]',
            VIEWER_DIALOG: '[role="dialog"], [aria-modal="true"]',
            VIEWER_IMAGE: '[aria-label*="Image"]',
            NOT_MEDIA: '[aria-label="Profile"], svg',
            // Buttons from the other Xiv scripts that float over media; hovering them dismisses the zoom
            OWN_CONTROLS: '.xiv-btn-container'
        },

        // URL Patterns
        PATTERNS: {
            PHOTO_SRC: /twimg\.com\/media\//,
            THUMB_SRC: /twimg\.com\/(?:amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb)\//,
            PLAYABLE_VIDEO_SRC: /tweet_video|twimg\.com.*\.mp4/,
            PHOTO_ROUTE: /\/status\/\d+\/photo\/\d+/
        },

        // Image URL rules
        URLS: {
            PHOTO_NAME: null,            // photos load fine without a size name; set 'large' or 'orig' only if that changes
            PHOTO_FALLBACK_NAME: 'large',
            THUMB_NAME: 'orig',          // video/GIF thumbnails still honour orig
            THUMB_FORMAT: 'jpg',
            THUMB_FALLBACK_NAME: 'large'
        },

        // CSS Classes
        CLASSES: {
            ZOOM_CURSOR: 'xiv-zoom-cursor',
            TOGGLE_BTN: 'xiv-img-zoom-toggle-btn',
            ACTIVE: 'xiv-active',
            WIPED: 'xiv-anim-wiped',
            ELONGATED: 'xiv-anim-elongated',
            STATE_ON: 'xiv-state-on',
            MASK: 'xiv-switch-mask',
            CONTAINER: 'xiv-switch-container',
            TRACK_BASE: 'xiv-track-base',
            TRACK_OVERLAY: 'xiv-track-overlay',
            TEXT: 'xiv-switch-text',
            TEXT_OFF: 'xiv-text-off',
            TEXT_ON: 'xiv-text-on',
            THUMB: 'xiv-switch-thumb',
            THUMB_ICON: 'xiv-switch-icon',
            ICON_PLUS: 'xiv-icon-plus',
            ICON_MINUS: 'xiv-icon-minus',
            ICON_SLASH: 'xiv-icon-slash',
            CSS_SWEEP: 'xiv-css-sweep',
            LABEL_SLOT: 'xiv-label-slot',
            INNER_SVG: 'xiv-inner-svg',
            POPUP_VISIBLE: 'xiv-visible',
            MEDIA_WRAPPER: 'xiv-media-wrapper',
            THUMB_BLUR: 'xiv-thumb-blur',
            TARGET_MEDIA: 'xiv-target-media',
            LOADED: 'xiv-loaded',
            LOADING_BAR: 'xiv-loading-bar',
            LOADING_INDICATOR: 'xiv-loading-bar-indicator',
            FALLBACK_NOTICE: 'xiv-fallback-notice'
        },

        // Styling
        STYLE: {
            FALLBACK_COLOR: '#ffffff',
            CSS_VAR: '--xiv-img-accent',
            ON_ACCENT_VAR: '--xiv-img-on-accent',  // readable text color drawn on top of the accent
            Z_INDEX: 99999,
            // The loading line is half the bar wide: -100% parks it off the left edge, 200% off the right
            SWEEP_FRAMES: [{ transform: 'translateX(-100%)' }, { transform: 'translateX(200%)' }],
            SWEEP_EASING: 'cubic-bezier(0.4, 0, 0.2, 1)',
            // Where X's brand color can be read from, in order
            BRAND_PROBES: [
                { className: 'bg-btn-brand', property: 'backgroundColor' },
                { className: 'text-brand', property: 'color' }
            ]
        },

        // Timing
        TIMING: {
            FADE_DURATION_MS: 250,
            DEFAULT_HOVER_DELAY: 120,
            DEFAULT_HIDE_DELAY: 100,
            SCROLL_END_MS: 150,
            LOADING_CLEANUP_MS: 400,
            THEME_CHECK_MIN_MS: 3000,
            THEME_DEBOUNCE_MS: 200,
            NAV_CHECK_DELAY_MS: 100,     // pause between a sidebar change and the check that follows it
            STAGE_ELONGATE_MS: 125,
            STAGE_WIPE_MS: 150,
            STAGE_SETTLE_MS: 125,
            LOADING_SWEEP_MS: 1200
        },

        // Limits
        LIMITS: {
            DELAY_MIN_MS: 0,
            DELAY_MAX_MS: 2000,
            SIDEBAR_WAIT_MAX_MS: 60000,  // how long to wait for X to draw its sidebar before pausing the search
            WATCH_MAX_DEPTH: 40,         // how many levels above the menu are watched for being swapped out
            MOUSE_MOVE_THRESHOLD_PX: 2,
            VIDEO_SEARCH_DEPTH: 1,       // how far above X's play buttons to look for their <video>
            STILL_POSTER_MAX_SECONDS: 0.1,
            ANIMATION_MAX_PASSES: 10
        },

        // Labels
        LABELS: {
            TOGGLE_ARIA: 'Image Zoom Toggle',
            TEXT_ON: 'ZOOM ON',
            TEXT_OFF: 'ZOOM OFF',
            NOTICE_THUMB: 'Full size unavailable, showing thumbnail',
            NOTICE_NONE: 'Media unavailable'
        },

        // Keyboard
        TOGGLE_HOTKEY: 'Control'
    };

    // Duplicate-execution guard (also covers iFrames as a fallback to @noframes)
    if (window.top !== window.self || window[CONFIG.INIT_FLAG]) return;
    window[CONFIG.INIT_FLAG] = true;

    const S = CONFIG.SELECTORS;
    const P = CONFIG.PATTERNS;
    const C = CONFIG.CLASSES;
    const T = CONFIG.TIMING;
    const L = CONFIG.LIMITS;

    // ---------------------------------------------------------------
    // UTILITIES & LOGGING
    // ---------------------------------------------------------------
    const Logger = {
        log: (module, ...args) => CONFIG.DEBUG && console.log(`${CONFIG.LOG_PREFIX}[${module}]`, ...args),
        warn: (module, ...args) => console.warn(`${CONFIG.LOG_PREFIX}[${module}]`, ...args)
    };

    const Utils = {
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),

        debounce(fn, wait) {
            let timeout;
            return function (...args) {
                clearTimeout(timeout);
                timeout = setTimeout(() => fn.apply(this, args), wait);
            };
        },

        clampNumber(value, min, max, fallback) {
            return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
        },

        findFirst(selectors, root = document) {
            for (const selector of selectors) {
                const found = root.querySelector(selector);
                if (found) return found;
            }
            return null;
        },

        prefersReducedMotion() {
            return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        },

        unique(list) {
            return [...new Set(list.filter(Boolean))];
        },

        createElement(tag, attrs = {}, text = null) {
            const el = document.createElement(tag);
            for (const [key, value] of Object.entries(attrs)) {
                if (key === 'className') el.className = value;
                else el.setAttribute(key, value);
            }
            if (text !== null) el.textContent = text;
            return el;
        },

        createSVGElement(tag, attrs = {}) {
            const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
            for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
            return el;
        },

        // Returns the address with the given query parameters set (null removes one), or null if unreadable
        withParams(url, params) {
            try {
                const parsed = new URL(url, window.location.href);
                for (const [key, value] of Object.entries(params)) {
                    if (value === null) parsed.searchParams.delete(key);
                    else parsed.searchParams.set(key, value);
                }
                return parsed.toString();
            } catch (error) {
                Logger.warn('Utils', 'Could not read an image address:', url, error);
                return null;
            }
        },

        // Wraps an event handler so one unexpected error never stops the rest of the script
        guarded(module, fn) {
            return function (...args) {
                try {
                    return fn.apply(this, args);
                } catch (error) {
                    Logger.warn(module, 'Something unexpected happened, so this action was skipped. Details:', error);
                    return undefined;
                }
            };
        }
    };

    // ---------------------------------------------------------------
    // SETTINGS (saved with GM storage, validated on every load)
    // ---------------------------------------------------------------
    const Settings = {
        defaults: {
            enabled: true,
            themeColor: null,
            hoverDelay: T.DEFAULT_HOVER_DELAY,
            hideDelay: T.DEFAULT_HIDE_DELAY
        },

        isValidColor(value) {
            if (typeof value !== 'string' || !value.trim()) return false;
            return typeof CSS === 'undefined' || typeof CSS.supports !== 'function' || CSS.supports('color', value);
        },

        validate(raw) {
            const result = { ...this.defaults };
            if (!raw || typeof raw !== 'object') return result;
            if (typeof raw.enabled === 'boolean') result.enabled = raw.enabled;
            if (this.isValidColor(raw.themeColor)) result.themeColor = raw.themeColor;
            result.hoverDelay = Utils.clampNumber(raw.hoverDelay, L.DELAY_MIN_MS, L.DELAY_MAX_MS, this.defaults.hoverDelay);
            result.hideDelay = Utils.clampNumber(raw.hideDelay, L.DELAY_MIN_MS, L.DELAY_MAX_MS, this.defaults.hideDelay);
            return result;
        },

        load() {
            try {
                return this.validate(GM_getValue(CONFIG.STORAGE_KEY));
            } catch (error) {
                Logger.warn('Settings', 'Saved settings could not be read, so the defaults are used.', error);
                return { ...this.defaults };
            }
        },

        save() {
            try {
                GM_setValue(CONFIG.STORAGE_KEY, settings);
            } catch (error) {
                Logger.warn('Settings', 'Your settings could not be saved.', error);
            }
        }
    };

    const settings = Settings.load();

    // Shared runtime state
    const State = {
        currentKey: null,          // address of the media currently shown or pending
        currentTarget: null,       // media element under the cursor
        dismissedUntilMove: false,
        zooming: false,
        lastX: 0,
        lastY: 0,
        hotkeyChorded: false       // true when Ctrl was used together with another key or the mouse
    };

    // ---------------------------------------------------------------
    // THEME (accent color follows X's own brand color)
    // ---------------------------------------------------------------
    const Theme = {
        lastCheck: 0,
        ctx: null,

        // Converts any CSS color (rgb, hex, oklch...) to {r, g, b}; null when transparent or unreadable
        toRgb(color) {
            try {
                if (!this.ctx) this.ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
                this.ctx.clearRect(0, 0, 1, 1);
                this.ctx.fillStyle = '#000';
                this.ctx.fillStyle = color;
                this.ctx.fillRect(0, 0, 1, 1);
                const [r, g, b, a] = this.ctx.getImageData(0, 0, 1, 1).data;
                return a ? { r, g, b } : null;
            } catch (error) {
                const match = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(color);
                return match ? { r: +match[1], g: +match[2], b: +match[3] } : null;
            }
        },

        readableOn(color) {
            const rgb = this.toRgb(color);
            if (!rgb) return '#fff';
            const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
            return luminance > 0.6 ? '#000' : '#fff';
        },

        apply(color) {
            const root = document.documentElement;
            root.style.setProperty(CONFIG.STYLE.CSS_VAR, color);
            root.style.setProperty(CONFIG.STYLE.ON_ACCENT_VAR, this.readableOn(color));
        },

        // X paints its brand color through utility classes, so a hidden probe wearing the class reveals it
        readBrandColor() {
            for (const { className, property } of CONFIG.STYLE.BRAND_PROBES) {
                const probe = Utils.createElement('span', { className, 'aria-hidden': 'true' });
                probe.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden;pointer-events:none;';
                document.body.appendChild(probe);
                const color = window.getComputedStyle(probe)[property];
                probe.remove();
                if (Settings.isValidColor(color) && this.toRgb(color)) return color;
            }
            return null;
        },

        refresh(force = false) {
            const now = Date.now();
            if (!force && now - this.lastCheck < T.THEME_CHECK_MIN_MS) return;
            this.lastCheck = now;

            const found = this.readBrandColor();
            if (!found || found === settings.themeColor) return;
            settings.themeColor = found;
            Settings.save();
            this.apply(found);
        }
    };
    Theme.refreshDebounced = Utils.debounce(() => Theme.refresh(), T.THEME_DEBOUNCE_MS);

    // ---------------------------------------------------------------
    // STYLES
    // ---------------------------------------------------------------
    let stylesInjected = false;

    function injectStyles() {
        if (stylesInjected) return;
        stylesInjected = true;

        const V = CONFIG.STYLE;
        const fade = T.FADE_DURATION_MS;
        const tb = `.${C.TOGGLE_BTN}`;
        const popup = `#${CONFIG.IDS.POPUP}`;
        // X can ship a site-wide "reduce motion" rule that forces every animation off, which freezes the loading line
        // and makes the switch jump. Marking our own motion !important beats it for our elements only (our selectors
        // are more specific than its `*`). With HONOR_REDUCED_MOTION on, we stand down and let the system decide.
        const imp = CONFIG.HONOR_REDUCED_MOTION ? '' : ' !important';

        GM_addStyle(`
            /* --- Cursor feedback (not while a zoom is showing) --- */
            html:not([data-xiv-zooming="true"]) .${C.ZOOM_CURSOR} { cursor: zoom-in !important; }

            /* --- Sidebar toggle: sizes shared by every animation stage --- */
            ${tb} {
                --xiv-bar-w: 8rem;
                --xiv-bar-wide: 9.4rem;
                --xiv-bar-h: 1.75rem;
                --xiv-thumb: 1.4rem;
                --xiv-inset: 0.175rem;
                --xiv-ease: cubic-bezier(0.4, 0, 0.2, 1);
            }

            /* Icon: accent when on, slashed when off so state never relies on color alone */
            ${tb} .${C.INNER_SVG} { transition: color 0.15s ease${imp}; }
            ${tb}.${C.ACTIVE} .${C.INNER_SVG} { color: var(${V.CSS_VAR}); }
            ${tb} .${C.ICON_SLASH} { transition: opacity 0.15s ease${imp}; }
            ${tb}.${C.ACTIVE} .${C.ICON_SLASH} { opacity: 0; }

            /* X clips its label slot; the bar briefly stretches past it while animating, so let it show */
            ${tb} .${C.LABEL_SLOT} { overflow: visible !important; }

            /* --- Mask: the visible window of the bar --- */
            ${tb} .${C.MASK} {
                position: relative;
                display: inline-block;
                flex-shrink: 0;
                width: var(--xiv-bar-w);
                height: var(--xiv-bar-h);
                vertical-align: middle;
                border-radius: 2rem;
                overflow: hidden;
                cursor: pointer;
                background-color: #333;
                transition: width 0.15s var(--xiv-ease)${imp};
            }
            ${tb} .${C.MASK}.${C.ELONGATED} { width: var(--xiv-bar-wide); }

            /* --- Inner container slides inside the mask --- */
            ${tb} .${C.CONTAINER} {
                position: absolute;
                top: 0;
                left: 0;
                width: var(--xiv-bar-wide);
                height: 100%;
                transform: translateX(0);
                transition: transform 0.15s var(--xiv-ease)${imp};
            }
            /* Pins the container's right edge to the mask's right edge */
            ${tb} .${C.MASK}.${C.STATE_ON} .${C.CONTAINER} { transform: translateX(calc(var(--xiv-bar-w) - var(--xiv-bar-wide))); }
            ${tb} .${C.MASK}.${C.ELONGATED} .${C.CONTAINER} { transform: translateX(0); }

            /* --- Wipe tracks --- */
            ${tb} .${C.TRACK_BASE}, ${tb} .${C.TRACK_OVERLAY} {
                position: absolute;
                inset: 0;
                display: flex;
                align-items: center;
            }
            ${tb} .${C.TRACK_BASE} { z-index: 0; background-color: #333; }
            ${tb} .${C.TRACK_OVERLAY} {
                z-index: 1;
                background-color: var(${V.CSS_VAR});
                clip-path: inset(0 100% 0 0);
                transition: clip-path 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)${imp};
            }
            ${tb}.${C.WIPED} .${C.TRACK_OVERLAY} { clip-path: inset(0 0 0 0); }

            /* --- Labels --- */
            ${tb} .${C.TEXT} {
                position: absolute;
                left: 2.8rem; /* shared anchor for every stage */
                color: #fff;
                font-family: inherit;
                font-size: 0.85rem;
                font-weight: 700;
                line-height: 1;
                letter-spacing: 0.05em;
                white-space: nowrap;
                pointer-events: none;
                user-select: none;
                transform: translateX(0);
                transition: transform 0.15s var(--xiv-ease)${imp};
            }
            ${tb} .${C.TRACK_OVERLAY} .${C.TEXT} { color: var(${V.ON_ACCENT_VAR}, #fff); }
            ${tb}:not(.${C.WIPED}) .${C.MASK}:not(.${C.ELONGATED}) .${C.TEXT_OFF} { transform: translateX(-0.75rem); }
            ${tb}.${C.WIPED} .${C.MASK}:not(.${C.ELONGATED}) .${C.TEXT_ON} { transform: translateX(calc(var(--xiv-bar-wide) - var(--xiv-bar-w) - 1.6rem)); }

            /* --- Thumb --- */
            ${tb} .${C.THUMB} {
                position: absolute;
                z-index: 2;
                top: var(--xiv-inset);
                left: var(--xiv-inset);
                display: grid;
                place-items: center;
                width: var(--xiv-thumb);
                height: var(--xiv-thumb);
                border-radius: 50%;
                background-color: #fff;
                box-shadow: 0 0.125rem 0.3125rem rgba(0, 0, 0, 0.4);
                transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)${imp};
            }
            ${tb}.${C.WIPED} .${C.THUMB} {
                transform: translateX(calc(var(--xiv-bar-wide) - var(--xiv-thumb) - 2 * var(--xiv-inset)));
            }
            ${tb} .${C.THUMB_ICON} {
                width: 0.95rem;
                height: 0.95rem;
                fill: none;
                stroke: #333;
                stroke-width: 2.5;
                stroke-linecap: round;
                stroke-linejoin: round;
                transition: stroke 0.2s ease${imp};
            }
            ${tb}.${C.WIPED} .${C.THUMB_ICON} { stroke: var(${V.CSS_VAR}); }
            ${tb} .${C.ICON_PLUS} { transform-origin: center; transition: opacity 0.2s ease, transform 0.2s ease${imp}; }
            ${tb}:not(.${C.WIPED}) .${C.ICON_PLUS} { opacity: 0; transform: scale(0) rotate(-90deg); }

            ${CONFIG.HONOR_REDUCED_MOTION ? `@media (prefers-reduced-motion: reduce) {
                ${tb}, ${tb} *, ${popup}, ${popup} * { transition-duration: 0.01ms !important; }
            }` : ''}

            /* --- Popup --- */
            ${popup} {
                position: fixed;
                z-index: ${V.Z_INDEX};
                top: 50%;
                left: 50%;
                overflow: hidden;
                border: 0.1875rem solid var(${V.CSS_VAR});
                border-radius: 0.5rem;
                background: #000;
                box-shadow: 0 0.5rem 2.5rem rgba(0, 0, 0, 0.5), 0 0.125rem 0.625rem rgba(0, 0, 0, 0.3);
                pointer-events: none;
                visibility: hidden;
                opacity: 0;
                transform: translate(-50%, -50%) scale(0.94);
                transition: opacity ${fade}ms ease-out, transform ${fade}ms cubic-bezier(0.22, 1, 0.36, 1), visibility 0s linear ${fade}ms${imp};
            }
            ${popup}.${C.POPUP_VISIBLE} {
                visibility: visible;
                opacity: 1;
                transform: translate(-50%, -50%) scale(1);
                transition: opacity ${fade}ms ease-out, transform ${fade}ms cubic-bezier(0.22, 1, 0.36, 1), visibility 0s linear 0s${imp};
            }

            ${popup} .${C.MEDIA_WRAPPER} { position: relative; display: grid; place-items: center; background: #000; }
            ${popup} .${C.THUMB_BLUR}, ${popup} .${C.TARGET_MEDIA} { grid-area: 1 / 1; max-width: 95vw; max-height: 95vh; }
            ${popup} .${C.THUMB_BLUR} {
                z-index: 1;
                width: 100%;
                height: 100%;
                object-fit: cover;
                filter: blur(1rem) brightness(0.7);
                transform: scale(1.05);
                transition: opacity 0.4s ease${imp};
            }
            ${popup} .${C.TARGET_MEDIA} {
                z-index: 2;
                object-fit: contain;
                opacity: 0;
                transform: scale(0.98);
                transition: opacity 0.3s ease, transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)${imp};
            }
            ${popup} .${C.TARGET_MEDIA}.${C.LOADED} { opacity: 1; transform: scale(1); }

            ${popup} .${C.LOADING_BAR} {
                position: absolute;
                z-index: 10;
                top: 0;
                left: 0;
                width: 100%;
                height: 0.375rem;
                overflow: hidden;
                background: rgba(0, 0, 0, 0.6);
                opacity: 1;
                transition: opacity 0.4s ease${imp};
            }
            ${popup} .${C.LOADING_INDICATOR} {
                position: absolute;
                top: 0;
                left: 0;
                width: 50%;
                height: 100%;
                transform: translateX(-100%);
                background: linear-gradient(90deg, transparent, var(${V.CSS_VAR}) 40%, #ffffff 50%, var(${V.CSS_VAR}) 60%, transparent);
                box-shadow: 0 0 0.875rem var(${V.CSS_VAR}), 0 0 0.25rem #ffffff;
            }
            /* Only used when the browser lacks the Web Animations API; otherwise JavaScript drives the sweep */
            ${popup} .${C.LOADING_INDICATOR}.${C.CSS_SWEEP} { animation: xiv-sweep ${T.LOADING_SWEEP_MS}ms ${V.SWEEP_EASING} infinite${imp}; }
            @keyframes xiv-sweep { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }

            ${popup} .${C.FALLBACK_NOTICE} {
                position: relative;
                z-index: 3;
                display: inline-block;
                margin: 1rem;
                padding: 0.25rem 0.5rem;
                border-radius: 0.25rem;
                background: #d9534f;
                color: #fff;
                font-family: sans-serif;
                font-size: 0.9rem;
            }
        `);
    }

    // ---------------------------------------------------------------
    // MEDIA (what is hoverable, and which addresses to try)
    // ---------------------------------------------------------------
    const Media = {
        // The element under the cursor is often an overlay; map it to the picture or video it covers
        resolve(target) {
            if (!target || target.nodeType !== 1) return null;
            if (target.closest(S.OWN_CONTROLS)) return null;
            if (target.tagName === 'IMG' || target.tagName === 'VIDEO') return target;

            const host = target.closest(S.VIDEO_CONTROL_HOST);
            const video = host && this.findVideoNear(host);
            if (video) return video;

            const link = target.closest(S.PHOTO_LINK);
            return (link && link.querySelector('img')) || target;
        },

        findVideoNear(host) {
            let node = host.parentElement;
            for (let depth = 0; node && depth < L.VIDEO_SEARCH_DEPTH; depth++) {
                const video = node.querySelector('video');
                if (video) return video;
                node = node.parentElement;
            }
            return null;
        },

        // 'photo' | 'thumb' | 'video' | 'poster', or null when the element should not zoom
        classify(el) {
            if (!el || el.nodeType !== 1) return null;
            if (el.tagName === 'IMG') return this.classifyImage(el);
            if (el.tagName === 'VIDEO') return this.classifyVideo(el);
            return null;
        },

        classifyImage(img) {
            const src = img.currentSrc || img.src || '';
            let kind = null;
            if (P.PHOTO_SRC.test(src)) kind = 'photo';
            else if (P.THUMB_SRC.test(src)) kind = 'thumb';

            if (!kind || img.closest(S.NOT_MEDIA) || this.isInsideViewer(img)) return null;
            return kind;
        },

        classifyVideo(video) {
            const src = video.currentSrc || video.src || '';
            if (P.PLAYABLE_VIDEO_SRC.test(src)) return 'video';

            // Regular videos stream through blob: addresses that cannot be reused, so only the still poster zooms
            if (!P.THUMB_SRC.test(video.poster || '')) return null;
            if (CONFIG.PAUSE_ZOOM_FOR_PLAYING_VIDEO && !this.isStill(video)) return null;
            return 'poster';
        },

        isStill(video) {
            return video.paused && video.currentTime < L.STILL_POSTER_MAX_SECONDS;
        },

        // Pictures inside X's own photo viewer already show full size
        isInsideViewer(el) {
            if (!P.PHOTO_ROUTE.test(window.location.pathname)) return false;
            return Boolean(el.closest(S.VIEWER_DIALOG) || el.closest(S.VIEWER_IMAGE) || el.style.maxHeight === '100vh');
        },

        // Candidate addresses, best first; the popup moves down the list if one fails to load
        buildRequest(el, kind) {
            const U = CONFIG.URLS;

            if (kind === 'video') {
                const src = el.currentSrc || el.src;
                return src ? { urls: [src], placeholder: el.poster || '', isVideo: true } : null;
            }

            const displayed = kind === 'poster' ? el.poster : (el.currentSrc || el.src);
            if (!displayed) return null;

            const urls = kind === 'photo'
                ? [
                    Utils.withParams(displayed, { name: U.PHOTO_NAME }),
                    Utils.withParams(displayed, { name: U.PHOTO_FALLBACK_NAME }),
                    displayed
                ]
                : [
                    Utils.withParams(displayed, { format: U.THUMB_FORMAT, name: U.THUMB_NAME }),
                    Utils.withParams(displayed, { name: U.THUMB_FALLBACK_NAME }),
                    displayed
                ];

            const unique = Utils.unique(urls);
            return unique.length ? { urls: unique, placeholder: displayed, isVideo: false } : null;
        }
    };

    // ---------------------------------------------------------------
    // POPUP
    // ---------------------------------------------------------------
    const Popup = {
        el: document.createElement('div'),
        renderTimer: null,
        cleanupTimer: null,
        loadingTimer: null,
        rafId: null,
        sweep: null,          // running loading-line animation

        setup() {
            this.el.id = CONFIG.IDS.POPUP;
            document.body.appendChild(this.el);
        },

        setZooming(value) {
            State.zooming = value;
            document.documentElement.dataset.xivZooming = String(value);
        },

        isVisible() {
            return this.el.classList.contains(C.POPUP_VISIBLE);
        },

        // CSS rules on X's side cannot override an animation started from script, so the line keeps moving
        startSweep(indicator) {
            this.stopSweep();
            if (CONFIG.HONOR_REDUCED_MOTION && Utils.prefersReducedMotion()) {
                indicator.style.transform = 'translateX(50%)'; // a still line mid-bar still says "loading"
                return;
            }
            if (typeof indicator.animate !== 'function') {
                indicator.classList.add(C.CSS_SWEEP);
                return;
            }
            this.sweep = indicator.animate(CONFIG.STYLE.SWEEP_FRAMES, {
                duration: T.LOADING_SWEEP_MS,
                easing: CONFIG.STYLE.SWEEP_EASING,
                iterations: Infinity
            });
        },

        stopSweep() {
            if (this.sweep) this.sweep.cancel();
            this.sweep = null;
        },

        clearTimers() {
            clearTimeout(this.renderTimer);
            clearTimeout(this.cleanupTimer);
            clearTimeout(this.loadingTimer);
            this.renderTimer = this.cleanupTimer = this.loadingTimer = null;
            if (this.rafId !== null) cancelAnimationFrame(this.rafId);
            this.rafId = null;
        },

        show(request) {
            if (!this.el.isConnected) document.body.appendChild(this.el);
            this.setZooming(true);
            Hover.setScrollListeners(true);
            this.clearTimers();

            if (!this.isVisible()) {
                this.render(request);
                return;
            }
            // Fade the current zoom out before swapping in the next one
            this.el.classList.remove(C.POPUP_VISIBLE);
            this.renderTimer = setTimeout(() => this.render(request), T.FADE_DURATION_MS);
        },

        render(request) {
            this.renderTimer = null;
            this.el.replaceChildren();

            const wrapper = Utils.createElement('div', { className: C.MEDIA_WRAPPER });
            const loader = Utils.createElement('div', { className: C.LOADING_BAR });
            const indicator = Utils.createElement('div', { className: C.LOADING_INDICATOR });
            loader.appendChild(indicator);
            wrapper.appendChild(loader);

            let blur = null;
            if (request.placeholder) {
                blur = Utils.createElement('img', { className: C.THUMB_BLUR, src: request.placeholder });
                wrapper.appendChild(blur);
            }

            const media = this.createMedia(request, wrapper, loader, blur);
            wrapper.appendChild(media);
            this.el.appendChild(wrapper);
            this.startSweep(indicator);
            media.src = request.urls[0];

            // Two frames so the browser paints the hidden state before the fade-in starts
            this.rafId = requestAnimationFrame(() => {
                this.rafId = requestAnimationFrame(() => {
                    this.rafId = null;
                    this.el.classList.add(C.POPUP_VISIBLE);
                });
            });
        },

        createMedia(request, wrapper, loader, blur) {
            const media = Utils.createElement(request.isVideo ? 'video' : 'img', { className: C.TARGET_MEDIA });
            let attempt = 0;

            const handleLoad = () => {
                media.classList.add(C.LOADED);
                loader.style.opacity = '0';
                if (blur) blur.style.opacity = '0';
                this.loadingTimer = setTimeout(() => {
                    this.stopSweep();
                    loader.remove();
                    if (blur) blur.remove();
                }, T.LOADING_CLEANUP_MS);
            };

            if (request.isVideo) {
                media.autoplay = true;
                media.loop = true;
                media.muted = true;
                media.playsInline = true;
                media.onloadeddata = handleLoad;
            } else {
                media.onload = handleLoad;
            }

            media.onerror = () => {
                attempt++;
                if (attempt < request.urls.length) {
                    media.src = request.urls[attempt];
                    return;
                }
                this.showFailure(request);
            };
            return media;
        },

        showFailure(request) {
            // The placeholder is only worth showing when it was not already one of the failed attempts
            const canShowThumb = request.placeholder && !request.urls.includes(request.placeholder);
            const noticeText = canShowThumb ? CONFIG.LABELS.NOTICE_THUMB : CONFIG.LABELS.NOTICE_NONE;
            this.stopSweep();
            this.el.replaceChildren(Utils.createElement('span', { className: C.FALLBACK_NOTICE }, noticeText));

            if (!canShowThumb) return;
            this.el.appendChild(Utils.createElement('img', {
                className: `${C.TARGET_MEDIA} ${C.LOADED}`,
                src: request.placeholder
            }));
        },

        hide() {
            this.setZooming(false);
            Hover.cancelPending();
            this.clearTimers();
            this.el.classList.remove(C.POPUP_VISIBLE);

            this.cleanupTimer = setTimeout(() => {
                this.cleanupTimer = null;
                if (this.isVisible()) return;
                this.stopSweep();
                this.el.replaceChildren();
            }, T.FADE_DURATION_MS + 20);

            State.currentKey = null;
            Hover.setScrollListeners(false);
        }
    };

    // ---------------------------------------------------------------
    // HOVER (events that decide when to show or hide the zoom)
    // ---------------------------------------------------------------
    const Hover = {
        showTimer: null,
        hideTimer: null,
        scrollEndTimer: null,
        scrollAttached: false,
        cursorEl: null,

        cancelShow() {
            clearTimeout(this.showTimer);
            this.showTimer = null;
        },

        cancelHide() {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        },

        cancelPending() {
            this.cancelShow();
            this.cancelHide();
        },

        markCursor(el) {
            if (this.cursorEl && this.cursorEl !== el) this.cursorEl.classList.remove(C.ZOOM_CURSOR);
            el.classList.add(C.ZOOM_CURSOR);
            this.cursorEl = el;
        },

        clearCursor() {
            if (this.cursorEl) this.cursorEl.classList.remove(C.ZOOM_CURSOR);
            this.cursorEl = null;
        },

        trigger(el, kind) {
            if (!el || !kind) return;
            this.cancelHide();
            if (State.dismissedUntilMove && State.currentTarget === el) return;

            State.currentTarget = el;
            if (!settings.enabled) return;

            const request = Media.buildRequest(el, kind);
            if (!request) return;

            const key = request.urls[0];
            // A dead timer with no visible zoom is allowed to recover, even for the same address
            if (State.currentKey === key && (this.showTimer || State.zooming)) return;

            Theme.refreshDebounced();
            State.currentKey = key;
            this.cancelShow();
            this.setScrollListeners(true);

            this.showTimer = setTimeout(() => {
                this.showTimer = null;
                const stillWanted = settings.enabled && State.currentTarget === el && !State.dismissedUntilMove;
                if (stillWanted) Popup.show(request);
            }, settings.hoverDelay);
        },

        // Re-checks what is under the cursor after a scroll, toggle or dismissal
        reevaluate() {
            const hit = document.elementFromPoint(State.lastX, State.lastY);
            const el = Media.resolve(hit);
            const kind = Media.classify(el);

            if (State.currentTarget && State.currentTarget !== el) this.clearCursor();
            if (!kind) {
                State.currentTarget = null;
                return;
            }
            this.markCursor(hit);
            this.trigger(el, kind);
        },

        setScrollListeners(attach) {
            if (attach === this.scrollAttached) return;
            const method = attach ? 'addEventListener' : 'removeEventListener';
            window[method]('scroll', this.onScroll, { passive: true, capture: true });
            window[method]('wheel', this.onScroll, { passive: true, capture: true });
            this.scrollAttached = attach;
        },

        onScroll: Utils.guarded('Hover', function () {
            if (State.currentKey || State.dismissedUntilMove || Hover.showTimer) {
                State.dismissedUntilMove = true;
                Popup.hide();
            }
            clearTimeout(Hover.scrollEndTimer);
            Hover.scrollEndTimer = setTimeout(() => {
                State.dismissedUntilMove = false;
                Hover.reevaluate();
            }, T.SCROLL_END_MS);
        }),

        onMouseMove: Utils.guarded('Hover', function (event) {
            const moved = Math.abs(event.clientX - State.lastX) > L.MOUSE_MOVE_THRESHOLD_PX ||
                          Math.abs(event.clientY - State.lastY) > L.MOUSE_MOVE_THRESHOLD_PX;

            if (moved && State.dismissedUntilMove) {
                State.dismissedUntilMove = false;
                Hover.reevaluate();
            } else if (moved && settings.enabled && !Hover.showTimer && !State.zooming) {
                // Self-healing: X re-renders and invisible overlays can swallow mouseover
                const el = Media.resolve(event.target);
                const kind = Media.classify(el);
                if (kind) {
                    Hover.markCursor(event.target);
                    Hover.trigger(el, kind);
                }
            }
            State.lastX = event.clientX;
            State.lastY = event.clientY;
        }),

        onMouseOver: Utils.guarded('Hover', function (event) {
            const el = Media.resolve(event.target);
            const kind = Media.classify(el);
            if (!kind) return;
            Hover.markCursor(event.target);
            Hover.trigger(el, kind);
        }),

        onMouseOut: Utils.guarded('Hover', function (event) {
            Hover.cancelShow();
            if (event.target === Hover.cursorEl) Hover.clearCursor();

            const el = Media.resolve(event.target);
            if (!Media.classify(el)) return;

            // Moving between parts of the same picture or video is not leaving it
            if (el === Media.resolve(event.relatedTarget)) return;

            Hover.cancelHide();
            Hover.hideTimer = setTimeout(() => Popup.hide(), settings.hideDelay);
        })
    };

    // ---------------------------------------------------------------
    // KEYBOARD
    // ---------------------------------------------------------------
    const Keyboard = {
        onKeyDown: Utils.guarded('Keyboard', function (event) {
            if (event.key === 'Escape' && State.currentKey) {
                State.dismissedUntilMove = true;
                Popup.hide();
                return;
            }
            if (event.key === CONFIG.TOGGLE_HOTKEY) {
                if (!event.repeat) State.hotkeyChorded = false;
            } else {
                State.hotkeyChorded = true;
            }
        }),

        // Ctrl used with a click or the mouse wheel (browser zoom) must not count as a lone tap
        onChordedPointer: Utils.guarded('Keyboard', function (event) {
            if (event.ctrlKey) State.hotkeyChorded = true;
        }),

        onKeyUp: Utils.guarded('Keyboard', function (event) {
            const target = event.target;
            const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
            if (typing || event.key !== CONFIG.TOGGLE_HOTKEY) return;
            if (event.repeat || event.altKey || event.shiftKey || event.metaKey || State.hotkeyChorded) return;
            toggleEnabled();
        })
    };

    // ---------------------------------------------------------------
    // ENABLE / DISABLE
    // ---------------------------------------------------------------
    function setEnabled(value, { persist = true } = {}) {
        if (settings.enabled === value) return;
        settings.enabled = value;
        document.documentElement.dataset.xivEnabled = String(value);
        if (persist) Settings.save();

        SidebarToggle.reflectState();
        if (value) {
            State.dismissedUntilMove = false;
            Hover.reevaluate();
        } else {
            Popup.hide();
        }
    }

    function toggleEnabled() {
        Theme.refresh(true);
        setEnabled(!settings.enabled);
    }

    // ---------------------------------------------------------------
    // SIDEBAR TOGGLE (copies a native sidebar item so it matches X's own look)
    // ---------------------------------------------------------------
    const SidebarToggle = {
        button: null,
        observer: null,       // narrow watcher on the menu once the toggle is in
        waiter: null,         // page-wide watcher, only alive while the sidebar has not appeared yet
        waitTimer: null,
        checkTimer: null,
        watchedParent: null,  // the menu's parent when the watchers were last set up
        lastReason: '',
        warned: false,
        animating: false,

        createIcon() {
            const svg = Utils.createSVGElement('svg', {
                viewBox: '0 0 24 24',
                fill: 'none',
                width: '1em',
                height: '1em',
                display: 'flex',
                role: 'img',
                'aria-hidden': 'true',
                class: C.INNER_SVG
            });
            const stroke = { stroke: 'currentColor', 'stroke-width': '2', fill: 'none' };
            svg.appendChild(Utils.createSVGElement('rect', { x: '3', y: '5', width: '18', height: '14', rx: '2.5', ...stroke }));
            svg.appendChild(Utils.createSVGElement('circle', { cx: '8.5', cy: '10.5', r: '1.5', fill: 'currentColor' }));
            svg.appendChild(Utils.createSVGElement('path', {
                d: 'M21 19l-5.5-7-4.5 6-2-2.5L3 19', ...stroke, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
            }));
            svg.appendChild(Utils.createSVGElement('line', {
                x1: '3', y1: '21', x2: '21', y2: '3', ...stroke, 'stroke-linecap': 'round', class: C.ICON_SLASH
            }));
            return svg;
        },

        createBar() {
            const mask = Utils.createElement('div', { className: C.MASK });
            const container = Utils.createElement('div', { className: C.CONTAINER });

            const base = Utils.createElement('div', { className: C.TRACK_BASE });
            base.appendChild(Utils.createElement('span', { className: `${C.TEXT} ${C.TEXT_OFF}` }, CONFIG.LABELS.TEXT_OFF));

            const overlay = Utils.createElement('div', { className: C.TRACK_OVERLAY });
            overlay.appendChild(Utils.createElement('span', { className: `${C.TEXT} ${C.TEXT_ON}` }, CONFIG.LABELS.TEXT_ON));

            const thumb = Utils.createElement('div', { className: C.THUMB });
            const thumbIcon = Utils.createSVGElement('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', class: C.THUMB_ICON });
            thumbIcon.appendChild(Utils.createSVGElement('circle', { cx: '10', cy: '10', r: '7' }));
            thumbIcon.appendChild(Utils.createSVGElement('line', { x1: '21', y1: '21', x2: '15', y2: '15' }));
            thumbIcon.appendChild(Utils.createSVGElement('line', { x1: '7', y1: '10', x2: '13', y2: '10', class: C.ICON_MINUS }));
            thumbIcon.appendChild(Utils.createSVGElement('line', { x1: '10', y1: '7', x2: '10', y2: '13', class: C.ICON_PLUS }));
            thumb.appendChild(thumbIcon);

            container.append(base, overlay, thumb);
            mask.appendChild(container);
            return mask;
        },

        // Builds the toggle from a native item: same classes, same two-part layout (icon, then label)
        build(template) {
            const button = Utils.createElement('button', {
                id: CONFIG.IDS.TOGGLE,
                type: 'button',
                className: `${template.className} ${C.TOGGLE_BTN}`,
                role: 'switch',
                'aria-checked': String(settings.enabled),
                'aria-label': CONFIG.LABELS.TOGGLE_ARIA,
                title: `Image zoom on hover (tap ${CONFIG.TOGGLE_HOTKEY} to switch)`
            });
            for (const child of template.children) button.appendChild(child.cloneNode(true));
            button.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));

            const pill = button.firstElementChild;
            if (!pill || pill.children.length < 2) return null;

            const [iconWrap, labelWrap] = pill.children;
            while (iconWrap.children.length > 1) iconWrap.lastElementChild.remove();
            (iconWrap.firstElementChild || iconWrap).replaceChildren(this.createIcon());
            labelWrap.classList.add(C.LABEL_SLOT);
            labelWrap.replaceChildren(this.createBar());

            if (settings.enabled) {
                button.classList.add(C.ACTIVE, C.WIPED);
                labelWrap.querySelector(`.${C.MASK}`).classList.add(C.STATE_ON);
            }
            button.addEventListener('click', this.onClick);
            button.addEventListener('mouseenter', () => Theme.refreshDebounced());
            return button;
        },

        onClick: Utils.guarded('Sidebar', function (event) {
            event.preventDefault();
            toggleEnabled();
            if (event.currentTarget) event.currentTarget.blur();
        }),

        // Instant part: the real setting and icon change immediately, the bar animation catches up
        reflectState() {
            const button = this.button;
            if (!button || !button.isConnected) return;
            button.classList.toggle(C.ACTIVE, settings.enabled);
            button.setAttribute('aria-checked', String(settings.enabled));
            this.syncVisual().catch((error) => Logger.warn('Sidebar', 'The switch animation was interrupted.', error));
        },

        isVisualOn(button) {
            return button.classList.contains(C.WIPED);
        },

        // Plays the bar animation until it matches the setting, even if the user clicked again meanwhile
        async syncVisual() {
            const button = this.button;
            if (!button || this.animating) return;
            this.animating = true;
            try {
                for (let pass = 0; pass < L.ANIMATION_MAX_PASSES; pass++) {
                    if (!button.isConnected || this.isVisualOn(button) === settings.enabled) break;
                    await this.animateTo(button, settings.enabled);
                }
            } finally {
                this.animating = false;
            }
        },

        async animateTo(button, willEnable) {
            const mask = button.querySelector(`.${C.MASK}`);
            if (!mask) {
                button.classList.toggle(C.WIPED, willEnable);
                return;
            }

            // Stage 1: elongate
            if (!willEnable) mask.classList.remove(C.STATE_ON);
            mask.classList.add(C.ELONGATED);
            await Utils.sleep(T.STAGE_ELONGATE_MS);

            // Stage 2: wipe
            button.classList.toggle(C.WIPED, willEnable);
            await Utils.sleep(T.STAGE_WIPE_MS);

            // Stage 3: shorten
            mask.classList.remove(C.ELONGATED);
            if (willEnable) mask.classList.add(C.STATE_ON);
            await Utils.sleep(T.STAGE_SETTLE_MS);
        },

        ensure() {
            const nav = Utils.findFirst(S.NAV);
            const placed = this.button && this.button.isConnected;

            // Already in the menu X is showing; only make sure the watchers still follow it
            if (placed && (!nav || nav.contains(this.button))) {
                const menu = this.button.parentElement;
                if (menu && menu.parentElement !== this.watchedParent) this.watch(menu);
                return true;
            }
            if (!nav) return this.waitForSidebar('Could not find the sidebar menu.');

            const template = Utils.findFirst(S.NAV_TEMPLATE, nav);
            if (!template) return this.waitForSidebar('Could not find a sidebar item to copy the look from.');

            const button = this.build(template);
            if (!button) return this.waitForSidebar('The sidebar items are laid out differently than expected.');

            // Copies left in a menu X no longer shows would otherwise pile up
            document.querySelectorAll(`#${CONFIG.IDS.TOGGLE}`).forEach((stale) => stale.remove());
            nav.appendChild(button);
            this.button = button;
            this.stopWaiting();
            this.watch(nav);
            Theme.refresh(true);
            Logger.log('Sidebar', 'Toggle added.');
            return true;
        },

        // X draws its sidebar whenever it is ready, so wait for it instead of polling on a fixed schedule
        waitForSidebar(reason) {
            this.lastReason = reason;
            if (this.waiter) return false;

            this.waiter = new MutationObserver(() => this.scheduleCheck());
            this.waiter.observe(document.body, { childList: true, subtree: true });
            this.waitTimer = setTimeout(() => this.giveUpWaiting(), L.SIDEBAR_WAIT_MAX_MS);
            return false;
        },

        stopWaiting() {
            if (this.waiter) this.waiter.disconnect();
            clearTimeout(this.waitTimer);
            this.waiter = null;
            this.waitTimer = null;
        },

        // Pages without a sidebar (login screens) must not be watched forever; a click or navigation looks again
        giveUpWaiting() {
            this.stopWaiting();
            if (this.warned) return;
            this.warned = true;
            Logger.warn('Sidebar', `${this.lastReason} X's layout may have changed. The on/off switch is hidden, but hover zoom still works and tapping ${CONFIG.TOGGLE_HOTKEY} turns it on or off.`);
        },

        // Runs one check shortly after a change; later changes in the meantime share that same check
        scheduleCheck() {
            if (this.checkTimer) return;
            this.checkTimer = setTimeout(() => {
                this.checkTimer = null;
                this.ensure();
            }, T.NAV_CHECK_DELAY_MS);
        },

        // X may swap out the menu or any section above it, so every level up to the page root is watched.
        // Each watcher only reports children being added or removed directly beneath it, which keeps them nearly idle.
        watch(menu) {
            if (this.observer) this.observer.disconnect();
            this.observer = new MutationObserver(() => this.scheduleCheck());
            this.watchedParent = menu.parentElement;

            let node = menu;
            for (let depth = 0; node && depth < L.WATCH_MAX_DEPTH; depth++) {
                this.observer.observe(node, { childList: true });
                node = node.parentElement;
            }
        },

        start() {
            this.ensure();
            // X keeps re-rendering after the page reports loaded, which is when the toggle used to vanish
            window.addEventListener('load', () => this.scheduleCheck());
            window.addEventListener('popstate', () => this.scheduleCheck());
            document.addEventListener('click', () => this.scheduleCheck(), true);
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) this.scheduleCheck();
            });
        }
    };

    // ---------------------------------------------------------------
    // CROSS-TAB SYNC
    // ---------------------------------------------------------------
    function listenForRemoteChanges() {
        if (typeof GM_addValueChangeListener !== 'function') return;
        GM_addValueChangeListener(CONFIG.STORAGE_KEY, (name, oldValue, newValue, remote) => {
            if (!remote) return;
            const next = Settings.validate(newValue);
            if (next.themeColor && next.themeColor !== settings.themeColor) {
                settings.themeColor = next.themeColor;
                Theme.apply(next.themeColor);
            }
            setEnabled(next.enabled, { persist: false });
        });
    }

    // ---------------------------------------------------------------
    // INITIALIZATION
    // ---------------------------------------------------------------
    function attachEventListeners() {
        document.addEventListener('mousemove', Hover.onMouseMove, { passive: true });
        document.addEventListener('mouseover', Hover.onMouseOver, true);
        document.addEventListener('mouseout', Hover.onMouseOut);

        window.addEventListener('mousedown', Utils.guarded('Hover', (event) => {
            Keyboard.onChordedPointer(event);
            Popup.hide();
        }), true);
        window.addEventListener('wheel', Keyboard.onChordedPointer, { passive: true });
        window.addEventListener('keydown', Keyboard.onKeyDown);
        window.addEventListener('keyup', Keyboard.onKeyUp);
        window.addEventListener('popstate', Utils.guarded('Hover', () => Popup.hide()));
        document.addEventListener('visibilitychange', Utils.guarded('Hover', () => {
            if (document.hidden) Popup.hide();
        }));
    }

    function init() {
        const root = document.documentElement;
        root.style.setProperty(CONFIG.STYLE.CSS_VAR, settings.themeColor || CONFIG.STYLE.FALLBACK_COLOR);
        root.style.setProperty(CONFIG.STYLE.ON_ACCENT_VAR, Theme.readableOn(settings.themeColor || CONFIG.STYLE.FALLBACK_COLOR));
        root.dataset.xivEnabled = String(settings.enabled);
        root.dataset.xivZooming = 'false';

        injectStyles();
        Popup.setup();
        attachEventListeners();
        listenForRemoteChanges();
        Theme.refresh(true);
        SidebarToggle.start();
        Logger.log('App', 'Initialized successfully.');
    }

    function start() {
        try {
            init();
        } catch (error) {
            Logger.warn('App', 'The script could not start. X may have changed its page structure. Details:', error);
        }
    }

    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
