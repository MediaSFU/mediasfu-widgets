/**
 * CallControlsBlock
 *
 * Building block for VoIP/SIP call controls.
 * Handles hold, transfer, end call, and other telephony operations.
 *
 * Based on patterns from:
 * - voipsrc/src/components/MediaSFU/MediaSFURoomDisplay.tsx
 * - voipsrc/src/types/call.types.ts
 */

import React, { useState, useCallback } from 'react';
import type { CallControlsBlockProps, CallStatus } from '../types/building-blocks';

// Icons
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _PhoneIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const HangUpIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

const PauseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="6" y="4" width="4" height="16" />
    <rect x="14" y="4" width="4" height="16" />
  </svg>
);

const PlayIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const TransferIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="15 14 20 9 15 4" />
    <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
  </svg>
);

const MuteIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="1" y1="1" x2="23" y2="23" />
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const UnmuteIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

// Status labels
const STATUS_LABELS: Record<CallStatus, string> = {
  idle: 'Ready',
  ringing: 'Ringing...',
  connecting: 'Connecting...',
  active: 'In Call',
  'on-hold': 'On Hold',
  ended: 'Call Ended',
  failed: 'Call Failed',
  transferring: 'Transferring...',
  transferred: 'Transferred'
};

// Status colors
const STATUS_COLORS: Record<CallStatus, string> = {
  idle: '#6b7280',
  ringing: '#f59e0b',
  connecting: '#3b82f6',
  active: '#10b981',
  'on-hold': '#f59e0b',
  ended: '#6b7280',
  failed: '#ef4444',
  transferring: '#8b5cf6',
  transferred: '#10b981'
};

export const CallControlsBlock: React.FC<CallControlsBlockProps> = ({
  sourceParameters,
  updateSourceParameters,
  call,
  showHold = true,
  showTransfer = false,
  showMute = true,
  showEnd = true,
  onHold,
  onTransfer,
  onEnd,
  className = '',
  style,
  disabled = false
}) => {
  const [isMuted, setIsMuted] = useState(!sourceParameters.audioAlreadyOn);
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [transferTarget, setTransferTarget] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Current call status
  const status: CallStatus = call?.status || 'idle';
  const isActive = status === 'active';
  const isOnHold = status === 'on-hold';
  const canControl = isActive || isOnHold;

  // Format call duration
  const formatDuration = (startTime?: Date): string => {
    if (!startTime) return '00:00';
    const now = new Date();
    const diff = Math.floor((now.getTime() - startTime.getTime()) / 1000);
    const minutes = Math.floor(diff / 60);
    const seconds = diff % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Hold/Resume
  const handleHold = useCallback(async () => {
    if (!canControl || isProcessing || disabled) return;

    setIsProcessing(true);
    try {
      // In real implementation, this would call the VoIP service
      onHold?.();
    } catch (error) {
      console.error('[CallControlsBlock] Hold error:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [canControl, isProcessing, disabled, onHold]);

  // Mute/Unmute
  const handleMute = useCallback(async () => {
    if (!canControl || isProcessing || disabled) return;

    setIsProcessing(true);
    try {
      const params = sourceParameters.getUpdatedAllParams?.() || sourceParameters;
      const { clickAudio } = await import('mediasfu-reactjs');
      // Cast to any since sourceParameters is the runtime state object
      await clickAudio({ parameters: params as any });
      setIsMuted(!isMuted);
    } catch (error) {
      console.error('[CallControlsBlock] Mute error:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [sourceParameters, canControl, isProcessing, disabled, isMuted]);

  // Transfer
  const handleTransfer = useCallback(async () => {
    if (!transferTarget.trim() || isProcessing || disabled) return;

    setIsProcessing(true);
    try {
      onTransfer?.(transferTarget);
      setShowTransferDialog(false);
      setTransferTarget('');
    } catch (error) {
      console.error('[CallControlsBlock] Transfer error:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [transferTarget, isProcessing, disabled, onTransfer]);

  // End Call
  const handleEnd = useCallback(async () => {
    if (isProcessing || disabled) return;

    setIsProcessing(true);
    try {
      const params = sourceParameters.getUpdatedAllParams?.() || sourceParameters;
      const { confirmExit } = await import('mediasfu-reactjs');

      await confirmExit({
        member: params.member,
        socket: params.socket,
        localSocket: params.localSocket,
        roomName: params.roomName,
        ban: false
      });

      onEnd?.();
    } catch (error) {
      console.error('[CallControlsBlock] End call error:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [sourceParameters, isProcessing, disabled, onEnd]);

  return (
    <div
      className={`msfu-call-controls ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--msfu-spacing-md, 16px)',
        ...style
      }}
    >
      {/* Call Status Bar */}
      {call && (
        <div
          className="msfu-call-controls__status"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'var(--msfu-spacing-sm, 8px) var(--msfu-spacing-md, 16px)',
            backgroundColor: 'var(--msfu-color-surface, white)',
            borderRadius: 'var(--msfu-border-radius, 8px)',
            border: '1px solid var(--msfu-color-border, #e5e7eb)'
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--msfu-spacing-sm, 8px)'
            }}
          >
            {/* Status Indicator */}
            <div
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor: STATUS_COLORS[status],
                animation: status === 'ringing' || status === 'connecting'
                  ? 'msfu-pulse-call 1s infinite'
                  : 'none'
              }}
            />

            <span
              style={{
                fontSize: '14px',
                fontWeight: 500,
                color: STATUS_COLORS[status]
              }}
            >
              {STATUS_LABELS[status]}
            </span>
          </div>

          {/* Duration */}
          {(isActive || isOnHold) && call.startTime && (
            <span
              style={{
                fontSize: '14px',
                color: 'var(--msfu-color-text-muted, #6b7280)',
                fontFamily: 'monospace'
              }}
            >
              {formatDuration(call.startTime)}
            </span>
          )}

          {/* Caller Info */}
          {call.callerIdRaw && (
            <span
              style={{
                fontSize: '14px',
                color: 'var(--msfu-color-text, #1f2937)'
              }}
            >
              {call.callerIdRaw}
            </span>
          )}
        </div>
      )}

      {/* Control Buttons */}
      <div
        className="msfu-call-controls__buttons"
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 'var(--msfu-spacing-md, 16px)',
          flexWrap: 'wrap'
        }}
      >
        {/* Mute Button */}
        {showMute && canControl && (
          <button
            type="button"
            onClick={handleMute}
            disabled={disabled || isProcessing}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
            aria-pressed={isMuted}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              padding: 'var(--msfu-spacing-sm, 8px)',
              border: 'none',
              backgroundColor: 'transparent',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: isMuted
                  ? 'var(--msfu-color-error, #ef4444)'
                  : 'var(--msfu-color-surface-dark, #f3f4f6)',
                color: isMuted ? 'white' : 'var(--msfu-color-text, #1f2937)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease'
              }}
            >
              {isMuted ? <MuteIcon /> : <UnmuteIcon />}
            </div>
            <span
              style={{
                fontSize: '12px',
                color: 'var(--msfu-color-text-muted, #6b7280)'
              }}
            >
              {isMuted ? 'Unmute' : 'Mute'}
            </span>
          </button>
        )}

        {/* Hold Button */}
        {showHold && canControl && (
          <button
            type="button"
            onClick={handleHold}
            disabled={disabled || isProcessing}
            aria-label={isOnHold ? 'Resume' : 'Hold'}
            aria-pressed={isOnHold}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              padding: 'var(--msfu-spacing-sm, 8px)',
              border: 'none',
              backgroundColor: 'transparent',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: isOnHold
                  ? 'var(--msfu-color-warning, #f59e0b)'
                  : 'var(--msfu-color-surface-dark, #f3f4f6)',
                color: isOnHold ? 'white' : 'var(--msfu-color-text, #1f2937)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease'
              }}
            >
              {isOnHold ? <PlayIcon /> : <PauseIcon />}
            </div>
            <span
              style={{
                fontSize: '12px',
                color: 'var(--msfu-color-text-muted, #6b7280)'
              }}
            >
              {isOnHold ? 'Resume' : 'Hold'}
            </span>
          </button>
        )}

        {/* Transfer Button */}
        {showTransfer && canControl && (
          <button
            type="button"
            onClick={() => setShowTransferDialog(true)}
            disabled={disabled || isProcessing}
            aria-label="Transfer call"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              padding: 'var(--msfu-spacing-sm, 8px)',
              border: 'none',
              backgroundColor: 'transparent',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: 'var(--msfu-color-surface-dark, #f3f4f6)',
                color: 'var(--msfu-color-text, #1f2937)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <TransferIcon />
            </div>
            <span
              style={{
                fontSize: '12px',
                color: 'var(--msfu-color-text-muted, #6b7280)'
              }}
            >
              Transfer
            </span>
          </button>
        )}

        {/* End Call Button */}
        {showEnd && (
          <button
            type="button"
            onClick={handleEnd}
            disabled={disabled || isProcessing || status === 'ended'}
            aria-label="End call"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              padding: 'var(--msfu-spacing-sm, 8px)',
              border: 'none',
              backgroundColor: 'transparent',
              cursor: disabled || status === 'ended' ? 'not-allowed' : 'pointer',
              opacity: disabled || status === 'ended' ? 0.5 : 1
            }}
          >
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: 'var(--msfu-color-error, #ef4444)',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'transform 0.2s ease'
              }}
            >
              <HangUpIcon />
            </div>
            <span
              style={{
                fontSize: '12px',
                color: 'var(--msfu-color-text-muted, #6b7280)'
              }}
            >
              End
            </span>
          </button>
        )}
      </div>

      {/* Transfer Dialog */}
      {showTransferDialog && (
        <div
          className="msfu-call-controls__transfer-dialog"
          style={{
            padding: 'var(--msfu-spacing-md, 16px)',
            backgroundColor: 'var(--msfu-color-surface, white)',
            borderRadius: 'var(--msfu-border-radius, 8px)',
            border: '1px solid var(--msfu-color-border, #e5e7eb)',
            boxShadow: 'var(--msfu-shadow-md, 0 2px 4px -1px rgba(16,24,40,0.06), 0 4px 12px -2px rgba(16,24,40,0.08), 0 0 0 1px rgba(16,24,40,0.04))'
          }}
        >
          <div
            style={{
              marginBottom: 'var(--msfu-spacing-sm, 8px)',
              fontSize: '14px',
              fontWeight: 500
            }}
          >
            Transfer to:
          </div>

          <input
            type="text"
            value={transferTarget}
            onChange={(e) => setTransferTarget(e.target.value)}
            placeholder="Enter phone number or extension"
            style={{
              width: '100%',
              padding: 'var(--msfu-spacing-sm, 8px)',
              border: '1px solid var(--msfu-color-border, #e5e7eb)',
              borderRadius: 'var(--msfu-border-radius, 8px)',
              fontSize: '14px',
              marginBottom: 'var(--msfu-spacing-sm, 8px)'
            }}
          />

          <div
            style={{
              display: 'flex',
              gap: 'var(--msfu-spacing-sm, 8px)',
              justifyContent: 'flex-end'
            }}
          >
            <button
              type="button"
              onClick={() => {
                setShowTransferDialog(false);
                setTransferTarget('');
              }}
              style={{
                padding: 'var(--msfu-spacing-sm, 8px) var(--msfu-spacing-md, 16px)',
                border: '1px solid var(--msfu-color-border, #e5e7eb)',
                borderRadius: 'var(--msfu-border-radius, 8px)',
                backgroundColor: 'transparent',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleTransfer}
              disabled={!transferTarget.trim() || isProcessing}
              style={{
                padding: 'var(--msfu-spacing-sm, 8px) var(--msfu-spacing-md, 16px)',
                border: 'none',
                borderRadius: 'var(--msfu-border-radius, 8px)',
                backgroundColor: 'var(--msfu-color-primary, #14a394)',
                color: 'white',
                cursor: !transferTarget.trim() || isProcessing ? 'not-allowed' : 'pointer',
                opacity: !transferTarget.trim() || isProcessing ? 0.5 : 1,
                fontSize: '14px'
              }}
            >
              Transfer
            </button>
          </div>
        </div>
      )}

      {/* Inline Styles */}
      <style>{`
        @keyframes msfu-pulse-call {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .msfu-call-controls__buttons button:hover > div:first-child {
          transform: scale(1.05);
        }
      `}</style>
    </div>
  );
};

export default CallControlsBlock;
