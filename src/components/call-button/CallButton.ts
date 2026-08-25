/**
 * MediaSFU Call Button Web Component
 * Click-to-call widget for VoIP/PSTN calls
 */

import { authenticate, createWidgetError, getSessionToken, getSessionConfig } from '../../core/auth';
import { renderIcon } from '../../core/icons';
import { dispatchWidgetEvent } from '../../core/events';
import { isKnownButtonIconToken, resolveButtonIconToken } from '../../core/iconToken';
import { getApiUrl } from '../../core/config-store';
import { HTMLElementBase } from '../../core/HTMLElementBase';
import type { CallButtonConfig, CallEvent, WidgetError } from '../../types';
import { callButtonStyles } from './CallButton.styles';

type CallButtonState = 'idle' | 'authenticating' | 'ringing' | 'connected' | 'ended' | 'error';
type RuntimeButtonIcon = 'phone' | 'video' | 'headset' | 'none';

function resolveRoomTargetOrigin(roomUrl: string): string | null {
  try {
    const url = new URL(roomUrl, window.location.href);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.hostname === 'cdn.mediasfu.com' && url.pathname.startsWith('/widget-room')) {
      return 'https://mediasfu.com';
    }
    return url.origin;
  } catch {
    return null;
  }
}

export class MediaSFUCallButton extends HTMLElementBase {
  private shadow: ShadowRoot;
  private state: CallButtonState = 'idle';
  private callStartTime: Date | null = null;
  private callDuration: number = 0;
  private durationInterval: number | null = null;
  private currentCallId: string | null = null;
  private errorMessage: string | null = null;
  private roomName: string | null = null;
  private roomCheckInterval: number | null = null;
  private callConfirmationTimeout: number | null = null;
  private callSetupComplete: boolean = false;
  // Iframe reference for headless mode
  private roomIframe: HTMLIFrameElement | null = null;
  // Popup window reference (per-instance, not global)
  private roomWindow: Window | null = null;
  // Mute state tracking
  private isMuted: boolean = false;
  // Room origin for secure postMessage
  private roomOrigin: string = '';
  // Resolved config from backend auth (destination/sipConfigId resolved from widget key)
  private _resolvedDestination: string = '';
  private _resolvedSipConfigId: string = '';
  private _resolvedStudioSessionId: string = '';
  private _resolvedResourceReferenceId: string = '';

  // Observed attributes that trigger re-render
  static get observedAttributes(): string[] {
    return [
      // Basic
      'widget-key',
      'studio-session-id',
      'resource-reference-id',
      'destination',
      'sip-config-id',
      'caller-id',
      'button-text',
      'button-icon',
      'theme',
      'position',
      'show-status',
      'require-email',
      'require-name',
      'collect-caller-name',
      'collect-caller-number',
      // Branding
      'primary-color',
      'text-color',
      'border-radius',
      'button-size',
      'shadow-style',
      // Behavior
      'animation-style',
      'show-after-delay',
      'hide-on-scroll',
      'play-ringtone',
      'headless-mode', // Open popup minimized/off-screen for headless operation
      'enable-content-overrides',
      'content-overrides',
      // Call Handling
      'max-wait-time',
      'no-answer-message',
      'auto-record',
      // Integrations
      'webhook-url',
      'google-analytics-id',
      'custom-css-class',
      'custom-css',
    ];
  }

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.render();
    this.validateConfig();
  }

  disconnectedCallback(): void {
    this.cleanup();
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string): void {
    if (oldValue !== newValue) {
      this.render();
    }
  }

  // ============================================================================
  // Configuration Getters
  // ============================================================================

  private get widgetKey(): string {
    return this.getAttribute('widget-key') || '';
  }

  private get studioSessionId(): string {
    return (this.getAttribute('studio-session-id') || this._resolvedStudioSessionId).trim().slice(0, 120);
  }

  private get resourceReferenceId(): string {
    return (this.getAttribute('resource-reference-id') || this._resolvedResourceReferenceId).trim().slice(0, 160);
  }

  private get destination(): string {
    return this.getAttribute('destination') || '';
  }

  private get sipConfigId(): string {
    return this.getAttribute('sip-config-id') || '';
  }

  private get callerId(): string {
    return this.getAttribute('caller-id') || 'Web Caller';
  }

  private get buttonText(): string {
    return this.getOverrideText(['buttonText', 'button'], this.getAttribute('button-text') || 'Call');
  }

  private get buttonIcon(): RuntimeButtonIcon {
    const fallback = (this.getAttribute('button-icon') as RuntimeButtonIcon) || 'phone';
    const normalizedFallback = resolveButtonIconToken(fallback, 'phone');
    return this.getOverrideIcon(['button', 'buttonText'], normalizedFallback);
  }

  private get theme(): 'light' | 'dark' | 'auto' {
    return (this.getAttribute('theme') as 'light' | 'dark' | 'auto') || 'light';
  }

  private get position(): CallButtonConfig['position'] {
    return (this.getAttribute('position') as CallButtonConfig['position']) || 'inline';
  }

  private get showStatus(): boolean {
    return this.getAttribute('show-status') !== 'false';
  }

  private get requireEmail(): boolean {
    return this.getAttribute('require-email') === 'true';
  }

  private get requireName(): boolean {
    return this.getAttribute('require-name') === 'true' || this.getAttribute('collect-caller-name') === 'true';
  }

  private get collectCallerNumber(): boolean {
    return this.getAttribute('collect-caller-number') === 'true';
  }

  // Branding getters
  private get primaryColor(): string {
    return this.getAttribute('primary-color') || '#10B981';
  }

  private get textColor(): string {
    return this.getAttribute('text-color') || '#FFFFFF';
  }

  private get borderRadius(): 'rounded' | 'pill' | 'square' | 'circle' {
    return (this.getAttribute('border-radius') as any) || 'rounded';
  }

  private get buttonSize(): 'small' | 'medium' | 'large' {
    return (this.getAttribute('button-size') as any) || 'medium';
  }

  private get shadowStyle(): 'none' | 'subtle' | 'medium' | 'strong' {
    return (this.getAttribute('shadow-style') as any) || 'medium';
  }

  // Behavior getters
  private get animationStyle(): 'none' | 'pulse' | 'bounce' | 'shake' {
    return (this.getAttribute('animation-style') as any) || 'none';
  }

  private get showAfterDelay(): number {
    return parseInt(this.getAttribute('show-after-delay') || '0', 10);
  }

  private get hideOnScroll(): boolean {
    return this.getAttribute('hide-on-scroll') === 'true';
  }

  private get playRingtone(): boolean {
    return this.getAttribute('play-ringtone') !== 'false';
  }

  private get headlessMode(): boolean {
    // Default to headless (hidden iframe) — popup is only used if explicitly set to false
    // This gives end users a seamless call experience without a meeting room popup
    return this.getAttribute('headless-mode') !== 'false';
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

  private getOverrideIcon(elementIds: string[], fallback: RuntimeButtonIcon): RuntimeButtonIcon {
    if (!this.enableContentOverrides) return fallback;
    for (const id of elementIds) {
      const value = this.contentOverrides?.[id]?.icon;
      if (typeof value !== 'string' || value.trim().length === 0) continue;
      if (!isKnownButtonIconToken(value)) continue;
      return resolveButtonIconToken(value, fallback);
    }
    return fallback;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Call handling getters
  private get maxWaitTime(): number {
    return parseInt(this.getAttribute('max-wait-time') || '60', 10);
  }

  private get noAnswerMessage(): string {
    return this.getAttribute('no-answer-message') || 'Sorry, no one is available right now. Please try again later.';
  }

  private get autoRecord(): boolean {
    return this.getAttribute('auto-record') === 'true';
  }

  // Integration getters
  private get webhookUrl(): string {
    return this.getAttribute('webhook-url') || '';
  }

  private get googleAnalyticsId(): string {
    return this.getAttribute('google-analytics-id') || '';
  }

  private get customCssClass(): string {
    return this.getAttribute('custom-css-class') || '';
  }

  private get customCss(): string {
    return this.getAttribute('custom-css') || '';
  }

  // ============================================================================
  // Validation
  // ============================================================================

  private validateConfig(): void {
    if (!this.widgetKey) {
      this.showError(createWidgetError('INVALID_WIDGET_KEY', 'Widget key is required'));
      return;
    }

    // Destination/sipConfigId may come from HTML attributes OR be resolved by the
    // backend from the widget key's saved config. Authenticate first — the auth
    // response carries the resolved destination so we don't require it up-front.
    this.authenticateWidget();
  }

  private async authenticateWidget(): Promise<void> {
    try {
      await authenticate(this.widgetKey, 'click-to-call');
      this._resolvedStudioSessionId = '';
      this._resolvedResourceReferenceId = '';

      // Apply resolved config from backend (destination, sipConfigId, etc.)
      const serverCfg = getSessionConfig(this.widgetKey);
      if (serverCfg) {
        try {
          const parsed = typeof serverCfg === 'string' ? JSON.parse(serverCfg) : serverCfg;
          const studioContext = parsed?.studioContext && typeof parsed.studioContext === 'object'
            ? parsed.studioContext
            : parsed?.config?.studioContext && typeof parsed.config.studioContext === 'object'
              ? parsed.config.studioContext
              : {};
          this._resolvedStudioSessionId = String(studioContext.studioSessionId || '').trim().slice(0, 120);
          this._resolvedResourceReferenceId = String(studioContext.resourceReferenceId || '').trim().slice(0, 160);
          if (parsed.destination && !this.destination) {
            this._resolvedDestination = parsed.destination;
          }
          if (parsed.sipConfigId && !this.sipConfigId) {
            this._resolvedSipConfigId = parsed.sipConfigId;
          }
        } catch { /* config parse error — non-fatal */ }
      }

      // After auth, verify we have a destination one way or another
      if (!this.destination && !this.sipConfigId && !this._resolvedDestination && !this._resolvedSipConfigId) {
        this.showError(createWidgetError('UNKNOWN_ERROR', 'Destination or SIP config is required'));
        return;
      }

      dispatchWidgetEvent(this, 'widget-ready', { widgetType: 'click-to-call' });
    } catch (error) {
      this.showError(error as WidgetError);
    }
  }

  // ============================================================================
  // Call Handling
  // ============================================================================

  private async startCall(): Promise<void> {
    if (this.state !== 'idle') return;

    // Check if we need user info first
    if (this.requireEmail || this.requireName || this.collectCallerNumber) {
      this.showInfoForm();
      return;
    }

    await this.initiateCall();
  }

  private async initiateCall(userInfo?: { name?: string; email?: string; number?: string }): Promise<void> {
    this.setState('authenticating');

    try {
      // Ensure we have a valid session
      let sessionToken = getSessionToken(this.widgetKey);
      if (!sessionToken) {
        const auth = await authenticate(this.widgetKey, 'click-to-call');
        sessionToken = auth.sessionToken;
      }

      this.setState('ringing');
      const callerName = userInfo?.name || this.callerId || 'Web Visitor';
      dispatchWidgetEvent(this, 'call-ringing', { callerName });

      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/v1/widget/incomingCall`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Widget-Key': this.widgetKey,
          'X-Widget-Origin': window.location.origin,
        },
        body: JSON.stringify({
          widgetKey: this.widgetKey,
          widgetOrigin: window.location.origin,
          callerName,
          callerNumber: userInfo?.number || '',
          callerEmail: userInfo?.email || '',
          autoRecord: this.autoRecord,
          ...(this.studioSessionId ? { studioSessionId: this.studioSessionId } : {}),
          ...(this.resourceReferenceId ? { resourceReferenceId: this.resourceReferenceId } : {}),
        }),
      });
      const result = await response.json() as {
        success?: boolean;
        roomUrl?: string;
        sipCallId?: string;
        callId?: string;
        error?: string;
      };
      if (!response.ok || !result.success || !result.roomUrl) {
        throw new Error(result.error || 'Unable to create the call room');
      }
      const callId = result.sipCallId || result.callId;
      if (!callId) throw new Error('Call allocation did not return a call ID');
      this.currentCallId = callId;

      // Allocation reserves a room; it is not a connected call.

      // Open the room in a popup window or iframe
      this.openRoomWindow(result.roomUrl);

      // The timer starts only after roomConnected/widgetCallStarted confirms setup.
      // Media diagnostics remain observational and cannot mark the call connected.
      this.startRoomMonitor();
      this.callConfirmationTimeout = window.setTimeout(() => {
        if (this.state === 'ringing') this.failCall('Connection timeout. Failed to start the call. Please try again.');
      }, Math.max(10000, this.maxWaitTime * 1000));

    } catch (error) {
      this.setState('error');
      const widgetError = error as WidgetError;
      dispatchWidgetEvent(this, 'widget-error', widgetError);
      dispatchWidgetEvent(this, 'call-failed', widgetError);
      this.showError(widgetError);
    }
  }

  private openRoomWindow(roomUrl: string): void {
    this.roomOrigin = resolveRoomTargetOrigin(roomUrl) || '';
    if (this.headlessMode) {
      // Iframe mode: embed a stable light-DOM iframe owned by this element
      // This avoids popup blockers and runs truly in the background
      this.openRoomIframe(roomUrl);
    } else {
      // Popup mode: open centered popup window
      this.openRoomPopup(roomUrl);
    }
  }

  private openRoomIframe(roomUrl: string): void {
    // Remove any existing iframe
    if (this.roomIframe) {
      this.roomIframe.remove();
      this.roomIframe = null;
    }

    // Create hidden iframe
    const iframe = document.createElement('iframe');
    iframe.src = roomUrl;
    iframe.referrerPolicy = 'origin';
    iframe.id = 'mediasfu-call-iframe';
    // Allow all necessary permissions for media playback in iframes
    // autoplay: allows audio/video to autoplay without user interaction
    // microphone: allows access to user's microphone
    // camera: allows access to user's camera (for video calls)
    // display-capture: allows screen sharing
    // speaker-selection: allows speaker output selection (if supported)
    iframe.setAttribute('allow', 'autoplay *; microphone *; camera *; display-capture *; speaker-selection *');
    // Also set allowfullscreen for potential video expansion
    iframe.setAttribute('allowfullscreen', 'true');
    iframe.style.cssText = `
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
      border: none;
      overflow: hidden;
    `;

    // Mount outside the custom element so a collapsed host cannot collapse the
    // cross-origin unlock surface. The instance still owns and removes this iframe.
    const iframeParent = document.body || document.documentElement;
    iframeParent.appendChild(iframe);
    this.roomIframe = iframe;

    // Listen for messages from iframe
    window.addEventListener('message', this.handleIframeMessage);
  }

  private handleIframeMessage = (event: MessageEvent): void => {
    const expectedSource = this.roomIframe?.contentWindow || this.roomWindow;
    if (!expectedSource || event.source !== expectedSource) return;
    if (!this.roomOrigin || event.origin !== this.roomOrigin) return;

    // Handle messages from the widget-room iframe
    console.log('[CallButton] Received message:', event.data);

    if (event.data?.type?.startsWith('mediasfu:')) {
      const eventType = event.data.type.replace('mediasfu:', '');
      const payload = event.data.payload || {};

      console.log('[CallButton] Parsed event:', eventType, payload);

      switch (eventType) {
        case 'call-ended':
        case 'disconnected':
        case 'roomEnded':        // Room ended (remote end / server alert)
        case 'roomDisconnected': // Room disconnected after cleanup
        case 'widgetCallEnded':  // Widget SIP call ended by server/operator
        case 'callCompleted':    // User clicked "Close" on the ended screen
          console.log('[CallButton] Call ended event:', eventType, payload);
          this.endCall();
          break;
        case 'error':
          this.failCall(payload?.error || payload?.message || 'The call room reported an error');
          break;
        case 'widgetCallError':
          this.failCall(payload?.error || payload?.message || 'Unable to start the call');
          break;
        case 'ready':
          // Iframe is ready and connected
          console.log('[CallButton] Iframe ready');
          break;
        case 'roomConnected': {
          const roomName = typeof payload?.roomName === 'string' ? payload.roomName.trim() : '';
          if (payload?.success !== true || !roomName) {
            this.failCall(payload?.error || payload?.message || 'The call room could not be connected');
            break;
          }
          // A valid roomConnected event is authoritative for the customer call.
          // widgetCallStarted remains a later orchestration confirmation; any
          // explicit failure from it still transitions the call to error.
          this.roomName = roomName;
          this.markCallConnected(payload);
          // Expose the compact audio-unlock surface immediately. The follow-up
          // event is useful, but must not be the only path making the iframe
          // clickable.
          this.showIframeForAudioUnlock();
          dispatchWidgetEvent(this, 'audio-unlock-required', {
            roomName,
            reason: 'browser-audio-policy',
          });
          break;
        }
        case 'widgetCallStarted':
          if (payload?.success !== true) {
            this.failCall(payload?.error || payload?.message || 'Unable to start the call');
            break;
          }
          this.markCallConnected(payload, true);
          break;
        case 'mediaDiagnostics':
          dispatchWidgetEvent(this, 'media-diagnostics', payload);
          break;
        case 'audioUnlockRequired':
          // Browser autoplay policy may require a trusted click inside the room.
          // The compact room surface is the only UI exposed for that fallback.
          this.showIframeForAudioUnlock();
          dispatchWidgetEvent(this, 'audio-unlock-required', payload);
          break;
        case 'remoteAudioReady': {
          dispatchWidgetEvent(this, 'remote-audio-ready', payload);
          break;
        }
        case 'microphoneError':
          dispatchWidgetEvent(this, 'microphone-error', payload);
          this.failCall(payload?.error || payload?.message || 'Microphone setup failed');
          break;
        case 'audioUnlocked':
          // Audio unlocked - hide iframe again and set mic as active (green)
          console.log('[CallButton] Audio unlocked - hiding iframe');
          this.hideIframe();
          this.setMicActive();
          dispatchWidgetEvent(this, 'audio-unlocked', {
            success: true,
            roomName: this.roomName || undefined,
          });
          break;
      }
    }
  };

  private showIframeForAudioUnlock(): void {
    if (this.roomIframe) {
      // Make iframe visible and interactive for user to tap
      this.roomIframe.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 320px;
        height: 280px;
        opacity: 1;
        pointer-events: auto;
        border: none;
        border-radius: 10px;
        z-index: 10000;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      `;
    }
  }

  private hideIframe(): void {
    if (this.roomIframe) {
      // Hide iframe again after audio is unlocked
      this.roomIframe.style.cssText = `
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
        border: none;
        overflow: hidden;
      `;
    }
  }

  private setMicActive(): void {
    // Set mic button to active (green) state after audio unlock
    this.isMuted = false;
    const muteBtn = this.shadow.querySelector('[data-action="toggle-mute"]');
    if (muteBtn) {
      muteBtn.classList.remove('muted');
      muteBtn.classList.add('mic-active');
      muteBtn.setAttribute('title', 'Mute');
    }
  }

  private openRoomPopup(roomUrl: string): void {
    // Normal popup - centered on screen
    const width = 400;
    const height = 600;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const features = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no`;

    this.roomWindow = window.open(roomUrl, 'MediaSFU Call', features);

    // If popup blocked, show the URL
    if (!this.roomWindow) {
      // Fallback: open in same tab or show link
      dispatchWidgetEvent(this, 'widget-error',
        createWidgetError('POPUP_BLOCKED', 'Please allow popups to make calls')
      );
    }
  }

  private startRoomMonitor(): void {
    // Monitor if the room window is closed (popup mode only)
    // Iframe mode uses message events instead
    if (!this.headlessMode) {
      this.roomCheckInterval = window.setInterval(() => {
        if (this.roomWindow && this.roomWindow.closed) {
          this.endCall();
        }
      }, 1000);
    }
  }

  private stopRoomMonitor(): void {
    if (this.roomCheckInterval) {
      clearInterval(this.roomCheckInterval);
      this.roomCheckInterval = null;
    }
    // Remove iframe message listener
    window.removeEventListener('message', this.handleIframeMessage);
  }

  private endCall(): void {
    if (this.state !== 'connected' && this.state !== 'ringing') return;

    this.stopDurationTimer();
    this.stopRoomMonitor();

    // Close room window if still open (popup mode)
    if (this.roomWindow && !this.roomWindow.closed) {
      this.roomWindow.close();
    }
    this.roomWindow = null;

    // Send end call message to iframe BEFORE removing it (headless mode)
    if (this.roomIframe?.contentWindow && this.roomOrigin) {
      this.roomIframe.contentWindow.postMessage({
        type: 'mediasfu:endCall',
        payload: {}
      }, this.roomOrigin);

      // Give iframe a moment to process before removing
      setTimeout(() => {
        if (this.roomIframe) {
          this.roomIframe.remove();
          this.roomIframe = null;
        }
      }, 500);
    }

    // Reset mute state
    this.isMuted = false;

    const callEvent: CallEvent = {
      callId: this.currentCallId || '',
      destination: this.roomName || '',
      callerId: this.callerId,
      startTime: this.callStartTime || new Date(),
      endTime: new Date(),
      duration: this.callDuration,
      status: 'ended',
      endReason: 'completed',
    };

    dispatchWidgetEvent(this, 'call-ended', callEvent);
    dispatchWidgetEvent(this, 'call-end', callEvent);

    this.setState('idle');
    this.resetCallState();
  }

  // ============================================================================
  // Timer
  // ============================================================================

  private startDurationTimer(): void {
    this.stopDurationTimer();
    this.callDuration = 0;
    this.durationInterval = window.setInterval(() => {
      this.callDuration++;
      this.updateDurationDisplay();
    }, 1000);
  }

  private stopDurationTimer(): void {
    if (this.durationInterval) {
      clearInterval(this.durationInterval);
      this.durationInterval = null;
    }
  }

  private updateDurationDisplay(): void {
    const timerEl = this.shadow.querySelector('.call-timer');
    if (timerEl) {
      timerEl.textContent = this.formatDuration(this.callDuration);
      // Remove connecting class once timer starts
      timerEl.classList.remove('connecting');
    }
  }

  private formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // ============================================================================
  // State Management
  // ============================================================================

  private markCallConnected(payload?: Record<string, unknown>, setupComplete = false): void {
    if (!this.currentCallId) return;

    if (this.state !== 'connected') {
      if (this.callConfirmationTimeout) {
        clearTimeout(this.callConfirmationTimeout);
        this.callConfirmationTimeout = null;
      }

      this.callStartTime = this.callStartTime || new Date();
      this.setState('connected');
      const callEvent: CallEvent = {
        callId: this.currentCallId,
        destination: this.destination || this._resolvedDestination || this.sipConfigId || this._resolvedSipConfigId,
        callerId: this.callerId,
        startTime: this.callStartTime,
        status: 'connected',
      };
      dispatchWidgetEvent(this, 'call-connected', callEvent);
      dispatchWidgetEvent(this, 'call-start', callEvent);
      if (!this.durationInterval) this.startDurationTimer();
    }

    if (setupComplete && !this.callSetupComplete) {
      this.callSetupComplete = true;
      dispatchWidgetEvent(this, 'call-setup-complete', payload || {});
    }
  }

  private setState(state: CallButtonState): void {
    this.state = state;
    this.render();
  }

  private resetCallState(): void {
    this.currentCallId = null;
    this.callStartTime = null;
    this.callDuration = 0;
    this.roomName = null;
    this.roomOrigin = '';
    this.callSetupComplete = false;
  }

  private showError(error: WidgetError): void {
    this.errorMessage = error.message;
    this.stopDurationTimer();
    this.setState('error');
    dispatchWidgetEvent(this, 'widget-error', error);
  }

  private failCall(message: string): void {
    if (this.callConfirmationTimeout) { clearTimeout(this.callConfirmationTimeout); this.callConfirmationTimeout = null; }
    this.stopDurationTimer();
    this.stopRoomMonitor();
    this.roomIframe?.remove();
    this.roomIframe = null;
    const error = createWidgetError('CALL_FAILED', message);
    this.errorMessage = error.message;
    dispatchWidgetEvent(this, 'widget-error', error);
    dispatchWidgetEvent(this, 'call-failed', error);
    this.setState('error');
    this.resetCallState();
  }

  private cleanup(): void {
    this.stopDurationTimer();
    this.stopRoomMonitor();
    // Cleanup popup
    if (this.roomWindow && !this.roomWindow.closed) {
      this.roomWindow.close();
    }
    this.roomWindow = null;
    // Cleanup iframe
    if (this.roomIframe) {
      this.roomIframe.remove();
      this.roomIframe = null;
    }
    this.resetCallState();
  }

  private showInfoForm(): void {
    const resolvedTheme = this.resolveTheme();
    const isDark = resolvedTheme === 'dark';
    const accent = this.primaryColor;

    // Build field list based on config
    const fields: Array<{ id: string; label: string; type: string; placeholder: string; required: boolean }> = [];
    if (this.requireName) {
      fields.push({ id: 'msfu-name', label: this.getOverrideText(['nameLabel'], 'Your Name'), type: 'text', placeholder: 'e.g. Jane Smith', required: true });
    }
    if (this.collectCallerNumber) {
      fields.push({ id: 'msfu-number', label: this.getOverrideText(['numberLabel'], 'Phone Number'), type: 'tel', placeholder: 'e.g. +1 555 123 4567', required: false });
    }
    if (this.requireEmail) {
      fields.push({ id: 'msfu-email', label: this.getOverrideText(['emailLabel'], 'Email'), type: 'email', placeholder: 'e.g. jane@company.com', required: true });
    }

    if (fields.length === 0) {
      this.initiateCall();
      return;
    }

    const bg = isDark ? 'rgba(15,18,36,0.97)' : 'rgba(255,255,255,0.97)';
    const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    const text = isDark ? '#F5F6FA' : '#1a1a2e';
    const subtext = isDark ? '#8395A7' : '#6b7280';
    const inputBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
    const inputBorder = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
    const inputFocus = accent;

    const fieldsHtml = fields.map(f => `
      <div style="display:flex;flex-direction:column;gap:4px">
        <label for="${f.id}" style="font-size:11px;font-weight:600;color:${subtext};text-transform:uppercase;letter-spacing:0.8px">
          ${this.escapeHtml(f.label)}${f.required ? ' <span style="color:#ef4444">*</span>' : ''}
        </label>
        <input id="${f.id}" type="${f.type}" placeholder="${f.placeholder}"
          ${f.required ? 'required' : ''}
          style="padding:10px 14px;border-radius:10px;border:1.5px solid ${inputBorder};background:${inputBg};color:${text};
          font-size:14px;font-family:inherit;outline:none;transition:border-color 0.2s,box-shadow 0.2s"
          onfocus="this.style.borderColor='${inputFocus}';this.style.boxShadow='0 0 0 3px ${inputFocus}22'"
          onblur="this.style.borderColor='${inputBorder}';this.style.boxShadow='none'" />
      </div>
    `).join('');

    const container = this.shadow.querySelector('.mediasfu-call-button');
    if (!container) return;

    // Build overlay + form
    const overlay = document.createElement('div');
    overlay.className = 'msfu-info-overlay';
    overlay.innerHTML = `
      <div class="msfu-info-card" style="
        background:${bg};
        border:1px solid ${border};
        border-radius:16px;
        padding:24px;
        min-width:280px;
        max-width:340px;
        box-shadow:0 8px 32px rgba(0,0,0,${isDark ? '0.5' : '0.15'});
        backdrop-filter:blur(20px);
        -webkit-backdrop-filter:blur(20px);
        font-family:'Segoe UI',system-ui,-apple-system,sans-serif;
        animation:msfu-slideUp 0.25s ease-out;
      ">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">
          <div style="width:36px;height:36px;border-radius:12px;
            background:linear-gradient(135deg,${accent},${accent}cc);
            display:flex;align-items:center;justify-content:center">
            <svg viewBox="0 0 24 24" fill="#fff" width="18" height="18">
              <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
            </svg>
          </div>
          <div>
            <div style="font-size:15px;font-weight:700;color:${text}">${this.escapeHtml(this.getOverrideText(['infoTitle'], 'Before we connect'))}</div>
            <div style="font-size:12px;color:${subtext}">${this.escapeHtml(this.getOverrideText(['infoSubtitle'], "Quick intro so we know who's calling"))}</div>
          </div>
        </div>

        <form id="msfu-info-form" style="display:flex;flex-direction:column;gap:14px" novalidate>
          ${fieldsHtml}
          <div style="display:flex;gap:8px;margin-top:4px">
            <button type="button" data-action="cancel-form"
              style="flex:1;padding:10px;border-radius:10px;border:1.5px solid ${border};
              background:transparent;color:${subtext};font-size:13px;font-weight:600;
              cursor:pointer;transition:all 0.2s;font-family:inherit">
              ${this.escapeHtml(this.getOverrideText(['cancelButton'], 'Cancel'))}
            </button>
            <button type="submit"
              style="flex:2;padding:10px;border-radius:10px;border:none;
              background:linear-gradient(135deg,${accent},${accent}dd);
              color:#fff;font-size:13px;font-weight:700;cursor:pointer;
              transition:all 0.2s;font-family:inherit;
              box-shadow:0 2px 8px ${accent}44">
              ${renderIcon('phone')} ${this.escapeHtml(this.getOverrideText(['startCallButton'], 'Start Call'))}
            </button>
          </div>
        </form>
      </div>
    `;

    // Style for the overlay
    const style = document.createElement('style');
    style.textContent = `
      @keyframes msfu-slideUp {
        from { opacity:0; transform:translateY(12px) scale(0.97); }
        to { opacity:1; transform:translateY(0) scale(1); }
      }
      .msfu-info-overlay {
        position:fixed; inset:0; z-index:10001;
        display:flex; align-items:center; justify-content:center;
        background:rgba(0,0,0,0.4); backdrop-filter:blur(4px);
        -webkit-backdrop-filter:blur(4px);
      }
    `;
    this.shadow.appendChild(style);
    this.shadow.appendChild(overlay);

    // Event handlers
    const form = overlay.querySelector('#msfu-info-form') as HTMLFormElement;
    const cancelBtn = overlay.querySelector('[data-action="cancel-form"]');

    cancelBtn?.addEventListener('click', () => {
      overlay.remove();
      style.remove();
    });

    form?.addEventListener('submit', (e: Event) => {
      e.preventDefault();
      const nameInput = overlay.querySelector('#msfu-name') as HTMLInputElement | null;
      const emailInput = overlay.querySelector('#msfu-email') as HTMLInputElement | null;
      const numberInput = overlay.querySelector('#msfu-number') as HTMLInputElement | null;

      // Basic validation
      if (nameInput?.required && !nameInput.value.trim()) {
        nameInput.style.borderColor = '#ef4444';
        nameInput.focus();
        return;
      }
      if (emailInput?.required && !emailInput.value.trim()) {
        emailInput.style.borderColor = '#ef4444';
        emailInput.focus();
        return;
      }

      const userInfo = {
        name: nameInput?.value.trim() || undefined,
        email: emailInput?.value.trim() || undefined,
        number: numberInput?.value.trim() || undefined,
      };

      overlay.remove();
      style.remove();
      this.initiateCall(userInfo);
    });

    // Focus first input
    setTimeout(() => {
      const firstInput = overlay.querySelector('input') as HTMLInputElement | null;
      firstInput?.focus();
    }, 100);
  }

  // ============================================================================
  // Rendering
  // ============================================================================

  private render(): void {
    const resolvedTheme = this.resolveTheme();

    // Generate dynamic styles based on config
    const dynamicStyles = this.generateDynamicStyles();

    this.shadow.innerHTML = `
      <style>${callButtonStyles}${dynamicStyles}${this.customCss ? `\n${this.customCss}` : ''}</style>
      <div class="mediasfu-call-button ${resolvedTheme} ${this.position} ${this.customCssClass}"
           data-state="${this.state}"
           data-animation="${this.animationStyle}"
           data-size="${this.buttonSize}">
        ${this.renderContent()}
      </div>
    `;

    this.attachEventListeners();
    this.setupScrollBehavior();
    this.setupDelayedShow();
    this.setupAnalytics();
  }

  private generateDynamicStyles(): string {
    const radiusMap: Record<string, string> = {
      rounded: '8px',
      pill: '50px',
      square: '0px',
      circle: '50%'
    };

    const shadowMap: Record<string, string> = {
      none: 'none',
      subtle: '0 2px 4px rgba(0,0,0,0.1)',
      medium: '0 4px 12px rgba(0,0,0,0.15)',
      strong: '0 8px 24px rgba(0,0,0,0.25)'
    };

    const sizeMap: Record<string, { padding: string; fontSize: string }> = {
      small: { padding: '10px 16px', fontSize: '14px' },
      medium: { padding: '14px 24px', fontSize: '16px' },
      large: { padding: '18px 32px', fontSize: '18px' }
    };

    const size = sizeMap[this.buttonSize] || sizeMap.medium;

    return `
      .mediasfu-call-button .call-btn.primary {
        background-color: ${this.primaryColor};
        color: ${this.textColor};
        border-radius: ${radiusMap[this.borderRadius] || '8px'};
        box-shadow: ${shadowMap[this.shadowStyle] || shadowMap.medium};
        padding: ${size.padding};
        font-size: ${size.fontSize};
      }
      ${this.animationStyle !== 'none' ? `
        @keyframes msfu-${this.animationStyle} {
          ${this.animationStyle === 'pulse' ? '0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); }' : ''}
          ${this.animationStyle === 'bounce' ? '0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); }' : ''}
          ${this.animationStyle === 'shake' ? '0%, 100% { transform: translateX(0); } 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); }' : ''}
        }
        .mediasfu-call-button[data-state="idle"] .call-btn.primary {
          animation: msfu-${this.animationStyle} ${this.animationStyle === 'shake' ? '0.5s' : '2s'} ease-in-out infinite;
        }
      ` : ''}
    `;
  }

  private setupScrollBehavior(): void {
    if (!this.hideOnScroll || this.position === 'inline') return;

    const container = this.shadow.querySelector('.mediasfu-call-button') as HTMLElement;
    if (!container) return;

    let scrollTimer: ReturnType<typeof setTimeout>;
    const handleScroll = () => {
      container.style.opacity = '0.3';
      container.style.transform = 'scale(0.9)';
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        container.style.opacity = '1';
        container.style.transform = 'scale(1)';
      }, 150);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
  }

  private setupDelayedShow(): void {
    if (this.showAfterDelay <= 0) return;

    const container = this.shadow.querySelector('.mediasfu-call-button') as HTMLElement;
    if (!container) return;

    container.style.display = 'none';
    setTimeout(() => {
      container.style.display = '';
    }, this.showAfterDelay * 1000);
  }

  private setupAnalytics(): void {
    if (!this.googleAnalyticsId) return;
    // Analytics is tracked via events, setup is handled by host page
  }

  private renderContent(): string {
    switch (this.state) {
      case 'idle':
        return this.renderIdleState();
      case 'authenticating':
        return this.renderAuthenticatingState();
      case 'ringing':
        return this.renderRingingState();
      case 'connected':
        return this.renderConnectedState();
      case 'error':
        return this.renderErrorState();
      default:
        return this.renderIdleState();
    }
  }

  private renderIdleState(): string {
    return `
      <div class="call-launch">
        <button type="button" class="call-btn primary" data-action="start-call">
          ${this.renderIcon()}
          <span class="btn-text">${this.buttonText}</span>
        </button>
        ${this.showStatus ? '<span class="call-availability" role="status"><span class="call-availability-dot"></span>Available now</span>' : ''}
      </div>
    `;
  }

  private renderAuthenticatingState(): string {
    return `
      <button class="call-btn primary loading" disabled>
        <span class="spinner"></span>
        <span class="btn-text">${this.escapeHtml(this.getOverrideText(['status'], 'Connecting...'))}</span>
      </button>
    `;
  }

  private renderRingingState(): string {
    return `
      <div class="call-active ringing">
        <div class="call-status">
          <span class="pulse"></span>
          ${this.escapeHtml(this.getOverrideText(['status'], 'Calling...'))}
        </div>
        <button class="call-btn danger" data-action="end-call">
          ${this.renderEndIcon()}
          <span class="btn-text">${this.escapeHtml(this.getOverrideText(['cancelButton'], 'Cancel'))}</span>
        </button>
      </div>
    `;
  }

  private renderConnectedState(): string {
    const isConnecting = this.callDuration === 0;
    return `
      <div class="call-active connected">
        <div class="call-timer${isConnecting ? ' connecting' : ''}">${isConnecting ? this.escapeHtml(this.getOverrideText(['status'], 'Connecting...')) : this.formatDuration(this.callDuration)}</div>
        <div class="call-controls">
          <button class="control-btn" data-action="toggle-mute" title="Mute">
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
            </svg>
          </button>
          <button class="control-btn end" data-action="end-call" title="End Call">
            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
              <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  private renderErrorState(): string {
    return `
      <div class="call-error">
        <span class="error-icon">${renderIcon('warning')}</span>
        <span class="error-message">${this.escapeHtml(this.errorMessage || this.getOverrideText(['status'], 'An error occurred'))}</span>
        <button class="call-btn secondary" data-action="retry">
          ${this.escapeHtml(this.getOverrideText(['buttonText', 'button'], 'Try Again'))}
        </button>
      </div>
    `;
  }

  private renderIcon(): string {
    switch (this.buttonIcon) {
      case 'phone':
        return `<svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
          <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
        </svg>`;
      case 'video':
        return `<svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
          <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
        </svg>`;
      case 'headset':
        return `<svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
          <path d="M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z"/>
        </svg>`;
      case 'none':
        return '';
      default:
        return `<svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
          <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
        </svg>`;
    }
  }

  private renderEndIcon(): string {
    return `<svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
      <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
    </svg>`;
  }

  private resolveTheme(): string {
    if (this.theme === 'auto') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return this.theme;
  }

  private attachEventListeners(): void {
    const startBtn = this.shadow.querySelector('[data-action="start-call"]');
    const endBtn = this.shadow.querySelector('[data-action="end-call"]');
    const retryBtn = this.shadow.querySelector('[data-action="retry"]');
    const muteBtn = this.shadow.querySelector('[data-action="toggle-mute"]');

    startBtn?.addEventListener('click', () => this.startCall());
    endBtn?.addEventListener('click', () => this.endCall());
    retryBtn?.addEventListener('click', () => {
      this.errorMessage = null;
      this.setState('idle');
    });
    muteBtn?.addEventListener('click', () => this.toggleMute());
  }

  private toggleMute(): void {
    // Toggle mute state
    this.isMuted = !this.isMuted;

    // Update button visual state
    const muteBtn = this.shadow.querySelector('[data-action="toggle-mute"]');
    if (this.isMuted) {
      muteBtn?.classList.remove('mic-active');
      muteBtn?.classList.add('muted');
      muteBtn?.setAttribute('title', 'Unmute');
    } else {
      muteBtn?.classList.remove('muted');
      muteBtn?.classList.add('mic-active');
      muteBtn?.setAttribute('title', 'Mute');
    }

    // Send message to iframe to toggle audio
    if (this.roomIframe?.contentWindow && this.roomOrigin) {
      this.roomIframe.contentWindow.postMessage({
        type: 'mediasfu:toggleMute',
        payload: { muted: this.isMuted }
      }, this.roomOrigin);
    }

    // Dispatch event for external listeners
    dispatchWidgetEvent(this, 'mute-toggle', { muted: this.isMuted });
  }
}

// Register the custom element
if (typeof window !== 'undefined' && !customElements.get('mediasfu-call-button')) {
  customElements.define('mediasfu-call-button', MediaSFUCallButton);
}
