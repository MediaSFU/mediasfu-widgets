/**
 * MediaSFU Widgets
 * Embeddable communication widgets for any website
 *
 * @packageDocumentation
 */

// ==================================
// Core Widget Loader (Web Components)
// ==================================
export { MediaSFUWidget, init, createWidget } from './core/widget-loader';
export { authenticate, getSessionToken } from './core/auth';
export { EventEmitter } from './core/events';
export { getConfig, setConfig, getApiUrl, getRoomUrl, getCallsUrl, getAgentUrl, getWebAgentUrl, getDashboardUrl, getCdnUrl, getEnvironment } from './core/config-store';
export {
  detectEnvironment,
  getEnvironmentConfig,
  setEnvironment,
  getCurrentEnvironment,
  environments,
  type Environment,
  type EnvironmentConfig
} from './core/environments';

// ==================================
// Web Components (Custom Elements)
// ==================================
export { MediaSFUCallButton } from './components/call-button/CallButton';
export { MediaSFUAIAgent } from './components/ai-agent/AIAgent';
export { MediaSFUMeetingJoin } from './components/meeting-join/MeetingJoin';
// NOTE: meeting-room and sip-phone are intentionally NOT exported - see the
// comment on WidgetType in ./types. Exporting them puts their code in every
// bundle a customer downloads, for widgets the product does not offer.
export { MediaSFUCalls } from './components/calls-widget/CallsWidget';
export { MediaSFUWebAgent } from './components/web-agent/WebAgent';
export { MediaSFUAgentDashboard } from './components/agent-dashboard/AgentDashboard';

// ==================================
// Building Blocks (React Components)
// ==================================
// These are composable React components that follow
// MediaSFU's socket-based, sourceParameters architecture.
export {
  // Connection & Room Management
  ConnectionBlock,

  // Media Controls
  AudioControlsBlock,
  VideoControlsBlock,

  // Participants & Display
  ParticipantsBlock,
  AudioGridBlock,

  // Call Controls (VoIP/SIP)
  CallControlsBlock,

  // AI Agent
  AIAgentBlock,

  // Disconnect
  DisconnectBlock,
} from './blocks';

// ==================================
// Pre-Composed Widgets (React)
// ==================================
// Ready-to-use widgets that combine building blocks
export {
  ClickToCallWidget,
  MeetingJoinWidget,
  HeadlessMeetingJoinWidget,
  resolveHeadlessMeetingID,
  BrandedMeetingJoinAdapter,
  mapBrandedMeetingJoinToSemantic,
} from './widgets';

// ==================================
// Headless React Controller
// ==================================
// A semantic, data-only controller for composable integrations. It is
// intentionally exported alongside, not in place of, the existing widgets.
export {
  MediaSFUProvider,
  MediaSFUContext,
  normalizeMediaSFUState,
  useMediaSFU,
  useMediaSFUActions,
  useMediaSFUState,
} from './headless';
export type {
  ActionResult,
  ActionState,
  ActionStatus,
  DeviceKind,
  EndRoomManagementAdapter,
  MediaSFUActions,
  MediaSFUContextValue,
  MediaSFUCredentialsInput,
  MediaSFUProviderProps,
  MediaSFURole,
  MediaSFUState,
  SemanticMediaControl,
  SemanticMediaState,
  SemanticDevice,
  SemanticDeviceState,
  SemanticMessage,
  SemanticParticipant,
  SemanticPermissions,
  SemanticSession,
  SessionStatus,
} from './headless';

// ==================================
// Types
// ==================================
// Original widget config types
export type {
  WidgetConfig,
  CallButtonConfig,
  AIAgentConfig as WidgetAIAgentConfig,
  MeetingJoinConfig,
  WidgetError,
  CallEvent,
  MeetingEvent,
} from './types';

// Building block types
export type {
  // Core types
  SourceParameters,
  Participant,
  AudioOnlyStream,
  ConsumerStream,
  MediaSFUCredentials,
  WidgetCredentials,
  CreateRoomOptions,
  JoinRoomOptions,
  DisconnectReason,

  // Call types
  Call,
  CallStatus,
  CallDirection,

  // Agent types
  AIAgentConfig,
  STTConfig,
  LLMConfig,
  TTSConfig,

  // Block props
  BaseBlockProps,
  SourceParametersBlockProps,
  AudioControlsBlockProps,
  VideoControlsBlockProps,
  ParticipantsBlockProps,
  CallControlsBlockProps,
  AIAgentBlockProps,
  AudioGridBlockProps,
  DisconnectBlockProps,

  // Theme
  WidgetTheme,

  // Events
  BlockEvent,
} from './types/building-blocks';

// Widget props
export type {
  ClickToCallWidgetProps,
  MeetingJoinWidgetProps,
  HeadlessMeetingJoinWidgetProps,
  BrandedMeetingJoinAdapterProps,
  BrandedSemanticMeetingJoinProps,
  MeetingJoinRenderer,
} from './widgets';

// ==================================
// Version
// ==================================
export const VERSION = '0.1.0';

// ==================================
// Auto-initialize Web Components
// Note: autoInit is handled in widget-loader.ts when exposed to window
// This is intentionally left to the widget-loader module
// ==================================
