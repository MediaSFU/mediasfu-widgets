/**
 * VideoControlsBlock
 *
 * Building block for video controls (on/off, device selection, preview).
 * Uses mediasfu-reactjs SDK methods: clickVideo, switchVideo.
 *
 * Based on patterns from:
 * - voipsrc/src/hooks/useAudioVideoSDK.ts
 * - voipsrc/src/components/MediaSFU/MediaSFURoomDisplay.tsx
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { VideoControlsBlockProps } from '../types/building-blocks';

// Icons (inline SVG for zero dependencies)
const VideoOnIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

const VideoOffIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

const SwitchCameraIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
    <path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5" />
    <circle cx="12" cy="12" r="3" />
    <path d="m18 22-3-3 3-3" />
    <path d="m6 2 3 3-3 3" />
  </svg>
);

interface VideoDevice {
  deviceId: string;
  label: string;
}

export const VideoControlsBlock: React.FC<VideoControlsBlockProps> = ({
  sourceParameters,
  updateSourceParameters,
  showVideoToggle = true,
  showDeviceSelect = false,
  showPreview = false,
  onVideoToggle,
  onDeviceChange,
  className = '',
  style,
  disabled = false
}) => {
  const [videoOn, setVideoOn] = useState(!!sourceParameters.videoAlreadyOn);
  const [isToggling, setIsToggling] = useState(false);
  const [devices, setDevices] = useState<VideoDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [showDeviceDropdown, setShowDeviceDropdown] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  const previewRef = useRef<HTMLVideoElement>(null);

  // Sync video state with sourceParameters
  useEffect(() => {
    setVideoOn(!!sourceParameters.videoAlreadyOn);
  }, [sourceParameters.videoAlreadyOn]);

  // Load video devices
  useEffect(() => {
    if (!showDeviceSelect) return;

    const loadDevices = async () => {
      try {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = allDevices
          .filter(d => d.kind === 'videoinput')
          .map(d => ({
            deviceId: d.deviceId,
            label: d.label || `Camera ${d.deviceId.slice(0, 5)}`
          }));

        setDevices(videoDevices);

        if (videoDevices.length && !selectedDevice) {
          setSelectedDevice(videoDevices[0].deviceId);
        }
      } catch (error) {
        console.error('[VideoControlsBlock] Error loading devices:', error);
      }
    };

    loadDevices();

    navigator.mediaDevices.addEventListener('devicechange', loadDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', loadDevices);
    };
  }, [showDeviceSelect, selectedDevice]);

  // Handle preview stream
  useEffect(() => {
    if (!showPreview || !previewRef.current) return;

    const localStream = sourceParameters.localStream;
    if (localStream && videoOn) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        previewRef.current.srcObject = new MediaStream([videoTrack]);
      }
    } else {
      previewRef.current.srcObject = null;
    }
  }, [showPreview, sourceParameters.localStream, videoOn]);

  // Toggle video
  const handleToggleVideo = useCallback(async () => {
    if (isToggling || disabled) return;

    setIsToggling(true);

    try {
      const params = sourceParameters.getUpdatedAllParams?.() || sourceParameters;

      const { clickVideo } = await import('mediasfu-reactjs');

      // Cast to any since sourceParameters is the runtime state object
      await clickVideo({ parameters: params as any });

      const newVideoOn = !videoOn;
      onVideoToggle?.(newVideoOn);
    } catch (error) {
      console.error('[VideoControlsBlock] Error toggling video:', error);
    } finally {
      setIsToggling(false);
    }
  }, [sourceParameters, videoOn, isToggling, disabled, onVideoToggle]);

  // Switch camera device
  const handleDeviceChange = useCallback(async (deviceId: string) => {
    if (disabled) return;

    try {
      const params = sourceParameters.getUpdatedAllParams?.() || sourceParameters;

      const { switchVideo } = await import('mediasfu-reactjs');

      // Cast to any since sourceParameters is the runtime state object
      await switchVideo({
        videoPreference: deviceId,
        parameters: params as any
      });

      setSelectedDevice(deviceId);
      onDeviceChange?.(deviceId);
      setShowDeviceDropdown(false);
    } catch (error) {
      console.error('[VideoControlsBlock] Error switching video device:', error);
    }
  }, [sourceParameters, disabled, onDeviceChange]);

  // Switch camera (front/back on mobile)
  const handleSwitchCamera = useCallback(async () => {
    if (disabled) return;

    try {
      const params = sourceParameters.getUpdatedAllParams?.() || sourceParameters;

      const mediasfu = await import('mediasfu-reactjs');

      // switchCamera may not be exported directly, use switchVideoAlt or similar
      if ('switchCamera' in mediasfu) {
        await (mediasfu as any).switchCamera({ parameters: params as any });
      }

      setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
    } catch (error) {
      console.error('[VideoControlsBlock] Error switching camera:', error);
    }
  }, [sourceParameters, disabled]);

  // Check if mobile device (for camera switch button)
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  return (
    <div
      className={`msfu-video-controls ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--msfu-spacing-sm, 8px)',
        ...style
      }}
    >
      {/* Video Preview */}
      {showPreview && (
        <div
          className="msfu-video-controls__preview"
          style={{
            position: 'relative',
            width: '100%',
            maxWidth: '320px',
            aspectRatio: '16/9',
            backgroundColor: 'var(--msfu-color-background-dark, #1f2937)',
            borderRadius: 'var(--msfu-border-radius, 8px)',
            overflow: 'hidden'
          }}
        >
          {videoOn ? (
            <video
              ref={previewRef}
              autoPlay
              playsInline
              muted
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: facingMode === 'user' ? 'scaleX(-1)' : 'none'
              }}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                height: '100%',
                color: 'var(--msfu-color-text-muted, #6b7280)'
              }}
            >
              <VideoOffIcon />
            </div>
          )}
        </div>
      )}

      {/* Controls Row */}
      <div
        className="msfu-video-controls__buttons"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--msfu-spacing-sm, 8px)'
        }}
      >
        {/* Video Toggle Button */}
        {showVideoToggle && (
          <button
            type="button"
            className={`msfu-video-controls__toggle-btn ${videoOn ? '' : 'msfu-video-controls__toggle-btn--off'}`}
            onClick={handleToggleVideo}
            disabled={disabled || isToggling}
            aria-label={videoOn ? 'Turn off video' : 'Turn on video'}
            aria-pressed={videoOn}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '48px',
              height: '48px',
              borderRadius: 'var(--msfu-border-radius, 8px)',
              border: 'none',
              backgroundColor: videoOn
                ? 'var(--msfu-color-primary, #14a394)'
                : 'var(--msfu-color-error, #ef4444)',
              color: 'white',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
              transition: 'all 0.2s ease'
            }}
          >
            {videoOn ? <VideoOnIcon /> : <VideoOffIcon />}
          </button>
        )}

        {/* Switch Camera Button (Mobile only) */}
        {isMobile && videoOn && (
          <button
            type="button"
            className="msfu-video-controls__switch-btn"
            onClick={handleSwitchCamera}
            disabled={disabled}
            aria-label="Switch camera"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '40px',
              height: '40px',
              borderRadius: 'var(--msfu-border-radius, 8px)',
              border: '1px solid var(--msfu-color-border, #e5e7eb)',
              backgroundColor: 'var(--msfu-color-surface, white)',
              color: 'var(--msfu-color-text, #1f2937)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1
            }}
          >
            <SwitchCameraIcon />
          </button>
        )}

        {/* Device Selection (Desktop) */}
        {showDeviceSelect && devices.length > 1 && (
          <div
            className="msfu-video-controls__device-select"
            style={{ position: 'relative' }}
          >
            <button
              type="button"
              onClick={() => setShowDeviceDropdown(!showDeviceDropdown)}
              disabled={disabled}
              aria-label="Select camera"
              aria-expanded={showDeviceDropdown}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '8px 12px',
                borderRadius: 'var(--msfu-border-radius, 8px)',
                border: '1px solid var(--msfu-color-border, #e5e7eb)',
                backgroundColor: 'var(--msfu-color-surface, white)',
                color: 'var(--msfu-color-text, #1f2937)',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1,
                fontSize: '14px'
              }}
            >
              <span>Camera</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {/* Dropdown */}
            {showDeviceDropdown && (
              <div
                className="msfu-video-controls__dropdown"
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: '4px',
                  minWidth: '200px',
                  backgroundColor: 'var(--msfu-color-surface, white)',
                  border: '1px solid var(--msfu-color-border, #e5e7eb)',
                  borderRadius: 'var(--msfu-border-radius, 8px)',
                  boxShadow: 'var(--msfu-shadow-md, 0 2px 4px -1px rgba(16,24,40,0.06), 0 4px 12px -2px rgba(16,24,40,0.08), 0 0 0 1px rgba(16,24,40,0.04))',
                  zIndex: 1000,
                  padding: '8px 0'
                }}
              >
                {devices.map(device => (
                  <button
                    key={device.deviceId}
                    type="button"
                    onClick={() => handleDeviceChange(device.deviceId)}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '8px 12px',
                      textAlign: 'left',
                      border: 'none',
                      backgroundColor: device.deviceId === selectedDevice
                        ? 'var(--msfu-color-primary-light, #e6f7f4)'
                        : 'transparent',
                      color: 'var(--msfu-color-text, #1f2937)',
                      cursor: 'pointer',
                      fontSize: '14px'
                    }}
                  >
                    {device.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoControlsBlock;
