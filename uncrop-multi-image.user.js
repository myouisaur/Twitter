// ==UserScript==
// @name         [Twitter] Uncrop Multi-Image Layouts
// @namespace    https://github.com/myouisaur/Twitter
// @icon         https://www.x.com/favicon.ico
// @version      11.7
// @description  Displays multi-image posts on X (Twitter) in their full original proportions without cropped edges.
// @author       Xiv
// @match        *://*.x.com/*
// @match        *://*.twitter.com/*
// @run-at       document-idle
// @noframes
// @updateURL    https://myouisaur.github.io/Twitter/uncrop-multi-image.user.js
// @downloadURL  https://myouisaur.github.io/Twitter/uncrop-multi-image.user.js
// ==/UserScript==

(function () {
    'use strict';

    // Duplicate-execution guard (also covers iFrames as a fallback to @noframes)
    const INIT_FLAG = 'xivUncropInitialized';
    if (window.top !== window.self || window[INIT_FLAG]) return;
    window[INIT_FLAG] = true;

    // ---------------------------------------------------------------
    // CONFIG
    // ---------------------------------------------------------------
    const CONFIG = {
        // Feature Flags
        DEBUG: false,

        // Logging
        LOG_PREFIX: '[Twitter Uncrop]',

        // Cache
        CACHE: {
            MAX_SIZE: 1500
        },

        // Layout
        LAYOUT: {
            MAX_HEIGHT_VH: 60,             // cap for 1-4 photos only
            LARGE_SET_MIN_COUNT: 5,        // first count that uses the balanced-rows layout, which is uncapped
            TARGET_PER_ROW: 3,             // preferred photos per row for large sets
            FLEX_MULTIPLIER: 10000,
            GAP: '0.125rem',
            MARGIN_TOP: '0',               // X's post column already spaces its children 0.75rem apart
            BORDER_WIDTH: '0.0625rem',
            BORDER_RADIUS: 'clamp(0.5rem, 1vw, 0.875rem)',
            BORDER_COLOR: 'rgba(128, 128, 128, 0.15)',
            BG_COLOR: 'rgba(128, 128, 128, 0.05)',
            BG_COLOR_DARK: 'rgba(255, 255, 255, 0.03)',
            BORDER_COLOR_DARK: 'rgba(255, 255, 255, 0.1)',
            FOCUS_COLOR: '#1d9bf0',
            FOCUS_WIDTH: '0.1875rem'
        },

        // Animation
        ANIMATION: {
            RESIZE_DURATION_MS: 600,
            STAGGER_DELAY_MS: 60,
            MAX_STAGGER_STEPS: 8,          // keeps 20-photo posts from animating for seconds
            SLIDE_OFFSET: '1.25rem'
        },

        // Timing
        TIMING: {
            OBSERVER_DELAY_MS: 100,
            IMAGE_LOAD_TIMEOUT_MS: 8000
        },

        // Selectors
        SELECTORS: {
            // X removed its data-testid attributes, so photos are found by the
            // link to the full-size photo view, which both old and new layouts have
            PHOTO: 'a[href*="/photo/"]',
            VIDEO_OR_GIF: 'video, [data-testid="videoPlayer"], [data-testid="videoComponent"], [data-testid="playButton"]',
            ARTICLE_TAG: 'ARTICLE',
            TWEET_WRAPPER: '[data-testid="tweet"], article',
            // Anything that proves a container holds more than just the photos
            TEXT_MARKERS: '[data-testid="tweetText"], [data-testid="User-Name"], time, [dir="auto"]'
        },

        // CSS Classes
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
            INSTANT: 'xiv-instant',
            UNCAPPED: 'xiv-uncapped'
        },

        // CSS Variables
        CSS_VARS: {
            ASPECT: '--xiv-grid-aspect',
            STAGGER: '--xiv-stagger-idx'
        }
    };

    // ---------------------------------------------------------------
    // UTILITIES & LOGGING
    // ---------------------------------------------------------------
    const Logger = {
        log: (module, ...args) => CONFIG.DEBUG && console.log(`${CONFIG.LOG_PREFIX}[${module}]`, ...args),
        warn: (module, ...args) => console.warn(`${CONFIG.LOG_PREFIX}[${module}]`, ...args),
        error: (module, ...args) => console.error(`${CONFIG.LOG_PREFIX}[${module}]`, ...args)
    };

    const CacheManager = {
        store: new Map(),
        get(key) {
            return this.store.get(key);
        },
        set(key, value) {
            if (this.store.size >= CONFIG.CACHE.MAX_SIZE) {
                this.store.delete(this.store.keys().next().value);
            }
            this.store.set(key, value);
        }
    };

    const Utils = {
        getHighResSrc(url) {
            if (!url) return null;
            try {
                const u = new URL(url);
                // X has no "orig" size for webp images; "large" (up to 2048px) is the best it serves
                if (u.searchParams.get('format') === 'webp') {
                    u.searchParams.set('name', 'large');
                    return u.toString();
                }
                if (u.searchParams.has('name')) {
                    u.searchParams.set('name', 'orig');
                    return u.toString();
                }
            } catch (e) {
                Logger.warn('Utils', 'Could not read an image address:', url, e);
            }
            return url.replace(/name=[^&]+/, 'name=orig');
        },

        isValidAspect(value) {
            return Number.isFinite(value) && value > 0;
        },

        sum(numbers) {
            return numbers.reduce((total, n) => total + n, 0);
        }
    };

    // ---------------------------------------------------------------
    // VIEWPORT OBSERVER (reveals grids only once they scroll into view)
    // ---------------------------------------------------------------
    const ViewportObserver = {
        observer: null,

        init() {
            this.observer = new IntersectionObserver((entries, obs) => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) return;
                    entry.target.classList.remove(CONFIG.CLASSES.GRID_HIDDEN);
                    obs.unobserve(entry.target);
                });
            }, { rootMargin: '100px 0px', threshold: 0.05 });
        },

        observe(element) {
            if (!this.observer) this.init();
            this.observer.observe(element);
        }
    };

    // ---------------------------------------------------------------
    // UI & STYLING
    // ---------------------------------------------------------------
    const UI = {
        injectStyles() {
            if (document.getElementById(CONFIG.CLASSES.STYLE_ID)) return;
            const style = document.createElement('style');
            style.id = CONFIG.CLASSES.STYLE_ID;

            const C = CONFIG.CLASSES;
            const L = CONFIG.LAYOUT;
            const A = CONFIG.ANIMATION;
            const V = CONFIG.CSS_VARS;

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

                .${C.GRID} {
                    box-sizing: border-box !important;
                    width: 100% !important;
                    max-width: calc(${L.MAX_HEIGHT_VH}vh * var(${V.ASPECT}, 1)) !important;
                    max-height: ${L.MAX_HEIGHT_VH}vh !important;
                    aspect-ratio: var(${V.ASPECT}) !important;
                    margin: ${L.MARGIN_TOP} auto 0 auto !important;
                    gap: ${L.GAP} !important;
                    border-radius: ${L.BORDER_RADIUS} !important;
                    overflow: hidden !important;
                    border: ${L.BORDER_WIDTH} solid ${L.BORDER_COLOR} !important;
                    transform-origin: center center !important;
                }

                /* Large sets keep full width and let the page scroll instead of shrinking */
                .${C.GRID}.${C.UNCAPPED} {
                    max-width: none !important;
                    max-height: none !important;
                }

                .${C.GRID}.${C.ANIMATING} {
                    transition: height ${(A.RESIZE_DURATION_MS / 1000).toFixed(1)}s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
                }

                .${C.GRID_HIDDEN} .${C.ITEM} {
                    opacity: 0 !important;
                    transform: translateY(${A.SLIDE_OFFSET}) scale(0.96) !important;
                }

                .${C.COL} { display: flex !important; flex-direction: column !important; gap: ${L.GAP} !important; min-width: 0 !important; }
                .${C.ROW} { display: flex !important; flex-direction: row !important; gap: ${L.GAP} !important; min-height: 0 !important; }

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
                    transition-delay: calc(var(${V.STAGGER}, 0) * ${A.STAGGER_DELAY_MS}ms) !important;
                }

                .${C.ITEM}:hover .${C.IMG} {
                    opacity: 0.9 !important;
                }

                .${C.ITEM}:focus-visible {
                    outline: ${L.FOCUS_WIDTH} solid ${L.FOCUS_COLOR} !important;
                    outline-offset: -${L.FOCUS_WIDTH} !important;
                }

                .${C.GRID}:not(.${C.ANIMATING}) .${C.ITEM} {
                    transition: none !important;
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

                .${C.GRID}:not(.${C.ANIMATING}) .${C.IMG} {
                    transition: opacity 0.2s ease-out !important;
                }

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

                .${C.HIDDEN_ORIGINAL} { display: none !important; }

                @media (prefers-color-scheme: dark) {
                    .${C.GRID} { border-color: ${L.BORDER_COLOR_DARK} !important; }
                    .${C.ITEM} { background-color: ${L.BG_COLOR_DARK} !important; }
                }

                @media (prefers-reduced-motion: reduce) {
                    .${C.PROCESSING},
                    .${C.GRID} .${C.ITEM},
                    .${C.GRID} .${C.IMG} {
                        transition: none !important;
                        transition-delay: 0s !important;
                        animation: none !important;
                    }
                    .${C.GRID_HIDDEN} .${C.ITEM} { opacity: 1 !important; transform: none !important; }
                    .${C.GRID} .${C.IMG} { opacity: 1 !important; transform: none !important; }
                }
            `;
            document.head.appendChild(style);
        }
    };

    // ---------------------------------------------------------------
    // ASPECT LOADER (measures each image's width/height ratio)
    // ---------------------------------------------------------------
    const AspectLoader = {
        // X now states each photo's real size in its width/height attributes, which is
        // instant and avoids downloading the full-size image just to measure it
        readDeclaredAspect(img) {
            const ratio = Number(img.getAttribute('width')) / Number(img.getAttribute('height'));
            return Utils.isValidAspect(ratio) ? ratio : null;
        },

        // Resolves to a valid ratio, or null when it could not be measured
        measure(data) {
            const native = data.nativeImg;
            const declared = native ? this.readDeclaredAspect(native) : null;
            if (declared) return Promise.resolve(declared);

            if (native && native.naturalWidth > 0 && native.naturalHeight > 0) {
                return Promise.resolve(native.naturalWidth / native.naturalHeight);
            }

            return new Promise(resolve => {
                const img = new Image();
                const timer = setTimeout(() => resolve(null), CONFIG.TIMING.IMAGE_LOAD_TIMEOUT_MS);
                const finish = (value) => {
                    clearTimeout(timer);
                    resolve(Utils.isValidAspect(value) ? value : null);
                };
                img.onload = () => finish(img.naturalWidth / img.naturalHeight);
                img.onerror = () => finish(null);
                img.src = data.src;
            });
        },

        async load(mediaData, cacheKey) {
            const measured = await Promise.all(mediaData.map(data => this.measure(data)));
            const aspects = measured.map(value => value ?? 1);

            // Only cache complete results so a temporary failure isn't remembered
            if (measured.every(value => value !== null)) {
                CacheManager.set(cacheKey, aspects);
            }
            return aspects;
        }
    };

    // ---------------------------------------------------------------
    // ROW PARTITIONER (pure math for large sets, no DOM access)
    // ---------------------------------------------------------------
    const RowPartitioner = {
        // Finds the best split point for the first `end` items into row `rowIndex`
        findBestCut(prevCosts, prefix, target, rowIndex, end) {
            let best = { cost: Infinity, start: rowIndex - 1 };
            for (let start = rowIndex - 1; start < end; start++) {
                const width = prefix[end] - prefix[start];
                const cost = prevCosts[start] + (width - target) ** 2;
                if (cost < best.cost) best = { cost, start };
            }
            return best;
        },

        // Splits ordered aspects into `rowCount` contiguous rows whose combined
        // aspect ratios are as even as possible.
        // Example: split([1.5, 1.5, 1.5, 1.5, 1.5], 2) -> [[0, 3], [3, 5]]
        split(aspects, rowCount) {
            const n = aspects.length;
            const prefix = [0];
            aspects.forEach(a => prefix.push(prefix[prefix.length - 1] + a));
            const target = prefix[n] / rowCount;

            const costs = [new Array(n + 1).fill(Infinity)];
            costs[0][0] = 0;
            const cuts = [new Array(n + 1).fill(0)];

            for (let row = 1; row <= rowCount; row++) {
                costs[row] = new Array(n + 1).fill(Infinity);
                cuts[row] = new Array(n + 1).fill(0);
                for (let end = row; end <= n; end++) {
                    const best = this.findBestCut(costs[row - 1], prefix, target, row, end);
                    costs[row][end] = best.cost;
                    cuts[row][end] = best.start;
                }
            }

            const ranges = [];
            let end = n;
            for (let row = rowCount; row >= 1; row--) {
                const start = cuts[row][end];
                ranges.unshift([start, end]);
                end = start;
            }
            return ranges;
        }
    };

    // ---------------------------------------------------------------
    // GRID BUILDER (creates the replacement layout)
    // ---------------------------------------------------------------
    const GridBuilder = {
        // Maps each tile to the original link so clicks open the native viewer
        anchors: new WeakMap(),

        createDiv(className) {
            const div = document.createElement('div');
            div.className = className;
            return div;
        },

        createItem(data, flexVal, index, isCached) {
            const wrapper = this.createDiv(CONFIG.CLASSES.ITEM);
            wrapper.style.flex = `${flexVal * CONFIG.LAYOUT.FLEX_MULTIPLIER} 1 0%`;
            wrapper.style.setProperty(CONFIG.CSS_VARS.STAGGER, Math.min(index, CONFIG.ANIMATION.MAX_STAGGER_STEPS));
            wrapper.setAttribute('role', 'button');
            wrapper.setAttribute('tabindex', '0');
            if (data.alt) wrapper.setAttribute('aria-label', data.alt);

            const img = document.createElement('img');
            img.src = data.src;
            img.alt = data.alt || '';
            img.className = CONFIG.CLASSES.IMG;
            img.setAttribute('loading', 'lazy');
            img.setAttribute('decoding', 'async');

            // If the enlarged address is refused, fall back to the address X itself loaded
            img.onerror = () => {
                if (data.fallbackSrc && img.src !== data.fallbackSrc) img.src = data.fallbackSrc;
            };

            const setLoaded = () => img.classList.add(CONFIG.CLASSES.LOADED);
            if (isCached || (img.complete && img.naturalHeight !== 0)) {
                setLoaded();
            } else {
                img.onload = setLoaded;
            }

            wrapper.appendChild(img);
            this.anchors.set(wrapper, data.originalAnchor);
            return wrapper;
        },

        // One delegated listener per grid instead of one per tile
        attachEvents(grid) {
            const openOriginal = (event) => {
                const item = event.target.closest(`.${CONFIG.CLASSES.ITEM}`);
                if (!item) return;
                event.preventDefault();
                event.stopPropagation();
                const anchor = this.anchors.get(item);
                if (anchor) anchor.click();
            };

            grid.addEventListener('click', openOriginal);
            grid.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') openOriginal(event);
            });
        },

        // --- Layout strategies: each fills the grid and returns its overall aspect ratio ---

        layoutSingle(grid, ctx) {
            grid.style.display = 'flex';
            grid.appendChild(ctx.item(0, 1));
            return ctx.aspects[0];
        },

        layoutPair(grid, ctx) {
            const [a, b] = ctx.aspects;
            grid.style.display = 'flex';
            grid.style.flexDirection = 'row';
            grid.appendChild(ctx.item(0, a));
            grid.appendChild(ctx.item(1, b));
            return a + b;
        },

        layoutTrio(grid, ctx) {
            const [a, b, c] = ctx.aspects;
            const rSum = (1 / b) + (1 / c);
            grid.style.display = 'flex';
            grid.style.flexDirection = 'row';
            grid.appendChild(ctx.item(0, a * rSum));

            const rightCol = this.createDiv(CONFIG.CLASSES.COL);
            rightCol.style.flex = `${CONFIG.LAYOUT.FLEX_MULTIPLIER} 1 0%`;
            rightCol.appendChild(ctx.item(1, 1 / b));
            rightCol.appendChild(ctx.item(2, 1 / c));
            grid.appendChild(rightCol);
            return a + (1 / rSum);
        },

        layoutRows(grid, ctx, ranges) {
            grid.style.display = 'flex';
            grid.style.flexDirection = 'column';

            let heightSum = 0;
            ranges.forEach(([start, end]) => {
                const rowAspect = Utils.sum(ctx.aspects.slice(start, end));
                heightSum += 1 / rowAspect;

                const row = this.createDiv(CONFIG.CLASSES.ROW);
                row.style.flex = `${(1 / rowAspect) * CONFIG.LAYOUT.FLEX_MULTIPLIER} 1 0%`;
                for (let i = start; i < end; i++) {
                    row.appendChild(ctx.item(i, ctx.aspects[i]));
                }
                grid.appendChild(row);
            });
            return 1 / heightSum;
        },

        // 2x2 for exactly four photos (original behavior, unchanged)
        layoutQuad(grid, ctx) {
            return this.layoutRows(grid, ctx, [[0, 2], [2, 4]]);
        },

        // Balanced rows for any larger set (5 to 20 photos, or more if X raises the limit again)
        layoutLarge(grid, ctx) {
            const count = ctx.aspects.length;
            const rowCount = Math.min(count, Math.max(2, Math.ceil(count / CONFIG.LAYOUT.TARGET_PER_ROW)));
            return this.layoutRows(grid, ctx, RowPartitioner.split(ctx.aspects, rowCount));
        },

        // Returns { grid, finalAspect, isCapped }
        build(mediaData, aspects, isCached) {
            const grid = this.createDiv(CONFIG.CLASSES.GRID);
            const ctx = {
                aspects,
                item: (index, flexVal) => this.createItem(mediaData[index], flexVal, index, isCached)
            };

            const count = mediaData.length;
            let finalAspect;
            if (count === 1) finalAspect = this.layoutSingle(grid, ctx);
            else if (count === 2) finalAspect = this.layoutPair(grid, ctx);
            else if (count === 3) finalAspect = this.layoutTrio(grid, ctx);
            else if (count === 4) finalAspect = this.layoutQuad(grid, ctx);
            else finalAspect = this.layoutLarge(grid, ctx);

            const isCapped = count < CONFIG.LAYOUT.LARGE_SET_MIN_COUNT;

            if (!Utils.isValidAspect(finalAspect) || grid.querySelector(`.${CONFIG.CLASSES.ITEM}`) === null) {
                throw new Error(`Layout for ${count} photos produced no usable result.`);
            }

            grid.style.setProperty(CONFIG.CSS_VARS.ASPECT, finalAspect);
            if (!isCapped) grid.classList.add(CONFIG.CLASSES.UNCAPPED);
            this.attachEvents(grid);
            return { grid, finalAspect, isCapped };
        }
    };

    // ---------------------------------------------------------------
    // MATH & LAYOUT ENGINE (orchestrates measuring, building, and swapping)
    // ---------------------------------------------------------------
    const MathEngine = {
        restoreOriginal(mediaRoot, grid) {
            if (grid && grid.parentNode) grid.remove();
            mediaRoot.classList.remove(CONFIG.CLASSES.PROCESSING, CONFIG.CLASSES.HIDDEN_ORIGINAL);
        },

        // Height the grid will settle at; only capped grids are limited by the viewport
        getTargetHeight(grid, finalAspect, isCapped, fallbackHeight) {
            if (grid.offsetWidth <= 0) return fallbackHeight;
            const naturalHeight = grid.offsetWidth / finalAspect;
            if (!isCapped) return naturalHeight;
            return Math.min(naturalHeight, window.innerHeight * (CONFIG.LAYOUT.MAX_HEIGHT_VH / 100));
        },

        animateIn(grid, finalAspect, isCapped, oldHeight) {
            grid.classList.add(CONFIG.CLASSES.ANIMATING, CONFIG.CLASSES.GRID_HIDDEN);
            grid.style.height = `${oldHeight}px`;

            const targetHeight = this.getTargetHeight(grid, finalAspect, isCapped, oldHeight);

            requestAnimationFrame(() => {
                grid.style.height = `${targetHeight}px`;
                setTimeout(() => {
                    grid.classList.remove(CONFIG.CLASSES.ANIMATING);
                    grid.style.height = '';
                }, CONFIG.ANIMATION.RESIZE_DURATION_MS);
            });

            ViewportObserver.observe(grid);
        },

        async process(mediaData, mediaRoot, cacheKey) {
            let grid = null;
            try {
                const oldHeight = mediaRoot.offsetHeight;
                const cached = CacheManager.get(cacheKey);
                const isCached = Array.isArray(cached);
                const aspects = isCached ? cached : await AspectLoader.load(mediaData, cacheKey);

                const built = GridBuilder.build(mediaData, aspects, isCached);
                grid = built.grid;

                // The original is hidden only after the new layout is confirmed valid
                if (!mediaRoot.parentNode) return;
                mediaRoot.parentNode.insertBefore(grid, mediaRoot.nextSibling);
                mediaRoot.classList.remove(CONFIG.CLASSES.PROCESSING);
                mediaRoot.classList.add(CONFIG.CLASSES.HIDDEN_ORIGINAL);

                if (isCached) {
                    grid.classList.add(CONFIG.CLASSES.INSTANT);
                } else {
                    this.animateIn(grid, built.finalAspect, built.isCapped, oldHeight);
                }
            } catch (error) {
                Logger.error('Layout', 'Could not rebuild this post\'s images, so the original layout was restored.', error);
                this.restoreOriginal(mediaRoot, grid);
            }
        }
    };

    // ---------------------------------------------------------------
    // DOM PROCESSING
    // ---------------------------------------------------------------
    const DOMProcessor = {
        markProcessed(photos) {
            photos.forEach(photo => photo.classList.add(CONFIG.CLASSES.PROCESSED));
        },

        // Walks up from a photo to the outermost block that holds only media
        climbToMediaRoot(item) {
            let current = item.parentElement;
            let mediaRoot = item;

            while (current &&
                   current.tagName !== CONFIG.SELECTORS.ARTICLE_TAG &&
                   !current.matches(CONFIG.SELECTORS.TWEET_WRAPPER)) {
                if (current.querySelector(CONFIG.SELECTORS.TEXT_MARKERS)) break;
                mediaRoot = current;
                current = current.parentElement;
            }
            return mediaRoot;
        },

        isFreshRoot(mediaRoot) {
            return !mediaRoot.classList.contains(CONFIG.CLASSES.HIDDEN_ORIGINAL) &&
                   !mediaRoot.classList.contains(CONFIG.CLASSES.PROCESSING);
        },

        findMediaRoots(items) {
            const roots = new Set();
            items.forEach(item => {
                if (item.classList.contains(CONFIG.CLASSES.PROCESSED)) return;
                // Photo links also appear outside posts (e.g. profile media grids), which must stay untouched
                if (!item.closest(CONFIG.SELECTORS.TWEET_WRAPPER)) return;
                const root = this.climbToMediaRoot(item);
                if (this.isFreshRoot(root)) roots.add(root);
            });
            return roots;
        },

        // Quoted-tweet media stays compact: if the tweet's first media sits outside
        // this root, this root belongs to the quoted tweet.
        isQuotedSecondaryMedia(mediaRoot) {
            const tweetWrapper = mediaRoot.closest(CONFIG.SELECTORS.TWEET_WRAPPER);
            if (!tweetWrapper) return false;
            const firstMedia = tweetWrapper.querySelector(`${CONFIG.SELECTORS.PHOTO}, ${CONFIG.SELECTORS.VIDEO_OR_GIF}`);
            return Boolean(firstMedia) && !mediaRoot.contains(firstMedia);
        },

        shouldLeaveAlone(mediaRoot) {
            return this.isQuotedSecondaryMedia(mediaRoot) ||
                   Boolean(mediaRoot.querySelector(CONFIG.SELECTORS.VIDEO_OR_GIF));
        },

        areImagesReady(groupItems) {
            return groupItems.every(item => {
                const img = item.querySelector('img');
                return img && img.src && !img.src.includes('blob:');
            });
        },

        extractMediaData(groupItems) {
            return groupItems.map(item => {
                const img = item.querySelector('img');
                return {
                    originalAnchor: item.closest('a') || item,
                    src: Utils.getHighResSrc(img.src),
                    fallbackSrc: img.src,
                    alt: img.alt || '',
                    nativeImg: img
                };
            });
        },

        processRoot(mediaRoot) {
            const allPhotos = mediaRoot.querySelectorAll(CONFIG.SELECTORS.PHOTO);

            if (this.shouldLeaveAlone(mediaRoot)) {
                this.markProcessed(allPhotos);
                return;
            }

            const groupItems = Array.from(allPhotos);
            if (groupItems.length === 0 || !this.areImagesReady(groupItems)) return;

            const mediaData = this.extractMediaData(groupItems);
            const cacheKey = mediaData.map(d => d.src.split('?')[0]).join('|');

            this.markProcessed(groupItems);
            mediaRoot.classList.add(CONFIG.CLASSES.PROCESSING);

            MathEngine.process(mediaData, mediaRoot, cacheKey).catch(error => {
                Logger.error('Layout', 'Unexpected failure while processing a post.', error);
                MathEngine.restoreOriginal(mediaRoot, null);
            });
        },

        scan(scopeNode = document) {
            const items = scopeNode.querySelectorAll(
                `${CONFIG.SELECTORS.PHOTO}:not(.${CONFIG.CLASSES.PROCESSED})`
            );
            if (items.length === 0) return;

            this.findMediaRoots(items).forEach(root => {
                try {
                    this.processRoot(root);
                } catch (error) {
                    Logger.error('Scan', 'Skipped a post because its layout could not be read. X may have changed its page structure.', error);
                }
            });
        }
    };

    // ---------------------------------------------------------------
    // OBSERVERS
    // ---------------------------------------------------------------
    const Observers = {
        observer: null,
        timer: null,
        pendingScopes: new Set(),
        pendingFullScan: false,

        isPhotoImageChange(mutation) {
            return mutation.type === 'attributes' &&
                   mutation.target.tagName === 'IMG' &&
                   Boolean(mutation.target.closest(CONFIG.SELECTORS.PHOTO));
        },

        collectAddedNode(node) {
            if (node.nodeType !== 1) return;

            if (node.tagName === CONFIG.SELECTORS.ARTICLE_TAG) {
                this.pendingScopes.add(node);
            } else if (node.matches(CONFIG.SELECTORS.PHOTO)) {
                // A scan only finds descendants, so scan from the photo's parent
                this.pendingScopes.add(node.parentElement || document);
            } else if (node.querySelector(CONFIG.SELECTORS.PHOTO)) {
                this.pendingFullScan = true;
            }
        },

        collect(mutations) {
            mutations.forEach(mutation => {
                if (this.isPhotoImageChange(mutation)) {
                    this.pendingFullScan = true;
                    return;
                }
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => this.collectAddedNode(node));
                }
            });
        },

        flush() {
            const fullScan = this.pendingFullScan;
            const scopes = Array.from(this.pendingScopes);
            this.pendingFullScan = false;
            this.pendingScopes.clear();

            if (fullScan) {
                DOMProcessor.scan(document);
                return;
            }
            scopes.forEach(scope => DOMProcessor.scan(scope));
        },

        schedule() {
            clearTimeout(this.timer);
            this.timer = setTimeout(() => {
                requestAnimationFrame(() => this.flush());
            }, CONFIG.TIMING.OBSERVER_DELAY_MS);
        },

        start() {
            this.observer = new MutationObserver((mutations) => {
                this.collect(mutations);
                if (this.pendingFullScan || this.pendingScopes.size > 0) this.schedule();
            });

            this.observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src']
            });
        }
    };

    // ---------------------------------------------------------------
    // APP BOOTSTRAP
    // ---------------------------------------------------------------
    const App = {
        init() {
            const version = typeof GM_info !== 'undefined' && GM_info.script ? GM_info.script.version : 'unknown';
            Logger.log('App', `Initializing v${version}`);
            UI.injectStyles();
            DOMProcessor.scan(document);
            Observers.start();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => App.init());
    } else {
        App.init();
    }

})();
