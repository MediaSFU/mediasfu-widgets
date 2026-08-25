/**
 * ParticipantsBlock
 *
 * Building block for displaying room participants.
 * Shows normalized participant list from sourceParameters.
 *
 * Based on patterns from:
 * - voipsrc/src/components/MediaSFU/MediaSFURoomDisplay.tsx
 * - agents-src/components/AgentsPlayground.tsx
 */

import React, { useState, useMemo, useCallback } from 'react';
import type { ParticipantsBlockProps, Participant } from '../types/building-blocks';

// Icons
const MicOnSmallIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
  </svg>
);

const MicOffSmallIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="1" y1="1" x2="23" y2="23" />
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
  </svg>
);

const UserIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const HostBadge = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
);

interface NormalizedParticipant extends Participant {
  isHost: boolean;
  isMe: boolean;
  isSipAgent: boolean;
  displayName: string;
  audioLevel: number;
}

export const ParticipantsBlock: React.FC<ParticipantsBlockProps> = ({
  sourceParameters,
  updateSourceParameters,
  showAvatars = true,
  showAudioLevels = true,
  maxVisible = 10,
  onParticipantClick,
  className = '',
  style,
  disabled = false
}) => {
  const [expanded, setExpanded] = useState(false);

  // Normalize and filter participants
  const normalizedParticipants = useMemo((): NormalizedParticipant[] => {
    const participants = sourceParameters.participants || [];
    const audioLevels = sourceParameters.participantsAudioLevels || new Map();
    const currentMember = sourceParameters.member || '';

    return participants
      .filter((p): p is Participant => !!(p && p.name))
      .map((p): NormalizedParticipant => {
        // Detect SIP agents (based on MediaSFURoomDisplay pattern)
        const isSipAgent = p.id?.startsWith('sip_') && p.id?.endsWith('_agent');

        // Detect host (islevel === '2')
        const isHost = p.islevel === '2';

        // Detect self
        const isMe = p.name === currentMember || p.id === sourceParameters.memberId;

        // Get audio level
        const audioLevel = audioLevels.get(p.id) || 0;

        // Format display name
        let displayName = p.name;
        if (isSipAgent) {
          displayName = 'AI Agent';
        } else if (isMe) {
          displayName = `${p.name} (You)`;
        }

        return {
          ...p,
          isHost,
          isMe,
          isSipAgent,
          displayName,
          audioLevel
        };
      })
      // Sort: host first, then self, then alphabetically
      .sort((a, b) => {
        if (a.isHost && !b.isHost) return -1;
        if (!a.isHost && b.isHost) return 1;
        if (a.isMe && !b.isMe) return -1;
        if (!a.isMe && b.isMe) return 1;
        return a.displayName.localeCompare(b.displayName);
      });
  }, [sourceParameters.participants, sourceParameters.participantsAudioLevels, sourceParameters.member, sourceParameters.memberId]);

  // Visible participants (respecting maxVisible)
  const visibleParticipants = useMemo(() => {
    if (expanded) return normalizedParticipants;
    return normalizedParticipants.slice(0, maxVisible);
  }, [normalizedParticipants, maxVisible, expanded]);

  const remainingCount = normalizedParticipants.length - maxVisible;
  const showExpandButton = remainingCount > 0 && !expanded;

  // Get avatar color based on name
  const getAvatarColor = (name: string): string => {
    const colors = [
      '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
      '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  // Get initials
  const getInitials = (name: string): string => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const handleParticipantClick = useCallback((participant: NormalizedParticipant) => {
    if (disabled) return;
    onParticipantClick?.(participant);
  }, [disabled, onParticipantClick]);

  if (normalizedParticipants.length === 0) {
    return (
      <div
        className={`msfu-participants msfu-participants--empty ${className}`}
        style={{
          padding: 'var(--msfu-spacing-md, 16px)',
          textAlign: 'center',
          color: 'var(--msfu-color-text-muted, #6b7280)',
          ...style
        }}
      >
        No participants yet
      </div>
    );
  }

  return (
    <div
      className={`msfu-participants ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--msfu-spacing-xs, 4px)',
        ...style
      }}
    >
      {/* Header */}
      <div
        className="msfu-participants__header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--msfu-spacing-xs, 4px) 0',
          fontSize: '14px',
          fontWeight: 500,
          color: 'var(--msfu-color-text-muted, #6b7280)'
        }}
      >
        <span>Participants ({normalizedParticipants.length})</span>
      </div>

      {/* Participants List */}
      <div
        className="msfu-participants__list"
        role="list"
        aria-label="Participants list"
      >
        {visibleParticipants.map((participant) => (
          <div
            key={participant.id || participant.name}
            className={`msfu-participants__item ${participant.isMe ? 'msfu-participants__item--me' : ''}`}
            role="listitem"
            onClick={() => handleParticipantClick(participant)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--msfu-spacing-sm, 8px)',
              padding: 'var(--msfu-spacing-sm, 8px)',
              borderRadius: 'var(--msfu-border-radius, 8px)',
              backgroundColor: participant.isMe
                ? 'var(--msfu-color-primary-light, #e6f7f4)'
                : 'transparent',
              cursor: onParticipantClick && !disabled ? 'pointer' : 'default',
              transition: 'background-color 0.15s ease'
            }}
          >
            {/* Avatar */}
            {showAvatars && (
              <div
                className="msfu-participants__avatar"
                style={{
                  position: 'relative',
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  backgroundColor: participant.isSipAgent
                    ? 'var(--msfu-color-secondary, #8b5cf6)'
                    : getAvatarColor(participant.name),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: 600,
                  flexShrink: 0
                }}
              >
                {participant.isSipAgent ? (
                  <UserIcon />
                ) : (
                  getInitials(participant.name)
                )}

                {/* Audio Level Ring */}
                {showAudioLevels && participant.audioLevel > 0.1 && (
                  <div
                    className="msfu-participants__audio-ring"
                    style={{
                      position: 'absolute',
                      inset: '-3px',
                      borderRadius: '50%',
                      border: `2px solid var(--msfu-color-success, #10b981)`,
                      opacity: Math.min(participant.audioLevel, 1),
                      animation: 'msfu-pulse 0.3s ease-out'
                    }}
                  />
                )}
              </div>
            )}

            {/* Name & Badges */}
            <div
              className="msfu-participants__info"
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '2px'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <span
                  className="msfu-participants__name"
                  style={{
                    fontSize: '14px',
                    fontWeight: participant.isMe ? 600 : 400,
                    color: 'var(--msfu-color-text, #1f2937)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {participant.displayName}
                </span>

                {participant.isHost && (
                  <span
                    className="msfu-participants__host-badge"
                    title="Host"
                    style={{
                      color: 'var(--msfu-color-warning, #f59e0b)',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    <HostBadge />
                  </span>
                )}
              </div>

              {participant.isSipAgent && (
                <span
                  style={{
                    fontSize: '12px',
                    color: 'var(--msfu-color-secondary, #8b5cf6)'
                  }}
                >
                  AI Voice Agent
                </span>
              )}
            </div>

            {/* Audio Status */}
            <div
              className="msfu-participants__audio-status"
              style={{
                display: 'flex',
                alignItems: 'center',
                color: participant.muted || !participant.audioOn
                  ? 'var(--msfu-color-error, #ef4444)'
                  : 'var(--msfu-color-success, #10b981)'
              }}
            >
              {participant.muted || !participant.audioOn ? (
                <MicOffSmallIcon />
              ) : (
                <MicOnSmallIcon />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Expand Button */}
      {showExpandButton && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          disabled={disabled}
          style={{
            padding: 'var(--msfu-spacing-sm, 8px)',
            border: 'none',
            backgroundColor: 'transparent',
            color: 'var(--msfu-color-primary, #14a394)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            textAlign: 'center'
          }}
        >
          +{remainingCount} more participants
        </button>
      )}

      {/* Collapse Button */}
      {expanded && remainingCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          disabled={disabled}
          style={{
            padding: 'var(--msfu-spacing-sm, 8px)',
            border: 'none',
            backgroundColor: 'transparent',
            color: 'var(--msfu-color-primary, #14a394)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            textAlign: 'center'
          }}
        >
          Show less
        </button>
      )}

      {/* Inline Styles for animation */}
      <style>{`
        @keyframes msfu-pulse {
          0% { transform: scale(0.95); opacity: 0.7; }
          100% { transform: scale(1); opacity: 0; }
        }

        .msfu-participants__item:hover {
          background-color: var(--msfu-color-hover, #f3f4f6) !important;
        }

        .msfu-participants__item--me:hover {
          background-color: var(--msfu-color-primary-light, #e6f7f4) !important;
        }
      `}</style>
    </div>
  );
};

export default ParticipantsBlock;
