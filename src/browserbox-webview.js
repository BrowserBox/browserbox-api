/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * BrowserBox SaaS desktop webview API surface.
 */

/**
 * @file BrowserBox Web Component — Canonical Embedding API
 * @description Custom element for embedding BrowserBox remote browser sessions.
 * This is the public API surface for BrowserBox embedding. Consumers create a
 * `<browserbox-webview>` element, set a `login-link`, and call methods on it.
 *
 * ## Usage
 * ```html
 * <browserbox-webview
 *   login-link="https://bbx.example.com/login?token=..."
 *   width="100%"
 *   height="100%">
 * </browserbox-webview>
 * ```
 *
 * ## Attributes
 * | Attribute | Required | Default | Description |
 * |-----------|----------|---------|-------------|
 * | `login-link` | yes | — | Full BrowserBox login URL with auth token |
 * | `width` | no | `"100%"` | CSS width (px if bare number) |
 * | `height` | no | `"100%"` | CSS height (px if bare number) |
 * | `parent-origin` | no | `"*"` | Restrict postMessage origin |
 * | `request-timeout-ms` | no | `30000` | API call timeout (ms) |
 *
 * ## Events
 * | Event | Detail | Description |
 * |-------|--------|-------------|
 * | `ready` | `{ type }` | Legacy transport handshake completed |
 * | `api-ready` | `{ methods: string[] }` | Modern API available |
 * | `ready-timeout` | `{ timeoutMs, error }` | Ready handshake timed out |
 * | `tab-created` | `{ index, id, url }` | New tab opened |
 * | `tab-closed` | `{ index, id }` | Tab closed |
 * | `active-tab-changed` | `{ index, id }` | Active tab switched |
 * | `tab-updated` | `{ id, url, title, faviconDataURI }` | Tab metadata updated |
 * | `did-start-loading` | `{ tabId, url }` | Page load started |
 * | `did-stop-loading` | `{ tabId, url }` | Page load finished |
 * | `did-navigate` | `{ tabId, url }` | Navigation committed |
 * | `policy-denied` | `{ url, reason }` | Navigation blocked by policy |
 * | `usability-changed` | `{ usable: boolean }` | Browser usability state changed |
 * | `disconnected` | — | Session ended (element removed or login-link changed) |
 *
 * ## Transport
 * The component auto-detects transport on first API call:
 * - **modern** (`bbx-api-call`): Full method dispatch, discovered via `api-ready`
 * - **legacy** (individual postMessage types): Fallback for older BBX versions
 * Detection is one-shot — once resolved, transport is locked for the session.
 *
 * @example
 * const bbx = document.querySelector('browserbox-webview');
 * await bbx.whenReady();
 * await bbx.createTab('https://example.com');
 * const tabs = await bbx.getTabs();
 * console.log(tabs); // [{ index: 0, id: '...', url: '...', title: '...' }]
 */
class BrowserBoxWebview extends HTMLElement {
  static get observedAttributes() {
    return ['login-link', 'width', 'height', 'parent-origin', 'request-timeout-ms'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    this.iframe = document.createElement('iframe');
    this.iframe.allowFullscreen = true;
    this.iframe.setAttribute(
      'allow',
      'accelerometer; camera; encrypted-media; display-capture; geolocation; gyroscope; microphone; midi; clipboard-read; clipboard-write; web-share; fullscreen'
    );
    this.iframe.setAttribute(
      'sandbox',
      'allow-same-origin allow-forms allow-scripts allow-top-navigation allow-top-navigation-by-user-activation allow-storage-access-by-user-activation allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-pointer-lock'
    );

    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: block;
        margin: 0;
        padding: 0;
        overflow: hidden;
        outline: none;
      }
      :host(:focus), :host(:focus-visible) {
        outline: none;
      }
      iframe {
        border: none;
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        display: block;
        outline: none;
      }
      iframe:focus, iframe:focus-visible {
        outline: none;
      }
    `;

    this.shadowRoot.append(style, this.iframe);

    this._requestSeq = 0;
    this._pending = new Map();
    this._apiMethods = [];
    this._isReady = false;
    this._usable = false;
    this._readyPromise = Promise.resolve(true);
    this._initPingTimer = null;
    this._transportMode = 'unknown';
    this._legacyTabsCache = [];

    // Iframe connection retry state
    this._iframeRetryCount = 0;
    this._iframeRetryMax = 5;
    this._iframeRetryPingThreshold = 10; // pings before retry
    this._initPingCount = 0;
    this._reconnectStopped = false;
    this._silentRecoveryUsed = false;
    this._silentRecoveryParam = 'bbx_embed_retry';

    // Mid routing durability handshake state
    this._routingMid = '';
    this._midStorageKey = 'bbx.embedder.mid';
    this._midSyncAcked = false;
    this._midSyncTimer = null;
    this._midSyncAttempt = 0;
    this._midSyncMaxAttempts = 20;
    this._midSyncIntervalMs = 1000;

    this._boundMessage = this._handleMessage.bind(this);
    this._boundLoad = this._handleLoad.bind(this);
    this._resetReadyPromise();
  }

  connectedCallback() {
    window.addEventListener('message', this._boundMessage);
    this.iframe.addEventListener('load', this._boundLoad);
    this.updateIframe();
  }

  disconnectedCallback() {
    window.removeEventListener('message', this._boundMessage);
    this.iframe.removeEventListener('load', this._boundLoad);
    this._stopInitPing();
    this._stopMidSync();
    this._rejectPending(new Error('browserbox-webview disconnected'));
    this._setUsable(false, 'disconnected');
    this.dispatchEvent(new CustomEvent('disconnected'));
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) {
      return;
    }
    if (name === 'login-link') {
      this._isReady = false;
      this._apiMethods = [];
      this._transportMode = 'unknown';
      this._legacyTabsCache = [];
      this._iframeRetryCount = 0;
      this._initPingCount = 0;
      this._reconnectStopped = false;
      this._silentRecoveryUsed = false;
      this._resetReadyPromise();
      this._rejectPending(new Error('browserbox-webview source changed'));
      this.dispatchEvent(new CustomEvent('disconnected'));
      this._updateIframeSrcFromAttribute(name);
      this._startMidSync('login-link-changed');
      return;
    }
    if (name === 'width' || name === 'height') {
      this._applyHostDimensions();
    }
  }

  _resetReadyPromise() {
    this._readyPromise = new Promise((resolve) => {
      this._resolveReady = resolve;
    });
  }

  _setReady() {
    if (!this._isReady) {
      this._isReady = true;
      this._setUsable(true, 'ready');
      this._iframeRetryCount = 0;
      this._reconnectStopped = false;
      this._stopInitPing();
      if (typeof this._resolveReady === 'function') {
        this._resolveReady(true);
      }
    }
  }

  _rejectPending(error) {
    for (const pending of this._pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this._pending.clear();
  }

  _setUsable(next, reason = '') {
    const usable = Boolean(next);
    if (this._usable === usable) return;
    this._usable = usable;
    this.dispatchEvent(new CustomEvent('usability-changed', {
      detail: {
        usable,
        reason,
      },
    }));
  }

  async _withRetry(task, {
    attempts = 3,
    baseDelayMs = 250,
    maxDelayMs = 1500,
    shouldRetry = () => false,
  } = {}) {
    let attempt = 0;
    let lastError = null;
    while (attempt < attempts) {
      try {
        return await task(attempt);
      } catch (error) {
        lastError = error;
        attempt += 1;
        if (attempt >= attempts || !shouldRetry(error, attempt)) {
          throw error;
        }
        const delayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw lastError || new Error('retry failed');
  }

  _isRetryableApiError(error) {
    const message = String(error?.message || '').toLowerCase();
    return (
      message.includes('timed out')
      || message.includes('not ready')
      || message.includes('disconnected')
      || message.includes('reconnect stopped')
    );
  }

  _handleLoad() {
    const needsReset = this._isReady;
    this._isReady = false;
    this._apiMethods = [];
    this._transportMode = 'unknown';
    this._legacyTabsCache = [];
    this._initPingCount = 0;
    if (needsReset) {
      this._iframeRetryCount = 0;
      this._resetReadyPromise();
    }
    this._midSyncAcked = false;
    this._startMidSync('iframe-load');
    this._startInitPing();
  }

  _startInitPing() {
    if (this._reconnectStopped) {
      return;
    }
    this._stopInitPing();
    this._initPingCount = 0;
    this._postRaw({ type: 'init' });
    this._initPingTimer = setInterval(() => {
      if (this._reconnectStopped) {
        this._stopInitPing();
        return;
      }
      if (this._isReady) {
        this._stopInitPing();
        return;
      }
      this._initPingCount += 1;
      if (this._initPingCount >= this._iframeRetryPingThreshold) {
        if (this._iframeRetryCount < this._iframeRetryMax) {
          this._retryIframeLoad();
          return;
        }
        if (this._attemptSilentRecovery('iframe-unresponsive')) {
          return;
        }
        this.stopReconnectAttempts('iframe-unresponsive');
        return;
      }
      this._postRaw({ type: 'init' });
    }, 1000);
  }

  _retryIframeLoad() {
    this._stopInitPing();
    this._iframeRetryCount += 1;
    const src = this.iframe.src;
    if (!src) return;
    const delay = Math.min(2000 * this._iframeRetryCount, 8000);
    console.log(
      `[browserbox-webview] iframe not responsive after ${this._iframeRetryPingThreshold}s, `
      + `retry ${this._iframeRetryCount}/${this._iframeRetryMax} in ${delay}ms`
    );
    this.dispatchEvent(new CustomEvent('iframe-retry', {
      detail: { attempt: this._iframeRetryCount, maxAttempts: this._iframeRetryMax, delayMs: delay },
    }));
    setTimeout(() => {
      if (this._isReady || this._reconnectStopped) return;
      this._assignIframeSrc(src, '_retryIframeLoad');
    }, delay);
  }

  _assignIframeSrc(nextSrc, reason) {
    const stack = new Error().stack || '(no stack available)';
    console.log('[DEBUG][SRC_ASSIGN]', {
      reason,
      currentSrc: this.iframe.src,
      nextSrc,
      stack,
    });
    this.iframe.src = nextSrc;
  }

  _normalizeUrl(url) {
    if (typeof url !== 'string' || url.length === 0) return '';
    try {
      return new URL(url, window.location.href).href;
    } catch {
      return url;
    }
  }

  _attemptSilentRecovery(reason) {
    if (this._silentRecoveryUsed) {
      return false;
    }
    const currentSrc = this._normalizeUrl(this.iframe.src || this.getAttribute('login-link'));
    if (!currentSrc) {
      return false;
    }

    let nextSrc;
    try {
      const parsed = new URL(currentSrc, window.location.href);
      const existingAttempt = Number(parsed.searchParams.get(this._silentRecoveryParam) || 0);
      if (!Number.isFinite(existingAttempt) || existingAttempt >= 1) {
        return false;
      }
      parsed.searchParams.set(this._silentRecoveryParam, String(existingAttempt + 1));
      // Cache-bust to avoid stale iframe boot assets after session/token rotation.
      parsed.searchParams.set('bbx_recover_t', String(Date.now()));
      nextSrc = parsed.href;
    } catch {
      return false;
    }

    this._silentRecoveryUsed = true;
    this._isReady = false;
    this._apiMethods = [];
    this._transportMode = 'unknown';
    this._legacyTabsCache = [];
    this._iframeRetryCount = 0;
    this._initPingCount = 0;
    this._midSyncAcked = false;
    this._reconnectStopped = false;
    this._resetReadyPromise();
    this._rejectPending(new Error(`browserbox-webview silent recovery (${reason})`));

    console.info('[browserbox-webview] attempting one-shot silent recovery reload', {
      reason,
      nextSrc,
    });
    this._assignIframeSrc(nextSrc, 'silent-recovery');
    return true;
  }

  _updateIframeSrcFromAttribute(trigger) {
    const loginLink = this.getAttribute('login-link');
    if (!loginLink) return;
    this._refreshRoutingMid(loginLink);
    const normalizedCurrent = this._normalizeUrl(this.iframe.src);
    const normalizedNext = this._normalizeUrl(loginLink);
    if (normalizedCurrent === normalizedNext) {
      return;
    }
    this._assignIframeSrc(loginLink, trigger);
  }

  _applyHostDimensions() {
    const width = this.getAttribute('width') || '100%';
    const height = this.getAttribute('height') || '100%';
    this.style.width = /^\d+$/.test(width) ? `${width}px` : width;
    this.style.height = /^\d+$/.test(height) ? `${height}px` : height;
  }

  _stopInitPing() {
    if (this._initPingTimer) {
      clearInterval(this._initPingTimer);
      this._initPingTimer = null;
    }
  }

  _normalizeMid(value) {
    const mid = String(value || '').trim();
    return /^[A-Za-z0-9-]{6,64}$/.test(mid) ? mid : '';
  }

  _refreshRoutingMid(loginLink = this.getAttribute('login-link')) {
    let storageKey = this._midStorageKey;
    let midFromLogin = '';
    try {
      const parsed = new URL(loginLink || '', window.location.href);
      storageKey = `bbx.embedder.mid:${parsed.origin}`;
      midFromLogin = this._normalizeMid(parsed.searchParams.get('mid'));
    } catch {
      // Keep fallback values when login-link is not parseable.
    }

    let persistedMid = '';
    try {
      persistedMid = this._normalizeMid(window.localStorage?.getItem?.(storageKey));
    } catch {
      // Storage may be blocked in some embedding contexts.
    }

    const resolvedMid = midFromLogin || persistedMid || this._routingMid;
    this._midStorageKey = storageKey;
    this._routingMid = resolvedMid || '';

    if (midFromLogin) {
      try {
        window.localStorage?.setItem?.(storageKey, midFromLogin);
      } catch {
        // Storage writes are best-effort only.
      }
    }

    if (this._routingMid) {
      this.setAttribute('routing-mid', this._routingMid);
    } else {
      this.removeAttribute('routing-mid');
    }
    if (this._routingMid) {
      console.info('[bbx-mid] routing mid resolved', {
        mid: this._routingMid,
        source: midFromLogin ? 'login-link' : (persistedMid ? 'storage' : 'memory'),
      });
    } else {
      console.info('[bbx-mid] no routing mid resolved');
    }
    return this._routingMid;
  }

  _postMidSync(reason = '') {
    const mid = this._refreshRoutingMid();
    if (!mid || !this.iframe.contentWindow) {
      return false;
    }
    this._postRaw({
      type: 'bbx-mid-sync',
      data: {
        mid,
        reason,
        attempt: this._midSyncAttempt,
      },
    });
    console.info('[bbx-mid] sent sync', {
      mid,
      reason,
      attempt: this._midSyncAttempt,
    });
    return true;
  }

  _startMidSync(reason = 'start') {
    this._stopMidSync();
    this._midSyncAcked = false;
    this._midSyncAttempt = 0;
    if (!this._postMidSync(reason)) {
      return;
    }
    this._midSyncAttempt = 1;
    this._midSyncTimer = setInterval(() => {
      if (this._midSyncAcked) {
        this._stopMidSync();
        return;
      }
      if (this._midSyncAttempt >= this._midSyncMaxAttempts) {
        this._stopMidSync();
        console.warn('[bbx-mid] sync timeout', {
          attempts: this._midSyncAttempt,
          mid: this._routingMid,
        });
        this.dispatchEvent(new CustomEvent('mid-sync-timeout', {
          detail: {
            attempts: this._midSyncAttempt,
            mid: this._routingMid,
          },
        }));
        this._setUsable(false, 'mid-sync-timeout');
        return;
      }
      this._midSyncAttempt += 1;
      this._postMidSync('retry');
    }, this._midSyncIntervalMs);
  }

  _stopMidSync() {
    if (this._midSyncTimer) {
      clearInterval(this._midSyncTimer);
      this._midSyncTimer = null;
    }
  }

  _allowedOrigin() {
    const configured = this.parentOrigin;
    if (configured && configured !== '*') {
      return configured;
    }
    // Use '*' for outbound postMessage. The iframe content window origin may be
    // 'null' during initial load (before navigation completes), causing
    // postMessage to throw if we target a specific origin. Inbound validation
    // via _validateIncomingOrigin still checks the source origin.
    return '*';
  }

  _validateIncomingOrigin(origin) {
    const allowed = this._allowedOrigin();
    return allowed === '*' || origin === allowed;
  }

  _normalizeTabId(detail) {
    if (!detail || typeof detail !== 'object') return null;
    const candidates = [detail.id, detail.tabId, detail.targetId];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.length > 0) {
        return candidate;
      }
    }
    return null;
  }

  _updateLegacyTabCache(detail) {
    const tabId = this._normalizeTabId(detail);
    if (!tabId) return;
    const index = this._legacyTabsCache.findIndex((tab) => this._normalizeTabId(tab) === tabId);
    if (index === -1) return;
    const existing = this._legacyTabsCache[index];
    this._legacyTabsCache[index] = {
      ...existing,
      ...detail,
      index: existing.index ?? detail.index ?? index,
    };
  }

  _addLegacyTabCache(detail) {
    const tabId = this._normalizeTabId(detail);
    if (!tabId) return;
    const existingIndex = this._legacyTabsCache.findIndex((tab) => this._normalizeTabId(tab) === tabId);
    if (existingIndex !== -1) {
      this._updateLegacyTabCache(detail);
      return;
    }
    const index = Number.isInteger(detail.index) ? detail.index : this._legacyTabsCache.length;
    const entry = { ...detail, index };
    this._legacyTabsCache.splice(Math.min(index, this._legacyTabsCache.length), 0, entry);
    this._legacyTabsCache = this._legacyTabsCache.map((tab, i) => ({ ...tab, index: i }));
  }

  _removeLegacyTabCache(detail) {
    const tabId = this._normalizeTabId(detail);
    if (!tabId) return;
    this._legacyTabsCache = this._legacyTabsCache
      .filter((tab) => this._normalizeTabId(tab) !== tabId)
      .map((tab, i) => ({ ...tab, index: i }));
  }

  _handleMessage(event) {
    if (event.source !== this.iframe.contentWindow) {
      return;
    }
    if (!this._validateIncomingOrigin(event.origin)) {
      return;
    }

    const payload = event.data || {};
    if (typeof payload.type !== 'string') {
      return;
    }

    if (payload.type === 'bbx-mid-request') {
      console.info('[bbx-mid] child requested mid');
      this._postMidSync('child-request');
      return;
    }

    if (payload.type === 'bbx-mid-ack') {
      const ackMid = this._normalizeMid(payload.data?.mid ?? payload.mid);
      console.info('[bbx-mid] received ack', {
        ackMid,
        expectedMid: this._routingMid,
      });
      if (this._routingMid && (!ackMid || ackMid === this._routingMid)) {
        this._midSyncAcked = true;
        this._stopMidSync();
        console.info('[bbx-mid] sync established', {
          mid: this._routingMid,
          attempts: Math.max(1, this._midSyncAttempt),
        });
        this.dispatchEvent(new CustomEvent('mid-synced', {
          detail: {
            mid: this._routingMid,
            attempts: Math.max(1, this._midSyncAttempt),
          },
        }));
      } else {
        console.warn('[bbx-mid] ack mid mismatch', {
          ackMid,
          expectedMid: this._routingMid,
        });
      }
      return;
    }

    if (payload.requestId && this._pending.has(payload.requestId)) {
      const pending = this._pending.get(payload.requestId);
      clearTimeout(pending.timer);
      this._pending.delete(payload.requestId);
      if (payload.error) {
        pending.reject(new Error(payload.error));
      } else {
        pending.resolve(payload.data);
      }
      return;
    }

    if (payload.type === 'tab-api-ready') {
      this._setReady();
      this.dispatchEvent(new CustomEvent('ready', { detail: { type: payload.type } }));
      return;
    }

    if (payload.type === 'bbx-api-ready') {
      if (Array.isArray(payload.data?.methods)) {
        this._apiMethods = payload.data.methods.slice();
        this._transportMode = 'modern';
      }
      this._setReady();
      this.dispatchEvent(new CustomEvent('api-ready', { detail: payload.data || {} }));
      return;
    }

    if (payload.type === 'tab-updated') {
      this._updateLegacyTabCache(payload.data);
    } else if (payload.type === 'tab-created') {
      this._addLegacyTabCache(payload.data);
    } else if (payload.type === 'tab-closed') {
      this._removeLegacyTabCache(payload.data);
    }

    this.dispatchEvent(new CustomEvent(payload.type, { detail: payload.data || {} }));
  }

  _request(type, data = {}, options = {}) {
    if (!this.iframe.contentWindow) {
      return Promise.reject(new Error('browserbox-webview iframe is not ready.'));
    }

    const timeoutMs = Number.isFinite(options.timeoutMs)
      ? Math.max(100, Math.round(options.timeoutMs))
      : this.requestTimeoutMs;

    const requestId = `bbx-${Date.now()}-${++this._requestSeq}`;
    const message = { type, requestId, data, ...(options.messageExtras || {}) };
    const targetOrigin = this._allowedOrigin();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(requestId);
        reject(new Error(`browserbox-webview request timed out (${type}) after ${timeoutMs}ms`));
      }, timeoutMs);

      this._pending.set(requestId, { resolve, reject, timer });
      this.iframe.contentWindow.postMessage(message, targetOrigin);
    });
  }

  _postRaw(message) {
    if (!this.iframe.contentWindow) {
      return;
    }
    this.iframe.contentWindow.postMessage(message, this._allowedOrigin());
  }

  async whenReady({ timeoutMs = this.requestTimeoutMs } = {}) {
    if (this._isReady) {
      return true;
    }

    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`browserbox-webview ready timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    await Promise.race([this._readyPromise, timeout]);
    return true;
  }

  async _ensureReadyForApi() {
    if (this._isReady) {
      return true;
    }
    const softTimeoutMs = Math.min(this.requestTimeoutMs, 8000);
    try {
      await this.whenReady({ timeoutMs: softTimeoutMs });
      return true;
    } catch (error) {
      this._setReady();
      this.dispatchEvent(new CustomEvent('ready-timeout', {
        detail: {
          timeoutMs: softTimeoutMs,
          error: error instanceof Error ? error.message : String(error),
        },
      }));
      return false;
    }
  }

  _legacyMethodList() {
    return [
      'getTabs',
      'getActiveTabIndex',
      'getTabCount',
      'createTab',
      'createTabs',
      'closeTab',
      'closeTabById',
      'closeAllTabs',
      'switchToTab',
      'switchToTabById',
      'navigateTo',
      'navigateTab',
      'submitOmnibox',
      'reload',
      'goBack',
      'goForward',
      'stop',
      'evaluate',
      'waitForTabCount',
      'waitForTabUrl',
    ];
  }

  /**
   * Resolve transport mode. Called once on first API call if transport is
   * still 'unknown'. After resolution, transport is locked for the session.
   * @returns {Promise<'modern'|'legacy'>}
   */
  async _resolveTransport() {
    if (this._transportMode !== 'unknown') return this._transportMode;
    try {
      await this._request('bbx-api-call', { method: 'getTabCount', args: [] }, {
        timeoutMs: Math.min(this.requestTimeoutMs, 5000),
      });
      this._transportMode = 'modern';
    } catch {
      this._transportMode = 'legacy';
    }
    return this._transportMode;
  }

  async listApiMethods(options = {}) {
    if (this._apiMethods.length > 0) {
      return this._apiMethods.slice();
    }
    await this._ensureReadyForApi();
    if (this._transportMode === 'legacy') {
      this._apiMethods = this._legacyMethodList();
      return this._apiMethods.slice();
    }
    try {
      const methods = await this._request('bbx-api-list', {}, {
        ...options,
        timeoutMs: Number.isFinite(options.timeoutMs)
          ? options.timeoutMs
          : Math.min(this.requestTimeoutMs, 5000),
      });
      this._apiMethods = Array.isArray(methods) ? methods.slice() : [];
      this._transportMode = 'modern';
    } catch {
      this._transportMode = 'legacy';
      this._apiMethods = this._legacyMethodList();
    }
    return this._apiMethods.slice();
  }

  /**
   * Call a BrowserBox API method by name.
   * @param {string} method - API method name (e.g. 'getTabs', 'createTab')
   * @param {...*} args - Method arguments
   * @returns {Promise<*>} Method result
   * @throws {Error} If method is empty, transport fails, or call times out
   */
  async callApi(method, ...args) {
    if (typeof method !== 'string' || method.trim().length === 0) {
      throw new Error('callApi(method, ...args) requires a non-empty method string.');
    }
    const invoke = async () => {
      await this._ensureReadyForApi();
      const normalizedMethod = method.trim();

      if (this._transportMode === 'unknown') {
        await this._resolveTransport();
      }

      if (this._transportMode === 'legacy') {
        return this._legacyCall(normalizedMethod, args);
      }

      return this._request('bbx-api-call', { method: normalizedMethod, args }, {
        timeoutMs: this.requestTimeoutMs,
      });
    };

    try {
      const result = await this._withRetry(invoke, {
        attempts: 3,
        baseDelayMs: 300,
        maxDelayMs: 1500,
        shouldRetry: (error) => this._isRetryableApiError(error),
      });
      this._setUsable(true, 'api-ok');
      return result;
    } catch (error) {
      if (this._isRetryableApiError(error)) {
        this._setUsable(false, 'api-failed');
      }
      throw error;
    }
  }

  // Canonical BrowserBox API wrappers
  switchToTab(index) { return this.callApi('switchToTab', index); }
  switchToTabById(targetId) { return this.callApi('switchToTabById', targetId); }
  navigateTo(url, opts = {}) { return this.callApi('navigateTo', url, opts); }
  navigateTab(index, url, opts = {}) { return this.callApi('navigateTab', index, url, opts); }
  submitOmnibox(query, opts = {}) { return this.callApi('submitOmnibox', query, opts); }
  createTab(url = '') { return this.callApi('createTab', url); }
  createTabs(count, opts = {}) { return this.callApi('createTabs', count, opts); }
  closeTab(index = null) { return this.callApi('closeTab', index); }
  closeTabById(targetId) { return this.callApi('closeTabById', targetId); }
  closeAllTabs(opts = {}) { return this.callApi('closeAllTabs', opts); }
  getTabs() { return this.callApi('getTabs'); }
  getFavicons() { return this.callApi('getFavicons'); }
  waitForNonDefaultFavicon(index, opts = {}) { return this.callApi('waitForNonDefaultFavicon', index, opts); }
  waitForTabCount(expectedCount, opts = {}) { return this.callApi('waitForTabCount', expectedCount, opts); }
  waitForTabUrl(index, opts = {}) { return this.callApi('waitForTabUrl', index, opts); }
  getActiveTabIndex() { return this.callApi('getActiveTabIndex'); }
  getTabCount() { return this.callApi('getTabCount'); }
  reload() { return this.callApi('reload'); }
  goBack() { return this.callApi('goBack'); }
  goForward() { return this.callApi('goForward'); }
  stop() { return this.callApi('stop'); }
  getScreenMetrics() { return this.callApi('getScreenMetrics'); }
  getTransportDiagnostics() { return this.callApi('getTransportDiagnostics'); }
  async health({ timeoutMs } = {}) {
    if (!this.iframe.contentWindow) {
      this._setUsable(false, 'iframe-not-ready');
      throw new Error('browserbox-webview health check failed: iframe is not ready.');
    }
    const effectiveTimeoutMs = Number.isFinite(timeoutMs)
      ? Math.max(100, Math.round(timeoutMs))
      : Math.min(this.requestTimeoutMs, 8000);
    const tryModern = () => this._request(
      'bbx-api-call',
      { method: 'getTabCount', args: [] },
      { timeoutMs: effectiveTimeoutMs },
    );
    const tryLegacy = () => this._request('getTabCount', {}, { timeoutMs: effectiveTimeoutMs });

    try {
      const result = await this._withRetry(async () => {
        if (this._transportMode === 'modern') {
          await tryModern();
          return true;
        }
        if (this._transportMode === 'legacy') {
          await tryLegacy();
          return true;
        }
        try {
          await tryModern();
          this._transportMode = 'modern';
          return true;
        } catch (modernError) {
          try {
            await tryLegacy();
            this._transportMode = 'legacy';
            return true;
          } catch (legacyError) {
            const message = `browserbox-webview health check failed after ${effectiveTimeoutMs}ms `
              + `(modern error: ${modernError instanceof Error ? modernError.message : String(modernError)}; `
              + `legacy error: ${legacyError instanceof Error ? legacyError.message : String(legacyError)})`;
            throw new Error(message, { cause: legacyError });
          }
        }
      }, {
        attempts: 2,
        baseDelayMs: 250,
        maxDelayMs: 750,
        shouldRetry: (error) => this._isRetryableApiError(error),
      });
      this._setUsable(true, 'health-ok');
      return result;
    } catch (error) {
      this._setUsable(false, 'health-failed');
      throw error;
    }
  }

  // Automation surface
  waitForSelector(selector, opts = {}) { return this.callApi('waitForSelector', selector, opts); }
  click(selector, opts = {}) { return this.callApi('click', selector, opts); }
  type(selector, text, opts = {}) { return this.callApi('type', selector, text, opts); }
  evaluate(expression, opts = {}) { return this.callApi('evaluate', expression, opts); }
  waitForNavigation(opts = {}) { return this.callApi('waitForNavigation', opts); }

  refresh() {
    if (this.iframe.src) {
      this._isReady = false;
      this._apiMethods = [];
      this._transportMode = 'unknown';
      this._legacyTabsCache = [];
      this._reconnectStopped = false;
      this._midSyncAcked = false;
      this._resetReadyPromise();
      this._rejectPending(new Error('browserbox-webview refreshed'));
      const currentSrc = this.iframe.src;
      this._assignIframeSrc(currentSrc, 'refresh');
    }
  }

  stopReconnectAttempts(reason = 'manual-stop') {
    this._reconnectStopped = true;
    this._stopInitPing();
    this._stopMidSync();
    this._setUsable(false, reason);
    this._rejectPending(new Error(`browserbox-webview reconnect stopped (${reason})`));
  }

  updateIframe() {
    this._refreshRoutingMid();
    this._updateIframeSrcFromAttribute('updateIframe');
    this._applyHostDimensions();
  }

  get loginLink() {
    return this.getAttribute('login-link');
  }

  set loginLink(value) {
    if (value) this.setAttribute('login-link', value);
    else this.removeAttribute('login-link');
  }

  get routingMid() {
    return this._routingMid || '';
  }

  get width() {
    return this.getAttribute('width');
  }

  set width(value) {
    if (value) this.setAttribute('width', value);
    else this.removeAttribute('width');
  }

  get height() {
    return this.getAttribute('height');
  }

  set height(value) {
    if (value) this.setAttribute('height', value);
    else this.removeAttribute('height');
  }

  get parentOrigin() {
    return this.getAttribute('parent-origin') || '*';
  }

  set parentOrigin(value) {
    if (value) this.setAttribute('parent-origin', value);
    else this.removeAttribute('parent-origin');
  }

  get requestTimeoutMs() {
    const raw = this.getAttribute('request-timeout-ms');
    const parsed = Number.parseInt(raw || '30000', 10);
    if (!Number.isFinite(parsed) || parsed < 100) {
      return 30000;
    }
    return parsed;
  }

  set requestTimeoutMs(value) {
    if (value === null || value === undefined) {
      this.removeAttribute('request-timeout-ms');
      return;
    }
    this.setAttribute('request-timeout-ms', String(value));
  }

  /**
   * Legacy transport dispatch. Each handler is a small function in a lookup
   * table — avoids the 180-line if/else chain (Architecture §6, §3).
   * @param {string} method
   * @param {Array} args
   * @param {Error|null} originalError
   * @returns {Promise<*>}
   */
  async _legacyCall(method, args = [], originalError = null) {
    const handler = this._legacyHandlers[method];
    if (!handler) {
      const detail = originalError?.message ? ` (${originalError.message})` : '';
      throw new Error(`No legacy fallback for API method '${method}'${detail}`);
    }
    return handler.call(this, args, originalError);
  }

  get _legacyHandlers() {
    if (this.__legacyHandlers) return this.__legacyHandlers;
    const self = this;

    const fail = (message, originalError = null) => {
      const detail = originalError?.message ? ` (${originalError.message})` : '';
      throw new Error(`${message}${detail}`);
    };

    const resolveTabId = async (indexArg = null) => {
      if (typeof indexArg === 'string' && indexArg.trim().length > 0) return indexArg.trim();
      const tabs = await self._legacyHandlers.getTabs.call(self, []);
      if (Array.isArray(tabs) && tabs.length > 0) {
        const requested = Number.isInteger(indexArg) ? indexArg : 0;
        const normalized = requested < 0 ? tabs.length + requested : requested;
        const safeIndex = Math.max(0, Math.min(tabs.length - 1, normalized));
        return tabs[safeIndex]?.id || tabs[safeIndex]?.targetId || null;
      }
      const activeTab = await self._request('getActiveTab', {}).catch(() => null);
      return activeTab?.id || activeTab?.targetId || null;
    };

    this.__legacyHandlers = {
      async getTabs() {
        let tabs;
        try {
          tabs = await self._request('getTabs', {});
        } catch {
          tabs = self._legacyTabsCache.slice();
        }
        if (!Array.isArray(tabs)) return self._legacyTabsCache.slice();
        const normalizedTabs = tabs.map((tab, index) => ({ index, ...tab }));
        self._legacyTabsCache = normalizedTabs.slice();
        return normalizedTabs;
      },

      async getActiveTabIndex() {
        const [tabs, activeTab] = await Promise.all([
          self._legacyHandlers.getTabs.call(self, []),
          self._request('getActiveTab', {}).catch(() => null),
        ]);
        if (!activeTab || !Array.isArray(tabs)) return -1;
        const activeId = activeTab.id || activeTab.targetId || null;
        return tabs.findIndex((tab) => (tab.id || tab.targetId) === activeId);
      },

      async getTabCount() {
        const tabs = await self._legacyHandlers.getTabs.call(self, []);
        return Array.isArray(tabs) ? tabs.length : 0;
      },

      async createTab(args) {
        const url = typeof args[0] === 'string' ? args[0] : '';
        self._postRaw({ type: 'createTab', data: { url } });
        return true;
      },

      async createTabs(args) {
        const count = Number.isInteger(args[0]) && args[0] > 0 ? args[0] : 0;
        const opts = args[1] || {};
        const url = typeof opts.url === 'string' ? opts.url : '';
        for (let i = 0; i < count; i += 1) {
          self._postRaw({ type: 'createTab', data: { url } });
        }
        return true;
      },

      async closeTab(args, originalError) {
        const tabId = await resolveTabId(args[0]);
        if (!tabId) fail('Legacy closeTab failed: no target tab', originalError);
        self._postRaw({ type: 'closeTab', tabId, data: {} });
        return true;
      },

      async closeTabById(args, originalError) {
        const tabId = typeof args[0] === 'string' && args[0].trim().length > 0 ? args[0].trim() : null;
        if (!tabId) fail('Legacy closeTabById requires a non-empty targetId string', originalError);
        self._postRaw({ type: 'closeTab', tabId, data: {} });
        return true;
      },

      async closeAllTabs(args) {
        const opts = args[0] || {};
        const keep = Number.isInteger(opts.keep) ? Math.max(0, opts.keep) : 0;
        const tabs = await self._legacyHandlers.getTabs.call(self, []);
        if (!Array.isArray(tabs) || tabs.length <= keep) return tabs?.length || 0;
        for (let i = tabs.length - 1; i >= keep; i -= 1) {
          const tabId = tabs[i]?.id || tabs[i]?.targetId;
          if (!tabId) continue;
          self._postRaw({ type: 'closeTab', tabId, data: {} });
        }
        return Math.max(keep, 0);
      },

      async switchToTab(args, originalError) {
        const tabId = await resolveTabId(args[0]);
        if (!tabId) fail('Legacy switchToTab failed: no target tab', originalError);
        self._postRaw({ type: 'setActiveTab', tabId, data: {} });
        return true;
      },

      async switchToTabById(args, originalError) {
        const tabId = typeof args[0] === 'string' && args[0].trim().length > 0 ? args[0].trim() : null;
        if (!tabId) fail('Legacy switchToTabById requires a non-empty targetId string', originalError);
        self._postRaw({ type: 'setActiveTab', tabId, data: {} });
        return true;
      },

      async navigateTo(args, originalError) {
        const url = typeof args[0] === 'string' ? args[0] : '';
        const tabId = await resolveTabId(null);
        if (!tabId) fail('Legacy navigateTo failed: no active tab', originalError);
        self._postRaw({ type: 'loadURL', tabId, data: { url } });
        return true;
      },

      async navigateTab(args, originalError) {
        const tabId = await resolveTabId(args[0]);
        const url = typeof args[1] === 'string' ? args[1] : '';
        if (!tabId) fail('Legacy navigateTab failed: no target tab', originalError);
        self._postRaw({ type: 'setActiveTab', tabId, data: {} });
        self._postRaw({ type: 'loadURL', tabId, data: { url } });
        return true;
      },

      async submitOmnibox(args, originalError) {
        const query = typeof args[0] === 'string' ? args[0] : '';
        return self._legacyHandlers.navigateTo.call(self, [query], originalError);
      },

      async reload(args, originalError) {
        const tabId = await resolveTabId(null);
        if (!tabId) fail('Legacy reload failed: no active tab', originalError);
        self._postRaw({ type: 'reload', tabId, data: {} });
        return true;
      },

      async goBack(args, originalError) {
        const tabId = await resolveTabId(null);
        if (!tabId) fail('Legacy goBack failed: no active tab', originalError);
        self._postRaw({ type: 'goBack', tabId, data: {} });
        return true;
      },

      async goForward(args, originalError) {
        const tabId = await resolveTabId(null);
        if (!tabId) fail('Legacy goForward failed: no active tab', originalError);
        self._postRaw({ type: 'goForward', tabId, data: {} });
        return true;
      },

      async stop(args, originalError) {
        const tabId = await resolveTabId(null);
        if (!tabId) fail('Legacy stop failed: no active tab', originalError);
        self._postRaw({ type: 'stop', tabId, data: {} });
        return true;
      },

      async evaluate(args, originalError) {
        const expression = typeof args[0] === 'string' ? args[0] : '';
        const tabId = await resolveTabId(null);
        if (!tabId) fail('Legacy evaluate failed: no active tab', originalError);
        if (expression.includes('history.back')) {
          self._postRaw({ type: 'goBack', tabId, data: {} });
          return true;
        }
        if (expression.includes('history.forward')) {
          self._postRaw({ type: 'goForward', tabId, data: {} });
          return true;
        }
        if (expression.includes('window.stop')) {
          self._postRaw({ type: 'stop', tabId, data: {} });
          return true;
        }
        fail('Legacy evaluate only supports history.back, history.forward, and window.stop', originalError);
      },

      async waitForTabCount(args, originalError) {
        const expectedCount = Number.isInteger(args[0]) ? args[0] : 0;
        const opts = args[1] || {};
        const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : self.requestTimeoutMs;
        const pollMs = Number.isFinite(opts.pollMs) ? Math.max(50, opts.pollMs) : 150;
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const tabs = await self._legacyHandlers.getTabs.call(self, []);
          if (tabs.length === expectedCount) return tabs.length;
          await new Promise((resolve) => setTimeout(resolve, pollMs));
        }
        fail(`Legacy waitForTabCount timed out waiting for ${expectedCount}`, originalError);
      },

      async waitForTabUrl(args, originalError) {
        const tabIndex = Number.isInteger(args[0]) ? args[0] : 0;
        const opts = args[1] || {};
        const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : self.requestTimeoutMs;
        const pollMs = Number.isFinite(opts.pollMs) ? Math.max(50, opts.pollMs) : 150;
        const expectIncludes = typeof opts.expectIncludes === 'string' ? opts.expectIncludes : '';
        const allowBlank = Boolean(opts.allowBlank);
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const tabs = await self._legacyHandlers.getTabs.call(self, []);
          if (Array.isArray(tabs) && tabs.length > 0) {
            const safeIndex = Math.max(0, Math.min(tabs.length - 1, tabIndex));
            const url = tabs[safeIndex]?.url || '';
            if (allowBlank || url) {
              if (!expectIncludes || url.includes(expectIncludes)) {
                return { index: safeIndex, id: tabs[safeIndex]?.id || tabs[safeIndex]?.targetId, url };
              }
            }
          }
          await new Promise((resolve) => setTimeout(resolve, pollMs));
        }
        fail(`Legacy waitForTabUrl timed out for tab ${tabIndex}`, originalError);
      },
    };

    return this.__legacyHandlers;
  }

}

if (!customElements.get('browserbox-webview')) {
  customElements.define('browserbox-webview', BrowserBoxWebview);
}
