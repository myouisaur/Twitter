// ==UserScript==
// @name         [Twitter] Uncrop Multi-Image Layouts
// @namespace    https://github.com/myouisaur/X-Uncrop-Media
// @icon         https://www.x.com/favicon.ico
// @version      8.1
// @description  Uncrops multi-image posts on X (Twitter) by dynamically calculating perfect flex ratios to eliminate empty space.
// @author       Xiv
// @match        *://*.x.com/*
// @match        *://*.twitter.com/*
// @noframes
// @updateURL    https://myouisaur.github.io/Twitter/uncrop-multi-image.user.js
// @downloadURL  https://myouisaur.github.io/Twitter/uncrop-multi-image.user.js
// ==/UserScript==

(function () {
    'use strict';

    // 1. DUPLICATE EXECUTION GUARD
    if (window.top !== window.self || window.__xivUncropInitialized) return;
    window.__xivUncropInitialized = true;

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
        MAX_HEIGHT_VH: 70 // Viewport cap for all layouts
    };

    // 3. APP INITIALIZATION
    const App = {
        init() {
            UI.injectStyles();
            DOMProcessor.scan();
            Observers.start();
        }
    };

    // 4. UI & STYLING
    const UI = {
        injectStyles() {
            if (document.getElementById(CONFIG.CLASSES.STYLE_ID)) return;

            const style = document.createElement('style');
            style.id = CONFIG.CLASSES.STYLE_ID;

            style.textContent = `
                /* 1. THE MATHEMATICAL GRID SYSTEM */
                .xiv-math-grid {
                    width: 100% !important;

                    /* Dynamic scaling: Shrink width to prevent exceeding MAX_HEIGHT_VH */
                    max-width: calc(${CONFIG.MAX_HEIGHT_VH}vh * var(--grid-aspect, 1)) !important;
                    max-height: ${CONFIG.MAX_HEIGHT_VH}vh !important;
                    aspect-ratio: var(--grid-aspect) !important;

                    margin-top: 12px !important;
                    margin-left: auto !important; /* Centers the grid if scaled down */
                    margin-right: auto !important;

                    gap: 2px !important;
                    border-radius: clamp(8px, 1vw, 14px) !important;
                    overflow: hidden !important;
                    border: 1px solid rgba(128, 128, 128, 0.15) !important;
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

                /* 2. ITEM WRAPPERS */
                .xiv-math-item {
                    position: relative !important;
                    display: flex !important;
                    background-color: rgba(128, 128, 128, 0.05) !important;
                    transition: opacity 0.2s ease !important;
                    cursor: pointer !important;
                    min-height: 0 !important;
                    min-width: 0 !important;
                }

                .xiv-math-item:hover {
                    opacity: 0.9 !important;
                }

                /* 3. IMAGES (Object-fit cover maps seamlessly inside mathematically precise flex-boxes) */
                .xiv-custom-img {
                    position: absolute !important;
                    top: 0 !important;
                    left: 0 !important;
                    width: 100% !important;
                    height: 100% !important;
                    object-fit: cover !important;
                    display: block !important;
                    opacity: 0;
                    transition: opacity 0.3s ease-in;
                }

                .xiv-custom-img.xiv-loaded {
                    opacity: 1;
                }

                /* 4. SAFELY HIDE NATIVE ENGINE */
                .${CONFIG.CLASSES.HIDDEN_ORIGINAL} {
                    display: none !important;
                }

                /* 5. QUOTE TWEET OVERRIDE */
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

    // 5. MATH & LAYOUT ENGINE
    const MathEngine = {
        async process(mediaData, mediaRoot) {
            try {
                // Pre-load intrinsic dimensions asynchronously
                const dimensions = await Promise.all(mediaData.map(data => {
                    return new Promise(resolve => {
                        const img = new Image();
                        img.onload = () => resolve({ ...data, aspect: img.naturalWidth / img.naturalHeight });
                        img.onerror = () => resolve({ ...data, aspect: 1 }); // Fallback to square
                        img.src = data.src;
                    });
                }));

                const grid = document.createElement('div');
                grid.className = 'xiv-math-grid';

                const aspects = dimensions.map(d => d.aspect);
                const count = dimensions.length;
                let finalAspect = 1;

                // Component Builder
                const createItem = (data, flexVal) => {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'xiv-math-item';
                    wrapper.style.flex = `${flexVal} 1 0%`;
                    wrapper.setAttribute('role', 'button');
                    wrapper.setAttribute('tabindex', '0');

                    // Upgrade to Large URL
                    let highResSrc = data.src;
                    try {
                        const url = new URL(data.src);
                        if (url.searchParams.has('name')) {
                            url.searchParams.set('name', 'large');
                            highResSrc = url.toString();
                        }
                    } catch (e) {
                        highResSrc = data.src.replace(/name=[^&]+/, 'name=large');
                    }

                    const img = document.createElement('img');
                    img.src = highResSrc;
                    img.alt = data.alt || '';
                    img.className = 'xiv-custom-img';
                    img.setAttribute('loading', 'lazy');
                    img.setAttribute('decoding', 'async');
                    img.onload = () => img.classList.add('xiv-loaded');

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
                    grid.appendChild(createItem(dimensions[0], 1));
                }
                else if (count === 2) {
                    finalAspect = aspects[0] + aspects[1];
                    grid.style.display = 'flex';
                    grid.style.flexDirection = 'row';
                    grid.appendChild(createItem(dimensions[0], aspects[0]));
                    grid.appendChild(createItem(dimensions[1], aspects[1]));
                }
                else if (count === 3) {
                    const rSum = (1 / aspects[1]) + (1 / aspects[2]);
                    finalAspect = aspects[0] + (1 / rSum);
                    grid.style.display = 'flex';
                    grid.style.flexDirection = 'row';

                    // Left Column perfectly scales inverse to the height required by the stacked right column
                    grid.appendChild(createItem(dimensions[0], aspects[0] * rSum));

                    const rightCol = document.createElement('div');
                    rightCol.className = 'xiv-math-col';
                    rightCol.style.flex = '1 1 0%';
                    rightCol.appendChild(createItem(dimensions[1], 1 / aspects[1]));
                    rightCol.appendChild(createItem(dimensions[2], 1 / aspects[2]));
                    grid.appendChild(rightCol);
                }
                else if (count === 4) {
                    const r1 = aspects[0] + aspects[1];
                    const r2 = aspects[2] + aspects[3];
                    finalAspect = 1 / ((1 / r1) + (1 / r2));
                    grid.style.display = 'flex';
                    grid.style.flexDirection = 'column';

                    // Row weights perfectly distributed based on combined aspect ratios of enclosed items
                    const row1 = document.createElement('div');
                    row1.className = 'xiv-math-row';
                    row1.style.flex = `${1 / r1} 1 0%`;
                    row1.appendChild(createItem(dimensions[0], aspects[0]));
                    row1.appendChild(createItem(dimensions[1], aspects[1]));

                    const row2 = document.createElement('div');
                    row2.className = 'xiv-math-row';
                    row2.style.flex = `${1 / r2} 1 0%`;
                    row2.appendChild(createItem(dimensions[2], aspects[2]));
                    row2.appendChild(createItem(dimensions[3], aspects[3]));

                    grid.appendChild(row1);
                    grid.appendChild(row2);
                }

                // Pass the mathematical calculation into the CSS for responsive height-capping
                grid.style.setProperty('--grid-aspect', finalAspect);

                // Inject Custom UI and Disable Native
                mediaRoot.classList.add(CONFIG.CLASSES.HIDDEN_ORIGINAL);
                if (mediaRoot.parentNode) {
                    const isStatusPage = window.location.pathname.includes('/status/');
                    if (!isStatusPage && mediaRoot.parentNode.classList.contains('r-18u37iz')) {
                        mediaRoot.parentNode.classList.add('xiv-force-column');
                    }
                    mediaRoot.parentNode.insertBefore(grid, mediaRoot.nextSibling);
                }

            } catch (error) {
                console.warn('[Twitter Uncrop] MathEngine failed to process dimensions:', error);
            }
        }
    };

    // 6. DOM PROCESSING
    const DOMProcessor = {
        scan() {
            const unprocessedPhotos = document.querySelectorAll(`${CONFIG.SELECTORS.PHOTO}:not(.${CONFIG.CLASSES.PROCESSED})`);
            if (!unprocessedPhotos.length) return;

            unprocessedPhotos.forEach(photo => {
                if (photo.classList.contains(CONFIG.CLASSES.PROCESSED)) return;

                // Failsafe 1: Global Article Scope Check
                const article = photo.closest('article');
                if (article && article.querySelector(CONFIG.SELECTORS.VIDEO_OR_GIF)) {
                    photo.classList.add(CONFIG.CLASSES.PROCESSED);
                    return;
                }

                let current = photo.parentElement;
                let mediaRoot = photo;

                // Structural container search
                while (current && current.tagName !== 'ARTICLE') {
                    if (current.querySelector('[data-testid="tweetText"]') ||
                        current.querySelector('[data-testid="User-Name"]') ||
                        current.querySelector('time')) {
                        break;
                    }
                    mediaRoot = current;
                    current = current.parentElement;
                }

                const groupPhotos = Array.from(mediaRoot.querySelectorAll(CONFIG.SELECTORS.PHOTO));

                // Failsafe 2: Native embedded video links
                const hasVideoLink = Array.from(mediaRoot.querySelectorAll('a')).some(a => {
                    try {
                        const url = new URL(a.href, window.location.origin);
                        return url.pathname.includes('/video/');
                    } catch (e) {
                        return false;
                    }
                });

                if (hasVideoLink) {
                    groupPhotos.forEach(p => p.classList.add(CONFIG.CLASSES.PROCESSED));
                    return;
                }

                if (groupPhotos.length === 0) return;

                const isReady = groupPhotos.every(p => {
                    const img = p.querySelector('img');
                    return img && img.src;
                });

                if (!isReady) return;

                // Lock the group
                groupPhotos.forEach(p => p.classList.add(CONFIG.CLASSES.PROCESSED));

                const mediaData = groupPhotos.map(p => {
                    const anchor = p.closest('a');
                    const img = p.querySelector('img');
                    return {
                        originalAnchor: anchor,
                        src: img ? img.src : null,
                        alt: img ? img.alt : ''
                    };
                }).filter(data => data.src);

                if (mediaData.length === 0) return;

                // Pass to Math Engine
                MathEngine.process(mediaData, mediaRoot);
            });
        }
    };

    // 7. OBSERVERS
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

    // 8. BOOTSTRAP
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', App.init);
    } else {
        App.init();
    }

})();
