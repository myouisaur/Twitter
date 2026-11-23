// ==UserScript==
// @name         [Twitter] Hide Ads
// @namespace    https://github.com/myouisaur/Twitter
// @icon         https://www.x.com/favicon.ico
// @version      2.0
// @description  Finds ads and posts with links to other sites on X (Twitter), marks each clearly, and lets you lock or hide them.
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

    // The three kinds of finding, weakest to strongest
    const LEVEL = { X_LINK: 'x-link', EXTERNAL: 'external', AD: 'ad' };

    // ---------------------------------------------------------------
    // CONFIG
    // ---------------------------------------------------------------
    const CONFIG = {
        // Feature Flags
        DEBUG: false,
        MODE: 'highlight',                 // 'highlight' marks posts so none is lost; 'hide' removes ads and outside-link posts from view
        LOCK_ADS: true,                    // marked posts get a lock button; a locked post is dimmed and cannot be clicked
        DIM_PERCENT: 65,                   // how dark a locked post is, 0 (clear) to 100 (solid black)
        COUNT_TEXT_LINKS: false,           // false: links people type in their own post never count, only links X attaches (cards, captions, buttons); true: they count too
        LOG_PREFIX: '[Twitter Hide Ads]',

        // Link Detection
        // X's own sites: a link here is an X link, not an outside link
        X_HOSTS: ['x.com', 'twitter.com'],
        // Link shorteners only forward elsewhere, so the real destination is read from the link's own details
        SHORTENER_HOSTS: ['t.co'],
        DOMAIN_PATTERN: /[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi,
        // A caption starting this way means an ad; add other languages' wording here, in lower case
        AD_CAPTION_PREFIXES: ['ad from'],
        // Ad links also carry X's click-tracking address parts, whatever language the page is in
        TRACKING_PARAMS: ['twclid', 'twt_id'],
        // X's own labels on ordinary posts ("Fan account") link to its help pages; these are not ads
        IGNORED_LINK_PREFIXES: ['https://help.x.com/rules-and-policies/authenticity'],

        // What each kind of finding looks like and how it starts out
        LEVEL_INFO: {
            [LEVEL.AD]: {
                label: 'Ad detected',
                accent: '#ff9f1c',             // amber
                ink: '#1a1200',
                isLockedAtStart: true,
                isHiddenInHideMode: true,
                icon: [
                    ['path', { d: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z' }],
                    ['path', { d: 'M15 9a4 4 0 0 1 0 6' }],
                    ['path', { d: 'M18 6a8 8 0 0 1 0 12' }]
                ]
            },
            [LEVEL.EXTERNAL]: {
                label: 'External link',
                accent: '#6cb4ff',             // blue
                ink: '#06192e',
                isLockedAtStart: false,
                isHiddenInHideMode: true,
                icon: [
                    ['path', { d: 'M14 4h6v6' }],
                    ['path', { d: 'M20 4l-9 9' }],
                    ['path', { d: 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5' }]
                ]
            },
            [LEVEL.X_LINK]: {
                label: 'Link detected',
                accent: '#b3bcc6',             // grey
                ink: '#14181c',
                isLockedAtStart: false,
                isHiddenInHideMode: false,
                icon: [
                    ['path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }],
                    ['path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }]
                ]
            }
        },
        LEVEL_ORDER: [LEVEL.X_LINK, LEVEL.EXTERNAL, LEVEL.AD],

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
            BAR_ICON: 'xiv-ad-bar-icon',
            BAR_LABEL: 'xiv-ad-bar-label',
            BAR_SITE: 'xiv-ad-bar-site',
            BAR_BUTTON: 'xiv-ad-bar-button',
            SHIELD: 'xiv-ad-shield',
            REVEAL: 'xiv-ads-revealed',
            COUNTER: 'xiv-ad-counter'
        },

        // Attributes
        ATTRIBUTES: {
            LEVEL: 'data-xiv-ad-level',
            SITE: 'data-xiv-ad-site',
            INERT_MARK: 'data-xiv-made-inert',
            ICON_STATE: 'data-xiv-icon',
            BAR_STATE: 'data-xiv-bar-state'
        },

        // UI Text
        LABELS: {
            UNLOCK_HINT: 'Unlock this post so it can be clicked',
            LOCK_HINT: 'Lock this post so it cannot be clicked',
            HIDDEN_COUNT: (count) => `${count} hidden · Show`,
            REVEALED_COUNT: (count) => `${count} shown · Hide again`,
            COUNTER_HINT: 'Ads and posts with links to other sites are hidden. Click to show or hide them.'
        },

        // Events the lock layer and the bar keep away from X's own click handling
        SWALLOWED_EVENTS: ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'keydown', 'keyup'],

        // Padlock icons (drawn as SVG so they stay sharp at any zoom); each part is [tag, attributes]
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

        // Layout
        LAYOUT: {
            OUTLINE_WIDTH: '0.1875rem',
            BAR_GAP: '0.25rem',
            BAR_PADDING: '0.1875rem 0.375rem 0.1875rem 0.75rem',
            BAR_RADIUS: '0.375rem',
            BAR_FONT_SIZE: 'clamp(0.75rem, 0.72rem + 0.15vw, 0.8125rem)',
            BAR_ICON_SIZE: '1rem',
            BUTTON_SIZE: '1.75rem',
            BUTTON_ICON_SIZE: '1rem',
            DEFAULT_DIM_PERCENT: 65,
            SHIELD_Z_INDEX: 1,
            BAR_Z_INDEX: 2,
            COUNTER_OFFSET: 'clamp(0.75rem, 2vw, 1.25rem)',
            COUNTER_FONT_SIZE: 'clamp(0.75rem, 0.7rem + 0.25vw, 0.875rem)',
            COUNTER_MIN_HEIGHT: '2.75rem',
            COUNTER_PADDING: '0 1rem',
            COUNTER_BG: '#16181c',
            COUNTER_TEXT_COLOR: '#e7e9ea',
            COUNTER_ACCENT: '#ff9f1c'
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

        // 'www.x.com', 'ads.x.com' and 'x.com' are all X
        isXHost(hostname) {
            const host = hostname.toLowerCase();
            return CONFIG.X_HOSTS.some(own => host === own || host.endsWith(`.${own}`));
        },

        isShortener(hostname) {
            return CONFIG.SHORTENER_HOSTS.includes(hostname.toLowerCase());
        },

        // All the words inside an element, with a space between separate parts
        // ('Ad from x.com' + 'Learn more' stays two pieces instead of 'x.comLearn more')
        textOf(element) {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            const pieces = [];
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                const text = node.nodeValue.trim();
                if (text) pieces.push(text);
            }
            return pieces.join(' ');
        },

        isAdCaption(text) {
            const caption = text.trim().toLowerCase();
            return CONFIG.AD_CAPTION_PREFIXES.some(prefix => caption.startsWith(prefix));
        },

        // The last website name written in a piece of text, or null
        // 'From thepersonalityproject.com' -> 'thepersonalityproject.com'
        lastDomainIn(text) {
            const found = text.match(CONFIG.DOMAIN_PATTERN);
            return found ? found[found.length - 1].toLowerCase() : null;
        },

        // Where a link really leads. A shortened link is read from the address X attaches to it
        // (its title) or, for cards, from the site named in its caption. Null means unknown.
        resolveDestination(anchor, url, text) {
            if (!this.isShortener(url.hostname)) return url.hostname;
            // Only a full web address counts; anything else would be read as a page on X itself
            const title = anchor.getAttribute('title') || '';
            const titled = /^https?:\/\//i.test(title) ? this.parseUrl(title) : null;
            return titled ? titled.hostname : this.lastDomainIn(text);
        },

        siteName(hostname) {
            return (hostname || '').toLowerCase().replace(/^www\./, '');
        },

        levelRank(level) {
            return CONFIG.LEVEL_ORDER.indexOf(level);
        },

        // DIM_PERCENT as a 0 to 1 opacity; a missing or silly value falls back to a sensible dimness
        dimOpacity() {
            const percent = Number(CONFIG.DIM_PERCENT);
            return (Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : CONFIG.LAYOUT.DEFAULT_DIM_PERCENT) / 100;
        }
    };

    // ---------------------------------------------------------------
    // LINK CLASSIFIER (decides what kind of finding one link is)
    // ---------------------------------------------------------------
    const LinkClassifier = {
        // Returns { level, site }, or null when the link says nothing yet
        classify(anchor) {
            const url = Utils.parseUrl(anchor.href);
            if (!url || Utils.isIgnoredLink(url)) return null;

            const text = Utils.textOf(anchor);
            const destination = Utils.resolveDestination(anchor, url, text);
            const site = Utils.siteName(destination);

            if (Utils.isAdCaption(text) || Utils.hasTrackingParam(url)) return { level: LEVEL.AD, site };

            // A picture on a shortened link names no site; the caption link beside it decides
            if (!destination) return null;
            return { level: Utils.isXHost(destination) ? LEVEL.X_LINK : LEVEL.EXTERNAL, site };
        }
    };

    // ---------------------------------------------------------------
    // UI & STYLING
    // ---------------------------------------------------------------
    const UI = {
        // One block of rules per kind of finding, setting the two colours everything else reads
        buildLevelRules() {
            return Object.entries(CONFIG.LEVEL_INFO).map(([level, info]) => `
                [${CONFIG.ATTRIBUTES.LEVEL}="${level}"] {
                    --xiv-accent: ${info.accent};
                    --xiv-ink: ${info.ink};
                }`).join('\n');
        },

        injectStyles() {
            if (document.getElementById(CONFIG.CLASSES.STYLE_ID)) return;

            const C = CONFIG.CLASSES;
            const L = CONFIG.LAYOUT;
            const ICON_STATE = CONFIG.ATTRIBUTES.ICON_STATE;
            const style = document.createElement('style');
            style.id = C.STYLE_ID;
            style.textContent = `
                ${this.buildLevelRules()}

                .${C.FLAGGED},
                .${C.REVEAL} .${C.HIDDEN} {
                    display: revert !important;
                    position: relative !important;
                    outline: ${L.OUTLINE_WIDTH} dashed var(--xiv-accent) !important;
                    outline-offset: -${L.OUTLINE_WIDTH} !important;
                }

                /* A bar above the post, in the page flow, so it never covers the post's own text.
                   An icon and words say what was found, so colour is never the only clue */
                .${C.BAR} {
                    position: relative !important;
                    z-index: ${L.BAR_Z_INDEX} !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: space-between !important;
                    gap: 0.5rem !important;
                    box-sizing: border-box !important;
                    margin-bottom: ${L.BAR_GAP} !important;
                    padding: ${L.BAR_PADDING} !important;
                    border-radius: ${L.BAR_RADIUS} !important;
                    background: var(--xiv-accent) !important;
                    color: var(--xiv-ink) !important;
                    font: 500 ${L.BAR_FONT_SIZE}/1.3 system-ui, sans-serif !important;
                }
                .${C.BAR_TEXT} {
                    display: flex !important;
                    align-items: center !important;
                    gap: 0.5rem !important;
                    min-width: 0 !important;
                }
                .${C.BAR_ICON} {
                    flex: none !important;
                    width: ${L.BAR_ICON_SIZE} !important;
                    height: ${L.BAR_ICON_SIZE} !important;
                    fill: none !important;
                    stroke: currentColor !important;
                    stroke-width: 2 !important;
                    stroke-linecap: round !important;
                    stroke-linejoin: round !important;
                }
                .${C.BAR_LABEL} {
                    flex: none !important;
                    font-weight: 700 !important;
                    white-space: nowrap !important;
                }
                .${C.BAR_SITE} {
                    min-width: 0 !important;
                    overflow: hidden !important;
                    text-overflow: ellipsis !important;
                    white-space: nowrap !important;
                    opacity: 0.85 !important;
                }
                .${C.BAR_SITE}::before {
                    content: '·';
                    margin-right: 0.5rem;
                }

                .${C.BAR_BUTTON} {
                    display: inline-flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    flex: none !important;
                    width: ${L.BUTTON_SIZE} !important;
                    height: ${L.BUTTON_SIZE} !important;
                    padding: 0 !important;
                    border: 0.125rem solid var(--xiv-ink) !important;
                    border-radius: 9999px !important;
                    background: transparent !important;
                    color: inherit !important;
                    cursor: pointer !important;
                    transition: background-color 0.15s ease, color 0.15s ease !important;
                }
                .${C.BAR_BUTTON} svg {
                    width: ${L.BUTTON_ICON_SIZE} !important;
                    height: ${L.BUTTON_ICON_SIZE} !important;
                    fill: none !important;
                    stroke: currentColor !important;
                    stroke-width: 2 !important;
                    stroke-linecap: round !important;
                    stroke-linejoin: round !important;
                    pointer-events: none !important;
                }
                /* Locked: filled dark. Unlocked: outline only.
                   Hovering shows the look of the other state, the one a click would switch to */
                .${C.BAR_BUTTON}[${ICON_STATE}="locked"],
                .${C.BAR_BUTTON}[${ICON_STATE}="unlocked"]:hover {
                    background: var(--xiv-ink) !important;
                    color: var(--xiv-accent) !important;
                }
                .${C.BAR_BUTTON}[${ICON_STATE}="unlocked"],
                .${C.BAR_BUTTON}[${ICON_STATE}="locked"]:hover {
                    background: transparent !important;
                    color: var(--xiv-ink) !important;
                }
                .${C.BAR_BUTTON}:focus-visible {
                    outline: 0.1875rem solid var(--xiv-ink) !important;
                    outline-offset: 0.125rem !important;
                }

                /* Dims a locked post and catches every click aimed at it */
                .${C.SHIELD} {
                    position: absolute !important;
                    inset: 0 !important;
                    z-index: ${L.SHIELD_Z_INDEX} !important;
                    background: rgba(0, 0, 0, ${Utils.dimOpacity()}) !important;
                    cursor: not-allowed !important;
                }

                .${C.HIDDEN} { display: none !important; }

                .${C.COUNTER} {
                    position: fixed !important;
                    right: ${L.COUNTER_OFFSET} !important;
                    bottom: ${L.COUNTER_OFFSET} !important;
                    z-index: 2147483000 !important;
                    min-height: ${L.COUNTER_MIN_HEIGHT} !important;
                    padding: ${L.COUNTER_PADDING} !important;
                    border: 0.0625rem solid ${L.COUNTER_ACCENT} !important;
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
                    outline: 0.1875rem solid ${L.COUNTER_ACCENT} !important;
                    outline-offset: 0.125rem !important;
                }
                .${C.COUNTER}[hidden] { display: none !important; }

                @media (prefers-reduced-motion: reduce) {
                    .${C.BAR_BUTTON},
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
    // CONTROLS (the bar above a marked post and the lock that keeps it unclickable)
    // ---------------------------------------------------------------
    const Controls = {
        // What you chose per post (true = locked); kept here so a re-render does not undo it
        lockChoices: new WeakMap(),

        levelOf(cell) {
            return cell.getAttribute(CONFIG.ATTRIBUTES.LEVEL);
        },

        // A post with no choice of yours yet starts as its kind of finding says
        isLocked(cell) {
            if (this.lockChoices.has(cell)) return this.lockChoices.get(cell);
            const info = CONFIG.LEVEL_INFO[this.levelOf(cell)];
            return Boolean(info && info.isLockedAtStart);
        },

        // Hidden posts have nothing to lock; only posts left on screen get a lock
        isLockAvailable(cell) {
            return CONFIG.LOCK_ADS && cell.classList.contains(CONFIG.CLASSES.FLAGGED);
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

        // Built from icon data with DOM calls, never from an HTML string
        buildIcon(parts, className) {
            const svg = document.createElementNS(CONFIG.SVG_NAMESPACE, 'svg');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('aria-hidden', 'true');
            if (className) svg.setAttribute('class', className);
            parts.forEach(([tag, attributes]) => {
                const shape = document.createElementNS(CONFIG.SVG_NAMESPACE, tag);
                Object.entries(attributes).forEach(([name, value]) => shape.setAttribute(name, value));
                svg.appendChild(shape);
            });
            return svg;
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

        // Icon, label and site; only rebuilt when what it shows has changed
        renderBarText(bar, level, site) {
            const state = `${level}|${site}`;
            if (bar.getAttribute(CONFIG.ATTRIBUTES.BAR_STATE) === state) return;
            bar.setAttribute(CONFIG.ATTRIBUTES.BAR_STATE, state);

            const info = CONFIG.LEVEL_INFO[level];
            const label = document.createElement('span');
            label.className = CONFIG.CLASSES.BAR_LABEL;
            label.textContent = info.label;

            const parts = [this.buildIcon(info.icon, CONFIG.CLASSES.BAR_ICON), label];
            if (site) {
                const siteName = document.createElement('span');
                siteName.className = CONFIG.CLASSES.BAR_SITE;
                siteName.textContent = site;
                parts.push(siteName);
            }
            bar.firstChild.replaceChildren(...parts);
        },

        // The icon shows the state: a closed padlock while locked, an open one once unlocked
        showLockIcon(button, isLocked) {
            const state = isLocked ? 'locked' : 'unlocked';
            if (button.getAttribute(CONFIG.ATTRIBUTES.ICON_STATE) === state) return;
            button.setAttribute(CONFIG.ATTRIBUTES.ICON_STATE, state);
            button.replaceChildren(this.buildIcon(isLocked ? CONFIG.ICONS.LOCKED : CONFIG.ICONS.UNLOCKED));
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
            this.lockChoices.set(cell, !this.isLocked(cell));
            this.sync(cell);
        },

        updateButton(cell, bar) {
            let button = bar.querySelector(`.${CONFIG.CLASSES.BAR_BUTTON}`);
            if (!this.isLockAvailable(cell)) {
                if (button) button.remove();
                return;
            }
            if (!button) button = this.createButton(bar, cell);

            const isLocked = this.isLocked(cell);
            this.showLockIcon(button, isLocked);
            button.title = isLocked ? CONFIG.LABELS.UNLOCK_HINT : CONFIG.LABELS.LOCK_HINT;
            button.setAttribute('aria-label', button.title);
        },

        updateShield(cell) {
            const shield = this.findPart(cell, CONFIG.CLASSES.SHIELD);
            const shouldLock = this.isLockAvailable(cell) && this.isLocked(cell);

            if (shouldLock && !shield) cell.appendChild(this.createShield());
            if (!shouldLock && shield) shield.remove();
            this.setContentInert(cell, shouldLock);
            this.setCellFocusable(cell, !shouldLock);
        },

        // Safe to call any number of times: brings the bar, button and lock in line with the current state
        sync(cell) {
            const level = this.levelOf(cell);
            if (!CONFIG.LEVEL_INFO[level]) return;

            const bar = this.findPart(cell, CONFIG.CLASSES.BAR) || this.createBar(cell);
            this.renderBarText(bar, level, cell.getAttribute(CONFIG.ATTRIBUTES.SITE) || '');
            this.updateButton(cell, bar);
            this.updateShield(cell);
        }
    };

    // ---------------------------------------------------------------
    // AD MARKER (applies the chosen mode to a post)
    // ---------------------------------------------------------------
    const AdMarker = {
        // Hide mode only removes the kinds of finding set to be hidden; the rest stay, marked
        presentationClass(level) {
            const shouldHide = CONFIG.MODE === 'hide' && CONFIG.LEVEL_INFO[level].isHiddenInHideMode;
            return shouldHide ? CONFIG.CLASSES.HIDDEN : CONFIG.CLASSES.FLAGGED;
        },

        // A post with several links keeps the strongest finding
        mark(cell, finding) {
            const attributes = CONFIG.ATTRIBUTES;
            const current = cell.getAttribute(attributes.LEVEL);
            const isUpgrade = !current || Utils.levelRank(finding.level) > Utils.levelRank(current);

            if (isUpgrade) {
                cell.setAttribute(attributes.LEVEL, finding.level);
                cell.setAttribute(attributes.SITE, finding.site);
                cell.classList.remove(CONFIG.CLASSES.FLAGGED, CONFIG.CLASSES.HIDDEN);
                cell.classList.add(this.presentationClass(finding.level));
                Logger.log('Detect', `Flagged a post as "${finding.level}" (${finding.site || 'unknown site'}).`);
            }
            // Runs every time so parts X removed while re-rendering the post are put back
            Controls.sync(cell);
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

            const finding = LinkClassifier.classify(anchor);
            if (!finding) return;

            // Links outside posts (profile bios, menus) are not part of any post
            const cell = this.findCell(anchor);
            if (!cell || this.isOpenedPost(cell)) return;
            AdMarker.mark(cell, finding);
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
