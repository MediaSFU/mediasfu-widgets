/**
 * Building Blocks Type Definitions
 *
 * Types for MediaSFU widget building blocks, aligned with
 * the actual SDK architecture from mediasfu-reactjs.
 *
 * Based on patterns from:
 * - voipsrc/src/types/call.types.ts
 * - voipsrc/src/types/api.types.ts
 * - mediasfu-reactjs sourceParameters structure
 */

// ============================================
// Core Source Parameters Types
// ============================================

/**
 * Participant in a MediaSFU room
 */
export interface Participant {
  id: string;
  name: string;
  islevel: string;
  audioID?: string;
  videoID?: string;
  socketId?: string;
  muted?: boolean;
  isBanned?: boolean;
  isSuspended?: boolean;
  audioOn?: boolean;
  videoOn?: boolean;
}

/**
 * Audio-only stream reference
 */
export interface AudioOnlyStream {
  id: string;
  name: string;
  producerId?: string;
}

/**
 * Consumer stream for media playback
 */
export interface ConsumerStream {
  id: string;
  producerId: string;
  consumer: any; // mediasoup consumer
  stream: MediaStream;
}

/**
 * Central sourceParameters object
 *
 * This is the single source of truth for room state.
 * Updated by MediasfuGeneric SDK methods.
 */
export interface SourceParameters {
  // Connection State
  socket?: any;
  localSocket?: any;
  roomName: string;
  member: string;
  islevel: string;

  // Media State
  audioAlreadyOn: boolean;
  videoAlreadyOn: boolean;
  screenAlreadyOn?: boolean;

  // Participants
  participants: Participant[];
  filteredParticipants?: Participant[];

  // Audio Streams
  audioOnlyStreams: AudioOnlyStream[];
  allAudioStreams?: any[];

  // Audio Levels
  audioLevel?: number;
  participantsAudioLevels?: Map<string, number>;

  // Alerts & Status
  alertMessage?: string;
  validated?: boolean;

  // UI State
  isMediaSettingsModalVisible?: boolean;
  isParticipantsModalVisible?: boolean;

  // Recording
  recordingState?: 'idle' | 'recording' | 'paused';

  // Streams
  localStream?: MediaStream;
  remoteStreams?: ConsumerStream[];

  // Method to get fresh params
  getUpdatedAllParams: () => SourceParameters;

  // Any additional dynamic properties
  [key: string]: any;
}

// ============================================
// Room Options Types
// ============================================

/**
 * Options for creating a new MediaSFU room
 */
export interface CreateRoomOptions {
  action: 'create';
  duration: number;
  capacity: number;
  userName: string;
  eventType?: 'conference' | 'broadcast' | 'webinar' | 'chat';
  recordOnly?: boolean;
  dataBuffer?: boolean;
  bufferType?: 'all' | 'audio';
  supportSIP?: boolean;
  directionSIP?: 'both' | 'inbound' | 'outbound';
}

/**
 * Options for joining an existing MediaSFU room
 */
export interface JoinRoomOptions {
  action: 'join';
  userName: string;
  meetingID: string;
}

// ============================================
// Credentials & Authentication
// ============================================

/**
 * MediaSFU API credentials
 */
export interface MediaSFUCredentials {
  apiKey: string;
  apiUserName: string;
}

/**
 * Widget authentication token (from dashboard)
 */
export interface WidgetCredentials {
  widgetKey: string;
  domain?: string;
}

// ============================================
// Disconnection Types
// ============================================

/**
 * Reason for room disconnection
 */
export interface DisconnectReason {
  type:
    | 'user'           // User clicked disconnect
    | 'host'           // Host ended the meeting
    | 'room-ended'     // Room duration expired
    | 'banned'         // User was banned
    | 'socket-error'   // Socket connection lost
    | 'error';         // General error
  details?: string;
}

// ============================================
// VoIP / SIP Call Types
// ============================================

/**
 * Call status for SIP/VoIP calls
 */
export type CallStatus =
  | 'idle'
  | 'ringing'
  | 'connecting'
  | 'active'
  | 'on-hold'
  | 'ended'
  | 'failed'
  | 'transferring'
  | 'transferred';

/**
 * Call direction
 */
export type CallDirection = 'inbound' | 'outbound';

/**
 * SIP/VoIP Call information
 */
export interface Call {
  sipCallId?: string;
  status: CallStatus;
  direction: CallDirection;
  roomName?: string;
  callerIdRaw?: string;
  calledUri?: string;
  activeMediaSource?: string;
  humanParticipantName?: string;
  startTime?: Date;
  endTime?: Date;
}

// ============================================
// AI Agent Types
// ============================================

/**
 * STT (Speech-to-Text) service configuration
 */
export interface STTConfig {
  sttNickName: 'google' | 'deepgram' | 'whisper' | 'azure';
  apiKey?: string;
  language?: string;
  model?: string;
}

/**
 * LLM (Language Model) service configuration
 */
export interface LLMConfig {
  llmNickName: 'openai' | 'anthropic' | 'azure' | 'gemini' | 'groq' | 'together';
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * TTS (Text-to-Speech) service configuration
 */
export interface TTSConfig {
  ttsNickName: 'google' | 'elevenlabs' | 'azure' | 'playht' | 'openai';
  apiKey?: string;
  voice?: string;
  language?: string;
}

/**
 * Complete AI Agent pipeline configuration
 */
export interface AIAgentConfig {
  mode: 'voice' | 'vision' | 'multimodal';
  audio: STTConfig;
  llm: LLMConfig;
  tts: TTSConfig;
  visionInterval?: number;
  silenceThreshold?: number;
  maxSpeakingDuration?: number;
}

// ============================================
// Block Props Types
// ============================================

/**
 * Base props for all building blocks
 */
export interface BaseBlockProps {
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}

/**
 * Props for blocks that need sourceParameters
 */
export interface SourceParametersBlockProps extends BaseBlockProps {
  sourceParameters: SourceParameters;
  updateSourceParameters?: (params: Partial<SourceParameters>) => void;
}

/**
 * Audio controls block props
 */
export interface AudioControlsBlockProps extends SourceParametersBlockProps {
  showMuteButton?: boolean;
  showDeviceSelect?: boolean;
  showVolumeSlider?: boolean;
  onMuteToggle?: (muted: boolean) => void;
  onDeviceChange?: (deviceId: string) => void;
}

/**
 * Video controls block props
 */
export interface VideoControlsBlockProps extends SourceParametersBlockProps {
  showVideoToggle?: boolean;
  showDeviceSelect?: boolean;
  showPreview?: boolean;
  onVideoToggle?: (enabled: boolean) => void;
  onDeviceChange?: (deviceId: string) => void;
}

/**
 * Participants block props
 */
export interface ParticipantsBlockProps extends SourceParametersBlockProps {
  showAvatars?: boolean;
  showAudioLevels?: boolean;
  maxVisible?: number;
  onParticipantClick?: (participant: Participant) => void;
}

/**
 * Call controls block props (for VoIP)
 */
export interface CallControlsBlockProps extends SourceParametersBlockProps {
  call?: Call;
  showHold?: boolean;
  showTransfer?: boolean;
  showMute?: boolean;
  showEnd?: boolean;
  onHold?: () => void;
  onTransfer?: (target: string) => void;
  onEnd?: () => void;
}

/**
 * AI Agent block props
 */
export interface AIAgentBlockProps extends SourceParametersBlockProps {
  agentConfig: AIAgentConfig;
  onAgentResponse?: (response: string) => void;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onStateChange?: (state: 'idle' | 'listening' | 'processing' | 'speaking') => void;
}

/**
 * Audio grid block props
 */
export interface AudioGridBlockProps extends SourceParametersBlockProps {
  showLabels?: boolean;
  showAudioLevels?: boolean;
  layout?: 'grid' | 'list';
}

/**
 * Disconnect block props
 */
export interface DisconnectBlockProps extends SourceParametersBlockProps {
  confirmationRequired?: boolean;
  confirmationMessage?: string;
  onBeforeDisconnect?: () => boolean | Promise<boolean>;
  onDisconnected?: (reason: DisconnectReason) => void;
}

// ============================================
// Theme Types
// ============================================

/**
 * Theme configuration for widgets
 */
export interface WidgetTheme {
  // Colors
  colorPrimary?: string;
  colorSecondary?: string;
  colorBackground?: string;
  colorSurface?: string;
  colorText?: string;
  colorTextMuted?: string;
  colorSuccess?: string;
  colorError?: string;
  colorWarning?: string;

  // Typography
  fontFamily?: string;
  fontSizeSmall?: string;
  fontSizeBase?: string;
  fontSizeLarge?: string;

  // Spacing
  spacingXs?: string;
  spacingSm?: string;
  spacingMd?: string;
  spacingLg?: string;
  spacingXl?: string;

  // Borders
  borderRadius?: string;
  borderRadiusLarge?: string;
  borderWidth?: string;

  // Shadows
  shadowSm?: string;
  shadowMd?: string;
  shadowLg?: string;
}

// ============================================
// Event Types
// ============================================

/**
 * Events emitted by blocks
 */
export type BlockEvent =
  | { type: 'connected'; params: SourceParameters }
  | { type: 'disconnected'; reason: DisconnectReason }
  | { type: 'audio-toggle'; muted: boolean }
  | { type: 'video-toggle'; enabled: boolean }
  | { type: 'participant-join'; participant: Participant }
  | { type: 'participant-leave'; participant: Participant }
  | { type: 'agent-response'; text: string }
  | { type: 'call-status-change'; call: Call }
  | { type: 'error'; error: Error };
