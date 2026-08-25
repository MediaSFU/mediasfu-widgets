# MediaSFU Widgets: Distribution and Integration

MediaSFU Widgets provide focused call, meeting, and AI-agent experiences that can be embedded without adopting a complete application shell. This guide covers public package consumption and production-ready hosting. MediaSFU's private release infrastructure is intentionally outside the scope of this repository.

## Choose an integration

The package exposes six standalone custom elements:

| Experience | npm subpath | Custom element |
| --- | --- | --- |
| Call button | `@mediasfu/widgets/call-button` | `<mediasfu-call-button>` |
| Meeting join | `@mediasfu/widgets/meeting-join` | `<mediasfu-meeting-join>` |
| AI agent | `@mediasfu/widgets/ai-agent` | `<mediasfu-ai-agent>` |
| Web agent | `@mediasfu/widgets/web-agent` | `<mediasfu-web-agent>` |
| Calls dashboard | `@mediasfu/widgets/calls` | `<mediasfu-calls>` |
| Agent dashboard | `@mediasfu/widgets/agent-dashboard` | `<mediasfu-agent-dashboard>` |

Use the package root for the self-contained browser bundle. Use a subpath when your bundler should include only one experience. React applications can import `@mediasfu/widgets/react`; applications building a fully custom interface can import `@mediasfu/widgets/headless`.

See the [README](README.md) for complete examples, attributes, events, React adapters, and headless APIs.

## Install from npm

```bash
npm install @mediasfu/widgets
```

Import only the element you need:

```js
import '@mediasfu/widgets/meeting-join';
```

```html
<mediasfu-meeting-join
  widget-key="wk_public_example"
  room-code="weekly-sync"
></mediasfu-meeting-join>
```

A widget key is a public, domain-scoped identifier created in MediaSFU Widget Builder. It is not a MediaSFU API key. Never place API keys, provider secrets, or private credentials in browser code, HTML attributes, URLs, or published configuration.

## Load the browser bundle

```html
<script src="https://cdn.mediasfu.com/v1/widget.js" defer></script>
```

The root bundle registers all maintained custom elements and includes its required UI runtime. Pin an explicit version when repeatable releases matter, and test upgrades before changing that version.

## Build and verify a source checkout

Use a supported Node.js LTS release and install from the lockfile:

```bash
npm ci
npm run build
npm test
npx tsc --noEmit
npm run lint
npm run check:bundle-size
npm pack --dry-run
```

The build produces:

- `dist/widget.js`: self-contained UMD browser bundle.
- `dist/widget.esm.js`: self-contained ESM browser bundle.
- `dist/widget.mjs`: npm ESM entry.
- `dist/subpaths/*.mjs` and `dist/subpaths/*.cjs`: modular npm entries.
- `dist/index.d.ts` and related declarations: TypeScript contracts.

The bundle-size gate reports raw, gzip, and Brotli sizes and fails when an entry exceeds its checked-in budget.

## Host a private copy

If you host the generated files yourself:

- Serve them over HTTPS with JavaScript and CSS content types.
- Enable gzip or Brotli compression.
- Use immutable caching only for content-hashed or versioned filenames. Give mutable aliases short cache lifetimes so fixes can propagate.
- Return JavaScript files directly; do not rewrite missing asset requests to an HTML application shell.
- Configure Cross-Origin Resource Sharing only for the origins that must load the assets.
- Keep Content Security Policy directives as narrow as the selected widget and your MediaSFU deployment allow.
- Preserve exact-origin checks for dashboard messaging. Do not use wildcard origins for commands or grants.

After hosting, test the actual public URL in a clean browser session. Confirm loading, authentication, room join, bidirectional audio/video where applicable, event delivery, error states, and teardown.

## Keep server authority on the server

Room creation, room joining, and any operation that requires a MediaSFU API key must pass through your backend. The browser sends only the fields your application permits; the backend validates them, adds the secret credential, and forwards the request to MediaSFU. For retried create or join requests, preserve a stable `Idempotency-Key` so a network retry cannot create duplicate work.

Configure allowed origins and grants for each widget key. Dashboard commands should be accepted only from the exact trusted HTTPS origin and with the minimum grant required for that command.

## MediaSFU Cloud and MediaSFU Open

MediaSFU Cloud is the managed service available through [mediasfu.com](https://mediasfu.com). MediaSFU Open is the self-hosted media server you run and operate in your own environment. In either model, browser-facing widget configuration must remain public-safe; server credentials belong in backend secret storage.

Useful resources:

- [MediaSFU Widgets](https://mediasfu.com/widgets)
- [Widget Builder](https://mediasfu.com/dashboard?mode=regular#widget-builder)
- [Developer Sandbox](https://mediasfu.com/sandbox)
- [MediaSFU documentation](https://mediasfu.com/developers)

Before distributing an application, verify the packaged artifact from a clean directory, scan the final assets for credentials, and exercise the integration against the environment you intend to use. Publishing the npm package or deploying CDN assets is a separate release action and is not performed by the local build commands above.
