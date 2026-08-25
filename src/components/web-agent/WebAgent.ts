/**
 * MediaSFU Web Agent Web Component
 * Embeds the Web Agent chat/voice/multimodal app as a secure iframe
 *
 * Usage:
 *   <mediasfu-web-agent
 *     widget-key="wk_abc123"
 *     mode="text"
 *     theme="dark"
 *     width="420px"
 *     height="680px"
 *     brand-color="#8b5cf6"
 *     config-name="my-config"
 *     escalation="true"
 *   ></mediasfu-web-agent>
 *
 * Events emitted:
 *   widget-ready           – auth succeeded, iframe loaded
 *   widget-error           – auth or load failure
 *   web-agent-ready        – agent session started inside iframe
 *   agent-disconnect       – agent session ended
 *   escalation-requested   – user requested human escalation
 *   message-received       – new message from agent
 */

import { authenticate, createWidgetError, getSessionToken } from '../../core/auth';
import { dispatchWidgetEvent } from '../../core/events';
import { getWebAgentUrl, getApiUrl } from '../../core/config-store';
import { resolveGlyphIcon } from '../../core/iconGlyph';
import { renderIcon, type IconName } from '../../core/icons';
import { HTMLElementBase } from '../../core/HTMLElementBase';
import type { WidgetError } from '../../types';
import { createEmbedShellStyles } from '../shared/EmbedShell.styles';
import { webAgentStyles } from './WebAgent.styles';

const webAgentShellStyles = createEmbedShellStyles({
  rootSelector: '.mediasfu-web-agent',
  iframeSelector: '.web-agent-iframe',
  loadingSelector: '.web-agent-loading',
  errorSelector: '.web-agent-error',
  accent: '#0aa68b',
  minHeight: '360px',
});

type WebAgentState = 'loading' | 'ready' | 'error';

function resolveIframeTargetOrigin(iframeSrc: string): string | null {
  try {
    const url = new URL(iframeSrc, window.location.href);
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
function sanitizeFinalizedTurn(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const source = payload as Record<string, unknown>;
  const role = source.role === 'user' || source.role === 'agent' ? source.role : '';
  const content = typeof source.content === 'string' ? source.content.replace(/\s+/g, ' ').trim().slice(0, 2000) : '';
  const sessionId = typeof source.sessionId === 'string' ? source.sessionId.trim().slice(0, 160) : '';
  const roomName = typeof source.roomName === 'string' ? source.roomName.trim().slice(0, 160) : '';
  const timestamp = typeof source.timestamp === 'number' && Number.isFinite(source.timestamp) ? source.timestamp : Date.now();
  if (!role || !content || !sessionId || !roomName) return null;
  return { role, content, sessionId, roomName, timestamp };
}

export class MediaSFUWebAgent extends HTMLElementBase {
  private shadow: ShadowRoot;
  private state: WebAgentState = 'loading';
  private iframe: HTMLIFrameElement | null = null;
  private sessionToken: string | null = null;
  private errorMessage: string | null = null;
  private boundHandleMessage: (event: MessageEvent) => void;

  static get observedAttributes(): string[] {
    return [
      'widget-key',
      'mode',
      'theme',
      'width',
      'height',
      'brand-color',
      'custom-css',
      'base-url',
      'web-agent-url',
      'config-name',
      'web-agent-config-nick-name',
      'escalation',
      'allow-escalation',
      'agent-name',
      'greeting',
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

  private get mode(): 'text' | 'voice' | 'multimodal' {
    return (this.getAttribute('mode') as 'text' | 'voice' | 'multimodal') || 'text';
  }

  private get theme(): 'light' | 'dark' | 'auto' {
    return (this.getAttribute('theme') as 'light' | 'dark' | 'auto') || 'dark';
  }

  private get width(): string {
    return this.getAttribute('width') || '420px';
  }

  private get height(): string {
    return this.getAttribute('height') || '680px';
  }

  private get brandColor(): string {
    return this.getAttribute('brand-color') || '';
  }

  /* Studio- and preset-authored token overrides, applied inside the iframe by
     the embedded app. It travels as a URL parameter because the visual surface
     lives over there, not in this shadow root. */
  private get customCss(): string {
    return this.getAttribute('custom-css') || '';
  }

  private get baseUrl(): string {
    return this.getAttribute('base-url') || '';
  }

  private get webAgentUrlAttr(): string {
    return this.getAttribute('web-agent-url') || '';
  }

  private get configName(): string {
    return this.getAttribute('config-name')
      || this.getAttribute('web-agent-config-nick-name')
      || '';
  }

  private get escalation(): boolean {
    const val = this.getAttribute('escalation') ?? this.getAttribute('allow-escalation');
    return val !== 'false' && val !== '0';
  }

  private get agentName(): string {
    return this.getAttribute('agent-name') || '';
  }

  private get greeting(): string {
    return this.getAttribute('greeting') || '';
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
    if (!this.widgetKey) {
      this.showError(createWidgetError('INVALID_WIDGET_KEY', 'Widget key is required'));
      return;
    }

    try {
      await authenticate(this.widgetKey, 'web-agent-embed');
      await this.initializeAgent();
    } catch (error) {
      this.showError(error as WidgetError);
    }
  }

  private async initializeAgent(): Promise<void> {
    this.setState('loading');

    try {
      let token = getSessionToken(this.widgetKey);
      if (!token) {
        const auth = await authenticate(this.widgetKey, 'web-agent-embed');
        token = auth.sessionToken;
      }

      this.sessionToken = token;
      this.setState('ready');
      this.loadAgentIframe();

      dispatchWidgetEvent(this, 'widget-ready', { widgetType: 'web-agent-embed', mode: this.mode });
    } catch (error) {
      this.showError(error as WidgetError);
    }
  }

  // ─── Iframe ──────────────────────────────────────────────────

  private loadAgentIframe(): void {
    const url = this.buildAgentUrl();

    this.iframe = this.shadow.querySelector('.web-agent-iframe') as HTMLIFrameElement;
    if (this.iframe) {
      this.iframe.src = url;
      this.iframe.onload = () => {
        this.sendWidgetSessionGrant();
        // Never copy the iframe URL into a public CustomEvent. Legacy embed
        // deployments still consume short-lived authentication fields from
        // that URL, so exposing it here would duplicate them into host-page
        // event listeners and observability hooks.
        dispatchWidgetEvent(this, 'agent-loaded', { mode: this.mode });
      };
    }
  }

  private buildAgentUrl(): string {
    let agentBase: string;
    if (this.webAgentUrlAttr) {
      agentBase = this.webAgentUrlAttr;
    } else {
      try {
        agentBase = getWebAgentUrl();
      } catch {
        agentBase = 'https://mediasfu.com/web-agents/embed';
      }
    }

    const params = new URLSearchParams();

    // Widget key (used by WebAgentEmbed.tsx as "key")
    params.append('key', this.widgetKey);

    // Mode
    params.append('mode', this.mode);
    /* Capped like the Calls widget: a URL long enough to trip a proxy or a
       browser limit would break the embed outright, so an over-long block is
       truncated rather than allowed to take the whole widget down. */
    if (this.customCss) {
      params.append('customCSS', this.customCss.slice(0, 12000));
    }

    // Theme — WebAgentEmbed uses dark=1
    const resolvedTheme = this.resolveTheme();
    if (resolvedTheme === 'dark') {
      params.append('dark', '1');
    }

    // Brand color
    if (this.brandColor) {
      params.append('color', this.brandColor);
    }

    // Config nickname
    if (this.configName) {
      params.append('config', this.configName);
    }

    // Escalation — WebAgentEmbed uses escalation=0 to disable
    if (!this.escalation) {
      params.append('escalation', '0');
    }

    // Agent name
    if (this.agentName) {
      params.append('name', this.agentName);
    }

    // Greeting
    if (this.greeting) {
      params.append('greeting', this.greeting);
    }

    // Session token — passed to iframe for credential resolution
    if (this.sessionToken) {
      params.append('parentSession', '1');
    }

    // API base URL override — WebAgentEmbed uses "server"
    if (this.baseUrl) {
      params.append('server', this.baseUrl);
    } else {
      try {
        params.append('server', getApiUrl());
      } catch {
        // Use defaults in the iframe
      }
    }

    // Referrers may be omitted by policy. Pass the exact embedding origin so
    // the iframe can authenticate parent commands without wildcard messaging.
    const parentOrigin = window.location.origin;
    if (parentOrigin && parentOrigin !== 'null' && parentOrigin.length <= 2048) {
      params.append('parentOrigin', parentOrigin);
    }

    return `${agentBase}?${params.toString()}`;
  }

  // ─── PostMessage Bridge ──────────────────────────────────────

  private setupMessageListener(): void {
    window.addEventListener('message', this.boundHandleMessage);
  }

  private handleMessage(event: MessageEvent): void {
    const iframeWindow = this.iframe?.contentWindow;
    const iframeOrigin = this.iframe?.src
      ? resolveIframeTargetOrigin(this.iframe.src)
      : null;
    if (!iframeWindow || event.source !== iframeWindow || !iframeOrigin || event.origin !== iframeOrigin) {
      return;
    }

    const { type, payload } = event.data || {};
    if (!type || typeof type !== 'string' || !type.startsWith('mediasfu:')) return;

    switch (type) {
      case 'mediasfu:widgetSessionGrantRequest':
        this.sendWidgetSessionGrant();
        break;

      case 'mediasfu:webAgentReady':
        dispatchWidgetEvent(this, 'web-agent-ready', {
          widgetType: 'web-agent-embed',
          mode: this.mode,
          ...payload,
        });
        break;

      case 'mediasfu:authError':
        this.showError(
          createWidgetError('AUTH_FAILED', payload?.error || 'Authentication failed')
        );
        break;

      case 'mediasfu:agentDisconnect':
        dispatchWidgetEvent(this, 'agent-disconnect', payload);
        break;

      case 'mediasfu:escalationRequested':
        dispatchWidgetEvent(this, 'escalation-requested', payload);
        break;

      case 'mediasfu:webAgentSessionStarted':
        dispatchWidgetEvent(this, 'session-started', {
          widgetType: 'web-agent-embed',
          ...payload,
        });
        break;

      case 'mediasfu:messageReceived': {
        const turn = sanitizeFinalizedTurn(payload);
        if (turn) dispatchWidgetEvent(this, 'message-received', turn);
        break;
      }

      case 'mediasfu:sessionEnded':
        dispatchWidgetEvent(this, 'session-ended', payload);
        break;

      case 'mediasfu:pong':
        // Health check response
        break;

      default:
        break;
    }
  }

  // ─── Public API ──────────────────────────────────────────────

  private sendWidgetSessionGrant(): void {
    if (!this.sessionToken || !this.iframe?.contentWindow) return;
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

  /**
   * Send a command to the web agent iframe
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

  /** Start the customer session through the existing widget action path. */
  public startSession(): void {
    this.sendCommand('startSession');
  }

  /**
   * Send a text message to the agent
   */
  public sendMessage(message: string): void {
    this.sendCommand('sendMessage', { message });
  }

  /**
   * Change the theme at runtime
   */
  public setTheme(theme: 'light' | 'dark'): void {
    this.sendCommand('setTheme', { theme });
  }

  /**
   * Request human escalation programmatically
   */
  public requestEscalation(): void {
    this.sendCommand('requestEscalation');
  }

  // ─── Rendering ───────────────────────────────────────────────

  private setState(state: WebAgentState): void {
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
    window.removeEventListener('message', this.boundHandleMessage);
    if (this.iframe) {
      this.iframe.src = 'about:blank';
    }
  }

  private render(): void {
    const resolvedTheme = this.resolveTheme();
    const widthStyle = this.width;
    const heightStyle = this.height;

    this.shadow.innerHTML = `
      <style>${webAgentStyles}${webAgentShellStyles}</style>
      <div class="mediasfu-web-agent ${resolvedTheme}"
           data-state="${this.state}"
           style="width: ${widthStyle}; height: ${heightStyle};">
        ${this.renderContent()}
      </div>
    `;

    this.attachEventListeners();
  }

  private attachEventListeners(): void {
    const retryBtn = this.shadow.querySelector('[data-action="retry"]');
    retryBtn?.addEventListener('click', () => {
      this.errorMessage = null;
      this.initializeAgent();
    });
  }

  private renderContent(): string {
    switch (this.state) {
      case 'loading':
        return this.renderLoading();
      case 'ready':
        return this.renderAgent();
      case 'error':
        return this.renderError();
      default:
        return this.renderLoading();
    }
  }

  private renderLoading(): string {
    return `
      <div class="web-agent-loading" role="status" aria-live="polite">
        <div class="loading-visual" aria-hidden="true"><div class="spinner"></div></div>
        <strong class="loading-title">${this.escapeHtml(this.getOverrideText(['status'], 'Preparing your web agent'))}</strong>
        <span class="loading-meta">Loading the conversation, media, and human-escalation experience.</span>
      </div>
    `;
  }

  private renderAgent(): string {
    return `
      <iframe
        class="web-agent-iframe"
        title="MediaSFU Web Agent"
        allow="microphone; camera; autoplay; clipboard-write"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        referrerpolicy="no-referrer"
        loading="lazy"
      ></iframe>
    `;
  }

  private renderError(): string {
    return `
      <div class="web-agent-error" role="alert">
        <span class="error-icon" aria-hidden="true">${this.getOverrideGlyph(['status', 'headerIcon'], 'warning')}</span>
        <strong class="error-title">The web agent could not load</strong>
        <p class="error-message">${this.escapeHtml(this.errorMessage || this.getOverrideText(['status'], 'Something went wrong'))}</p>
        <button type="button" class="retry-btn" data-action="retry">${this.escapeHtml(this.getOverrideText(['buttonText', 'button'], 'Try Again'))}</button>
      </div>
    `;
  }
}

// Register the custom element
if (typeof window !== 'undefined' && !customElements.get('mediasfu-web-agent')) {
  customElements.define('mediasfu-web-agent', MediaSFUWebAgent);
}
