// ==UserScript==
// @name         [Twitter/X] Media Extractor
// @namespace    https://github.com/myouisaur/Twitter
// @icon         https://twitter.com/favicon.ico
// @version      1.7
// @description  Adds open + download buttons to Twitter/X images/videos.
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
    /* Hover as a unit */
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
  function getResolution(el) {
    const w = el.naturalWidth || el.videoWidth || el.offsetWidth || 0;
    const h = el.naturalHeight || el.videoHeight || el.offsetHeight || 0;
    return `${w}x${h}`;
  }
  function forceLargeUrl(url) {
    if (!url.includes('twimg.com')) return url;

    // Header photos (banners)
    if (/\/profile_banners\//.test(url)) {
      let clean = url.split('?')[0];
      clean = clean.replace(/\/\d+x\d+$/, '/1500x500');
      return clean;
    }

    // Profile photos (avatars)
    if (/\/profile_images\//.test(url)) {
      return url.split('?')[0];
    }

    // Normal post media
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

    // Convert to highest quality JPG for images
    if (filename.includes('.jpg') || filename.includes('.png') || filename.includes('.webp')) {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = function() {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(function(blob) {
          if (blob) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename.replace(/\.(png|webp|jpg|jpeg)$/i, '.jpg');
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(a.href);
          } else {
            window.open(url, '_blank');
          }
        }, 'image/jpeg', 1.0);
      };

      img.onerror = function() {
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
      };

      img.src = url;
      return;
    }

    // For videos, use original download method
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

    // Reposition for profile photos (bottom-center inside circle)
    if (/\/profile_images\//.test(url)) {
      container.style.top = 'auto';
      container.style.bottom = '12px';
      container.style.right = '50%';
      container.style.transform = 'translateX(50%)';
    }

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

    parent.appendChild(container);
  }

  // --- Feed ---
  function injectFeed() {
    document.querySelectorAll('article img[src*="twimg.com"], article video').forEach(el => {
      if (!isLargeEnough(el)) return;
      if (el.tagName === 'IMG') {
        const url = forceLargeUrl(el.src);
        const resolution = getResolution(el);
        const ext = url.includes('.png') ? 'png' : url.includes('.webp') ? 'webp' : 'jpg';
        addButtons(el, url, `x-img-${resolution}-${genRandom()}.${ext}`);
      } else if (el.tagName === 'VIDEO') {
        const vurl = getBestVideoUrl(el);
        if (!vurl) return;
        const resolution = getResolution(el);
        const adaptive = isAdaptive(vurl);
        addButtons(el, vurl, adaptive ? `x-vid-${resolution}-${genRandom()}.m3u8` : `x-vid-${resolution}-${genRandom()}.mp4`, adaptive);
      }
    });
  }

  // --- Modal ---
  function injectModal() {
    document.querySelectorAll('div[role="dialog"] img[src*="twimg.com"], div[role="dialog"] video').forEach(el => {
      if (!isLargeEnough(el)) return;
      if (el.tagName === 'IMG') {
        const url = forceLargeUrl(el.src);
        const resolution = getResolution(el);
        const ext = url.includes('.png') ? 'png' : url.includes('.webp') ? 'webp' : 'jpg';
        addButtons(el, url, `x-img-${resolution}-${genRandom()}.${ext}`);
      } else if (el.tagName === 'VIDEO') {
        const vurl = getBestVideoUrl(el);
        if (!vurl) return;
        const resolution = getResolution(el);
        const adaptive = isAdaptive(vurl);
        addButtons(el, vurl, adaptive ? `x-vid-${resolution}-${genRandom()}.m3u8` : `x-vid-${resolution}-${genRandom()}.mp4`, adaptive);
      }
    });
  }

  // --- Modal polling ---
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

})();
