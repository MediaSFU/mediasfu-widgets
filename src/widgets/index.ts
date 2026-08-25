/**
 * MediaSFU Pre-Composed Widgets
 *
 * Ready-to-use widgets that combine building blocks into
 * complete, functional UI components.
 *
 * These widgets handle common use cases and can be customized
 * via props and CSS custom properties.
 */

// Click-to-Call Widget
export { ClickToCallWidget } from './ClickToCallWidget';
export type { ClickToCallWidgetProps } from './ClickToCallWidget';

// Meeting Join Widget
export { MeetingJoinWidget } from './MeetingJoinWidget';
export type { MeetingJoinWidgetProps } from './MeetingJoinWidget';

// Semantic headless-controller consumer
export { HeadlessMeetingJoinWidget, resolveHeadlessMeetingID } from './HeadlessMeetingJoinWidget';
export type { HeadlessMeetingJoinWidgetProps } from './HeadlessMeetingJoinWidget';

// Opt-in branded bridge to the semantic controller; legacy remains the default.
export { BrandedMeetingJoinAdapter, mapBrandedMeetingJoinToSemantic } from './BrandedMeetingJoinAdapter';
export type { BrandedMeetingJoinAdapterProps, BrandedSemanticMeetingJoinProps, MeetingJoinRenderer } from './BrandedMeetingJoinAdapter';

// Re-export types for convenience
export type {
  SourceParameters,
  Participant,
  MediaSFUCredentials,
  DisconnectReason,
  AIAgentConfig,
  Call,
  CallStatus
} from '../types/building-blocks';
