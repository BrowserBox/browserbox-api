# Webview API

Ensure you set

```bash
export ALLOWED_EMBEDDING_ORIGINS="https://site-that-serves-the-page-using-the-webview.example.com https://other-site.you-will-embed.browserbox-on.com"
bbx stop
bbx setup -p 8888
bbx start
cat ~/.config/dosaygo/bbpro/login.link
```

before starting the self-hosted BrowserBox instance that will be embedded.

## Embedding

```html
<script src="browserbox-webview.js"></script>
<browserbox-webview
  id="bbx"
  login-link="https://example.com:9999/login?token=your_login_link"
  embedder-origin="https://app.example.com"
  ui-visible="false"
  allow-user-toggle-ui="false"
  width="100%"
  height="600">
</browserbox-webview>
```

## Quick Start

```js
const bbx = document.querySelector('browserbox-webview');
await bbx.whenReady();

// Navigate and inspect tabs
await bbx.page.navigate('https://example.com');
const tabs = await bbx.tabs.list();
const firstTab = tabs[0];
if (firstTab?.id) {
  await bbx.tabs.activate(firstTab.id);
}

// Automate
await bbx.click('a.my-link');
await bbx.waitForSelector('.result');
const title = await bbx.evaluate('document.title');

// Capture
const screenshot = await bbx.capture.frame({ format: 'jpeg', quality: 80 });

// Source-frame access
await bbx.frameCapture(true);
const frame = await bbx.getFrame();

// Reset the session and navigate fresh
await bbx.cleanSlate('https://example.com');
```

Use tab IDs from `tabs.list()` or the `switchToTabById(targetId)` / `closeTabById(targetId)` wrappers. Do not key tab state by positional index in an embedder.

## Element Attributes

| Attribute | Required | Default | Description |
|-----------|----------|---------|-------------|
| `login-link` | yes | — | Full BrowserBox login URL with auth token |
| `width` | no | `"100%"` | CSS width (px if bare number) |
| `height` | no | `"100%"` | CSS height (px if bare number) |
| `embedder-origin` | no | `"*"` | Restrict postMessage origin |
| `parent-origin` | no | `"*"` | Deprecated alias for `embedder-origin` |
| `request-timeout-ms` | no | `30000` | API call timeout (ms) |
| `ui-visible` | no | `true` | Show/hide BrowserBox chrome UI |
| `allow-user-toggle-ui` | no | `true` | Allow user to toggle UI visibility |
| `interaction-mode` | no | `"full"` | Policy preset: `full`, `limited`, `view-only` |
| `policy` | no | — | Additional local policy restrictions; cannot widen server policy |
| `chrome` | no | `"default"` | Chrome presentation hint: `none`, `minimal`, `default`, `custom` |
| `augment-root` | no | `"open"` | Augment inspectability hint: `open` or `closed` |
| `capture` | no | `"snapshot"` | Capture policy hint: `off`, `snapshot`, `sampled` |

For custom host chrome, prefer `ui-visible="false"` and `allow-user-toggle-ui="false"`. The legacy `ui=false` login-link parameter still works for backward compatibility, but the element attributes are the canonical controls.

## Namespaced Session-Host API

The `<browserbox-webview>` element exposes a namespaced API for programmatic control.

Access via the element directly (`bbx.tabs.list()`) or via `bbx.session` facade.

### `session`

| Property / Method | Returns | Description |
|-------------------|---------|-------------|
| `session.id` | `string \| null` | Routing machine ID |
| `session.usable` | `boolean` | Whether the session is currently usable |
| `session.ready` | `boolean` | Whether the API handshake has completed |
| `session.transport` | `string` | Transport mode: `"modern"`, `"legacy"`, or `"unknown"` |
| `session.health()` | `Promise<HealthReport>` | Probe the embedded browser and transport |
| `session.capabilities()` | `Promise<object>` | Query supported capabilities |
| `session.disconnect()` | `void` | Tear down the session |
| `session.refresh()` | `void` | Reload the embedded iframe |

### `tabs`

| Method | Returns | Description |
|--------|---------|-------------|
| `tabs.list()` | `Promise<Tab[]>` | List all open tabs |
| `tabs.getActive()` | `Promise<Tab>` | Get the active tab's info |
| `tabs.create({ url, active? })` | `Promise<Tab>` | Open a new tab |
| `tabs.activate(tabId)` | `Promise` | Switch to a tab by ID |
| `tabs.close(tabId)` | `Promise` | Close a tab by ID |
| `tabs.closeAll()` | `Promise` | Close all tabs |

**Tab object:** `{ id, index, active, url, title, canGoBack, canGoForward, loading, hasFavicon, isDefaultFavicon, faviconDataURI }`

### `page`

| Method | Returns | Description |
|--------|---------|-------------|
| `page.navigate(url, opts?)` | `Promise<NavResult>` | Navigate the active tab |
| `page.url()` | `Promise<string>` | Get the active tab's URL |
| `page.title()` | `Promise<string>` | Get the active tab's title |
| `page.favicon()` | `Promise<string \| null>` | Get the favicon as a data URI |
| `page.metrics()` | `Promise<PageMetrics>` | Get normalized viewport/document dimensions |
| `page.text(opts?)` | `Promise<string>` | Extract page text (`{ mainContentOnly?: boolean }`) |
| `page.reload()` | `Promise` | Reload the active tab |
| `page.back()` | `Promise<boolean>` | Navigate back |
| `page.forward()` | `Promise<boolean>` | Navigate forward |
| `page.stop()` | `Promise` | Stop loading |

### `capture`

| Method | Returns | Description |
|--------|---------|-------------|
| `capture.frame(opts?)` | `Promise<string>` | Full-page screenshot as data URI |
| `capture.viewport(opts?)` | `Promise<string>` | Viewport-only screenshot as data URI |
| `capture.enable(enabled?)` | `Promise<boolean>` | Enable/disable single-slot source-frame capture |
| `capture.next()` | `Promise<FramePacket \| null>` | Consume the latest captured source frame |

Options: `{ format?: "jpeg" | "png", quality?: number }`

FramePacket:

```js
{
  seq,
  capturedAt,
  frameId,
  castSessionId,
  sessionId,
  targetId,
  width,
  height,
  mime,
  bytes: ArrayBuffer
}
```

### `policy`

| Method | Returns | Description |
|--------|---------|-------------|
| `policy.get()` | `Promise<object>` | Get current policy snapshot |

`policy.get()` returns the merged effective policy snapshot. Server policy is authoritative and embedder attributes can only further restrict it.

### `augment` (capability-gated)

| Method | Returns | Description |
|--------|---------|-------------|
| `augment(spec)` | `Promise<AugmentHandle>` | Create an augmentation overlay |
| `augment.update(id, patch)` | `Promise` | Update an existing augmentation |
| `augment.remove(id)` | `Promise` | Remove an augmentation |
| `augment.list()` | `Promise<Augment[]>` | List all active augmentations |

Preferred content shapes:

- `{ type: "text", text }`
- `{ type: "html", html }`
- `{ type: "json", data }`

Raw strings are still accepted as HTML shorthand.

### `select` (capability-gated)

| Method | Returns | Description |
|--------|---------|-------------|
| `select({ prompt, intent })` | `Promise<SelectionHandle>` | Begin interactive selection |

SelectionHandle: `{ getRaw(), generalize(), preview(), extract(opts?) }`

- `getRaw()` -> `{ selector, selectors, text, href, htmlSnippet }`
- `preview()` -> `{ selector, matches, sample? }`
- `extract({ fields, limit })` -> `{ selector, items, count }`

## Automation Methods

Direct methods on the element for browser automation:

| Method | Returns | Description |
|--------|---------|-------------|
| `click(selector, opts?)` | `Promise<{ result }>` | Click an element by CSS selector |
| `type(selector, text, opts?)` | `Promise<{ result }>` | Type text into an element |
| `evaluate(expression, opts?)` | `Promise<{ result }>` | Evaluate JavaScript in the page |
| `waitForSelector(selector, opts?)` | `Promise<boolean>` | Wait for a selector to appear |
| `waitForNavigation(opts?)` | `Promise` | Wait for a navigation to complete |
| `frameCapture(enabled?)` | `Promise<boolean>` | Enable/disable single-slot source-frame capture |
| `getFrame()` | `Promise<FramePacket \| null>` | Consume the latest captured source frame |
| `cleanSlate(url)` | `Promise<{ ok, url, targetId, sessionId, warmed, ackBlastCount }>` | Reset browser state, open a fresh tab, navigate, and warm screencast |

### `act(action)` — Unified action dispatch

| Action | Example | Description |
|--------|---------|-------------|
| `navigate` | `act({ navigate: "https://..." })` | Navigate the active tab |
| `click` | `act({ click: { selector: "a" } })` | Click an element |
| `type` | `act({ type: { selector: "input", text: "hello" } })` | Type into an element |
| `evaluate` | `act({ evaluate: "document.title" })` | Evaluate JS expression |
| `waitForSelector` | `act({ waitForSelector: { selector: "h1" } })` | Wait for element |
| `waitForNavigation` | `act({ waitForNavigation: {} })` | Wait for nav |

Returns `{ ok, action, value }`.

## UI Controls

| Method | Returns | Description |
|--------|---------|-------------|
| `uiVisible(visible?)` | `Promise<boolean>` | Show/hide BrowserBox chrome UI |
| `allowUserToggleUI(allow?)` | `Promise<boolean>` | Allow/deny user UI toggling |

## Event Helpers

| Method | Description |
|--------|-------------|
| `on(name, handler)` | Subscribe; returns unsubscribe function |
| `off(name, handler)` | Unsubscribe |
| `observe(config)` | Structured event observer; returns `{ id, config, on, off, unsubscribe }` |
| `events(config)` | Async iterator over events |

`events(config)` yields `{ id, type, timestamp, sessionId, tabId?, detail }`.

## Events

| Event | Detail | Description |
|-------|--------|-------------|
| `ready` | `{ type }` | Legacy transport handshake completed |
| `api-ready` | `{ methods: string[], policy?: PolicySnapshot }` | Modern API available and may include the current server policy snapshot |
| `ready-timeout` | `{ timeoutMs, error }` | Ready handshake timed out |
| `tab-created` | `{ index, id, url }` | New tab opened |
| `tab-closed` | `{ index, id }` | Tab closed |
| `tab-updated` | `{ id, url, title, faviconDataURI }` | Tab metadata updated |
| `active-tab-changed` | `{ index, id }` | Active tab switched |
| `did-start-loading` | `{ tabId, url }` | Page load started |
| `did-stop-loading` | `{ tabId, url }` | Page load finished |
| `did-navigate` | `{ tabId, url }` | Navigation committed |
| `favicon-changed` | `{ tabId, faviconDataURI }` | Favicon updated |
| `policy-denied` | `{ url, reason }` | Navigation blocked by policy |
| `policy.changed` | `{ reason, policy, capabilities }` | Effective policy/capability set changed |
| `usability-changed` | `{ usable: boolean }` | Browser usability state changed |
| `sos` | `{ reasonCode, message, retryUrl }` | Fatal unusable signal |
| `disconnected` | — | Session ended |

### Canonical event aliases

Legacy event names continue to work. Dot-notation aliases are also emitted:

| Legacy | Canonical |
|--------|-----------|
| `api-ready` | `api.ready` |
| `tab-created` | `tab.created` |
| `tab-closed` | `tab.closed` |
| `tab-updated` | `tab.updated` |
| `active-tab-changed` | `tab.activated` |
| `did-navigate` | `page.navigated` |
| `did-start-loading` | `page.load.started` |
| `did-stop-loading` | `page.load.stopped` |
| `policy-denied` | `policy.denied` |
| `policy.changed` | `policy.changed` |
| `usability-changed` | `session.usability.changed` |
| `disconnected` | `session.disconnected` |

## Policy Sync

Server policy is pushed to the embedder over the existing BrowserBox runtime/meta and iframe postMessage channels:

1. The server emits `policySnapshot` meta when effective policy changes.
2. The embedded BrowserBox client caches the latest snapshot.
3. The iframe bridge includes policy in the initial `bbx-api-ready` handshake.
4. Mid-session changes are forwarded as `bbx-policy-sync`.
5. `<browserbox-webview>` merges server policy with local attribute policy and emits `policy.changed` if capabilities change.

The embedder never widens server policy.

## Errors

Public API failures use stable `BrowserBoxError` codes:

- `ERR_NOT_READY`
- `ERR_POLICY_DENIED`
- `ERR_TIMEOUT`
- `ERR_TRANSPORT`
- `ERR_UNSUPPORTED`
- `ERR_INVALID_ARGUMENT`
- `ERR_NOT_FOUND`
- `ERR_CONFLICT`
- `ERR_INTERNAL`

Errors may also include `status` and `retriable`.

## Flat Methods (backward compatible)

All classic flat methods remain available:

`whenReady()`, `callApi()`, `navigateTo()`, `navigateTab()`, `submitOmnibox()`,
`getTabs()`, `getFavicons()`, `getTabCount()`, `getActiveTabIndex()`,
`createTab()`, `createTabs()`, `closeTab()`, `closeTabById()`, `closeAllTabs()`,
`switchToTab()`, `switchToTabById()`,
`reload()`, `goBack()`, `goForward()`, `stop()`,
`getScreenMetrics()`, `getTransportDiagnostics()`,
`frameCapture()`, `getFrame()`, `cleanSlate()`,
`health()`, `refresh()`, `updateIframe()`, `stopReconnectAttempts()`,
`requestFrameRefresh()`, `reactivateActiveTab()`,
`listApiMethods()`,
`waitForNonDefaultFavicon()`, `waitForTabCount()`, `waitForTabUrl()`

## Visibility Reactivation

When a page hosting `<browserbox-webview>` is hidden (e.g. minimized, tab-switched) and later restored, the viewport may appear blank until a fresh frame is rendered.

Two methods handle this:

| Method | Returns | Description |
|--------|---------|-------------|
| `requestFrameRefresh(reason?)` | `void` | Request an immediate frame from the server; no layout checks |
| `reactivateActiveTab(reason?)` | `Promise<boolean>` | Re-activate the current tab via `switchToTabById`, forcing a fresh frame without any `clientWidth` guard |

The component already listens for `visibilitychange`, `pageshow`, and `focus` events internally and calls `requestFrameRefresh`. For embedders that wrap the webview inside custom window managers (minimize/restore), call `reactivateActiveTab()` explicitly on restore.

## Test Status

**55/55 tests passing** (2026-03-09) — full coverage across session, tabs, page,
navigation, automation (click, waitForSelector, evaluate, act), capture,
diagnostics, policy, augment, events, and observer APIs.
