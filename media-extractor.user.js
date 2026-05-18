// ==UserScript==
// @name         [Twitter] Media Extractor
// @namespace    https://github.com/myouisaur/Twitter
// @icon         https://twitter.com/favicon.ico
// @version      6.6
// @description  Adds floating open and download buttons to images and videos for easy saving.
// @author       Xiv
// @match        *://*.twitter.com/*
// @match        *://*.x.com/*
// @grant        GM_addStyle
// @grant        GM_download
// @grant        GM_registerMenuCommand
// @connect      twimg.com
// @connect      video.twimg.com
// @connect      pbs.twimg.com
// @noframes
// @updateURL    https://myouisaur.github.io/Twitter/media-extractor.user.js
// @downloadURL  https://myouisaur.github.io/Twitter/media-extractor.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.__xivMediaExtractorRunning) return;
  window.__xivMediaExtractorRunning = true;

  // ==========================================================================
  // CONFIG & CONSTANTS
  // ==========================================================================
  const CONFIG = {
    DEBUG: false,
    THROTTLE_MS: 250,
    MIN_SIZE: 50,
    MAX_CACHE_SIZE: 500,
    SELECTORS: {
      IMG: 'img[src*="twimg.com"]',
      VIDEO: '[data-testid="videoComponent"], [data-testid="videoPlayer"]',
      TWEET: 'article, [data-testid="tweet"]'
    },
    CLASSES: {
      WRAPPER: 'xiv-media-wrapper',
      CONTAINER: 'xiv-btn-container',
      BTN: 'xiv-glass-btn',
      POS_LEFT: 'xiv-left',
      POS_RIGHT: 'xiv-right',
      POS_CENTER_BOT: 'xiv-center-bottom'
    },
    EXCLUDE_URLS: ['/emoji/', '/hashflags/'],
    IGNORED_JSON_KEYS: new Set(['user', 'core', 'promotedMetadata', 'clientEventInfo', 'entities', 'edit_control', 'views'])
  };

  const ICONS = {
    OPEN: 'M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
    DOWNLOAD: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
    PLAY: 'M8 5v14l11-7z',
    SPINNER: 'M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z'
  };

  const videoCache = new Map();

  // ==========================================================================
  // MODULE 1: HELPERS & UTILITIES
  // ==========================================================================
  function log(...args) {
    if (CONFIG.DEBUG) console.log('[Media Extractor]', ...args);
  }

  function showToast(message) {
    let container = document.getElementById('xiv-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'xiv-toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'xiv-toast';
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('xiv-visible'));
    setTimeout(() => {
      toast.classList.remove('xiv-visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function createIcon(pathData, isSpinner = false) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    if (isSpinner) svg.classList.add('xiv-spin');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    svg.appendChild(path);
    return svg;
  }

  function genRandom(len = 10) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  function forceLargeUrl(url) {
    if (!url.includes('twimg.com')) return { url, ext: 'jpg' };
    const base = url.split('?')[0];

    let ext = 'jpg';
    const formatMatch = url.match(/format=([a-zA-Z]+)/);
    if (formatMatch && formatMatch[1]) {
      ext = formatMatch[1];
    } else {
      const pathExtMatch = base.match(/\.([a-zA-Z0-9]+)$/);
      if (pathExtMatch && pathExtMatch[1]) ext = pathExtMatch[1];
    }

    if (/\/profile_banners\//.test(base)) return { url: base.replace(/\/\d+x\d+$/, '/1500x500'), ext };
    if (/\/profile_images\//.test(base)) return { url: base, ext };

    if (/\/media\//.test(base) || /\/video_thumb\//.test(base) || /\/ext_tw_video_thumb\//.test(base) || /\/amplify_video_thumb\//.test(base)) {
      const cleanBase = base.replace(/:(small|medium|large|thumb)$/, '');
      return { url: `${cleanBase}?format=${ext}&name=orig`, ext };
    }
    return { url, ext };
  }

  function getTweetIdFromElement(el) {
    const tweetContainer = el.closest(CONFIG.SELECTORS.TWEET);
    if (tweetContainer) {
      const link = tweetContainer.querySelector('a[href*="/status/"]');
      if (link) {
        const match = link.href.match(/\/status\/(\d+)/);
        if (match) return match[1];
      }
    }
    const urlMatch = window.location.pathname.match(/\/status\/(\d+)/);
    return urlMatch ? urlMatch[1] : null;
  }

  // Extracted core download routines to prevent duplicate closures
  function restoreBtn(btnElement, iconPathData) {
    btnElement.replaceChildren(createIcon(iconPathData));
    btnElement.style.pointerEvents = '';
  }

  async function fallbackDownload(url, filename, btnElement, iconPathData) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Fetch failed.');
      const blob = await response.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err) {
      log('Fallback download failed, opening new tab.', err);
      window.open(url, '_blank');
    } finally {
      restoreBtn(btnElement, iconPathData);
    }
  }

  function downloadMedia(url, filename, btnElement, iconPathData) {
    if (!url) return;

    btnElement.replaceChildren(createIcon(ICONS.SPINNER, true));
    btnElement.style.pointerEvents = 'none';

    if (typeof GM_download === 'function') {
      let lastUpdate = 0;
      GM_download({
        url: url,
        name: filename,
        onprogress: (e) => {
          if (e.lengthComputable) {
            const now = Date.now();
            if (now - lastUpdate > 150) {
              const percent = Math.floor((e.loaded / e.total) * 100);
              const span = document.createElement('span');
              span.className = 'xiv-progress-text';
              span.textContent = `${percent}%`;
              btnElement.replaceChildren(span);
              lastUpdate = now;
            }
          }
        },
        onload: () => restoreBtn(btnElement, iconPathData),
        onerror: (err) => {
          log('GM_download failed, using fallback', err);
          fallbackDownload(url, filename, btnElement, iconPathData);
        },
        ontimeout: () => fallbackDownload(url, filename, btnElement, iconPathData)
      });
    } else {
      fallbackDownload(url, filename, btnElement, iconPathData);
    }
  }

  // ==========================================================================
  // MODULE 2: DATA PARSING & NETWORK INTERCEPTION
  // ==========================================================================

  function parseInitialDOMState() {
    try {
      document.querySelectorAll('script[type="application/json"]').forEach(script => {
        try { findAndCacheVideos(JSON.parse(script.textContent)); } catch (e) {}
      });

      document.querySelectorAll('script:not([src])').forEach(script => {
        const text = script.textContent;
        // Blazing fast check to bypass heavy regex evaluation on 99% of scripts
        if (text.indexOf('window.__INITIAL_STATE__') === -1) return;

        // Multi-line safe regex for massive payload blocks
        const match = text.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/);
        if (match) {
          try { findAndCacheVideos(JSON.parse(match[1])); } catch (e) {}
        }
      });
    } catch (e) { log('Failed to parse initial DOM state', e); }
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.addEventListener('readystatechange', function () {
      if (this.readyState !== 4 || !this.responseText) return;
      if (!url.includes('TweetDetail') && !url.includes('UserBy') && !url.includes('Timeline')) return;

      try {
        const json = JSON.parse(this.responseText);
        findAndCacheVideos(json);
      } catch (e) {
        log('JSON parse error on XHR intercept');
      }
    });
    originalOpen.apply(this, arguments);
  };

  function findAndCacheVideos(rootObj) {
    if (!rootObj || typeof rootObj !== 'object') return;
    const queue = [rootObj];

    while (queue.length > 0) {
      const obj = queue.shift();
      if (!obj || typeof obj !== 'object') continue;

      if (obj.extended_entities?.media) {
        const id = obj.id_str;
        obj.extended_entities.media.forEach(media => {
          if ((media.type === 'video' || media.type === 'animated_gif') && media.video_info) {
            const variants = media.video_info.variants;
            const best = variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
            if (best && id) {
              if (videoCache.size >= CONFIG.MAX_CACHE_SIZE) {
                videoCache.delete(videoCache.keys().next().value);
              }
              videoCache.set(id, best.url);
            }
          }
        });
      }

      for (const [key, val] of Object.entries(obj)) {
        if (CONFIG.IGNORED_JSON_KEYS.has(key)) continue;
        if (val && typeof val === 'object') queue.push(val);
      }
    }
  }

  // ==========================================================================
  // MODULE 3: UI, STYLING, & MENUS
  // ==========================================================================

  if (typeof GM_registerMenuCommand !== 'undefined') {
    GM_registerMenuCommand('🧹 Clear Video Cache', () => {
      videoCache.clear();
      showToast('Video cache cleared!');
    });
    GM_registerMenuCommand('🔍 Force DOM Scan', () => {
      scan();
      showToast('Forced DOM scan complete!');
    });
    GM_registerMenuCommand('🐛 Toggle Debug Mode', () => {
      CONFIG.DEBUG = !CONFIG.DEBUG;
      showToast(`Debug mode ${CONFIG.DEBUG ? 'ON' : 'OFF'}`);
    });
  }

  GM_addStyle(`
    .xiv-btn-container {
      position: absolute !important;
      top: 10px;
      display: flex !important;
      gap: 8px;
      z-index: 9999 !important;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    :fullscreen .xiv-btn-container,
    :-webkit-full-screen .xiv-btn-container {
      z-index: 2147483647 !important;
      top: 60px !important;
    }

    .xiv-left { left: 10px !important; right: auto !important; }
    .xiv-right { right: 10px !important; left: auto !important; }
    .xiv-center-bottom { top: auto !important; bottom: 14px !important; left: 50% !important; transform: translateX(-50%); }

    .xiv-media-wrapper:hover .xiv-btn-container,
    .xiv-btn-container:hover {
      opacity: 1 !important;
      pointer-events: auto !important;
    }

    .xiv-glass-btn {
      width: clamp(32px, 3.5vw, 40px);
      height: clamp(32px, 3.5vw, 40px);
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      color: #ffffff;
      border-radius: 50%;
      cursor: pointer;
      border: 1px solid rgba(255, 255, 255, 0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
      user-select: none;
    }

    .xiv-glass-btn svg { width: 50%; height: 50%; display: block; fill: currentColor; pointer-events: none; }
    .xiv-glass-btn:hover { transform: scale(1.05); background: rgba(0, 0, 0, 0.8); border-color: rgba(255, 255, 255, 0.4); }
    .xiv-glass-btn:active { transform: scale(0.95); }

    .xiv-progress-text { font-size: 11px; font-weight: 700; font-family: system-ui, -apple-system, sans-serif; letter-spacing: -0.5px; }

    @keyframes xiv-spin { 100% { transform: rotate(360deg); } }
    .xiv-spin { animation: xiv-spin 1s linear infinite; }

    #xiv-toast-container {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      z-index: 10000; display: flex; flex-direction: column; gap: 8px; pointer-events: none;
    }

    .xiv-toast {
      background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      color: #ffffff; padding: 12px 24px; border-radius: 30px; font-size: 14px;
      font-family: system-ui, -apple-system, sans-serif; border: 1px solid rgba(255, 255, 255, 0.15);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2); opacity: 0; transform: translateY(20px);
      transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    }

    .xiv-toast.xiv-visible { opacity: 1; transform: translateY(0); }
  `);

  // ==========================================================================
  // MODULE 4: DOM INJECTION (Triggered by Intersection)
  // ==========================================================================
  function createButton(title, iconPath, onClick) {
    const btn = document.createElement('div');
    btn.className = CONFIG.CLASSES.BTN;
    btn.title = title;

    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', title);
    btn.setAttribute('tabindex', '0');

    btn.appendChild(createIcon(iconPath));

    const stopPropagation = (e) => { e.stopPropagation(); e.preventDefault(); };

    btn.addEventListener('mousedown', stopPropagation);
    btn.addEventListener('mouseup', stopPropagation);
    btn.addEventListener('click', (e) => { stopPropagation(e); onClick(btn); });

    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { stopPropagation(e); onClick(btn); }
    });

    return btn;
  }

  function injectImageButtons(img) {
    const w = img.naturalWidth || img.getBoundingClientRect().width || 0;
    const h = img.naturalHeight || img.getBoundingClientRect().height || 0;
    if (w < CONFIG.MIN_SIZE || h < CONFIG.MIN_SIZE) return;

    const parent = img.parentElement;
    if (!parent) return;

    parent.classList.add(CONFIG.CLASSES.WRAPPER);
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';

    const mediaInfo = forceLargeUrl(img.src);
    const filename = `x-img-${genRandom()}.${mediaInfo.ext}`;
    const isProfile = img.src.includes('profile_images');

    const container = document.createElement('div');
    container.className = `${CONFIG.CLASSES.CONTAINER} ${isProfile ? CONFIG.CLASSES.POS_CENTER_BOT : CONFIG.CLASSES.POS_LEFT}`;

    const openBtn = createButton('Open Image', ICONS.OPEN, () => window.open(mediaInfo.url, '_blank'));
    const dlBtn = createButton('Download Image', ICONS.DOWNLOAD, (btnEl) => downloadMedia(mediaInfo.url, filename, btnEl, ICONS.DOWNLOAD));

    container.appendChild(openBtn);
    container.appendChild(dlBtn);
    img.insertAdjacentElement('afterend', container);
  }

  function injectVideoButtons(videoComp) {
    videoComp.classList.add(CONFIG.CLASSES.WRAPPER);
    if (getComputedStyle(videoComp).position === 'static') videoComp.style.position = 'relative';

    const container = document.createElement('div');
    container.className = `${CONFIG.CLASSES.CONTAINER} ${CONFIG.CLASSES.POS_RIGHT}`;

    const getUrlData = () => {
      const id = getTweetIdFromElement(videoComp);
      if (id && videoCache.has(id)) return { url: videoCache.get(id), id };
      return null;
    };

    const openBtn = createButton('Open Video (New Tab)', ICONS.PLAY, () => {
      const data = getUrlData();
      if (data) window.open(data.url, '_blank');
      else showToast('Video URL not cached. Try playing it for a second.');
    });

    const dlBtn = createButton('Download MP4', ICONS.DOWNLOAD, (btnEl) => {
      const data = getUrlData();
      if (data) downloadMedia(data.url, `x-vid-${data.id}.mp4`, btnEl, ICONS.DOWNLOAD);
      else showToast('Video URL not cached. Try playing it for a second.');
    });

    container.appendChild(openBtn);
    container.appendChild(dlBtn);
    videoComp.appendChild(container);
  }

  // ==========================================================================
  // MODULE 5: LIFECYCLE & OBSERVERS
  // ==========================================================================
  const mediaObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        if (entry.target.matches(CONFIG.SELECTORS.IMG)) injectImageButtons(entry.target);
        else injectVideoButtons(entry.target);
        observer.unobserve(entry.target);
      }
    });
  }, { rootMargin: '400px' });

  function scan() {
    const rawImgs = Array.from(document.querySelectorAll(CONFIG.SELECTORS.IMG));
    const rawVideos = Array.from(document.querySelectorAll(CONFIG.SELECTORS.VIDEO));

    rawImgs.forEach(img => {
      if (img.dataset.xivObserved || CONFIG.EXCLUDE_URLS.some(p => img.src.includes(p))) return;
      img.dataset.xivObserved = 'true';
      mediaObserver.observe(img);
    });

    rawVideos.forEach(vid => {
      if (vid.dataset.xivObserved || vid.querySelector(`.${CONFIG.CLASSES.CONTAINER}`)) return;
      vid.dataset.xivObserved = 'true';
      mediaObserver.observe(vid);
    });
  }

  let isThrottled = false;
  function scheduleScan() {
    if (isThrottled) return;
    isThrottled = true;
    setTimeout(() => {
      requestAnimationFrame(() => { scan(); isThrottled = false; });
    }, CONFIG.THROTTLE_MS);
  }

  function init() {
    parseInitialDOMState();
    scan();
    const domObserver = new MutationObserver(scheduleScan);
    domObserver.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
