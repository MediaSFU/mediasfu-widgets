/**
 * MediaSFU Calls Widget Web Component
 * Embeds the full CallsPage as a secure iframe
 *
 * Usage:
 *   <mediasfu-calls
 *     widget-key="wk_abc123"
 *     theme="dark"
 *     width="100%"
 *     height="700px"
 *     brand-color="#3b82f6"
 *   ></mediasfu-calls>
 *
 * Events emitted:
 *   widget-ready      – auth succeeded, iframe loaded
 *   widget-error      – auth or load failure
 *   call-start        – outbound call initiated
 *   call-connected    – call connected
 *   call-ended        – call ended
 *   incoming-call     – incoming call received
 *   navigate-request  – iframe requested a navigation (e.g. /settings)
 */

import { authenticate, createWidgetError, getSessionToken } from '../../core/auth';
import { dispatchWidgetEvent } from '../../core/events';
import { getCallsUrl, getApiUrl } from '../../core/config-store';
import { resolveGlyphIcon } from '../../core/iconGlyph';
import { renderIcon, type IconName } from '../../core/icons';
import { HTMLElementBase } from '../../core/HTMLElementBase';
import type { WidgetError } from '../../types';
import { createEmbedShellStyles } from '../shared/EmbedShell.styles';
import { callsWidgetStyles } from './CallsWidget.styles';

const callsShellStyles = createEmbedShellStyles({
  rootSelector: '.mediasfu-calls',
  iframeSelector: '.calls-iframe',
  loadingSelector: '.calls-loading',
  errorSelector: '.calls-error',
  accent: '#159bd3',
  minHeight: '520px',
});

type CallsWidgetState = 'loading' | 'ready' | 'error';

function resolveIframeTargetOrigin(iframeSrc: string): string | null {
  try {
    const url = new URL(iframeSrc, window.location.href);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (
      url.hostname === 'cdn.mediasfu.com' &&
      (
        url.pathname.startsWith('/widget-agent') ||
        url.pathname.startsWith('/web-agents') ||
        url.pathname.startsWith('/widget-calls') ||
        url.pathname.startsWith('/widget-room')
      )
    ) {
      return 'https://mediasfu.com';
    }
    return url.origin;
  } catch {
    return null;
  }
}
export class MediaSFUCalls extends HTMLElementBase {
  private shadow: ShadowRoot;
  private state: CallsWidgetState = 'loading';
  private iframe: HTMLIFrameElement | null = null;
  private boundHandleResize = this.handleResize.bind(this);
  private sessionToken: string | null = null;
  private operatorGrantValue = '';
  private errorMessage: string | null = null;
  private boundHandleMessage: (event: MessageEvent) => void;

  static get observedAttributes(): string[] {
    return [
      'widget-key',
      'theme',
      'width',
      'height',
      'brand-color',
      'base-url',
      'calls-url',
      'custom-css',
      'enable-content-overrides',
      'content-overrides',
    ];
  }

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.boundHandleMessage = this.handleMessage.bind(this);
  }

  connectedCallback(): void {
    this.render();
    this.validateConfig();
    this.setupMessageListener();
  }

  disconnectedCallback(): void {
    this.cleanup();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue !== newValue) {
      this.render();
    }
  }

  // ─── Attribute Getters ───────────────────────────────────────

  private get widgetKey(): string {
    return this.getAttribute('widget-key') || '';
  }

  private get theme(): 'light' | 'dark' | 'auto' {
    return (this.getAttribute('theme') as 'light' | 'dark' | 'auto') || 'light';
  }

  private get width(): string {
    return this.getAttribute('width') || '100%';
  }

  private get height(): string {
    return this.getAttribute('height') || 'auto';
  }

  private get isAutoHeight(): boolean {
    const h = this.height.toLowerCase();
    return h === 'auto' || h === '100%';
  }

  private get brandColor(): string {
    return this.getAttribute('brand-color') || '';
  }

  private get baseUrl(): string {
    return this.getAttribute('base-url') || '';
  }

  private get callsUrl(): string {
    return this.getAttribute('calls-url') || '';
  }

  private get operatorGrant(): string {
    return this.operatorGrantValue.trim();
  }

  private get customCss(): string {
    return this.getAttribute('custom-css') || '';
  }

  private get enableContentOverrides(): boolean {
    return this.getAttribute('enable-content-overrides') === 'true';
  }

  private get contentOverrides(): Record<string, any> {
    if (!this.enableContentOverrides) return {};
    const raw = this.getAttribute('content-overrides');
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private getOverrideText(elementIds: string[], fallback: string): string {
    if (!this.enableContentOverrides) return fallback;
    for (const id of elementIds) {
      const value = this.contentOverrides?.[id]?.text;
      if (typeof value === 'string' && value.length > 0) return value;
    }
    return fallback;
  }

  /**
   * SVG markup for an icon slot, honouring a customer override when present.
   *
   * Returns trusted markup: insert it WITHOUT escaping. Safe because
   * resolveGlyphIcon only ever emits an icon from the widget's own set - a
   * token it does not recognise falls back rather than being echoed.
   */
  private getOverrideGlyph(elementIds: string[], fallback: IconName): string {
    if (!this.enableContentOverrides) return renderIcon(fallback);
    for (const id of elementIds) {
      const value = this.contentOverrides?.[id]?.icon;
      if (typeof value === 'string' && value.length > 0) {
        return resolveGlyphIcon(value, fallback);
      }
    }
    return renderIcon(fallback);
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ─── Lifecycle ───────────────────────────────────────────────

  private async validateConfig(): Promise<void> {
    if (this.operatorGrant) {
      await this.initializeCalls();
      return;
    }

    if (!this.widgetKey) {
      this.showError(createWidgetError('INVALID_WIDGET_KEY', 'Widget key is required'));
      return;
    }

    try {
      await authenticate(this.widgetKey, 'calls');
      await this.initializeCalls();
    } catch (error) {
      this.showError(error as WidgetError);
    }
  }

  private async initializeCalls(): Promise<void> {
    this.setState('loading');

    try {
      if (!this.operatorGrant) {
        let token = getSessionToken(this.widgetKey);
        if (!token) {
          const auth = await authenticate(this.widgetKey, 'calls');
          token = auth.sessionToken;
        }
        this.sessionToken = token;
      } else {
        this.sessionToken = null;
      }

      this.setState('ready');
      this.loadCallsIframe();

      dispatchWidgetEvent(this, 'widget-ready', { widgetType: 'calls' });
    } catch (error) {
      this.showError(error as WidgetError);
    }
  }

  // ─── Iframe ──────────────────────────────────────────────────

  private loadCallsIframe(): void {
    const url = this.buildCallsUrl();

    this.iframe = this.shadow.querySelector('.calls-iframe') as HTMLIFrameElement;
    if (this.iframe) {
      this.iframe.src = url;
      this.iframe.onload = () => {
        this.sendOperatorGrant();
        this.sendWidgetSessionGrant();
        dispatchWidgetEvent(this, 'calls-loaded', { widgetType: 'calls' });
      };
    }
  }

  private buildCallsUrl(): string {
    // Resolve base URL for the calls iframe app
    let baseUrl: string;
    if (this.callsUrl) {
      baseUrl = this.callsUrl;
    } else {
      try {
        baseUrl = getCallsUrl();
      } catch {
        baseUrl = 'https://widget.mediasfu.com/calls';
      }
    }

    const params = new URLSearchParams();

    // Studio grants are delivered with postMessage, never in the iframe URL.
    if (this.operatorGrant) {
      params.append('studioOperator', '1');
    } else if (this.sessionToken) {
      params.append('parentSession', '1');
    }
    if (!this.operatorGrant && this.widgetKey) {
      params.append('widgetKey', this.widgetKey);
    }

    // Theme
    const resolvedTheme = this.resolveTheme();
    params.append('theme', resolvedTheme);

    // Brand color
    if (this.brandColor) {
      params.append('brandColor', this.brandColor);
    }

    // Studio-authored visual and copy overrides. These are applied inside the iframe.
    if (this.customCss) {
      params.append('customCSS', this.customCss.slice(0, 12000));
    }
    if (this.enableContentOverrides && Object.keys(this.contentOverrides).length > 0) {
      params.append('contentOverrides', JSON.stringify(this.contentOverrides));
    }

    // API base URL override
    if (this.baseUrl) {
      params.append('baseUrl', this.baseUrl);
    } else {
      try {
        params.append('baseUrl', getApiUrl());
      } catch {
        // Use defaults in the iframe
      }
    }

    const parentOrigin = window.location.origin;
    if (parentOrigin && parentOrigin !== 'null' && parentOrigin.length <= 2048) {
      params.append('parentOrigin', parentOrigin);
    }

    return `${baseUrl}?${params.toString()}`;
  }

  // ─── PostMessage Bridge ──────────────────────────────────────

  private setupMessageListener(): void {
    window.addEventListener('message', this.boundHandleMessage);
  }

  private handleMessage(event: MessageEvent): void {
    if (!this.isTrustedIframeMessage(event)) return;

    const { type, payload } = event.data || {};
    if (!type || typeof type !== 'string' || !type.startsWith('mediasfu:')) return;

    switch (type) {
      case 'mediasfu:widgetSessionGrantRequest':
        this.sendWidgetSessionGrant();
        break;

      case 'mediasfu:studioOperatorGrantRequest':
        this.sendOperatorGrant();
        break;

      case 'mediasfu:callsReady':
        dispatchWidgetEvent(this, 'widget-ready', { widgetType: 'calls', ...payload });
        break;

      case 'mediasfu:authError':
        this.showError(
          createWidgetError('AUTH_FAILED', payload?.error || 'Authentication failed')
        );
        break;

      case 'mediasfu:callStart':
        dispatchWidgetEvent(this, 'call-start', payload);
        break;

      case 'mediasfu:callConnected':
        dispatchWidgetEvent(this, 'call-connected', payload);
        break;

      case 'mediasfu:callEnded':
        dispatchWidgetEvent(this, 'call-ended', payload);
        break;

      case 'mediasfu:incomingCall':
        dispatchWidgetEvent(this, 'incoming-call', payload);
        break;

      case 'mediasfu:activeCallsChanged':
        dispatchWidgetEvent(this, 'active-calls-changed', payload);
        break;

      case 'mediasfu:holdChanged':
        dispatchWidgetEvent(this, 'hold-changed', payload);
        break;

      case 'mediasfu:navigateRequest':
        dispatchWidgetEvent(this, 'navigate-request', payload);
        break;

      default:
        break;
    }
  }

  // ─── Public API ──────────────────────────────────────────────

  /**
   * Handle resize messages from the iframe
   */
  private isTrustedIframeMessage(event: MessageEvent): boolean {
    if (!this.iframe || event.source !== this.iframe.contentWindow) return false;
    const expectedOrigin = resolveIframeTargetOrigin(this.iframe.src);
    return Boolean(expectedOrigin && event.origin === expectedOrigin);
  }

  private sendOperatorGrant(): void {
    if (!this.operatorGrant || !this.iframe?.contentWindow) return;
    const targetOrigin = resolveIframeTargetOrigin(this.iframe.src);
    if (!targetOrigin) {
      this.showError(
        createWidgetError('AUTH_FAILED', 'Unable to establish a secure calls origin')
      );
      return;
    }
    this.iframe.contentWindow.postMessage(
      {
        type: 'mediasfu:studioOperatorGrant',
        payload: { grant: this.operatorGrant },
      },
      targetOrigin
    );
  }

  private sendWidgetSessionGrant(): void {
    if (!this.sessionToken || this.operatorGrant || !this.iframe?.contentWindow) return;
    const targetOrigin = resolveIframeTargetOrigin(this.iframe.src);
    if (!targetOrigin) return;
    this.iframe.contentWindow.postMessage(
      {
        type: 'mediasfu:widgetSessionGrant',
        payload: { sessionToken: this.sessionToken },
      },
      targetOrigin
    );
  }

  private handleResize(event: MessageEvent): void {
    const { type, payload } = event.data || {};
    if (type !== 'mediasfu:resize' || !payload?.height) return;

    // Verify message comes from our iframe
    if (this.iframe && event.source === this.iframe.contentWindow) {
      const h = Math.max(payload.height, 400);
      const container = this.shadow.querySelector('.mediasfu-calls') as HTMLElement;
      if (container) container.style.height = `${h}px`;
      if (this.iframe) this.iframe.style.height = `${h}px`;
    }
  }

  /**
   * Send a command to the calls iframe
   */
  public sendCommand(command: string, data?: Record<string, unknown>): void {
    if (this.iframe?.contentWindow) {
      const targetOrigin = this.iframe.src
        ? resolveIframeTargetOrigin(this.iframe.src)
        : null;
      if (!targetOrigin) return;

      this.iframe.contentWindow.postMessage(
        { type: `mediasfu:${command}`, payload: data },
        targetOrigin
      );
    }
  }

  /**
   * Change the theme at runtime
   */
  public setTheme(theme: 'light' | 'dark'): void {
    this.sendCommand('setTheme', { theme });
  }

  public get studioOperatorGrant(): string {
    return this.operatorGrant;
  }

  public set studioOperatorGrant(value: string) {
    const nextValue = typeof value === 'string' ? value.trim() : '';
    if (nextValue === this.operatorGrantValue) return;
    this.operatorGrantValue = nextValue;
    this.sessionToken = null;

    if (!this.isConnected) return;
    if (nextValue && this.iframe) {
      this.sendOperatorGrant();
      return;
    }

    this.iframe?.remove();
    this.iframe = null;
    this.state = 'loading';
    this.render();
    if (nextValue) void this.validateConfig();
  }

  // ─── Rendering ───────────────────────────────────────────────

  private setState(state: CallsWidgetState): void {
    this.state = state;
    this.render();
  }

  private showError(error: WidgetError): void {
    this.errorMessage = error.message;
    this.setState('error');
    dispatchWidgetEvent(this, 'widget-error', error);
  }

  private resolveTheme(): string {
    if (this.theme === 'auto') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return this.theme;
  }

  private cleanup(): void {
    this.operatorGrantValue = '';
    this.sessionToken = null;
    window.removeEventListener('message', this.boundHandleMessage);
    window.removeEventListener('message', this.boundHandleResize);
    if (this.iframe) {
      this.iframe.src = 'about:blank';
    }
    this.iframe = null;
  }

  private render(): void {
    const resolvedTheme = this.resolveTheme();
    const widthStyle = this.width;

    // Listen for resize messages from iframe
    if (this.isAutoHeight) {
      window.removeEventListener('message', this.boundHandleResize);
      window.addEventListener('message', this.boundHandleResize);
    }

    this.shadow.innerHTML = `
      <style>${callsWidgetStyles}${callsShellStyles}</style>
      <div class="mediasfu-calls ${resolvedTheme}"
           data-state="${this.state}"
           style="width: ${widthStyle};">
        ${this.renderContent()}
      </div>
    `;

    this.attachEventListeners();
  }

  private attachEventListeners(): void {
    const retryBtn = this.shadow.querySelector('[data-action="retry"]');
    retryBtn?.addEventListener('click', () => {
      this.errorMessage = null;
      this.initializeCalls();
    });
  }

  private renderContent(): string {
    switch (this.state) {
      case 'loading':
        return this.renderLoading();
      case 'ready':
        return this.renderCalls();
      case 'error':
        return this.renderError();
      default:
        return this.renderLoading();
    }
  }

  private renderLoading(): string {
    return `
      <div class="calls-loading" role="status" aria-live="polite">
        <div class="loading-visual" aria-hidden="true"><div class="spinner"></div></div>
        <strong class="loading-title">${this.escapeHtml(this.getOverrideText(['status'], 'Preparing your call workspace'))}</strong>
        <span class="loading-meta">Connecting the dialer, call activity, contacts, and operator controls.</span>
      </div>
    `;
  }

  private renderCalls(): string {
    // Use explicit pixel height on iframe. 'auto'/'100%' can't resolve
    // without a fixed-height parent. The resize handler adjusts later.
    const iframeHeight = this.isAutoHeight ? '900px' : this.height;
    return `
      <iframe
        class="calls-iframe"
        title="MediaSFU Calls Dashboard"
        style="height: ${iframeHeight};"
        allow="microphone; autoplay; clipboard-write"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        referrerpolicy="no-referrer"
        loading="lazy"
      ></iframe>
    `;
  }

  private renderError(): string {
    return `
      <div class="calls-error" role="alert">
        <span class="error-icon" aria-hidden="true">${this.getOverrideGlyph(['status', 'headerIcon'], 'warning')}</span>
        <strong class="error-title">The call workspace could not load</strong>
        <p class="error-message">${this.escapeHtml(this.errorMessage || this.getOverrideText(['status'], 'Something went wrong'))}</p>
        <button type="button" class="retry-btn" data-action="retry">${this.escapeHtml(this.getOverrideText(['buttonText', 'button'], 'Try Again'))}</button>
      </div>
    `;
  }
}

// Register the custom element
if (typeof window !== 'undefined' && !customElements.get('mediasfu-calls')) {
  customElements.define('mediasfu-calls', MediaSFUCalls);
}
