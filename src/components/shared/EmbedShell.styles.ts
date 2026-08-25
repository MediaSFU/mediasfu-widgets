type EmbedShellStyleOptions = {
  rootSelector: string;
  iframeSelector: string;
  loadingSelector: string;
  errorSelector: string;
  accent: string;
  minHeight: string;
};

export function createEmbedShellStyles({
  rootSelector,
  iframeSelector,
  loadingSelector,
  errorSelector,
  accent,
  minHeight
}: EmbedShellStyleOptions): string {
  return `
    :host {
      display: block;
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      line-height: 1.5;
    }

    *, *::before, *::after {
      box-sizing: border-box;
    }

    ${rootSelector} {
      --msfu-accent: ${accent};
      --msfu-surface: #ffffff;
      --msfu-surface-raised: #f7fafc;
      --msfu-text: #102033;
      --msfu-muted: #607086;
      --msfu-border: rgba(51, 88, 122, 0.18);
      --msfu-danger: #c73548;
      position: relative;
      isolation: isolate;
      width: 100%;
      min-height: ${minHeight};
      overflow: hidden;
      border: 1px solid var(--msfu-border);
      border-radius: 10px;
      background: var(--msfu-surface);
      color: var(--msfu-text);
      box-shadow: 0 18px 42px rgba(24, 49, 77, 0.12);
    }

    ${rootSelector}.dark {
      --msfu-surface: #071525;
      --msfu-surface-raised: #0d2035;
      --msfu-text: #edf7ff;
      --msfu-muted: #9fb2c7;
      --msfu-border: rgba(126, 167, 204, 0.24);
      --msfu-danger: #ff8391;
      box-shadow: 0 22px 52px rgba(0, 8, 18, 0.42);
    }

    ${iframeSelector} {
      display: block;
      width: 100%;
      height: 100%;
      border: 0;
      border-radius: inherit;
      background: var(--msfu-surface);
    }

    ${loadingSelector},
    ${errorSelector} {
      position: absolute;
      inset: 0;
      z-index: 2;
      display: flex;
      min-height: ${minHeight};
      padding: clamp(24px, 6vw, 52px);
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      text-align: center;
      background:
        linear-gradient(145deg, color-mix(in srgb, var(--msfu-accent) 8%, transparent), transparent 42%),
        var(--msfu-surface);
      color: var(--msfu-text);
    }

    .loading-visual,
    .error-icon {
      display: grid;
      width: 54px;
      height: 54px;
      place-items: center;
      border: 1px solid color-mix(in srgb, var(--msfu-accent) 36%, var(--msfu-border));
      border-radius: 50%;
      background: color-mix(in srgb, var(--msfu-accent) 11%, var(--msfu-surface-raised));
      color: var(--msfu-accent);
      box-shadow: 0 12px 28px color-mix(in srgb, var(--msfu-accent) 18%, transparent);
    }

    .spinner {
      width: 24px;
      height: 24px;
      border: 2px solid color-mix(in srgb, var(--msfu-accent) 22%, transparent);
      border-top-color: var(--msfu-accent);
      border-radius: 50%;
      animation: msfu-embed-spin 0.75s linear infinite;
    }

    .loading-title,
    .error-title {
      font-size: 16px;
      font-weight: 750;
    }

    .loading-meta,
    .error-message {
      max-width: 360px;
      color: var(--msfu-muted);
      font-size: 13px;
      line-height: 1.55;
    }

    ${errorSelector} .error-icon {
      border-color: color-mix(in srgb, var(--msfu-danger) 38%, var(--msfu-border));
      background: color-mix(in srgb, var(--msfu-danger) 10%, var(--msfu-surface-raised));
      color: var(--msfu-danger);
      font-size: 22px;
      font-weight: 800;
    }

    .retry-btn {
      min-height: 42px;
      margin-top: 6px;
      padding: 0 20px;
      border: 1px solid color-mix(in srgb, var(--msfu-accent) 54%, var(--msfu-border));
      border-radius: 8px;
      background: var(--msfu-accent);
      color: #ffffff;
      font: inherit;
      font-weight: 750;
      cursor: pointer;
      box-shadow: 0 10px 24px color-mix(in srgb, var(--msfu-accent) 24%, transparent);
      transition: transform 160ms ease, box-shadow 160ms ease, filter 160ms ease;
    }

    .retry-btn:hover {
      filter: brightness(1.06);
      transform: translateY(-1px);
      box-shadow: 0 14px 30px color-mix(in srgb, var(--msfu-accent) 30%, transparent);
    }

    .retry-btn:focus-visible {
      outline: 3px solid color-mix(in srgb, var(--msfu-accent) 30%, transparent);
      outline-offset: 3px;
    }

    @keyframes msfu-embed-spin {
      to { transform: rotate(360deg); }
    }

    @media (max-width: 560px) {
      ${rootSelector},
      ${iframeSelector} {
        border-radius: 8px;
      }

      ${loadingSelector},
      ${errorSelector} {
        padding: 22px 18px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .spinner {
        animation-duration: 1.5s;
      }

      .retry-btn {
        transition: none;
      }
    }
  `;
}
