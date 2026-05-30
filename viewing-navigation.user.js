// ==UserScript==
// @name         [Twitter] Viewing Navigation
// @namespace    https://github.com/myouisaur/userscripts
// @icon         https://x.com/favicon.ico
// @version      2.2
// @description  Navigates Twitter image viewers using the scroll wheel, and allows clicking the background to close.
// @author       Xiv
// @match        *://*.x.com/*
// @match        *://*.twitter.com/*
// @noframes
// @updateURL    https://myouisaur.github.io/Twitter/viewing-navigation.user.js
// @downloadURL  https://myouisaur.github.io/Twitter/viewing-navigation.user.js
// ==/UserScript==

(function () {
    'use strict';

    // [Stability] Duplicate execution guard for SPA navigations
    if (window.__xivTwitterImageViewer) return;
    window.__xivTwitterImageViewer = true;

    // [Architecture] Centralized configuration
    const CONFIG = {
        SCROLL_COOLDOWN_MS: 300,       // Throttles scroll events to prevent skipping images
        DOUBLE_CLICK_DELAY_MS: 250,    // Time to wait to confirm a click isn't a double-click
        INVERT_SCROLL: false           // Set to `true` if you use macOS/trackpad "Natural Scrolling"
    };

    /**
     * Checks if the user is currently viewing media in the fullscreen viewer.
     * Fast O(1) check using the URL path to avoid heavy DOM queries.
     * @returns {boolean}
     */
    const isViewerActive = () => {
        const path = window.location.pathname;
        return path.includes('/photo/') || path.includes('/video/');
    };

    /**
     * Identifies if the event target is the main media or the structural background.
     * @param {EventTarget} target
     * @returns {boolean}
     */
    const isValidInteractionTarget = (target) => {
        if (!(target instanceof Element)) return false;

        // Target is the actual image or video element
        if (target.tagName === 'IMG' || target.tagName === 'VIDEO') return true;

        // Target is the backdrop (Primary check via Twitter's explicit ID)
        if (target.dataset.testid === 'swipe-to-dismiss') return true;

        // [Stability] Target is the backdrop (Fallback check: empty structural div not inside a button)
        if (target.tagName === 'DIV' && target.children.length === 0 && !target.closest('button, a, [role="button"]')) {
            return true;
        }

        return false;
    };

    /**
     * Simulates pressing a key to trigger Twitter's native keyboard navigation shortcuts.
     * @param {string} keyName The key identifier (e.g., 'ArrowRight', 'Escape')
     * @param {number} keyCode The numeric keycode fallback
     */
    const simulateKeyPress = (keyName, keyCode) => {
        const event = new KeyboardEvent('keydown', {
            key: keyName,
            code: keyName,
            keyCode: keyCode,
            which: keyCode,
            bubbles: true,
            cancelable: true
        });

        (document.activeElement || document.body).dispatchEvent(event);
    };

    let lastScrollTime = 0;

    /**
     * Handles mouse wheel events to navigate between previous and next images.
     * @param {WheelEvent} event
     */
    const handleWheelNavigation = (event) => {
        if (!isViewerActive() || !isValidInteractionTarget(event.target)) return;

        const now = Date.now();
        // [Performance] Prevent hyper-scrolling from processing too many times per second
        if (now - lastScrollTime < CONFIG.SCROLL_COOLDOWN_MS) return;

        const isScrollingDown = event.deltaY > 0;
        const triggerNext = CONFIG.INVERT_SCROLL ? !isScrollingDown : isScrollingDown;

        if (triggerNext) {
            simulateKeyPress('ArrowRight', 39);
        } else {
            simulateKeyPress('ArrowLeft', 37);
        }

        lastScrollTime = now;
    };

    let clickTimer = null;

    /**
     * Handles click events to close the image viewer when clicking the background or image.
     * Includes a debounce to allow native double-click-to-zoom to function normally.
     * @param {MouseEvent} event
     */
    const handleClickToClose = (event) => {
        // Ignore right clicks (button 2) and middle clicks (button 1)
        if (event.button !== 0 || !isViewerActive() || !isValidInteractionTarget(event.target)) return;

        // If a second click happens within the delay, it's a double-click. Cancel the close action.
        if (clickTimer) {
            clearTimeout(clickTimer);
            clickTimer = null;
            return;
        }

        // It's the first click. Wait briefly to ensure it isn't part of a double-click.
        clickTimer = setTimeout(() => {
            simulateKeyPress('Escape', 27);
            clickTimer = null;
        }, CONFIG.DOUBLE_CLICK_DELAY_MS);
    };

    /**
     * Initializes the script by attaching delegated event listeners to the window.
     */
    const initialize = () => {
        window.addEventListener('wheel', handleWheelNavigation, { capture: true, passive: true });
        document.addEventListener('click', handleClickToClose, { capture: true, passive: true });
    };

    initialize();

})();
