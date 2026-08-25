/**
 * MediaSFU AI Agent Web Component
 * Embeds the AI Agent app (voice or multimodal) as a secure iframe
 *
 * Usage:
 *   <mediasfu-ai-agent
 *     widget-key="wk_abc123"
 *     mode="voice"
 *     theme="dark"
 *     width="100%"
 *     height="700px"
 *     brand-color="#8b5cf6"
 *   ></mediasfu-ai-agent>
 *
 * Events emitted:
 *   widget-ready       – auth succeeded, iframe loaded
 *   widget-error       – auth or load failure
 *   ai-session-start   – agent session started
 *   ai-session-end     – agent session ended
 *   agent-disconnect   – agent disconnected
 */

import { authenticate, createWidgetError, getSessionToken } from '../../core/auth';
import { dispatchWidgetEvent } from '../../core/events';
import { getAgentUrl, getApiUrl } from '../../core/config-store';
import { resolveGlyphIcon } from '../../core/iconGlyph';
import { renderIcon, type IconName } from '../../core/icons';
import { HTMLElementBase } from '../../core/HTMLElementBase';
import type { WidgetError } from '../../types';
import { createEmbedShellStyles } from '../shared/EmbedShell.styles';
import { aiAgentStyles } from './AIAgent.styles';

const aiAgentShellStyles = createEmbedShellStyles({
  rootSelector: '.mediasfu-ai-agent',
  iframeSelector: '.agent-iframe',
  loadingSelector: '.agent-loading',
  errorSelector: '.agent-error',
  accent: '#7257e8',
  minHeight: '320px',
});

type AIAgentState = 'loading' | 'ready' | 'error';

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
export class MediaSFUAIAgent extends HTMLElementBase {
  private shadow: ShadowRoot;
  private state: AIAgentState = 'loading';
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
      'base-url',
      'agent-url',
      'agent-id',
      'idle-style',
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

  private get mode(): 'voice' | 'multimodal' {
    return (this.getAttribute('mode') as 'voice' | 'multimodal') || 'multimodal';
  }

  private get theme(): 'light' | 'dark' | 'auto' {
    return (this.getAttribute('theme') as 'light' | 'dark' | 'auto') || 'dark';
  }

  private get width(): string {
    return this.getAttribute('width') || '100%';
  }

  private get height(): string {
    return this.getAttribute('height') || '700px';
  }

  private get brandColor(): string {
    return this.getAttribute('brand-color') || '';
  }

  private get baseUrl(): string {
    return this.getAttribute('base-url') || '';
  }

  private get agentUrl(): string {
    return this.getAttribute('agent-url') || '';
  }

  /* Studio- and preset-authored token overrides. Applied inside the iframe by
     the embedded app, which is why it travels as a URL parameter rather than
     being written into this shadow root — the visual surface lives over
     there, not here. */
  private get customCss(): string {
    return this.getAttribute('custom-css') || '';
  }

  private get agentId(): string {
    return this.getAttribute('agent-id') || '';
  }

  private get idleStyle(): 'orb' | 'card' | 'glass' | 'welcome' {
    const value = this.getAttribute('idle-style') || this.getAttribute('idleStyle') || 'orb';
    return ['orb', 'card', 'glass', 'welcome'].includes(value)
      ? (value as 'orb' | 'card' | 'glass' | 'welcome')
      : 'orb';
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
      await authenticate(this.widgetKey, 'ai-agent');
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
        const auth = await authenticate(this.widgetKey, 'ai-agent');
        token = auth.sessionToken;
      }

      this.sessionToken = token;
      this.setState('ready');
      this.loadAgentIframe();

      dispatchWidgetEvent(this, 'widget-ready', { widgetType: 'ai-agent', mode: this.mode });
    } catch (error) {
      this.showError(error as WidgetError);
    }
  }

  // ─── Iframe ──────────────────────────────────────────────────

  private loadAgentIframe(): void {
    const url = this.buildAgentUrl();

    this.iframe = this.shadow.querySelector('.agent-iframe') as HTMLIFrameElement;
    if (this.iframe) {
      this.iframe.src = url;
      this.iframe.onload = () => {
        this.sendWidgetSessionGrant();
        dispatchWidgetEvent(this, 'agent-loaded', { mode: this.mode });
      };
    }
  }

  private buildAgentUrl(): string {
    let agentBase: string;
    if (this.agentUrl) {
      agentBase = this.agentUrl;
    } else {
      try {
        agentBase = getAgentUrl();
      } catch {
        agentBase = 'https://widget.mediasfu.com/agent';
      }
    }

    const params = new URLSearchParams();

    // The session credential is delivered after load with an exact-origin
    // postMessage grant. It must never appear in URLs, browser history, or
    // public widget events.
    if (this.sessionToken) {
      params.append('parentSession', '1');
    }
    params.append('widgetKey', this.widgetKey);

    // Mode
    params.append('mode', this.mode);

    // Theme
    const resolvedTheme = this.resolveTheme();
    params.append('theme', resolvedTheme);
    /* Capped like the Calls widget: a URL long enough to trip a proxy or a
       browser limit would break the embed outright, so an over-long block is
       truncated rather than allowed to take the whole widget down. */
    if (this.customCss) {
      params.append('customCSS', this.customCss.slice(0, 12000));
    }

    // Brand color
    if (this.brandColor) {
      params.append('brandColor', this.brandColor);
    }

    // Agent ID
    if (this.agentId) {
      params.append('agentId', this.agentId);
    }

    // Agent name (customer-facing title)
    const agentName = this.getAttribute('agent-name') || '';
    if (agentName) {
      params.append('agentName', agentName);
    }

    // Show branding
    const showBranding = this.getAttribute('show-branding');
    if (showBranding === 'false') {
      params.append('showBranding', 'false');
    }

    // Idle presentation
    params.append('idleStyle', this.idleStyle);

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

      case 'mediasfu:agentReady':
        dispatchWidgetEvent(this, 'ai-session-start', {
          widgetType: 'ai-agent',
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
   * Send a command to the agent iframe
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

  // ─── Rendering ───────────────────────────────────────────────

  private setState(state: AIAgentState): void {
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
    this.sessionToken = null;
    window.removeEventListener('message', this.boundHandleMessage);
    if (this.iframe) {
      this.iframe.src = 'about:blank';
    }
    this.iframe = null;
  }

  private render(): void {
    const resolvedTheme = this.resolveTheme();
    const widthStyle = this.width;
    const heightStyle = this.height;

    this.shadow.innerHTML = `
      <style>${aiAgentStyles}${aiAgentShellStyles}</style>
      <div class="mediasfu-ai-agent ${resolvedTheme}"
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
      <div class="agent-loading" role="status" aria-live="polite">
        <div class="loading-visual" aria-hidden="true"><div class="spinner"></div></div>
        <strong class="loading-title">${this.escapeHtml(this.getOverrideText(['status'], 'Preparing your AI agent'))}</strong>
        <span class="loading-meta">Securing the session and loading voice, chat, and multimodal controls.</span>
      </div>
    `;
  }

  private renderAgent(): string {
    return `
      <iframe
        class="agent-iframe"
        title="MediaSFU AI Agent"
        allow="microphone; camera; autoplay; clipboard-write"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        referrerpolicy="no-referrer"
        loading="lazy"
      ></iframe>
    `;
  }

  private renderError(): string {
    return `
      <div class="agent-error" role="alert">
        <span class="error-icon" aria-hidden="true">${this.getOverrideGlyph(['status', 'headerIcon'], 'warning')}</span>
        <strong class="error-title">The AI agent could not start</strong>
        <p class="error-message">${this.escapeHtml(this.errorMessage || this.getOverrideText(['status'], 'Something went wrong'))}</p>
        <button type="button" class="retry-btn" data-action="retry">${this.escapeHtml(this.getOverrideText(['buttonText', 'button'], 'Try Again'))}</button>
      </div>
    `;
  }
}

// Register the custom element
if (typeof window !== 'undefined' && !customElements.get('mediasfu-ai-agent')) {
  customElements.define('mediasfu-ai-agent', MediaSFUAIAgent);
}
