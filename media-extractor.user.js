// ==UserScript==
// @name         [Twitter] Media Extractor
// @namespace    https://github.com/myouisaur/Twitter
// @icon         https://twitter.com/favicon.ico
// @version      6.14
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

  // ---------- Duplicate Execution Guard ----------
  if (window.__xivMediaExtractorRunning) return;
  window.__xivMediaExtractorRunning = true;

  // ==========================================================================
  // 1. CONFIGURATION & STATE
  // ==========================================================================
  const CONFIG = {
    DEBUG: false,
    THROTTLE_MS: 200,
    MIN_SIZE: 50,
    MAX_CACHE_SIZE: 500,
    SELECTORS: {
      IMG: 'img[src*="twimg.com"]',
      VIDEO: '[data-testid="videoComponent"], [data-testid="videoPlayer"]',
      TWEET: 'article, [data-testid="tweet"]',
      SAFE_PARENT: '[data-testid="tweetPhoto"], [data-testid="videoComponent"]'
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
    SPINNER: 'M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z',
    CHECK: 'M20 6L9 17l-5-5' // Basic checkmark fallback
  };

  const State = {
    videoCache: new Map(),
    observer: null,
    scanTimeout: null
  };

  // ==========================================================================
  // 2. UTILITIES
  // ==========================================================================
  const Utils = {
    log(...args) {
      if (CONFIG.DEBUG) console.log('[Media Extractor]', ...args);
    },

    generateId(len = 10) {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    },

    showToast(message) {
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
  };

  // ==========================================================================
  // 3. MEDIA PROCESSING
  // ==========================================================================
  const Media = {
    forceLargeUrl(url) {
      if (!url.includes('twimg.com')) return { url, ext: 'jpg' };
      const base = url.split('?')[0];

      let ext = 'jpg';
      const formatMatch = url.match(/format=([a-zA-Z]+)/);
      if (formatMatch && formatMatch[1]) ext = formatMatch[1];
      else {
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
    },

    getTweetId(el) {
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
    },

    async download(url, filename, btnElement, baseIconPath) {
      if (!url) return;
      UI.setButtonState(btnElement, 'loading');

      const fallback = async () => {
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
          setTimeout(() => URL.revokeObjectURL(a.href), 10000);
          UI.setButtonState(btnElement, 'success', { iconPath: baseIconPath });
        } catch (err) {
          Utils.log('Fallback download failed, opening new tab.', err);
          window.open(url, '_blank', 'noopener,noreferrer');
          UI.setButtonState(btnElement, 'ready', { iconPath: baseIconPath });
        }
      };

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
                UI.setButtonState(btnElement, 'progress', { percent });
                lastUpdate = now;
              }
            }
          },
          onload: () => UI.setButtonState(btnElement, 'success', { iconPath: baseIconPath }),
          onerror: (err) => {
            Utils.log('GM_download failed, using fallback', err);
            fallback();
          },
          ontimeout: fallback
        });
      } else {
        await fallback();
      }
    }
  };

  // ==========================================================================
  // 4. NETWORK & JSON INTERCEPTION
  // ==========================================================================
  const Interceptor = {
    init() {
      this.parseInitialDOMState();
      this.hookXHR();
    },

    parseInitialDOMState() {
      try {
        document.querySelectorAll('script[type="application/json"]').forEach(script => {
          try { this.extractVideos(JSON.parse(script.textContent)); } catch (e) {}
        });

        document.querySelectorAll('script:not([src])').forEach(script => {
          const text = script.textContent;
          if (text.indexOf('window.__INITIAL_STATE__') === -1) return;
          const match = text.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/);
          if (match) {
            try { this.extractVideos(JSON.parse(match[1])); } catch (e) {}
          }
        });
      } catch (e) { Utils.log('Initial DOM state parse failed', e); }
    },

    hookXHR() {
      const originalOpen = XMLHttpRequest.prototype.open;
      const self = this;
      XMLHttpRequest.prototype.open = function (method, url) {
        this.addEventListener('readystatechange', function () {
          if (this.readyState !== 4 || !this.responseText) return;
          if (!url.includes('TweetDetail') && !url.includes('UserBy') && !url.includes('Timeline')) return;

          try {
            self.extractVideos(JSON.parse(this.responseText));
          } catch (e) {
            Utils.log('JSON parse error on XHR intercept');
          }
        });
        originalOpen.apply(this, arguments);
      };
    },

    extractVideos(rootObj) {
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
                if (State.videoCache.size >= CONFIG.MAX_CACHE_SIZE) {
                  State.videoCache.delete(State.videoCache.keys().next().value);
                }
                State.videoCache.set(id, best.url);
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
  };

  // ==========================================================================
  // 5. USER INTERFACE & STYLING
  // ==========================================================================
  const UI = {
    injectStyles() {
      GM_addStyle(`
        /* ── Static Container Base ── */
        .xiv-btn-container {
          position: absolute !important;
          display: flex !important;
          gap: 12px;
          z-index: 2147483647 !important;
          pointer-events: none;
          opacity: 1 !important;
          filter: none !important;
          mix-blend-mode: normal !important;
          isolation: isolate !important;
        }

        .xiv-btn-container * {
          box-sizing: border-box !important;
          margin: 0;
          padding: 0;
        }

        /* ── Static Placements ── */
        .xiv-left { top: 10px !important; left: 10px !important; }
        .xiv-right { top: 10px !important; right: 10px !important; }
        .xiv-center-bottom {
          bottom: 14px !important;
          left: 50% !important;
          transform: translateX(-50%) !important;
        }

        /* Interaction Hooks */
        .xiv-media-wrapper:hover .xiv-btn-container,
        .xiv-btn-container:hover {
          pointer-events: auto !important;
        }

        /* ── Liquid Glass Button Shell ── */
        .xiv-glass-btn {
          position: relative;
          width: 35px !important;
          height: 35px !important;
          min-width: 35px !important;
          min-height: 35px !important;
          border-radius: 50%;
          border: none;
          outline: none;
          overflow: hidden;
          cursor: pointer;
          display: flex !important;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          color: rgba(255, 255, 255, 0.96);
          background: rgba(255, 255, 255, 0.14);
          backdrop-filter: blur(24px) saturate(180%) brightness(1.1);
          -webkit-backdrop-filter: blur(24px) saturate(180%) brightness(1.1);
          box-shadow:
              inset 0  1.5px 0   rgba(255,255,255,0.75),
              inset 0 -1.5px 0   rgba(255,255,255,0.06),
              inset  1px 0   0   rgba(255,255,255,0.30),
              inset -1px 0   0   rgba(255,255,255,0.10),
              0 0 0 0.5px        rgba(255,255,255,0.20),
              0 6px 20px         rgba(0,0,0,0.32),
              0 2px  6px         rgba(0,0,0,0.20);
          user-select: none;
          isolation: isolate;

          /* Pure Scale Animation */
          transform: scale(0);
          transform-origin: center center;
          transition:
              transform       0.4s cubic-bezier(0.22, 1, 0.36, 1),
              box-shadow      0.35s ease,
              background      0.35s ease;
        }

        .xiv-media-wrapper:hover .xiv-glass-btn,
        .xiv-btn-container:hover .xiv-glass-btn {
          transform: scale(1);
        }

        .xiv-glass-btn::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 50%;
          padding: 1px !important;
          background: linear-gradient(155deg, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.35) 25%, rgba(255,255,255,0.08) 55%, rgba(255,255,255,0.22) 100%);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events: none;
          z-index: 5;
          transition: background 0.35s ease;
        }

        .xiv-glass-btn::after {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 58%;
          background: radial-gradient(ellipse 75% 70% at 50% -8%, rgba(255,255,255,0.58) 0%, rgba(255,255,255,0.20) 40%, rgba(255,255,255,0.05) 70%, transparent 90%);
          border-radius: 50% 50% 0 0;
          pointer-events: none;
          z-index: 5;
          transition: background 0.35s ease;
        }

        .xiv-glass-btn:hover {
          transform: scale(1.075) !important;
          background: rgba(255, 255, 255, 0.22);
          backdrop-filter: blur(32px) saturate(210%) brightness(1.18);
          -webkit-backdrop-filter: blur(32px) saturate(210%) brightness(1.18);
          box-shadow:
              inset 0  1.5px 0   rgba(255,255,255,0.85),
              inset 0 -1.5px 0   rgba(255,255,255,0.08),
              inset  1px 0   0   rgba(255,255,255,0.40),
              inset -1px 0   0   rgba(255,255,255,0.14),
              0 0 0 0.5px        rgba(255,255,255,0.28),
              0 10px 30px        rgba(0,0,0,0.38),
              0 3px 10px         rgba(0,0,0,0.22),
              0 0 22px           rgba(140,180,255,0.22);
        }

        .xiv-glass-btn:active {
          transform: scale(0.95) !important;
          transition: transform 0.10s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.10s ease;
          box-shadow: inset 0 1.5px 0 rgba(255,255,255,0.75), inset 0 -1.5px 0 rgba(255,255,255,0.06), inset 1px 0 0 rgba(255,255,255,0.30), inset -1px 0 0 rgba(255,255,255,0.10), 0 0 0 0.5px rgba(255,255,255,0.18), 0 3px 10px rgba(0,0,0,0.25);
        }

        /* ── Icon ── */
        .xiv-btn-icon {
          position: relative;
          z-index: 6;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 17px !important;
          height: 17px !important;
          color: rgba(255, 255, 255, 0.96);
          filter: drop-shadow(0 0 4px rgba(0,0,0,0.65)) drop-shadow(0 1px 3px rgba(0,0,0,0.50));
          transition: filter 0.35s ease;
          pointer-events: none;
        }

        .xiv-glass-btn:hover .xiv-btn-icon {
          filter: drop-shadow(0 0 7px rgba(180,210,255,0.70)) drop-shadow(0 2px 4px rgba(0,0,0,0.55));
        }

        .xiv-btn-icon svg {
          width: 100% !important;
          height: 100% !important;
          display: block !important;
          fill: currentColor !important;
          overflow: visible !important;
          transform: translateZ(0);
          will-change: transform;
        }

        /* ── Inner glass layers ── */
        .xiv-glass-lens { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 50%; background: radial-gradient(circle at 72% 56%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 45%, rgba(180,200,255,0.04) 80%, rgba(0,0,0,0) 100%); pointer-events: none; z-index: 1; }
        .xiv-glass-scatter { position: absolute; inset: 2px; border-radius: 50%; background: radial-gradient(ellipse 60% 50% at 38% 40%, rgba(255,255,255,0.09) 0%, transparent 65%); pointer-events: none; z-index: 2; }
        .xiv-glass-chroma { position: absolute; inset: 0; border-radius: 50%; background: radial-gradient(ellipse 100% 100% at 50% 50%, transparent 62%, rgba(80,200,255,0.09) 74%, rgba(255,80,100,0.07) 84%, transparent 92%); pointer-events: none; z-index: 3; }
        .xiv-glass-rim { position: absolute; bottom: 0; left: 10%; right: 10%; height: 40%; background: radial-gradient(ellipse 80% 100% at 50% 115%, rgba(255,255,255,0.26) 0%, rgba(255,255,255,0.08) 45%, transparent 70%); border-radius: 0 0 50% 50%; pointer-events: none; z-index: 4; }

        /* ── Ripple ── */
        .xiv-glass-ripple {
          position: absolute;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.28);
          transform: scale(0);
          animation: xiv-ripple 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards;
          pointer-events: none;
          z-index: 7;
        }
        @keyframes xiv-ripple { to { transform: scale(2.8); opacity: 0; } }

        /* ── Spinner & Progress ── */
        .xiv-progress-text { font-size: 11px; font-weight: 700; font-family: system-ui, -apple-system, sans-serif; letter-spacing: -0.5px; }

        @keyframes xiv-spin {
          0% { transform: rotate(0deg) translateZ(0); }
          100% { transform: rotate(360deg) translateZ(0); }
        }
        .xiv-spin {
          animation: xiv-spin 1s linear infinite !important;
          transform-origin: center center !important;
        }

        /* ── Toast ── */
        #xiv-toast-container { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 10000; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
        .xiv-toast { background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); color: #ffffff; padding: 12px 24px; border-radius: 30px; font-size: 14px; font-family: system-ui, -apple-system, sans-serif; border: 1px solid rgba(255, 255, 255, 0.15); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2); opacity: 0; transform: translateY(20px); transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94); }
        .xiv-toast.xiv-visible { opacity: 1; transform: translateY(0); }
      `);
    },

    createSvg(pathData, isSpinner = false) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      if (isSpinner) svg.classList.add('xiv-spin');

      if (pathData === ICONS.CHECK) {
        // Render checkmark correctly
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#4ade80');
        path.setAttribute('stroke-width', '3');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(path);
      } else {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData);
        svg.appendChild(path);
      }
      return svg;
    },

    createButton(title, iconPath, onClick) {
      const btn = document.createElement('div');
      btn.className = CONFIG.CLASSES.BTN;
      btn.title = title;

      btn.setAttribute('role', 'button');
      btn.setAttribute('aria-label', title);
      btn.setAttribute('tabindex', '0');

      const lens = document.createElement('div'); lens.className = 'xiv-glass-lens';
      const scatter = document.createElement('div'); scatter.className = 'xiv-glass-scatter';
      const chroma = document.createElement('div'); chroma.className = 'xiv-glass-chroma';
      const rim = document.createElement('div'); rim.className = 'xiv-glass-rim';

      const iconEl = document.createElement('span');
      iconEl.className = 'xiv-btn-icon';
      iconEl.appendChild(this.createSvg(iconPath));

      btn.append(lens, scatter, chroma, rim, iconEl);

      btn.addEventListener('pointerdown', function (e) {
        const r = btn.getBoundingClientRect();
        const size = Math.max(r.width, r.height);
        const rpl = document.createElement('div');
        rpl.className = 'xiv-glass-ripple';
        rpl.style.cssText = `width:${size}px; height:${size}px; left:${e.clientX - r.left - size / 2}px; top:${e.clientY - r.top - size / 2}px;`;
        btn.appendChild(rpl);
        rpl.addEventListener('animationend', () => rpl.remove());
      });

      const stopProp = (e) => { e.stopPropagation(); e.preventDefault(); };
      btn.addEventListener('mousedown', stopProp);
      btn.addEventListener('mouseup', stopProp);
      btn.addEventListener('click', (e) => { stopProp(e); onClick(btn); });
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { stopProp(e); onClick(btn); }
      });

      return btn;
    },

    setButtonState(btn, state, payload = {}) {
      const iconEl = btn.querySelector('.xiv-btn-icon');
      if (!iconEl) return;

      if (state === 'loading') {
        iconEl.replaceChildren(this.createSvg(ICONS.SPINNER, true));
        btn.style.pointerEvents = 'none';
      } else if (state === 'progress') {
        const span = document.createElement('span');
        span.className = 'xiv-progress-text';
        span.textContent = `${payload.percent}%`;
        iconEl.replaceChildren(span);
      } else if (state === 'success') {
        iconEl.replaceChildren(this.createSvg(ICONS.CHECK));
        btn.style.pointerEvents = 'none';
        setTimeout(() => this.setButtonState(btn, 'ready', payload), 2000);
      } else if (state === 'ready') {
        iconEl.replaceChildren(this.createSvg(payload.iconPath));
        btn.style.pointerEvents = '';
      }
    }
  };

  // ==========================================================================
  // 6. DOM INJECTION
  // ==========================================================================
  const DOM = {
    injectImageButtons(img) {
      const w = img.naturalWidth || img.getBoundingClientRect().width || 0;
      const h = img.naturalHeight || img.getBoundingClientRect().height || 0;
      if (w < CONFIG.MIN_SIZE || h < CONFIG.MIN_SIZE) return;

      const parent = img.parentElement;
      if (!parent) return;

      parent.classList.add(CONFIG.CLASSES.WRAPPER);
      if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';

      const mediaInfo = Media.forceLargeUrl(img.src);
      const filename = `x-img-${Utils.generateId()}.${mediaInfo.ext}`;
      const isProfile = img.src.includes('profile_images');

      const container = document.createElement('div');
      container.className = `${CONFIG.CLASSES.CONTAINER} ${isProfile ? CONFIG.CLASSES.POS_CENTER_BOT : CONFIG.CLASSES.POS_LEFT}`;

      const openBtn = UI.createButton('Open Image', ICONS.OPEN, () => window.open(mediaInfo.url, '_blank'));
      const dlBtn = UI.createButton('Download Image', ICONS.DOWNLOAD, (btnEl) => Media.download(mediaInfo.url, filename, btnEl, ICONS.DOWNLOAD));

      container.appendChild(openBtn);
      container.appendChild(dlBtn);
      img.insertAdjacentElement('afterend', container);
    },

    injectVideoButtons(videoComp) {
      // Find the safest, most outer wrapper to escape Twitter's internal video gradient layers
      const safeParent = videoComp.closest(CONFIG.SELECTORS.SAFE_PARENT) || videoComp.parentElement;
      if (!safeParent) return;

      safeParent.classList.add(CONFIG.CLASSES.WRAPPER);
      if (getComputedStyle(safeParent).position === 'static') safeParent.style.position = 'relative';

      const container = document.createElement('div');
      container.className = `${CONFIG.CLASSES.CONTAINER} ${CONFIG.CLASSES.POS_RIGHT}`;

      const getUrlData = () => {
        const id = Media.getTweetId(videoComp);
        if (id && State.videoCache.has(id)) return { url: State.videoCache.get(id), id };
        return null;
      };

      const openBtn = UI.createButton('Open Video', ICONS.PLAY, () => {
        const data = getUrlData();
        if (data) window.open(data.url, '_blank');
        else Utils.showToast('Video URL not cached. Try playing it for a second.');
      });

      const dlBtn = UI.createButton('Download MP4', ICONS.DOWNLOAD, (btnEl) => {
        const data = getUrlData();
        if (data) Media.download(data.url, `x-vid-${data.id}.mp4`, btnEl, ICONS.DOWNLOAD);
        else Utils.showToast('Video URL not cached. Try playing it for a second.');
      });

      container.appendChild(openBtn);
      container.appendChild(dlBtn);
      safeParent.appendChild(container);
    },

    scan() {
      const rawImgs = Array.from(document.querySelectorAll(CONFIG.SELECTORS.IMG));
      const rawVideos = Array.from(document.querySelectorAll(CONFIG.SELECTORS.VIDEO));

      rawImgs.forEach(img => {
        if (img.dataset.xivObserved || CONFIG.EXCLUDE_URLS.some(p => img.src.includes(p))) return;
        img.dataset.xivObserved = 'true';
        State.observer.observe(img);
      });

      rawVideos.forEach(vid => {
        const parent = vid.closest(CONFIG.SELECTORS.SAFE_PARENT) || vid.parentElement;
        if (vid.dataset.xivObserved || (parent && parent.querySelector(`.${CONFIG.CLASSES.CONTAINER}`))) return;
        vid.dataset.xivObserved = 'true';
        State.observer.observe(vid);
      });
    }
  };

  // ==========================================================================
  // 7. INITIALIZATION
  // ==========================================================================
  function init() {
    UI.injectStyles();
    Interceptor.init();

    if (typeof GM_registerMenuCommand !== 'undefined') {
      GM_registerMenuCommand('🧹 Clear Video Cache', () => { State.videoCache.clear(); Utils.showToast('Video cache cleared!'); });
      GM_registerMenuCommand('🔍 Force DOM Scan', () => { DOM.scan(); Utils.showToast('Forced DOM scan complete!'); });
      GM_registerMenuCommand('🐛 Toggle Debug Mode', () => { CONFIG.DEBUG = !CONFIG.DEBUG; Utils.showToast(`Debug mode ${CONFIG.DEBUG ? 'ON' : 'OFF'}`); });
    }

    State.observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          if (entry.target.matches(CONFIG.SELECTORS.IMG)) DOM.injectImageButtons(entry.target);
          else DOM.injectVideoButtons(entry.target);
          obs.unobserve(entry.target);
        }
      });
    }, { rootMargin: '400px' });

    DOM.scan();

    const domObserver = new MutationObserver(() => {
      if (State.scanTimeout) return;
      State.scanTimeout = setTimeout(() => {
        requestAnimationFrame(() => { DOM.scan(); State.scanTimeout = null; });
      }, CONFIG.THROTTLE_MS);
    });

    // Narrow observation scope for performance
    const root = document.getElementById('react-root') || document.body;
    domObserver.observe(root, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
