import React from 'react';
import { HeadlessMeetingJoinWidget } from './HeadlessMeetingJoinWidget';
import { MeetingJoinWidget } from './MeetingJoinWidget';
import type { MediaSFUProviderProps, MediaSFUState } from '../headless/types';
import type { MeetingJoinWidgetProps } from './MeetingJoinWidget';

/**
 * The rendering boundary is deliberately opt-in. Existing integrations keep
 * using the ConnectionBlock-based widget until they select `semantic`.
 */
export type MeetingJoinRenderer = 'legacy' | 'semantic';

export interface BrandedMeetingJoinAdapterProps extends MeetingJoinWidgetProps {
  /** Defaults to legacy so existing MeetingJoinWidget behavior remains unchanged. */
  readonly renderer?: MeetingJoinRenderer;
  /**
   * Community Edition transport override. It is forwarded only when supplied;
   * Cloud integrations must use their brokered credentials instead.
   */
  readonly localLink?: MediaSFUProviderProps['localLink'];
  /** Receives semantic, serializable state only when renderer is `semantic`. */
  readonly onSemanticStateChange?: (state: MediaSFUState) => void;
}

export interface BrandedSemanticMeetingJoinProps {
  readonly roomPrefix?: string;
  readonly meetingID?: string;
  readonly userName: string;
  readonly credentials?: MediaSFUProviderProps['credentials'];
  readonly localLink?: MediaSFUProviderProps['localLink'];
  readonly onStateChange?: (state: MediaSFUState) => void;
}

/**
 * Maps only the compatibility inputs used by the semantic controller. It does
 * not pass SourceParameters, sockets, or credentials into the branded DOM.
 */
export function mapBrandedMeetingJoinToSemantic(props: BrandedMeetingJoinAdapterProps): BrandedSemanticMeetingJoinProps {
  const meetingID = typeof props.meetingID === 'string' && props.meetingID.trim() ? props.meetingID : undefined;
  const mapped: BrandedSemanticMeetingJoinProps = {
    roomPrefix: props.roomPrefix,
    meetingID,
    userName: props.userName ?? 'Guest',
    credentials: props.credentials,
    onStateChange: props.onSemanticStateChange,
  };
  return props.localLink === undefined ? mapped : { ...mapped, localLink: props.localLink };
}

type SemanticBrandStyle = React.CSSProperties & {
  '--media-sfu-primary-color'?: string;
  '--media-sfu-text-color'?: string;
  '--media-sfu-border-radius'?: string;
};

function semanticStyle(props: BrandedMeetingJoinAdapterProps): SemanticBrandStyle {
  const style: SemanticBrandStyle = { ...props.style };
  if (props.primaryColor) style['--media-sfu-primary-color'] = props.primaryColor;
  if (props.textColor) style['--media-sfu-text-color'] = props.textColor;
  if (props.borderRadius) {
    const radius = { rounded: '8px', pill: '50px', square: '0px' }[props.borderRadius];
    style['--media-sfu-border-radius'] = radius;
  }
  return style;
}

/**
 * Compatible branded entry point. `legacy` returns the existing widget
 * directly; `semantic` mounts exactly one MediaSFUProvider through
 * HeadlessMeetingJoinWidget and never renders ConnectionBlock alongside it.
 */
export function BrandedMeetingJoinAdapter(props: BrandedMeetingJoinAdapterProps): React.ReactElement {
  const { renderer = 'legacy', localLink: _localLink, onSemanticStateChange: _onSemanticStateChange, ...legacyProps } = props;
  if (renderer === 'legacy') return <MeetingJoinWidget {...legacyProps} />;

  const semanticProps = mapBrandedMeetingJoinToSemantic(props);
  const title = props.title ?? 'Join Meeting';
  const className = ['media-sfu-branded-meeting-join', props.customCssClass, props.className].filter(Boolean).join(' ');
  return (
    <section aria-label={title} className={className || undefined} data-media-sfu-renderer={'semantic'} style={semanticStyle(props)}>
      <h2>{title}</h2>
      <HeadlessMeetingJoinWidget {...semanticProps} />
    </section>
  );
}
