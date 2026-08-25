# Testing @mediasfu/widgets

This directory contains credential-free contract tests and browser harnesses for the public package. The automated suite verifies exports, server-side import safety, widget authentication transport, meeting-state normalization, themes, and all six maintained package entry points.

## Run the release gate

From the repository root:

```bash
npm ci
npm run release:check
```

The release gate runs the Node test suite, TypeScript validation, lint, the production build, bundle-size budgets, and platform-bundle synchronization. It does not create rooms, place calls, or contact MediaSFU Cloud.

## Verify the packed package

Test the artifact users will actually install:

```bash
npm pack --dry-run
```

Confirm that the archive contains the README, license, declarations, root bundles, and modular entry points, while excluding environment files, logs, private notes, and application build output.

For stronger consumer acceptance, create a temporary project outside this repository, install the generated `.tgz`, and import the exact surface you need:

```javascript
import '@mediasfu/widgets/call-button';
import '@mediasfu/widgets/meeting-join';
import '@mediasfu/widgets/ai-agent';
import '@mediasfu/widgets/web-agent';
import '@mediasfu/widgets/calls';
import '@mediasfu/widgets/agent-dashboard';
```

React applications can additionally verify `@mediasfu/widgets/react`; custom meeting interfaces can verify `@mediasfu/widgets/headless`.

## Browser harnesses

`widget-test-harness.html` is a local development aid. Serve this directory with any static server and use a public, domain-scoped widget key created in [Widget Builder](https://mediasfu.com/dashboard?mode=regular#widget-builder). Never place a MediaSFU API key, backend credential, or long-lived session token in the harness.

Browser checks should confirm:

- the expected custom element is registered;
- authentication failures are understandable and recoverable;
- microphone, camera, and autoplay permission prompts are handled;
- the widget stays within its host container;
- destroy, disconnect, and page-unload paths release media and timers.

## Live acceptance

Automated contract tests do not prove a real media or telephony session. Before a release, exercise each applicable widget through an authorized non-production environment, using domain-scoped widget keys and server-issued short-lived grants. Verify successful start, active media or call state, remote consumption where applicable, user-initiated teardown, and backend cleanup. Store only sanitized evidence; do not capture credentials, private participant data, or raw server logs.

Production deployment and package publication are separate, explicitly authorized release steps.
