// ==UserScript==
// @name         [Twitter] Fluid Navigation
// @namespace    https://github.com/myouisaur/Twitter
// @icon         https://www.x.com/favicon.ico
// @version      2.1
// @description  Overrides default scrolling to smoothly glide the timeline, with directional scroll-locking friction for tall posts.
// @author       Xiv
// @match        *://*.x.com/*
// @match        *://*.twitter.com/*
// @noframes
// @updateURL    https://myouisaur.github.io/Twitter/fluid-navigation.user.js
// @downloadURL  https://myouisaur.github.io/Twitter/fluid-navigation.user.js
// ==/UserScript==

(function () {
    'use strict';

    // 1. DUPLICATE EXECUTION GUARD
    if (window.top !== window.self || window.__xivSnapInitialized) return;
    window.__xivSnapInitialized = true;

    // 2. CONFIGURATION
    const CONFIG = {
        DEBUG: false,
        TRIGGERS: {
            MOUSE_WHEEL: true,
            ARROW_KEYS: true
        },
        ANIMATION: {
            DURATION_MS: 450,        // How long the glide takes. Lower = faster.
        },
        SCROLL: {
            HEADER_OFFSET_DEFAULT: 55, // Standard timeline top nav bar
            HEADER_OFFSET_QUOTES: 100, // Taller nav bar on the /quotes pages
            TOLERANCE_PX: 10,          // Buffer zone to determine which tweet is currently "active"
            MIN_SNAP_HEIGHT_PX: 20,    // Ignore empty structural spacers Twitter uses for padding
            BRAKE_DURATION_MS: 1000    // (1 second) How long the scroll completely locks when hitting a tall boundary
        },
        GLOW: {
            HEIGHT_PX: 120,
            COLOR: 'rgba(239, 68, 68, 0.15)', // Soft Red
            Z_INDEX: 9999
        },
        SELECTORS: {
            // cellInnerDiv captures Tweets, the Reply Composer, and "Show more" buttons as distinct snap blocks
            TWEET: '[data-testid="cellInnerDiv"]',
            // Elements where we should NOT intercept scrolling natively
            IGNORE_AREAS: '[role="dialog"], #layers, [data-testid="sidebarColumn"], [data-testid="primaryColumn"] > div > div:first-child'
        },
        ENUMS: {
            DOWN: 'DOWN',
            UP: 'UP',
            BRAKE_BOTTOM: 'BRAKE_BOTTOM',
            BRAKE_TOP: 'BRAKE_TOP',
            POS_BOTTOM: 'bottom',
            POS_TOP: 'top'
        },
        KEYS: {
            ARROW_DOWN: 'ArrowDown',
            ARROW_UP: 'ArrowUp'
        }
    };

    // 3. UTILITIES
    const Logger = {
        log: (...args) => CONFIG.DEBUG && console.log('[Snap-to-Tweet]', ...args),
        warn: (...args) => console.warn('[Snap-to-Tweet][Warning]', ...args)
    };

    // 4. SPA NAVIGATION TRACKER
    const SPA = {
        lastUrl: location.href,

        init() {
            const checkUrl = () => {
                if (location.href !== this.lastUrl) {
                    Logger.log('SPA Navigation detected. Resetting engine.');
                    this.lastUrl = location.href;
                    SnapEngine.resetState();
                }
            };

            window.addEventListener('popstate', checkUrl);

            const originalPush = history.pushState;
            history.pushState = function() {
                originalPush.apply(this, arguments);
                checkUrl();
            };

            const originalReplace = history.replaceState;
            history.replaceState = function() {
                originalReplace.apply(this, arguments);
                checkUrl();
            };
        }
    };

    // 5. UI ENGINE
    const UI = {
        glowTimeout: null,

        init() {
            if (document.getElementById('xiv-snap-styles')) return;

            const style = document.createElement('style');
            style.id = 'xiv-snap-styles';
            style.textContent = `
                .xiv-brake-glow {
                    position: fixed;
                    left: 0;
                    width: 100%;
                    height: ${CONFIG.GLOW.HEIGHT_PX}px;
                    pointer-events: none;
                    z-index: ${CONFIG.GLOW.Z_INDEX};
                    opacity: 0;
                    transition: opacity 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
                }
                #xiv-brake-glow-bottom {
                    bottom: 0;
                    background: linear-gradient(to top, ${CONFIG.GLOW.COLOR} 0%, transparent 100%);
                }
                #xiv-brake-glow-top {
                    background: linear-gradient(to bottom, ${CONFIG.GLOW.COLOR} 0%, transparent 100%);
                }
                .xiv-brake-glow.xiv-active {
                    opacity: 1 !important;
                    transition: opacity 0.1s ease-out !important;
                }
            `;
            document.head.appendChild(style);

            const glowBottom = document.createElement('div');
            glowBottom.id = 'xiv-brake-glow-bottom';
            glowBottom.className = 'xiv-brake-glow';

            const glowTop = document.createElement('div');
            glowTop.id = 'xiv-brake-glow-top';
            glowTop.className = 'xiv-brake-glow';

            document.body.appendChild(glowTop);
            document.body.appendChild(glowBottom);
        },

        showGlow(position, headerOffset) {
            this.hideGlow(CONFIG.ENUMS.POS_TOP);
            this.hideGlow(CONFIG.ENUMS.POS_BOTTOM);

            const el = document.getElementById(`xiv-brake-glow-${position}`);
            if (!el) return;

            if (position === CONFIG.ENUMS.POS_TOP) {
                el.style.top = `${headerOffset}px`;
            }

            el.classList.add('xiv-active');

            this.glowTimeout = setTimeout(() => {
                this.hideGlow(position);
            }, CONFIG.SCROLL.BRAKE_DURATION_MS - 50);
        },

        hideGlow(position) {
            if (this.glowTimeout) {
                clearTimeout(this.glowTimeout);
                this.glowTimeout = null;
            }
            const el = document.getElementById(`xiv-brake-glow-${position}`);
            if (el) el.classList.remove('xiv-active');
        }
    };

    // 6. SCROLL ENGINE
    const SnapEngine = {
        isLocked: false,            // True while physically gliding
        activeBrakeDirection: null, // 'DOWN' or 'UP' when parked at a boundary
        brakeY: null,               // Exact pixel coordinate to pin the screen during a brake
        brakeTimer: null,           // Reference to the lock timer to allow early cancellation

        acknowledgedBottomItem: null,
        acknowledgedTopItem: null,

        init() {
            // MOMENTUM KILLER: Physically pin the scrollbar in place during a brake,
            // but intelligently shatter the brake if the user natively drags the scrollbar in reverse.
            window.addEventListener('scroll', () => {
                if (this.activeBrakeDirection && this.brakeY !== null) {
                    const currentY = window.scrollY;

                    if ((this.activeBrakeDirection === CONFIG.ENUMS.DOWN && currentY < this.brakeY) ||
                        (this.activeBrakeDirection === CONFIG.ENUMS.UP && currentY > this.brakeY)) {
                        this.cancelBrake(); // Natively scrolled away from boundary
                    } else {
                        window.scrollTo(0, this.brakeY); // Lock momentum
                    }
                }
            }, { passive: false });
        },

        resetState() {
            this.isLocked = false;
            this.acknowledgedTopItem = null;
            this.acknowledgedBottomItem = null;
            this.cancelBrake();
        },

        easeInOutCubic(t, b, c, d) {
            t /= d / 2;
            if (t < 1) return c / 2 * t * t * t + b;
            t -= 2;
            return c / 2 * (t * t * t + 2) + b;
        },

        glideTo(targetY) {
            if (this.isLocked) return;
            this.isLocked = true;

            const startY = window.scrollY;
            const distance = targetY - startY;
            const duration = CONFIG.ANIMATION.DURATION_MS;
            let startTime = null;

            const animation = (currentTime) => {
                if (startTime === null) startTime = currentTime;
                const timeElapsed = currentTime - startTime;

                const nextY = this.easeInOutCubic(timeElapsed, startY, distance, duration);
                window.scrollTo(0, nextY);

                if (timeElapsed < duration) {
                    requestAnimationFrame(animation);
                } else {
                    window.scrollTo(0, targetY);
                    this.isLocked = false;
                }
            };

            requestAnimationFrame(animation);
        },

        cancelBrake() {
            if (this.activeBrakeDirection) {
                Logger.log('Brake shattered by reverse input/SPA change.');
                UI.hideGlow(this.activeBrakeDirection === CONFIG.ENUMS.DOWN ? CONFIG.ENUMS.POS_BOTTOM : CONFIG.ENUMS.POS_TOP);
                if (this.brakeTimer) clearTimeout(this.brakeTimer);

                this.activeBrakeDirection = null;
                this.brakeY = null;
                this.brakeTimer = null;
            }
        },

        isSafeToHijack(event) {
            // UX Escape Hatch: Hold Shift or Alt to bypass snap behavior
            if (event.shiftKey || event.altKey) return false;

            const eventTarget = event.target;
            if (!eventTarget) return true;
            if (eventTarget.closest(CONFIG.SELECTORS.IGNORE_AREAS)) return false;

            const tagName = eventTarget.tagName?.toUpperCase();
            if (tagName === 'INPUT' || tagName === 'TEXTAREA' || eventTarget.isContentEditable) {
                return false;
            }

            return true;
        },

        getHeaderOffset() {
            if (window.location.pathname.includes('/quotes')) {
                return CONFIG.SCROLL.HEADER_OFFSET_QUOTES;
            }
            return CONFIG.SCROLL.HEADER_OFFSET_DEFAULT;
        },

        findTargetTweet(directionDown, headerOffset) {
            const items = Array.from(document.querySelectorAll(CONFIG.SELECTORS.TWEET));
            if (items.length === 0) return null;

            const rects = items.map(item => {
                const rect = item.getBoundingClientRect();
                return {
                    element: item,
                    top: rect.top,
                    bottom: rect.bottom,
                    height: rect.height,
                    absoluteY: window.scrollY + rect.top
                };
            }).filter(r => r.height > CONFIG.SCROLL.MIN_SNAP_HEIGHT_PX)
              .sort((a, b) => a.top - b.top);

            const anchorLine = headerOffset;
            const currentItem = rects.find(t => t.top <= anchorLine + CONFIG.SCROLL.TOLERANCE_PX && t.bottom > anchorLine + CONFIG.SCROLL.TOLERANCE_PX);
            const isTall = currentItem && currentItem.height > (window.innerHeight - headerOffset);

            // DRY Refactored Tracking Reset
            this.acknowledgedTopItem = directionDown ? null : this.acknowledgedTopItem;
            this.acknowledgedBottomItem = !directionDown ? null : this.acknowledgedBottomItem;

            if (isTall) {
                if (directionDown) {
                    if (currentItem.bottom > window.innerHeight + CONFIG.SCROLL.TOLERANCE_PX) {
                        this.acknowledgedBottomItem = null;
                        return null;
                    } else if (this.acknowledgedBottomItem !== currentItem.element) {
                        this.acknowledgedBottomItem = currentItem.element;
                        return CONFIG.ENUMS.BRAKE_BOTTOM;
                    }
                } else {
                    if (currentItem.top < anchorLine - CONFIG.SCROLL.TOLERANCE_PX) {
                        this.acknowledgedTopItem = null;
                        return null;
                    } else if (this.acknowledgedTopItem !== currentItem.element) {
                        this.acknowledgedTopItem = currentItem.element;
                        return CONFIG.ENUMS.BRAKE_TOP;
                    }
                }
            } else {
                this.acknowledgedTopItem = null;
                this.acknowledgedBottomItem = null;
            }

            return directionDown
                ? rects.find(t => t.top > anchorLine + CONFIG.SCROLL.TOLERANCE_PX)
                : rects.reverse().find(t => t.top < anchorLine - CONFIG.SCROLL.TOLERANCE_PX);
        },

        executeSnap(event, isDown) {
            // 1. ABSOLUTE EVENT LOCK: If actively gliding, swallow everything.
            if (this.isLocked) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            // 2. DIRECTIONAL BRAKE CHECK
            if (this.activeBrakeDirection !== null) {
                if ((this.activeBrakeDirection === CONFIG.ENUMS.DOWN && isDown) ||
                    (this.activeBrakeDirection === CONFIG.ENUMS.UP && !isDown)) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                } else {
                    this.cancelBrake();
                }
            }

            // 3. SAFETY CHECK
            if (!this.isSafeToHijack(event)) return;

            const headerOffset = this.getHeaderOffset();
            const target = this.findTargetTweet(isDown, headerOffset);

            if (target) {
                event.preventDefault();
                event.stopPropagation();

                // TRUE PHYSICAL BRAKE (Engage)
                if (target === CONFIG.ENUMS.BRAKE_BOTTOM || target === CONFIG.ENUMS.BRAKE_TOP) {
                    Logger.log(`Braking at boundary of tall element.`);

                    this.activeBrakeDirection = isDown ? CONFIG.ENUMS.DOWN : CONFIG.ENUMS.UP;
                    this.brakeY = window.scrollY;

                    UI.showGlow(isDown ? CONFIG.ENUMS.POS_BOTTOM : CONFIG.ENUMS.POS_TOP, headerOffset);

                    this.brakeTimer = setTimeout(() => {
                        this.cancelBrake();
                    }, CONFIG.SCROLL.BRAKE_DURATION_MS);

                    return;
                }

                // Standard Glide
                if (target.element) {
                    const exactDocumentY = target.absoluteY - headerOffset;
                    Logger.log(`Gliding ${isDown ? CONFIG.ENUMS.DOWN : CONFIG.ENUMS.UP} | Target Y: ${Math.round(exactDocumentY)}px`);
                    this.glideTo(exactDocumentY);
                }
            }
        }
    };

    // 7. APP BOOTSTRAP
    const App = {
        init() {
            Logger.log('Initializing Scroll Hijacker v2.1');

            SPA.init();
            UI.init();
            SnapEngine.init();

            if (CONFIG.TRIGGERS.MOUSE_WHEEL) {
                window.addEventListener('wheel', (e) => {
                    if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
                    SnapEngine.executeSnap(e, e.deltaY > 0);
                }, { passive: false });
            }

            if (CONFIG.TRIGGERS.ARROW_KEYS) {
                window.addEventListener('keydown', (e) => {
                    if (e.key === CONFIG.KEYS.ARROW_DOWN) {
                        SnapEngine.executeSnap(e, true);
                    } else if (e.key === CONFIG.KEYS.ARROW_UP) {
                        SnapEngine.executeSnap(e, false);
                    }
                }, { passive: false });
            }
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', App.init);
    } else {
        App.init();
    }

})();
