// ==UserScript==
// @name         [Twitter] Uncrop Multi-Image Layouts
// @namespace    https://github.com/myouisaur/Twitter
// @icon         https://www.x.com/favicon.ico
// @version      11.0
// @description  Displays multi-image posts on X (Twitter) in their full original proportions without cropped edges.
// @author       Xiv
// @match        *://*.x.com/*
// @match        *://*.twitter.com/*
// @noframes
// @updateURL    https://myouisaur.github.io/Twitter/uncrop-multi-image.user.js
// @downloadURL  https://myouisaur.github.io/Twitter/uncrop-multi-image.user.js
// ==/UserScript==

(function () {
    'use strict';

    // 1. DUPLICATE EXECUTION GUARD & CACHE INIT
    if (window.top !== window.self || window.__xivUncropInitialized) return;
    window.__xivUncropInitialized = true;

    if (!window.__xivAspectCache) {
        window.__xivAspectCache = new Map();
    }

    // 2. CENTRALIZED CONFIGURATION
    const CONFIG = {
        DEBUG: false,
        CACHE: {
            MAX_SIZE: 1500 // Increased for smoother long-session scrolling
        },
        LAYOUT: {
            MAX_HEIGHT_VH: 60,
            FLEX_MULTIPLIER: 10000,
            GAP_PX: 2,
            MARGIN_TOP_PX: 12,
            BORDER_RADIUS: 'clamp(8px, 1vw, 14px)',
            BORDER_COLOR: 'rgba(128, 128, 128, 0.15)',
            BG_COLOR: 'rgba(128, 128, 128, 0.05)',
            BG_COLOR_DARK: 'rgba(255, 255, 255, 0.03)',
            BORDER_COLOR_DARK: 'rgba(255, 255, 255, 0.1)'
        },
        ANIMATION: {
            RESIZE_DURATION_MS: 600,
            OBSERVER_DELAY_MS: 100,
            STAGGER_DELAY_MS: 60,
            SLIDE_OFFSET_PX: 20
        },
        SELECTORS: {
            PHOTO: 'div[data-testid="tweetPhoto"]',
            VIDEO_OR_GIF: 'video, [data-testid="videoPlayer"], [data-testid="videoComponent"], [data-testid="playButton"]',
            ARTICLE_TAG: 'ARTICLE',
            TWEET_WRAPPER: '[data-testid="tweet"]',
            TEXT_MARKERS: '[data-testid="tweetText"], [data-testid="User-Name"], time'
        },
        CLASSES: {
            STYLE_ID: 'xiv-uncrop-styles',
            PROCESSED: 'xiv-processed',
            PROCESSING: 'xiv-processing',
            HIDDEN_ORIGINAL: 'xiv-hidden-original',
            GRID: 'xiv-math-grid',
            COL: 'xiv-math-col',
            ROW: 'xiv-math-row',
            ITEM: 'xiv-math-item',
            IMG: 'xiv-custom-img',
            LOADED: 'xiv-loaded',
            ANIMATING: 'xiv-animating',
            GRID_HIDDEN: 'xiv-grid-hidden',
            INSTANT: 'xiv-instant' // Bypass flag for cached items
        }
    };

    // 3. UTILITIES & LOGGING
    const Logger = {
        log: (...args) => CONFIG.DEBUG && console.log('[Twitter Uncrop]', ...args),
        warn: (...args) => console.warn('[Twitter Uncrop][Warning]', ...args),
        error: (...args) => console.error('[Twitter Uncrop][Error]', ...args)
    };

    const CacheManager = {
        has: (key) => window.__xivAspectCache.has(key),
        get: (key) => window.__xivAspectCache.get(key),
        set: (key, value) => {
            if (window.__xivAspectCache.size >= CONFIG.CACHE.MAX_SIZE) {
                const oldestKey = window.__xivAspectCache.keys().next().value;
                window.__xivAspectCache.delete(oldestKey);
            }
            window.__xivAspectCache.set(key, value);
        }
    };

    const Utils = {
        getHighResSrc(url) {
            if (!url) return null;
            try {
                const u = new URL(url);
                if (u.searchParams.has('name')) {
                    u.searchParams.set('name', 'orig');
                    return u.toString();
                }
            } catch (e) {
                Logger.warn('URL parsing failed for:', url, e);
            }
            return url.replace(/name=[^&]+/, 'name=orig');
        }
    };

    // 4. VIEWPORT OBSERVER (Solves the "Pop-up" bug)
    // Ensures animations only trigger when the grid actually enters the user's screen
    const ViewportObserver = {
        observer: null,
        init() {
            this.observer = new IntersectionObserver((entries, obs) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        // Reveal the grid, triggering the CSS staggered slide-up
                        entry.target.classList.remove(CONFIG.CLASSES.GRID_HIDDEN);
                        obs.unobserve(entry.target);
                    }
                });
            }, { rootMargin: '100px 0px', threshold: 0.05 });
        },
        observe(element) {
            if (!this.observer) this.init();
            this.observer.observe(element);
        }
    };

    // 5. UI & STYLING (Centralized CSS generation)
    const UI = {
        injectStyles() {
            if (document.getElementById(CONFIG.CLASSES.STYLE_ID)) return;
            const style = document.createElement('style');
            style.id = CONFIG.CLASSES.STYLE_ID;

            const C = CONFIG.CLASSES;
            const L = CONFIG.LAYOUT;
            const A = CONFIG.ANIMATION;

            style.textContent = `
                @keyframes xivShimmerPulse {
                    0% { filter: blur(4px) grayscale(30%) brightness(1); opacity: 0.8; }
                    50% { filter: blur(6px) grayscale(40%) brightness(0.9); opacity: 0.6; }
                    100% { filter: blur(4px) grayscale(30%) brightness(1); opacity: 0.8; }
                }

                .${C.PROCESSING} {
                    animation: xivShimmerPulse 1.2s infinite ease-in-out !important;
                    pointer-events: none !important;
                }

                /* Grid Foundations */
                .${C.GRID} {
                    box-sizing: border-box !important;
                    width: 100% !important;
                    max-width: calc(${L.MAX_HEIGHT_VH}vh * var(--grid-aspect, 1)) !important;
                    max-height: ${L.MAX_HEIGHT_VH}vh !important;
                    aspect-ratio: var(--grid-aspect) !important;
                    margin: ${L.MARGIN_TOP_PX}px auto 0 auto !important;
                    gap: ${L.GAP_PX}px !important;
                    border-radius: ${L.BORDER_RADIUS} !important;
                    overflow: hidden !important;
                    border: 1px solid ${L.BORDER_COLOR} !important;
                    transform-origin: center center !important;
                }

                .${C.GRID}.${C.ANIMATING} {
                    transition: height ${(A.RESIZE_DURATION_MS / 1000).toFixed(1)}s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
                }

                /* Staggered Viewport Reveal (Hidden State) */
                .${C.GRID_HIDDEN} .${C.ITEM} {
                    opacity: 0 !important;
                    transform: translateY(${A.SLIDE_OFFSET_PX}px) scale(0.96) !important;
                }

                /* Layout Structures */
                .${C.COL} { display: flex !important; flex-direction: column !important; gap: ${L.GAP_PX}px !important; min-width: 0 !important; }
                .${C.ROW} { display: flex !important; flex-direction: row !important; gap: ${L.GAP_PX}px !important; min-height: 0 !important; }

                /* Items & Images */
                .${C.ITEM} {
                    box-sizing: border-box !important;
                    position: relative !important;
                    display: flex !important;
                    background-color: ${L.BG_COLOR} !important;
                    cursor: pointer !important;
                    min-height: 0 !important;
                    min-width: 0 !important;
                    overflow: hidden !important;

                    opacity: 1;
                    transform: translateY(0) scale(1);
                    transition: opacity 0.5s cubic-bezier(0.2, 0.8, 0.2, 1),
                                transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
                    transition-delay: calc(var(--stagger-idx, 0) * ${A.STAGGER_DELAY_MS}ms) !important;
                }

                .${C.ITEM}:hover .${C.IMG} {
                    opacity: 0.9 !important;
                }

                .${C.IMG} {
                    position: absolute !important;
                    top: 0 !important;
                    left: 0 !important;
                    width: 100% !important;
                    height: 100% !important;
                    object-fit: cover !important;
                    display: block !important;
                    opacity: 0;
                    transform: scale(1.08) !important;
                    transition: opacity 0.4s ease-out,
                                transform 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
                }

                .${C.IMG}.${C.LOADED} {
                    opacity: 1;
                    transform: scale(1) !important;
                }

                /* --- CACHED SCROLL UP BYPASS (Fixes scroll reloading) --- */
                .${C.INSTANT} .${C.ITEM},
                .${C.INSTANT} .${C.IMG} {
                    transition: none !important;
                    transition-delay: 0s !important;
                    animation: none !important;
                }
                .${C.INSTANT} .${C.IMG} {
                    opacity: 1 !important;
                    transform: scale(1) !important;
                }
                /* --------------------------------------------------------- */

                .${C.HIDDEN_ORIGINAL} { display: none !important; }

                @media (prefers-color-scheme: dark) {
                    .${C.GRID} { border-color: ${L.BORDER_COLOR_DARK} !important; }
                    .${C.ITEM} { background-color: ${L.BG_COLOR_DARK} !important; }
                }
            `;
            document.head.appendChild(style);
        }
    };

    // 6. MATH & LAYOUT ENGINE
    const MathEngine = {
        async process(mediaData, mediaRoot, cacheKey) {
            try {
                const oldHeight = mediaRoot.offsetHeight;
                const isCached = CacheManager.has(cacheKey);
                let aspects;

                if (isCached) {
                    aspects = CacheManager.get(cacheKey);
                } else {
                    const dimensions = await Promise.all(mediaData.map(data => {
                        if (data.nativeImg && data.nativeImg.naturalWidth > 0) {
                            return Promise.resolve(data.nativeImg.naturalWidth / data.nativeImg.naturalHeight);
                        }
                        return new Promise(resolve => {
                            const img = new Image();
                            img.onload = () => resolve(img.naturalWidth / img.naturalHeight);
                            img.onerror = () => resolve(1);
                            img.src = data.src;
                        });
                    }));
                    aspects = dimensions;
                    CacheManager.set(cacheKey, aspects);
                }

                const grid = document.createElement('div');
                grid.className = CONFIG.CLASSES.GRID;

                // Create individual photo item wrapper
                const createItem = (data, flexVal, index) => {
                    const wrapper = document.createElement('div');
                    wrapper.className = CONFIG.CLASSES.ITEM;
                    wrapper.style.flex = `${flexVal * CONFIG.LAYOUT.FLEX_MULTIPLIER} 1 0%`;
                    wrapper.style.setProperty('--stagger-idx', index);
                    wrapper.setAttribute('role', 'button');
                    wrapper.setAttribute('tabindex', '0');

                    const img = document.createElement('img');
                    img.src = data.src;
                    img.alt = data.alt || '';
                    img.className = CONFIG.CLASSES.IMG;
                    img.setAttribute('loading', 'lazy');
                    img.setAttribute('decoding', 'async');

                    const setLoaded = () => img.classList.add(CONFIG.CLASSES.LOADED);

                    // If cached, bypass the delayed loading animation
                    if (isCached || (img.complete && img.naturalHeight !== 0)) {
                        setLoaded();
                    } else {
                        img.onload = setLoaded;
                    }

                    wrapper.appendChild(img);
                    wrapper.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (data.originalAnchor) data.originalAnchor.click();
                    });
                    return wrapper;
                };

                const count = mediaData.length;
                let finalAspect = 1;

                // Centralized layout application
                if (count === 1) {
                    finalAspect = aspects[0];
                    grid.style.display = 'flex';
                    grid.appendChild(createItem(mediaData[0], 1, 0));
                }
                else if (count === 2) {
                    finalAspect = aspects[0] + aspects[1];
                    grid.style.display = 'flex';
                    grid.style.flexDirection = 'row';
                    grid.appendChild(createItem(mediaData[0], aspects[0], 0));
                    grid.appendChild(createItem(mediaData[1], aspects[1], 1));
                }
                else if (count === 3) {
                    const rSum = (1 / aspects[1]) + (1 / aspects[2]);
                    finalAspect = aspects[0] + (1 / rSum);
                    grid.style.display = 'flex';
                    grid.style.flexDirection = 'row';
                    grid.appendChild(createItem(mediaData[0], aspects[0] * rSum, 0));

                    const rightCol = document.createElement('div');
                    rightCol.className = CONFIG.CLASSES.COL;
                    rightCol.style.flex = `${CONFIG.LAYOUT.FLEX_MULTIPLIER} 1 0%`;
                    rightCol.appendChild(createItem(mediaData[1], 1 / aspects[1], 1));
                    rightCol.appendChild(createItem(mediaData[2], 1 / aspects[2], 2));
                    grid.appendChild(rightCol);
                }
                else if (count === 4) {
                    const r1 = aspects[0] + aspects[1];
                    const r2 = aspects[2] + aspects[3];
                    finalAspect = 1 / ((1 / r1) + (1 / r2));
                    grid.style.display = 'flex';
                    grid.style.flexDirection = 'column';

                    const row1 = document.createElement('div');
                    row1.className = CONFIG.CLASSES.ROW;
                    row1.style.flex = `${(1 / r1) * CONFIG.LAYOUT.FLEX_MULTIPLIER} 1 0%`;
                    row1.appendChild(createItem(mediaData[0], aspects[0], 0));
                    row1.appendChild(createItem(mediaData[1], aspects[1], 1));

                    const row2 = document.createElement('div');
                    row2.className = CONFIG.CLASSES.ROW;
                    row2.style.flex = `${(1 / r2) * CONFIG.LAYOUT.FLEX_MULTIPLIER} 1 0%`;
                    row2.appendChild(createItem(mediaData[2], aspects[2], 2));
                    row2.appendChild(createItem(mediaData[3], aspects[3], 3));

                    grid.appendChild(row1);
                    grid.appendChild(row2);
                }

                grid.style.setProperty('--grid-aspect', finalAspect);
                mediaRoot.classList.remove(CONFIG.CLASSES.PROCESSING);
                mediaRoot.classList.add(CONFIG.CLASSES.HIDDEN_ORIGINAL);

                if (mediaRoot.parentNode) {
                    mediaRoot.parentNode.insertBefore(grid, mediaRoot.nextSibling);
                }

                // ANIMATION vs INSTANT RENDER DECISION
                if (!isCached) {
                    // Start in a hidden state, ready for ViewportObserver to reveal
                    grid.classList.add(CONFIG.CLASSES.ANIMATING, CONFIG.CLASSES.GRID_HIDDEN);
                    grid.style.height = `${oldHeight}px`;

                    const viewportVh = window.innerHeight * (CONFIG.LAYOUT.MAX_HEIGHT_VH / 100);
                    const targetHeight = grid.offsetWidth > 0 ? Math.min(grid.offsetWidth / finalAspect, viewportVh) : oldHeight;

                    requestAnimationFrame(() => {
                        grid.style.height = `${targetHeight}px`;
                        setTimeout(() => {
                            grid.classList.remove(CONFIG.CLASSES.ANIMATING);
                            grid.style.height = '';
                        }, CONFIG.ANIMATION.RESIZE_DURATION_MS);
                    });

                    // Defer the fade-in until the user actually scrolls to the grid
                    ViewportObserver.observe(grid);
                } else {
                    // Render instantly without any delays for smooth up-scrolling
                    grid.classList.add(CONFIG.CLASSES.INSTANT);
                }

            } catch (error) {
                Logger.error('Failed to process dimensions:', error);
            }
        }
    };

    // 7. DOM PROCESSING
    const DOMProcessor = {
        scan(scopeNode = document) {
            const unprocessedItems = scopeNode.querySelectorAll(
                `${CONFIG.SELECTORS.PHOTO}:not(.${CONFIG.CLASSES.PROCESSED})`
            );
            if (unprocessedItems.length === 0) return;

            const roots = new Set();
            unprocessedItems.forEach(item => {
                if (item.classList.contains(CONFIG.CLASSES.PROCESSED)) return;

                let current = item.parentElement;
                let mediaRoot = item;

                while (current &&
                       current.tagName !== CONFIG.SELECTORS.ARTICLE_TAG &&
                       !current.matches(CONFIG.SELECTORS.TWEET_WRAPPER)) {

                    if (current.querySelector(CONFIG.SELECTORS.TEXT_MARKERS)) {
                        break;
                    }
                    mediaRoot = current;
                    current = current.parentElement;
                }

                if (!mediaRoot.classList.contains(CONFIG.CLASSES.HIDDEN_ORIGINAL) &&
                    !mediaRoot.classList.contains(CONFIG.CLASSES.PROCESSING)) {
                    roots.add(mediaRoot);
                }
            });

            roots.forEach(mediaRoot => {
                const allPhotos = mediaRoot.querySelectorAll(CONFIG.SELECTORS.PHOTO);

                if (mediaRoot.parentElement && allPhotos.length === 1) {
                    const parentStyle = window.getComputedStyle(mediaRoot.parentElement);
                    if (parentStyle.flexDirection === 'row') {
                        const hasSiblings = Array.from(mediaRoot.parentElement.children).length > 1;
                        if (hasSiblings) {
                            allPhotos.forEach(p => p.classList.add(CONFIG.CLASSES.PROCESSED));
                            return;
                        }
                    }
                }

                if (mediaRoot.querySelector(CONFIG.SELECTORS.VIDEO_OR_GIF)) {
                    allPhotos.forEach(p => p.classList.add(CONFIG.CLASSES.PROCESSED));
                    return;
                }

                const groupItems = Array.from(allPhotos);
                if (groupItems.length === 0) return;

                const isReady = groupItems.every(item => {
                    const img = item.querySelector('img');
                    return img && img.src && !img.src.includes('blob:');
                });

                if (!isReady) return;

                const mediaData = groupItems.map(item => {
                    const img = item.querySelector('img');
                    const src = Utils.getHighResSrc(img.src);
                    const anchor = item.closest('a') || item;
                    return {
                        originalAnchor: anchor,
                        src: src,
                        alt: img.alt || '',
                        nativeImg: img
                    };
                });

                const cacheKey = mediaData.map(d => d.src.split('?')[0]).join('|');

                groupItems.forEach(p => p.classList.add(CONFIG.CLASSES.PROCESSED));
                mediaRoot.classList.add(CONFIG.CLASSES.PROCESSING);

                MathEngine.process(mediaData, mediaRoot, cacheKey);
            });
        }
    };

    // 8. OBSERVERS
    const Observers = {
        observer: null,
        timer: null,

        start() {
            this.observer = new MutationObserver((mutations) => {
                let scopeNodes = new Set();
                let fullScanRequired = false;

                for (let i = 0; i < mutations.length; i++) {
                    const mutation = mutations[i];

                    if (mutation.type === 'attributes' && mutation.target.tagName === 'IMG') {
                        if (mutation.target.closest(CONFIG.SELECTORS.PHOTO)) {
                            fullScanRequired = true;
                            break;
                        }
                    }
                    else if (mutation.type === 'childList') {
                        const addedNodes = mutation.addedNodes;
                        for (let j = 0; j < addedNodes.length; j++) {
                            const node = addedNodes[j];
                            if (node.nodeType === 1) {
                                if (node.tagName === CONFIG.SELECTORS.ARTICLE_TAG ||
                                    (node.matches && node.matches(CONFIG.SELECTORS.PHOTO))) {
                                    scopeNodes.add(node);
                                } else if (node.querySelector(CONFIG.SELECTORS.PHOTO)) {
                                    fullScanRequired = true;
                                    break;
                                }
                            }
                        }
                    }
                    if (fullScanRequired) break;
                }

                if (scopeNodes.size > 0 || fullScanRequired) {
                    clearTimeout(this.timer);
                    this.timer = setTimeout(() => {
                        requestAnimationFrame(() => {
                            if (fullScanRequired) {
                                DOMProcessor.scan(document);
                            } else {
                                scopeNodes.forEach(node => DOMProcessor.scan(node));
                            }
                        });
                    }, CONFIG.ANIMATION.OBSERVER_DELAY_MS);
                }
            });

            this.observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src']
            });
        }
    };

    // 9. APP BOOTSTRAP
    const App = {
        init() {
            Logger.log(`Initializing v${GM_info?.script?.version || '11.0'}`);
            UI.injectStyles();
            DOMProcessor.scan(document);
            Observers.start();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', App.init);
    } else {
        App.init();
    }

})();
