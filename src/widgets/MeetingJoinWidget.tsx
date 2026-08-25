/**
 * MeetingJoinWidget
 *
 * Pre-composed widget for joining an existing MediaSFU meeting.
 * Includes audio/video preview before joining with full customization.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { renderIcon } from '../core/icons';

// Building blocks
import { ConnectionBlock } from '../blocks/ConnectionBlock';
import { AudioControlsBlock } from '../blocks/AudioControlsBlock';
import { VideoControlsBlock } from '../blocks/VideoControlsBlock';
import { ParticipantsBlock } from '../blocks/ParticipantsBlock';
import { AudioGridBlock } from '../blocks/AudioGridBlock';
import { DisconnectBlock } from '../blocks/DisconnectBlock';

// Types
import type {
  SourceParameters,
  DisconnectReason,
  MediaSFUCredentials
} from '../types/building-blocks';

// Icons
const UsersIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

// Join sound URL
const JOIN_SOUND_URL = 'https://cdn.mediasfu.com/sounds/join.mp3';

export interface MeetingJoinWidgetProps {
  // ===== BASIC CONFIG =====
  /**
   * Meeting ID to join
   */
  meetingID: string;

  /**
   * User name
   */
  userName?: string;

  /**
   * Widget title
   */
  title?: string;

  /**
   * Show video preview before joining
   */
  showPreview?: boolean;

  /**
   * Require name input
   */
  requireName?: boolean;

  /**
   * Require email input
   */
  requireEmail?: boolean;

  /**
   * Allow guest access
   */
  allowGuests?: boolean;

  /**
   * Room prefix
   */
  roomPrefix?: string;

  /**
   * Show audio device selection
   */
  showAudioDeviceSelect?: boolean;

  /**
   * Show video device selection
   */
  showVideoDeviceSelect?: boolean;

  // ===== BRANDING =====
  /**
   * Primary/button background color
   */
  primaryColor?: string;

  /**
   * Button text color
   */
  textColor?: string;

  /**
   * Border radius style
   */
  borderRadius?: 'rounded' | 'pill' | 'square';

  /**
   * Button size
   */
  buttonSize?: 'small' | 'medium' | 'large';

  /**
   * Shadow style
   */
  shadowStyle?: 'none' | 'subtle' | 'medium' | 'strong';

  // ===== BEHAVIOR =====
  /**
   * Play sound when joining
   */
  playJoinSound?: boolean;

  /**
   * Show device settings panel
   */
  showDeviceSettings?: boolean;

  /**
   * Auto-join without preview
   */
  autoJoin?: boolean;

  /**
   * Start with video off
   */
  startWithVideoOff?: boolean;

  /**
   * Start with audio muted
   */
  startWithAudioOff?: boolean;

  // ===== INTEGRATIONS =====
  /**
   * Webhook URL for join/leave events
   */
  webhookUrl?: string;

  /**
   * Google Analytics ID
   */
  googleAnalyticsId?: string;

  /**
   * Custom CSS class
   */
  customCssClass?: string;

  // ===== EXISTING PROPS =====
  /**
   * MediaSFU credentials
   */
  credentials?: MediaSFUCredentials;

  /**
   * Called when joined
   */
  onJoined?: (params: SourceParameters) => void;

  /**
   * Called when left
   */
  onLeft?: (reason: DisconnectReason) => void;

  /**
   * Custom class (legacy)
   */
  className?: string;

  /**
   * Custom styles
   */
  style?: React.CSSProperties;
}

type WidgetState = 'preview' | 'joining' | 'in-meeting';

export const MeetingJoinWidget: React.FC<MeetingJoinWidgetProps> = ({
  // Basic
  meetingID,
  userName = 'Guest',
  title = 'Join Meeting',
  showPreview = true,
  requireName = true,
  requireEmail = false,
  allowGuests = true,
  roomPrefix = '',
  showAudioDeviceSelect = true,
  showVideoDeviceSelect = true,

  // Branding
  primaryColor = '#14a394',
  textColor = '#FFFFFF',
  borderRadius = 'rounded',
  buttonSize = 'medium',
  shadowStyle = 'medium',

  // Behavior
  playJoinSound = true,
  showDeviceSettings = true,
  autoJoin = false,
  startWithVideoOff = false,
  startWithAudioOff = false,

  // Integrations
  webhookUrl,
  googleAnalyticsId,
  customCssClass = '',

  // Existing
  credentials,
  onJoined,
  onLeft,
  className = '',
  style
}) => {
  const [widgetState, setWidgetState] = useState<WidgetState>(autoJoin ? 'joining' : 'preview');
  const [nameInput, setNameInput] = useState(userName);
  const [emailInput, setEmailInput] = useState('');
  const [shouldConnect, setShouldConnect] = useState(autoJoin);

  // Auto-join on mount if enabled
  useEffect(() => {
    if (autoJoin && userName) {
      setShouldConnect(true);
    }
  }, [autoJoin, userName]);

  // Google Analytics tracking
  const trackEvent = useCallback((action: string, label?: string) => {
    if (googleAnalyticsId && typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag('event', action, {
        event_category: 'MediaSFU Widget',
        event_label: label
      });
    }
  }, [googleAnalyticsId]);

  // Webhook notification
  const notifyWebhook = useCallback(async (event: string, data?: any) => {
    if (!webhookUrl) return;
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, timestamp: new Date().toISOString(), meetingID, ...data })
      });
    } catch (err) {
      console.warn('Webhook notification failed:', err);
    }
  }, [webhookUrl, meetingID]);

  // Play join sound
  const playSound = useCallback(() => {
    if (playJoinSound) {
      const audio = new Audio(JOIN_SOUND_URL);
      audio.play().catch(() => {});
    }
  }, [playJoinSound]);

  // Join meeting
  const handleJoin = useCallback(() => {
    if (requireName && !nameInput.trim()) return;
    if (requireEmail && !emailInput.trim()) return;

    setWidgetState('joining');
    setShouldConnect(true);
    trackEvent('meeting_joining', meetingID);
    notifyWebhook('meeting_joining', { userName: nameInput, email: emailInput });
  }, [nameInput, emailInput, requireName, requireEmail, meetingID, trackEvent, notifyWebhook]);

  // Connected
  const handleConnected = useCallback((params: SourceParameters) => {
    setWidgetState('in-meeting');
    playSound();
    trackEvent('meeting_joined', meetingID);
    notifyWebhook('meeting_joined', { roomName: params.roomName, userName: nameInput });
    onJoined?.(params);
  }, [onJoined, playSound, meetingID, nameInput, trackEvent, notifyWebhook]);

  // Disconnected
  const handleDisconnected = useCallback((reason: DisconnectReason) => {
    setWidgetState('preview');
    setShouldConnect(false);
    trackEvent('meeting_left', String(reason));
    notifyWebhook('meeting_left', { reason });
    onLeft?.(reason);
  }, [onLeft, trackEvent, notifyWebhook]);

  // Compute styles based on config
  const buttonStyles = useMemo(() => {
    const sizeMap = {
      small: { padding: '10px 16px', fontSize: '14px' },
      medium: { padding: '14px 24px', fontSize: '16px' },
      large: { padding: '18px 32px', fontSize: '18px' }
    };

    const radiusMap = {
      rounded: '8px',
      pill: '50px',
      square: '0px'
    };

    const shadowMap = {
      none: 'none',
      subtle: '0 2px 4px rgba(0,0,0,0.1)',
      medium: '0 4px 12px rgba(0,0,0,0.15)',
      strong: '0 8px 24px rgba(0,0,0,0.25)'
    };

    return {
      padding: sizeMap[buttonSize]?.padding || sizeMap.medium.padding,
      fontSize: sizeMap[buttonSize]?.fontSize || sizeMap.medium.fontSize,
      borderRadius: radiusMap[borderRadius] || radiusMap.rounded,
      boxShadow: shadowMap[shadowStyle] || shadowMap.medium
    };
  }, [buttonSize, borderRadius, shadowStyle]);

  const fullMeetingID = roomPrefix ? `${roomPrefix}${meetingID}` : meetingID;

  const canJoin =
    (!requireName || nameInput.trim()) &&
    (!requireEmail || emailInput.trim()) &&
    (allowGuests || credentials);

  return (
    <div
      className={`msfu-meeting-join ${className} ${customCssClass}`.trim()}
      style={{
        width: '100%',
        maxWidth: '480px',
        backgroundColor: 'var(--msfu-color-surface, white)',
        borderRadius: buttonStyles.borderRadius,
        boxShadow: buttonStyles.boxShadow,
        overflow: 'hidden',
        fontFamily: "var(--msfu-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif)",
        ...style
      }}
    >
      {/* Header */}
      <div
        className="msfu-meeting-join__header"
        style={{
          padding: 'var(--msfu-spacing-lg, 24px)',
          backgroundColor: primaryColor,
          color: textColor,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--msfu-spacing-sm, 8px)'
        }}
      >
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            backgroundColor: 'rgba(255,255,255,0.2)',
            color: textColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <UsersIcon />
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
            {title}
          </h3>
          <p style={{ margin: 0, fontSize: '14px', opacity: 0.9 }}>
            Meeting ID: {fullMeetingID}
          </p>
        </div>
      </div>

      {/* Content */}
      <div
        className="msfu-meeting-join__content"
        style={{ padding: 'var(--msfu-spacing-lg, 24px)' }}
      >
        {/* Preview State */}
        {widgetState === 'preview' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--msfu-spacing-md, 16px)'
            }}
          >
            {/* Video Preview */}
            {showPreview && (
              <div
                style={{
                  width: '100%',
                  aspectRatio: '16/9',
                  backgroundColor: 'var(--msfu-color-background-dark, #1f2937)',
                  borderRadius: buttonStyles.borderRadius,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--msfu-color-text-muted, #6b7280)',
                  position: 'relative',
                  overflow: 'hidden'
                }}
              >
                {startWithVideoOff ? (
                  <span>Camera off</span>
                ) : (
                  <span>Camera preview</span>
                )}
              </div>
            )}

            {/* Name Input */}
            {(requireName || !userName) && (
              <div>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '4px',
                    fontSize: '14px',
                    fontWeight: 500
                  }}
                >
                  Your Name {requireName && <span style={{ color: '#ef4444' }}>*</span>}
                </label>
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Enter your name"
                  style={{
                    width: '100%',
                    padding: 'var(--msfu-spacing-sm, 8px) var(--msfu-spacing-md, 16px)',
                    border: '1px solid var(--msfu-color-border, #e5e7eb)',
                    borderRadius: buttonStyles.borderRadius,
                    fontSize: '14px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            )}

            {/* Email Input */}
            {requireEmail && (
              <div>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '4px',
                    fontSize: '14px',
                    fontWeight: 500
                  }}
                >
                  Email <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="Enter your email"
                  style={{
                    width: '100%',
                    padding: 'var(--msfu-spacing-sm, 8px) var(--msfu-spacing-md, 16px)',
                    border: '1px solid var(--msfu-color-border, #e5e7eb)',
                    borderRadius: buttonStyles.borderRadius,
                    fontSize: '14px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            )}

            {/* Device Selection */}
            {showDeviceSettings && (
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--msfu-spacing-sm, 8px)'
                }}
              >
                {showAudioDeviceSelect && (
                  <select
                    style={{
                      flex: 1,
                      padding: 'var(--msfu-spacing-sm, 8px)',
                      border: '1px solid var(--msfu-color-border, #e5e7eb)',
                      borderRadius: buttonStyles.borderRadius,
                      fontSize: '14px'
                    }}
                  >
                    <option>Default Microphone</option>
                  </select>
                )}
                {showVideoDeviceSelect && (
                  <select
                    style={{
                      flex: 1,
                      padding: 'var(--msfu-spacing-sm, 8px)',
                      border: '1px solid var(--msfu-color-border, #e5e7eb)',
                      borderRadius: buttonStyles.borderRadius,
                      fontSize: '14px'
                    }}
                  >
                    <option>Default Camera</option>
                  </select>
                )}
              </div>
            )}

            {/* Media toggle buttons */}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <button
                type="button"
                style={{
                  padding: '8px 16px',
                  backgroundColor: startWithAudioOff ? '#ef4444' : '#22c55e',
                  color: 'white',
                  border: 'none',
                  borderRadius: buttonStyles.borderRadius,
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                <span className="msfu-icon-slot" aria-hidden="true" dangerouslySetInnerHTML={{ __html: renderIcon('mic') }} /> {startWithAudioOff ? 'Muted' : 'On'}
              </button>
              <button
                type="button"
                style={{
                  padding: '8px 16px',
                  backgroundColor: startWithVideoOff ? '#ef4444' : '#22c55e',
                  color: 'white',
                  border: 'none',
                  borderRadius: buttonStyles.borderRadius,
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                <span className="msfu-icon-slot" aria-hidden="true" dangerouslySetInnerHTML={{ __html: renderIcon('video') }} /> {startWithVideoOff ? 'Off' : 'On'}
              </button>
            </div>

            {/* Join Button */}
            <button
              type="button"
              onClick={handleJoin}
              disabled={!canJoin}
              style={{
                width: '100%',
                padding: buttonStyles.padding,
                backgroundColor: primaryColor,
                color: textColor,
                border: 'none',
                borderRadius: buttonStyles.borderRadius,
                fontSize: buttonStyles.fontSize,
                fontWeight: 600,
                cursor: canJoin ? 'pointer' : 'not-allowed',
                opacity: canJoin ? 1 : 0.5,
                transition: 'transform 0.2s ease, box-shadow 0.2s ease'
              }}
              onMouseEnter={(e) => {
                if (canJoin) e.currentTarget.style.transform = 'scale(1.02)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              Join Meeting
            </button>

            {!allowGuests && !credentials && (
              <p style={{ fontSize: '12px', color: '#ef4444', textAlign: 'center', margin: 0 }}>
                Guest access is disabled. Please log in to join.
              </p>
            )}
          </div>
        )}

        {/* Joining State */}
        {widgetState === 'joining' && (
          <div style={{ textAlign: 'center', padding: 'var(--msfu-spacing-lg, 24px)' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                margin: '0 auto var(--msfu-spacing-md, 16px)',
                border: '3px solid var(--msfu-color-border, #e5e7eb)',
                borderTopColor: primaryColor,
                borderRadius: '50%',
                animation: 'msfu-spin 1s linear infinite'
              }}
            />
            <p style={{ margin: 0, color: 'var(--msfu-color-text-muted, #6b7280)' }}>
              Joining meeting...
            </p>
            <button
              onClick={() => { setShouldConnect(false); setWidgetState('preview'); }}
              style={{
                marginTop: '16px',
                padding: '8px 16px',
                backgroundColor: 'transparent',
                border: '1px solid #e5e7eb',
                borderRadius: buttonStyles.borderRadius,
                cursor: 'pointer',
                color: '#6b7280'
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* In Meeting - ConnectionBlock manages room */}
        {shouldConnect && (
          <ConnectionBlock
            action="join"
            meetingID={fullMeetingID}
            userName={nameInput}
            credentials={credentials}
            onConnected={handleConnected}
            onDisconnected={handleDisconnected}
          >
            {({ sourceParameters, isConnected }) => (
              <>
                {isConnected && widgetState === 'in-meeting' && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--msfu-spacing-md, 16px)'
                    }}
                  >
                    {/* Video/Audio Controls */}
                    <div style={{ display: 'flex', gap: 'var(--msfu-spacing-md, 16px)' }}>
                      <AudioControlsBlock
                        sourceParameters={sourceParameters}
                        showMuteButton={true}
                        showDeviceSelect={showAudioDeviceSelect}
                      />
                      <VideoControlsBlock
                        sourceParameters={sourceParameters}
                        showVideoToggle={true}
                        showDeviceSelect={showVideoDeviceSelect}
                      />
                    </div>

                    {/* Participants */}
                    <ParticipantsBlock
                      sourceParameters={sourceParameters}
                      showAvatars={true}
                      showAudioLevels={true}
                    />

                    {/* Audio Grid */}
                    <AudioGridBlock
                      sourceParameters={sourceParameters}
                      showLabels={true}
                      layout="list"
                    />

                    {/* Leave Button */}
                    <DisconnectBlock
                      sourceParameters={sourceParameters}
                      confirmationRequired={true}
                      onDisconnected={handleDisconnected}
                      buttonText="Leave Meeting"
                    />
                  </div>
                )}
              </>
            )}
          </ConnectionBlock>
        )}
      </div>

      {/* Footer */}
      <div
        className="msfu-meeting-join__footer"
        style={{
          padding: '8px 24px',
          borderTop: '1px solid #e5e7eb',
          textAlign: 'center'
        }}
      >
        <span style={{ fontSize: '12px', color: '#6b7280' }}>
          Powered by MediaSFU
        </span>
      </div>

      {/* Animation */}
      <style>{`
        @keyframes msfu-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default MeetingJoinWidget;
