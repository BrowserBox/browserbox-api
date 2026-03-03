# BrowserBox Webview Element API

`browserbox-api` is the public BrowserBox embedder surface. It ships the
`<browserbox-webview>` custom element used to render and control a remote
BrowserBox session in any web UI.

Package target: `@browserbox/webview-element`.

## Quick Start

```html
<script type="module" src="./src/browserbox-webview.js"></script>

<browserbox-webview
  login-link="https://bbx.example.com/login?token=..."
  width="100%"
  height="600">
</browserbox-webview>

<script>
  const bbx = document.querySelector('browserbox-webview');
  await bbx.whenReady();
  await bbx.navigateTo('https://example.com');
</script>
```

## Attributes

| Attribute | Required | Default | Notes |
| --- | --- | --- | --- |
| `login-link` | yes | none | Full BrowserBox login URL with token. |
| `width` | no | `100%` | Bare numbers are interpreted as px. |
| `height` | no | `100%` | Bare numbers are interpreted as px. |
| `parent-origin` | no | `*` | Restricts accepted `postMessage` origin. |
| `request-timeout-ms` | no | `30000` | Per-call timeout floor is 100ms. |

## Properties

| Property | Kind | Maps to | Notes |
| --- | --- | --- | --- |
| `loginLink` | read/write | `login-link` | Sets or clears embed login URL. |
| `routingMid` | read-only | derived | Resolved routing machine id (`mid`). |
| `width` | read/write | `width` | Preserves string values. |
| `height` | read/write | `height` | Preserves string values. |
| `parentOrigin` | read/write | `parent-origin` | `*` when unset. |
| `requestTimeoutMs` | read/write | `request-timeout-ms` | Parsed as integer. |

## Events

### Lifecycle and transport events

| Event | Detail | Notes |
| --- | --- | --- |
| `ready` | `{ type }` | Legacy handshake completed. |
| `api-ready` | `{ methods: string[] }` | Modern API handshake completed. |
| `ready-timeout` | `{ timeoutMs, error }` | Soft ready timeout emitted before API calls proceed. |
| `disconnected` | `{}` | Source changed or element disconnected. |
| `iframe-retry` | `{ attempt, maxAttempts, delayMs }` | Automatic iframe reload retry in progress. |
| `mid-synced` | `{ mid, attempts }` | Routing-mid synchronization succeeded. |
| `mid-sync-timeout` | `{ attempts, mid }` | Routing-mid synchronization timed out. |
| `usability-changed` | `{ usable, reason }` | Usability state transition for host UX handling. |

### Runtime-forwarded events

The component forwards BrowserBox runtime event names as-is via `CustomEvent`:

| Event | Typical Detail |
| --- | --- |
| `tab-created` | `{ index, id, url }` |
| `tab-closed` | `{ index, id }` |
| `tab-updated` | `{ id, url, title, faviconDataURI }` |
| `active-tab-changed` | `{ index, id }` |
| `did-start-loading` | `{ tabId, url }` |
| `did-stop-loading` | `{ tabId, url }` |
| `did-navigate` | `{ tabId, url }` |
| `policy-denied` | `{ url, reason }` |
| `favicon-changed` | runtime-defined |

## Methods

### Lifecycle and generic dispatch

| Method |
| --- |
| `whenReady({ timeoutMs }?)` |
| `listApiMethods(options?)` |
| `callApi(method, ...args)` |
| `refresh()` |
| `updateIframe()` |
| `stopReconnectAttempts(reason?)` |
| `health({ timeoutMs }?)` |

### Tabs and navigation

| Method |
| --- |
| `getTabs()` |
| `getTabCount()` |
| `getActiveTabIndex()` |
| `createTab(url?)` |
| `createTabs(count, opts?)` |
| `closeTab(index?)` |
| `closeTabById(targetId)` |
| `closeAllTabs(opts?)` |
| `switchToTab(index)` |
| `switchToTabById(targetId)` |
| `navigateTo(url, opts?)` |
| `navigateTab(index, url, opts?)` |
| `submitOmnibox(query, opts?)` |
| `reload()` |
| `goBack()` |
| `goForward()` |
| `stop()` |

### Wait, diagnostics, and automation

| Method |
| --- |
| `waitForTabCount(expectedCount, opts?)` |
| `waitForTabUrl(index, opts?)` |
| `getFavicons()` |
| `waitForNonDefaultFavicon(index, opts?)` |
| `getScreenMetrics()` |
| `getTransportDiagnostics()` |
| `waitForSelector(selector, opts?)` |
| `click(selector, opts?)` |
| `type(selector, text, opts?)` |
| `evaluate(expression, opts?)` |
| `waitForNavigation(opts?)` |

## Transport Behavior

Transport auto-detect is one-shot per source load:

1. Probe modern RPC (`bbx-api-call` and `bbx-api-list`)
2. Fall back to legacy postMessage method types
3. Lock transport mode until source changes or refresh

## Reference

- Live docs: https://win9-5.com/api/

## License

GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`).
See `LICENSE`.
