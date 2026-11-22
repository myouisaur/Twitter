// ==UserScript==
// @name         [Twitter] Hide Ads
// @namespace    https://github.com/myouisaur/Twitter
// @icon         https://www.x.com/favicon.ico
// @version      1.8
// @description  Finds promoted posts on X (Twitter) and marks them so they are easy to spot, with an option to hide them completely.
// @author       Xiv
// @match        *://*.x.com/*
// @match        *://*.twitter.com/*
// @run-at       document-idle
// @noframes
// @updateURL    https://myouisaur.github.io/Twitter/hide-ads.user.js
// @downloadURL  https://myouisaur.github.io/Twitter/hide-ads.user.js
// ==/UserScript==

(function () {
    'use strict';

    // Duplicate-execution guard (also covers iFrames as a fallback to @noframes)
    const INIT_FLAG = 'xivHideAdsInitialized';
    if (window.top !== window.self || window[INIT_FLAG]) return;
    window[INIT_FLAG] = true;

    // ---------------------------------------------------------------
    // CONFIG
    // ---------------------------------------------------------------
    const CONFIG = {
        // Feature Flags
        DEBUG: false,
        MODE: 'highlight',                 // 'highlight' outlines and labels ads so none is lost; 'hide' removes them from view
        LOCK_ADS: true,                    // flagged ads are dimmed and unclickable until you press Unlock (highlight mode only)
        DIM_PERCENT: 65,                   // how dark the lock layer is, 0 (clear) to 100 (solid black)
        COUNT_TEXT_LINKS: false,           // false: links people type in their own post never count, only links X attaches (cards, ad captions, buttons); true: they count too
        LOG_PREFIX: '[Twitter Hide Ads]',

        // Link Detection
        // X's own labels on ordinary posts ("Fan account") link to its help pages; these are not ads
        IGNORED_LINK_PREFIXES: ['https://help.x.com/rules-and-policies/authenticity'],
        // Ad links carry X's click-tracking address parts, whatever language the page is in
        TRACKING_PARAMS: ['twclid', 'twt_id'],
        // An ad's small caption ("Ad from ...", "From ...") is short and ends with the site it links to
        LABEL_MAX_LENGTH: 60,

        // Selectors
        SELECTORS: {
            EXTERNAL_LINK: 'a[href^="http"]',
            // The whole timeline cell; quoted posts have their own frame and must not count as a cell
            POST_CELL: '[role="link"][data-href]:not([data-slot="embedded-tweet-frame"])',
            ARTICLE: 'article',
            TEXT_BLOCK: '[dir="auto"]'
        },

        // Patterns
        PATTERNS: {
            STATUS_PATH: /\/status\/(\d+)/
        },

        // CSS Classes
        CLASSES: {
            STYLE_ID: 'xiv-ads-styles',
            FLAGGED: 'xiv-ad-flagged',
            HIDDEN: 'xiv-ad-hidden',
            BAR: 'xiv-ad-bar',
            BAR_TEXT: 'xiv-ad-bar-text',
            BAR_BUTTON: 'xiv-ad-bar-button',
            SHIELD: 'xiv-ad-shield',
            REVEAL: 'xiv-ads-revealed',
            COUNTER: 'xiv-ad-counter'
        },

        // Attributes
        ATTRIBUTES: {
            REASON: 'data-xiv-ad-reason',
            INERT_MARK: 'data-xiv-made-inert'
        },

        // Detection Reasons (shown on the highlight label, so the test shows which signal matched)
        REASONS: {
            TRACKING: 'tracking link',
            LABEL: 'ad caption',
            EMBEDDED: 'embedded link'
        },

        // UI Text
        LABELS: {
            BADGE: 'AD DETECTED',
            UNLOCK_HINT: 'Unlock this ad so it can be clicked',
            LOCK_HINT: 'Lock this ad again',
            HIDDEN_COUNT: (count) => `${count} hidden · Show`,
            REVEALED_COUNT: (count) => `${count} shown · Hide again`,
            COUNTER_HINT: 'Posts with links to other sites are hidden. Click to show or hide them.'
        },

        // Events the lock layer and the strip keep away from X's own click handling
        SWALLOWED_EVENTS: ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'keydown', 'keyup'],

        // Icons (drawn as SVG so they stay sharp at any zoom); each part is [tag, attributes]
        SVG_NAMESPACE: 'http://www.w3.org/2000/svg',
        ICONS: {
            LOCKED: [
                ['rect', { x: 5, y: 11, width: 14, height: 10, rx: 2 }],
                ['path', { d: 'M8 11V7a4 4 0 0 1 8 0v4' }]
            ],
            UNLOCKED: [
                ['rect', { x: 5, y: 11, width: 14, height: 10, rx: 2 }],
                ['path', { d: 'M8 11V7a4 4 0 0 1 7.5-2' }]
            ]
        },
        ATTRIBUTE_ICON_STATE: 'data-xiv-icon',

        // Layout
        LAYOUT: {
            OUTLINE_WIDTH: '0.1875rem',
            BADGE_GAP: '0.25rem',
            BUTTON_SIZE: '2rem',
            ICON_SIZE: '1.125rem',
            DEFAULT_DIM_PERCENT: 65,
            SHIELD_Z_INDEX: 1,
            BAR_Z_INDEX: 2,
            BADGE_FONT_SIZE: 'clamp(0.6875rem, 0.65rem + 0.2vw, 0.8125rem)',
            BADGE_PADDING: '0.25rem 0.75rem',
            BADGE_RADIUS: '0.25rem',
            // Orange with dark text stays readable on both dark and light themes
            ACCENT_COLOR: '#ff9f1c',
            BADGE_TEXT_COLOR: '#1a1200',
            COUNTER_OFFSET: 'clamp(0.75rem, 2vw, 1.25rem)',
            COUNTER_FONT_SIZE: 'clamp(0.75rem, 0.7rem + 0.25vw, 0.875rem)',
            COUNTER_MIN_HEIGHT: '2.75rem',
            COUNTER_PADDING: '0 1rem',
            COUNTER_BG: '#16181c',
            COUNTER_TEXT_COLOR: '#e7e9ea'
        }
    };

    const Logger = {
        log: (module, ...args) => CONFIG.DEBUG && console.log(`${CONFIG.LOG_PREFIX}[${module}]`, ...args),
        warn: (module, ...args) => console.warn(`${CONFIG.LOG_PREFIX}[${module}]`, ...args),
        error: (module, ...args) => console.error(`${CONFIG.LOG_PREFIX}[${module}]`, ...args)
    };

    // ---------------------------------------------------------------
    // UTILS (pure helpers)
    // ---------------------------------------------------------------
    const Utils = {
        // Returns a URL, or null for anything that is not a readable web address
        parseUrl(href) {
            try {
                const url = new URL(href, window.location.href);
                return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
            } catch (error) {
                return null;
            }
        },

        isIgnoredLink(url) {
            return CONFIG.IGNORED_LINK_PREFIXES.some(prefix => url.href.startsWith(prefix));
        },

        hasTrackingParam(url) {
            return CONFIG.TRACKING_PARAMS.some(name => url.searchParams.has(name));
        },

        // DIM_PERCENT as a 0 to 1 opacity; a missing or silly value falls back to a sensible dimness
        dimOpacity() {
            const percent = Number(CONFIG.DIM_PERCENT);
            return (Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : CONFIG.LAYOUT.DEFAULT_DIM_PERCENT) / 100;
        },

        // 'Ad from wencrypto.com' + wencrypto.com -> true
        textNamesHost(text, hostname) {
            const caption = (text || '').trim().toLowerCase();
            if (!caption || caption.length > CONFIG.LABEL_MAX_LENGTH) return false;
            return caption.endsWith(hostname.toLowerCase().replace(/^www\./, ''));
        }
    };

    // ---------------------------------------------------------------
    // LINK CLASSIFIER (decides whether one link belongs to an ad)
    // ---------------------------------------------------------------
    const LinkClassifier = {
        // Every full web address counts the same, wherever it leads, including X's own sites:
        // promoted posts often point back at x.com. Returns the reason text, or null for no link.
        classify(anchor) {
            const url = Utils.parseUrl(anchor.href);
            if (!url || Utils.isIgnoredLink(url)) return null;
            if (Utils.textNamesHost(anchor.textContent, url.hostname)) return CONFIG.REASONS.LABEL;
            if (Utils.hasTrackingParam(url)) return CONFIG.REASONS.TRACKING;
            return CONFIG.REASONS.EMBEDDED;
        }
    };

    // ---------------------------------------------------------------
    // UI & STYLING
    // ---------------------------------------------------------------
    const UI = {
        injectStyles() {
            if (document.getElementById(CONFIG.CLASSES.STYLE_ID)) return;

            const C = CONFIG.CLASSES;
            const L = CONFIG.LAYOUT;
            const style = document.createElement('style');
            style.id = C.STYLE_ID;
            style.textContent = `
                .${C.FLAGGED},
                .${C.REVEAL} .${C.HIDDEN} {
                    display: revert !important;
                    position: relative !important;
                    outline: ${L.OUTLINE_WIDTH} dashed ${L.ACCENT_COLOR} !important;
                    outline-offset: -${L.OUTLINE_WIDTH} !important;
                }

                /* A strip above the post, in the page flow, so it never covers the post's own text.
                   Words, not only colour, say why the post was flagged */
                .${C.BAR} {
                    position: relative !important;
                    z-index: ${L.BAR_Z_INDEX} !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: space-between !important;
                    gap: 0.5rem !important;
                    box-sizing: border-box !important;
                    margin-bottom: ${L.BADGE_GAP} !important;
                    padding: ${L.BADGE_PADDING} !important;
                    border-radius: ${L.BADGE_RADIUS} !important;
                    background: ${L.ACCENT_COLOR} !important;
                    color: ${L.BADGE_TEXT_COLOR} !important;
                    font: 700 ${L.BADGE_FONT_SIZE}/1.4 system-ui, sans-serif !important;
                    letter-spacing: 0.03em !important;
                }

                .${C.BAR_BUTTON} {
                    display: inline-flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    flex: none !important;
                    width: ${L.BUTTON_SIZE} !important;
                    height: ${L.BUTTON_SIZE} !important;
                    padding: 0 !important;
                    border: 0.125rem solid ${L.BADGE_TEXT_COLOR} !important;
                    border-radius: 9999px !important;
                    background: transparent !important;
                    color: inherit !important;
                    cursor: pointer !important;
                    transition: background-color 0.15s ease, color 0.15s ease !important;
                }
                .${C.BAR_BUTTON} svg {
                    width: ${L.ICON_SIZE} !important;
                    height: ${L.ICON_SIZE} !important;
                    fill: none !important;
                    stroke: currentColor !important;
                    stroke-width: 2 !important;
                    stroke-linecap: round !important;
                    stroke-linejoin: round !important;
                    pointer-events: none !important;
                }
                /* Locked: filled dark with an orange padlock. Unlocked: outline only.
                   Hovering shows the look of the other state, the one a click would switch to */
                .${C.BAR_BUTTON}[${CONFIG.ATTRIBUTE_ICON_STATE}="locked"],
                .${C.BAR_BUTTON}[${CONFIG.ATTRIBUTE_ICON_STATE}="unlocked"]:hover {
                    background: ${L.BADGE_TEXT_COLOR} !important;
                    color: ${L.ACCENT_COLOR} !important;
                }
                .${C.BAR_BUTTON}[${CONFIG.ATTRIBUTE_ICON_STATE}="unlocked"],
                .${C.BAR_BUTTON}[${CONFIG.ATTRIBUTE_ICON_STATE}="locked"]:hover {
                    background: transparent !important;
                    color: ${L.BADGE_TEXT_COLOR} !important;
                }
                .${C.BAR_BUTTON}:focus-visible {
                    outline: 0.1875rem solid ${L.BADGE_TEXT_COLOR} !important;
                    outline-offset: 0.125rem !important;
                }

                /* Dims the ad and catches every click aimed at it */
                .${C.SHIELD} {
                    position: absolute !important;
                    inset: 0 !important;
                    z-index: ${L.SHIELD_Z_INDEX} !important;
                    background: rgba(0, 0, 0, ${Utils.dimOpacity()}) !important;
                    cursor: not-allowed !important;
                }

                @media (prefers-reduced-motion: reduce) {
                    .${C.BAR_BUTTON} { transition: none !important; }
                }

                .${C.HIDDEN} { display: none !important; }

                .${C.COUNTER} {
                    position: fixed !important;
                    right: ${L.COUNTER_OFFSET} !important;
                    bottom: ${L.COUNTER_OFFSET} !important;
                    z-index: 2147483000 !important;
                    min-height: ${L.COUNTER_MIN_HEIGHT} !important;
                    padding: ${L.COUNTER_PADDING} !important;
                    border: 0.0625rem solid ${L.ACCENT_COLOR} !important;
                    border-radius: 9999px !important;
                    background: ${L.COUNTER_BG} !important;
                    color: ${L.COUNTER_TEXT_COLOR} !important;
                    font: 600 ${L.COUNTER_FONT_SIZE}/1 system-ui, sans-serif !important;
                    cursor: pointer !important;
                    opacity: 0.85;
                    transition: opacity 0.2s ease, transform 0.2s ease !important;
                }
                .${C.COUNTER}:hover,
                .${C.COUNTER}:focus-visible {
                    opacity: 1;
                    transform: translateY(-0.125rem);
                }
                .${C.COUNTER}:focus-visible {
                    outline: 0.1875rem solid ${L.ACCENT_COLOR} !important;
                    outline-offset: 0.125rem !important;
                }
                .${C.COUNTER}[hidden] { display: none !important; }

                @media (prefers-reduced-motion: reduce) {
                    .${C.COUNTER} { transition: none !important; }
                }
            `;
            (document.head || document.documentElement).appendChild(style);
        }
    };

    // ---------------------------------------------------------------
    // COUNTER (shows how many posts are hidden and lets you look at them)
    // ---------------------------------------------------------------
    const Counter = {
        button: null,

        build() {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = CONFIG.CLASSES.COUNTER;
            button.title = CONFIG.LABELS.COUNTER_HINT;
            button.setAttribute('aria-pressed', 'false');
            button.hidden = true;
            button.addEventListener('click', () => this.toggleReveal());
            document.body.appendChild(button);
            return button;
        },

        toggleReveal() {
            const root = document.documentElement;
            const revealed = root.classList.toggle(CONFIG.CLASSES.REVEAL);
            if (this.button) this.button.setAttribute('aria-pressed', String(revealed));
            this.refresh();
        },

        refresh() {
            if (CONFIG.MODE !== 'hide' || !document.body) return;
            if (!this.button || !this.button.isConnected) this.button = this.build();

            const count = document.querySelectorAll(`.${CONFIG.CLASSES.HIDDEN}`).length;
            const revealed = document.documentElement.classList.contains(CONFIG.CLASSES.REVEAL);
            const text = revealed ? CONFIG.LABELS.REVEALED_COUNT(count) : CONFIG.LABELS.HIDDEN_COUNT(count);
            this.button.hidden = count === 0;
            // Only written when different, so updating the label never wakes the observer again
            if (this.button.textContent !== text) this.button.textContent = text;
        }
    };

    // ---------------------------------------------------------------
    // CONTROLS (the strip above an ad and the lock that keeps it unclickable)
    // ---------------------------------------------------------------
    const Controls = {
        // Cells whose lock was released by hand; kept here so a re-render does not lock them again
        unlockedCells: new WeakSet(),

        isLockActive() {
            return CONFIG.LOCK_ADS && CONFIG.MODE === 'highlight';
        },

        // X opens a post when you click anywhere on it, so clicks on our own parts must not reach it
        swallowEvents(element, shouldPreventDefault) {
            CONFIG.SWALLOWED_EVENTS.forEach(name => {
                element.addEventListener(name, event => {
                    event.stopPropagation();
                    if (shouldPreventDefault) event.preventDefault();
                });
            });
        },

        createBar(cell) {
            const bar = document.createElement('div');
            bar.className = CONFIG.CLASSES.BAR;

            const text = document.createElement('span');
            text.className = CONFIG.CLASSES.BAR_TEXT;
            bar.appendChild(text);

            this.swallowEvents(bar, false);
            cell.insertBefore(bar, cell.firstChild);
            return bar;
        },

        findPart(cell, className) {
            return Array.from(cell.children).find(child => child.classList.contains(className)) || null;
        },

        // Built from CONFIG.ICONS with DOM calls, never from an HTML string
        buildIcon(parts) {
            const svg = document.createElementNS(CONFIG.SVG_NAMESPACE, 'svg');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('aria-hidden', 'true');
            parts.forEach(([tag, attributes]) => {
                const shape = document.createElementNS(CONFIG.SVG_NAMESPACE, tag);
                Object.entries(attributes).forEach(([name, value]) => shape.setAttribute(name, value));
                svg.appendChild(shape);
            });
            return svg;
        },

        // The icon shows the state: a closed padlock while locked, an open one once unlocked
        showIcon(button, isUnlocked) {
            const state = isUnlocked ? 'unlocked' : 'locked';
            if (button.getAttribute(CONFIG.ATTRIBUTE_ICON_STATE) === state) return;
            button.setAttribute(CONFIG.ATTRIBUTE_ICON_STATE, state);
            button.replaceChildren(this.buildIcon(isUnlocked ? CONFIG.ICONS.UNLOCKED : CONFIG.ICONS.LOCKED));
        },

        createButton(bar, cell) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = CONFIG.CLASSES.BAR_BUTTON;
            button.addEventListener('click', () => this.toggleLock(cell));
            bar.appendChild(button);
            return button;
        },

        createShield() {
            const shield = document.createElement('div');
            shield.className = CONFIG.CLASSES.SHIELD;
            this.swallowEvents(shield, true);
            return shield;
        },

        // Browsers skip inert parts for clicks, focus and screen readers alike.
        // Only parts made inert here are ever released, never ones X marked itself.
        setContentInert(cell, isInert) {
            const marker = CONFIG.ATTRIBUTES.INERT_MARK;
            Array.from(cell.children).forEach(child => {
                const isOurs = child.classList.contains(CONFIG.CLASSES.BAR) || child.classList.contains(CONFIG.CLASSES.SHIELD);
                if (isOurs) return;
                if (isInert && !child.hasAttribute('inert')) {
                    child.setAttribute('inert', '');
                    child.setAttribute(marker, '');
                } else if (!isInert && child.hasAttribute(marker)) {
                    child.removeAttribute('inert');
                    child.removeAttribute(marker);
                }
            });
        },

        // The post itself can be reached with Tab and opened with Enter, so it leaves the tab order while locked
        setCellFocusable(cell, isFocusable) {
            const key = 'xivTabindex';
            if (!isFocusable && !(key in cell.dataset) && cell.hasAttribute('tabindex')) {
                cell.dataset[key] = cell.getAttribute('tabindex');
                cell.setAttribute('tabindex', '-1');
                return;
            }
            if (isFocusable && key in cell.dataset) {
                cell.setAttribute('tabindex', cell.dataset[key]);
                delete cell.dataset[key];
            }
        },

        toggleLock(cell) {
            if (this.unlockedCells.has(cell)) this.unlockedCells.delete(cell);
            else this.unlockedCells.add(cell);
            this.sync(cell);
        },

        updateButton(cell, bar) {
            let button = this.findButton(bar);
            if (!this.isLockActive()) {
                if (button) button.remove();
                return;
            }
            if (!button) button = this.createButton(bar, cell);

            const isUnlocked = this.unlockedCells.has(cell);
            this.showIcon(button, isUnlocked);
            button.title = isUnlocked ? CONFIG.LABELS.LOCK_HINT : CONFIG.LABELS.UNLOCK_HINT;
            button.setAttribute('aria-label', button.title);
        },

        findButton(bar) {
            return bar.querySelector(`.${CONFIG.CLASSES.BAR_BUTTON}`);
        },

        updateShield(cell) {
            const shield = this.findPart(cell, CONFIG.CLASSES.SHIELD);
            const shouldLock = this.isLockActive() && !this.unlockedCells.has(cell);

            if (shouldLock && !shield) cell.appendChild(this.createShield());
            if (!shouldLock && shield) shield.remove();
            this.setContentInert(cell, shouldLock);
            this.setCellFocusable(cell, !shouldLock);
        },

        // Safe to call any number of times: brings the strip, button and lock in line with the current state
        sync(cell, reasonText) {
            const bar = this.findPart(cell, CONFIG.CLASSES.BAR) || this.createBar(cell);
            if (reasonText) bar.firstChild.textContent = `${CONFIG.LABELS.BADGE} · ${reasonText}`;
            this.updateButton(cell, bar);
            this.updateShield(cell);
        }
    };

    // ---------------------------------------------------------------
    // AD MARKER (applies the chosen mode to a post)
    // ---------------------------------------------------------------
    const AdMarker = {
        mark(cell, reason) {
            const attribute = CONFIG.ATTRIBUTES.REASON;
            const existing = cell.getAttribute(attribute);
            const reasons = existing ? existing.split(', ') : [];

            if (!reasons.includes(reason)) {
                reasons.push(reason);
                cell.setAttribute(attribute, reasons.join(', '));
                cell.classList.add(CONFIG.MODE === 'hide' ? CONFIG.CLASSES.HIDDEN : CONFIG.CLASSES.FLAGGED);
                Logger.log('Detect', `Flagged a post (${reason}).`);
            }
            // Runs every time so parts X removed while re-rendering the post are put back
            Controls.sync(cell, reasons.join(', '));
        }
    };

    // ---------------------------------------------------------------
    // SCANNER (finds ad links inside newly added page parts)
    // ---------------------------------------------------------------
    const Scanner = {
        collectLinks(scope) {
            const links = Array.from(scope.querySelectorAll(CONFIG.SELECTORS.EXTERNAL_LINK));
            if (scope.matches(CONFIG.SELECTORS.EXTERNAL_LINK)) links.push(scope);
            return links;
        },

        // A quoted post has its own article inside the main one; the main one is the post
        outermostArticle(anchor) {
            let article = anchor.closest(CONFIG.SELECTORS.ARTICLE);
            while (article && article.parentElement) {
                const outer = article.parentElement.closest(CONFIG.SELECTORS.ARTICLE);
                if (!outer) break;
                article = outer;
            }
            return article;
        },

        // Some promoted posts have no clickable wrapper, only an article inside a plain box
        // that carries the padding and divider line. That box is the whole post.
        findArticleBox(anchor) {
            const article = this.outermostArticle(anchor);
            if (!article) return null;

            // Only a box holding this one post counts; a box holding many would take neighbours with it
            const box = article.parentElement;
            const isOwnBox = box && box.querySelectorAll(CONFIG.SELECTORS.ARTICLE).length === 1;
            return isOwnBox ? box : article;
        },

        findCell(anchor) {
            return anchor.closest(CONFIG.SELECTORS.POST_CELL) || this.findArticleBox(anchor);
        },

        // A link typed inside the post's own words, as opposed to a card or caption under it
        isTextLink(anchor) {
            return Boolean(anchor.closest(CONFIG.SELECTORS.TEXT_BLOCK));
        },

        // The post you opened on purpose is never hidden, or you could not read it
        isOpenedPost(cell) {
            const match = window.location.pathname.match(CONFIG.PATTERNS.STATUS_PATH);
            if (!match) return false;
            const ownAddress = cell.getAttribute('data-href') || '';
            return ownAddress.includes(`/status/${match[1]}`) || Boolean(cell.querySelector(`a[href*="/status/${match[1]}"]`));
        },

        inspectLink(anchor) {
            if (!CONFIG.COUNT_TEXT_LINKS && this.isTextLink(anchor)) return;

            const reason = LinkClassifier.classify(anchor);
            if (!reason) return;

            // Links outside posts (profile bios, menus) are not part of any post
            const cell = this.findCell(anchor);
            if (!cell || this.isOpenedPost(cell)) return;
            AdMarker.mark(cell, reason);
        },

        scan(scope) {
            try {
                this.collectLinks(scope).forEach(anchor => this.inspectLink(anchor));
            } catch (error) {
                Logger.error('Scan', 'Skipped part of the page because it could not be read.', error);
            }
        }
    };

    // ---------------------------------------------------------------
    // OBSERVERS
    // ---------------------------------------------------------------
    const Observers = {
        observer: null,
        pendingNodes: new Set(),
        frameId: 0,

        collect(mutations) {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) this.pendingNodes.add(node);
                });
            });
        },

        // One pass per frame, however many changes X makes at once
        schedule() {
            if (this.frameId) return;
            this.frameId = requestAnimationFrame(() => {
                this.frameId = 0;
                this.flush();
            });
        },

        flush() {
            const nodes = Array.from(this.pendingNodes);
            this.pendingNodes.clear();
            nodes.forEach(node => {
                if (node.isConnected) Scanner.scan(node);
            });
            Counter.refresh();
        },

        // Watches the whole page because X replaces its main column when you navigate,
        // which would leave an observer on a smaller container watching nothing
        start() {
            if (this.observer || !document.body) return;
            this.observer = new MutationObserver(mutations => {
                this.collect(mutations);
                if (this.pendingNodes.size > 0) this.schedule();
            });
            this.observer.observe(document.body, { childList: true, subtree: true });
        },

        stop() {
            if (this.observer) this.observer.disconnect();
            this.observer = null;
            if (this.frameId) cancelAnimationFrame(this.frameId);
            this.frameId = 0;
            this.pendingNodes.clear();
        }
    };

    // ---------------------------------------------------------------
    // APP BOOTSTRAP
    // ---------------------------------------------------------------
    const App = {
        init() {
            const version = typeof GM_info !== 'undefined' && GM_info.script ? GM_info.script.version : 'unknown';
            Logger.log('App', `Initializing v${version} in ${CONFIG.MODE} mode`);
            UI.injectStyles();
            Scanner.scan(document.documentElement);
            Counter.refresh();
            Observers.start();

            // Release the observer when the page is stored for back/forward, and resume if it returns
            window.addEventListener('pagehide', () => Observers.stop());
            window.addEventListener('pageshow', event => {
                if (!event.persisted) return;
                Scanner.scan(document.documentElement);
                Observers.start();
            });
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => App.init());
    } else {
        App.init();
    }

})();
