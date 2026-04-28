# Hyper-Frame

**`<hyper-frame>` — an iframe that can frame any website.**

Install via npm:

```bash
npm i --save @browserbox/hyper-frame
```

```html
<script type="module" src="https://hyper-frame.art/hyper-frame.js"></script>
<hyper-frame
  id="bbx"
  login-link="https://example.com:9999/login?token=your_login_link"
  embedder-origin="https://app.example.com"
  ui-visible="false"
  allow-user-toggle-ui="false"
  width="100%"
  height="600">
</hyper-frame>
```

Before starting a self-hosted BrowserBox instance set the allowed embedder origins:

```bash
export ALLOWED_EMBEDDING_ORIGINS="https://your-site.example.com https://other-embedder.example.com"
bbx stop
bbx setup -p 8888
bbx start
cat ~/.config/dosaygo/bbpro/login.link
```

## Quick Start

```js
const bbx = document.querySelector('hyper-frame');
await bbx.whenReady();

await bbx.page.navigate('https://example.com');
const tabs = await bbx.tabs.list();
const firstTab = tabs[0];
if (firstTab?.id) {
  await bbx.tabs.activate(firstTab.id);
}

await bbx.click('a.my-link');
await bbx.waitForSelector('.result');
const title = await bbx.evaluate('document.title');

const screenshot = await bbx.capture.frame({ format: 'jpeg', quality: 80 });

await bbx.frameCapture(true);
const frame = await bbx.getFrame();

await bbx.cleanSlate('https://example.com');
```

## Element Attributes

| Attribute | Required | Default | Description |
|-----------|----------|---------|-------------|
| `login-link` | yes | — | Full BrowserBox login URL with auth token |
| `width` | no | `"100%"` | CSS width (px if bare number) |
| `height` | no | `"100%"` | CSS height (px if bare number) |
| `embedder-origin` | no | `"*"` | Restrict postMessage origin |
| `request-timeout-ms` | no | `30000` | API call timeout (ms) |
| `ui-visible` | no | `true` | Show/hide BrowserBox chrome UI |
| `allow-user-toggle-ui` | no | `true` | Allow user to toggle UI visibility |
| `interaction-mode` | no | `"full"` | Policy preset: `full`, `limited`, `view-only` |
| `policy` | no | — | Additional local policy restrictions |
| `chrome` | no | `"default"` | Chrome presentation hint: `none`, `minimal`, `default`, `custom` |
| `augment-root` | no | `"open"` | Augment inspectability hint: `open` or `closed` |
| `capture` | no | `"snapshot"` | Capture policy hint: `off`, `snapshot`, `sampled` |
| `media-permissions` | no | `"default"` | Set to `"none"` to deny mic/camera/display-capture |
| `session-unload-warning` | no | `"default"` | Set to `"none"` to suppress beforeunload warning |
| `beforeunload-behavior` | no | `"default"` | `"leave"` to auto-depart, `"remain"` to auto-stay |
| `first-load-cleanse` | no | — | Close all tabs on first session load; if the value is a URL, open that URL after cleansing |

`first-load-cleanse` runs once for each `login-link`. Use a non-empty URL to close existing tabs and open that replacement tab. Use an empty value, such as `first-load-cleanse=""`, to close existing tabs without opening a replacement. The `firstLoadCleanse(url?)` method follows the same rule: a non-empty string opens that URL, and an empty string performs the delete-only cleanse.

## Namespaced API

Access via the element (`bbx.tabs.list()`) or via `bbx.session` facade.

### `session`

| Property / Method | Returns | Description |
|-------------------|---------|-------------|
| `session.id` | `string \| null` | Routing machine ID |
| `session.usable` | `boolean` | Whether session is usable |
| `session.ready` | `boolean` | Whether API handshake completed |
| `session.transport` | `string` | Transport mode |
| `session.health()` | `Promise<HealthReport>` | Probe browser and transport |
| `session.capabilities()` | `Promise<object>` | Query supported capabilities |
| `session.disconnect()` | `void` | Tear down the session |
| `session.refresh()` | `void` | Reload the embedded iframe |

### `tabs`

| Method | Returns | Description |
|--------|---------|-------------|
| `tabs.list()` | `Promise<Tab[]>` | List all open tabs |
| `tabs.getActive()` | `Promise<Tab>` | Get the active tab |
| `tabs.create({ url, active? })` | `Promise<Tab>` | Open a new tab |
| `tabs.activate(tabId)` | `Promise` | Switch to a tab by ID |
| `tabs.close(tabId)` | `Promise` | Close a tab by ID |
| `tabs.closeAll()` | `Promise` | Close all tabs |

### `page`

| Method | Returns | Description |
|--------|---------|-------------|
| `page.navigate(url, opts?)` | `Promise<NavResult>` | Navigate the active tab |
| `page.url()` | `Promise<string>` | Active tab URL |
| `page.title()` | `Promise<string>` | Active tab title |
| `page.reload()` | `Promise` | Reload the active tab |
| `page.back()` | `Promise<boolean>` | Navigate back |
| `page.forward()` | `Promise<boolean>` | Navigate forward |
| `page.stop()` | `Promise` | Stop loading |
| `page.text(opts?)` | `Promise<string>` | Extract page text |
| `page.metrics()` | `Promise<PageMetrics>` | Viewport/document dimensions |

### `capture`

| Method | Returns | Description |
|--------|---------|-------------|
| `capture.frame(opts?)` | `Promise<string>` | Full-page screenshot |
| `capture.viewport(opts?)` | `Promise<string>` | Viewport screenshot |
| `capture.enable(enabled?)` | `Promise<boolean>` | Enable/disable frame capture |
| `capture.next()` | `Promise<FramePacket \| null>` | Consume latest frame |

## Events

| Event | Detail | Description |
|-------|--------|-------------|
| `ready` | `{ type }` | Legacy handshake completed |
| `api-ready` | `{ methods, policy? }` | Modern API available |
| `ready-timeout` | `{ timeoutMs, error }` | Handshake timed out |
| `tab-created` | `{ index, id, url }` | New tab opened |
| `tab-closed` | `{ index, id }` | Tab closed |
| `tab-updated` | `{ id, url, title, faviconDataURI }` | Tab metadata updated |
| `active-tab-changed` | `{ index, id }` | Active tab switched |
| `did-navigate` | `{ tabId, url }` | Navigation committed |
| `policy-denied` | `{ url, reason }` | Navigation blocked |
| `usability-changed` | `{ usable: boolean }` | Usability state changed |
| `sos` | `{ reasonCode, message, retryUrl }` | Fatal unusable signal |
| `disconnected` | — | Session ended |

## Errors

API failures use stable `BrowserBoxError` codes: `ERR_NOT_READY`, `ERR_POLICY_DENIED`, `ERR_TIMEOUT`, `ERR_TRANSPORT`, `ERR_UNSUPPORTED`, `ERR_INVALID_ARGUMENT`, `ERR_NOT_FOUND`, `ERR_CONFLICT`, `ERR_INTERNAL`.

## License

AGPL-3.0-or-later
