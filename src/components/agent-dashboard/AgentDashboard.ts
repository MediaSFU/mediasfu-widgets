/**
 * MediaSFU Agent Dashboard Web Component
 * Embeds the Agent Dashboard (operator monitoring + takeover) as a secure iframe
 *
 * Usage:
 *   <mediasfu-agent-dashboard
 *     widget-key="wk_abc123"
 *     theme="dark"
 *     width="100%"
 *     height="800px"
 *     brand-color="#3b82f6"
 *     operator-name="John"
 *   ></mediasfu-agent-dashboard>
 *
 * Events emitted:
 *   widget-ready         – auth succeeded, iframe loaded
 *   widget-error         – auth or load failure
 *   dashboard-ready      – dashboard loaded and connected
 *   operator-takeover    – operator took over a session
 *   session-updated      – session state changed
 *   active-sessions-changed – bounded active-session identities changed
 */

import { authenticate, createWidgetError, getSessionToken } from '../../core/auth';
import { dispatchWidgetEvent } from '../../core/events';
import { getDashboardUrl, getApiUrl } from '../../core/config-store';
import { resolveGlyphIcon } from '../../core/iconGlyph';
import { renderIcon, type IconName } from '../../core/icons';
import { HTMLElementBase } from '../../core/HTMLElementBase';
import type { WidgetError } from '../../types';
import { createEmbedShellStyles } from '../shared/EmbedShell.styles';
import { agentDashboardStyles } from './AgentDashboard.styles';

const dashboardShellStyles = createEmbedShellStyles({
  rootSelector: '.mediasfu-agent-dashboard',
  iframeSelector: '.dashboard-iframe',
  loadingSelector: '.dashboard-loading',
  errorSelector: '.dashboard-error',
  accent: '#3f7dd9',
  minHeight: '520px',
});

type DashboardState = 'loading' | 'ready' | 'error';

function resolveIframeTargetOrigin(iframeSrc: string): string | null {
  try {
    const url = new URL(iframeSrc);
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
export class MediaSFUAgentDashboard extends HTMLElementBase {
  private shadow: ShadowRoot;
  private state: DashboardState = 'loading';
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
      'dashboard-url',
      'operator-name',
      'custom-css-class',
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
    if (!this.isConnected || oldValue === newValue) return;

    if (['width', 'height', 'theme', 'custom-css-class'].includes(name)) {
      this.updatePresentation();
      if (name === 'theme') {
        this.sendCommand('setTheme', { theme: this.resolveTheme() });
      }
      return;
    }

    // Connection-affecting attributes need a deliberate reload. Presentation
    // attributes above must never replace a live dashboard iframe.
    this.iframe?.remove();
    this.iframe = null;
    this.errorMessage = null;
    this.state = 'loading';
    this.render();
    void this.validateConfig();
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

  private get dashboardUrlAttr(): string {
    return this.getAttribute('dashboard-url') || '';
  }

  private get operatorName(): string {
    return this.getAttribute('operator-name') || 'Operator';
  }

  private get operatorGrant(): string {
    return this.operatorGrantValue.trim();
  }

  private get customCssClass(): string {
    return this.getAttribute('custom-css-class') || '';
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
      await this.initializeDashboard();
      return;
    }

    if (!this.widgetKey) {
      this.showError(createWidgetError('INVALID_WIDGET_KEY', 'Widget key is required'));
      return;
    }

    try {
      await authenticate(this.widgetKey, 'web-agent-dashboard');
      await this.initializeDashboard();
    } catch (error) {
      this.showError(error as WidgetError);
    }
  }

  private async initializeDashboard(): Promise<void> {
    this.setState('loading');

    try {
      if (!this.operatorGrant) {
        let token = getSessionToken(this.widgetKey);
        if (!token) {
          const auth = await authenticate(this.widgetKey, 'web-agent-dashboard');
          token = auth.sessionToken;
        }
        this.sessionToken = token;
      } else {
        this.sessionToken = null;
      }

      this.setState('ready');
      this.loadDashboardIframe();

      dispatchWidgetEvent(this, 'widget-ready', { widgetType: 'web-agent-dashboard' });
    } catch (error) {
      this.showError(error as WidgetError);
    }
  }

  // ─── Iframe ──────────────────────────────────────────────────

  private loadDashboardIframe(): void {
    const url = this.buildDashboardUrl();

    this.iframe = this.getLiveIframe();
    if (this.iframe) {
      this.iframe.src = url;
      this.iframe.onload = () => {
        this.sendOperatorGrant();
        this.sendWidgetSessionGrant();
        // The iframe URL may contain a legacy short-lived session token.
        // Runtime readiness is public; the URL is not.
        dispatchWidgetEvent(this, 'dashboard-loaded', { widgetType: 'web-agent-dashboard' });
      };
    }
  }

  private buildDashboardUrl(): string {
    let dashboardBase: string;
    if (this.dashboardUrlAttr) {
      dashboardBase = this.dashboardUrlAttr;
    } else {
      try {
        dashboardBase = getDashboardUrl();
      } catch {
        dashboardBase = 'https://mediasfu.com/web-agents/embed-dashboard';
      }
    }

    const params = new URLSearchParams();

    // Studio grants are delivered with postMessage, never in the iframe URL.
    if (this.operatorGrant) {
      params.append('studioOperator', '1');
    } else if (this.sessionToken) {
      params.append('parentSession', '1');
    }

    // Theme — DashboardEmbed uses dark=1
    const resolvedTheme = this.resolveTheme();
    if (resolvedTheme === 'dark') {
      params.append('dark', '1');
    }

    // Brand color
    if (this.brandColor) {
      params.append('color', this.brandColor);
    }

    // Operator name
    if (this.operatorName && this.operatorName !== 'Operator') {
      params.append('operator', this.operatorName);
    }

    // API base URL override — DashboardEmbed uses "server"
    if (this.baseUrl) {
      params.append('server', this.baseUrl);
    } else {
      try {
        params.append('server', getApiUrl());
      } catch {
        // Use defaults in the iframe
      }
    }

    if (this.customCss) {
      params.append('customCss', this.customCss);
    }

    const parentOrigin = window.location.origin;
    if (parentOrigin && parentOrigin !== 'null' && parentOrigin.length <= 2048) {
      params.append('parentOrigin', parentOrigin);
    }

    return `${dashboardBase}?${params.toString()}`;
  }

  // ─── PostMessage Bridge ──────────────────────────────────────

  private setupMessageListener(): void {
    window.removeEventListener('message', this.boundHandleMessage);
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

      case 'mediasfu:dashboardReady':
        dispatchWidgetEvent(this, 'dashboard-ready', {
          widgetType: 'web-agent-dashboard',
          ...payload,
        });
        break;

      case 'mediasfu:authError':
        this.showError(
          createWidgetError('AUTH_FAILED', payload?.error || 'Authentication failed')
        );
        break;

      case 'mediasfu:operatorTakeover':
        dispatchWidgetEvent(this, 'operator-takeover', payload);
        break;

      case 'mediasfu:sessionUpdate':
        dispatchWidgetEvent(this, 'session-updated', payload);
        break;

      case 'mediasfu:activeSessionsChanged': {
        const sessions = Array.isArray(payload?.sessions)
          ? payload.sessions.map((value: unknown) => {
              if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
              const source = value as Record<string, unknown>;
              const bounded = (key: string, maxLength: number) => {
                const raw = source[key];
                if (typeof raw !== 'string') return undefined;
                const trimmed = raw.trim().slice(0, maxLength);
                return trimmed || undefined;
              };
              const identity = {
                ...(bounded('sessionId', 200) ? { sessionId: bounded('sessionId', 200) } : {}),
                ...(bounded('studioSessionId', 120) ? { studioSessionId: bounded('studioSessionId', 120) } : {}),
                ...(bounded('resourceReferenceId', 160) ? { resourceReferenceId: bounded('resourceReferenceId', 160) } : {}),
                ...(bounded('roomName', 200) ? { roomName: bounded('roomName', 200) } : {}),
              };
              return Object.keys(identity).length ? identity : null;
            }).filter(Boolean)
          : [];
        dispatchWidgetEvent(this, 'active-sessions-changed', { sessions });
        break;
      }

      case 'mediasfu:operatorAction':
        dispatchWidgetEvent(this, 'operator-action', payload);
        break;

      case 'mediasfu:pong':
        // Health check response
        break;

      default:
        break;
    }
  }

  // ─── Auto-Height ─────────────────────────────────────────────

  /**
   * Handle resize messages from the iframe
   */
  private isTrustedIframeMessage(event: MessageEvent): boolean {
    const iframe = this.getLiveIframe();
    if (!iframe || event.source !== iframe.contentWindow) return false;
    const expectedOrigin = resolveIframeTargetOrigin(iframe.src);
    return Boolean(expectedOrigin) && event.origin === expectedOrigin;
  }

  private sendOperatorGrant(): void {
    const iframe = this.getLiveIframe();
    if (!this.operatorGrant || !iframe?.contentWindow) return;
    const targetOrigin = resolveIframeTargetOrigin(iframe.src);
    if (!targetOrigin) {
      this.showError(
        createWidgetError('AUTH_FAILED', 'Unable to establish a secure dashboard origin')
      );
      return;
    }
    iframe.contentWindow.postMessage(
      {
        type: 'mediasfu:studioOperatorGrant',
        payload: { grant: this.operatorGrant },
      },
      targetOrigin
    );
  }

  private sendWidgetSessionGrant(): void {
    const iframe = this.getLiveIframe();
    if (!this.sessionToken || this.operatorGrant || !iframe?.contentWindow) return;
    const targetOrigin = resolveIframeTargetOrigin(iframe.src);
    if (!targetOrigin) return;
    iframe.contentWindow.postMessage(
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
    const iframe = this.getLiveIframe();
    if (iframe && event.source === iframe.contentWindow) {
      const h = Math.max(payload.height, 600);
      const container = this.shadow.querySelector('.mediasfu-agent-dashboard') as HTMLElement;
      if (container) container.style.height = `${h}px`;
      iframe.style.height = `${h}px`;
    }
  }

  // ─── Public API ──────────────────────────────────────────────

  /**
   * Send a command to the dashboard iframe
   */
  public sendCommand(command: string, data?: Record<string, unknown>): void {
    const iframe = this.getLiveIframe();
    if (iframe?.contentWindow) {
      const targetOrigin = iframe.src ? resolveIframeTargetOrigin(iframe.src) : null;
      if (!targetOrigin) return;

      iframe.contentWindow.postMessage(
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

    // A grant rotation is a new property-scoped dashboard session. Tear down
    // the old iframe so its SSE stream and transcript cannot leak across grants.
    this.iframe?.remove();
    this.iframe = null;
    this.errorMessage = '';
    this.state = 'loading';
    this.render();
    void this.validateConfig();
  }

  // ─── Rendering ───────────────────────────────────────────────

  private setState(state: DashboardState): void {
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

  private getLiveIframe(): HTMLIFrameElement | null {
    const iframe = this.shadow.querySelector('.dashboard-iframe') as HTMLIFrameElement | null;
    if (iframe && iframe !== this.iframe) {
      this.iframe = iframe;
    }
    return iframe;
  }

  private updatePresentation(): void {
    const container = this.shadow.querySelector('.mediasfu-agent-dashboard') as HTMLElement | null;
    if (container) {
      container.className = ['mediasfu-agent-dashboard', this.resolveTheme(), this.customCssClass]
        .filter(Boolean)
        .join(' ');
      container.style.width = this.width;
    }

    const iframe = this.getLiveIframe();
    if (iframe) {
      iframe.style.height = this.isAutoHeight ? '800px' : this.height;
    }

    window.removeEventListener('message', this.boundHandleResize);
    if (this.isAutoHeight) {
      window.addEventListener('message', this.boundHandleResize);
    }
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
    const classNames = ['mediasfu-agent-dashboard', resolvedTheme, this.customCssClass].filter(Boolean).join(' ');
    const scopedCustomCss = this.customCss ? `\n${this.customCss}` : '';

    // Listen for resize messages from iframe
    if (this.isAutoHeight) {
      window.removeEventListener('message', this.boundHandleResize);
      window.addEventListener('message', this.boundHandleResize);
    }

    this.shadow.innerHTML = `
      <style>${agentDashboardStyles}${dashboardShellStyles}${scopedCustomCss}</style>
      <div class="${classNames}"
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
      this.initializeDashboard();
    });
  }

  private renderContent(): string {
    switch (this.state) {
      case 'loading':
        return this.renderLoading();
      case 'ready':
        return this.renderDashboard();
      case 'error':
        return this.renderError();
      default:
        return this.renderLoading();
    }
  }

  private renderLoading(): string {
    return `
      <div class="dashboard-loading" role="status" aria-live="polite">
        <div class="loading-visual" aria-hidden="true"><div class="spinner"></div></div>
        <strong class="loading-title">${this.escapeHtml(this.getOverrideText(['status'], 'Preparing the agent dashboard'))}</strong>
        <span class="loading-meta">Loading live sessions, queue health, history, and operator controls.</span>
      </div>
    `;
  }

  private renderDashboard(): string {
    // Use explicit pixel height on iframe. 'auto'/'100%' can't resolve
    // without a fixed-height parent. The resize handler adjusts later.
    const iframeHeight = this.isAutoHeight ? '800px' : this.height;
    return `
      <iframe
        class="dashboard-iframe"
        title="MediaSFU Agent Dashboard"
        style="height: ${iframeHeight};"
        allow="microphone; camera; autoplay; clipboard-write"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        referrerpolicy="no-referrer"
        loading="lazy"
      ></iframe>
    `;
  }

  private renderError(): string {
    return `
      <div class="dashboard-error" role="alert">
        <span class="error-icon" aria-hidden="true">${this.getOverrideGlyph(['status', 'headerIcon'], 'warning')}</span>
        <strong class="error-title">The agent dashboard could not load</strong>
        <p class="error-message">${this.escapeHtml(this.errorMessage || this.getOverrideText(['status'], 'Something went wrong'))}</p>
        <button type="button" class="retry-btn" data-action="retry">${this.escapeHtml(this.getOverrideText(['buttonText', 'button'], 'Try Again'))}</button>
      </div>
    `;
  }
}

// Register the custom element
if (typeof window !== 'undefined' && !customElements.get('mediasfu-agent-dashboard')) {
  customElements.define('mediasfu-agent-dashboard', MediaSFUAgentDashboard);
}
