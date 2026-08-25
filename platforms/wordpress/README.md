# MediaSFU widgets for WordPress

Embed click-to-call, meeting, AI-agent, and operator experiences in WordPress with a shortcode or Gutenberg block.

## Before you begin

Create a widget in [MediaSFU Widget Builder](https://mediasfu.com/dashboard?mode=regular#widget-builder), allow your WordPress domain, and copy its public widget key. Do not put a MediaSFU API key, backend credential, or long-lived session token in a shortcode, page, theme, plugin setting, URL, or browser log.

## Install

Copy this `wordpress` directory to `/wp-content/plugins/mediasfu-widgets`, then activate **MediaSFU Widgets** from **Plugins**. The plugin loads the versioned MediaSFU bundle from `https://cdn.mediasfu.com/v1/widget.js`.

## Add a widget

Use a shortcode in a page, post, or compatible page builder:

```text
[mediasfu_widget key="YOUR_PUBLIC_WIDGET_KEY" type="call-button" button_text="Talk to sales"]
```

Or add the **MediaSFU Widget** Gutenberg block and configure the same values in the block sidebar.

The plugin accepts exactly six maintained types:

| `type` | Purpose | Useful shortcode attributes |
|---|---|---|
| `call-button` | Browser-to-phone or SIP calling | `destination`, `button_text`, `button_icon`, `position` |
| `meeting-join` | Secure room creation and joining | `room_prefix`, `show_preview`, `require_name`, `require_email` |
| `ai-agent` | Voice or multimodal agent | `agent_id`, `mode`, `width`, `height` |
| `web-agent` | Text, voice, multimodal, and escalation flows | `config_name`, `mode`, `allow_escalation`, `width`, `height` |
| `calls` | Calls and telephony dashboard | `width`, `height` |
| `agent-dashboard` | Agent monitoring and operator takeover | `operator_name`, `width`, `height` |

Examples:

```text
[mediasfu_widget key="YOUR_PUBLIC_WIDGET_KEY" type="meeting-join" room_prefix="team-" show_preview="true"]

[mediasfu_widget key="YOUR_PUBLIC_WIDGET_KEY" type="web-agent" config_name="support" mode="text" allow_escalation="true" height="680px"]

[mediasfu_widget key="YOUR_PUBLIC_WIDGET_KEY" type="agent-dashboard" operator_name="Support team" height="760px"]
```

Privileged destinations, agents, room rules, and operator grants should normally come from the backend configuration attached to the widget key. Sensitive session grants are delivered after load and must never be encoded in a shortcode or iframe URL.

## Verify the site

Use an HTTPS page and confirm that:

- the page loads `https://cdn.mediasfu.com/v1/widget.js` once;
- the widget stays within the content column on desktop and mobile;
- the configured WordPress domain is accepted;
- browser media and autoplay prompts are understandable;
- ending the experience releases media, timers, and call state.

If the widget does not appear, check the domain allowlist, clear page/CDN caches, and inspect the browser console for a concise widget error. For custom room flows, proxy create/join through your backend and follow the [MediaSFU Sandbox](https://mediasfu.com/sandbox) contracts.

## MediaSFU Cloud and MediaSFU Open

The hosted widget flow uses MediaSFU Cloud. MediaSFU Open is the media server you run on your own infrastructure; it is not another hosted endpoint. A self-hosted composition needs your own backend and SDK integration.

## Help

- [Widget overview](https://mediasfu.com/widgets)
- [Widget Studio guide](https://mediasfu.com/widget-studio-guide)
- [Support](mailto:support@mediasfu.com)

## License

MIT
