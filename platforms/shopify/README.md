# MediaSFU widgets for Shopify

Add secure click-to-call, meeting, AI-agent, and operator experiences to a Shopify theme with the MediaSFU custom-element bundle.

## Before you begin

Create a widget in [MediaSFU Widget Builder](https://mediasfu.com/dashboard?mode=regular#widget-builder), add your `*.myshopify.com` or custom storefront domain to its allowlist, and copy its public widget key. A widget key is domain-scoped and safe to place in theme markup. A MediaSFU API key, backend credential, or long-lived session token is not; keep those on a server.

## Install

In **Online Store > Themes > Edit code**, open `layout/theme.liquid` and add this before `</head>`:

```html
<script src="https://cdn.mediasfu.com/v1/widget.js" defer></script>
```

Create a snippet named `mediasfu-widget` and copy `snippets/mediasfu-widget.liquid` from this directory into it.

## Add a widget

Render the snippet from a template or section:

```liquid
{% render 'mediasfu-widget',
  widget_key: 'YOUR_PUBLIC_WIDGET_KEY',
  widget_type: 'call-button',
  button_text: 'Talk to sales',
  position: 'bottom-right'
%}
```

The snippet supports all six maintained widget types:

| `widget_type` | Purpose | Useful options |
|---|---|---|
| `call-button` | Browser-to-phone or SIP calling | `destination`, `button_text`, `button_icon`, `position` |
| `meeting-join` | Secure room creation and joining | `room_prefix`, `show_preview`, `require_name` |
| `ai-agent` | Voice or multimodal agent | `agent_id`, `mode`, `width`, `height` |
| `web-agent` | Text, voice, multimodal, and escalation flows | `config_name`, `mode`, `allow_escalation`, `width`, `height` |
| `calls` | Calls and telephony dashboard | `width`, `height` |
| `agent-dashboard` | Agent monitoring and operator takeover | `operator_name`, `width`, `height` |

### Product-page consultation

```liquid
{% render 'mediasfu-widget',
  widget_key: 'YOUR_PUBLIC_WIDGET_KEY',
  widget_type: 'call-button',
  button_text: 'Start a video consultation',
  position: 'inline'
%}
```

### Shopping assistant

```liquid
{% render 'mediasfu-widget',
  widget_key: 'YOUR_PUBLIC_WIDGET_KEY',
  widget_type: 'web-agent',
  config_name: 'shopping-assistant',
  mode: 'text',
  allow_escalation: true,
  height: '680px'
%}
```

The widget's destination, agent, room policy, and other privileged settings should normally come from the server-side configuration attached to its key. Only use an attribute override when Widget Builder explicitly allows it.

## Verify the storefront

Preview the theme over HTTPS and confirm that:

- the browser loads `https://cdn.mediasfu.com/v1/widget.js` once;
- the widget renders inside its theme container on desktop and mobile;
- the storefront domain is accepted by the widget key;
- microphone, camera, and autoplay prompts are understandable;
- starting and ending the experience releases media and call state.

For API-backed custom flows, proxy room creation and joining through your backend and use the contracts in the [MediaSFU Sandbox](https://mediasfu.com/sandbox). Do not expose API credentials in Liquid, storefront JavaScript, URLs, or logs.

## MediaSFU Cloud and MediaSFU Open

The hosted widget flow uses MediaSFU Cloud. MediaSFU Open is the media server you run on your own infrastructure; it is not another hosted endpoint. A self-hosted composition needs your own backend and SDK integration.

## Help

- [Widget overview](https://mediasfu.com/widgets)
- [Widget Studio guide](https://mediasfu.com/widget-studio-guide)
- [Support](mailto:support@mediasfu.com)
