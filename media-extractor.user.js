// ==UserScript==
// @name         [Twitter] Media Extractor
// @namespace    https://github.com/myouisaur/Twitter
// @icon         https://twitter.com/favicon.ico
// @version      7.13
// @description  Adds floating liquid glass buttons to images and videos for seamless background downloading.
// @author       Xiv
// @match        *://*.twitter.com/*
// @match        *://*.x.com/*
// @grant        GM_addStyle
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      twimg.com
// @connect      video.twimg.com
// @connect      pbs.twimg.com
// @connect      abs.twimg.com
// @connect      cdn.syndication.twimg.com
// @connect      api.fxtwitter.com
// @connect      api.vxtwitter.com
// @run-at       document-start
// @noframes
// @updateURL    https://myouisaur.github.io/Twitter/media-extractor.user.js
// @downloadURL  https://myouisaur.github.io/Twitter/media-extractor.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Duplicate Execution Guard ----------
  if (window.__xivMediaExtractorRunning) return;
  window.__xivMediaExtractorRunning = true;

  // The page's real window. Patching the sandbox's own window can leave the page's
  // fetch/XHR untouched, which would make every network hook below silently blind.
  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  // ==========================================================================
  // 1. CONFIGURATION & STATE
  // ==========================================================================
  const CONFIG = {
    DEBUG: false,
    THROTTLE_MS: 200,
    MIN_SIZE: 50,
    MAX_CACHE_SIZE: 500,
    MAX_TWEET_ID_CANDIDATES: 3,
    MAX_BUNDLE_FETCHES: 6,
    SYNDICATION_URL: 'https://cdn.syndication.twimg.com/tweet-result',
    SYNDICATION_TIMEOUT_MS: 8000,
    // Feature flag: last-resort lookup through public mirror services. Only the tweet ID
    // is sent, and only after every other source failed (e.g. sensitive posts while logged out).
    ENABLE_MIRROR_LOOKUP: true,
    MIRROR_TIMEOUT_MS: 10000,
    MIRROR_URLS: [
      'https://api.fxtwitter.com/i/status/',
      'https://api.vxtwitter.com/i/status/'
    ],
    // Any full video file address inside a mirror's reply.
    MIRROR_VIDEO_URL: /https:\/\/video\.twimg\.com\/[^"'\s\\]+?\.mp4[^"'\s\\]*/g,
    BUNDLE_TIMEOUT_MS: 20000,
    // Same-origin legacy endpoint; needs no query ID, so it survives Twitter's rotating GraphQL IDs.
    LEGACY_STATUS_PATH: '/i/api/1.1/statuses/show.json',
    // Any response whose URL contains one of these is checked for video data.
    API_URL_PATTERNS: ['/graphql/', '/i/api/', 'TweetDetail', 'UserBy', 'Timeline'],
    PATTERNS: {
      // The media ID (or GIF name) in a poster URL is the same key used in the file path of the video itself.
      POSTER_ID: /\/(?:ext_tw_video_thumb|amplify_video_thumb)\/(\d+)\//,
      POSTER_GIF: /\/tweet_video_thumb\/([\w-]+)\./,
      // Captures the media ID (group 1) or GIF name (group 2) of a loaded MP4 file.
      OBSERVED_VIDEO: /video\.twimg\.com\/(?:(?:amplify_video|ext_tw_video)\/(\d+)\/[^?]*|tweet_video\/([\w-]+))\.mp4/,
      VIDEO_RESOLUTION: /\/(\d{2,5})x(\d{2,5})\//,
      // Streaming pieces live under .../{start}/{end}/{W}x{H}/...; the init piece is an
      // ".mp4" that holds no picture, so it must never be mistaken for the video.
      STREAM_SEGMENT: /\/\d+\/\d+\/\d{2,5}x\d{2,5}\//,
      // Page requests worth remembering so they can be replayed for another tweet.
      API_TEMPLATE: /\/graphql\/[\w-]+\/(TweetDetail|TweetResultByRestId)\?/,
      // Twitter's own web-client script bundles, and the public token baked into them.
      BUNDLE_URL: /abs\.twimg\.com\/responsive-web\/client-web[^/]*\/.*\.js/,
      BEARER_TOKEN: /AAAAAAAAAAAAAAAAAAAAA[\w%]{30,}/
    },
    MESSAGES: {
      LOOKING_UP: 'Looking up video…',
      VIDEO_NOT_FOUND: 'Could not find this video. Play it for a second, then try again.'
    },
    SELECTORS: {
      IMG: 'img[src*="twimg.com"]',
      VIDEO: 'video',
      TWEET: 'article, [data-testid="tweet"]',
      STATUS_LINK: 'a[href*="/status/"]',
      CONTAINER: '.xiv-btn-container',
      CONTAINER_IMAGE: '.xiv-btn-container[data-xiv-kind="image"]',
      CONTAINER_VIDEO: '.xiv-btn-container[data-xiv-kind="video"]'
    },
    CLASSES: {
      WRAPPER: 'xiv-wrap',
      CONTAINER: 'xiv-btn-container',
      VISIBLE: 'xiv-visible',
      BTN: 'xiv-action-btn',
      POS_LEFT: 'xiv-left',
      POS_RIGHT: 'xiv-right',
      POS_CENTER_BOT: 'xiv-center-bottom'
    },
    KINDS: {
      IMAGE: 'image',
      VIDEO: 'video'
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
    // media ID (or GIF name) -> { url, area } of the best full MP4 the player itself loaded.
    observedVideos: new Map(),
    // Credentials and request shapes copied from the page's own traffic.
    auth: { bearer: null, templates: {} },
    // Counters shown by the diagnostics menu command.
    stats: { responsesSeen: 0, responsesWithVideo: 0 },
    originalFetch: null,
    // media element -> its button container. Lets scan() detect containers that
    // React removed while the media element itself survived a re-render.
    containers: new WeakMap(),
    // button container -> its media element. Lets the hover check read the
    // media's on-screen rectangle.
    owners: new WeakMap(),
    // media elements currently waiting on the IntersectionObserver.
    pending: new WeakSet(),
    // images judged too small, keyed by the src they were judged at.
    skipped: new WeakMap(),
    // containers currently force-shown by the pointer-position hover check.
    hovered: new Set(),
    // tweetId -> in-flight syndication lookup, so repeat clicks share one request.
    syndicationRequests: new Map(),
    // In-flight token discovery, so overlapping lookups share one bundle download.
    bearerDiscovery: null,
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

      const cleanBase = base.replace(/:(small|medium|large|thumb)$/, '');

      // Video thumbnails 404 without a size and need name=orig...
      if (/video_thumb\//.test(base)) {
        return { url: `${cleanBase}?format=jpg&name=orig`, ext: 'jpg' };
      }

      // ...while regular photos stopped serving the raw file with name=orig, so
      // they omit the size and force jpg instead of webp.
      if (/\/media\//.test(base)) {
        return { url: `${cleanBase}?format=jpg`, ext: 'jpg' };
      }
      return { url, ext };
    },

    extractStatusId(link) {
      const match = link?.href.match(/\/status\/(\d+)/);
      return match ? match[1] : null;
    },

    // Twitter's markup no longer exposes stable test IDs, so candidates are
    // gathered from the closest scope outward: the player's own wrapper (it links
    // to the video's tweet), then the tweet container, then the page URL. Several
    // are returned because quote tweets and replies put other tweets' links first.
    getTweetIdCandidates(el) {
      const ids = [];
      const add = (id) => { if (id && !ids.includes(id)) ids.push(id); };

      [el.parentElement, el.closest(CONFIG.SELECTORS.TWEET)].forEach(scope => {
        scope?.querySelectorAll(CONFIG.SELECTORS.STATUS_LINK).forEach(link => add(this.extractStatusId(link)));
      });
      add(window.location.pathname.match(/\/status\/(\d+)/)?.[1]);

      return ids.slice(0, CONFIG.MAX_TWEET_ID_CANDIDATES);
    },

    // Determines which video "slot" (0-indexed, document order) a given <video>
    // occupies within its tweet. Twitter renders multi-video tweets in the same
    // order as extended_entities.media, so this index lines up with the cache key
    // built in Interceptor.extractVideos().
    getVideoSlotIndex(videoComp) {
      const tweetContainer = videoComp?.closest(CONFIG.SELECTORS.TWEET);
      if (!tweetContainer) return 0;

      const videos = Array.from(tweetContainer.querySelectorAll(CONFIG.SELECTORS.VIDEO));
      const index = videos.indexOf(videoComp);
      return index >= 0 ? index : 0;
    },

    // Extracts a video's own key from its poster thumbnail URL: the numeric media ID
    // (.../amplify_video_thumb/{id}/...) or, for GIFs, the file name. It matches
    // extended_entities.media[].id_str and the video file's own path exactly, so it's
    // a more reliable way to identify "which video is this" than DOM-order heuristics.
    getPosterMediaId(videoComp) {
      const posterUrl = videoComp.poster || videoComp.querySelector('video')?.poster || videoComp.querySelector('img')?.src;
      if (!posterUrl) return null;
      const match = posterUrl.match(CONFIG.PATTERNS.POSTER_ID) || posterUrl.match(CONFIG.PATTERNS.POSTER_GIF);
      return match ? match[1] : null;
    },

    // Reads the caches only. Returns { url, id } or null. A file the player loaded is a
    // last resort: it is only consulted when `allowObserved` is set, after every
    // source of real tweet data has already been tried.
    lookupVideo(videoComp, slotIndex, allowObserved = false) {
      const tweetId = this.getTweetIdCandidates(videoComp)[0] || null;
      const posterKey = this.getPosterMediaId(videoComp);
      // The poster key can name the file when the tweet ID can't be found.
      const id = tweetId || posterKey;
      if (!id) return null;

      // Tier 1: match by the video's own key read from its poster thumbnail.
      // Most reliable — independent of render order or tweet ID discovery.
      if (posterKey && State.videoCache.has(posterKey)) {
        return { url: State.videoCache.get(posterKey), id };
      }

      // Tier 2: composite tweetId-slotIndex, correlated via DOM/API render order.
      const exactKey = `${tweetId}-${slotIndex}`;
      if (tweetId && State.videoCache.has(exactKey)) {
        return { url: State.videoCache.get(exactKey), id };
      }

      // Tier 3: a full MP4 the player itself loaded, matched by the same media key.
      const observed = allowObserved && posterKey ? State.observedVideos.get(posterKey) : null;
      if (observed) return { url: observed.url, id };

      // Tier 4: last resort — grab slot 0 rather than failing when SOME video
      // for this tweet did make it into the cache.
      const fallbackKey = `${tweetId}-0`;
      if (tweetId && State.videoCache.has(fallbackKey)) {
        Utils.log(`No exact match for ${exactKey} (poster key: ${posterKey}), falling back to ${fallbackKey}`);
        return { url: State.videoCache.get(fallbackKey), id };
      }

      return null;
    },

    // Runs one lookup source against every candidate tweet ID, re-checking the
    // caches after each so it stops as soon as the video turns up.
    async tryLookupSource(videoComp, slotIndex, tweetIds, source) {
      for (const tweetId of tweetIds) {
        try {
          await source(tweetId);
        } catch (e) {
          Utils.log('Lookup source failed', tweetId, e);
        }
        const found = this.lookupVideo(videoComp, slotIndex);
        if (found) return found;
      }
      return null;
    },

    // Caches first; then Twitter's public syndication endpoint; then the page's own
    // logged-in API; finally any full MP4 the player loaded. Never throws — resolves
    // null when every source comes up empty.
    async resolveVideo(videoComp, slotIndex) {
      const cached = this.lookupVideo(videoComp, slotIndex);
      if (cached) return cached;

      const tweetIds = this.getTweetIdCandidates(videoComp);
      if (!tweetIds.length) return this.lookupVideo(videoComp, slotIndex, true);

      Utils.showToast(CONFIG.MESSAGES.LOOKING_UP);
      const sources = [
        (id) => Interceptor.fetchSyndication(id),
        (id) => Interceptor.fetchAuthenticated(id),
        (id) => Interceptor.fetchMirror(id)
      ];
      for (const source of sources) {
        const found = await this.tryLookupSource(videoComp, slotIndex, tweetIds, source);
        if (found) return found;
      }
      return this.lookupVideo(videoComp, slotIndex, true);
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
    // Hooks go in immediately (document-start) so early requests aren't missed.
    installHooks() {
      this.hookXHR();
      this.hookFetch();
      this.observeResourceRequests();
    },

    isApiUrl(url) {
      const text = String(url || '');
      return CONFIG.API_URL_PATTERNS.some(pattern => text.includes(pattern));
    },

    // Skips the expensive parse for the vast majority of responses that carry no video.
    ingestText(text) {
      State.stats.responsesSeen++;
      if (!text || !text.includes('video_info')) return;
      State.stats.responsesWithVideo++;
      try {
        this.extractVideos(JSON.parse(text));
      } catch (e) {
        Utils.log('JSON parse error on network intercept');
      }
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

    readHeader(headers, name) {
      if (!headers) return null;
      if (typeof headers.get === 'function') return headers.get(name);
      if (Array.isArray(headers)) {
        const pair = headers.find(([key]) => String(key).toLowerCase() === name);
        return pair ? pair[1] : null;
      }
      const key = Object.keys(headers).find(k => k.toLowerCase() === name);
      return key ? headers[key] : null;
    },

    // Copies the page's own login header and tweet-data request URL so they can be
    // replayed (to Twitter only) for a tweet the page never loaded.
    rememberRequest(url, headers) {
      const text = String(url || '');
      if (!text.includes('/i/api/')) return;

      const bearer = this.readHeader(headers, 'authorization');
      if (bearer) State.auth.bearer = bearer;

      const match = text.match(CONFIG.PATTERNS.API_TEMPLATE);
      if (!match) return;
      try {
        State.auth.templates[match[1]] = new URL(text, window.location.origin).href;
      } catch (e) {
        Utils.log('Could not remember request template', e);
      }
    },

    hookXHR() {
      const proto = pageWindow.XMLHttpRequest.prototype;
      const originalOpen = proto.open;
      const originalSetHeader = proto.setRequestHeader;
      const self = this;

      proto.open = function (method, url) {
        self.rememberRequest(url, null);
        if (self.isApiUrl(url)) {
          this.addEventListener('readystatechange', function () {
            if (this.readyState !== 4) return;
            // responseText throws for non-text response types.
            if (this.responseType && this.responseType !== 'text') return;
            self.ingestText(this.responseText);
          });
        }
        return originalOpen.apply(this, arguments);
      };

      proto.setRequestHeader = function (name, value) {
        if (String(name).toLowerCase() === 'authorization' && /^Bearer /i.test(String(value))) {
          State.auth.bearer = value;
        }
        return originalSetHeader.apply(this, arguments);
      };
    },

    hookFetch() {
      const originalFetch = pageWindow.fetch;
      if (typeof originalFetch !== 'function') return;
      State.originalFetch = originalFetch;
      const self = this;
      pageWindow.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || String(input);
        self.rememberRequest(url, (init && init.headers) || (input && input.headers));

        const request = originalFetch.apply(this, arguments);
        if (self.isApiUrl(url)) {
          // Reads a clone so the page's own response stays untouched.
          request
            .then(res => res.clone().text())
            .then(text => self.ingestText(text))
            .catch(() => Utils.log('Could not read fetch response'));
        }
        return request;
      };
    },

    // Passive and independent of the hooks above: Resource Timing lists every request the
    // page makes. Video files the <video> tag hides behind a blob: address show up here,
    // and so do the full addresses of the page's own tweet-data requests.
    observeResourceRequests() {
      if (typeof PerformanceObserver === 'undefined') return;
      try {
        const observer = new PerformanceObserver((list) => {
          list.getEntries().forEach(entry => {
            this.recordObservedVideo(entry.name);
            this.rememberRequest(entry.name, null);
          });
        });
        observer.observe({ type: 'resource', buffered: true });
      } catch (e) {
        Utils.log('Resource observer unavailable', e);
      }
    },

    // Keeps only complete progressive files. Streaming pieces (including the picture-less
    // init ".mp4") and files with no resolution in their path are skipped.
    recordObservedVideo(url) {
      const match = url.match(CONFIG.PATTERNS.OBSERVED_VIDEO);
      if (!match || CONFIG.PATTERNS.STREAM_SEGMENT.test(url)) return;

      const key = match[1] || match[2];
      const size = url.match(CONFIG.PATTERNS.VIDEO_RESOLUTION);
      const isGif = !!match[2];
      if (!size && !isGif) return;
      const area = size ? Number(size[1]) * Number(size[2]) : 0;

      const known = State.observedVideos.get(key);
      if (known && known.area >= area) return;

      if (State.observedVideos.size >= CONFIG.MAX_CACHE_SIZE) {
        State.observedVideos.delete(State.observedVideos.keys().next().value);
      }
      State.observedVideos.set(key, { url, area });
      Utils.log('Captured video file', key, url);
    },

    // Cross-origin GET through the userscript manager, so CORS never gets in the way.
    gmGetText(url, timeoutMs) {
      return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest === 'undefined') {
          return reject(new Error('GM_xmlhttpRequest not available'));
        }
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          responseType: 'text',
          timeout: timeoutMs,
          onload: (res) => {
            if (res.status >= 200 && res.status < 300) resolve(res.responseText);
            else reject(new Error(`HTTP Error ${res.status}`));
          },
          onerror: (err) => reject(err),
          ontimeout: () => reject(new Error('Network Timeout'))
        });
      });
    },

    // Public, login-free endpoint used when the intercepted data missed a tweet.
    syndicationToken(tweetId) {
      return ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
    },

    // Reads every full video file address out of a mirror reply. A regex over the raw
    // text keeps this independent of each mirror's differing JSON layout.
    // Keeps the largest picture per media ID, then also files them by slot order.
    ingestMirrorText(tweetId, text) {
      const best = new Map();
      const matches = text.replace(/\\\//g, '/').match(CONFIG.MIRROR_VIDEO_URL) || [];
      for (const url of matches) {
        if (CONFIG.PATTERNS.STREAM_SEGMENT.test(url)) continue;
        const key = url.match(CONFIG.PATTERNS.OBSERVED_VIDEO);
        const id = key && (key[1] || key[2]);
        if (!id) continue;
        const size = url.match(CONFIG.PATTERNS.VIDEO_RESOLUTION);
        const area = size ? Number(size[1]) * Number(size[2]) : 0;
        if (!best.has(id) || area > best.get(id).area) best.set(id, { url, area });
      }
      let slot = 0;
      for (const [id, { url }] of best) {
        State.videoCache.set(id, url);
        State.videoCache.set(`${tweetId}-${slot++}`, url);
      }
      Utils.log('Mirror lookup found', best.size, 'video(s) for', tweetId);
      return best.size;
    },

    // Last resort: public mirrors that read tweets with their own sessions, so they can
    // see videos Twitter hides from logged-out viewers. Tries each mirror in turn.
    async fetchMirror(tweetId) {
      if (!CONFIG.ENABLE_MIRROR_LOOKUP) return;
      for (const base of CONFIG.MIRROR_URLS) {
        try {
          const text = await this.gmGetText(base + tweetId, CONFIG.MIRROR_TIMEOUT_MS);
          if (this.ingestMirrorText(tweetId, text)) return;
        } catch (e) {
          Utils.log('Mirror lookup failed', base, e);
        }
      }
    },

    fetchSyndication(tweetId) {
      if (State.syndicationRequests.has(tweetId)) return State.syndicationRequests.get(tweetId);

      const url = `${CONFIG.SYNDICATION_URL}?id=${tweetId}&lang=en&token=${this.syndicationToken(tweetId)}`;
      const request = this.gmGetText(url, CONFIG.SYNDICATION_TIMEOUT_MS)
        .then(text => {
          const data = JSON.parse(text);
          this.extractVideos({ id_str: tweetId, extended_entities: { media: data.mediaDetails || [] } });
        })
        .finally(() => State.syndicationRequests.delete(tweetId));

      State.syndicationRequests.set(tweetId, request);
      return request;
    },

    // Twitter's web client carries one public token in its own script bundle. If no page
    // request exposed it, read it from there (once; the result is kept for the session).
    discoverBearer() {
      if (State.auth.bearer) return Promise.resolve();
      if (State.bearerDiscovery) return State.bearerDiscovery;

      const bundles = Array.from(document.scripts)
        .map(script => script.src)
        .filter(src => CONFIG.PATTERNS.BUNDLE_URL.test(src))
        .sort((a, b) => Number(/main\./.test(b)) - Number(/main\./.test(a)))
        .slice(0, CONFIG.MAX_BUNDLE_FETCHES);

      State.bearerDiscovery = (async () => {
        for (const src of bundles) {
          try {
            const token = (await this.gmGetText(src, CONFIG.BUNDLE_TIMEOUT_MS)).match(CONFIG.PATTERNS.BEARER_TOKEN);
            if (token) {
              State.auth.bearer = `Bearer ${token[0]}`;
              return;
            }
          } catch (e) {
            Utils.log('Could not read script bundle', src, e);
          }
        }
      })().finally(() => { State.bearerDiscovery = null; });

      return State.bearerDiscovery;
    },

    // Rewrites a remembered page request so it asks for another tweet.
    rewriteTemplate(templateUrl, tweetId) {
      try {
        const url = new URL(templateUrl);
        const variables = JSON.parse(url.searchParams.get('variables') || '{}');
        if ('focalTweetId' in variables) variables.focalTweetId = tweetId;
        else if ('tweetId' in variables) variables.tweetId = tweetId;
        else return null;
        url.searchParams.set('variables', JSON.stringify(variables));
        return url.href;
      } catch (e) {
        return null;
      }
    },

    buildAuthenticatedUrls(tweetId) {
      const urls = Object.values(State.auth.templates)
        .map(template => this.rewriteTemplate(template, tweetId))
        .filter(Boolean);
      urls.push(`${window.location.origin}${CONFIG.LEGACY_STATUS_PATH}?id=${tweetId}&tweet_mode=extended`);
      return urls;
    },

    // Same-origin request that mimics the page's own, so it carries the viewer's session.
    async fetchWithSession(url) {
      const csrf = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/)?.[1];
      const doFetch = State.originalFetch || pageWindow.fetch;
      const res = await doFetch.call(pageWindow, url, {
        credentials: 'include',
        headers: {
          authorization: State.auth.bearer,
          'x-csrf-token': csrf || '',
          'x-twitter-active-user': 'yes',
          'x-twitter-auth-type': 'OAuth2Session',
          'x-twitter-client-language': 'en'
        }
      });
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      this.ingestText(await res.text());
    },

    // Asks Twitter as the logged-in viewer, which reaches tweets the public endpoint
    // hides (sensitive, age-restricted).
    async fetchAuthenticated(tweetId) {
      await this.discoverBearer();
      if (!State.auth.bearer) throw new Error('No login header available');

      for (const url of this.buildAuthenticatedUrls(tweetId)) {
        try {
          await this.fetchWithSession(url);
        } catch (e) {
          Utils.log('Authenticated lookup failed', url, e);
        }
      }
    },

    setCache(key, url) {
      if (State.videoCache.size >= CONFIG.MAX_CACHE_SIZE) {
        State.videoCache.delete(State.videoCache.keys().next().value);
      }
      State.videoCache.set(key, url);
    },

    isVideoMedia(media) {
      return (media.type === 'video' || media.type === 'animated_gif') && Array.isArray(media.video_info?.variants);
    },

    // Prefers real MP4 files (HLS playlists can't be saved as a single file), highest bitrate first.
    pickBestVariantUrl(variants) {
      const mp4 = variants.filter(v => v.url && v.content_type === 'video/mp4');
      const pool = mp4.length ? mp4 : variants.filter(v => v.url);
      const best = [...pool].sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      return best ? best.url : null;
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
          const tweetId = obj.id_str;
          let videoSlot = 0;
          obj.extended_entities.media.forEach(media => {
            if (!this.isVideoMedia(media)) return;
            const url = this.pickBestVariantUrl(media.video_info.variants);
            if (url) {
              // Primary key: the media item's own unique id_str. It can be
              // cross-referenced directly from the poster thumbnail URL on the DOM
              // side — no ordering assumptions needed.
              if (media.id_str) this.setCache(media.id_str, url);
              // Secondary key (tweetId-slotIndex): fallback for when the poster URL
              // can't be read yet (e.g. video hasn't rendered a thumbnail).
              if (tweetId) this.setCache(`${tweetId}-${videoSlot}`, url);
            }
            videoSlot++;
          });
        }

        for (const [key, val] of Object.entries(obj)) {
          if (CONFIG.IGNORED_JSON_KEYS.has(key)) continue;
          if (val && typeof val === 'object' && !seen.has(val)) {
            seen.add(val);
            queue.push(val);
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

        /* Keyed on the hovered parent rather than .xiv-wrap so the buttons still
           show if React strips our wrapper class during a re-render. The Hover
           module adds .xiv-visible for media covered by transparent overlays. */
        *:hover > .xiv-btn-container,
        .xiv-btn-container:hover,
        .xiv-btn-container.xiv-visible {
            visibility: visible;
            pointer-events: auto !important;
            transition: visibility 0s;
        }

        *:hover > .xiv-btn-container::before,
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

        *:hover > .xiv-btn-container .xiv-action-btn,
        .xiv-btn-container.xiv-visible .xiv-action-btn {
            opacity: 1;
        }

        .xiv-action-btn[data-loading="1"] {
            cursor: default !important;
        }

        *:hover > .xiv-btn-container .xiv-action-btn[data-loading="1"],
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
    },

    // Resolves a video's URL (caches, then syndication, then the logged-in API, then
    // a file the player loaded) and hands it to `onData`. The resolving flag stops
    // repeat clicks from stacking lookups.
    async withVideoData(btnEl, videoComp, onData) {
      if (btnEl.dataset.resolving === "1") return;
      btnEl.dataset.resolving = "1";
      try {
        const slotIndex = Media.getVideoSlotIndex(videoComp);
        const data = await Media.resolveVideo(videoComp, slotIndex);
        if (data) onData(data, slotIndex);
        else Utils.showToast(CONFIG.MESSAGES.VIDEO_NOT_FOUND);
      } catch (e) {
        Utils.log('Video resolution failed', e);
        Utils.showToast(CONFIG.MESSAGES.VIDEO_NOT_FOUND);
      } finally {
        delete btnEl.dataset.resolving;
      }
    }
  };

  const DOM = {
    // A container is healthy only if it is still attached, still lives in an
    // ancestor of its media, and that ancestor still carries our wrapper class.
    // React re-renders (e.g. closing the expanded photo view) can drop any of these
    // while the media element itself survives.
    isInjected(el) {
      const container = State.containers.get(el);
      if (!container || !container.isConnected) return false;
      const parent = container.parentElement;
      return !!parent && parent.contains(el) && parent.classList.contains(CONFIG.CLASSES.WRAPPER);
    },

    removeStaleContainer(el) {
      const stale = State.containers.get(el);
      if (!stale) return;
      stale.remove();
      State.containers.delete(el);
    },

    // Records the media <-> container pairing used by injection checks and hover.
    registerContainer(media, container) {
      State.containers.set(media, container);
      State.owners.set(container, media);
    },

    mountContainer(safeParent, positionClass, kind, insertAfterTarget = null) {
      if (!safeParent) return null;

      safeParent.classList.add(CONFIG.CLASSES.WRAPPER);
      if (getComputedStyle(safeParent).position === 'static') {
        safeParent.style.position = 'relative';
      }

      const container = document.createElement('div');
      container.className = `${CONFIG.CLASSES.CONTAINER} ${positionClass}`;
      container.dataset.xivKind = kind;

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
      if (w < CONFIG.MIN_SIZE || h < CONFIG.MIN_SIZE) {
        // Only remember "too small" once loaded; an unloaded image reports 0x0 and must be retried.
        if (img.complete) State.skipped.set(img, img.src);
        return;
      }

      this.removeStaleContainer(img);
      // If React swapped the <img> but left our old container behind, it sits right after the new image.
      const next = img.nextElementSibling;
      if (next && next.matches(CONFIG.SELECTORS.CONTAINER_IMAGE)) next.remove();

      const isProfile = img.src.includes('profile_images');
      const container = this.mountContainer(
        img.parentElement,
        isProfile ? CONFIG.CLASSES.POS_CENTER_BOT : CONFIG.CLASSES.POS_LEFT,
        CONFIG.KINDS.IMAGE,
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
      this.registerContainer(img, container);
    },

    injectVideoButtons(videoComp) {
      this.removeStaleContainer(videoComp);

      // Each <video> sits in its own wrapper that is already position: relative.
      const mountPoint = videoComp.parentElement;
      if (!mountPoint) return;

      // Containers directly under the wrapper belong to this one video, so
      // leftovers from a replaced player can go.
      mountPoint.querySelectorAll(`:scope > ${CONFIG.SELECTORS.CONTAINER_VIDEO}`).forEach(node => node.remove());

      const container = this.mountContainer(mountPoint, CONFIG.CLASSES.POS_RIGHT, CONFIG.KINDS.VIDEO);
      if (!container) return;

      const openBtn = UI.createButton('Open Video', ICONS.PLAY, (btn, icon) =>
        Handlers.withVideoData(btn, videoComp, (data) =>
          Handlers.handleOpen(btn, icon, data.url, ICONS.PLAY)
        )
      );

      const dlBtn = UI.createButton('Download MP4', ICONS.DOWNLOAD, (btn, icon) =>
        Handlers.withVideoData(btn, videoComp, (data, slotIndex) =>
          Handlers.handleDownload(btn, icon, data.url, `x-vid-${data.id}-${slotIndex}.mp4`, ICONS.DOWNLOAD)
        )
      );

      container.appendChild(openBtn);
      container.appendChild(dlBtn);
      this.registerContainer(videoComp, container);
    },

    // Sends a media element to the IntersectionObserver unless it already has
    // working buttons, is already waiting, or was judged too small at this src.
    queueForInjection(el) {
      if (State.pending.has(el) || this.isInjected(el)) return;
      if (el.src && State.skipped.get(el) === el.src) return;
      State.pending.add(el);
      State.observer.observe(el);
    },

    scan() {
      document.querySelectorAll(CONFIG.SELECTORS.IMG).forEach(img => {
        if (CONFIG.EXCLUDE_URLS.some(p => img.src.includes(p))) return;
        this.queueForInjection(img);
      });

      document.querySelectorAll(CONFIG.SELECTORS.VIDEO).forEach(vid => this.queueForInjection(vid));
    }
  };

  // Shows a media's buttons whenever the pointer is over it, even when a
  // transparent overlay (e.g. the Play button layer on an unplayed video) sits on
  // top, or the media itself ignores pointer events, either of which stops CSS
  // :hover from reaching the media's own parent.
  const Hover = {
    frame: 0,
    x: 0,
    y: 0,

    init() {
      const schedule = () => {
        if (!this.frame) this.frame = requestAnimationFrame(() => this.update());
      };
      document.addEventListener('pointermove', (e) => {
        this.x = e.clientX;
        this.y = e.clientY;
        schedule();
      }, { passive: true });
      // Scrolling moves media under a stationary pointer without any pointermove.
      document.addEventListener('scroll', schedule, { passive: true, capture: true });
      document.documentElement.addEventListener('pointerleave', () => this.apply(new Set()));
    },

    containsPoint(rect) {
      return rect.width > 0 && rect.height > 0
        && this.x >= rect.left && this.x <= rect.right
        && this.y >= rect.top && this.y <= rect.bottom;
    },

    // Media under a modal (e.g. the expanded photo view) must not light up, so a
    // tweet's media only counts when the topmost element is inside that same tweet.
    isReachable(media, topEl) {
      const scope = media.closest(CONFIG.SELECTORS.TWEET);
      return !scope || scope.contains(topEl);
    },

    // Hit-testing path: covers media that is not inside a tweet (e.g. the expanded photo view).
    collectFromStack(stack, next) {
      stack.forEach(el => {
        const container = State.containers.get(el);
        if (container && container.isConnected && this.isReachable(el, stack[0])) next.add(container);
      });
    },

    // Geometry path: covers media that ignores pointer events and so never shows up in the stack.
    collectFromRects(topEl, next) {
      const scope = topEl.closest(CONFIG.SELECTORS.TWEET);
      if (!scope) return;
      scope.querySelectorAll(CONFIG.SELECTORS.CONTAINER).forEach(container => {
        const media = State.owners.get(container);
        if (media && this.containsPoint(media.getBoundingClientRect())) next.add(container);
      });
    },

    update() {
      this.frame = 0;
      const stack = document.elementsFromPoint(this.x, this.y);
      const next = new Set();
      if (stack.length) {
        this.collectFromStack(stack, next);
        this.collectFromRects(stack[0], next);
      }
      this.apply(next);
    },

    apply(next) {
      State.hovered.forEach(container => {
        if (!next.has(container)) container.classList.remove(CONFIG.CLASSES.VISIBLE);
      });
      next.forEach(container => container.classList.add(CONFIG.CLASSES.VISIBLE));
      State.hovered = next;
    }
  };

  // ==========================================================================
  // 7. INITIALIZATION
  // ==========================================================================
  // Network hooks go in right away so the page's earliest requests are seen.
  Interceptor.installHooks();

  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand === 'undefined') return;

    GM_registerMenuCommand('🧹 Clear Video Cache', () => {
      State.videoCache.clear();
      State.observedVideos.clear();
      Utils.showToast('Video cache cleared!');
    });
    GM_registerMenuCommand('🔍 Force DOM Scan', () => { DOM.scan(); Utils.showToast('Forced DOM scan complete!'); });
    GM_registerMenuCommand('🐛 Toggle Debug Mode', () => { CONFIG.DEBUG = !CONFIG.DEBUG; Utils.showToast(`Debug mode ${CONFIG.DEBUG ? 'ON' : 'OFF'}`); });
    GM_registerMenuCommand('📋 Log Captured Videos', () => {
      console.log('[Media Extractor] Status:', {
        ...State.stats,
        cachedVideos: State.videoCache.size,
        observedFiles: State.observedVideos.size,
        loginHeaderFound: !!State.auth.bearer,
        capturedRequestTemplates: Object.keys(State.auth.templates),
        hookedPageWindow: pageWindow !== window
      });
      console.log('[Media Extractor] API data:', Object.fromEntries(State.videoCache));
      console.log('[Media Extractor] Files the player loaded:', Object.fromEntries(State.observedVideos));
      Utils.showToast('Captured videos logged to the console.');
    });
  }

  function init() {
    UI.injectStyles();
    Interceptor.parseInitialDOMState();
    Hover.init();
    registerMenuCommands();

    State.observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;

        const target = entry.target;
        obs.unobserve(target);
        State.pending.delete(target);
        if (DOM.isInjected(target)) return;

        if (target.matches(CONFIG.SELECTORS.IMG)) DOM.injectImageButtons(target);
        else DOM.injectVideoButtons(target);
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
