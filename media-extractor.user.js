// ==UserScript==
// @name         [Twitter/X] Media Extractor
// @namespace    https://github.com/myouisaur/Twitter
// @icon         https://twitter.com/favicon.ico
// @version      1.0
// @description  Adds open + download buttons to Twitter/X images/videos.
// @author       Xiv
// @match        https://*.twitter.com/*
// @match        https://*.x.com/*
// @grant        GM_addStyle
// @updateURL    https://myouisaur.github.io/Twitter/media-extractor.user.js
// @downloadURL  https://myouisaur.github.io/Twitter/media-extractor.user.js
// ==/UserScript==

(function () {
  'use strict';

  // --- Styling ---
  GM_addStyle(`
    .xiv-btn-container {
      position: absolute !important;
      top: 8px;
      right: 8px;
      display: flex !important;
      gap: 4px;
      z-index: 9999 !important;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.15s ease;
    }
    /* Hover as a unit */
    img:hover + .xiv-btn-container,
    video:hover + .xiv-btn-container,
    .xiv-btn-container:hover {
      opacity: 1 !important;
      pointer-events: auto !important;
    }
    .xiv-tw-btn {
      width: 34px;
      height: 34px;
      background: rgba(0,0,0,0.8);
      backdrop-filter: blur(6px);
      color: white;
      border-radius: 8px;
      cursor: pointer;
      border: 1px solid rgba(255,255,255,0.18);
      display: flex !important;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      box-shadow: 0 4px 10px rgba(0,0,0,0.35);
      margin-left: 4px;
      transition: transform 0.15s ease, opacity 0.15s ease;
    }
    .xiv-tw-btn:hover {
      transform: scale(1.06);
    }
    .xiv-tw-btn:active {
      transform: scale(0.98);
      opacity: 0.85;
    }
  `);

  // --- Helpers ---
  function genRandom(len = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }
  function isLargeEnough(el) {
    const w = el.naturalWidth || el.videoWidth || el.offsetWidth || 0;
    const h = el.naturalHeight || el.videoHeight || el.offsetHeight || 0;
    return w >= 200 && h >= 200;
  }
  function forceLargeUrl(url) {
    if (!url.includes('twimg.com')) return url;
    const u = new URL(url);
    u.searchParams.set('name', 'orig');
    return u.toString();
  }
  function isAdaptive(url) {
    return url.includes('.m3u8') || url.includes('.mpd');
  }
  function getBestVideoUrl(video) {
    const srcs = [...video.querySelectorAll('source')].map(s => s.src).filter(Boolean);
    if (srcs.length) {
      const direct = srcs.find(s => !isAdaptive(s));
      return direct || srcs[0];
    }
    return video.currentSrc || video.src || '';
  }
  function downloadMedia(url, filename, adaptive = false) {
    if (!url) return;
    if (adaptive) {
      alert('⚠ Adaptive stream. Manifest opened for external tools (yt-dlp / VLC / ffmpeg).');
      return window.open(url, '_blank');
    }
    fetch(url)
      .then(r => r.ok ? r.blob() : Promise.reject())
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => window.open(url, '_blank'));
  }

  // --- Buttons ---
  function addButtons(el, url, filename, adaptive = false) {
    if (!el || el.nextSibling?.classList?.contains('xiv-btn-container')) return;
    const parent = el.parentElement;
    if (!parent) return;
    if (!/relative|absolute|fixed|sticky/i.test(getComputedStyle(parent).position)) {
      parent.style.position = 'relative';
    }

    const container = document.createElement('div');
    container.className = 'xiv-btn-container';

    const openBtn = document.createElement('div');
    openBtn.className = 'xiv-tw-btn';
    openBtn.textContent = '🔗';
    openBtn.title = 'Open original';
    openBtn.onmousedown = e => {
      e.stopPropagation(); e.preventDefault();
      window.open(url, '_blank');
    };

    const dlBtn = document.createElement('div');
    dlBtn.className = 'xiv-tw-btn';
    dlBtn.textContent = adaptive ? '⚠' : '⬇';
    dlBtn.title = adaptive ? 'Adaptive: open manifest' : 'Download';
    dlBtn.onmousedown = e => {
      e.stopPropagation(); e.preventDefault();
      downloadMedia(url, filename, adaptive);
    };

    container.appendChild(openBtn);
    container.appendChild(dlBtn);

    if (el.nextSibling) parent.insertBefore(container, el.nextSibling);
    else parent.appendChild(container);
  }

  // --- Feed ---
  function injectFeed() {
    document.querySelectorAll('article img[src*="twimg.com"], article video').forEach(el => {
      if (!isLargeEnough(el)) return;
      if (el.tagName === 'IMG') {
        const url = forceLargeUrl(el.src);
        const ext = url.includes('.png') ? 'png' : url.includes('.webp') ? 'webp' : 'jpg';
        addButtons(el, url, `x-img-${genRandom()}.${ext}`);
      } else if (el.tagName === 'VIDEO') {
        const vurl = getBestVideoUrl(el);
        if (!vurl) return;
        const adaptive = isAdaptive(vurl);
        addButtons(el, vurl, adaptive ? `x-vid-${genRandom()}.m3u8` : `x-vid-${genRandom()}.mp4`, adaptive);
      }
    });
  }

  // --- Modal ---
  function injectModal() {
    document.querySelectorAll('div[role="dialog"] img[src*="twimg.com"], div[role="dialog"] video').forEach(el => {
      if (!isLargeEnough(el)) return;
      if (el.tagName === 'IMG') {
        const url = forceLargeUrl(el.src);
        const ext = url.includes('.png') ? 'png' : url.includes('.webp') ? 'webp' : 'jpg';
        addButtons(el, url, `x-img-${genRandom()}.${ext}`);
      } else if (el.tagName === 'VIDEO') {
        const vurl = getBestVideoUrl(el);
        if (!vurl) return;
        const adaptive = isAdaptive(vurl);
        addButtons(el, vurl, adaptive ? `x-vid-${genRandom()}.m3u8` : `x-vid-${genRandom()}.mp4`, adaptive);
      }
    });
  }

  // --- Modal polling (only while open) ---
  let modalInterval = null;
  function startModalPolling() {
    if (modalInterval) clearInterval(modalInterval);
    modalInterval = setInterval(() => {
      if (document.querySelector('div[role="dialog"]')) {
        injectModal();
      } else {
        clearInterval(modalInterval);
        modalInterval = null;
      }
    }, 120);
  }

  // --- Observe ---
  injectFeed();
  const observer = new MutationObserver(() => {
    injectFeed();
    if (document.querySelector('div[role="dialog"]')) startModalPolling();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('load', injectFeed);

  console.log('[Twitter/X Media Extractor] Lightweight version loaded.');
})();
