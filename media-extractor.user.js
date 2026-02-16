// ==UserScript==
// @name         [Twitter/X] Media Extractor
// @namespace    https://github.com/myouisaur/Twitter
// @icon         https://twitter.com/favicon.ico
// @version      2.4
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
      z-index: 50 !important; 
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.15s ease;
    }
    /* Ensure visibility when hovering the parent container */
    div:hover > .xiv-btn-container,
    .xiv-btn-container:hover {
      opacity: 1 !important;
      pointer-events: auto !important;
    }
    .xiv-tw-btn {
      width: 34px;
      height: 34px;
      background: rgba(0,0,0,0.6) !important;
      backdrop-filter: blur(4px);
      color: white !important;
      border-radius: 8px;
      cursor: pointer;
      border: 1px solid rgba(255,255,255,0.2);
      display: flex !important;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      transition: transform 0.1s ease;
    }
    .xiv-tw-btn:hover { transform: scale(1.1); background: rgba(0,0,0,0.8) !important; }
  `);

  // --- Helper Functions ---
  const genRandom = (len = 8) => Math.random().toString(36).substring(2, 2 + len);

  function forceLargeUrl(url) {
    if (!url || !url.includes('twimg.com')) return url;
    if (/\/media\//.test(url)) {
      const baseUrl = url.split('?')[0];
      return `${baseUrl}?format=jpg&name=orig`;
    }
    return url.split('&name=')[0] + '&name=orig';
  }

  function getBestVideoUrl(video) {
    const direct = [...video.querySelectorAll('source')].find(s => !s.src.includes('.m3u8'));
    return direct ? direct.src : (video.currentSrc || video.src);
  }

  // --- Injection Logic ---
  function injectButtons(el) {
    if (!el || el.dataset.xivProcessed) return;
    
    // Find the closest relative-positioned container to anchor buttons
    const container = el.closest('div[data-testid="tweetPhoto"], div[data-testid="videoPlayer"], .css-175oi2r');
    if (!container || container.querySelector('.xiv-btn-container')) return;

    el.dataset.xivProcessed = "true";
    const isVideo = el.tagName === 'VIDEO';
    const mediaUrl = isVideo ? getBestVideoUrl(el) : forceLargeUrl(el.src);
    if (!mediaUrl) return;

    const btnWrapper = document.createElement('div');
    btnWrapper.className = 'xiv-btn-container';

    // Link Button
    const openBtn = document.createElement('div');
    openBtn.className = 'xiv-tw-btn';
    openBtn.innerHTML = '🔗';
    openBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); window.open(mediaUrl, '_blank'); };

    // Download Button
    const dlBtn = document.createElement('div');
    dlBtn.className = 'xiv-tw-btn';
    dlBtn.innerHTML = '⬇';
    dlBtn.onclick = (e) => {
        e.preventDefault(); e.stopPropagation();
        fetch(mediaUrl).then(r => r.blob()).then(blob => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `x-${isVideo ? 'video' : 'image'}-${genRandom()}.jpg`;
            a.click();
        }).catch(() => window.open(mediaUrl, '_blank'));
    };

    btnWrapper.appendChild(openBtn);
    btnWrapper.appendChild(dlBtn);
    container.style.position = 'relative';
    container.appendChild(btnWrapper);
  }

  // --- Efficient Scanners ---
  function scan() {
    // Specifically target images in tweets and videos
    const media = document.querySelectorAll('article img[src*="twimg.com"]:not([data-xivProcessed]), div[role="dialog"] img[src*="twimg.com"]:not([data-xivProcessed]), video:not([data-xivProcessed])');
    media.forEach(m => {
        // Filter out small icons/avatars
        if (m.tagName === 'IMG' && (m.width < 150 || m.height < 150)) return;
        injectButtons(m);
    });
  }

  // 1. Mutation Observer for new content
  const observer = new MutationObserver(() => scan());
  observer.observe(document.body, { childList: true, subtree: true });

  // 2. Periodic check (Safety net for slow-loading media)
  setInterval(scan, 1500);

  // 3. Initial run
  scan();

})();
