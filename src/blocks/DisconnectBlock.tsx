/**
 * DisconnectBlock
 *
 * Building block for disconnecting from a MediaSFU room.
 * Uses mediasfu-reactjs SDK method: confirmExit.
 *
 * Based on patterns from:
 * - voipsrc/src/hooks/useAudioVideoSDK.ts
 * - voipsrc/src/components/MediaSFU/MediaSFURoomDisplay.tsx
 */

import React, { useState, useCallback } from 'react';
import type { DisconnectBlockProps, DisconnectReason } from '../types/building-blocks';

// Icons
const PhoneOffIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

const LogOutIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

const WarningIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

interface DisconnectBlockInternalProps extends DisconnectBlockProps {
  variant?: 'button' | 'icon' | 'text';
  buttonText?: string;
  showIcon?: boolean;
}

export const DisconnectBlock: React.FC<DisconnectBlockInternalProps> = ({
  sourceParameters,
  updateSourceParameters,
  confirmationRequired = true,
  confirmationMessage = 'Are you sure you want to leave?',
  onBeforeDisconnect,
  onDisconnected,
  variant = 'button',
  buttonText = 'Leave',
  showIcon = true,
  className = '',
  style,
  disabled = false
}) => {
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Check if connected
  const isConnected = !!(
    sourceParameters.socket ||
    sourceParameters.localSocket ||
    sourceParameters.roomName
  );

  // Handle disconnect
  const performDisconnect = useCallback(async () => {
    if (isDisconnecting || !isConnected) return;

    setIsDisconnecting(true);

    try {
      // Call before disconnect hook if provided
      if (onBeforeDisconnect) {
        const shouldProceed = await onBeforeDisconnect();
        if (!shouldProceed) {
          setIsDisconnecting(false);
          setShowConfirmation(false);
          return;
        }
      }

      const params = sourceParameters.getUpdatedAllParams?.() || sourceParameters;

      // Import confirmExit from mediasfu-reactjs
      const { confirmExit } = await import('mediasfu-reactjs');

      await confirmExit({
        member: params.member,
        socket: params.socket,
        localSocket: params.localSocket,
        roomName: params.roomName,
        ban: false
      });

      const reason: DisconnectReason = {
        type: 'user',
        details: 'User left the room'
      };

      onDisconnected?.(reason);
      setShowConfirmation(false);

    } catch (error) {
      console.error('[DisconnectBlock] Error disconnecting:', error);

      const reason: DisconnectReason = {
        type: 'error',
        details: error instanceof Error ? error.message : 'Disconnect failed'
      };

      onDisconnected?.(reason);
    } finally {
      setIsDisconnecting(false);
    }
  }, [sourceParameters, isConnected, isDisconnecting, onBeforeDisconnect, onDisconnected]);

  // Handle button click
  const handleClick = useCallback(() => {
    if (disabled || !isConnected || isDisconnecting) return;

    if (confirmationRequired) {
      setShowConfirmation(true);
    } else {
      performDisconnect();
    }
  }, [disabled, isConnected, isDisconnecting, confirmationRequired, performDisconnect]);

  // Cancel confirmation
  const handleCancel = useCallback(() => {
    setShowConfirmation(false);
  }, []);

  // Render based on variant
  const renderButton = () => {
    const buttonStyle: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 'var(--msfu-spacing-xs, 4px)',
      backgroundColor: 'var(--msfu-color-error, #ef4444)',
      color: 'white',
      border: 'none',
      cursor: disabled || !isConnected || isDisconnecting ? 'not-allowed' : 'pointer',
      opacity: disabled || !isConnected ? 0.5 : 1,
      transition: 'all 0.2s ease',
      ...style
    };

    switch (variant) {
      case 'icon':
        return (
          <button
            type="button"
            onClick={handleClick}
            disabled={disabled || !isConnected || isDisconnecting}
            aria-label={buttonText}
            className={`msfu-disconnect msfu-disconnect--icon ${className}`}
            style={{
              ...buttonStyle,
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              padding: 0
            }}
          >
            {isDisconnecting ? (
              <LoadingSpinner />
            ) : (
              <PhoneOffIcon />
            )}
          </button>
        );

      case 'text':
        return (
          <button
            type="button"
            onClick={handleClick}
            disabled={disabled || !isConnected || isDisconnecting}
            className={`msfu-disconnect msfu-disconnect--text ${className}`}
            style={{
              ...buttonStyle,
              backgroundColor: 'transparent',
              color: 'var(--msfu-color-error, #ef4444)',
              padding: 'var(--msfu-spacing-sm, 8px)',
              fontSize: '14px',
              fontWeight: 500
            }}
          >
            {isDisconnecting ? 'Leaving...' : buttonText}
          </button>
        );

      case 'button':
      default:
        return (
          <button
            type="button"
            onClick={handleClick}
            disabled={disabled || !isConnected || isDisconnecting}
            className={`msfu-disconnect msfu-disconnect--button ${className}`}
            style={{
              ...buttonStyle,
              padding: 'var(--msfu-spacing-sm, 8px) var(--msfu-spacing-lg, 24px)',
              borderRadius: 'var(--msfu-border-radius, 8px)',
              fontSize: '14px',
              fontWeight: 500
            }}
          >
            {isDisconnecting ? (
              <>
                <LoadingSpinner />
                Leaving...
              </>
            ) : (
              <>
                {showIcon && <LogOutIcon />}
                {buttonText}
              </>
            )}
          </button>
        );
    }
  };

  return (
    <>
      {renderButton()}

      {/* Confirmation Dialog */}
      {showConfirmation && (
        <div
          className="msfu-disconnect__overlay"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 'var(--msfu-spacing-md, 16px)'
          }}
          onClick={handleCancel}
        >
          <div
            className="msfu-disconnect__dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="disconnect-dialog-title"
            style={{
              backgroundColor: 'var(--msfu-color-surface, white)',
              borderRadius: 'var(--msfu-border-radius-lg, 12px)',
              padding: 'var(--msfu-spacing-lg, 24px)',
              maxWidth: '400px',
              width: '100%',
              boxShadow: 'var(--msfu-shadow-lg, 0 4px 8px -2px rgba(16,24,40,0.06), 0 12px 24px -6px rgba(16,24,40,0.12), 0 0 0 1px rgba(16,24,40,0.04))'
            }}
          >
            {/* Icon */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                marginBottom: 'var(--msfu-spacing-md, 16px)'
              }}
            >
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--msfu-color-warning-light, #fef3c7)',
                  color: 'var(--msfu-color-warning, #f59e0b)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <WarningIcon />
              </div>
            </div>

            {/* Title */}
            <h3
              id="disconnect-dialog-title"
              style={{
                textAlign: 'center',
                margin: '0 0 var(--msfu-spacing-sm, 8px) 0',
                fontSize: '18px',
                fontWeight: 600,
                color: 'var(--msfu-color-text, #1f2937)'
              }}
            >
              Leave Room?
            </h3>

            {/* Message */}
            <p
              style={{
                textAlign: 'center',
                margin: '0 0 var(--msfu-spacing-lg, 24px) 0',
                color: 'var(--msfu-color-text-muted, #6b7280)',
                fontSize: '14px'
              }}
            >
              {confirmationMessage}
            </p>

            {/* Buttons */}
            <div
              style={{
                display: 'flex',
                gap: 'var(--msfu-spacing-sm, 8px)',
                justifyContent: 'center'
              }}
            >
              <button
                type="button"
                onClick={handleCancel}
                disabled={isDisconnecting}
                style={{
                  flex: 1,
                  padding: 'var(--msfu-spacing-sm, 8px) var(--msfu-spacing-md, 16px)',
                  border: '1px solid var(--msfu-color-border, #e5e7eb)',
                  borderRadius: 'var(--msfu-border-radius, 8px)',
                  backgroundColor: 'transparent',
                  color: 'var(--msfu-color-text, #1f2937)',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: isDisconnecting ? 'not-allowed' : 'pointer'
                }}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={performDisconnect}
                disabled={isDisconnecting}
                style={{
                  flex: 1,
                  padding: 'var(--msfu-spacing-sm, 8px) var(--msfu-spacing-md, 16px)',
                  border: 'none',
                  borderRadius: 'var(--msfu-border-radius, 8px)',
                  backgroundColor: 'var(--msfu-color-error, #ef4444)',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: isDisconnecting ? 'not-allowed' : 'pointer',
                  opacity: isDisconnecting ? 0.7 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--msfu-spacing-xs, 4px)'
                }}
              >
                {isDisconnecting ? (
                  <>
                    <LoadingSpinner />
                    Leaving...
                  </>
                ) : (
                  'Leave'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// Loading Spinner Component
const LoadingSpinner: React.FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    style={{ animation: 'msfu-spin 1s linear infinite' }}
  >
    <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
    <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
    <style>{`
      @keyframes msfu-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `}</style>
  </svg>
);

export default DisconnectBlock;
