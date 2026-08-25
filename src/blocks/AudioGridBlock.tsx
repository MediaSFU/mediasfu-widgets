/**
 * AudioGridBlock
 *
 * Building block for displaying audio-only participant streams.
 * Renders a grid of audio elements with visual audio level indicators.
 *
 * Based on patterns from:
 * - voipsrc/src/components/MediaSFU/MediaSFURoomDisplay.tsx
 * - mediasfu-reactjs AudioGrid component
 */

import React, { useEffect, useRef, useMemo, useCallback } from 'react';
import type { AudioGridBlockProps, AudioOnlyStream, Participant } from '../types/building-blocks';

// Icons
const VolumeHighIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
  </svg>
);

const VolumeMutedIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <line x1="23" y1="9" x2="17" y2="15" />
    <line x1="17" y1="9" x2="23" y2="15" />
  </svg>
);

interface AudioStreamItem {
  id: string;
  name: string;
  stream?: MediaStream;
  audioLevel: number;
  isMuted: boolean;
  producerId?: string;
}

export const AudioGridBlock: React.FC<AudioGridBlockProps> = ({
  sourceParameters,
  updateSourceParameters,
  showLabels = true,
  showAudioLevels = true,
  layout = 'grid',
  className = '',
  style,
  disabled = false
}) => {
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());

  // Normalize audio streams from sourceParameters
  const audioStreams = useMemo((): AudioStreamItem[] => {
    const streams: AudioStreamItem[] = [];
    const audioOnlyStreams = sourceParameters.audioOnlyStreams || [];
    const allAudioStreams = sourceParameters.allAudioStreams || [];
    const audioLevels = sourceParameters.participantsAudioLevels || new Map();
    const participants = sourceParameters.participants || [];
    const currentMember = sourceParameters.member;

    // Process audioOnlyStreams
    audioOnlyStreams.forEach((aos: AudioOnlyStream) => {
      if (!aos.name || aos.name === currentMember) return;

      // Find corresponding participant for mute status
      const participant = participants.find((p: Participant) => p.name === aos.name);

      // Find corresponding stream
      const streamData = allAudioStreams.find((s: any) =>
        s.producerId === aos.producerId || s.id === aos.id
      );

      streams.push({
        id: aos.id || aos.name,
        name: aos.name,
        stream: streamData?.stream,
        audioLevel: audioLevels.get(aos.id) || 0,
        isMuted: participant?.muted || false,
        producerId: aos.producerId
      });
    });

    return streams;
  }, [
    sourceParameters.audioOnlyStreams,
    sourceParameters.allAudioStreams,
    sourceParameters.participantsAudioLevels,
    sourceParameters.participants,
    sourceParameters.member
  ]);

  // Attach streams to audio elements
  useEffect(() => {
    audioStreams.forEach((item) => {
      const audioEl = audioRefs.current.get(item.id);
      if (audioEl && item.stream) {
        if (audioEl.srcObject !== item.stream) {
          audioEl.srcObject = item.stream;
          audioEl.play().catch(err => {
            console.warn('[AudioGridBlock] Autoplay blocked:', err);
          });
        }
      }
    });

    // Cleanup removed streams
    const currentIds = new Set(audioStreams.map(s => s.id));
    audioRefs.current.forEach((el, id) => {
      if (!currentIds.has(id)) {
        el.srcObject = null;
        audioRefs.current.delete(id);
      }
    });
  }, [audioStreams]);

  // Register audio element ref
  const setAudioRef = useCallback((id: string, el: HTMLAudioElement | null) => {
    if (el) {
      audioRefs.current.set(id, el);
    } else {
      audioRefs.current.delete(id);
    }
  }, []);

  // Get initials for avatar
  const getInitials = (name: string): string => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Get avatar color
  const getAvatarColor = (name: string): string => {
    const colors = [
      '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
      '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'
    ];
    return colors[name.charCodeAt(0) % colors.length];
  };

  if (audioStreams.length === 0) {
    return (
      <div
        className={`msfu-audio-grid msfu-audio-grid--empty ${className}`}
        style={{
          padding: 'var(--msfu-spacing-lg, 24px)',
          textAlign: 'center',
          color: 'var(--msfu-color-text-muted, #6b7280)',
          ...style
        }}
      >
        No audio participants
      </div>
    );
  }

  return (
    <div
      className={`msfu-audio-grid msfu-audio-grid--${layout} ${className}`}
      style={{
        display: layout === 'grid' ? 'grid' : 'flex',
        gridTemplateColumns: layout === 'grid'
          ? 'repeat(auto-fill, minmax(120px, 1fr))'
          : undefined,
        flexDirection: layout === 'list' ? 'column' : undefined,
        gap: 'var(--msfu-spacing-md, 16px)',
        padding: 'var(--msfu-spacing-md, 16px)',
        ...style
      }}
      role="list"
      aria-label="Audio participants"
    >
      {audioStreams.map((stream) => (
        <div
          key={stream.id}
          className="msfu-audio-grid__item"
          role="listitem"
          style={{
            display: 'flex',
            flexDirection: layout === 'grid' ? 'column' : 'row',
            alignItems: 'center',
            gap: 'var(--msfu-spacing-sm, 8px)',
            padding: 'var(--msfu-spacing-md, 16px)',
            backgroundColor: 'var(--msfu-color-surface, white)',
            borderRadius: 'var(--msfu-border-radius, 8px)',
            border: '1px solid var(--msfu-color-border, #e5e7eb)',
            position: 'relative',
            transition: 'box-shadow 0.2s ease',
            boxShadow: showAudioLevels && stream.audioLevel > 0.2
              ? `0 0 0 2px var(--msfu-color-success, #10b981)`
              : 'none'
          }}
        >
          {/* Hidden Audio Element */}
          <audio
            ref={(el) => setAudioRef(stream.id, el)}
            autoPlay
            playsInline
            style={{ display: 'none' }}
          />

          {/* Avatar with Audio Level Indicator */}
          <div
            className="msfu-audio-grid__avatar"
            style={{
              position: 'relative',
              width: layout === 'grid' ? '64px' : '48px',
              height: layout === 'grid' ? '64px' : '48px',
              borderRadius: '50%',
              backgroundColor: getAvatarColor(stream.name),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: layout === 'grid' ? '20px' : '16px',
              fontWeight: 600,
              flexShrink: 0
            }}
          >
            {getInitials(stream.name)}

            {/* Audio Level Ring */}
            {showAudioLevels && stream.audioLevel > 0.1 && (
              <div
                className="msfu-audio-grid__level-ring"
                style={{
                  position: 'absolute',
                  inset: '-4px',
                  borderRadius: '50%',
                  border: '2px solid var(--msfu-color-success, #10b981)',
                  opacity: Math.min(stream.audioLevel * 2, 1),
                  animation: 'msfu-audio-pulse 0.3s ease-out'
                }}
              />
            )}

            {/* Muted Indicator */}
            {stream.isMuted && (
              <div
                className="msfu-audio-grid__muted-badge"
                style={{
                  position: 'absolute',
                  bottom: '-4px',
                  right: '-4px',
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--msfu-color-error, #ef4444)',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '10px'
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              </div>
            )}
          </div>

          {/* Name & Status */}
          {showLabels && (
            <div
              className="msfu-audio-grid__info"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: layout === 'grid' ? 'center' : 'flex-start',
                gap: '2px',
                minWidth: 0,
                flex: layout === 'list' ? 1 : undefined
              }}
            >
              <span
                className="msfu-audio-grid__name"
                style={{
                  fontSize: '14px',
                  fontWeight: 500,
                  color: 'var(--msfu-color-text, #1f2937)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '100%'
                }}
              >
                {stream.name}
              </span>

              {/* Audio Status */}
              <span
                style={{
                  fontSize: '12px',
                  color: stream.isMuted
                    ? 'var(--msfu-color-error, #ef4444)'
                    : 'var(--msfu-color-success, #10b981)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                {stream.isMuted ? (
                  <>
                    <VolumeMutedIcon />
                    Muted
                  </>
                ) : stream.audioLevel > 0.1 ? (
                  <>
                    <VolumeHighIcon />
                    Speaking
                  </>
                ) : (
                  'Active'
                )}
              </span>
            </div>
          )}

          {/* Audio Level Bar (list layout) */}
          {showAudioLevels && layout === 'list' && (
            <div
              className="msfu-audio-grid__level-bar"
              style={{
                width: '60px',
                height: '4px',
                backgroundColor: 'var(--msfu-color-border, #e5e7eb)',
                borderRadius: '2px',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.min(stream.audioLevel * 100, 100)}%`,
                  backgroundColor: 'var(--msfu-color-success, #10b981)',
                  transition: 'width 0.1s ease'
                }}
              />
            </div>
          )}
        </div>
      ))}

      {/* Inline Styles */}
      <style>{`
        @keyframes msfu-audio-pulse {
          0% { transform: scale(0.95); opacity: 0.7; }
          100% { transform: scale(1.05); opacity: 0; }
        }

        .msfu-audio-grid__item:hover {
          box-shadow: var(--msfu-shadow-md, 0 2px 4px -1px rgba(16,24,40,0.06), 0 4px 12px -2px rgba(16,24,40,0.08), 0 0 0 1px rgba(16,24,40,0.04));
        }
      `}</style>
    </div>
  );
};

export default AudioGridBlock;
