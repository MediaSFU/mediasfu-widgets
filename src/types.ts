/**
 * MediaSFU Widget Types
 */

// ============================================================================
// Platform Types
// ============================================================================

export type Platform =
  | 'generic'
  | 'wordpress'
  | 'shopify'
  | 'wix'
  | 'squarespace'
  | 'webflow'
  | 'react'
  | 'vue'
  | 'angular'
  | 'nextjs'
  | 'nuxt';

// ============================================================================
// Configuration Types
// ============================================================================

export interface WidgetConfig {
  widgetKey: string;
  apiUrl?: string;
  cdnUrl?: string;
  roomUrl?: string;  // URL for widget room iframe
  callsUrl?: string; // URL for widget calls iframe
  agentUrl?: string; // URL for widget agent iframe
  theme?: 'light' | 'dark' | 'auto';
  debug?: boolean;

  // Platform-specific options
  platform?: Platform;
  cacheBuster?: boolean;
  isolateStyles?: boolean;
  deferLoad?: boolean;
  enableAnalytics?: boolean;
  autoInit?: boolean;
  useCustomEvents?: boolean;

  // Callbacks
  onReady?: () => void;
  onError?: (error: WidgetError) => void;
}

export interface CallButtonConfig {
  destination: string;
  callerId?: string;
  callerEmail?: string;
  buttonText?: string;
  buttonIcon?: 'phone' | 'video' | 'headset' | 'none' | string;
  position?: 'inline' | 'bottom-right' | 'bottom-left' | 'floating';
  theme?: 'light' | 'dark' | 'auto';
  showStatus?: boolean;
  requireEmail?: boolean;
  requireName?: boolean;
  onCallStart?: (call: CallEvent) => void;
  onCallEnd?: (call: CallEvent) => void;
  onError?: (error: WidgetError) => void;
}

export interface AIAgentConfig {
  agentId?: string;
  agentName?: string;
  greeting?: string;
  mode?: 'voice' | 'text' | 'both';
  position?: 'inline' | 'bottom-right' | 'bottom-left' | 'floating';
  theme?: 'light' | 'dark' | 'auto';
  avatarUrl?: string;
  autoStart?: boolean;
  showTranscript?: boolean;
  onSessionStart?: (session: AISessionEvent) => void;
  onSessionEnd?: (session: AISessionEvent) => void;
  onMessage?: (message: AIMessage) => void;
  onError?: (error: WidgetError) => void;
}

export interface MeetingJoinConfig {
  roomPrefix?: string;
  roomCode?: string;
  theme?: 'light' | 'dark' | 'auto';
  showPreview?: boolean;
  requireName?: boolean;
  requireEmail?: boolean;
  defaultName?: string;
  defaultEmail?: string;
  onJoin?: (meeting: MeetingEvent) => void;
  onError?: (error: WidgetError) => void;
}

export interface MeetingRoomConfig {
  // Basic config
  roomName: string;
  userName?: string;
  userEmail?: string;
  userRole?: 'host' | 'participant';
  width?: string | number;
  height?: string | number;
  theme?: 'light' | 'dark' | 'auto';
  features?: MeetingFeature[];
  disabledFeatures?: MeetingFeature[];

  // Layout config
  layout?: 'auto' | 'grid' | 'focus' | 'audio-only';
  maxVisibleParticipants?: number;
  showMiniCards?: boolean;
  showVideoCards?: boolean;
  showAudioCards?: boolean;

  // Control buttons config
  controlButtons?: ControlButton[];
  menuButtons?: MenuButton[];

  // Behavior config
  autoJoin?: boolean;
  startWithVideo?: boolean;
  startWithAudio?: boolean;
  allowRecording?: boolean;
  allowScreenshare?: boolean;

  // Host controls config
  hostCanMuteAll?: boolean;
  hostCanRemove?: boolean;
  waitingRoom?: boolean;

  // Branding config
  showBranding?: boolean;
  brandingText?: string;
  brandingLogo?: string;
  primaryColor?: string;

  // Event callbacks
  onMeetingStart?: (meeting: MeetingEvent) => void;
  onMeetingEnd?: (meeting: MeetingEvent) => void;
  onParticipantJoin?: (participant: Participant) => void;
  onParticipantLeave?: (participant: Participant) => void;
  onError?: (error: WidgetError) => void;
}

export type MeetingFeature = 'video' | 'audio' | 'chat' | 'screenshare' | 'recording' | 'breakout' | 'whiteboard';

export type ControlButton = 'video' | 'audio' | 'screenshare' | 'chat' | 'participants' | 'recording' | 'settings' | 'reactions' | 'leave';

export type MenuButton = 'participants' | 'chat' | 'settings' | 'recording' | 'background' | 'polls' | 'whiteboard' | 'breakout';

// ============================================================================
// Event Types
// ============================================================================

export interface CallEvent {
  callId: string;
  destination: string;
  callerId?: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  status: 'ringing' | 'connected' | 'ended' | 'failed';
  endReason?: 'completed' | 'failed' | 'cancelled' | 'busy' | 'timeout' | 'rejected';
}

export interface MeetingEvent {
  roomId: string;
  roomName: string;
  participants: Participant[];
  startTime: Date;
  endTime?: Date;
  duration?: number;
  recordingUrl?: string;
}

export interface Participant {
  id: string;
  name: string;
  email?: string;
  role: 'host' | 'participant';
  hasVideo: boolean;
  hasAudio: boolean;
  joinedAt: Date;
}

export interface AISessionEvent {
  sessionId: string;
  agentId: string;
  agentName: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  messageCount?: number;
}

export interface AIMessage {
  id: string;
  role: 'user' | 'agent';
  type: 'text' | 'audio';
  content: string;
  timestamp: Date;
}

// ============================================================================
// Error Types
// ============================================================================

export interface WidgetError {
  code: WidgetErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type WidgetErrorCode =
  | 'INVALID_WIDGET_KEY'
  | 'DOMAIN_NOT_ALLOWED'
  | 'SESSION_EXPIRED'
  | 'RATE_LIMITED'
  | 'DESTINATION_BLOCKED'
  | 'CONCURRENT_LIMIT'
  | 'DURATION_LIMIT'
  | 'USAGE_LIMIT'
  | 'PERMISSION_DENIED'
  | 'CONNECTION_FAILED'
  | 'NETWORK_ERROR'
  | 'CALL_FAILED'
  | 'POPUP_BLOCKED'
  | 'AUTH_FAILED'
  | 'UNKNOWN_ERROR';

// ============================================================================
// API Response Types
// ============================================================================

export interface AuthResponse {
  success: boolean;
  sessionToken: string;
  expiresAt: string;
  config: WidgetServerConfig;
}

export interface WidgetServerConfig {
  theme: string;
  features: string[];
  destinations?: string[];
  iceServers: RTCIceServer[];
  limits: {
    maxCallDuration?: number;
    maxConcurrentCalls?: number;
    maxDailySessions?: number;
  };
}

export interface CallInitResponse {
  success: boolean;
  callId: string;
  signalingUrl: string;
  iceServers: RTCIceServer[];
}

export interface MeetingInitResponse {
  success: boolean;
  roomId: string;
  joinUrl: string;
  token: string;
  expiresAt: string;
}

// ============================================================================
// Internal Types
// ============================================================================

/**
 * The widget types MediaSFU ships.
 *
 * This list is the bundle's side of the contract; the product side is
 * `WIDGET_TYPES` in
 * src/components/Navigation/MainNavigation/Dashboard/widgets/widgetTypes.js,
 * which drives the widget builder and /widget-lab. Keep the two in step.
 *
 * `meeting-room` and `sip-phone` were REMOVED deliberately (Aug 2026): both are
 * commented out of the product list - sip-phone because the Calls Dashboard
 * covers full softphone functionality - yet they were still exported here, so
 * their code shipped in every bundle a customer downloaded.
 *
 * Do not add them back to make a compile error go away. If they are genuinely
 * being reinstated, restore the product list first and say so explicitly.
 */
export type WidgetType =
  | 'call-button'
  | 'click-to-call'
  | 'ai-agent'
  | 'meeting-join'
  | 'calls'
  | 'web-agent-embed'
  | 'web-agent-dashboard';

export type WidgetState = 'idle' | 'loading' | 'ready' | 'active' | 'error';

export interface WidgetInstance {
  id: string;
  type: WidgetType;
  element: HTMLElement;
  state: WidgetState;
  destroy(): void;
  on(event: string, handler: EventHandler): void;
  off(event: string, handler?: EventHandler): void;
}

export type EventHandler = (data: unknown) => void;
