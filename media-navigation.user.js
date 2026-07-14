// ==UserScript==
// @name         [Twitter] Media Navigation
// @namespace    https://github.com/myouisaur/Twitter
// @icon         https://x.com/favicon.ico
// @version      4.0
// @description  Navigates Twitter media viewers using the scroll wheel, and allows clicking the background to close.
// @author       Xiv
// @match        *://*.x.com/*
// @match        *://*.twitter.com/*
// @noframes
// @updateURL    https://myouisaur.github.io/Twitter/media-navigation.user.js
// @downloadURL  https://myouisaur.github.io/Twitter/media-navigation.user.js
// ==/UserScript==

(function () {
    'use strict';

    // [Stability] Prevent duplicate event bindings on SPA navigation
    if (window.__xivTwitterMediaViewer) return;
    window.__xivTwitterMediaViewer = true;

    // [Architecture] Centralized configuration
    const CONFIG = {
        DEBUG_MODE: false,
        //main
        SCROLL_COOLDOWN_MS: 300,
        SCROLL_THRESHOLD_DELTA: 20,
        DOUBLE_CLICK_DELAY_MS: 250,
        INVERT_SCROLL: false,
        REACT_ROOT_SELECTORS: ['#react-root', '[data-reactroot]', 'main', 'body'],
        UI_SIZE_RATIO: 0.3,         // Elements smaller than 30% of screen width are treated as UI/Comments
        BACKDROP_HEIGHT_RATIO: 0.5  // Empty divs must be taller than 50% of screen to be a backdrop
    };

    const KEY_CODES = {
        ESCAPE: { name: 'Escape', code: 27 },
        ARROW_RIGHT: { name: 'ArrowRight', code: 39 },
        ARROW_LEFT: { name: 'ArrowLeft', code: 37 }
    };

    // [Architecture] Centralized Selectors
    const SELECTORS = {
        TIMELINE: 'article, [data-testid="tweet"]',
        UI_CONTROLS: 'button, a, [role="button"], [role="link"], [role="menuitem"]',
        VIDEO_CONTROLS: '[data-testid="videoPlayer"], [data-testid="videoComponent"], [data-testid="playButton"]',
        MODAL: 'div[aria-modal="true"]'
    };

    // Global State
    let currentViewerState = 'NONE'; // 'PHOTO', 'VIDEO', or 'NONE'
    let clickTimer = null;
    let lastScrollTime = 0;

    // --- HELPER FUNCTIONS ---

    const isTimeline = (el) => !!el.closest(SELECTORS.TIMELINE);
    const isExplicitBackdrop = (el) => el.dataset.testid === 'swipe-to-dismiss';
    const isEmptyDiv = (el) => el.tagName === 'DIV' && el.children.length === 0;

    /**
     * Checks if an element is small enough to be a genuine UI control or comment photo.
     * @param {Element} el
     */
    const isSmallElement = (el) => {
        return el.getBoundingClientRect().width < (window.innerWidth * CONFIG.UI_SIZE_RATIO);
    };

    /**
     * Evaluates the current page to determine if a media viewer is active.
     * @returns {'PHOTO' | 'VIDEO' | 'NONE'}
     */
    const determineViewerType = () => {
        const path = window.location.pathname;
        if (path.includes('/photo/')) return 'PHOTO';
        if (path.includes('/video/')) return 'VIDEO';

        const activeModal = document.querySelector(SELECTORS.MODAL);
        if (activeModal) {
            if (activeModal.querySelector('img[alt="Image"]')) return 'PHOTO';
            if (activeModal.querySelector('video')) return 'VIDEO';
        }

        return 'NONE';
    };

    /**
     * Finds the safest top-level element for dispatching key events.
     */
    const getDispatchTarget = () => {
        const rootSelector = CONFIG.REACT_ROOT_SELECTORS.find(selector => document.querySelector(selector));
        return rootSelector ? document.querySelector(rootSelector) : document.body;
    };

    /**
     * Centralized synthetic key event dispatcher.
     */
    const simulateKeyPress = (keyObj, dispatchTarget) => {
        try {
            const event = new KeyboardEvent('keydown', {
                key: keyObj.name, code: keyObj.name, keyCode: keyObj.code, which: keyObj.code,
                bubbles: true, cancelable: true
            });
            const targetElement = dispatchTarget || document.body;
            targetElement.dispatchEvent(event);
            if (CONFIG.DEBUG_MODE) console.log(`[Media Nav] Dispatched ${keyObj.name} to`, targetElement);
        } catch (err) {
            if (CONFIG.DEBUG_MODE) console.warn('[Media Nav] Failed to dispatch key event.', err);
        }
    };

    // --- MODULES ---

    /**
     * [MODULE: PHOTO] (Opt-Out)
     */
    const evaluatePhotoClick = (target) => {
        if (target.tagName === 'IMG') return !isSmallElement(target);

        const uiControl = target.closest(SELECTORS.UI_CONTROLS);
        if (uiControl) return !isSmallElement(uiControl);

        return isExplicitBackdrop(target) || isEmptyDiv(target);
    };

    /**
     * [MODULE: VIDEO] (Opt-In)
     */
    const evaluateVideoClick = (target) => {
        if (isExplicitBackdrop(target)) return true;

        if (isEmptyDiv(target)) {
            const isExcluded = target.closest(`${SELECTORS.TIMELINE}, ${SELECTORS.UI_CONTROLS}, ${SELECTORS.VIDEO_CONTROLS}`);
            return !isExcluded && (target.offsetHeight > window.innerHeight * CONFIG.BACKDROP_HEIGHT_RATIO);
        }

        return false;
    };

    // --- EVENT HANDLERS ---

    const handleWheelNavigation = (event) => {
        if (!(event.target instanceof Element)) return;

        // Allow native scrolling over comments
        if (isTimeline(event.target)) return;

        // Block native scrolling in the safe media zone to freeze the background feed
        event.preventDefault();
        event.stopPropagation();

        if (Math.abs(event.deltaY) < CONFIG.SCROLL_THRESHOLD_DELTA) return;

        const now = Date.now();
        if (now - lastScrollTime < CONFIG.SCROLL_COOLDOWN_MS) return;

        const isScrollingDown = event.deltaY > 0;
        const triggerNext = CONFIG.INVERT_SCROLL ? !isScrollingDown : isScrollingDown;

        simulateKeyPress(triggerNext ? KEY_CODES.ARROW_RIGHT : KEY_CODES.ARROW_LEFT, getDispatchTarget());
        lastScrollTime = now;
    };

    const handleClickToClose = (event) => {
        if (event.button !== 0 || !(event.target instanceof Element)) return;

        const shouldClose = currentViewerState === 'PHOTO'
            ? evaluatePhotoClick(event.target)
            : evaluateVideoClick(event.target);

        if (!shouldClose) return;

        if (clickTimer) {
            clearTimeout(clickTimer);
            clickTimer = null;
            return;
        }

        clickTimer = setTimeout(() => {
            simulateKeyPress(KEY_CODES.ESCAPE, document.activeElement || document.body);
            clickTimer = null;
        }, CONFIG.DOUBLE_CLICK_DELAY_MS);
    };

    // --- LIFECYCLE MANAGEMENT ---

    const attachListeners = () => {
        window.addEventListener('wheel', handleWheelNavigation, { capture: true, passive: false });
        document.addEventListener('click', handleClickToClose, { capture: true, passive: true });
        if (CONFIG.DEBUG_MODE) console.log(`[Media Nav] Activated for ${currentViewerState}.`);
    };

    const detachListeners = () => {
        window.removeEventListener('wheel', handleWheelNavigation, { capture: true });
        document.removeEventListener('click', handleClickToClose, { capture: true });
        if (CONFIG.DEBUG_MODE) console.log('[Media Nav] Deactivated.');
    };

    /**
     * Determines if listeners should be bound based on the cached state.
     */
    const evaluateLifecycleState = () => {
        const newState = determineViewerType();

        if (newState !== currentViewerState) {
            if (currentViewerState !== 'NONE') detachListeners();
            currentViewerState = newState;
            if (currentViewerState !== 'NONE') attachListeners();
        }
    };

    const initialize = () => {
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function (...args) {
            originalPushState.apply(this, args);
            evaluateLifecycleState();
        };

        history.replaceState = function (...args) {
            originalReplaceState.apply(this, args);
            evaluateLifecycleState();
        };

        window.addEventListener('popstate', evaluateLifecycleState);

        let debounceTimer;
        const observer = new MutationObserver(() => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(evaluateLifecycleState, 200);
        });

        observer.observe(document.body, { childList: true, subtree: true });
        evaluateLifecycleState();
    };

    initialize();

})();
