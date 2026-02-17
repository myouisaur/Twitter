// ==UserScript==
// @name         [Twitter/X] Media Extractor
// @namespace    https://github.com/myouisaur/Twitter
// @icon         https://twitter.com/favicon.ico
// @version      5.5
// @description  Adds open + download buttons to Twitter/X images/videos with clean filenames and original extensions preserved.
// @author       Xiv
// @match        *://*.twitter.com/*
// @match        *://*.x.com/*
// @grant        GM_addStyle
// @run-at       document-start
// @updateURL    https://myouisaur.github.io/Twitter/media-extractor.user.js
// @downloadURL  https://myouisaur.github.io/Twitter/media-extractor.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ==========================================================================
  // MODULE 1: VIDEO API INTERCEPTION
  // ==========================================================================
  const videoCache = new Map();

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.addEventListener('readystatechange', function () {
      if (this.readyState === 4 && this.responseText) {
        if (url.includes('TweetDetail') || url.includes('UserBy') || url.includes('Timeline')) {
          try {
            const json = JSON.parse(this.responseText);
            findAndCacheVideos(json);
          } catch (e) { }
        }
      }
    });
    originalOpen.apply(this, arguments);
  };

  function findAndCacheVideos(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (obj.extended_entities && obj.extended_entities.media) {
      const id = obj.id_str;
      obj.extended_entities.media.forEach(media => {
        if ((media.type === 'video' || media.type === 'animated_gif') && media.video_info) {
          const variants = media.video_info.variants;
          const best = variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
          if (best && id) videoCache.set(id, best.url);
        }
      });
    }
    Object.values(obj).forEach(child => findAndCacheVideos(child));
  }

  // ==========================================================================
  // MODULE 2: MODERN GLASSMORPHIC DESIGN
  // ==========================================================================
  GM_addStyle(`
    .xiv-btn-container {
      position: absolute !important;
      top: 10px;
      display: flex !important;
      gap: 6px;
      z-index: 9999 !important;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .xiv-left {
      left: 10px !important;
      right: auto !important;
    }

    .xiv-right {
      right: 10px !important;
      left: auto !important;
    }

    .xiv-center-bottom {
      top: auto !important;
      bottom: 14px !important;
      left: 50% !important;
      transform: translateX(-50%);
    }

    .xiv-media-wrapper:hover .xiv-btn-container,
    .xiv-btn-container:hover {
      opacity: 1 !important;
      pointer-events: auto !important;
    }

    .xiv-tw-btn {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      cursor: pointer;
      position: relative;
      overflow: hidden;

      display: flex !important;
      align-items: center;
      justify-content: center;

      font-size: 16px;
      font-weight: 400;

      color: rgba(255, 255, 255, 0.95);

      background: rgba(15, 20, 25, 0.75);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);

      border: 1.5px solid rgba(255, 255, 255, 0.1);

      box-shadow:
        0 8px 32px rgba(0, 0, 0, 0.3),
        inset 0 1px 0 rgba(255, 255, 255, 0.1),
        0 1px 2px rgba(0, 0, 0, 0.2);

      user-select: none;
      transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .xiv-tw-btn svg {
      pointer-events: none;
    }

    .xiv-tw-btn::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: linear-gradient(
        135deg,
        rgba(255, 255, 255, 0) 0%,
        rgba(255, 255, 255, 0.15) 100%
      );
      opacity: 0;
      transition: opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .xiv-tw-btn:hover::before {
      opacity: 1;
    }

    .xiv-tw-btn:hover {
      background: rgba(60, 60, 60, 0.85);
      border: 1.5px solid rgba(255, 255, 255, 0.25);
      box-shadow:
        0 0 30px rgba(255, 255, 255, 0.15),
        0 8px 32px rgba(0, 0, 0, 0.4),
        inset 0 1px 0 rgba(255, 255, 255, 0.2);
    }

    .xiv-tw-btn:active {
      background: rgba(80, 80, 80, 0.9);
      box-shadow:
        0 0 20px rgba(255, 255, 255, 0.1),
        0 4px 16px rgba(0, 0, 0, 0.3),
        inset 0 2px 4px rgba(0, 0, 0, 0.2);
    }

    @media (prefers-color-scheme: light) {
      .xiv-tw-btn {
        background: rgba(255, 255, 255, 0.85);
        color: rgba(15, 20, 25, 0.95);
        border: 1.5px solid rgba(0, 0, 0, 0.08);
        box-shadow:
          0 8px 32px rgba(0, 0, 0, 0.12),
          inset 0 1px 0 rgba(255, 255, 255, 0.8),
          0 1px 2px rgba(0, 0, 0, 0.1);
      }

      .xiv-tw-btn::before {
        background: linear-gradient(
          135deg,
          rgba(0, 0, 0, 0) 0%,
          rgba(0, 0, 0, 0.08) 100%
        );
      }

      .xiv-tw-btn:hover {
        background: rgba(240, 240, 240, 0.9);
        border: 1.5px solid rgba(0, 0, 0, 0.15);
        box-shadow:
          0 0 25px rgba(0, 0, 0, 0.08),
          0 8px 32px rgba(0, 0, 0, 0.15),
          inset 0 1px 0 rgba(255, 255, 255, 0.8);
      }

      .xiv-tw-btn:active {
        background: rgba(220, 220, 220, 0.95);
        box-shadow:
          0 0 20px rgba(0, 0, 0, 0.06),
          0 4px 16px rgba(0, 0, 0, 0.12),
          inset 0 2px 4px rgba(0, 0, 0, 0.08);
      }
    }
  `);

  // ==========================================================================
  // MODULE 3: HELPERS
  // ==========================================================================
  function genRandom(len = 10) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  function isLargeEnough(el) {
    const w = el.naturalWidth || el.offsetWidth || 0;
    const h = el.naturalHeight || el.offsetHeight || 0;
    return w >= 50 && h >= 50;
  }

  function forceLargeUrl(url) {
    if (!url.includes('twimg.com')) return url;
    if (/\/profile_banners\//.test(url)) return url.split('?')[0].replace(/\/\d+x\d+$/, '/1500x500');
    if (/\/profile_images\//.test(url)) return url.split('?')[0];
    if (/\/media\//.test(url)) {
      let baseUrl = url.split('?')[0].replace(/:(small|medium|large|thumb)$/, '');
      return baseUrl + '?format=jpg&name=orig';
    }
    return url;
  }

  function getTweetIdFromElement(el) {
    const article = el.closest('article');
    if (article) {
      const link = article.querySelector('a[href*="/status/"]');
      if (link) {
        const match = link.href.match(/\/status\/(\d+)/);
        if (match) return match[1];
      }
    }
    const urlMatch = window.location.pathname.match(/\/status\/(\d+)/);
    if (urlMatch) return urlMatch[1];
    return null;
  }

  function downloadMedia(url, filename) {
    if (!url) return;
    fetch(url)
      .then(r => r.ok ? r.blob() : Promise.reject())
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      })
      .catch(() => window.open(url, '_blank'));
  }

  // Icons
  const icons = {
    open: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>',
    download: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
  };

  // ==========================================================================
  // MODULE 4: BUTTON INJECTION
  // ==========================================================================

  function injectImageButtons(img) {
    // Exclude emojis explicitly
    if (img.src.includes('/emoji/')) return;

    if (img.nextSibling && img.nextSibling.classList && img.nextSibling.classList.contains('xiv-btn-container')) return;
    if (!isLargeEnough(img)) return;

    const parent = img.parentElement;
    if (!parent) return;

    parent.classList.add('xiv-media-wrapper');
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';

    let isProfile = img.src.includes('profile_images');
    const finalUrl = forceLargeUrl(img.src);
    const filename = `x-img-${genRandom()}.jpg`;

    const container = document.createElement('div');
    container.className = 'xiv-btn-container';
    if (isProfile) container.classList.add('xiv-center-bottom');
    else container.classList.add('xiv-left');

    const openBtn = document.createElement('div');
    openBtn.className = 'xiv-tw-btn';
    openBtn.innerHTML = icons.open;
    openBtn.title = 'Open Image';
    openBtn.onmousedown = e => { e.stopPropagation(); e.preventDefault(); window.open(finalUrl, '_blank'); };

    const dlBtn = document.createElement('div');
    dlBtn.className = 'xiv-tw-btn';
    dlBtn.innerHTML = icons.download;
    dlBtn.title = 'Download Image';
    dlBtn.onmousedown = e => { e.stopPropagation(); e.preventDefault(); downloadMedia(finalUrl, filename); };

    container.appendChild(openBtn);
    container.appendChild(dlBtn);
    img.insertAdjacentElement('afterend', container);
  }

  function injectVideoButtons(videoComp) {
    if (videoComp.querySelector('.xiv-btn-container.xiv-right')) return;

    videoComp.classList.add('xiv-media-wrapper');
    if (getComputedStyle(videoComp).position === 'static') videoComp.style.position = 'relative';

    const container = document.createElement('div');
    container.className = 'xiv-btn-container xiv-right';

    const getUrl = () => {
      const id = getTweetIdFromElement(videoComp);
      if (id && videoCache.has(id)) return { url: videoCache.get(id), id: id };
      return null;
    };

    const openBtn = document.createElement('div');
    openBtn.className = 'xiv-tw-btn';
    openBtn.innerHTML = icons.play; // Used play icon for opening video in new tab
    openBtn.title = 'Open Video (New Tab)';
    openBtn.onmousedown = e => {
      e.stopPropagation(); e.preventDefault();
      const data = getUrl();
      if (data) window.open(data.url, '_blank');
      else alert('Video URL not found in cache. Try playing the video first.');
    };

    const dlBtn = document.createElement('div');
    dlBtn.className = 'xiv-tw-btn';
    dlBtn.innerHTML = icons.download;
    dlBtn.title = 'Download MP4';
    dlBtn.onmousedown = e => {
      e.stopPropagation(); e.preventDefault();
      const data = getUrl();
      if (data) downloadMedia(data.url, `x-vid-${data.id}.mp4`);
      else alert('Video URL not found in cache. Try playing the video first.');
    };

    container.appendChild(openBtn);
    container.appendChild(dlBtn);
    videoComp.appendChild(container);
  }

  function scan() {
    // Only select images that match twimg.com but are NOT emojis (handled in injectImageButtons as well for safety)
    const imgs = document.querySelectorAll('img[src*="twimg.com"]');
    imgs.forEach(injectImageButtons);

    const videos = document.querySelectorAll('[data-testid="videoComponent"], [data-testid="videoPlayer"]');
    videos.forEach(injectVideoButtons);
  }

  const observer = new MutationObserver(() => scan());
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('load', scan);
  setInterval(scan, 2000);

})();
