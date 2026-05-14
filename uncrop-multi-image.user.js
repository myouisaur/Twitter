// ==UserScript==
// @name         [Twitter] Uncrop Multi-Image Layouts
// @namespace    https://github.com/myouisaur/Twitter
// @icon         https://www.x.com/favicon.ico
// @version      7.3
// @description  Uncrops multi-image posts on X (Twitter) to display them in their original aspect ratios.
// @author       Xiv
// @match        *://*.x.com/*
// @match        *://*.twitter.com/*
// @noframes
// @updateURL    https://myouisaur.github.io/Twitter/uncrop-multi-image.user.js
// @downloadURL  https://myouisaur.github.io/Twitter/uncrop-multi-image.user.js
// ==/UserScript==

(function () {
    'use strict';

    if (window.top !== window.self || window.__xivUncropInitialized) return;
    window.__xivUncropInitialized = true;

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
        MAX_HEIGHT_VH: 70
    };

    const App = {
        init() {
            UI.injectStyles();
            DOMProcessor.scan();
            Observers.start();
        }
    };

    const UI = {
        injectStyles() {
            if (document.getElementById(CONFIG.CLASSES.STYLE_ID)) return;

            const style = document.createElement('style');
            style.id = CONFIG.CLASSES.STYLE_ID;

            style.textContent = `
                /* 1. THE SANDBOX GRID */
                .xiv-custom-grid {
                    display: grid !important;
                    gap: 2px !important;
                    margin-top: 12px !important;
                    border-radius: clamp(8px, 1vw, 14px) !important;
                    overflow: hidden !important;
                    border: 1px solid rgba(128, 128, 128, 0.15) !important;
                    max-height: ${CONFIG.MAX_HEIGHT_VH}vh !important;
                }

                /* 2. DYNAMIC LAYOUTS */
                .xiv-grid-1 { grid-template-columns: 1fr; }
                .xiv-grid-2 { grid-template-columns: 1fr 1fr; }
                .xiv-grid-3 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
                .xiv-grid-3 .xiv-item-0 { grid-row: span 2; }
                .xiv-grid-4 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }

                /* 3. THE ITEM WRAPPERS */
                .xiv-grid-item {
                    position: relative !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    background-color: rgba(128, 128, 128, 0.05) !important;
                    background-size: contain !important;
                    background-position: center !important;
                    background-repeat: no-repeat !important;
                    transition: opacity 0.2s ease !important;
                    cursor: pointer !important;
                    min-height: 0 !important;
                    min-width: 0 !important;
                }

                .xiv-grid-item:hover {
                    opacity: 0.9 !important;
                }

                /* 4. THE UNCROPPED IMAGES */
                .xiv-custom-img {
                    display: block !important;
                    width: 100% !important;
                    height: auto !important;
                    max-height: 100% !important;
                    object-fit: contain !important;
                    opacity: 0;
                    transition: opacity 0.3s ease-in;
                }

                .xiv-custom-img.xiv-loaded {
                    opacity: 1;
                }

                /* 5. SAFELY HIDE NATIVE ENGINE */
                .${CONFIG.CLASSES.HIDDEN_ORIGINAL} {
                    display: none !important;
                }

                @media (prefers-color-scheme: dark) {
                    .xiv-custom-grid { border-color: rgba(255, 255, 255, 0.1) !important; }
                    .xiv-grid-item { background-color: rgba(255, 255, 255, 0.03) !important; }
                }
            `;

            document.head.appendChild(style);
        }
    };

    const DOMProcessor = {
        scan() {
            const unprocessedPhotos = document.querySelectorAll(`${CONFIG.SELECTORS.PHOTO}:not(.${CONFIG.CLASSES.PROCESSED})`);
            if (!unprocessedPhotos.length) return;

            unprocessedPhotos.forEach(photo => {
                if (photo.classList.contains(CONFIG.CLASSES.PROCESSED)) return;

                let current = photo.parentElement;
                let mediaRoot = photo;

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

                if (mediaRoot.querySelector(CONFIG.SELECTORS.VIDEO_OR_GIF)) {
                    groupPhotos.forEach(p => p.classList.add(CONFIG.CLASSES.PROCESSED));
                    return;
                }

                if (groupPhotos.length === 0) return;

                // SPA Race Condition Fix: Verify every photo wrapper actually has an injected <img> with a src
                const isReady = groupPhotos.every(p => {
                    const img = p.querySelector('img');
                    return img && img.src;
                });

                // If React hasn't injected the images yet, abort and wait for the observer to catch them later
                if (!isReady) return;

                // Safe to process now
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

                const customGrid = document.createElement('div');
                customGrid.className = `xiv-custom-grid xiv-grid-${Math.min(mediaData.length, 4)}`;

                mediaData.forEach((data, index) => {
                    const wrapper = document.createElement('div');
                    wrapper.className = `xiv-grid-item xiv-item-${index}`;
                    wrapper.setAttribute('role', 'button');
                    wrapper.setAttribute('tabindex', '0');

                    wrapper.style.backgroundImage = `url("${data.src}")`;

                    const highResSrc = data.src.includes('name=')
                        ? data.src.replace(/name=[^&]+/, 'name=large')
                        : data.src;

                    const img = document.createElement('img');
                    img.src = highResSrc;
                    img.alt = data.alt;
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

                    customGrid.appendChild(wrapper);
                });

                mediaRoot.classList.add(CONFIG.CLASSES.HIDDEN_ORIGINAL);
                if (mediaRoot.parentNode) {
                    mediaRoot.parentNode.insertBefore(customGrid, mediaRoot.nextSibling);
                }
            });
        }
    };

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
                        // Expanded to explicitly catch <img> tags being injected late by React
                        if (node.nodeType === 1 && (
                            node.tagName === 'ARTICLE' ||
                            node.tagName === 'IMG' ||
                            node.querySelector(CONFIG.SELECTORS.PHOTO) ||
                            node.querySelector('img')
                        )) {
                            shouldScan = true; break;
                        }
                    }
                    if (shouldScan) break;
                }

                if (shouldScan) {
                    clearTimeout(this.timer);
                    this.timer = setTimeout(() => DOMProcessor.scan(), CONFIG.OBSERVER_DELAY);
                }
            });

            this.observer.observe(document.body, { childList: true, subtree: true });
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', App.init);
    } else {
        App.init();
    }

})();
