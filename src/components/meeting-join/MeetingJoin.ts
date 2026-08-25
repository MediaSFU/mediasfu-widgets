/**
 * MediaSFU Meeting Join Web Component
 * Room code entry form with device preview
 * Supports create & join modes via MediaSFU REST API → publicURL (prebuilt)
 * or via the prebuilt full MediaSFU meeting UI.
 * Inspired by ModernMeetingSetup — real camera preview, mic test, device selection, cookie persistence
 */

import { authenticate, createWidgetError, getSessionToken } from '../../core/auth';
import { dispatchWidgetEvent } from '../../core/events';
import { getApiUrl } from '../../core/config-store';
import { resolveGlyphIcon } from '../../core/iconGlyph';
import { renderIcon, type IconName } from '../../core/icons';
import { HTMLElementBase } from '../../core/HTMLElementBase';
import type { WidgetError } from '../../types';
import { meetingJoinStyles } from './MeetingJoin.styles';

type MeetingJoinState = 'form' | 'preview' | 'joining' | 'error' | 'ready';
type ActiveTab = 'join' | 'create';

export class MediaSFUMeetingJoin extends HTMLElementBase {
  private shadow: ShadowRoot;
  private state: MeetingJoinState = 'form';
  private videoStream: MediaStream | null = null;
  private errorMessage: string | null = null;
  private roomRequestIdempotency: { fingerprint: string; key: string } | null = null;

  // Form values
  private formName: string = '';
  private formEmail: string = '';
  private formRoomCode: string = '';
  private isVideoEnabled: boolean = true;
  private isAudioEnabled: boolean = true;

  // Create/Join tab
  private activeTab: ActiveTab = 'join';

  // Create-mode fields
  private createDuration: number = 30;
  private createCapacity: number = 5;
  private createEventType: string = 'conference';

  // Device management
  private cameraDevices: MediaDeviceInfo[] = [];
  private micDevices: MediaDeviceInfo[] = [];
  private selectedCameraId: string = '';
  private selectedMicId: string = '';
  private mediaInitialised: boolean = false;

  // Mic level analyser
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private micLevelRAF: number = 0;

  // Mic test
  private micTestState: 'idle' | 'recording' | 'playing' = 'idle';
  private micTestRecorder: MediaRecorder | null = null;
  private micTestChunks: Blob[] = [];

  static get observedAttributes(): string[] {
    return [
      // Basic
      'widget-key',
      'room-prefix',
      'room-code',
      'theme',
      'show-preview',
      'require-name',
      'require-email',
      'default-name',
      'default-email',
      'allow-guests',
      // Mode
      'mode',        // join-only | create-only | both  (default: join-only)
      // 'room-mode' removed — always prebuilt
      'create-code', // optional auth code for create mode
      'create-code-required', // boolean — code required but validated server-side
      'redirect-mode', // new-tab | iframe               (default: new-tab)
      // Branding
      'primary-color',
      'text-color',
      'border-radius',
      'button-size',
      'shadow-style',
      // Behavior
      'play-join-sound',
      'show-device-settings',
      'auto-join',
      'start-with-video-off',
      'start-with-audio-off',
      'enable-content-overrides',
      'content-overrides',
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
    this.formName = this.getAttribute('default-name') || '';
    this.formEmail = this.getAttribute('default-email') || '';
    this.formRoomCode = this.getAttribute('room-code') || '';

    // Default activeTab based on mode
    if (this.mode === 'create-only') {
      this.activeTab = 'create';
    } else {
      this.activeTab = 'join';
    }

    this.render();
    this.validateConfig();
  }

  disconnectedCallback(): void {
    this.stopPreview();
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string): void {
    if (oldValue !== newValue) {
      this.render();
    }
  }

  // Configuration getters
  private get widgetKey(): string {
    return this.getAttribute('widget-key') || '';
  }

  private get roomPrefix(): string {
    return this.getAttribute('room-prefix') || '';
  }

  private get theme(): 'light' | 'dark' | 'auto' {
    return (this.getAttribute('theme') as 'light' | 'dark' | 'auto') || 'light';
  }

  private get showPreview(): boolean {
    return this.getAttribute('show-preview') !== 'false';
  }

  private get requireName(): boolean {
    return this.getAttribute('require-name') !== 'false';
  }

  private get requireEmail(): boolean {
    return this.getAttribute('require-email') === 'true';
  }

  private get allowGuests(): boolean {
    return this.getAttribute('allow-guests') !== 'false';
  }

  /** Widget mode: join-only (default), create-only, or both */
  private get mode(): 'join-only' | 'create-only' | 'both' {
    return (this.getAttribute('mode') as 'join-only' | 'create-only' | 'both') || 'join-only';
  }

  /** Room rendering mode — always prebuilt (custom path removed). */
  private get roomMode(): 'prebuilt' {
    return 'prebuilt';
  }

  /** Optional authorization code required for room creation (legacy; prefer create-code-required) */
  private get createCode(): string {
    return this.getAttribute('create-code') || '';
  }

  /** Whether a create-code is required (set when the code is stored server-side) */
  private get createCodeRequired(): boolean {
    return this.getAttribute('create-code-required') === 'true' || !!this.createCode;
  }

  /**
   * Redirect mode after creating/joining a room:
   *  - new-tab (default): opens meeting in a new browser tab
   *  - iframe: embeds the meeting inline within the widget (near full viewport)
   */
  private get redirectMode(): 'new-tab' | 'iframe' {
    return (this.getAttribute('redirect-mode') as 'new-tab' | 'iframe') || 'new-tab';
  }

  /** Track whether create code has been validated this session */
  private createCodeValidated = false;
  /** Number of failed create-code attempts this session */
  private createCodeAttempts = 0;
  /** Whether the user is locked out from code attempts (cookie-based, 10 min) */
  private get createCodeLocked(): boolean {
    return !!this.getCookie('msfu_codelock');
  }
  /** Whether the create-code verification request is in flight */
  private verifyingCode = false;

  // Branding getters
  private get primaryColor(): string {
    return this.getAttribute('primary-color') || '#3b82f6';
  }

  private get textColor(): string {
    return this.getAttribute('text-color') || '#FFFFFF';
  }

  private get borderRadius(): 'rounded' | 'pill' | 'square' {
    return (this.getAttribute('border-radius') as any) || 'rounded';
  }

  private get buttonSize(): 'small' | 'medium' | 'large' {
    return (this.getAttribute('button-size') as any) || 'medium';
  }

  private get shadowStyle(): 'none' | 'subtle' | 'medium' | 'strong' {
    return (this.getAttribute('shadow-style') as any) || 'medium';
  }

  // Behavior getters
  private get playJoinSound(): boolean {
    return this.getAttribute('play-join-sound') !== 'false';
  }

  private get showDeviceSettings(): boolean {
    return this.getAttribute('show-device-settings') !== 'false';
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
   * Returns trusted markup: insert it WITHOUT escaping. That is safe because
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

  private get autoJoin(): boolean {
    return this.getAttribute('auto-join') === 'true';
  }

  private get startWithVideoOff(): boolean {
    return this.getAttribute('start-with-video-off') === 'true';
  }

  private get startWithAudioOff(): boolean {
    return this.getAttribute('start-with-audio-off') === 'true';
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

  private async validateConfig(): Promise<void> {
    if (!this.widgetKey) {
      this.showError(createWidgetError('INVALID_WIDGET_KEY', 'Widget key is required'));
      return;
    }

    try {
      await authenticate(this.widgetKey, 'meeting-join');
      dispatchWidgetEvent(this, 'widget-ready', { widgetType: 'meeting-join' });
    } catch (error) {
      this.showError(error as WidgetError);
    }
  }

  private async startPreview(): Promise<void> {
    if (!this.showPreview) {
      this.joinMeeting();
      return;
    }

    // Restore saved preferences from cookies
    this.restoreDevicePrefs();
    this.setState('preview');

    // Enumerate devices then auto-start media
    // User already expressed intent by clicking "Next: Preview"
    await this.populateDevices();
    await this.initMedia();
  }

  /** Enumerate cameras & mics, restore saved device from cookie */
  private async populateDevices(): Promise<void> {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.cameraDevices = devices.filter(d => d.kind === 'videoinput');
      this.micDevices = devices.filter(d => d.kind === 'audioinput');

      // Restore saved IDs if still available
      const savedCam = this.getCookie('msfu_videoDevice');
      if (savedCam && this.cameraDevices.some(d => d.deviceId === savedCam)) {
        this.selectedCameraId = savedCam;
      }
      const savedMic = this.getCookie('msfu_audioDevice');
      if (savedMic && this.micDevices.some(d => d.deviceId === savedMic)) {
        this.selectedMicId = savedMic;
      }

      // Re-render device dropdowns (targeted, not full render)
      this.updateDeviceDropdowns();
    } catch (err) {
      console.warn('populateDevices:', err);
    }
  }

  /** Start camera + mic stream with chosen devices */
  private async initMedia(): Promise<void> {
    this.mediaInitialised = true;
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: this.selectedCameraId ? { exact: this.selectedCameraId } : undefined,
          facingMode: 'user',
          width: { ideal: 480 },
          height: { ideal: 480 },
        },
        audio: {
          deviceId: this.selectedMicId ? { exact: this.selectedMicId } : undefined,
        },
      };

      this.videoStream = await navigator.mediaDevices.getUserMedia(constraints);

      const video = this.shadow.querySelector('.preview-video') as HTMLVideoElement;
      const placeholder = this.shadow.querySelector('.preview-placeholder') as HTMLElement;
      if (video) {
        video.srcObject = this.videoStream;
        video.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';
      }

      // Apply initial on/off states
      this.videoStream.getVideoTracks().forEach(t => { t.enabled = this.isVideoEnabled; });
      this.videoStream.getAudioTracks().forEach(t => { t.enabled = this.isAudioEnabled; });

      // Show placeholder if video starts off
      if (!this.isVideoEnabled && placeholder) {
        placeholder.style.display = 'flex';
        const spans = placeholder.querySelectorAll('span');
        if (spans.length > 1) spans[1].textContent = 'Camera off';
      }

      // Re-enumerate to get real labels (Chrome unlocks labels after permission)
      await this.populateDevices();

      // Start mic level meter
      this.startMicLevelMeter();

      // Save device choices
      const vTrack = this.videoStream.getVideoTracks()[0];
      const aTrack = this.videoStream.getAudioTracks()[0];
      if (vTrack?.getSettings().deviceId) {
        this.selectedCameraId = vTrack.getSettings().deviceId!;
        this.setCookie('msfu_videoDevice', this.selectedCameraId, 30);
      }
      if (aTrack?.getSettings().deviceId) {
        this.selectedMicId = aTrack.getSettings().deviceId!;
        this.setCookie('msfu_audioDevice', this.selectedMicId, 30);
      }
    } catch (error) {
      console.warn('Could not access camera:', error);
      this.mediaInitialised = false; // allow retry
      const placeholder = this.shadow.querySelector('.preview-placeholder') as HTMLElement;
      if (placeholder) {
        placeholder.style.cursor = 'pointer';
        const spans = placeholder.querySelectorAll('span');
        if (spans.length > 0) spans[0].innerHTML = renderIcon('warning');
        if (spans.length > 1) spans[1].textContent = 'Camera unavailable — tap to retry';
      }
    }
  }

  /** Switch camera by device id */
  private async switchCamera(deviceId: string): Promise<void> {
    this.selectedCameraId = deviceId;
    if (!this.videoStream) return;
    // Stop old video track
    this.videoStream.getVideoTracks().forEach(t => t.stop());
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: deviceId ? { exact: deviceId } : undefined, facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } },
      });
      const newTrack = newStream.getVideoTracks()[0];
      // Replace track in existing stream
      const oldTrack = this.videoStream.getVideoTracks()[0];
      if (oldTrack) this.videoStream.removeTrack(oldTrack);
      this.videoStream.addTrack(newTrack);
      newTrack.enabled = this.isVideoEnabled;

      const video = this.shadow.querySelector('.preview-video') as HTMLVideoElement;
      if (video) video.srcObject = this.videoStream;

      this.setCookie('msfu_videoDevice', deviceId, 30);
    } catch (err) {
      console.warn('switchCamera:', err);
    }
  }

  /** Switch mic by device id */
  private async switchMic(deviceId: string): Promise<void> {
    this.selectedMicId = deviceId;
    if (!this.videoStream) return;
    // Stop old audio track
    this.videoStream.getAudioTracks().forEach(t => t.stop());
    this.stopMicLevelMeter();
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: deviceId ? { exact: deviceId } : undefined },
      });
      const newTrack = newStream.getAudioTracks()[0];
      const oldTrack = this.videoStream.getAudioTracks()[0];
      if (oldTrack) this.videoStream.removeTrack(oldTrack);
      this.videoStream.addTrack(newTrack);
      newTrack.enabled = this.isAudioEnabled;

      this.startMicLevelMeter();
      this.setCookie('msfu_audioDevice', deviceId, 30);
    } catch (err) {
      console.warn('switchMic:', err);
    }
  }

  /** Real-time mic level meter using AudioContext AnalyserNode */
  private startMicLevelMeter(): void {
    if (!this.videoStream) return;
    const audioTrack = this.videoStream.getAudioTracks()[0];
    if (!audioTrack) return;

    try {
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 256;
      source.connect(this.analyserNode);

      const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
      const levelFill = () => this.shadow.querySelector('.mic-level-fill') as HTMLElement;

      const tick = () => {
        if (!this.analyserNode) return;
        this.analyserNode.getByteFrequencyData(dataArray);
        // RMS-ish average
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;
        const pct = Math.min(100, (avg / 128) * 100);
        const el = levelFill();
        if (el) el.style.width = pct + '%';
        this.micLevelRAF = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      console.warn('mic level meter:', err);
    }
  }

  private stopMicLevelMeter(): void {
    if (this.micLevelRAF) cancelAnimationFrame(this.micLevelRAF);
    this.micLevelRAF = 0;
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
      this.analyserNode = null;
    }
  }

  /** Mic test: record 3 s → play back, like ModernMeetingSetup */
  private async handleMicTest(): Promise<void> {
    if (this.micTestState !== 'idle') return;

    try {
      this.micTestState = 'recording';
      this.updateMicTestButton();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: this.selectedMicId ? { exact: this.selectedMicId } : undefined },
      });

      this.micTestChunks = [];
      this.micTestRecorder = new MediaRecorder(stream);
      this.micTestRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.micTestChunks.push(e.data);
      };
      this.micTestRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(this.micTestChunks, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);

        this.micTestState = 'playing';
        this.updateMicTestButton();

        const audio = new Audio(url);
        audio.onended = () => {
          this.micTestState = 'idle';
          this.updateMicTestButton();
          URL.revokeObjectURL(url);
        };
        try {
          await audio.play();
        } catch {
          this.micTestState = 'idle';
          this.updateMicTestButton();
        }
      };

      this.micTestRecorder.start();
      // Record for 3 seconds
      setTimeout(() => {
        if (this.micTestRecorder?.state !== 'inactive') {
          this.micTestRecorder?.stop();
        }
      }, 3000);
    } catch (err) {
      console.warn('mic test:', err);
      this.micTestState = 'idle';
      this.updateMicTestButton();
    }
  }

  /** Update only the mic test button text without full re-render */
  private updateMicTestButton(): void {
    const btn = this.shadow.querySelector('[data-action="mic-test"]') as HTMLElement;
    if (!btn) return;
    const micIcon = this.getOverrideGlyph(['micToggleButton', 'muteToggle'], 'mic');
    const labels: Record<string, string> = {
      'idle': `${micIcon} Test Microphone`,
      'recording': '⏺️ Speak now…',
      'playing': 'Playing back…',
    };
    btn.textContent = labels[this.micTestState] || labels.idle;
    (btn as HTMLButtonElement).disabled = this.micTestState !== 'idle';
  }

  /** Update device dropdowns in-place */
  private updateDeviceDropdowns(): void {
    const camSelect = this.shadow.querySelector('[data-select="camera"]') as HTMLSelectElement;
    const micSelect = this.shadow.querySelector('[data-select="mic"]') as HTMLSelectElement;
    if (camSelect) {
      camSelect.innerHTML = '<option value="">Default Camera</option>' +
        this.cameraDevices.map((d, i) =>
          `<option value="${d.deviceId}" ${d.deviceId === this.selectedCameraId ? 'selected' : ''}>${d.label || 'Camera ' + (i + 1)}</option>`
        ).join('');
    }
    if (micSelect) {
      micSelect.innerHTML = '<option value="">Default Microphone</option>' +
        this.micDevices.map((d, i) =>
          `<option value="${d.deviceId}" ${d.deviceId === this.selectedMicId ? 'selected' : ''}>${d.label || 'Mic ' + (i + 1)}</option>`
        ).join('');
    }
  }

  private stopPreview(): void {
    this.stopMicLevelMeter();
    if (this.micTestRecorder && this.micTestRecorder.state !== 'inactive') {
      this.micTestRecorder.stop();
    }
    this.micTestState = 'idle';
    if (this.videoStream) {
      this.videoStream.getTracks().forEach(track => track.stop());
      this.videoStream = null;
    }
    this.mediaInitialised = false;
  }

  // --- Cookie helpers (like ModernMeetingSetup) ---
  private getCookie(name: string): string {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop()!.split(';').shift() || '';
    return '';
  }

  private setCookie(name: string, value: string, days: number): void {
    const d = new Date();
    d.setTime(d.getTime() + days * 86400000);
    document.cookie = `${name}=${value};expires=${d.toUTCString()};path=/`;
  }

  private restoreDevicePrefs(): void {
    const savedVid = this.getCookie('msfu_videoEnabled');
    if (savedVid === 'false') this.isVideoEnabled = false;
    const savedAud = this.getCookie('msfu_audioEnabled');
    if (savedAud === 'false') this.isAudioEnabled = false;
  }

  // ── Create-code verification ──────────────────────────────────
  /**
   * Lightweight server check of the create-code.
   * 3 attempts allowed; after that, a 10-minute cookie lockout kicks in.
   */
  private async verifyCreateCode(): Promise<void> {
    if (this.verifyingCode || this.createCodeValidated || this.createCodeLocked) return;

    const codeInput = this.shadow.querySelector<HTMLInputElement>('[data-input="create-code"]');
    const code = codeInput?.value?.trim() || '';
    if (!code) {
      this.showError(createWidgetError('UNKNOWN_ERROR', 'Please enter the authorization code.'));
      return;
    }

    // Client-side quick reject (legacy: when raw code is in the attribute — rare)
    if (this.createCode && code !== this.createCode) {
      this.createCodeAttempts++;
      if (this.createCodeAttempts >= 3) {
        // Set 10-minute lockout cookie (expires = fraction of a day)
        const d = new Date();
        d.setTime(d.getTime() + 10 * 60 * 1000); // 10 min
        document.cookie = `msfu_codelock=1;expires=${d.toUTCString()};path=/`;
      }
      this.render(); // re-render to show updated attempts / lockout
      return;
    }

    // Server verification
    this.verifyingCode = true;
    this.render(); // show "Verifying…" state

    try {
      let sessionToken = getSessionToken(this.widgetKey);
      if (!sessionToken) {
        const auth = await authenticate(this.widgetKey, 'meeting-join');
        sessionToken = auth.sessionToken;
      }

      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/v1/widget/verify-create-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken, createCode: code }),
      });

      const data = await res.json().catch(() => ({ success: false }));

      if (data.success) {
        this.createCodeValidated = true;
        this.verifyingCode = false;
        this.render(); // reveal full create form
      } else {
        this.createCodeAttempts++;
        this.verifyingCode = false;

        if (this.createCodeAttempts >= 3) {
          const d = new Date();
          d.setTime(d.getTime() + 10 * 60 * 1000);
          document.cookie = `msfu_codelock=1;expires=${d.toUTCString()};path=/`;
          this.render(); // show lockout
        } else {
          this.render(); // show updated attempts remaining
        }
      }
    } catch (err) {
      this.verifyingCode = false;
      this.showError(createWidgetError('NETWORK_ERROR', 'Could not verify code. Check your connection and try again.'));
    }
  }

  private async joinMeeting(): Promise<void> {
    // Re-entry guard.
    //
    // Creating a room POSTs /v1/rooms/ with a fresh random name, so every extra
    // invocation makes a genuinely new room that the server cannot recognise as
    // a repeat — a double-click left orphaned rooms behind (and, in new-tab
    // mode, an extra blank tab per click). The React SDK holds a 30s lock for
    // the same reason; the widget had nothing.
    if (this.state === 'joining') {
      return;
    }

    this.setState('joining');

    // ── iOS/Safari pop-up fix ────────────────────────────────────
    // Safari only allows window.open inside the synchronous call stack
    // of a user gesture. We open a blank tab NOW (before any await) and
    // set its URL once the async room creation/join completes.
    // If the flow fails, we close the blank tab.
    let pendingTab: Window | null = null;
    if (this.redirectMode !== 'iframe') {
      pendingTab = window.open('about:blank', '_blank');
      // Write a simple loading message so the blank tab isn't jarring
      if (pendingTab) {
        try {
          pendingTab.document.title = 'Joining meeting…';
          pendingTab.document.body.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;
              height:100vh;background:#0f172a;color:#94a3b8;font-family:system-ui,sans-serif;
              font-size:18px;flex-direction:column;gap:12px;">
              <div style="width:32px;height:32px;border:3px solid #334155;
                border-top-color:#3b82f6;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
              <span>Joining meeting…</span>
              <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
            </div>`;
        } catch { /* cross-origin — tab was opened, loading message is best-effort */ }
      }
    }

    const roomCode = this.roomPrefix + this.formRoomCode;
    const isCreateAction = this.activeTab === 'create';

    // ── Create-code gate ─────────────────────────────────────────
    // Code is now verified upfront on the Create tab (verifyCreateCode()),
    // so by the time we reach joinMeeting the code is already validated.
    if (isCreateAction && this.createCodeRequired && !this.createCodeValidated) {
      this.showError(createWidgetError('UNKNOWN_ERROR', 'Please verify the authorization code first.'));
      this.setState('form');
      return;
    }

    try {
      // Ensure we have a valid session token
      let sessionToken = getSessionToken(this.widgetKey);
      if (!sessionToken) {
        const auth = await authenticate(this.widgetKey, 'meeting-join');
        sessionToken = auth.sessionToken;
      }

      // Stop camera preview before navigating
      this.stopPreview();

      // Dispatch event so host page can listen/react
      const joinPayload = {
        roomCode: isCreateAction ? '' : roomCode,
        userName: this.formName,
        userEmail: this.formEmail,
        videoEnabled: this.isVideoEnabled,
        audioEnabled: this.isAudioEnabled,
        action: isCreateAction ? 'create' : 'join',
      };
      dispatchWidgetEvent(this, 'meeting-join', joinPayload);

      const apiUrl = getApiUrl();

      if (this.roomMode === 'prebuilt') {
        // ── Prebuilt mode (default) ──────────────────────────────
        // 1. Exchange session token for real API credentials
        // Include createCode for server-side validation when creating
        const validateBody: Record<string, unknown> = { sessionToken };

        const validateRes = await fetch(`${apiUrl}/v1/widget/validate-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validateBody),
        });

        if (!validateRes.ok) {
          const err = await validateRes.json().catch(() => ({}));
          throw createWidgetError('NETWORK_ERROR', err.error || 'Session validation failed');
        }

        const validateData = await validateRes.json();
        if (!validateData.success || !validateData.credentials) {
          throw createWidgetError('SESSION_EXPIRED', validateData.error || 'Invalid session');
        }

        const { apiUserName, apiKey } = validateData.credentials;

        // 2. Build payload for POST /v1/rooms/
        const sanitizedName = (this.formName || 'Guest')
          .replace(/[^a-zA-Z0-9]/g, '')
          .slice(0, 10) || 'Guest';

        let payload: Record<string, unknown>;
        if (isCreateAction) {
          payload = {
            action: 'create',
            userName: sanitizedName,
            duration: this.createDuration,
            capacity: this.createCapacity,
            eventType: this.createEventType,
          };
        } else {
          payload = {
            action: 'join',
            meetingID: roomCode,
            userName: sanitizedName,
          };
        }

        // 3. Call MediaSFU API to create/join room. The key is stable for a
        // retry of this exact payload, so a lost response cannot create a
        // second room. A changed payload receives a new key.
        const payloadBody = JSON.stringify(payload);
        const idempotencyKey = this.getRoomRequestIdempotencyKey(payloadBody);
        const roomRes = await fetch(`${apiUrl}/v1/rooms/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiUserName}:${apiKey}`,
            'Idempotency-Key': idempotencyKey,
          },
          body: payloadBody,
        });

        if (!roomRes.ok) {
          const err = await roomRes.json().catch(() => ({}));
          if (roomRes.status >= 400 && roomRes.status < 500) {
            this.clearRoomRequestIdempotencyKey(payloadBody);
          }
          throw createWidgetError('NETWORK_ERROR', err.error || `Failed to ${isCreateAction ? 'create' : 'join'} room`);
        }

        const roomData = await roomRes.json();
        const publicURL = roomData.publicURL;

        if (!publicURL) {
          throw createWidgetError('UNKNOWN_ERROR', 'No public URL returned from server');
        }

        this.clearRoomRequestIdempotencyKey(payloadBody);

        // 4. Open the full MediaSFU meeting room
        this.navigateToMeeting(publicURL, pendingTab);

        // Emit event with meeting info
        dispatchWidgetEvent(this, 'meeting-start', {
          ...joinPayload,
          publicURL,
          meetingID: roomData.meetingID || roomData.roomName || '',
        });

      }
      // Custom widget-room mode was removed — only prebuilt is supported.

      // Only reset to form if we opened a new tab.
      // In iframe mode the meeting is rendered inline — don't overwrite it.
      if (this.redirectMode !== 'iframe') {
        this.setState('form');
      }

    } catch (error) {
      this.showError(error as WidgetError);
    }
  }

  private getRoomRequestIdempotencyKey(fingerprint: string): string {
    if (this.roomRequestIdempotency?.fingerprint === fingerprint) {
      return this.roomRequestIdempotency.key;
    }

    const randomPart = typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 18)}`;
    const key = `widget-room-${randomPart}`.slice(0, 128);
    this.roomRequestIdempotency = { fingerprint, key };
    return key;
  }

  private clearRoomRequestIdempotencyKey(fingerprint: string): void {
    if (this.roomRequestIdempotency?.fingerprint === fingerprint) {
      this.roomRequestIdempotency = null;
    }
  }

  /**
   * Navigate to the meeting URL.
   * In 'new-tab' mode (default) uses the pre-opened tab (pendingTab) to avoid
   * iOS/Safari pop-up blockers — the tab was opened synchronously on user click.
   * In 'iframe' mode embeds the meeting inline within the widget's shadow DOM
   * at near-full viewport size so the user stays on their page.
   */
  private navigateToMeeting(url: string, pendingTab?: Window | null): void {
    if (this.redirectMode === 'iframe') {
      // Replace the widget content with a full-size iframe
      this.shadow.innerHTML = `
        <style>
          :host {
            display: block;
            width: 100%;
            height: 100%;
            min-height: 90vh;
          }
          .meeting-iframe-wrapper {
            position: relative;
            width: 100%;
            height: 100%;
            min-height: 90vh;
            border-radius: 8px;
            overflow: hidden;
            background: #0f172a;
          }
          .meeting-iframe-wrapper iframe {
            width: 100%;
            height: 100%;
            min-height: 90vh;
            border: none;
          }
          .meeting-iframe-exit {
            position: absolute;
            top: 8px;
            right: 8px;
            z-index: 100;
            background: rgba(0,0,0,0.6);
            color: #fff;
            border: none;
            border-radius: 6px;
            padding: 6px 14px;
            font-size: 13px;
            cursor: pointer;
            font-family: inherit;
            backdrop-filter: blur(4px);
          }
          .meeting-iframe-exit:hover {
            background: rgba(239,68,68,0.8);
          }
        </style>
        <div class="meeting-iframe-wrapper">
          <button class="meeting-iframe-exit" id="exit-meeting">${renderIcon('close')} Leave</button>
          <iframe
            src="${url}"
            allow="camera; microphone; autoplay; display-capture; clipboard-write; fullscreen"
            allowfullscreen
          ></iframe>
        </div>
      `;
      // Wire up exit button to restore the form
      const exitBtn = this.shadow.getElementById('exit-meeting');
      exitBtn?.addEventListener('click', () => {
        this.setState('form');
        dispatchWidgetEvent(this, 'meeting-end', {});
      });
    } else {
      // Navigate the pre-opened tab to the meeting URL
      if (pendingTab && !pendingTab.closed) {
        pendingTab.location.href = url;
      } else {
        // Fallback: try opening directly (may be blocked on iOS)
        window.open(url, '_blank');
      }
    }
  }

  private setState(state: MeetingJoinState): void {
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

  private validateForm(): boolean {
    // --- Name validation (2–10 alphanumeric characters) ---
    if (this.requireName) {
      const name = this.formName.trim();
      if (!name) {
        this.showError(createWidgetError('UNKNOWN_ERROR', 'Name is required'));
        return false;
      }
      if (name.length < 2 || name.length > 10) {
        this.showError(createWidgetError('UNKNOWN_ERROR', 'Name must be 2–10 characters'));
        return false;
      }
      if (!/^[a-zA-Z0-9]+$/.test(name)) {
        this.showError(createWidgetError('UNKNOWN_ERROR', 'Name must be alphanumeric (A–Z, 0–9)'));
        return false;
      }
    }

    if (this.requireEmail && !this.formEmail.trim()) {
      this.showError(createWidgetError('UNKNOWN_ERROR', 'Email is required'));
      return false;
    }

    // --- Room code validation only for JOIN mode ---
    if (this.activeTab === 'join') {
      const roomCode = this.formRoomCode.trim();
      if (!roomCode) {
        this.showError(createWidgetError('UNKNOWN_ERROR', 'Room code is required'));
        return false;
      }
      if (!/^[a-zA-Z0-9]+$/.test(roomCode)) {
        this.showError(createWidgetError('UNKNOWN_ERROR', 'Room code must be alphanumeric (A–Z, 0–9)'));
        return false;
      }
      if (roomCode.length > 32) {
        this.showError(createWidgetError('UNKNOWN_ERROR', 'Room code must be 32 characters or fewer'));
        return false;
      }
      if (!/^[dspDSP]/.test(roomCode)) {
        this.showError(createWidgetError('UNKNOWN_ERROR', 'Room code must start with d, s, or p'));
        return false;
      }
    }

    return true;
  }

  private handleSubmit(): void {
    if (!this.validateForm()) return;

    if (this.showPreview) {
      this.startPreview();
    } else {
      this.joinMeeting();
    }
  }

  private render(): void {
    const resolvedTheme = this.resolveTheme();

    this.shadow.innerHTML = `
      <style>${meetingJoinStyles}${this.customCss ? `\n${this.customCss}` : ''}</style>
      <div class="mediasfu-meeting-join ${resolvedTheme} ${this.customCssClass}" data-state="${this.state}">
        ${this.renderContent()}
      </div>
    `;

    this.attachEventListeners();
  }

  private renderContent(): string {
    switch (this.state) {
      case 'form':
        return this.renderForm();
      case 'preview':
        return this.renderPreview();
      case 'joining':
        return this.renderJoining();
      case 'error':
        return this.renderError();
      default:
        return this.renderForm();
    }
  }

  private renderForm(): string {
    const showTabs = this.mode === 'both';
    const isJoin = this.activeTab === 'join';
    const isCreate = this.activeTab === 'create';

    // When code is required and not yet verified (or locked out), show only the code gate
    const codeGateActive = isCreate && this.createCodeRequired && !this.createCodeValidated;

    return `
      <div class="join-form">
        <h2 class="form-title">${this.escapeHtml(this.getOverrideText(['title'], isCreate ? 'Create Meeting' : 'Join Meeting'))}</h2>

        ${showTabs ? `
          <div class="tab-bar" role="tablist" aria-label="Meeting action">
            <button type="button" role="tab" aria-selected="${isJoin}" class="tab-btn ${isJoin ? 'tab-btn--active' : ''}" data-tab="join">${this.escapeHtml(this.getOverrideText(['muteToggle'], 'Join'))}</button>
            <button type="button" role="tab" aria-selected="${isCreate}" class="tab-btn ${isCreate ? 'tab-btn--active' : ''}" data-tab="create">${this.escapeHtml(this.getOverrideText(['videoToggle'], 'Create'))}</button>
          </div>
        ` : ''}

        ${!codeGateActive && this.requireName ? `
          <div class="form-group">
            <label for="name">${this.escapeHtml(this.getOverrideText(['nameLabel'], 'Your Name'))}</label>
            <input type="text" id="name" class="form-input"
                   placeholder="e.g. John1 (2–10 chars, A-Z 0-9)"
                   maxlength="10"
                   value="${this.formName}"
                   data-input="name" />
            <small style="font-size:11px;color:#9ca3af;margin-top:2px;display:block">2–10 alphanumeric characters</small>
          </div>
        ` : ''}

        ${!codeGateActive && this.requireEmail ? `
          <div class="form-group">
            <label for="email">${this.escapeHtml(this.getOverrideText(['emailLabel'], 'Email'))}</label>
            <input type="email" id="email" class="form-input"
                   placeholder="Enter your email"
                   value="${this.formEmail}"
                   data-input="email" />
          </div>
        ` : ''}

        ${isJoin ? this.renderJoinFields() : this.renderCreateFields()}

        ${!codeGateActive ? `
          <button type="button" class="join-btn" data-action="submit">
            ${this.escapeHtml(this.getOverrideText(['joinButton'], this.showPreview ? 'Next: Preview' : (isCreate ? 'Create Meeting' : 'Join Meeting')))}
          </button>
        ` : ''}

        ${isCreate && !codeGateActive ? `
          <p class="mode-hint">
            ${renderIcon('rocket')} <strong>Prebuilt mode</strong> — room opens with full MediaSFU meeting UI (video, chat, screen share, moderation).
          </p>
        ` : (!codeGateActive ? `
          <p class="mode-hint">
            Enter the room code shared with you to join an existing meeting.
          </p>
        ` : '')}
      </div>
    `;
  }

  /** Fields for the Join tab */
  private renderJoinFields(): string {
    return `
      <div class="form-group">
        <label for="room-code">${this.escapeHtml(this.getOverrideText(['meetingId'], 'Room Code'))}</label>
        <div class="room-input-wrapper">
          ${this.roomPrefix ? `<span class="room-prefix">${this.roomPrefix}</span>` : ''}
          <input type="text" id="room-code" class="form-input"
                 placeholder="e.g. d1234abc (starts with d/s/p)"
                 maxlength="32"
                 value="${this.formRoomCode}"
                 data-input="room-code" />
        </div>
        <small style="font-size:11px;color:#9ca3af;margin-top:2px;display:block">Max 32 chars · starts with d, s, or p · alphanumeric only</small>
      </div>
    `;
  }

  /** Fields for the Create tab */
  private renderCreateFields(): string {
    // ── Lockout state ──
    if (this.createCodeRequired && this.createCodeLocked) {
      return `
        <div class="code-gate">
          <div class="code-gate-icon">${renderIcon('lock', { size: 24 })}</div>
          <p class="code-gate-msg">Too many failed attempts.<br>Please try again in 10 minutes.</p>
        </div>
      `;
    }

    // ── Code gate (not yet verified) ──
    if (this.createCodeRequired && !this.createCodeValidated) {
      const attemptsLeft = 3 - this.createCodeAttempts;
      return `
        <div class="code-gate">
          <div class="code-gate-icon">${renderIcon('lock', { size: 24 })}</div>
          <div class="form-group">
            <label for="create-code">Authorization Code</label>
            <input type="password" id="create-code" class="form-input"
              data-input="create-code"
              placeholder="Enter code to unlock room creation"
              autocomplete="off"
              ${this.verifyingCode ? 'disabled' : ''} />
            <span class="field-hint">${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} remaining</span>
          </div>
          <button type="button" class="join-btn" data-action="verify-code" ${this.verifyingCode ? 'disabled' : ''}>
            ${this.verifyingCode ? 'Verifying…' : `${renderIcon('unlock')} Verify Code`}
          </button>
        </div>
      `;
    }

    // ── Verified / no code needed ── show full create form
    return `
      ${this.createCodeRequired && this.createCodeValidated ? `<p class="code-verified">${renderIcon('check')} Code verified — create your room below.</p>` : ''}
      <div class="create-settings">
        <div class="form-group">
          <label for="duration">Duration</label>
          <select id="duration" class="form-input" data-input="duration">
            <option value="15" ${this.createDuration === 15 ? 'selected' : ''}>15 minutes</option>
            <option value="30" ${this.createDuration === 30 ? 'selected' : ''}>30 minutes</option>
            <option value="60" ${this.createDuration === 60 ? 'selected' : ''}>1 hour</option>
            <option value="120" ${this.createDuration === 120 ? 'selected' : ''}>2 hours</option>
          </select>
        </div>
        <div class="form-row">
          <div class="form-group form-group--half">
            <label for="capacity">Capacity</label>
            <select id="capacity" class="form-input" data-input="capacity">
              <option value="2" ${this.createCapacity === 2 ? 'selected' : ''}>2</option>
              <option value="5" ${this.createCapacity === 5 ? 'selected' : ''}>5</option>
              <option value="10" ${this.createCapacity === 10 ? 'selected' : ''}>10</option>
              <option value="25" ${this.createCapacity === 25 ? 'selected' : ''}>25</option>
              <option value="50" ${this.createCapacity === 50 ? 'selected' : ''}>50</option>
            </select>
          </div>
          <div class="form-group form-group--half">
            <label for="event-type">Room Type</label>
            <select id="event-type" class="form-input" data-input="event-type">
              <option value="conference" ${this.createEventType === 'conference' ? 'selected' : ''}>Conference</option>
              <option value="webinar" ${this.createEventType === 'webinar' ? 'selected' : ''}>Webinar</option>
              <option value="broadcast" ${this.createEventType === 'broadcast' ? 'selected' : ''}>Broadcast</option>
            </select>
          </div>
        </div>
      </div>
    `;
  }

  private renderPreview(): string {
    const videoOnIcon = this.getOverrideGlyph(['cameraToggleButton', 'videoToggle'], 'video');
    const videoOffIcon = this.getOverrideGlyph(['cameraToggleButton', 'videoToggle'], 'videoOff');
    const audioOnIcon = this.getOverrideGlyph(['micToggleButton', 'muteToggle'], 'mic');
    const audioOffIcon = this.getOverrideGlyph(['micToggleButton', 'muteToggle'], 'micOff');
    const videoIcon = this.isVideoEnabled ? videoOnIcon : videoOffIcon;
    const audioIcon = this.isAudioEnabled ? audioOnIcon : audioOffIcon;
    const previewHeaderIcon = this.getOverrideGlyph(['preview', 'headerIcon'], 'video');
    const cameraLabelIcon = this.getOverrideGlyph(['cameraSelect', 'cameraToggleButton'], 'video');
    const micLabelIcon = this.getOverrideGlyph(['micSelect', 'micToggleButton'], 'mic');
    const micTestIcon = this.getOverrideGlyph(['micToggleButton'], 'mic');
    const joinActionIcon = this.getOverrideGlyph(['joinButton'], 'rocket');
    // Sanitize form values for safe HTML interpolation
    const safeName = this.escapeHtml(this.formName) || 'Anonymous';
    const safePrefix = this.escapeHtml(this.roomPrefix);
    const safeRoomCode = this.escapeHtml(this.formRoomCode);

    return `
      <div class="preview-container">
        <h3 class="preview-title">${this.escapeHtml(previewHeaderIcon)} ${this.escapeHtml(this.getOverrideText(['title'], 'Media Preview'))}</h3>

        <div class="video-preview">
          <video class="preview-video" autoplay muted playsinline style="display:none"></video>
          <div class="preview-placeholder">
            <span class="placeholder-spinner"></span>
            <span>Starting camera…</span>
          </div>
        </div>

        <!-- Device selectors -->
        <div class="device-selectors">
          <div class="device-group">
            <label>${this.escapeHtml(cameraLabelIcon)} Camera</label>
            <select data-select="camera" class="device-select">
              <option value="">Default Camera</option>
            </select>
          </div>
          <div class="device-group">
            <label>${this.escapeHtml(micLabelIcon)} Mic</label>
            <select data-select="mic" class="device-select">
              <option value="">Default Microphone</option>
            </select>
          </div>
        </div>

        <!-- Mic level meter -->
        <div class="mic-level-container">
          <label>${this.escapeHtml(micLabelIcon)} Mic Level</label>
          <div class="mic-level-track">
            <div class="mic-level-fill"></div>
          </div>
        </div>

        <!-- Mic test button -->
        <button type="button" class="mic-test-btn" data-action="mic-test">${this.escapeHtml(micTestIcon)} Test Microphone</button>

        <div class="preview-info">
          <p><strong>Name:</strong> ${safeName}</p>
          ${this.activeTab === 'join' ? `
            <p><strong>Room:</strong> ${safePrefix}${safeRoomCode}</p>
          ` : `
            <p><strong>Action:</strong> Create new room</p>
            <p><strong>Duration:</strong> ${this.createDuration} min · <strong>Capacity:</strong> ${this.createCapacity} · <strong>Type:</strong> ${this.createEventType}</p>
          `}
        </div>

        <div class="preview-controls">
          <button type="button" class="control-btn ${!this.isVideoEnabled ? 'muted' : ''}" data-action="toggle-video" aria-pressed="${this.isVideoEnabled}" aria-label="Toggle camera" title="Toggle Video">
            ${videoIcon}
          </button>
          <button type="button" class="control-btn ${!this.isAudioEnabled ? 'muted' : ''}" data-action="toggle-audio" aria-pressed="${this.isAudioEnabled}" aria-label="Toggle microphone" title="Toggle Audio">
            ${audioIcon}
          </button>
        </div>

        <div class="preview-actions">
          <button type="button" class="back-btn" data-action="back">${this.escapeHtml(this.getOverrideText(['cancelButton'], 'Back'))}</button>
          <button type="button" class="join-btn" data-action="join">${this.escapeHtml(this.getOverrideText(['joinButton'], this.activeTab === 'create' ? `Create & Join ${joinActionIcon}` : `Join Meeting ${joinActionIcon}`))}</button>
        </div>
      </div>
    `;
  }

  private renderJoining(): string {
    const isCreate = this.activeTab === 'create';
    return `
      <div class="joining-container" role="status" aria-live="polite">
        <div class="spinner" aria-hidden="true"></div>
        <p>${this.escapeHtml(this.getOverrideText(['status'], isCreate ? 'Creating meeting…' : 'Joining meeting…'))}</p>
      </div>
    `;
  }

  private renderError(): string {
    return `
      <div class="error-container" role="alert">
        <span class="error-icon" aria-hidden="true">${(this.getOverrideGlyph(['status', 'headerIcon'], 'warning'))}</span>
        <p class="error-message">${this.escapeHtml(this.errorMessage || this.getOverrideText(['status'], 'Unable to join meeting right now.'))}</p>
        <button type="button" class="join-btn secondary" data-action="retry">${this.escapeHtml(this.getOverrideText(['joinButton'], 'Try Again'))}</button>
      </div>
    `;
  }

  private attachEventListeners(): void {
    // Form inputs
    this.shadow.querySelector('[data-input="name"]')?.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      input.value = input.value.replace(/[^a-zA-Z0-9]/g, '');
      this.formName = input.value;
    });
    this.shadow.querySelector('[data-input="email"]')?.addEventListener('input', (e) => {
      this.formEmail = (e.target as HTMLInputElement).value;
    });
    this.shadow.querySelector('[data-input="room-code"]')?.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      input.value = input.value.replace(/[^a-zA-Z0-9]/g, '');
      this.formRoomCode = input.value;
    });

    // Create-mode inputs
    this.shadow.querySelector('[data-input="duration"]')?.addEventListener('change', (e) => {
      this.createDuration = parseInt((e.target as HTMLSelectElement).value, 10);
    });
    this.shadow.querySelector('[data-input="capacity"]')?.addEventListener('change', (e) => {
      this.createCapacity = parseInt((e.target as HTMLSelectElement).value, 10);
    });
    this.shadow.querySelector('[data-input="event-type"]')?.addEventListener('change', (e) => {
      this.createEventType = (e.target as HTMLSelectElement).value;
    });

    // Tab switching
    this.shadow.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = (btn as HTMLElement).dataset.tab as ActiveTab;
        this.render();
      });
    });

    // Buttons
    this.shadow.querySelector('[data-action="submit"]')?.addEventListener('click', () => this.handleSubmit());
    this.shadow.querySelector('[data-action="back"]')?.addEventListener('click', () => {
      this.stopPreview();
      this.setState('form');
    });
    this.shadow.querySelector('[data-action="join"]')?.addEventListener('click', () => this.joinMeeting());
    this.shadow.querySelector('[data-action="retry"]')?.addEventListener('click', () => {
      this.errorMessage = null;
      this.setState('form');
    });

    // Verify code button (Create tab gate)
    this.shadow.querySelector('[data-action="verify-code"]')?.addEventListener('click', () => this.verifyCreateCode());
    // Enter key on create-code input
    this.shadow.querySelector('[data-input="create-code"]')?.addEventListener('keypress', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') this.verifyCreateCode();
    });

    // Enter key on room code
    this.shadow.querySelector('[data-input="room-code"]')?.addEventListener('keypress', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') this.handleSubmit();
    });

    // Preview toggles — update DOM in-place to avoid destroying the video stream
    this.shadow.querySelector('[data-action="toggle-video"]')?.addEventListener('click', () => {
      this.isVideoEnabled = !this.isVideoEnabled;
      if (this.videoStream) {
        this.videoStream.getVideoTracks().forEach(t => { t.enabled = this.isVideoEnabled; });
      }
      this.setCookie('msfu_videoEnabled', String(this.isVideoEnabled), 30);
      const btn = this.shadow.querySelector('[data-action="toggle-video"]') as HTMLElement;
      if (btn) {
        btn.textContent = this.isVideoEnabled
          ? this.getOverrideGlyph(['cameraToggleButton', 'videoToggle'], 'video')
          : this.getOverrideGlyph(['cameraToggleButton', 'videoToggle'], 'videoOff');
        btn.classList.toggle('muted', !this.isVideoEnabled);
      }
      // Show/hide placeholder based on video state
      const placeholder = this.shadow.querySelector('.preview-placeholder') as HTMLElement;
      if (placeholder) {
        if (this.isVideoEnabled && this.mediaInitialised) {
          placeholder.style.display = 'none';
        } else {
          placeholder.style.display = 'flex';
          const spans = placeholder.querySelectorAll('span');
          if (spans.length > 1) spans[1].textContent = this.mediaInitialised ? 'Camera off' : 'Click to enable camera';
        }
      }
    });
    this.shadow.querySelector('[data-action="toggle-audio"]')?.addEventListener('click', () => {
      this.isAudioEnabled = !this.isAudioEnabled;
      if (this.videoStream) {
        this.videoStream.getAudioTracks().forEach(t => { t.enabled = this.isAudioEnabled; });
      }
      this.setCookie('msfu_audioEnabled', String(this.isAudioEnabled), 30);
      const btn = this.shadow.querySelector('[data-action="toggle-audio"]') as HTMLElement;
      if (btn) {
        btn.textContent = this.isAudioEnabled
          ? this.getOverrideGlyph(['micToggleButton', 'muteToggle'], 'mic')
          : this.getOverrideGlyph(['micToggleButton', 'muteToggle'], 'micOff');
        btn.classList.toggle('muted', !this.isAudioEnabled);
      }
    });

    // Click placeholder to retry camera if it failed
    this.shadow.querySelector('.preview-placeholder')?.addEventListener('click', () => {
      if (!this.mediaInitialised) {
        const spans = this.shadow.querySelector('.preview-placeholder')?.querySelectorAll('span');
        if (spans && spans.length > 0) spans[0].textContent = '';
        if (spans && spans.length > 1) spans[1].textContent = 'Starting camera…';
        this.initMedia();
      }
    });

    // Device selector changes
    this.shadow.querySelector('[data-select="camera"]')?.addEventListener('change', (e) => {
      this.switchCamera((e.target as HTMLSelectElement).value);
    });
    this.shadow.querySelector('[data-select="mic"]')?.addEventListener('change', (e) => {
      this.switchMic((e.target as HTMLSelectElement).value);
    });

    // Mic test
    this.shadow.querySelector('[data-action="mic-test"]')?.addEventListener('click', () => {
      this.handleMicTest();
    });
  }

  /** Escape HTML entities for safe innerHTML interpolation */
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// Register the custom element
if (typeof window !== 'undefined' && !customElements.get('mediasfu-meeting-join')) {
  customElements.define('mediasfu-meeting-join', MediaSFUMeetingJoin);
}
