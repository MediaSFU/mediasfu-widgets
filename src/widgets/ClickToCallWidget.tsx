/**
 * ClickToCallWidget
 *
 * Pre-composed widget that combines building blocks for a
 * click-to-call experience with optional AI agent.
 *
 * Supports full customization via props from dashboard config.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { resolveButtonIconToken } from '../core/iconToken';

// Building blocks
import { ConnectionBlock } from '../blocks/ConnectionBlock';
import { AudioControlsBlock } from '../blocks/AudioControlsBlock';
import { CallControlsBlock } from '../blocks/CallControlsBlock';
import { AIAgentBlock } from '../blocks/AIAgentBlock';
import { ParticipantsBlock } from '../blocks/ParticipantsBlock';
import { DisconnectBlock } from '../blocks/DisconnectBlock';

// Types
import type {
  SourceParameters,
  DisconnectReason,
  AIAgentConfig,
  MediaSFUCredentials,
  Call
} from '../types/building-blocks';

// Icons
const PhoneIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const VideoIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

const HeadsetIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
  </svg>
);

export interface ClickToCallWidgetProps {
  // ===== BASIC CONFIG =====
  /**
   * Widget title displayed in header
   */
  title?: string;

  /**
   * Subtitle/description
   */
  subtitle?: string;

  /**
   * Button text when not connected
   */
  buttonText?: string;

  /**
   * Button icon type
   */
  buttonIcon?: 'phone' | 'video' | 'headset' | 'none' | string;

  /**
   * Widget position (for floating)
   */
  position?: 'inline' | 'bottom-right' | 'bottom-left';

  /**
   * Show availability status
   */
  showStatus?: boolean;

  /**
   * Collect caller name before call
   */
  collectCallerName?: boolean;

  /**
   * Collect caller phone number
   */
  collectCallerNumber?: boolean;

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
   * Button border radius style
   */
  borderRadius?: 'rounded' | 'pill' | 'square' | 'circle';

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
   * Animation style for button
   */
  animationStyle?: 'none' | 'pulse' | 'bounce' | 'shake';

  /**
   * Delay before showing floating button (seconds)
   */
  showAfterDelay?: number;

  /**
   * Hide button while scrolling
   */
  hideOnScroll?: boolean;

  /**
   * Play ringtone on connect
   */
  playRingtone?: boolean;

  // ===== CALL HANDLING =====
  /**
   * Max wait time in seconds
   */
  maxWaitTime?: number;

  /**
   * Message shown if call not answered
   */
  noAnswerMessage?: string;

  /**
   * Auto-record calls
   */
  autoRecord?: boolean;

  // ===== INTEGRATIONS =====
  /**
   * Webhook URL for call events
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
   * Enable AI agent mode
   */
  enableAgent?: boolean;

  /**
   * AI Agent configuration
   */
  agentConfig?: AIAgentConfig;

  /**
   * MediaSFU API credentials
   */
  credentials?: MediaSFUCredentials;

  /**
   * Room duration in minutes
   */
  duration?: number;

  /**
   * User name for the call
   */
  userName?: string;

  /**
   * Called when call is connected
   */
  onConnected?: (params: SourceParameters) => void;

  /**
   * Called when call ends
   */
  onDisconnected?: (reason: DisconnectReason) => void;

  /**
   * Custom CSS class (legacy)
   */
  className?: string;

  /**
   * Custom inline styles
   */
  style?: React.CSSProperties;
}

type WidgetState = 'idle' | 'connecting' | 'active' | 'timeout' | 'hidden';

// Ringtone audio URL
const RINGTONE_URL = 'https://cdn.mediasfu.com/sounds/ringtone.mp3';

export const ClickToCallWidget: React.FC<ClickToCallWidgetProps> = ({
  // Basic
  title = 'Call Us',
  subtitle = 'Speak with our team',
  buttonText = 'Call Now',
  buttonIcon = 'phone',
  position = 'inline',
  showStatus = true,
  collectCallerName = true,
  collectCallerNumber = false,

  // Branding
  primaryColor = '#10B981',
  textColor = '#FFFFFF',
  borderRadius = 'rounded',
  buttonSize = 'medium',
  shadowStyle = 'medium',

  // Behavior
  animationStyle = 'none',
  showAfterDelay = 0,
  hideOnScroll = false,
  playRingtone = true,

  // Call Handling
  maxWaitTime = 60,
  noAnswerMessage = 'Sorry, no one is available right now. Please try again later.',
  autoRecord = false,

  // Integrations
  webhookUrl,
  googleAnalyticsId,
  customCssClass = '',

  // Existing
  enableAgent = false,
  agentConfig,
  credentials,
  duration = 30,
  userName = 'Visitor',
  onConnected,
  onDisconnected,
  className = '',
  style
}) => {
  const [widgetState, setWidgetState] = useState<WidgetState>(showAfterDelay > 0 ? 'hidden' : 'idle');
  const [shouldConnect, setShouldConnect] = useState(false);
  const [currentCall, setCurrentCall] = useState<Call | null>(null);
  const [callerName, setCallerName] = useState('');
  const [callerNumber, setCallerNumber] = useState('');
  const [showPreCallForm, setShowPreCallForm] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const [waitTimeoutId, setWaitTimeoutId] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Show after delay
  useEffect(() => {
    if (showAfterDelay > 0 && widgetState === 'hidden') {
      const timer = setTimeout(() => {
        setWidgetState('idle');
      }, showAfterDelay * 1000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [showAfterDelay, widgetState]);

  // Hide on scroll
  useEffect(() => {
    if (!hideOnScroll || position === 'inline') return;

    let scrollTimer: ReturnType<typeof setTimeout>;
    const handleScroll = () => {
      setIsScrolling(true);
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => setIsScrolling(false), 150);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimer);
    };
  }, [hideOnScroll, position]);

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
        body: JSON.stringify({ event, timestamp: new Date().toISOString(), ...data })
      });
    } catch (err) {
      console.warn('Webhook notification failed:', err);
    }
  }, [webhookUrl]);

  // Play ringtone
  const ringtoneRef = React.useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (playRingtone && widgetState === 'connecting') {
      ringtoneRef.current = new Audio(RINGTONE_URL);
      ringtoneRef.current.loop = true;
      ringtoneRef.current.play().catch(() => {});
    } else if (ringtoneRef.current) {
      ringtoneRef.current.pause();
      ringtoneRef.current = null;
    }
    return () => {
      if (ringtoneRef.current) {
        ringtoneRef.current.pause();
        ringtoneRef.current = null;
      }
    };
  }, [playRingtone, widgetState]);

  // Start the call
  const handleStartCall = useCallback(() => {
    if ((collectCallerName || collectCallerNumber) && !showPreCallForm) {
      setShowPreCallForm(true);
      return;
    }

    setShowPreCallForm(false);
    setWidgetState('connecting');
    setShouldConnect(true);
    trackEvent('call_started', callerName || userName);
    notifyWebhook('call_started', { callerName: callerName || userName, callerNumber });

    // Set max wait timeout
    if (maxWaitTime > 0) {
      const timeoutId = setTimeout(() => {
        setWidgetState((prev) => {
          if (prev === 'connecting') {
            setShouldConnect(false);
            trackEvent('call_timeout');
            notifyWebhook('call_timeout');
            return 'timeout';
          }
          return prev;
        });
      }, maxWaitTime * 1000);
      setWaitTimeoutId(timeoutId);
    }
  }, [collectCallerName, collectCallerNumber, showPreCallForm, callerName, callerNumber, userName, maxWaitTime, trackEvent, notifyWebhook]);

  // Handle connected
  const handleConnected = useCallback((params: SourceParameters) => {
    if (waitTimeoutId) clearTimeout(waitTimeoutId);
    setWidgetState('active');
    setCurrentCall({
      status: 'active',
      direction: 'outbound',
      roomName: params.roomName,
      startTime: new Date()
    });
    trackEvent('call_connected');
    notifyWebhook('call_connected', { roomName: params.roomName });
    onConnected?.(params);
  }, [onConnected, waitTimeoutId, trackEvent, notifyWebhook]);

  // Handle disconnected
  const handleDisconnected = useCallback((reason: DisconnectReason) => {
    if (waitTimeoutId) clearTimeout(waitTimeoutId);
    setWidgetState('idle');
    setShouldConnect(false);
    setCurrentCall(null);
    trackEvent('call_ended', String(reason));
    notifyWebhook('call_ended', { reason });
    onDisconnected?.(reason);
  }, [onDisconnected, waitTimeoutId, trackEvent, notifyWebhook]);

  // Retry after timeout
  const handleRetry = useCallback(() => {
    setWidgetState('idle');
  }, []);

  const resolvedButtonIcon = useMemo(
    () => resolveButtonIconToken(buttonIcon, 'phone'),
    [buttonIcon]
  );

  // Get button icon component
  const ButtonIconComponent = useMemo(() => {
    switch (resolvedButtonIcon) {
      case 'video': return VideoIcon;
      case 'headset': return HeadsetIcon;
      case 'phone': return PhoneIcon;
      default: return null;
    }
  }, [resolvedButtonIcon]);

  // Compute styles based on config
  const buttonStyles = useMemo(() => {
    const sizeMap = {
      small: { padding: '10px 16px', fontSize: '14px', iconSize: 18 },
      medium: { padding: '14px 24px', fontSize: '16px', iconSize: 22 },
      large: { padding: '18px 32px', fontSize: '18px', iconSize: 26 }
    };

    const radiusMap = {
      rounded: '8px',
      pill: '50px',
      square: '0px',
      circle: '50%'
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
      iconSize: sizeMap[buttonSize]?.iconSize || sizeMap.medium.iconSize,
      borderRadius: radiusMap[borderRadius] || radiusMap.rounded,
      boxShadow: shadowMap[shadowStyle] || shadowMap.medium
    };
  }, [buttonSize, borderRadius, shadowStyle]);

  // Animation keyframes
  const animationKeyframes = useMemo(() => {
    switch (animationStyle) {
      case 'pulse':
        return `
          @keyframes msfu-pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
          }
        `;
      case 'bounce':
        return `
          @keyframes msfu-bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-5px); }
          }
        `;
      case 'shake':
        return `
          @keyframes msfu-shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-3px); }
            75% { transform: translateX(3px); }
          }
        `;
      default:
        return '';
    }
  }, [animationStyle]);

  const animationName = animationStyle !== 'none' ? `msfu-${animationStyle}` : 'none';
  const animationDuration = animationStyle === 'shake' ? '0.5s' : '2s';

  // Container styles for floating position
  const containerStyles: React.CSSProperties = useMemo(() => {
    if (position === 'inline') {
      return {
        width: '100%',
        maxWidth: '400px',
        ...style
      };
    }

    const positionStyles: React.CSSProperties = {
      position: 'fixed',
      zIndex: 9999,
      transition: 'opacity 0.3s ease, transform 0.3s ease',
      opacity: isScrolling ? 0.3 : 1,
      transform: isScrolling ? 'scale(0.9)' : 'scale(1)'
    };

    if (position === 'bottom-right') {
      positionStyles.bottom = '24px';
      positionStyles.right = '24px';
    } else if (position === 'bottom-left') {
      positionStyles.bottom = '24px';
      positionStyles.left = '24px';
    }

    return { ...positionStyles, ...style };
  }, [position, isScrolling, style]);

  // Don't render if hidden
  if (widgetState === 'hidden') return null;

  return (
    <div
      className={`msfu-click-to-call ${className} ${customCssClass}`.trim()}
      style={{
        backgroundColor: 'var(--msfu-color-surface, white)',
        borderRadius: 'var(--msfu-border-radius-lg, 12px)',
        boxShadow: buttonStyles.boxShadow,
        overflow: 'hidden',
        fontFamily: "var(--msfu-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif)",
        ...containerStyles
      }}
    >
      {/* Header */}
      <div
        className="msfu-click-to-call__header"
        style={{
          padding: 'var(--msfu-spacing-lg, 24px)',
          backgroundColor: primaryColor,
          color: textColor,
          textAlign: 'center'
        }}
      >
        <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
          {title}
        </h3>
        {subtitle && (
          <p style={{ margin: '8px 0 0 0', fontSize: '14px', opacity: 0.9 }}>
            {subtitle}
          </p>
        )}
        {showStatus && (
          <div style={{ marginTop: '12px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#22c55e', display: 'inline-block' }} />
            Available Now
          </div>
        )}
      </div>

      {/* Content */}
      <div className="msfu-click-to-call__content" style={{ padding: 'var(--msfu-spacing-lg, 24px)' }}>

        {/* Pre-call form */}
        {showPreCallForm && widgetState === 'idle' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {collectCallerName && (
              <input
                type="text"
                placeholder="Your name"
                value={callerName}
                onChange={(e) => setCallerName(e.target.value)}
                style={{
                  padding: '12px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
              />
            )}
            {collectCallerNumber && (
              <input
                type="tel"
                placeholder="Your phone number (optional)"
                value={callerNumber}
                onChange={(e) => setCallerNumber(e.target.value)}
                style={{
                  padding: '12px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
              />
            )}
          </div>
        )}

        {/* Idle State - Show Call Button */}
        {widgetState === 'idle' && (
          <button
            type="button"
            onClick={handleStartCall}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              width: resolvedButtonIcon === 'none' || borderRadius !== 'circle' ? '100%' : buttonStyles.iconSize + 28 + 'px',
              height: borderRadius === 'circle' ? buttonStyles.iconSize + 28 + 'px' : 'auto',
              marginTop: showPreCallForm ? '12px' : 0,
              padding: borderRadius === 'circle' ? '0' : buttonStyles.padding,
              backgroundColor: primaryColor,
              color: textColor,
              border: 'none',
              borderRadius: buttonStyles.borderRadius,
              fontSize: buttonStyles.fontSize,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: buttonStyles.boxShadow,
              animation: animationStyle !== 'none' ? `${animationName} ${animationDuration} ease-in-out infinite` : 'none',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.02)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            {ButtonIconComponent && <ButtonIconComponent />}
            {borderRadius !== 'circle' && buttonText}
          </button>
        )}

        {/* Connecting State */}
        {widgetState === 'connecting' && (
          <div style={{ textAlign: 'center', padding: '24px' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                margin: '0 auto 16px',
                border: '3px solid #e5e7eb',
                borderTopColor: primaryColor,
                borderRadius: '50%',
                animation: 'msfu-spin 1s linear infinite'
              }}
            />
            <p style={{ margin: 0, color: '#6b7280' }}>Connecting...</p>
            <button
              onClick={() => { setShouldConnect(false); setWidgetState('idle'); }}
              style={{
                marginTop: '16px',
                padding: '8px 16px',
                backgroundColor: 'transparent',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                cursor: 'pointer',
                color: '#6b7280'
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Timeout State */}
        {widgetState === 'timeout' && (
          <div style={{ textAlign: 'center', padding: '24px' }}>
            <p style={{ margin: '0 0 16px 0', color: '#6b7280' }}>{noAnswerMessage}</p>
            <button
              onClick={handleRetry}
              style={{
                padding: '12px 24px',
                backgroundColor: primaryColor,
                color: textColor,
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              Try Again
            </button>
          </div>
        )}

        {/* Active Call */}
        {shouldConnect && widgetState === 'active' && (
          <ConnectionBlock
            action="create"
            userName={callerName || userName}
            duration={duration}
            capacity={5}
            supportSIP={true}
            credentials={credentials}
            onConnected={handleConnected}
            onDisconnected={handleDisconnected}
          >
            {({ sourceParameters, isConnected }) => (
              <>
                {isConnected && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {enableAgent && agentConfig && (
                      <AIAgentBlock
                        sourceParameters={sourceParameters}
                        agentConfig={agentConfig}
                        style={{ marginBottom: '16px' }}
                      />
                    )}

                    <ParticipantsBlock
                      sourceParameters={sourceParameters}
                      showAvatars={true}
                      showAudioLevels={true}
                      maxVisible={5}
                    />

                    <AudioControlsBlock
                      sourceParameters={sourceParameters}
                      showMuteButton={true}
                      showDeviceSelect={true}
                    />

                    <CallControlsBlock
                      sourceParameters={sourceParameters}
                      call={currentCall || undefined}
                      showHold={true}
                      showMute={false}
                      showEnd={false}
                    />

                    <DisconnectBlock
                      sourceParameters={sourceParameters}
                      confirmationRequired={true}
                      confirmationMessage="Are you sure you want to end this call?"
                      onDisconnected={handleDisconnected}
                      buttonText="End Call"
                      variant="button"
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
        className="msfu-click-to-call__footer"
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

      {/* Animations */}
      <style>{`
        @keyframes msfu-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        ${animationKeyframes}
      `}</style>
    </div>
  );
};

export default ClickToCallWidget;
