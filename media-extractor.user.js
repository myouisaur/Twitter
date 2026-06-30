// ==UserScript==
// @name         [Twitter] Media Extractor
// @namespace    https://github.com/myouisaur/Twitter
// @icon         https://twitter.com/favicon.ico
// @version      7.2
// @description  Adds floating liquid glass buttons to images and videos for seamless background downloading.
// @author       Xiv
// @match        *://*.twitter.com/*
// @match        *://*.x.com/*
// @grant        GM_addStyle
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
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
      WRAPPER: 'xiv-wrap',
      CONTAINER: 'xiv-btn-container',
      BTN: 'xiv-action-btn',
      POS_LEFT: 'xiv-left',
      POS_RIGHT: 'xiv-right',
      POS_CENTER_BOT: 'xiv-center-bottom'
    },
    EXCLUDE_URLS: ['/emoji/', '/hashflags/'],
    IGNORED_JSON_KEYS: new Set(['user', 'core', 'promotedMetadata', 'clientEventInfo', 'entities', 'edit_control', 'views'])
  };

  const ICONS = {
    OPEN:     '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>',
    DOWNLOAD: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>',
    PLAY:     '<polygon points="5 3 19 12 5 21 5 3"></polygon>',
    CHECK:    '<polyline points="20 6 9 17 4 12" stroke="#4ade80" stroke-width="3"></polyline>'
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

    // Determines which video "slot" (0-indexed, document order) a given leaf video
    // node occupies within its tweet. Twitter renders multi-video tweets in the same
    // order as extended_entities.media, so this index lines up with the cache key
    // built in Interceptor.extractVideos(). Operates on DOM.getLeafVideoNodes() so a
    // shared grid wrapper (which can match SAFE_PARENT for every video in the post)
    // never collapses distinct videos down to the same index.
    getVideoSlotIndex(videoComp) {
      if (!videoComp) return 0;
      const tweetContainer = videoComp.closest(CONFIG.SELECTORS.TWEET);
      if (!tweetContainer) return 0;

      const leaves = DOM.getLeafVideoNodes(tweetContainer);
      const index = leaves.indexOf(videoComp);
      return index >= 0 ? index : 0;
    },

    // Extracts a video's own media ID from its poster/thumbnail URL (e.g.
    // .../ext_tw_video_thumb/{id}/... or .../amplify_video_thumb/{id}/...). This ID
    // matches extended_entities.media[].id_str exactly, so it's a more reliable way
    // to identify "which video is this" than DOM-order heuristics when available.
    getPosterMediaId(videoComp) {
      const posterUrl = videoComp.querySelector('video')?.poster || videoComp.querySelector('img')?.src;
      if (!posterUrl) return null;
      const match = posterUrl.match(/\/(?:ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\/(\d+)\//);
      return match ? match[1] : null;
    },

    fetchAndSaveBlob(url, filename, onProgress) {
      return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest === 'undefined') {
          return reject(new Error('GM_xmlhttpRequest not available'));
        }

        let lastUpdate = 0;
        GM_xmlhttpRequest({
          method: 'GET',
          url: url,
          responseType: 'blob',
          onprogress: (e) => {
            if (e.lengthComputable && onProgress) {
              const now = Date.now();
              if (now - lastUpdate > 150) { // Throttle UI updates
                onProgress(Math.floor((e.loaded / e.total) * 100));
                lastUpdate = now;
              }
            }
          },
          onload: (res) => {
            if (res.status >= 200 && res.status < 300) {
              const blobUrl = URL.createObjectURL(res.response);
              const a = document.createElement('a');
              a.href = blobUrl;
              a.download = filename;
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
              resolve();
            } else {
              reject(new Error(`HTTP Error ${res.status}`));
            }
          },
          onerror: (err) => reject(err),
          ontimeout: () => reject(new Error('Network Timeout'))
        });
      });
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
      } catch (e) {
        Utils.log('Initial DOM state parse failed', e);
      }
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
      const seen = new WeakSet();
      seen.add(rootObj);

      while (queue.length > 0) {
        const obj = queue.shift();
        if (!obj || typeof obj !== 'object') continue;

        if (obj.extended_entities?.media) {
          const id = obj.id_str;
          let videoSlot = 0;
          obj.extended_entities.media.forEach(media => {
            if ((media.type === 'video' || media.type === 'animated_gif') && media.video_info) {
              const variants = media.video_info.variants;
              const best = variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
              if (best && id) {
                if (State.videoCache.size >= CONFIG.MAX_CACHE_SIZE) {
                  State.videoCache.delete(State.videoCache.keys().next().value);
                }
                // Primary key: the media item's own unique id_str. This is the most
                // reliable lookup since it can be cross-referenced directly from the
                // poster thumbnail URL on the DOM side — no ordering assumptions needed.
                if (media.id_str) State.videoCache.set(media.id_str, best.url);
                // Secondary key (tweetId-slotIndex): fallback for when the poster URL
                // can't be read yet (e.g. video hasn't rendered a thumbnail).
                State.videoCache.set(`${id}-${videoSlot}`, best.url);
              }
              videoSlot++;
            }
          });
        }

        for (const [key, val] of Object.entries(obj)) {
          if (CONFIG.IGNORED_JSON_KEYS.has(key)) continue;
          if (val && typeof val === 'object') {
            if (!seen.has(val)) {
              seen.add(val);
              queue.push(val);
            }
          }
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
        /* ── Container ───────────────────────────────────────────────────────── */
        .xiv-btn-container {
            position: absolute !important;
            display: flex !important;
            gap: 8px;
            z-index: 2147483647 !important;
            pointer-events: none;

            /* Visibility delay trick: prevents Chromium backdrop-filter snapping. */
            visibility: hidden;
            transition: visibility 0s linear 0.3s;
        }

        /* Static Placements integrated with V2 */
        .xiv-left { top: 10px !important; left: 10px !important; right: auto !important; }
        .xiv-right { top: 10px !important; right: 10px !important; left: auto !important; }
        .xiv-center-bottom { bottom: 14px !important; left: 50% !important; transform: translateX(-50%) !important; top: auto !important; }

        .xiv-btn-container::before {
            content: '';
            position: absolute;
            top: -20px; right: -25px; bottom: -20px; left: -25px;
            z-index: -1;
            background: radial-gradient(ellipse at center, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0) 65%);
            pointer-events: none;
            border-radius: 50%;
            opacity: 0;
            transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .xiv-wrap:hover > .xiv-btn-container,
        .xiv-btn-container:hover,
        .xiv-btn-container.xiv-visible {
            visibility: visible;
            pointer-events: auto !important;
            transition: visibility 0s;
        }

        .xiv-wrap:hover > .xiv-btn-container::before,
        .xiv-btn-container:hover::before,
        .xiv-btn-container.xiv-visible::before {
            opacity: 1;
        }

        /* ── Button Shell ─────────────────────────────────────────────────────── */
        .xiv-action-btn {
            position: relative;
            width: 35px;
            height: 35px;
            border-radius: 50%;
            border: none;
            outline: none;
            overflow: hidden;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            color: rgba(255, 255, 255, 0.96);

            /* Hardware acceleration + direct opacity fade */
            opacity: 0;
            will-change: transform, opacity;
            transform: translateZ(0);

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

            transition:
                opacity    0.3s  cubic-bezier(0.4, 0, 0.2, 1),
                box-shadow 0.35s ease,
                background 0.35s ease;
        }

        .xiv-wrap:hover .xiv-action-btn,
        .xiv-btn-container.xiv-visible .xiv-action-btn {
            opacity: 1;
        }

        .xiv-action-btn[data-loading="1"] {
            cursor: default !important;
        }

        .xiv-wrap:hover .xiv-action-btn[data-loading="1"],
        .xiv-btn-container.xiv-visible .xiv-action-btn[data-loading="1"] {
            opacity: 0.8 !important;
        }

        .xiv-action-btn::before {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: 50%;
            padding: 1px;
            background: linear-gradient(155deg, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.35) 25%, rgba(255,255,255,0.08) 55%, rgba(255,255,255,0.22) 100%);
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor;
            mask-composite: exclude;
            pointer-events: none;
            z-index: 5;
            transition: background 0.35s ease;
        }

        .xiv-action-btn::after {
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

        .xiv-action-btn:hover {
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

        .xiv-action-btn:active {
            transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.10s ease;
            box-shadow:
                inset 0  1.5px 0  rgba(255,255,255,0.75),
                inset 0 -1.5px 0  rgba(255,255,255,0.06),
                inset  1px 0   0  rgba(255,255,255,0.30),
                inset -1px 0   0  rgba(255,255,255,0.10),
                0 0 0 0.5px       rgba(255,255,255,0.18),
                0 3px 10px        rgba(0,0,0,0.25);
        }

        /* ── Icon Wrapper ─────────────────────────────────────────────────────── */
        .xiv-btn-icon {
            position: relative;
            z-index: 6;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 17px;
            height: 17px;
            color: rgba(255, 255, 255, 0.96);
            filter: drop-shadow(0 0 4px rgba(0,0,0,0.65)) drop-shadow(0 1px 3px rgba(0,0,0,0.50));
            transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.35s ease;
            pointer-events: none;
        }

        .xiv-action-btn:hover .xiv-btn-icon {
            filter: drop-shadow(0 0 7px rgba(180,210,255,0.70)) drop-shadow(0 2px 4px rgba(0,0,0,0.55));
        }

        /* ── Icon Morph Animation Target ─────────────────────────────────────── */
        .xiv-icon-inner {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
            transition: opacity 0.15s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
            transform-origin: center;
        }

        .xiv-icon-inner.xiv-morphing {
            opacity: 0;
            transform: scale(0.25) rotate(-45deg);
        }

        .xiv-icon-inner svg {
            width: 100% !important;
            height: 100% !important;
            display: block !important;
        }

        /* ── Inner Glass Layers ──────────────────────────────────────────────── */
        .xiv-glass-lens {
            position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 50%;
            background: radial-gradient(circle at 72% 56%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 45%, rgba(180,200,255,0.04) 80%, rgba(0,0,0,0) 100%);
            pointer-events: none; z-index: 1;
        }
        .xiv-glass-scatter {
            position: absolute; inset: 2px; border-radius: 50%;
            background: radial-gradient(ellipse 60% 50% at 38% 40%, rgba(255,255,255,0.09) 0%, transparent 65%);
            pointer-events: none; z-index: 2;
        }
        .xiv-glass-chroma {
            position: absolute; inset: 0; border-radius: 50%;
            background: radial-gradient(ellipse 100% 100% at 50% 50%, transparent 62%, rgba(80,200,255,0.09) 74%, rgba(255,80,100,0.07) 84%, transparent 92%);
            pointer-events: none; z-index: 3;
        }
        .xiv-glass-rim {
            position: absolute; bottom: 0; left: 10%; right: 10%; height: 40%; border-radius: 0 0 50% 50%;
            background: radial-gradient(ellipse 80% 100% at 50% 115%, rgba(255,255,255,0.26) 0%, rgba(255,255,255,0.08) 45%, transparent 70%);
            pointer-events: none; z-index: 4;
        }

        /* ── Ripple ──────────────────────────────────────────────────────────── */
        .xiv-glass-ripple {
            position: absolute;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.28);
            transform: scale(0);
            animation: xiv-ripple 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards;
            pointer-events: none;
            z-index: 7;
        }

        @keyframes xiv-ripple {
            to { transform: scale(2.8); opacity: 0; }
        }

        /* ── Text / Progress / Toast ─────────────────────────────────────────── */
        .xiv-progress-text {
            font-size: 11px;
            font-weight: 700;
            font-family: system-ui, -apple-system, sans-serif;
            letter-spacing: -0.5px;
        }

        #xiv-toast-container {
            position: fixed;
            bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 10000; display: flex; flex-direction: column; gap: 8px; pointer-events: none;
        }
        .xiv-toast {
            background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
            color: #ffffff; padding: 12px 24px; border-radius: 30px; font-size: 14px; font-family: system-ui, -apple-system, sans-serif; border: 1px solid rgba(255, 255, 255, 0.15);
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2); opacity: 0; transform: translateY(20px); transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        }
        .xiv-toast.xiv-visible { opacity: 1; transform: translateY(0); }
      `);
    },

    createIconElement(pathData) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.style.cssText = 'width:100%;height:100%;display:block;';
      svg.innerHTML = pathData;
      return svg;
    },

    createButton(title, iconPath, onClick) {
      const btn = document.createElement('div');
      btn.className = CONFIG.CLASSES.BTN;
      btn.title = title;
      btn.setAttribute('role', 'button');
      btn.setAttribute('aria-label', title);
      btn.setAttribute('tabindex', '0');

      const lens    = document.createElement('div'); lens.className    = 'xiv-glass-lens';
      const scatter = document.createElement('div'); scatter.className = 'xiv-glass-scatter';
      const chroma  = document.createElement('div'); chroma.className  = 'xiv-glass-chroma';
      const rim     = document.createElement('div'); rim.className     = 'xiv-glass-rim';

      const iconWrapper = document.createElement('span');
      iconWrapper.className = 'xiv-btn-icon';

      const innerIconEl = document.createElement('div');
      innerIconEl.className = 'xiv-icon-inner';
      innerIconEl.appendChild(this.createIconElement(iconPath));
      iconWrapper.appendChild(innerIconEl);

      btn.append(lens, scatter, chroma, rim, iconWrapper);

      // Event Sealing against SPA Routers
      const sealedEvents = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'dblclick'];
      sealedEvents.forEach(eventType => {
          btn.addEventListener(eventType, (e) => {
              e.stopPropagation();
              if (eventType === 'click') e.preventDefault();
          });
      });

      btn.addEventListener('pointerdown', function (e) {
          if (btn.dataset.loading === "1") return;
          const r = btn.getBoundingClientRect();
          const size = Math.max(r.width, r.height);
          const rpl = document.createElement('div');
          rpl.className = 'xiv-glass-ripple';
          rpl.style.cssText = `width:${size}px; height:${size}px; left:${e.clientX - r.left - size / 2}px; top:${e.clientY - r.top - size / 2}px;`;
          btn.appendChild(rpl);
          rpl.addEventListener('animationend', () => rpl.remove());
      });

      btn.addEventListener('click', () => { onClick(btn, iconWrapper); });
      btn.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation();
              e.preventDefault();
              onClick(btn, iconWrapper);
          }
      });

      return btn;
    },

    swapIconSmoothly(iconWrapper, newPathData) {
      let inner = iconWrapper.querySelector('.xiv-icon-inner');

      if (!inner) {
          inner = document.createElement('div');
          inner.className = 'xiv-icon-inner xiv-morphing';
          iconWrapper.replaceChildren(inner);
          void inner.offsetWidth;
      }

      return new Promise(resolve => {
          inner.classList.add('xiv-morphing');
          setTimeout(() => {
              inner.replaceChildren(this.createIconElement(newPathData));
              void inner.offsetWidth;
              inner.classList.remove('xiv-morphing');
              setTimeout(resolve, 250);
          }, 150);
      });
    }
  };

  // ==========================================================================
  // 6. DOM INJECTION & HANDLERS
  // ==========================================================================
  const Handlers = {
    async handleOpen(btnEl, iconWrapper, url, restoreIcon) {
      if (btnEl.dataset.loading === "1") return;
      btnEl.dataset.loading = "1";
      try {
        GM_openInTab(url, { active: false });
        await UI.swapIconSmoothly(iconWrapper, ICONS.CHECK);
      } catch(e) {
        Utils.showToast('Failed to open background tab.');
      } finally {
        setTimeout(async () => {
          await UI.swapIconSmoothly(iconWrapper, restoreIcon);
          delete btnEl.dataset.loading;
        }, 1000);
      }
    },

    async handleDownload(btnEl, iconWrapper, url, filename, restoreIcon) {
      if (btnEl.dataset.loading === "1") return;
      btnEl.dataset.loading = "1";

      const updateProgress = (pct) => {
        let inner = iconWrapper.querySelector('.xiv-icon-inner');
        if (inner) {
          let prog = inner.querySelector('.xiv-progress-text');
          if (!prog) {
            prog = document.createElement('span');
            prog.className = 'xiv-progress-text';
            inner.replaceChildren(prog);
          }
          prog.textContent = `${pct}%`;
        }
      };

      try {
        await Media.fetchAndSaveBlob(url, filename, updateProgress);
        await UI.swapIconSmoothly(iconWrapper, ICONS.CHECK);
      } catch (e) {
        Utils.log('Download failed', e);
        Utils.showToast('Download failed. Falling back to new tab...');
        window.open(url, '_blank', 'noopener,noreferrer');
      } finally {
        setTimeout(async () => {
          await UI.swapIconSmoothly(iconWrapper, restoreIcon);
          delete btnEl.dataset.loading;
        }, 1000);
      }
    }
  };

  const DOM = {
    // Filters raw SELECTORS.VIDEO matches down to "leaf" nodes only — matches that
    // don't themselves contain another match. Twitter sometimes wraps a multi-video
    // grid in one shared testid container with individual per-video players nested
    // inside; without this filter, the shared outer wrapper would be treated as an
    // extra "video" and every real video would resolve back to that same wrapper.
    getLeafVideoNodes(scopeEl) {
      const matches = Array.from(scopeEl.querySelectorAll(CONFIG.SELECTORS.VIDEO));
      return matches.filter(node => !matches.some(other => other !== node && node.contains(other)));
    },

    // Picks where to mount a video's button container. Prefers the nearest
    // SAFE_PARENT ancestor for nicer positioning/clipping, but only if that ancestor
    // wraps exactly one video — otherwise it's a shared grid wrapper, and mounting
    // there would stack every video's buttons on top of each other at the same spot.
    findSafeParent(videoComp) {
      const candidate = videoComp.closest(CONFIG.SELECTORS.SAFE_PARENT) || videoComp.parentElement;
      if (candidate && candidate.querySelectorAll(CONFIG.SELECTORS.VIDEO).length > 1) {
        return videoComp;
      }
      return candidate || videoComp;
    },

    mountContainer(safeParent, positionClass, insertAfterTarget = null) {
      if (!safeParent) return null;

      safeParent.classList.add(CONFIG.CLASSES.WRAPPER);
      if (getComputedStyle(safeParent).position === 'static') {
        safeParent.style.position = 'relative';
      }

      const container = document.createElement('div');
      container.className = `${CONFIG.CLASSES.CONTAINER} ${positionClass}`;

      if (insertAfterTarget) {
        insertAfterTarget.insertAdjacentElement('afterend', container);
      } else {
        safeParent.appendChild(container);
      }

      return container;
    },

    injectImageButtons(img) {
      const w = img.naturalWidth || img.getBoundingClientRect().width || 0;
      const h = img.naturalHeight || img.getBoundingClientRect().height || 0;
      if (w < CONFIG.MIN_SIZE || h < CONFIG.MIN_SIZE) return;

      const isProfile = img.src.includes('profile_images');
      const container = this.mountContainer(
        img.parentElement,
        isProfile ? CONFIG.CLASSES.POS_CENTER_BOT : CONFIG.CLASSES.POS_LEFT,
        img
      );
      if (!container) return;

      const mediaInfo = Media.forceLargeUrl(img.src);
      const filename = `x-img-${Utils.generateId()}.${mediaInfo.ext}`;

      const openBtn = UI.createButton('Open Image', ICONS.OPEN, (btn, icon) =>
        Handlers.handleOpen(btn, icon, mediaInfo.url, ICONS.OPEN)
      );
      const dlBtn = UI.createButton('Download Image', ICONS.DOWNLOAD, (btn, icon) =>
        Handlers.handleDownload(btn, icon, mediaInfo.url, filename, ICONS.DOWNLOAD)
      );

      container.appendChild(openBtn);
      container.appendChild(dlBtn);
    },

    injectVideoButtons(videoComp) {
      const safeParent = this.findSafeParent(videoComp);
      const container = this.mountContainer(safeParent, CONFIG.CLASSES.POS_RIGHT);
      if (!container) return;

      const slotIndex = Media.getVideoSlotIndex(videoComp);

      const getUrlData = () => {
        const id = Media.getTweetId(videoComp);
        if (!id) return null;

        // Tier 1: match by the video's own media ID read from its poster thumbnail.
        // Most reliable — independent of render order or grid structure.
        const posterMediaId = Media.getPosterMediaId(videoComp);
        if (posterMediaId && State.videoCache.has(posterMediaId)) {
          return { url: State.videoCache.get(posterMediaId), id };
        }

        // Tier 2: composite tweetId-slotIndex, correlated via DOM/API render order.
        const exactKey = `${id}-${slotIndex}`;
        if (State.videoCache.has(exactKey)) {
          return { url: State.videoCache.get(exactKey), id };
        }

        // Tier 3: last resort — grab slot 0 rather than showing "not cached"
        // when SOME video for this tweet did make it into the cache.
        const fallbackKey = `${id}-0`;
        if (State.videoCache.has(fallbackKey)) {
          Utils.log(`No exact match for ${exactKey} (poster id: ${posterMediaId}), falling back to ${fallbackKey}`);
          return { url: State.videoCache.get(fallbackKey), id };
        }

        return null;
      };

      const openBtn = UI.createButton('Open Video', ICONS.PLAY, (btn, icon) => {
        const data = getUrlData();
        if (data) Handlers.handleOpen(btn, icon, data.url, ICONS.PLAY);
        else Utils.showToast('Video URL not cached. Try playing it for a second.');
      });

      const dlBtn = UI.createButton('Download MP4', ICONS.DOWNLOAD, (btn, icon) => {
        const data = getUrlData();
        if (data) Handlers.handleDownload(btn, icon, data.url, `x-vid-${data.id}-${slotIndex}.mp4`, ICONS.DOWNLOAD);
        else Utils.showToast('Video URL not cached. Try playing it for a second.');
      });

      container.appendChild(openBtn);
      container.appendChild(dlBtn);
    },

    scan() {
      const rawImgs = Array.from(document.querySelectorAll(CONFIG.SELECTORS.IMG));
      const rawVideos = this.getLeafVideoNodes(document);

      rawImgs.forEach(img => {
        if (img.dataset.xivObserved || CONFIG.EXCLUDE_URLS.some(p => img.src.includes(p))) return;
        img.dataset.xivObserved = 'true';
        State.observer.observe(img);
      });

      rawVideos.forEach(vid => {
        if (vid.dataset.xivObserved) return;
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

    const root = document.getElementById('react-root') || document.body;
    domObserver.observe(root, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
