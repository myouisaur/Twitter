// ==UserScript==
// @name         [Twitter/X] Media Extractor
// @namespace    https://github.com/myouisaur/Twitter
// @icon         https://twitter.com/favicon.ico
// @version      2.3
// @description  Adds open + download buttons to Twitter/X images/videos with clean filenames and original extensions preserved.
// @author       Xiv
// @match        *://*.twitter.com/*
// @match        *://*.x.com/*
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
    /* Show buttons when hovering the media OR the container itself */
    img:hover + .xiv-btn-container,
    video:hover + .xiv-btn-container,
    .xiv-btn-container:hover {
      opacity: 1 !important;
      pointer-events: auto !important;
    }
    .xiv-tw-btn {
      width: 36px;
      height: 36px;
      background: rgba(0,0,0,0.4);
      backdrop-filter: blur(6px);
      color: white;
      border-radius: 10px;
      cursor: pointer;
      border: 1px solid rgba(255,255,255,0.1);
      display: flex !important;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      box-shadow: 0 6px 18px rgba(0,0,0,0.2);
      transition: transform 0.12s ease, opacity 0.12s ease;
    }
    .xiv-tw-btn:hover {
      transform: scale(1.05);
    }
    .xiv-tw-btn:active {
      transform: scale(0.95);
      opacity: 0.9;
    }
  `);

  // --- Helpers ---
  function genRandom(len = 15) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  function isLargeEnough(el) {
    const w = el.naturalWidth || el.videoWidth || el.offsetWidth || 0;
    const h = el.naturalHeight || el.videoHeight || el.offsetHeight || 0;
    return w >= 200 && h >= 200;
  }

  function forceLargeUrl(url) {
    if (!url || !url.includes('twimg.com')) return url;

    if (/\/profile_banners\//.test(url)) {
      let clean = url.split('?')[0];
      clean = clean.replace(/\/\d+x\d+$/, '/1500x500');
      return clean;
    }
    if (/\/profile_images\//.test(url)) {
      return url.split('?')[0];
    }
    if (/\/media\//.test(url)) {
      let baseUrl = url.split('?')[0];
      baseUrl = baseUrl.replace(/:(small|medium|large|thumb)$/, '');
      return baseUrl + '?format=jpg&name=orig';
    }
    try {
      const u = new URL(url);
      u.searchParams.set('name', 'orig');
      u.searchParams.set('format', 'jpg');
      return u.toString();
    } catch (e) {
      return url;
    }
  }

  function isAdaptive(url) {
    return url && (url.includes('.m3u8') || url.includes('.mpd'));
  }

  function getBestVideoUrl(video) {
    const srcs = [...video.querySelectorAll('source')].map(s => s.src).filter(Boolean);
    if (srcs.length) {
      const direct = srcs.find(s => !isAdaptive(s));
      return direct || srcs[0];
    }
    return video.currentSrc || video.src || '';
  }

  function getExtension(url, adaptive) {
    if (adaptive) return url.endsWith('.m3u8') ? '.m3u8' : '.mpd';
    const match = url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
    return match ? `.${match[1].toLowerCase()}` : '.jpg';
  }

  // --- Download Logic ---
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

  // --- Button Injection ---
  function addButtons(el, url, baseName, adaptive = false) {
    if (!el || !el.parentElement) return;

    // Check if buttons already exist (prevents duplicates)
    if (el.nextSibling?.classList?.contains('xiv-btn-container')) return;

    const parent = el.parentElement;
    if (!/relative|absolute|fixed|sticky/i.test(getComputedStyle(parent).position)) {
      parent.style.position = 'relative';
    }

    const container = document.createElement('div');
    container.className = 'xiv-btn-container';

    // Position adjustment for profile images
    if (/\/profile_images\//.test(url)) {
      container.style.top = 'auto';
      container.style.bottom = '12px';
      container.style.right = '50%';
      container.style.transform = 'translateX(50%)';
    }

    const ext = getExtension(url, adaptive);
    const finalFilename = `${baseName}-${genRandom()}${ext}`;

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
      downloadMedia(url, finalFilename, adaptive);
    };

    container.appendChild(openBtn);
    container.appendChild(dlBtn);

    // Insert AFTER the media element
    parent.insertBefore(container, el.nextSibling);
  }

  // --- Core Processing Logic ---
  
  // Processes a specific DOM element (and its children) to find media
  function processScope(scope) {
    if (!scope || !scope.querySelectorAll) return;

    // Define the selector for relevant media
    // We look in 'article' (feed) and 'div[role="dialog"]' (modals/lightboxes)
    const selectors = [
      'article img[src*="twimg.com"]',
      'article video',
      'div[role="dialog"] img[src*="twimg.com"]',
      'div[role="dialog"] video'
    ].join(',');

    const candidates = scope.querySelectorAll(selectors);
    
    candidates.forEach(el => {
      if (!isLargeEnough(el)) return;

      if (el.tagName === 'IMG') {
        const url = forceLargeUrl(el.src);
        addButtons(el, url, 'x-img');
      } else if (el.tagName === 'VIDEO') {
        // Videos sometimes load the source a bit later, so we check lightly
        const vurl = getBestVideoUrl(el);
        if (vurl) {
          const adaptive = isAdaptive(vurl);
          addButtons(el, vurl, 'x-vid', adaptive);
        }
      }
    });
  }

  // --- Optimized Observer ---
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) { // 1 = Element Node
          // Process the new node itself if it matches
          processScope(node); 
        }
      }
    }
  });

  // Start observing
  // specific observation config to catch all additions deep in the tree
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial run to catch anything already loaded
  processScope(document.body);

})();
