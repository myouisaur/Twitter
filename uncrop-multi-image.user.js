// ==UserScript==
// @name         [Twitter] Uncrop Multi-Image Layouts
// @namespace    https://github.com/myouisaur/Twitter
// @icon         https://www.x.com/favicon.ico
// @version      9.1
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
    window.__xivAspectCache = new Map();

    // 2. CONFIGURATION
    const CONFIG = {
        SELECTORS: {
            PHOTO: 'div[data-testid="tweetPhoto"]',
            VIDEO_OR_GIF: 'video, [data-testid="videoPlayer"], [data-testid="videoComponent"], [data-testid="playButton"]'
        },
        CLASSES: {
            PROCESSED: 'xiv-processed',
            STYLE_ID: 'xiv-uncrop-styles',
            HIDDEN_ORIGINAL: 'xiv-hidden-original'
        },
        OBSERVER_DELAY: 100,
        MAX_HEIGHT_VH: 60
    };

    // 3. UTILITIES
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
                // Fallback if URL constructor fails
            }
            return url.replace(/name=[^&]+/, 'name=orig');
        }
    };

    // 4. APP INITIALIZATION
    const App = {
        init() {
            UI.injectStyles();
            DOMProcessor.scan();
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
                    transition: height 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
                }

                .xiv-grid-hidden .xiv-math-item {
                    opacity: 0 !important;
                    transform: translateY(16px) scale(0.98) !important;
                }

                /* THE MATHEMATICAL GRID SYSTEM */
                .xiv-math-grid {
                    box-sizing: border-box !important;
                    width: 100% !important;
                    max-width: calc(${CONFIG.MAX_HEIGHT_VH}vh * var(--grid-aspect, 1)) !important;
                    max-height: ${CONFIG.MAX_HEIGHT_VH}vh !important;
                    aspect-ratio: var(--grid-aspect) !important;
                    margin-top: 12px !important;
                    margin-left: auto !important;
                    margin-right: auto !important;
                    gap: 2px !important;
                    border-radius: clamp(8px, 1vw, 14px) !important;
                    overflow: hidden !important;
                    border: 1px solid rgba(128, 128, 128, 0.15) !important;
                    transform-origin: center center !important;
                }

                .xiv-math-col {
                    display: flex !important;
                    flex-direction: column !important;
                    gap: 2px !important;
                    min-width: 0 !important;
                }

                .xiv-math-row {
                    display: flex !important;
                    flex-direction: row !important;
                    gap: 2px !important;
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

                /* QUOTE TWEET OVERRIDE */
                .xiv-force-column {
                    flex-direction: column-reverse !important;
                    align-items: stretch !important;
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
                const isCached = window.__xivAspectCache.has(cacheKey);
                let aspects;

                if (isCached) {
                    aspects = window.__xivAspectCache.get(cacheKey);
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
                    window.__xivAspectCache.set(cacheKey, aspects);
                }

                const grid = document.createElement('div');
                grid.className = 'xiv-math-grid';

                if (!isCached) {
                    grid.classList.add('xiv-animating', 'xiv-grid-hidden');
                    grid.style.height = `${oldHeight}px`;
                }

                const count = mediaData.length;
                let finalAspect = 1;

                const createItem = (data, flexVal, index) => {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'xiv-math-item';

                    // Multiply flex weights by 10000 to mathematically guarantee the flex-grow
                    // sum never drops below 1.0 (which would cause empty space and cropping).
                    wrapper.style.flex = `${flexVal * 10000} 1 0%`;

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
                    rightCol.style.flex = `${10000} 1 0%`; // Scaled equivalent to flex 1
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
                    row1.style.flex = `${(1 / r1) * 10000} 1 0%`; // Scaled correctly
                    row1.appendChild(createItem(mediaData[0], aspects[0], 0));
                    row1.appendChild(createItem(mediaData[1], aspects[1], 1));

                    const row2 = document.createElement('div');
                    row2.className = 'xiv-math-row';
                    row2.style.flex = `${(1 / r2) * 10000} 1 0%`; // Scaled correctly
                    row2.appendChild(createItem(mediaData[2], aspects[2], 2));
                    row2.appendChild(createItem(mediaData[3], aspects[3], 3));

                    grid.appendChild(row1);
                    grid.appendChild(row2);
                }

                grid.style.setProperty('--grid-aspect', finalAspect);

                mediaRoot.classList.remove('xiv-processing');
                mediaRoot.classList.add(CONFIG.CLASSES.HIDDEN_ORIGINAL);

                if (mediaRoot.parentNode) {
                    const isStatusPage = window.location.pathname.includes('/status/');
                    if (!isStatusPage && mediaRoot.parentNode.classList.contains('r-18u37iz')) {
                        mediaRoot.parentNode.classList.add('xiv-force-column');
                    }
                    mediaRoot.parentNode.insertBefore(grid, mediaRoot.nextSibling);
                }

                if (!isCached) {
                    const viewportVh = window.innerHeight * (CONFIG.MAX_HEIGHT_VH / 100);
                    const targetHeight = grid.offsetWidth > 0 ? Math.min(grid.offsetWidth / finalAspect, viewportVh) : oldHeight;

                    requestAnimationFrame(() => {
                        grid.classList.remove('xiv-grid-hidden');
                        grid.style.height = `${targetHeight}px`;

                        setTimeout(() => {
                            grid.classList.remove('xiv-animating');
                            grid.style.height = '';
                        }, 600);
                    });
                }

            } catch (error) {
                console.warn('[Twitter Uncrop] MathEngine failed to process dimensions:', error);
            }
        }
    };

    // 7. DOM PROCESSING
    const DOMProcessor = {
        scan() {
            const unprocessedItems = document.querySelectorAll(`${CONFIG.SELECTORS.PHOTO}:not(.${CONFIG.CLASSES.PROCESSED})`);
            const roots = new Set();

            unprocessedItems.forEach(item => {
                if (item.classList.contains(CONFIG.CLASSES.PROCESSED)) return;
                if (item.closest('.xiv-math-grid') || item.closest(`.${CONFIG.CLASSES.HIDDEN_ORIGINAL}`)) {
                    item.classList.add(CONFIG.CLASSES.PROCESSED);
                    return;
                }

                let current = item.parentElement;
                let mediaRoot = item;

                while (current && current.tagName !== 'ARTICLE') {
                    if (current.querySelector('[data-testid="tweetText"]') ||
                        current.querySelector('[data-testid="User-Name"]') ||
                        current.querySelector('time')) {
                        break;
                    }
                    mediaRoot = current;
                    current = current.parentElement;
                }
                roots.add(mediaRoot);
            });

            roots.forEach(mediaRoot => {
                if (mediaRoot.classList.contains(CONFIG.CLASSES.HIDDEN_ORIGINAL) || mediaRoot.classList.contains('xiv-processing')) return;

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

                if (!window.__xivAspectCache.has(cacheKey)) {
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
                let shouldScan = false;

                for (let i = 0; i < mutations.length; i++) {
                    const addedNodes = mutations[i].addedNodes;
                    for (let j = 0; j < addedNodes.length; j++) {
                        const node = addedNodes[j];

                        if (node.nodeType === 1) {
                            if (node.tagName === 'ARTICLE' ||
                                node.tagName === 'IMG' ||
                                (node.matches && node.matches(CONFIG.SELECTORS.PHOTO)) ||
                                node.querySelector(CONFIG.SELECTORS.PHOTO)) {
                                shouldScan = true;
                                break;
                            }
                        }
                    }
                    if (shouldScan) break;
                }

                if (shouldScan) {
                    clearTimeout(this.timer);
                    this.timer = setTimeout(() => {
                        requestAnimationFrame(() => DOMProcessor.scan());
                    }, CONFIG.OBSERVER_DELAY);
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
