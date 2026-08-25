/**
 * MediaSFU Widget Building Blocks
 *
 * These are composable React components that reflect the actual
 * MediaSFU socket-based architecture. All blocks work with
 * sourceParameters - the central state object from mediasfu-reactjs.
 *
 * Core Concepts:
 * 1. ConnectionBlock wraps MediasfuGeneric in headless mode (0x0)
 * 2. All other blocks consume sourceParameters for state
 * 3. Blocks call SDK methods (clickAudio, clickVideo, confirmExit, etc.)
 * 4. Theming via CSS custom properties (--msfu-*)
 *
 * Usage:
 * ```tsx
 * import {
 *   ConnectionBlock,
 *   AudioControlsBlock,
 *   VideoControlsBlock,
 *   ParticipantsBlock,
 *   DisconnectBlock
 * } from '@mediasfu/widgets/blocks';
 *
 * function MyWidget() {
 *   return (
 *     <ConnectionBlock
 *       action="create"
 *       userName="visitor"
 *       duration={30}
 *       onConnected={(params) => console.log('Connected!')}
 *     >
 *       {({ sourceParameters, isConnected }) => (
 *         <div>
 *           <AudioControlsBlock sourceParameters={sourceParameters} />
 *           <ParticipantsBlock sourceParameters={sourceParameters} />
 *           <DisconnectBlock sourceParameters={sourceParameters} />
 *         </div>
 *       )}
 *     </ConnectionBlock>
 *   );
 * }
 * ```
 */

// Connection & Room Management
export { ConnectionBlock } from './ConnectionBlock';
export type { ConnectionBlockProps, ConnectionBlockChildProps } from './ConnectionBlock';

// Media Controls
export { AudioControlsBlock } from './AudioControlsBlock';
export { VideoControlsBlock } from './VideoControlsBlock';

// Participants & Display
export { ParticipantsBlock } from './ParticipantsBlock';
export { AudioGridBlock } from './AudioGridBlock';

// Call Controls (VoIP/SIP)
export { CallControlsBlock } from './CallControlsBlock';

// AI Agent
export { AIAgentBlock } from './AIAgentBlock';

// Disconnect
export { DisconnectBlock } from './DisconnectBlock';

// Re-export types
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
  BlockEvent
} from '../types/building-blocks';
