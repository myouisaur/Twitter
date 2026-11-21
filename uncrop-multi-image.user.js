// ==UserScript==
// @name         [Twitter] Uncrop Multi-Image Layouts
// @namespace    https://github.com/myouisaur/Twitter
// @icon         https://www.x.com/favicon.ico
// @version      12.1
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
        INCLUDE_VIDEO_TILES: true,         // show videos/GIFs as thumbnail tiles in mixed posts; false leaves those posts as X draws them
        OPEN_VIDEOS_VIA_PHOTO_VIEWER: true, // open a video through the normal photo viewer (normal /video/N link); false uses X's "View media" button

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
            FOCUS_WIDTH: '0.1875rem',
            BADGE_SIZE: '3rem',
            BADGE_BG: 'rgba(0, 0, 0, 0.6)',
            BADGE_BORDER: 'rgba(255, 255, 255, 0.9)',
            VIDEO_ASPECT_SEARCH_DEPTH: 2   // how far above a video to look for its real shape; further out is X's cropped carousel box
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
            IMAGE_LOAD_TIMEOUT_MS: 8000,
            MISSING_MEDIA_WAIT_MS: 4000,   // how long to wait for a late-loading video before leaving the post as X draws it
            MISSING_MEDIA_HOLD_MS: 1000,   // how long X's half-loaded layout stays hidden during that wait, so it never flashes
            VIEWER_WAIT_MS: 2000,          // how long to wait for X's viewer to open after a click
            VIEWER_POLL_MS: 100,
            VIEWER_STEP_DELAY_MS: 250      // pause before each arrow key so the viewer is ready for it
        },

        // Selectors
        SELECTORS: {
            // X removed its data-testid attributes, so photos are found by the
            // link to the full-size photo view, which both old and new layouts have
            PHOTO: 'a[href*="/photo/"]',
            // Everything that becomes a tile, in on-screen order
            MEDIA_ITEM: 'a[href*="/photo/"], video',
            // X sizes every carousel slot with an inline aspect-ratio, even before its player has loaded
            CAROUSEL_SLOT: '[style*="aspect-ratio"]',
            // X's invisible full-size button over a video, which opens the media viewer
            VIDEO_OPEN_CONTROL: '[data-slot="xds-context-menu-trigger"] > button',
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
            UNCAPPED: 'xiv-uncapped',
            PLAY_BADGE: 'xiv-play-badge',
            HOLDING: 'xiv-holding'
        },

        // Patterns
        VIEWER_PATH_PATTERN: /\/(photo|video)\/\d+/,   // the address X shows while its media viewer is open

        // Key Codes
        KEY_CODES: {
            ArrowLeft: 37,
            ArrowRight: 39
        },

        // Labels
        LABELS: {
            VIDEO: 'Play video'
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

                /* Drawn with CSS so it stays sharp at any zoom and needs no image */
                .${C.PLAY_BADGE} {
                    position: absolute !important;
                    top: 50% !important;
                    left: 50% !important;
                    width: ${L.BADGE_SIZE} !important;
                    height: ${L.BADGE_SIZE} !important;
                    transform: translate(-50%, -50%) !important;
                    border-radius: 50% !important;
                    background: ${L.BADGE_BG} !important;
                    border: 0.125rem solid ${L.BADGE_BORDER} !important;
                    box-sizing: border-box !important;
                    pointer-events: none !important;
                    z-index: 1 !important;
                }
                .${C.PLAY_BADGE}::after {
                    content: '' !important;
                    position: absolute !important;
                    top: 50% !important;
                    left: 54% !important;
                    transform: translate(-50%, -50%) !important;
                    border-style: solid !important;
                    border-width: 0.5rem 0 0.5rem 0.85rem !important;
                    border-color: transparent transparent transparent ${L.BADGE_BORDER} !important;
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

                /* Keeps the post's space while hiding X's half-loaded layout */
                .${C.HOLDING} { visibility: hidden !important; }

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
        // Resolves to a valid ratio, or null when it could not be measured
        measure(data) {
            // The page already states the real size for most media, which is instant
            // and avoids downloading an image just to measure it
            if (data.declaredAspect) return Promise.resolve(data.declaredAspect);

            const native = data.nativeImg;

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
    // MEDIA OPENER (opens X's own viewer for a clicked tile)
    // ---------------------------------------------------------------
    const MediaOpener = {
        busy: false,

        delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },

        async waitForViewer() {
            const deadline = Date.now() + CONFIG.TIMING.VIEWER_WAIT_MS;
            while (Date.now() < deadline) {
                if (CONFIG.VIEWER_PATH_PATTERN.test(window.location.pathname)) return true;
                await this.delay(CONFIG.TIMING.VIEWER_POLL_MS);
            }
            return false;
        },

        pressKey(key) {
            const target = document.activeElement || document.body;
            const init = { key, code: key, keyCode: CONFIG.KEY_CODES[key], which: CONFIG.KEY_CODES[key], bubbles: true, cancelable: true };
            target.dispatchEvent(new KeyboardEvent('keydown', init));
            target.dispatchEvent(new KeyboardEvent('keyup', init));
        },

        // X's own "View media" button for a video opens a different-looking viewer page.
        // Opening the neighbouring photo and stepping over with the arrow key gives the
        // normal viewer, exactly as clicking through by hand does. If the stepping fails,
        // the viewer simply stays on that photo.
        async openViaPhoto({ anchor, key, steps }) {
            this.busy = true;
            try {
                anchor.click();
                if (!(await this.waitForViewer())) return;
                for (let step = 0; step < steps; step++) {
                    await this.delay(CONFIG.TIMING.VIEWER_STEP_DELAY_MS);
                    this.pressKey(key);
                }
            } catch (error) {
                Logger.warn('Opener', 'Could not step to the video in the viewer. Use the viewer arrows instead.', error);
            } finally {
                this.busy = false;
            }
        },

        open(data) {
            if (this.busy) return;
            if (CONFIG.OPEN_VIDEOS_VIA_PHOTO_VIEWER && data.viaPhoto) {
                this.openViaPhoto(data.viaPhoto);
                return;
            }
            if (data.originalAnchor) data.originalAnchor.click();
        }
    };

    // ---------------------------------------------------------------
    // GRID BUILDER (creates the replacement layout)
    // ---------------------------------------------------------------
    const GridBuilder = {
        // Maps each tile to its media details so clicks open X's native viewer
        sources: new WeakMap(),

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
            const label = data.alt || (data.isVideo ? CONFIG.LABELS.VIDEO : '');
            if (label) wrapper.setAttribute('aria-label', label);

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
            if (data.isVideo) wrapper.appendChild(this.createDiv(CONFIG.CLASSES.PLAY_BADGE));
            this.sources.set(wrapper, data);
            return wrapper;
        },

        // One delegated listener per grid instead of one per tile
        attachEvents(grid) {
            const openOriginal = (event) => {
                const item = event.target.closest(`.${CONFIG.CLASSES.ITEM}`);
                if (!item) return;
                event.preventDefault();
                event.stopPropagation();
                const data = this.sources.get(item);
                if (data) MediaOpener.open(data);
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
            mediaRoot.classList.remove(CONFIG.CLASSES.PROCESSING, CONFIG.CLASSES.HIDDEN_ORIGINAL, CONFIG.CLASSES.HOLDING);
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
                mediaRoot.classList.remove(CONFIG.CLASSES.PROCESSING, CONFIG.CLASSES.HOLDING);
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
        // Bounded waiting for posts whose video has not loaded yet
        waitingSince: new WeakMap(),
        recheckScheduled: new WeakSet(),

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

        // A video can only become a tile if it has a thumbnail to show
        areVideosTileable(mediaRoot) {
            const videos = Array.from(mediaRoot.querySelectorAll('video'));
            return videos.length > 0 && videos.every(video => Boolean(video.poster));
        },

        shouldLeaveAlone(mediaRoot) {
            if (this.isQuotedSecondaryMedia(mediaRoot)) return true;
            if (!mediaRoot.querySelector(CONFIG.SELECTORS.VIDEO_OR_GIF)) return false;
            return !CONFIG.INCLUDE_VIDEO_TILES || !this.areVideosTileable(mediaRoot);
        },

        isMediaReady(item) {
            if (item.tagName === 'VIDEO') return Boolean(item.poster);
            const img = item.querySelector('img');
            return Boolean(img && img.src && !img.src.includes('blob:'));
        },

        // X states a photo's real size in its width/height attributes
        readPhotoAspect(img) {
            const ratio = Number(img.getAttribute('width')) / Number(img.getAttribute('height'));
            return Utils.isValidAspect(ratio) ? ratio : null;
        },

        // The box closest around the player carries the video's real shape; the carousel's
        // own box (further out) is a cropped version, so the search stops after a couple of levels
        readVideoAspect(video) {
            let current = video.parentElement;
            for (let depth = 0; current && depth < CONFIG.LAYOUT.VIDEO_ASPECT_SEARCH_DEPTH; depth++) {
                const parts = (current.style.aspectRatio || '').split('/').map(Number);
                const ratio = parts[0] / (parts[1] ?? 1);
                if (Utils.isValidAspect(ratio)) return ratio;
                current = current.parentElement;
            }
            return null;
        },

        extractPhotoData(anchor) {
            const img = anchor.querySelector('img');
            return {
                isVideo: false,
                originalAnchor: anchor.closest('a') || anchor,
                src: Utils.getHighResSrc(img.src),
                fallbackSrc: img.src,
                alt: img.alt || '',
                declaredAspect: this.readPhotoAspect(img),
                nativeImg: img
            };
        },

        extractVideoData(video) {
            const container = video.parentElement;
            return {
                isVideo: true,
                originalAnchor: container ? container.querySelector(CONFIG.SELECTORS.VIDEO_OPEN_CONTROL) : null,
                src: Utils.getHighResSrc(video.poster),
                fallbackSrc: video.poster,
                alt: video.getAttribute('aria-label') || '',
                declaredAspect: this.readVideoAspect(video),
                nativeImg: null
            };
        },

        // Closest photo to a video, with the arrow key and number of steps that lead from it to the video
        findNeighborPhoto(items, index) {
            for (let distance = 1; distance < items.length; distance++) {
                for (const position of [index - distance, index + distance]) {
                    const candidate = items[position];
                    if (!candidate || candidate.tagName === 'VIDEO') continue;
                    return {
                        anchor: candidate.closest('a') || candidate,
                        key: position < index ? 'ArrowRight' : 'ArrowLeft',
                        steps: distance
                    };
                }
            }
            return null;
        },

        extractMediaData(items) {
            return items.map((item, index) => {
                if (item.tagName !== 'VIDEO') return this.extractPhotoData(item);
                const data = this.extractVideoData(item);
                data.viaPhoto = this.findNeighborPhoto(items, index);
                return data;
            });
        },

        // Counts the carousel's slots: outermost boxes only, since a player's own box sits inside its slot
        countCarouselSlots(mediaRoot) {
            const sel = CONFIG.SELECTORS.CAROUSEL_SLOT;
            return Array.from(mediaRoot.querySelectorAll(sel)).filter(slot => {
                const outer = slot.parentElement ? slot.parentElement.closest(sel) : null;
                return !outer || !mediaRoot.contains(outer);
            }).length;
        },

        // X can mount a video a moment after its photos (and drop it again on re-render).
        // Building from what exists right now would hide the video, so a post with more
        // slots than loaded media is treated as "not finished loading".
        isMissingMedia(mediaRoot, loadedCount) {
            return this.countCarouselSlots(mediaRoot) > loadedCount;
        },

        getWaitedMs(mediaRoot) {
            if (!this.waitingSince.has(mediaRoot)) this.waitingSince.set(mediaRoot, Date.now());
            return Date.now() - this.waitingSince.get(mediaRoot);
        },

        // Nothing else may change on the page, so check again when the plan next changes
        scheduleRecheck(mediaRoot, delayMs) {
            if (this.recheckScheduled.has(mediaRoot)) return;
            this.recheckScheduled.add(mediaRoot);
            setTimeout(() => {
                this.recheckScheduled.delete(mediaRoot);
                if (mediaRoot.isConnected) this.scan(mediaRoot.parentElement || document);
            }, Math.max(delayMs, 0));
        },

        handleMissingMedia(mediaRoot, photos) {
            const holdMs = CONFIG.TIMING.MISSING_MEDIA_HOLD_MS;
            const limitMs = CONFIG.TIMING.MISSING_MEDIA_WAIT_MS;
            const waited = this.getWaitedMs(mediaRoot);

            if (waited >= limitMs) {
                // Leaving X's own layout is safer than a grid that is missing a video
                mediaRoot.classList.remove(CONFIG.CLASSES.HOLDING);
                Logger.log('Scan', 'A video never finished loading, so this post was left as X draws it.');
                this.markProcessed(photos);
                return;
            }

            // X's half-loaded layout is hidden at first so it never flashes on screen.
            // If the video is slow, it is shown again rather than leaving the post blank.
            const isHolding = waited < holdMs;
            mediaRoot.classList.toggle(CONFIG.CLASSES.HOLDING, isHolding);
            this.scheduleRecheck(mediaRoot, (isHolding ? holdMs : limitMs) - waited);
        },

        processRoot(mediaRoot) {
            const photos = mediaRoot.querySelectorAll(CONFIG.SELECTORS.PHOTO);

            if (this.shouldLeaveAlone(mediaRoot)) {
                this.markProcessed(photos);
                return;
            }

            // Photos and videos together, in the order X shows them
            const items = Array.from(mediaRoot.querySelectorAll(CONFIG.SELECTORS.MEDIA_ITEM));
            if (items.length === 0 || !items.every(item => this.isMediaReady(item))) return;

            if (this.isMissingMedia(mediaRoot, items.length)) {
                this.handleMissingMedia(mediaRoot, photos);
                return;
            }

            const mediaData = this.extractMediaData(items);
            const cacheKey = mediaData.map(d => d.src.split('?')[0]).join('|');

            this.markProcessed(photos);
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
        pendingScopes: new Set(),
        pendingFullScan: false,

        // A photo getting its address, or a video getting its thumbnail, may complete a waiting post
        isPhotoImageChange(mutation) {
            if (mutation.type !== 'attributes') return false;
            const target = mutation.target;
            if (target.tagName === 'VIDEO') return mutation.attributeName === 'poster';
            return target.tagName === 'IMG' && Boolean(target.closest(CONFIG.SELECTORS.PHOTO));
        },

        collectAddedNode(node) {
            if (node.nodeType !== 1) return;

            if (node.tagName === CONFIG.SELECTORS.ARTICLE_TAG) {
                this.pendingScopes.add(node);
            } else if (node.matches(CONFIG.SELECTORS.PHOTO)) {
                // A scan only finds descendants, so scan from the photo's parent
                this.pendingScopes.add(node.parentElement || document);
            } else if (node.matches('video') || node.querySelector(CONFIG.SELECTORS.MEDIA_ITEM)) {
                // A late video sits in a different slot than the photos, so only a full scan reaches them
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

        start() {
            this.observer = new MutationObserver((mutations) => {
                this.collect(mutations);
                // Runs straight away: this callback finishes before the browser paints, so a
                // post X re-renders is swapped back before its own layout can flash on screen
                if (this.pendingFullScan || this.pendingScopes.size > 0) this.flush();
            });

            this.observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src', 'poster']
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
