/**
 * AudioControlsBlock
 *
 * Building block for audio controls (mute/unmute, device selection).
 * Uses mediasfu-reactjs SDK methods: clickAudio, switchAudio.
 *
 * Based on patterns from:
 * - voipsrc/src/hooks/useAudioVideoSDK.ts
 * - voipsrc/src/components/MediaSFU/MediaSFURoomDisplay.tsx
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { AudioControlsBlockProps } from '../types/building-blocks';

// Icons (inline SVG for zero dependencies)
const MicOnIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const MicOffIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="1" y1="1" x2="23" y2="23" />
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

interface AudioDevice {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
}

export const AudioControlsBlock: React.FC<AudioControlsBlockProps> = ({
  sourceParameters,
  updateSourceParameters,
  showMuteButton = true,
  showDeviceSelect = false,
  showVolumeSlider = false,
  onMuteToggle,
  onDeviceChange,
  className = '',
  style,
  disabled = false
}) => {
  const [isMuted, setIsMuted] = useState(!sourceParameters.audioAlreadyOn);
  const [isToggling, setIsToggling] = useState(false);
  const [inputDevices, setInputDevices] = useState<AudioDevice[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([]);
  const [selectedInputDevice, setSelectedInputDevice] = useState<string>('');
  const [selectedOutputDevice, setSelectedOutputDevice] = useState<string>('');
  const [showDeviceDropdown, setShowDeviceDropdown] = useState(false);

  // Sync mute state with sourceParameters
  useEffect(() => {
    const audioOn = sourceParameters.audioAlreadyOn;
    setIsMuted(!audioOn);
  }, [sourceParameters.audioAlreadyOn]);

  // Load audio devices
  useEffect(() => {
    if (!showDeviceSelect) return;

    const loadDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices
          .filter(d => d.kind === 'audioinput')
          .map(d => ({
            deviceId: d.deviceId,
            label: d.label || `Microphone ${d.deviceId.slice(0, 5)}`,
            kind: d.kind as 'audioinput'
          }));
        const outputs = devices
          .filter(d => d.kind === 'audiooutput')
          .map(d => ({
            deviceId: d.deviceId,
            label: d.label || `Speaker ${d.deviceId.slice(0, 5)}`,
            kind: d.kind as 'audiooutput'
          }));

        setInputDevices(inputs);
        setOutputDevices(outputs);

        // Set defaults
        if (inputs.length && !selectedInputDevice) {
          setSelectedInputDevice(inputs[0].deviceId);
        }
        if (outputs.length && !selectedOutputDevice) {
          setSelectedOutputDevice(outputs[0].deviceId);
        }
      } catch (error) {
        console.error('[AudioControlsBlock] Error loading devices:', error);
      }
    };

    loadDevices();

    // Listen for device changes
    navigator.mediaDevices.addEventListener('devicechange', loadDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', loadDevices);
    };
  }, [showDeviceSelect, selectedInputDevice, selectedOutputDevice]);

  // Toggle mute
  const handleToggleMute = useCallback(async () => {
    if (isToggling || disabled) return;

    setIsToggling(true);

    try {
      // Get fresh parameters
      const params = sourceParameters.getUpdatedAllParams?.() || sourceParameters;

      // Import clickAudio from mediasfu-reactjs
      const { clickAudio } = await import('mediasfu-reactjs');

      // Cast to any since sourceParameters is the runtime state object
      await clickAudio({ parameters: params as any });

      // State will update via sourceParameters
      const newMuted = !isMuted;
      onMuteToggle?.(newMuted);
    } catch (error) {
      console.error('[AudioControlsBlock] Error toggling audio:', error);
    } finally {
      setIsToggling(false);
    }
  }, [sourceParameters, isMuted, isToggling, disabled, onMuteToggle]);

  // Switch input device
  const handleInputDeviceChange = useCallback(async (deviceId: string) => {
    if (disabled) return;

    try {
      const params = sourceParameters.getUpdatedAllParams?.() || sourceParameters;

      const { switchAudio } = await import('mediasfu-reactjs');

      // Cast to any since sourceParameters is the runtime state object
      await switchAudio({
        audioPreference: deviceId,
        parameters: params as any
      });

      setSelectedInputDevice(deviceId);
      onDeviceChange?.(deviceId);
      setShowDeviceDropdown(false);
    } catch (error) {
      console.error('[AudioControlsBlock] Error switching audio device:', error);
    }
  }, [sourceParameters, disabled, onDeviceChange]);

  // Handle output device (speaker) change
  const handleOutputDeviceChange = useCallback((deviceId: string) => {
    setSelectedOutputDevice(deviceId);

    // Apply to all audio elements
    const audioElements = document.querySelectorAll('audio');
    audioElements.forEach(async (audio) => {
      if ((audio as any).setSinkId) {
        try {
          await (audio as any).setSinkId(deviceId);
        } catch (err) {
          console.warn('[AudioControlsBlock] Could not set output device:', err);
        }
      }
    });

    setShowDeviceDropdown(false);
  }, []);

  // Get audio level for visualization
  const audioLevel = sourceParameters.audioLevel || 0;

  return (
    <div
      className={`msfu-audio-controls ${className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--msfu-spacing-sm, 8px)',
        ...style
      }}
    >
      {/* Mute Button */}
      {showMuteButton && (
        <button
          type="button"
          className={`msfu-audio-controls__mute-btn ${isMuted ? 'msfu-audio-controls__mute-btn--muted' : ''}`}
          onClick={handleToggleMute}
          disabled={disabled || isToggling}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
          aria-pressed={isMuted}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '48px',
            height: '48px',
            borderRadius: 'var(--msfu-border-radius, 8px)',
            border: 'none',
            backgroundColor: isMuted
              ? 'var(--msfu-color-error, #ef4444)'
              : 'var(--msfu-color-primary, #14a394)',
            color: 'white',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            transition: 'all 0.2s ease',
            position: 'relative',
            overflow: 'hidden'
          }}
        >
          {isMuted ? <MicOffIcon /> : <MicOnIcon />}

          {/* Audio level indicator */}
          {!isMuted && audioLevel > 0 && (
            <div
              className="msfu-audio-controls__level"
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: `${Math.min(audioLevel * 100, 100)}%`,
                backgroundColor: 'rgba(255, 255, 255, 0.3)',
                transition: 'height 0.1s ease'
              }}
            />
          )}
        </button>
      )}

      {/* Device Selection */}
      {showDeviceSelect && (
        <div
          className="msfu-audio-controls__device-select"
          style={{ position: 'relative' }}
        >
          <button
            type="button"
            className="msfu-audio-controls__device-btn"
            onClick={() => setShowDeviceDropdown(!showDeviceDropdown)}
            disabled={disabled}
            aria-label="Select audio device"
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
            <span>Devices</span>
            <ChevronDownIcon />
          </button>

          {/* Dropdown */}
          {showDeviceDropdown && (
            <div
              className="msfu-audio-controls__dropdown"
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
              {/* Input Devices */}
              {inputDevices.length > 0 && (
                <>
                  <div
                    style={{
                      padding: '4px 12px',
                      fontSize: '12px',
                      color: 'var(--msfu-color-text-muted, #6b7280)',
                      fontWeight: 500
                    }}
                  >
                    Microphone
                  </div>
                  {inputDevices.map(device => (
                    <button
                      key={device.deviceId}
                      type="button"
                      onClick={() => handleInputDeviceChange(device.deviceId)}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '8px 12px',
                        textAlign: 'left',
                        border: 'none',
                        backgroundColor: device.deviceId === selectedInputDevice
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
                </>
              )}

              {/* Output Devices */}
              {outputDevices.length > 0 && (
                <>
                  <div
                    style={{
                      padding: '4px 12px 4px 12px',
                      marginTop: '8px',
                      fontSize: '12px',
                      color: 'var(--msfu-color-text-muted, #6b7280)',
                      fontWeight: 500,
                      borderTop: '1px solid var(--msfu-color-border, #e5e7eb)'
                    }}
                  >
                    Speaker
                  </div>
                  {outputDevices.map(device => (
                    <button
                      key={device.deviceId}
                      type="button"
                      onClick={() => handleOutputDeviceChange(device.deviceId)}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '8px 12px',
                        textAlign: 'left',
                        border: 'none',
                        backgroundColor: device.deviceId === selectedOutputDevice
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
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Volume Slider (for output) */}
      {showVolumeSlider && (
        <div
          className="msfu-audio-controls__volume"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <input
            type="range"
            min="0"
            max="100"
            defaultValue="100"
            disabled={disabled}
            aria-label="Volume"
            style={{
              width: '80px',
              height: '4px',
              cursor: disabled ? 'not-allowed' : 'pointer'
            }}
            onChange={(e) => {
              const volume = parseInt(e.target.value, 10) / 100;
              document.querySelectorAll('audio').forEach(audio => {
                audio.volume = volume;
              });
            }}
          />
        </div>
      )}
    </div>
  );
};

export default AudioControlsBlock;
