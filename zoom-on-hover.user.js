// ==UserScript==
// @name         [Twitter/X] Image Zoom on Hover
// @namespace    https://github.com/myouisaur/Twitter
// @icon         https://twitter.com/favicon.ico
// @version      2.17
// @description  Expands image presentation upon hover for enhanced visibility.
// @author       Xiv
// @match        https://*.twitter.com/*
// @match        https://*.x.com/*
// @grant        GM_addStyle
// @updateURL    https://myouisaur.github.io/Twitter/zoom-on-hover.user.js
// @downloadURL  https://myouisaur.github.io/Twitter/zoom-on-hover.user.js
// ==/UserScript==

(function () {
    'use strict';

    // --- Site Handlers ---

    const twitterHandler = {
        match: () => /twitter\.com|x\.com/.test(location.host),
        getAccentColor: () => '#8c49f5',
        injectSidebarToggle: function (accent, hoverEnabled, toggleCallback) {
            const nav = document.querySelector('[role="navigation"]');
            if (!nav) return false;
            if (nav.querySelector('#tm-img-sidebar-toggle')) return true;
            this.injectCustomToggleStyles(accent);
            const btnClasses = [
                "css-175oi2r", "r-6koalj", "r-eqz5dr", "r-16y2uox", "r-1habvwh",
                "r-cnw61z", "r-13qz1uu", "r-1loqt21", "r-1ny4l3l"
            ].join(" ");
            const flexDivClasses = "tm-img-flex css-175oi2r r-18u37iz";
            const svgClasses = [
                "img-icon",
                "r-4qtqp9", "r-yyyyoo", "r-dnmrzs", "r-bnwqim", "r-lrvibr",
                "r-m6rgpd", "r-1nao33i", "r-lwhw9o", "r-cnnz9e"
            ].join(" ");
            const labelDivClasses = [
                "css-146c3p1", "r-dnmrzs", "r-1udh08x", "r-1udbk01", "r-3s2u2q",
                "r-bcqeeo", "r-1ttztb7", "r-qvutc0", "r-1qd0xha", "r-1i10wst",
                "r-hbpseb", "r-16dba41", "r-b8s2zf", "r-1nbxd40"
            ].join(" ");
            const spanClasses = "css-1jxf684 r-bcqeeo r-1ttztb7 r-qvutc0 r-poiln3";
            let btn = document.createElement('button');
            btn.id = 'tm-img-sidebar-toggle';
            btn.type = 'button';
            btn.className = btnClasses + (hoverEnabled ? " on" : " off");
            btn.setAttribute("role", "button");
            btn.setAttribute("aria-label", "Imagus toggle");
            btn.innerHTML = `
                <div class="${flexDivClasses}">
                    <div>
                        <svg viewBox="0 0 24 24" aria-hidden="true" class="${svgClasses}">
                            <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" stroke-width="2"></rect>
                            <circle cx="8.5" cy="10.5" r="1.5" fill="currentColor"></circle>
                            <path d="M21 19l-5.5-7-4.5 6-2-2.5L3 19"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"></path>
                        </svg>
                    </div>
                    <div dir="ltr" class="${labelDivClasses}" style="color: inherit;">
                        <span class="${spanClasses}">Imagus: <span class="onoff" style="color:${hoverEnabled ? accent : "#888"};">
                            ${hoverEnabled ? 'ON' : 'OFF'}
                        </span></span>
                    </div>
                </div>
            `;
            btn.onclick = toggleCallback;
            nav.appendChild(btn);
            return true;
        },
        injectCustomToggleStyles: function (accent) {
            GM_addStyle(`
                #tm-img-sidebar-toggle {
                    padding: 11px 15px 11px 10px !important;
                    border-radius: 9999px !important;
                    background: transparent !important;
                    border: none !important;
                    cursor: pointer !important;
                    transition: background 0.18s, color 0.18s !important;
                    width: 100% !important;
                    max-width: 240px !important;
                    box-sizing: border-box !important;
                    margin: 0 0 12px 0 !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: flex-start !important;
                }
                #tm-img-sidebar-toggle.on {
                    background: rgba(140,73,245,0.11) !important;
                }
                #tm-img-sidebar-toggle.off {
                    background: transparent !important;
                }
                #tm-img-sidebar-toggle.off:focus,
                #tm-img-sidebar-toggle.off:hover {
                    background: rgba(140,73,245,0.07) !important;
                }
                #tm-img-sidebar-toggle.on:focus,
                #tm-img-sidebar-toggle.on:hover {
                    background: rgba(140,73,245,0.18) !important;
                }
                .tm-img-flex {
                    display: flex !important;
                    align-items: flex-start !important;
                    gap: 19px !important;
                    width: 100% !important;
                }
                #tm-img-sidebar-toggle .img-icon,
                #tm-img-sidebar-toggle svg {
                    width: 24px !important;
                    height: 24px !important;
                    fill: ${accent} !important;
                    transition: fill 0.18s !important;
                    margin-top: 1.5px !important;
                }
                #tm-img-sidebar-toggle.off .img-icon,
                #tm-img-sidebar-toggle.off svg {
                    fill: #888 !important;
                }
                #tm-img-sidebar-toggle .onoff {
                    font-weight: bold !important;
                }
            `);
        },
        updateSidebarToggleUI: function (hoverEnabled, accent) {
            let btn = document.getElementById('tm-img-sidebar-toggle');
            if (btn) {
                if (hoverEnabled) {
                    btn.classList.add('on');
                    btn.classList.remove('off');
                } else {
                    btn.classList.remove('on');
                    btn.classList.add('off');
                }
                const onoff = btn.querySelector('.onoff');
                if (onoff) {
                    onoff.textContent = hoverEnabled ? "ON" : "OFF";
                    onoff.style.color = hoverEnabled ? accent : "#888";
                }
            }
        },
        shouldHandleImg: function (img) {
            let src = img.src || '';
            if (img.srcset) {
                const firstSrcset = img.srcset.split(',')[0].trim().split(' ')[0];
                if (firstSrcset) src = firstSrcset;
            }
            if (!/twimg\.com\/media\//.test(src)) return false;
            if (img.closest('[aria-label="Profile"]') || img.closest('svg')) return false;
            // Removed viewport size restriction so it works for any image size
            return true;
        },
        getFullImageUrl: function (img) {
            function cleanImageUrl(url) {
                let basePart = url.split('?')[0];
                const formatMatch = url.match(/format=([a-zA-Z0-9]+)/);
                if (formatMatch) {
                    basePart = basePart.replace(/\.[a-zA-Z0-9]+$/, '');
                    basePart = basePart + '.' + formatMatch[1];
                }
                return basePart + '?name=orig';
            }
            if (img.srcset) {
                let candidates = img.srcset.split(',').map(s => s.trim().split(' '));
                let biggest = candidates
                    .map(([url, size]) => ({ url, size: parseInt((size || '0').replace('x', '')) }))
                    .sort((a, b) => b.size - a.size)[0];
                if (biggest && biggest.url) {
                    return cleanImageUrl(biggest.url);
                }
            }
            if (img.src && /twimg\.com\/media\//.test(img.src)) {
                return cleanImageUrl(img.src);
            }
            return null;
        },
        injectPopupStyles: function (accent) {
            GM_addStyle(`
                #tm-img-popup {
                    position: fixed;
                    z-index: 99999;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    pointer-events: none; /* Always none! */
                    border: 3px solid ${accent};
                    background: #000;
                    box-shadow: 0 6px 32px #000b, 0 1.5px 3px #3336;
                    border-radius: 8px;
                    max-width: 95vw;
                    max-height: 95vh;
                    opacity: 0;
                    display: block;
                    text-align: center;
                    transition: opacity 0.2s; /* 0.2 second fade for fast production */
                }
                #tm-img-popup.visible {
                    opacity: 1;
                }
                #tm-img-popup img {
                    max-width: 95vw;
                    max-height: 95vh;
                    display: block;
                    margin: 0 auto;
                    border-radius: 8px !important;
                }
                #tm-img-popup .fallback-notice {
                    color: #fff;
                    background: #d9534f;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 0.9em;
                    margin-bottom: 5px;
                    display: inline-block;
                }
            `);
        },
        ensureSidebarToggle: function (hoverEnabled, accent, toggleCallback) {
            if (this.injectSidebarToggle(accent, hoverEnabled, toggleCallback)) {
                this.updateSidebarToggleUI(hoverEnabled, accent);
                return;
            }
            const sidebarObserver = new MutationObserver((mutations, obs) => {
                if (this.injectSidebarToggle(accent, hoverEnabled, toggleCallback)) {
                    this.updateSidebarToggleUI(hoverEnabled, accent);
                    obs.disconnect();
                }
            });
            sidebarObserver.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => sidebarObserver.disconnect(), 5000);
        },
    };

    // --- Site Handler Registration ---

    const siteHandlers = [twitterHandler];
    let activeHandler = siteHandlers.find(handler => handler.match());
    if (!activeHandler) return; // Not a supported site

    let hoverEnabled = localStorage.getItem('tm-img-hover-enabled');
    hoverEnabled = hoverEnabled === null ? true : (hoverEnabled === 'true');
    let accent = activeHandler.getAccentColor();

    function coreToggleCallback(e) {
        e.preventDefault();
        hoverEnabled = !hoverEnabled;
        localStorage.setItem('tm-img-hover-enabled', hoverEnabled);
        activeHandler.updateSidebarToggleUI(hoverEnabled, accent);
        if (!hoverEnabled) hidePopup();
        e.currentTarget && e.currentTarget.blur && e.currentTarget.blur();
    }

    function ensureSidebarToggle() {
        accent = activeHandler.getAccentColor();
        activeHandler.ensureSidebarToggle(hoverEnabled, accent, coreToggleCallback);
    }
    ensureSidebarToggle();
    window.addEventListener('popstate', ensureSidebarToggle);
    document.body.addEventListener('click', () => setTimeout(ensureSidebarToggle, 250), true);

    let popup = document.createElement('div');
    popup.id = 'tm-img-popup';
    document.body.appendChild(popup);

    activeHandler.injectPopupStyles(accent);

    let currentImg = null,
        hideTimer = null,
        currentHoverImg = null;

    let fadeDuration = 200; // ms, must match CSS

    function triggerPopupForImg(target) {
        if (target && activeHandler.shouldHandleImg(target)) {
            currentHoverImg = target;
            let fallbackUrl = target.src;
            let fullImgUrl = activeHandler.getFullImageUrl(target);
            if (!hoverEnabled) return;
            if (!fullImgUrl) return;
            if (currentImg === fullImgUrl) return;
            currentImg = fullImgUrl;
            hideTimer && clearTimeout(hideTimer);
            setTimeout(() => {
                if (hoverEnabled && currentHoverImg === target) {
                    showPopup(fullImgUrl, fallbackUrl);
                }
            }, 120);
        }
    }

    document.addEventListener('mouseover', function (e) {
        let target = e.target;
        triggerPopupForImg(target);
    }, true);

    document.addEventListener('mouseout', function (e) {
        if (e.target.tagName === 'IMG' && activeHandler.shouldHandleImg(e.target)) {
            hideTimer = setTimeout(hidePopup, 100);
            currentHoverImg = null;
        }
    });

    window.addEventListener('mousedown', hidePopup, true);

    // --- CTRL key now acts as a toggle ---
    window.addEventListener('keydown', function (e) {
        if (
            e.key === "Control" &&
            !e.repeat &&
            !e.altKey && !e.shiftKey && !e.metaKey
        ) {
            hoverEnabled = !hoverEnabled;
            localStorage.setItem('tm-img-hover-enabled', hoverEnabled);
            activeHandler.updateSidebarToggleUI(hoverEnabled, accent);
            if (!hoverEnabled) {
                hidePopup();
            } else if (
                currentHoverImg && activeHandler.shouldHandleImg(currentHoverImg)
            ) {
                let fallbackUrl = currentHoverImg.src;
                let fullImgUrl = activeHandler.getFullImageUrl(currentHoverImg);
                if (fullImgUrl) {
                    currentImg = fullImgUrl;
                    showPopup(fullImgUrl, fallbackUrl);
                }
            }
        }
    });

    document.addEventListener('contextmenu', function (e) {
        let target = e.target;
        if (target.tagName === 'IMG' && activeHandler.shouldHandleImg(target)) {
            let fullImgUrl = activeHandler.getFullImageUrl(target);
            if (fullImgUrl) {
                window.open(fullImgUrl, '_blank');
                e.preventDefault();
            }
        }
    }, true);

    function showPopup(imgUrl, fallbackUrl) {
        // If popup is currently visible, fade it out first before changing content
        if (popup.classList.contains('visible')) {
            popup.classList.remove('visible');
            setTimeout(function () {
                actuallyShowPopup(imgUrl, fallbackUrl);
            }, fadeDuration);
        } else {
            actuallyShowPopup(imgUrl, fallbackUrl);
        }
    }

    function actuallyShowPopup(imgUrl, fallbackUrl) {
        popup.innerHTML = '';
        let img = document.createElement('img');
        img.src = imgUrl;
        img.onerror = function () {
            if (fallbackUrl && img.src !== fallbackUrl) {
                popup.innerHTML = `<span class="fallback-notice">Full size unavailable, showing thumbnail</span>`;
                let thumbImg = document.createElement('img');
                thumbImg.src = fallbackUrl;
                popup.appendChild(thumbImg);
            } else {
                popup.innerHTML = `<span class="fallback-notice">Image unavailable</span>`;
            }
        };
        popup.appendChild(img);

        popup.classList.remove('visible');
        void popup.offsetWidth; // force reflow so fade-in always happens
        popup.classList.add('visible');
        popup.style.display = 'block';
    }

    function hidePopup() {
        popup.classList.remove('visible');
        popup.style.display = 'block'; // always block for fade
        popup.innerHTML = '';
        currentImg = null;
    }

})();
