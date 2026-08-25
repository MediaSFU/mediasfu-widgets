import { useEffect } from "react";

/**
 * Applies the `customCSS` URL parameter an embedding widget forwards.
 *
 * WHY THIS EXISTS
 * The appearance presets carry two halves: config the component reads, and a
 * block of `--msfu-*` / `--adb-*` custom properties that only exist as CSS.
 * Widgets that render into their own shadow root can append that block
 * directly, but every agent surface here is an IFRAME embed — the shadow root
 * belongs to the host page and the visual surface lives in this document. So
 * the parent widget forwards the block as a URL parameter and the embedded app
 * applies it, which is what this hook does.
 *
 * Without it the presets applied only their config half: themes flipped, and
 * accents silently did not.
 *
 * BOTH SPELLINGS ARE ACCEPTED
 * The existing widgets are inconsistent — the Calls widget sends `customCSS`
 * and the Agent Dashboard sends `customCss`. Rather than break one of them to
 * tidy the other, this reads either. New senders use `customCSS`.
 *
 * SAFETY
 * The value is stylesheet text authored in our own Studio, not user input from
 * the page, and it is injected as the textContent of a <style> element — so it
 * is parsed as CSS and never as markup or script. The length ceiling matches
 * the cap the sending widgets apply, so a truncated block cannot silently grow
 * here into something that stalls the parser.
 */

const STYLE_ID = "mediasfu-embed-custom-css";
const MAX_LENGTH = 12000;

export function readEmbedCustomCss(search: string = window.location.search): string {
  try {
    const params = new URLSearchParams(search);
    const raw = params.get("customCSS") || params.get("customCss") || "";
    return raw.slice(0, MAX_LENGTH);
  } catch {
    return "";
  }
}

export default function useEmbedCustomCss(css?: string): void {
  const resolved = typeof css === "string" ? css.slice(0, MAX_LENGTH) : readEmbedCustomCss();

  useEffect(() => {
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;

    if (!resolved) {
      style?.remove();
      return undefined;
    }

    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      /* Appended to head last so it wins over the app's own stylesheets at
         equal specificity — the whole point is to override tokens. */
      document.head.appendChild(style);
    }
    style.textContent = resolved;

    return () => {
      style?.remove();
    };
  }, [resolved]);
}
