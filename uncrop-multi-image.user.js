// ==UserScript==
// @name         [Twitter] Uncrop Multi-Image Layouts
// @namespace    https://github.com/myouisaur/Twitter
// @icon         https://www.x.com/favicon.ico
// @version      10.0
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

    // 2. CONFIGURATION
    const CONFIG = {
        DEBUG: false,
        CACHE: {
            MAX_SIZE: 500
        },
        LAYOUT: {
            MAX_HEIGHT_VH: 60,
            FLEX_MULTIPLIER: 10000,
            GAP_PX: 2,
            MARGIN_TOP_PX: 12
        },
        ANIMATION: {
            RESIZE_DURATION_MS: 600,
            OBSERVER_DELAY_MS: 100
        },
        SELECTORS: {
            PHOTO: 'div[data-testid="tweetPhoto"]',
            VIDEO_OR_GIF: 'video, [data-testid="videoPlayer"], [data-testid="videoComponent"], [data-testid="playButton"]',
            ARTICLE_TAG: 'ARTICLE',
            TWEET_WRAPPER: '[data-testid="tweet"]',
            TEXT_MARKERS: '[data-testid="tweetText"], [data-testid="User-Name"], time'
        },
        CLASSES: {
            PROCESSED: 'xiv-processed',
            STYLE_ID: 'xiv-uncrop-styles',
            HIDDEN_ORIGINAL: 'xiv-hidden-original'
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
                Logger.log('Cache limit reached. Pruned oldest entry.');
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
            // Fallback if URL constructor fails
            return url.replace(/name=[^&]+/, 'name=orig');
        }
    };

    // 4. APP INITIALIZATION
    const App = {
        init() {
            Logger.log(`Initializing v${GM_info?.script?.version || '9.4'}`);
            UI.injectStyles();
            DOMProcessor.scan(document);
            Observers.start();
        }
    };

    // 5. UI & STYLING
    const UI = {
        injectStyles() {
            if (document.getElementById(CONFIG.CLASSES.STYLE_ID)) return;
            const style = document.createElement('style');
            style.id = CONFIG.CLASSES.STYLE_ID;

            style.textContent = `
                /* ADVANCED ANIMATION STATES */
                @keyframes xivShimmerPulse {
                    0% { filter: blur(4px) grayscale(30%) brightness(1); opacity: 0.8; }
                    50% { filter: blur(6px) grayscale(40%) brightness(0.9); opacity: 0.6; }
                    100% { filter: blur(4px) grayscale(30%) brightness(1); opacity: 0.8; }
                }

                .xiv-processing {
                    animation: xivShimmerPulse 1.2s infinite ease-in-out !important;
                    pointer-events: none !important;
                }

                .xiv-math-grid.xiv-animating {
                    transition: height ${(CONFIG.ANIMATION.RESIZE_DURATION_MS / 1000).toFixed(1)}s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
                }

                .xiv-grid-hidden .xiv-math-item {
                    opacity: 0 !important;
                    transform: translateY(16px) scale(0.98) !important;
                }

                /* THE MATHEMATICAL GRID SYSTEM */
                .xiv-math-grid {
                    box-sizing: border-box !important;
                    width: 100% !important;
                    max-width: calc(${CONFIG.LAYOUT.MAX_HEIGHT_VH}vh * var(--grid-aspect, 1)) !important;
                    max-height: ${CONFIG.LAYOUT.MAX_HEIGHT_VH}vh !important;
                    aspect-ratio: var(--grid-aspect) !important;
                    margin-top: ${CONFIG.LAYOUT.MARGIN_TOP_PX}px !important;
                    margin-left: auto !important;
                    margin-right: auto !important;
                    gap: ${CONFIG.LAYOUT.GAP_PX}px !important;
                    border-radius: clamp(8px, 1vw, 14px) !important;
                    overflow: hidden !important;
                    border: 1px solid rgba(128, 128, 128, 0.15) !important;
                    transform-origin: center center !important;
                }

                .xiv-math-col {
                    display: flex !important;
                    flex-direction: column !important;
                    gap: ${CONFIG.LAYOUT.GAP_PX}px !important;
                    min-width: 0 !important;
                }

                .xiv-math-row {
                    display: flex !important;
                    flex-direction: row !important;
                    gap: ${CONFIG.LAYOUT.GAP_PX}px !important;
                    min-height: 0 !important;
                }

                /* ITEM WRAPPERS */
                .xiv-math-item {
                    box-sizing: border-box !important;
                    position: relative !important;
                    display: flex !important;
                    background-color: rgba(128, 128, 128, 0.05) !important;
                    cursor: pointer !important;
                    min-height: 0 !important;
                    min-width: 0 !important;
                    overflow: hidden !important;

                    opacity: 1;
                    transform: translateY(0) scale(1);
                    transition: opacity 0.5s cubic-bezier(0.2, 0.8, 0.2, 1),
                                transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
                    transition-delay: calc(var(--stagger-idx, 0) * 60ms) !important;
                }

                .xiv-math-item:hover .xiv-custom-img {
                    opacity: 0.9 !important;
                }

                .xiv-math-grid:not(.xiv-animating) .xiv-math-item {
                    transition: none !important;
                }

                /* IMAGES */
                .xiv-custom-img {
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

                .xiv-custom-img.xiv-loaded {
                    opacity: 1;
                    transform: scale(1) !important;
                }

                .xiv-math-grid:not(.xiv-animating) .xiv-custom-img {
                    transition: opacity 0.2s ease-out !important;
                }

                /* SAFELY HIDE NATIVE ENGINE */
                .${CONFIG.CLASSES.HIDDEN_ORIGINAL} {
                    display: none !important;
                }

                @media (prefers-color-scheme: dark) {
                    .xiv-math-grid { border-color: rgba(255, 255, 255, 0.1) !important; }
                    .xiv-math-item { background-color: rgba(255, 255, 255, 0.03) !important; }
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
                grid.className = 'xiv-math-grid';

                if (!isCached) {
                    grid.classList.add('xiv-animating', 'xiv-grid-hidden');
                    grid.style.height = `${oldHeight}px`;
                }

                const count = mediaData.length;
                let finalAspect = 1;
                const flexMulti = CONFIG.LAYOUT.FLEX_MULTIPLIER;

                const createItem = (data, flexVal, index) => {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'xiv-math-item';

                    // Flex scaled up to prevent cropping / visual collapse
                    wrapper.style.flex = `${flexVal * flexMulti} 1 0%`;
                    wrapper.style.setProperty('--stagger-idx', index);
                    wrapper.setAttribute('role', 'button');
                    wrapper.setAttribute('tabindex', '0');

                    const img = document.createElement('img');
                    img.src = data.src;
                    img.alt = data.alt || '';
                    img.className = 'xiv-custom-img';
                    img.setAttribute('loading', 'lazy');
                    img.setAttribute('decoding', 'async');

                    const setLoaded = () => img.classList.add('xiv-loaded');
                    if (img.complete && img.naturalHeight !== 0) {
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

                // PURE MATHEMATICAL LAYOUT TESSELATION
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
                    rightCol.className = 'xiv-math-col';
                    rightCol.style.flex = `${flexMulti} 1 0%`;
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
                    row1.className = 'xiv-math-row';
                    row1.style.flex = `${(1 / r1) * flexMulti} 1 0%`;
                    row1.appendChild(createItem(mediaData[0], aspects[0], 0));
                    row1.appendChild(createItem(mediaData[1], aspects[1], 1));

                    const row2 = document.createElement('div');
                    row2.className = 'xiv-math-row';
                    row2.style.flex = `${(1 / r2) * flexMulti} 1 0%`;
                    row2.appendChild(createItem(mediaData[2], aspects[2], 2));
                    row2.appendChild(createItem(mediaData[3], aspects[3], 3));

                    grid.appendChild(row1);
                    grid.appendChild(row2);
                }

                grid.style.setProperty('--grid-aspect', finalAspect);
                mediaRoot.classList.remove('xiv-processing');
                mediaRoot.classList.add(CONFIG.CLASSES.HIDDEN_ORIGINAL);

                if (mediaRoot.parentNode) {
                    mediaRoot.parentNode.insertBefore(grid, mediaRoot.nextSibling);
                }

                if (!isCached) {
                    const viewportVh = window.innerHeight * (CONFIG.LAYOUT.MAX_HEIGHT_VH / 100);
                    const targetHeight = grid.offsetWidth > 0 ? Math.min(grid.offsetWidth / finalAspect, viewportVh) : oldHeight;

                    requestAnimationFrame(() => {
                        grid.classList.remove('xiv-grid-hidden');
                        grid.style.height = `${targetHeight}px`;

                        setTimeout(() => {
                            grid.classList.remove('xiv-animating');
                            grid.style.height = '';
                        }, CONFIG.ANIMATION.RESIZE_DURATION_MS);
                    });
                }

                Logger.log(`Processed layout for cache key: ${cacheKey}`);
            } catch (error) {
                Logger.error('Failed to process dimensions:', error);
            }
        }
    };

    // 7. DOM PROCESSING
    const DOMProcessor = {
        scan(scopeNode = document) {
            // Optimization: Query only within the modified scope when possible
            const unprocessedItems = scopeNode.querySelectorAll(`${CONFIG.SELECTORS.PHOTO}:not(.${CONFIG.CLASSES.PROCESSED})`);
            if (unprocessedItems.length === 0) return;

            const roots = new Set();

            unprocessedItems.forEach(item => {
                if (item.classList.contains(CONFIG.CLASSES.PROCESSED)) return;
                if (item.closest('.xiv-math-grid') || item.closest(`.${CONFIG.CLASSES.HIDDEN_ORIGINAL}`)) {
                    item.classList.add(CONFIG.CLASSES.PROCESSED);
                    return;
                }

                let current = item.parentElement;
                let mediaRoot = item;

                // Robust Traversal: Look for Article tag OR Tweet wrapper as boundaries
                while (current &&
                       current.tagName !== CONFIG.SELECTORS.ARTICLE_TAG &&
                       !current.matches(CONFIG.SELECTORS.TWEET_WRAPPER)) {

                    if (current.querySelector(CONFIG.SELECTORS.TEXT_MARKERS)) {
                        break;
                    }
                    mediaRoot = current;
                    current = current.parentElement;
                }
                roots.add(mediaRoot);
            });

            roots.forEach(mediaRoot => {
                if (mediaRoot.classList.contains(CONFIG.CLASSES.HIDDEN_ORIGINAL) || mediaRoot.classList.contains('xiv-processing')) return;

                // NATIVE QUOTE TWEET SAFEGUARD:
                // If Twitter placed the media side-by-side with text (row layout),
                // it is a native "compressed" quote tweet. Leave it entirely alone.
                if (mediaRoot.parentElement) {
                    const parentStyle = window.getComputedStyle(mediaRoot.parentElement);
                    if (parentStyle.flexDirection === 'row') {
                        const allPhotos = mediaRoot.querySelectorAll(CONFIG.SELECTORS.PHOTO);
                        allPhotos.forEach(p => p.classList.add(CONFIG.CLASSES.PROCESSED));
                        Logger.log('Ignored native row layout Quote Tweet.');
                        return;
                    }
                }

                if (mediaRoot.querySelector(CONFIG.SELECTORS.VIDEO_OR_GIF)) {
                    const allPhotos = mediaRoot.querySelectorAll(CONFIG.SELECTORS.PHOTO);
                    allPhotos.forEach(p => p.classList.add(CONFIG.CLASSES.PROCESSED));
                    return;
                }

                const groupItems = Array.from(mediaRoot.querySelectorAll(CONFIG.SELECTORS.PHOTO));
                if (groupItems.length === 0) return;

                const isReady = groupItems.every(item => {
                    const img = item.querySelector('img');
                    return img && img.src;
                });

                if (!isReady) return;

                const mediaData = groupItems.map(item => {
                    const anchor = item.closest('a');
                    if (!anchor || !/\/photo\//i.test(anchor.href)) return null;
                    const img = item.querySelector('img');
                    const src = img ? Utils.getHighResSrc(img.src) : null;
                    return {
                        originalAnchor: anchor,
                        src: src,
                        alt: img ? img.alt : ''
                    };
                }).filter(data => data && data.src);

                if (mediaData.length === 0) {
                    groupItems.forEach(p => p.classList.add(CONFIG.CLASSES.PROCESSED));
                    return;
                }

                const cacheKey = mediaData.map(d => d.src.split('?')[0]).join('|');
                groupItems.forEach(p => p.classList.add(CONFIG.CLASSES.PROCESSED));

                if (!CacheManager.has(cacheKey)) {
                    mediaRoot.classList.add('xiv-processing');
                }

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
                    const addedNodes = mutations[i].addedNodes;
                    for (let j = 0; j < addedNodes.length; j++) {
                        const node = addedNodes[j];

                        if (node.nodeType === 1) {
                            if (node.tagName === CONFIG.SELECTORS.ARTICLE_TAG ||
                                (node.matches && node.matches(CONFIG.SELECTORS.PHOTO))) {
                                // Specific container added, target scan
                                scopeNodes.add(node);
                            } else if (node.querySelector(CONFIG.SELECTORS.PHOTO)) {
                                // Broad update, fallback to full scan
                                fullScanRequired = true;
                                break;
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

            this.observer.observe(document.body, { childList: true, subtree: true });
        }
    };

    // 9. BOOTSTRAP
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', App.init);
    } else {
        App.init();
    }

})();
