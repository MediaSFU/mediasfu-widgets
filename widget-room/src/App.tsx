/**
 * MediaSFU Widget Room
 *
 * This app is hosted at widget.mediasfu.com/room and loaded in an iframe
 * by the <mediasfu-meeting-room> web component.
 *
 * It reads configuration from URL parameters and renders the MediaSFU SDK.
 *
 * Supports two modes:
 * 1. Meeting Room Mode: Uses 'token' for validation
 * 2. Click-to-Call Mode: Uses direct credentials (apiKey, apiUserName, roomName, etc.)
 *    - After joining, emits 'startWidgetCall' to activate widget call mode
 *    - Widget calls are treated like SIP calls for agent/playback routing
 */

import { useMemo, useEffect, useState, useRef, useCallback } from 'react';
import {
  ModernMediasfuGeneric,
  ModernPreJoinPage,
  AudioGrid,
  clickAudio,
  ClickAudioOptions,
  switchAudio,
  SwitchAudioOptions
} from 'mediasfu-reactjs';
import 'mediasfu-reactjs/dist/main.css';
import type { Socket } from 'socket.io-client';
import { captureCallBootstrap, redeemCallBootstrap } from './callBootstrap';

// =============================================================================
// Logger Configuration
// =============================================================================
// Log levels: 0 = none, 1 = error, 2 = warn, 3 = info, 4 = debug, 5 = verbose
// Change this value to control log output
const LOG_LEVEL = 3; // Default: info (errors, warnings, and important info)

const logger = {
  error: (...args: unknown[]) => LOG_LEVEL >= 1 && console.error('[ClickToCall]', ...args),
  warn: (...args: unknown[]) => LOG_LEVEL >= 2 && console.warn('[ClickToCall]', ...args),
  info: (...args: unknown[]) => LOG_LEVEL >= 3 && console.log('[ClickToCall]', ...args),
  debug: (...args: unknown[]) => LOG_LEVEL >= 4 && console.log('[ClickToCall:DEBUG]', ...args),
  verbose: (...args: unknown[]) => LOG_LEVEL >= 5 && console.log('[ClickToCall:VERBOSE]', ...args),
};
// =============================================================================

const showExtraControls = false; // Show extra controls for testing when in debug mode
const initialCallBootstrap = captureCallBootstrap();

// Use an explicit deployment override when supplied; otherwise use MediaSFU Cloud.
function getApiBaseUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const explicit = params.get('apiUrl');
  if (explicit) return explicit.replace(/\/$/, '');

  return 'https://mediasfu.com';
}

// Check if this is a click-to-call widget call
function isClickToCall(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('isWidgetCall') === 'true' || params.has('roomName');
}

// Parse URL parameters for click-to-call
interface ClickToCallConfig {
  bootstrap: string;
  roomName: string;
  userName: string;
  apiUserName: string;
  apiKey: string;
  islevel: string;
  sec: string;
  socketUrl: string;
  widgetKey: string;
  audioOnly: boolean;
  // Widget call identifiers for agent flow
  sipCallId: string;
  callId: string;
  // SIP config identifiers for proper config resolution in drachtio
  sipConfigId: string;  // SIPConfig ID for agent/call settings lookup
  did: string;          // DID for alternative config lookup
  // Auto-start agent when connected
  autoStartAgent: boolean;
  // Agent name if configured
  agentName: string;
  // Auto-record widget calls
  autoRecord: boolean;
  // Caller info
  callerName: string;
  callerNumber: string;
  callerEmail: string;
  // Session token for validation
  sessionToken: string;
  serverCallStarted: boolean;
  // Internal marker for when credentials have been validated
  _credentialsValidated?: boolean;
}

function parseClickToCallParams(): ClickToCallConfig {
  const params = new URLSearchParams(window.location.search);
  // sipCallId or callId is used to track this widget call for agent start
  const sipCallId = params.get('sipCallId') || params.get('callId') || '';
  const userName = params.get('userName') || params.get('name') || 'Web Caller';
  const sessionToken = params.get('sessionToken') || '';
  return {
    bootstrap: initialCallBootstrap,
    roomName: params.get('roomName') || params.get('room') || sipCallId || `room_${Date.now()}`,
    userName: userName,
    apiUserName: params.get('apiUserName') || '',
    apiKey: params.get('apiKey') || '',
    islevel: params.get('islevel') || '2', // Host level by default for widget calls
    sec: params.get('sec') || '',
    socketUrl: params.get('socketUrl') || '',
    widgetKey: params.get('widgetKey') || '',
    audioOnly: params.get('audioOnly') === 'true',
    sipCallId: sipCallId,
    callId: sipCallId,
    // SIP config identifiers for drachtio to resolve full config
    sipConfigId: params.get('sipConfigId') || '',
    did: params.get('did') || '',
    autoStartAgent: params.get('autoStartAgent') !== 'false', // Default true
    agentName: params.get('agentName') || '',
    autoRecord: params.get('autoRecord') === 'true',
    // Caller info for tracking
    callerName: params.get('callerName') || userName,
    callerNumber: params.get('callerNumber') || '',
    callerEmail: params.get('callerEmail') || '',
    sessionToken: sessionToken,
    serverCallStarted: params.get('serverCallStarted') === 'true',
  };
}

// Parse URL parameters into config object
interface RoomConfig {
  // Basic
  room: string;
  name: string;
  email: string;
  role: 'host' | 'participant';
  token: string;
  theme: 'light' | 'dark';
  features: string[];
  disabled: string[];

  // Layout
  layout: 'auto' | 'grid' | 'focus' | 'audio-only';
  maxParticipants: number;
  miniCards: boolean;
  videoCards: boolean;
  audioCards: boolean;

  // Controls
  controls: string[];
  menu: string[];

  // Behavior
  autoJoin: boolean;
  startVideo: boolean;
  startAudio: boolean;
  recording: boolean;
  screenshare: boolean;

  // Host
  hostMuteAll: boolean;
  hostRemove: boolean;
  waitingRoom: boolean;

  // Branding
  branding: boolean;
  brandText: string;
  brandLogo: string;
  color: string;
}

function parseUrlParams(): RoomConfig {
  const params = new URLSearchParams(window.location.search);

  const parseBoolean = (value: string | null, defaultValue: boolean): boolean => {
    if (value === null) return defaultValue;
    return value === 'true';
  };

  const parseArray = (value: string | null, defaultValue: string[]): string[] => {
    if (!value) return defaultValue;
    return value.split(',').map(s => s.trim()).filter(Boolean);
  };

  return {
    // Basic
    room: params.get('room') || '',
    name: params.get('name') || 'Guest',
    email: params.get('email') || '',
    role: (params.get('role') as 'host' | 'participant') || 'participant',
    token: params.get('token') || '',
    theme: (params.get('theme') as 'light' | 'dark') || 'light',
    features: parseArray(params.get('features'), ['video', 'audio', 'chat', 'screenshare']),
    disabled: parseArray(params.get('disabled'), []),

    // Layout
    layout: (params.get('layout') as RoomConfig['layout']) || 'auto',
    maxParticipants: parseInt(params.get('maxParticipants') || '9', 10),
    miniCards: parseBoolean(params.get('miniCards'), true),
    videoCards: parseBoolean(params.get('videoCards'), true),
    audioCards: parseBoolean(params.get('audioCards'), true),

    // Controls
    controls: parseArray(params.get('controls'), ['video', 'audio', 'screenshare', 'chat', 'participants', 'leave']),
    menu: parseArray(params.get('menu'), ['participants', 'chat', 'settings']),

    // Behavior
    autoJoin: parseBoolean(params.get('autoJoin'), false),
    startVideo: parseBoolean(params.get('startVideo'), true),
    startAudio: parseBoolean(params.get('startAudio'), true),
    recording: parseBoolean(params.get('recording'), false),
    screenshare: parseBoolean(params.get('screenshare'), true),

    // Host
    hostMuteAll: parseBoolean(params.get('hostMuteAll'), true),
    hostRemove: parseBoolean(params.get('hostRemove'), true),
    waitingRoom: parseBoolean(params.get('waitingRoom'), false),

    // Branding
    branding: parseBoolean(params.get('branding'), true),
    brandText: params.get('brandText') || '',
    brandLogo: params.get('brandLogo') || '',
    color: params.get('color') || '#3b82f6',
  };
}

// Validate the session token with the backend
async function validateToken(token: string): Promise<{
  valid: boolean;
  credentials?: { apiUserName: string; apiKey: string };
  config?: Record<string, unknown>;
  error?: string;
}> {
  if (!token) {
    return { valid: false, error: 'No session token provided' };
  }

  try {
    const response = await fetch(`${getApiBaseUrl()}/v1/widget/validate-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionToken: token }),
    });

    if (!response.ok) {
      const error = await response.json();
      return { valid: false, error: error.error || 'Invalid session' };
    }

    const data = await response.json();
    return {
      valid: data.success,
      credentials: data.credentials,
      config: data.config,
    };
  } catch (error) {
    return { valid: false, error: 'Failed to validate session' };
  }
}

// Post message to parent window (use referrer origin when available)
function postToParent(type: string, payload: Record<string, unknown>) {
  if (window.parent && window.parent !== window) {
    let targetOrigin = '*';
    try {
      if (document.referrer) {
        targetOrigin = new URL(document.referrer).origin;
      }
    } catch { /* fallback to * */ }
    window.parent.postMessage({ type: `mediasfu:${type}`, payload }, targetOrigin);
  }
}

// Widget Call State interface
interface WidgetCallState {
  sipCallId: string | null;
  callStarted: boolean;
  agentStarted: boolean;
  onHold: boolean;
  activeMediaSource: 'agent' | 'human' | null;
}

// Click-to-Call App Component
function ClickToCallApp() {
  const [callConfig, setCallConfig] = useState<ClickToCallConfig>(() => parseClickToCallParams());
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(() => Boolean(
    callConfig.bootstrap || (callConfig.sessionToken && (!callConfig.apiKey || !callConfig.apiUserName)),
  ));
  const [roomConnected, setRoomConnected] = useState(false);
  const [connectedRoomName, setConnectedRoomName] = useState<string | null>(null);
  const [callEnded, setCallEnded] = useState(false); // Track if call has ended to prevent auto-recreation
  const callEndedRef = useRef(false); // Immediate synchronous guard against re-creation races
  const [audioUnlocked, setAudioUnlocked] = useState(false); // Track if user has interacted to unlock audio
  const [remoteAudioReady, setRemoteAudioReady] = useState(false);
  const [widgetCallState, setWidgetCallState] = useState<WidgetCallState>({
    sipCallId: null,
    callStarted: false,
    agentStarted: false,
    onHold: false,
    activeMediaSource: null,
  });
  const [availableAudioInputs, setAvailableAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInput, setSelectedAudioInput] = useState('');
  const [deviceSwitching, setDeviceSwitching] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const compactCallMode = new URLSearchParams(window.location.search).get('widgetMode') === 'compact-call';

  // Track source parameters for socket access
  const sourceParamsRef = useRef<Record<string, unknown>>({});
  const widgetCallStartedRef = useRef(false);
  const connectionTimeoutRef = useRef<number | null>(null);
  const micStartedRef = useRef(false); // Track if mic has been auto-started
  const roomConnectedRef = useRef(false); // Track if room connection has been handled
  const connectionFailureReportedRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null); // Keep AudioContext alive
  const audioObserverRef = useRef<MutationObserver | null>(null); // Observe new audio elements
  const remoteAudioReadyRef = useRef(false);
  const mediaDiagnosticsSignatureRef = useRef('');

  const reportConnectionFailure = useCallback((message: string, code = 'connection-failed') => {
    if (roomConnectedRef.current || connectionFailureReportedRef.current) return;
    connectionFailureReportedRef.current = true;
    setError(message);
    postToParent('roomConnected', { roomName: null, success: false, error: message, code });
  }, []);

  const reportMediaDiagnostics = useCallback((params: Record<string, unknown>) => {
    const roomRecvIPs = Array.isArray(params.roomRecvIPs) ? params.roomRecvIPs : [];
    const consumeSockets = Array.isArray(params.consume_sockets) ? params.consume_sockets : [];
    const allAudioStreams = Array.isArray(params.allAudioStreams) ? params.allAudioStreams : [];
    const audioOnlyStreams = Array.isArray(params.audioOnlyStreams) ? params.audioOnlyStreams : [];
    const connectedConsumeSockets = consumeSockets.filter((entry: any) =>
      entry?.connected === true || entry?.socket?.connected === true
    ).length;
    const liveTrackIds = new Set<string>();
    for (const entry of [...allAudioStreams, ...audioOnlyStreams]) {
      const stream = entry?.stream || entry?.mediaStream || entry;
      if (!stream || typeof stream.getAudioTracks !== 'function') continue;
      for (const track of stream.getAudioTracks()) {
        if (track.readyState === 'live' && track.enabled) {
          liveTrackIds.add(track.id);
        }
      }
    }
    const liveAudioTracks = liveTrackIds.size;
    const diagnostics = {
      roomName: params.roomName || null,
      roomRecvIPs: roomRecvIPs.length,
      consumeSockets: consumeSockets.length,
      connectedConsumeSockets,
      audioOnlyStreams: audioOnlyStreams.length,
      allAudioStreams: allAudioStreams.length,
      liveAudioTracks,
    };
    const signature = JSON.stringify(diagnostics);
    if (signature !== mediaDiagnosticsSignatureRef.current) {
      mediaDiagnosticsSignatureRef.current = signature;
      logger.info('Media readiness:', diagnostics);
      postToParent('mediaDiagnostics', diagnostics);
    }
    if (liveAudioTracks > 0 && !remoteAudioReadyRef.current) {
      remoteAudioReadyRef.current = true;
      setRemoteAudioReady(true);
      postToParent('remoteAudioReady', diagnostics);
    }
  }, []);

  useEffect(() => {
    if (
      !compactCallMode
      || !roomConnected
      || audioUnlocked
      || !connectedRoomName
    ) return;
    postToParent('audioUnlockRequired', {
      roomName: connectedRoomName,
      sipCallId: widgetCallState.sipCallId || undefined,
      reason: 'browser-audio-policy',
    });
  }, [audioUnlocked, compactCallMode, connectedRoomName, roomConnected, widgetCallState.sipCallId]);

  const refreshAudioInputs = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((device) => device.kind === 'audioinput');
      setAvailableAudioInputs(audioInputs);
      setSelectedAudioInput((current) => {
        if (current && audioInputs.some((device) => device.deviceId === current)) {
          return current;
        }

        return audioInputs[0]?.deviceId || '';
      });
      setDeviceError(null);
    } catch (err) {
      logger.warn('Could not enumerate audio devices:', err);
      setAvailableAudioInputs([]);
      setDeviceError('Microphone selection is unavailable in this browser.');
    }
  }, []);

  useEffect(() => {
    void refreshAudioInputs();

    if (!navigator.mediaDevices) {
      return undefined;
    }

    const handleDeviceChange = () => {
      void refreshAudioInputs();
    };

    navigator.mediaDevices.addEventListener?.('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener?.('devicechange', handleDeviceChange);
    };
  }, [refreshAudioInputs]);

  // Function to unlock audio - must be called from user gesture inside iframe
  const unlockAudio = useCallback(async () => {
    logger.info('User interaction inside iframe - unlocking audio');

    // Create and keep AudioContext alive - this is the key to unlocking audio in iframes
    try {
      // Create AudioContext and keep it open
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        logger.debug('Created new AudioContext');
      }
      const audioContext = audioContextRef.current;
      logger.debug('AudioContext state:', audioContext.state);

      if (audioContext.state === 'suspended') {
        await audioContext.resume();
        logger.debug('AudioContext resumed, new state:', audioContext.state);
      }

      // Create a silent oscillator to keep the context active
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0; // Silent
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.start();
      setTimeout(() => oscillator.stop(), 100);
      logger.debug('AudioContext activated with silent oscillator');
    } catch (err) {
      logger.warn('Could not resume AudioContext:', err);
    }

    // Function to try playing an audio element
    const tryPlayAudio = async (audio: HTMLAudioElement) => {
      logger.verbose('tryPlayAudio called - paused:', audio.paused,
        'srcObject:', !!audio.srcObject,
        'readyState:', audio.readyState);

      if (audio.srcObject) {
        const stream = audio.srcObject as MediaStream;
        const tracks = stream.getAudioTracks();
        logger.verbose('Audio stream tracks:', tracks.length,
          tracks.map(t => ({ enabled: t.enabled, muted: t.muted, readyState: t.readyState })));
      }

      try {
        // Force unmute and set volume
        audio.muted = false;
        audio.volume = 1.0;

        if (audio.paused) {
          const playPromise = audio.play();
          if (playPromise) {
            await playPromise;
            logger.debug('Audio element started playing');
          }
        }
      } catch (err: any) {
        logger.error('Could not play audio element:', err.name, err.message);
      }
    };

    // Play all existing audio elements
    const audioElements = document.querySelectorAll('audio');
    logger.debug('Found', audioElements.length, 'existing audio elements');
    for (const audio of audioElements) {
      await tryPlayAudio(audio as HTMLAudioElement);
    }

    // Set up MutationObserver to auto-play any NEW audio elements that get added
    if (!audioObserverRef.current) {
      audioObserverRef.current = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLAudioElement) {
              logger.debug('MutationObserver: New audio element detected');
              tryPlayAudio(node);
            }
            // Also check children (audio might be nested)
            if (node instanceof Element) {
              const audioChildren = node.querySelectorAll('audio');
              if (audioChildren.length > 0) {
                logger.debug('MutationObserver: Found', audioChildren.length, 'nested audio elements');
              }
              audioChildren.forEach(audio => {
                tryPlayAudio(audio as HTMLAudioElement);
              });
            }
          }
        }
      });

      audioObserverRef.current.observe(document.body, {
        childList: true,
        subtree: true
      });
      logger.debug('MutationObserver set up for new audio elements');
    }

    // Also set up interval to periodically check and play audio elements
    const audioCheckInterval = setInterval(() => {
      const allAudio = document.querySelectorAll('audio');
      let pausedCount = 0;
      allAudio.forEach(audio => {
        if (audio.paused && audio.srcObject) {
          pausedCount++;
          tryPlayAudio(audio as HTMLAudioElement);
        }
      });
      if (pausedCount > 0) {
        logger.verbose('Interval check: found', pausedCount, 'paused audio elements');
      }
    }, 2000);

    // Clear interval after 30 seconds
    setTimeout(() => clearInterval(audioCheckInterval), 30000);

    setAudioUnlocked(true);
    postToParent('audioUnlocked', { success: true });
    void refreshAudioInputs();

    // Now start the microphone since user has interacted
    const params = sourceParamsRef.current;
    if (params && typeof params === 'object' && 'getUpdatedAllParams' in params && !micStartedRef.current) {
      micStartedRef.current = true;
      const getUpdatedAllParams = (params as any).getUpdatedAllParams;
      if (typeof getUpdatedAllParams === 'function') {
        try {
          const updatedParams = getUpdatedAllParams();
          const audioAlreadyOn = updatedParams.audioAlreadyOn;

          if (!audioAlreadyOn) {
            logger.info('Starting microphone after audio unlock...');
            const clickAudioFn = updatedParams.clickAudio;
            if (typeof clickAudioFn === 'function') {
              await clickAudioFn({ parameters: updatedParams });
              logger.info('Microphone started successfully');
              postToParent('callConnected', { roomName: params.roomName, micActive: true });
            }
          } else {
            logger.debug('Microphone already on');
            postToParent('callConnected', { roomName: params.roomName, micActive: true });
          }
        } catch (err) {
          micStartedRef.current = false;
          const message = err instanceof Error ? err.message : 'Microphone access failed';
          setDeviceError(`Speaker is ready, but the microphone could not start: ${message}`);
          logger.error('Failed to start microphone:', err);
          postToParent('microphoneError', { error: message, roomName: params.roomName });
        }
      }
    }
  }, []);

  // Redeem an opaque one-time bootstrap first; retain legacy session-token support.
  useEffect(() => {
    let cancelled = false;
    async function validateAndSetCredentials() {
      if (callConfig.bootstrap && (!callConfig.apiKey || !callConfig.apiUserName)) {
        setIsValidating(true);
        const result = await redeemCallBootstrap(callConfig.bootstrap, window.location.origin);
        if (cancelled) return;
        if (result.valid) {
          const payload = result.payload;
          const sipCallId = payload.sipCallId || payload.callId || '';
          setCallConfig(prev => ({
            ...prev,
            bootstrap: '',
            roomName: payload.roomName || sipCallId,
            userName: payload.userName || prev.userName,
            apiUserName: payload.apiUserName || '',
            apiKey: payload.apiKey || '',
            islevel: payload.islevel || '2',
            sec: payload.sec || '',
            socketUrl: payload.socketUrl || '',
            widgetKey: payload.widgetKey || '',
            audioOnly: payload.audioOnly === 'true',
            sipCallId,
            callId: payload.callId || sipCallId,
            sipConfigId: payload.sipConfigId || '',
            did: payload.did || '',
            autoStartAgent: payload.autoStartAgent !== 'false',
            agentName: payload.agentName || '',
            autoRecord: payload.autoRecord === 'true',
            callerName: payload.callerName || payload.userName || prev.userName,
            callerNumber: payload.callerNumber || '',
            callerEmail: payload.callerEmail || '',
            serverCallStarted: payload.serverCallStarted === 'true',
            _credentialsValidated: true,
          }));
          setError(null);
        } else {
          setCallConfig(prev => ({ ...prev, bootstrap: '' }));
          setError(result.error);
        }
        setIsValidating(false);
      } else if (callConfig.sessionToken && (!callConfig.apiKey || !callConfig.apiUserName)) {
        setIsValidating(true);
        logger.info('Validating session token...');
        const result = await validateToken(callConfig.sessionToken);
        if (cancelled) return;

        if (result.valid && result.credentials) {
          logger.info('Session validated, got credentials');
          logger.debug('Setting credentials:', result.credentials);
          // Set credentials in callConfig - use functional update with a marker
          setCallConfig(prev => ({
            ...prev,
            apiUserName: result.credentials!.apiUserName,
            apiKey: result.credentials!.apiKey,
            _credentialsValidated: true, // Marker to indicate credentials are set
          }));
          setIsValidating(false);
        } else {
          logger.error('Session validation failed:', result.error);
          setError(result.error || 'Failed to validate session');
          setIsValidating(false);
        }
      } else if (!callConfig.sessionToken && !callConfig.apiKey) {
        // No session token and no credentials - start validating state
        setIsValidating(true);
      }
    }

    validateAndSetCredentials();
    return () => { cancelled = true; };
  }, [callConfig.bootstrap, callConfig.sessionToken]);

  // Validate required params after credentials are set
  useEffect(() => {
    // If we have a bootstrap/sessionToken, wait until credentials are validated.
    if ((callConfig.bootstrap || callConfig.sessionToken) && !callConfig._credentialsValidated) {
      logger.debug('Waiting for call access validation...');
      return;
    }
    // If still validating (no sessionToken case), wait
    if (isValidating) return;

    logger.debug('Checking credentials:', {
      hasRoomName: !!callConfig.roomName,
      hasApiKey: !!callConfig.apiKey,
      hasApiUserName: !!callConfig.apiUserName,
    });

    if (!callConfig.roomName) {
      setError('Room name is required');
    } else if (!callConfig.apiKey || !callConfig.apiUserName) {
      setError('API credentials are required. Please provide sessionToken or API credentials.');
    } else {
      setError(null); // Clear any previous error
      postToParent('ready', { room: callConfig.roomName, type: 'click-to-call' });
    }
  }, [callConfig, isValidating]);

  // Connection timeout - if room doesn't connect within 30 seconds, show error
  useEffect(() => {
    // Only start timeout when we have credentials and are ready to connect
    if (!callConfig.apiKey || !callConfig.apiUserName || isValidating || error) {
      return;
    }

    // Start connection timeout
    logger.debug('Starting connection timeout (30s)...');
    connectionTimeoutRef.current = window.setTimeout(() => {
      if (!roomConnected) {
        logger.error('Connection timeout - room did not connect within 30 seconds');
        reportConnectionFailure('Connection timeout. Failed to connect to call room. Please try again.', 'timeout');
      }
    }, 30000);

    return () => {
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }
      // Cleanup audio observer
      if (audioObserverRef.current) {
        audioObserverRef.current.disconnect();
        audioObserverRef.current = null;
      }
      // Cleanup audio context
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    };
  }, [callConfig.apiKey, callConfig.apiUserName, isValidating, error, roomConnected, reportConnectionFailure]);

  // Function to emit startWidgetCall after socket is connected
  const emitStartWidgetCall = useCallback((socket: Socket, roomName: string, userName: string) => {
    if (widgetCallStartedRef.current) return;
    widgetCallStartedRef.current = true;

    logger.info('Emitting startWidgetCall for room:', roomName);

    socket.emit('startWidgetCall', {
      sipCallId: callConfig.sipCallId || callConfig.callId || undefined,
      callId: callConfig.callId || callConfig.sipCallId || undefined,
      roomName,
      userName,
      widgetKey: callConfig.widgetKey || undefined,
      // SIP config identifiers for drachtio to resolve full sipConfig
      sipConfigId: callConfig.sipConfigId || undefined,
      did: callConfig.did || undefined,
      // Caller info
      callerName: callConfig.callerName || userName,
      callerNumber: callConfig.callerNumber || undefined,
      callerEmail: callConfig.callerEmail || undefined,
      autoRecord: callConfig.autoRecord,
    }, (response: { success: boolean; sipCallId?: string; error?: string }) => {
      if (response.success && response.sipCallId) {
        logger.info('Widget call started with sipCallId:', response.sipCallId);
        setIsMuted(false);
        setWidgetCallState(prev => ({
          ...prev,
          sipCallId: response.sipCallId!,
          callStarted: true,
          agentStarted: callConfig.autoStartAgent,
          activeMediaSource: callConfig.autoStartAgent ? 'agent' : null,
        }));
        postToParent('widgetCallStarted', { success: true, sipCallId: response.sipCallId, roomName });
      } else {
        widgetCallStartedRef.current = false;
        const message = response.error || 'Unable to complete widget call setup';
        logger.error('Failed to start widget call:', message);
        postToParent('widgetCallError', { error: message, roomName });
      }
    });
  }, [
    callConfig.autoRecord,
    callConfig.autoStartAgent,
    callConfig.callId,
    callConfig.callerEmail,
    callConfig.callerName,
    callConfig.callerNumber,
    callConfig.did,
    callConfig.sipCallId,
    callConfig.sipConfigId,
    callConfig.widgetKey,
  ]);

  // Helper function to disconnect from MediaSFU room
  // Defined early so it can be used by event handlers below
  const disconnectRoom = useCallback(async (reason?: string) => {
    // CRITICAL: Set ref IMMEDIATELY to prevent race conditions where SDK re-creates room
    // before React's setCallEnded state update takes effect
    callEndedRef.current = true;

    // Guard against concurrent calls (e.g. endWidgetCall + server widgetCallEnded event)
    const params = sourceParamsRef.current;
    if (Object.keys(params).length === 0) {
      setIsMuted(false);
      setCallEnded(true);
      return;
    }
    // Clear params immediately so a second concurrent call exits early above
    sourceParamsRef.current = {};

    try {
      logger.info('Disconnecting from MediaSFU room...', reason || '');

      // Get socket and disconnect using confirmExit (same as LiteDashboard)
      const socket = params.socket as Socket | undefined;
      const localSocket = params.localSocket as Socket | undefined;
      const member = params.member as string;
      const roomName = params.roomName as string;

      // Use dynamic import for confirmExit (bypasses TypeScript export issues)
      try {
        const { confirmExit } = await import('mediasfu-reactjs');
        await confirmExit({
          socket: socket!,
          localSocket,
          member,
          roomName,
          ban: false
        });
        logger.info('confirmExit completed successfully');
      } catch (confirmErr) {
        logger.warn('confirmExit failed, falling back to manual disconnect:', confirmErr);
        // Fallback: Manual disconnect if confirmExit fails
        if (socket) {
          socket.emit('disconnectUser', { member, roomName }, () => {
            logger.debug('Disconnected from server (fallback)');
          });
          socket.disconnect();
        }
        if (localSocket && localSocket !== socket) {
          localSocket.emit('disconnectUser', { member, roomName }, () => {
            logger.debug('Disconnected local socket from server (fallback)');
          });
          localSocket.disconnect();
        }
      }

      logger.info('Room disconnected successfully');

      // Reset state and mark call as ended to prevent auto-recreation
      setRoomConnected(false);
      setConnectedRoomName(null);
      setCallEnded(true); // CRITICAL: Prevents auto-recreation of room
      setIsMuted(false);
      roomConnectedRef.current = false;
      connectionFailureReportedRef.current = false;
      widgetCallStartedRef.current = false;
      micStartedRef.current = false;
      remoteAudioReadyRef.current = false;
      mediaDiagnosticsSignatureRef.current = '';
      setRemoteAudioReady(false);

      // Notify parent
      postToParent('roomDisconnected', { reason: reason || 'call_ended' });
    } catch (err) {
      logger.error('Error disconnecting room:', err);
      // Even on error, mark as ended to prevent issues
      setCallEnded(true);
    }
  }, []);

  // Listen for widget call events from server
  useEffect(() => {
    const socket = sourceParamsRef.current.socket as Socket | undefined;
    if (!socket) return;

    // Listen for widget call events
    const handleWidgetCallEnded = async (data: { sipCallId: string; reason?: string }) => {
      logger.info('Widget call ended:', data);
      setWidgetCallState(prev => ({
        ...prev,
        callStarted: false,
        agentStarted: false,
        activeMediaSource: null,
        sipCallId: null,
      }));
      setIsMuted(false);
      postToParent('widgetCallEnded', data);

      // Disconnect from MediaSFU room when widget call ends
      // Server has already ended the call, we just need to clean up the room connection
      await disconnectRoom(data.reason || 'server_ended');
    };

    const handleWidgetHoldChanged = (data: { sipCallId: string; onHold: boolean }) => {
      logger.debug('Widget hold changed:', data);
      setWidgetCallState(prev => ({ ...prev, onHold: data.onHold }));
      postToParent('widgetHoldChanged', data);
    };

    const handleWidgetSourceChanged = (data: { sipCallId: string; source: 'agent' | 'human' }) => {
      logger.debug('Widget source changed:', data);
      setWidgetCallState(prev => ({
        ...prev,
        activeMediaSource: data.source,
        agentStarted: data.source === 'agent',
      }));
      postToParent('widgetSourceChanged', data);
    };

    socket.on('widgetCallEnded', handleWidgetCallEnded);
    socket.on('widgetHoldChanged', handleWidgetHoldChanged);
    socket.on('widgetSourceChanged', handleWidgetSourceChanged);

    return () => {
      socket.off('widgetCallEnded', handleWidgetCallEnded);
      socket.off('widgetHoldChanged', handleWidgetHoldChanged);
      socket.off('widgetSourceChanged', handleWidgetSourceChanged);
    };
  }, [sourceParamsRef.current.socket, disconnectRoom]);

  // Widget call control functions
  const holdWidgetCall = useCallback((onHold: boolean) => {
    const socket = sourceParamsRef.current.socket as Socket | undefined;
    const sipCallId = widgetCallState.sipCallId;
    if (!socket || !sipCallId) return;

    socket.emit('widgetHold', { sipCallId, onHold }, (response: { success: boolean }) => {
      if (response.success) {
        setWidgetCallState(prev => ({ ...prev, onHold }));
      }
    });
  }, [widgetCallState.sipCallId]);

  const switchWidgetSource = useCallback((source: 'agent' | 'human') => {
    const socket = sourceParamsRef.current.socket as Socket | undefined;
    const sipCallId = widgetCallState.sipCallId;
    if (!socket || !sipCallId) return;

    socket.emit('widgetSwitchSource', { sipCallId, source }, (response: { success: boolean }) => {
      if (response.success) {
        setWidgetCallState(prev => ({
          ...prev,
          activeMediaSource: source,
          agentStarted: source === 'agent',
        }));
      }
    });
  }, [widgetCallState.sipCallId]);

  const endWidgetCall = useCallback(async () => {
    const socket = sourceParamsRef.current.socket as Socket | undefined;
    const sipCallId = widgetCallState.sipCallId;

    // Reset widget call state immediately
    setWidgetCallState(prev => ({
      ...prev,
      callStarted: false,
      agentStarted: false,
      activeMediaSource: null,
      sipCallId: null,
    }));
    setIsMuted(false);

    // Fire-and-forget: notify server about widget call end (for SIP/mapping cleanup)
    // This handles drachtio notification and mapping cleanup on the server side
    if (socket?.connected && sipCallId) {
      try {
        socket.emit('endWidgetCall', { sipCallId });
      } catch (e) {
        logger.debug('endWidgetCall emit error (non-critical):', e);
      }
    }

    // Close room via confirmExit — same mechanism LiteDashboard uses for host disconnect.
    // confirmExit emits 'disconnectUser' which the parent server handles for islevel '2'
    // hosts by calling meetingEndedMain to end the room for all participants.
    await disconnectRoom('widget_call_ended');

    logger.info('endWidgetCall completed, room disconnected via confirmExit');
  }, [widgetCallState.sipCallId, disconnectRoom]);

  // Toggle audio mute/unmute
  const toggleMute = useCallback(async () => {
    try {
      const params = sourceParamsRef.current;
      if (Object.keys(params).length === 0) {
        logger.warn('No source parameters, cannot toggle mute');
        return;
      }

      // Get updated parameters
      const getUpdatedAllParams = (params as any).getUpdatedAllParams;
      if (typeof getUpdatedAllParams !== 'function') {
        logger.warn('getUpdatedAllParams not available');
        return;
      }

      const updatedParams = getUpdatedAllParams();
      const wasAudioOn = updatedParams.audioAlreadyOn;

      const options: ClickAudioOptions = {
        parameters: updatedParams,
      };

      logger.debug('Toggling audio, current state:', wasAudioOn);
      await clickAudio(options);

      // After toggle: if audio was on, it's now muted (and vice versa)
      const newMuted = wasAudioOn;
      setIsMuted(newMuted);
      logger.debug('Audio toggled, now muted:', newMuted);
      postToParent('muteToggled', { muted: newMuted });
    } catch (err) {
      logger.error('Error toggling mute:', err);
    }
  }, []);

  const changeAudioInput = useCallback(async (deviceId: string) => {
    setSelectedAudioInput(deviceId);
    setDeviceError(null);

    const params = sourceParamsRef.current;
    if (!deviceId || Object.keys(params).length === 0) {
      return;
    }

    const getUpdatedAllParams = (params as any).getUpdatedAllParams;
    if (typeof getUpdatedAllParams !== 'function') {
      setDeviceError('Microphone switching is not ready yet.');
      return;
    }

    try {
      setDeviceSwitching(true);
      const options: SwitchAudioOptions = {
        audioPreference: deviceId,
        parameters: getUpdatedAllParams(),
      };
      await switchAudio(options);
      logger.info('Microphone switched:', deviceId);
    } catch (err) {
      logger.error('Error switching microphone:', err);
      setDeviceError('Could not switch microphones for this session.');
    } finally {
      setDeviceSwitching(false);
    }
  }, []);

  // Listen for control messages from parent iframe
  useEffect(() => {
    const handleParentMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'object') return;

      const { type, payload } = event.data;

      switch (type) {
        case 'mediasfu:holdCall':
          holdWidgetCall(payload?.onHold ?? true);
          break;
        case 'mediasfu:resumeCall':
          holdWidgetCall(false);
          break;
        case 'mediasfu:switchToAgent':
          switchWidgetSource('agent');
          break;
        case 'mediasfu:switchToHuman':
          switchWidgetSource('human');
          break;
        case 'mediasfu:endCall':
          endWidgetCall();
          break;
        case 'mediasfu:toggleMute':
          toggleMute();
          break;
      }
    };

    window.addEventListener('message', handleParentMessage);
    return () => window.removeEventListener('message', handleParentMessage);
  }, [holdWidgetCall, switchWidgetSource, endWidgetCall, toggleMute]);

  // Handle source parameters update - trigger startWidgetCall when connected
  const handleSourceParametersUpdate = useCallback((params: Record<string, unknown>) => {
    sourceParamsRef.current = params;

    // CRITICAL: If call has ended, do not process any new room connections
    if (callEndedRef.current) {
      return;
    }

    // Check for room closure/ended messages from server (like voipsrc does)
    const alertMessage = params.alertMessage as string | undefined;
    if (alertMessage && roomConnectedRef.current) {
      const shouldDisconnect =
        alertMessage.includes("meeting has ended") ||
        alertMessage.includes("ended") ||
        alertMessage.includes("disconnected") ||
        alertMessage.includes("room not found") ||
        alertMessage.includes("invalid room") ||
        alertMessage.includes("time exceeded") ||
        alertMessage.includes("kicked") ||
        alertMessage.includes("banned");

      if (shouldDisconnect) {
        logger.info('Room ended from server:', alertMessage);
        // Determine reason type
        let reasonType = 'room-ended';
        if (alertMessage.includes("kicked") || alertMessage.includes("banned")) {
          reasonType = 'user-removed';
        } else if (alertMessage.includes("disconnected")) {
          reasonType = 'socket-error';
        } else if (alertMessage.includes("time exceeded")) {
          reasonType = 'time-exceeded';
        }

        postToParent('roomEnded', { reason: reasonType, message: alertMessage });

        // Disconnect the room after a short delay
        setTimeout(() => {
          disconnectRoom(reasonType);
        }, 100);
        return;
      }
    }

    // Check if we have a connected socket and room
    const socket = params.socket as Socket | undefined;
    const roomName = params.roomName as string | undefined;
    const member = params.member as string | undefined;
    const validated = params.validated === true;

    const authoritativeRoomConnected = Boolean(
      validated &&
      socket?.connected &&
      roomName &&
      member &&
      !connectionFailureReportedRef.current
    );

    // Use ref to check if already handled to prevent race conditions
    if (authoritativeRoomConnected && !roomConnectedRef.current) {
      // Set flag IMMEDIATELY to prevent multiple handlers from running
      roomConnectedRef.current = true;

      // Room connected successfully - clear timeout and update state
      logger.info('Room connected successfully:', roomName);
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }
      setRoomConnected(true);
      setConnectedRoomName(roomName!);
      postToParent('roomConnected', { roomName, success: true });

      // NOTE: Microphone start is now handled in unlockAudio() after user interaction
      // This is required because browsers block audio until user interacts INSIDE the iframe
      logger.debug('Room connected - waiting for user to tap to enable audio');
    }

    if (socket?.connected && roomName && member && !connectionFailureReportedRef.current && !widgetCallStartedRef.current) {
      setTimeout(() => emitStartWidgetCall(socket, roomName, member), 500);
    }

    reportMediaDiagnostics(params);

    // Update audio streams for AudioGrid - this is crucial for playing remote audio
    const currentAudioStreams = params.audioOnlyStreams as any[] | undefined;
    if (currentAudioStreams && currentAudioStreams.length > 0) {
      logger.verbose('AudioGrid streams from params:', currentAudioStreams.length);
      setAudioOnlyStreams(currentAudioStreams);
    }
  }, [
    disconnectRoom,
    reportMediaDiagnostics,
    emitStartWidgetCall,
  ]);

  // Track audio streams for AudioGrid rendering
  const [audioOnlyStreams, setAudioOnlyStreams] = useState<any[]>([]);

  // Periodic monitoring for audio streams and room status (like voipsrc does)
  useEffect(() => {
    if (!roomConnected) return;

    const monitorRoom = () => {
      const params = sourceParamsRef.current;
      if (!params) return;
      reportMediaDiagnostics(params);

      // Check for room closure via alertMessage
      const alertMessage = params.alertMessage as string | undefined;
      if (alertMessage) {
        const shouldDisconnect =
          alertMessage.includes("meeting has ended") ||
          alertMessage.includes("ended") ||
          alertMessage.includes("disconnected") ||
          alertMessage.includes("room not found") ||
          alertMessage.includes("time exceeded");

        if (shouldDisconnect) {
          logger.info('Room ended detected in monitoring:', alertMessage);
          postToParent('roomEnded', { reason: 'room-ended', message: alertMessage });
          disconnectRoom('room-ended');
          return;
        }
      }

      // Check socket connection status
      const socket = params.socket as Socket | undefined;
      if (socket && !socket.connected && roomConnectedRef.current) {
        logger.warn('Socket disconnected detected in monitoring');
        postToParent('roomEnded', { reason: 'socket-error', message: 'Connection lost' });
        disconnectRoom('socket-error');
        return;
      }

      // Monitor audio streams
      if (params.audioOnlyStreams) {
        const streams = params.audioOnlyStreams as any[];

        setAudioOnlyStreams(prev => {
          if (prev.length !== streams.length) {
            logger.verbose('AudioGrid streams updated:', streams.length, 'from', prev.length);
            return [...streams];
          }
          return prev;
        });
      }

      // IMPORTANT: Get raw audio streams and create our own audio elements
      // This is more reliable than depending on MiniAudioPlayer/AudioGrid
      if (audioUnlocked && params.allAudioStreams) {
        const rawStreams = params.allAudioStreams as any[];

        // Track current producer IDs
        const currentProducerIds = new Set<string>();

        rawStreams.forEach((streamObj) => {
          const stream = streamObj.stream as MediaStream | undefined;
          const producerId = streamObj.producerId as string | undefined;

          if (stream && producerId) {
            currentProducerIds.add(producerId);

            // Check if we already have an audio element for this producer
            let audioEl = document.getElementById(`raw-audio-${producerId}`) as HTMLAudioElement | null;
            const tracks = stream.getAudioTracks();
            const streamId = stream.id; // Unique ID for this stream instance

            // Check if stream has changed (new stream object for same producer)
            const storedStreamId = audioEl ? (audioEl as any)._streamId : null;
            const streamChanged = storedStreamId && storedStreamId !== streamId;

            // Check if all tracks have ended (need new stream)
            const allTracksEnded = tracks.length > 0 && tracks.every(t => t.readyState === 'ended');

            if (!audioEl || streamChanged || allTracksEnded) {
              if (streamChanged) {
                logger.debug(`Stream changed for producer ${producerId}, updating`);
              }
              if (allTracksEnded) {
                logger.debug(`All tracks ended for producer ${producerId}, refreshing`);
              }

              if (!audioEl) {
                logger.debug(`Creating audio element for producer ${producerId}`);
                audioEl = document.createElement('audio');
                audioEl.id = `raw-audio-${producerId}`;
                document.body.appendChild(audioEl);
              }

              // Update stream
              audioEl.srcObject = stream;
              (audioEl as any)._streamId = streamId;
              audioEl.autoplay = true;
              audioEl.muted = false;
              audioEl.volume = 1.0;

              // Add track ended listener to detect when we need to refresh
              tracks.forEach(track => {
                track.onended = () => {
                  logger.verbose(`Track ended for producer ${producerId}`);
                };
              });

              audioEl.play()
                .then(() => logger.debug(`Audio ${producerId} playing`))
                .catch(err => logger.error(`Audio ${producerId} play failed:`, err.name));
            }

            // Always check if paused and has live tracks - try to resume
            const hasLiveTracks = tracks.some(t => t.readyState === 'live' && t.enabled);
            if (audioEl && audioEl.paused && hasLiveTracks) {
              logger.verbose(`Audio ${producerId} paused with live tracks, resuming`);
              audioEl.play().catch(() => {});
            }
          }
        });

        // Clean up audio elements for producers no longer in the stream list
        const allRawAudio = document.querySelectorAll('[id^="raw-audio-"]');
        allRawAudio.forEach(el => {
          const id = el.id.replace('raw-audio-', '');
          if (!currentProducerIds.has(id)) {
            logger.debug(`Removing stale audio element for ${id}`);
            el.remove();
          }
        });
      }
    };

    // Initial check
    monitorRoom();

    // Monitor every second for changes
    const interval = setInterval(monitorRoom, 1000);

    return () => clearInterval(interval);
  }, [roomConnected, disconnectRoom, audioUnlocked, reportMediaDiagnostics]);

  // Credentials for SDK
  const sdkCredentials = useMemo(() => {
    logger.debug('SDK Credentials:', { apiUserName: callConfig.apiUserName, hasApiKey: !!callConfig.apiKey });
    return {
      apiUserName: callConfig.apiUserName,
      apiKey: callConfig.apiKey,
    };
  }, [callConfig.apiUserName, callConfig.apiKey]);

  // Debug: Log state after credentials memo (only at debug level)
  logger.verbose('State check:', {
    isValidating,
    hasRoomName: !!callConfig.roomName,
    hasApiKey: !!callConfig.apiKey,
  });

  // noUIPreJoinOptions for auto-creating and joining the room
  // Widget calls CREATE a new room (they are the host)
  // NOTE: With the new architecture, we don't pass isWidgetCaller/sipCallId in joinRoom
  // Instead, after joining, we emit 'startWidgetCall' to activate widget call mode
  const noUIOptions = useMemo(() => {
    // userName must be alphanumeric, max 10 chars
    const sanitizedUserName = callConfig.userName
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 10) || 'WebCaller';


    return {
      action: 'create' as const,
      // No meetingID for create action - server generates it
      userName: sanitizedUserName,
      duration: 30, // 30 minutes max call duration
      capacity: 5, // Max 5 participants
      eventType: 'conference' as const, // Conference mode for data buffer support
      dataBuffer: true, // Buffer data for egress support
      bufferType: 'all' as const, // Buffer all data types
    };
  }, [callConfig.userName]);

  // Function to create/join room via MediaSFU API - MUST be before any early returns
  const handleMediaSFURequest = useCallback(async ({
    payload,
    apiUserName,
    apiKey,
  }: {
    payload: any;
    apiUserName: string;
    apiKey: string;
  }) => {
    // CRITICAL: Refuse room creation if call has ended (prevents re-creation race)
    if (callEndedRef.current) {
      logger.debug('Blocking room creation: call has already ended');
      return { success: false, data: { error: 'Call has ended' } };
    }


    try {
      // Check if apiKey is a disposable key (starts with tempprod or tempsand)
      const isDisposableKey = apiKey.startsWith('tempprod') || apiKey.startsWith('tempsand');

      // Always use apiUserName:apiKey format for authorization
      const authHeader = `Bearer ${apiUserName}:${apiKey}`;

      logger.debug('Sending MediaSFU request:', { action: payload.action, isDisposableKey });

      const response = await fetch(`${getApiBaseUrl()}/v1/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        logger.error('MediaSFU request failed:', data);
        reportConnectionFailure(data?.error || data?.message || 'Failed to connect to call room. Please try again.', `http-${response.status}`);
        return { success: false, data };
      }

      logger.info('MediaSFU request success');
      return { success: true, data };
    } catch (error) {
      logger.error('MediaSFU request error:', error);
      reportConnectionFailure('Failed to connect to MediaSFU. Please try again.', 'request-error');
      return { success: false, data: { error: 'Failed to connect to MediaSFU' } };
    }
  }, [
    reportConnectionFailure,
  ]);

  if (error) {
    return (
      <div className="error-container" style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#061016',
        color: '#fff',
        padding: '20px',
        textAlign: 'center'
      }}>
        <h1 style={{ color: '#ef4444', marginBottom: '10px' }}>Call Error</h1>
        <p>{error}</p>
        <button
          onClick={() => window.close()}
          style={{
            marginTop: '20px',
            padding: '10px 20px',
            background: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer'
          }}
        >
          Close
        </button>
      </div>
    );
  }

  // Show "Call Ended" state after disconnect - prevents auto-recreation of room
  if (callEnded) {
    logger.debug('Call ended, showing end screen');
    return (
      <div className="call-ended-container" style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#061016',
        color: '#fff',
        padding: '20px',
        textAlign: 'center'
      }}>
        <div style={{
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          background: 'rgba(34, 197, 94, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '20px'
        }}>
          <span style={{ fontSize: '28px' }}>✓</span>
        </div>
        <h1 style={{ color: '#22c55e', marginBottom: '10px', fontSize: '24px' }}>Call Ended</h1>
        <p style={{ color: '#9ca3af', marginBottom: '20px' }}>Thank you for your call.</p>
        <button
          onClick={() => {
            // Notify parent that the widget should be closed
            postToParent('callCompleted', { status: 'ended' });
            // Try to close the window/iframe
            if (window.parent !== window) {
              window.parent.postMessage({ type: 'mediasfu:close' }, '*');
            }
          }}
          style={{
            padding: '12px 24px',
            background: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          Close
        </button>
      </div>
    );
  }

  // Show loading while validating or waiting for credentials
  if (isValidating || !callConfig.roomName || !callConfig.apiKey) {
    logger.verbose('Waiting for roomName or apiKey...');
    return (
      <div className="loading-container" style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#061016',
        color: '#fff'
      }}>
        <div className="loading-spinner" style={{
          width: '40px',
          height: '40px',
          border: '3px solid #333',
          borderTop: '3px solid #3b82f6',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        <p style={{ marginTop: '20px' }}>{isValidating ? 'Validating session...' : 'Connecting call...'}</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Render audio-only call room with connection status overlay
  logger.debug('Rendering MediaSFU component');
  const callControlReady = roomConnected && Boolean(widgetCallState.sipCallId);

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden', background: '#061016', position: 'relative' }}>
      {!compactCallMode && (<>
            {/* Audio unlock overlay - must click inside iframe to enable audio (browser requirement) */}
      {roomConnected && !audioUnlocked && (
        <div
          onClick={unlockAudio}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(6, 16, 22, 0.98)',
            zIndex: 20,
            color: '#fff',
            cursor: 'pointer'
          }}
        >
          <div style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '20px',
            boxShadow: '0 4px 20px rgba(59, 130, 246, 0.5)',
            animation: 'pulse 2s infinite'
          }}>
            <span style={{ fontSize: '36px' }}>🎤</span>
          </div>
          <h2 style={{ fontSize: '20px', marginBottom: '8px', fontWeight: '600' }}>Tap to Enable Audio</h2>
          <p style={{ fontSize: '14px', color: '#9ca3af', maxWidth: '280px', textAlign: 'center' }}>
            Tap anywhere to enable microphone and speaker
          </p>
          <style>{`
            @keyframes pulse {
              0%, 100% { transform: scale(1); opacity: 1; }
              50% { transform: scale(1.05); opacity: 0.9; }
            }
          `}</style>
        </div>
      )}
      {/* Connection status overlay */}
      {!roomConnected && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(6, 16, 22, 0.95)',
          zIndex: 10,
          color: '#fff'
        }}>
          <div style={{
            width: '40px',
            height: '40px',
            border: '3px solid #333',
            borderTop: '3px solid #3b82f6',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
          <p style={{ marginTop: '20px' }}>Creating call room...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
      {/* Success indicator when room connects and audio is unlocked */}
      {roomConnected && audioUnlocked && connectedRoomName && (
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          padding: '8px 12px',
          background: 'rgba(34, 197, 94, 0.9)',
          borderRadius: '6px',
          zIndex: 10,
          color: '#fff',
          fontSize: '12px'
        }}>
          ✓ Connected: {connectedRoomName}
        </div>
      )}
      {roomConnected && connectedRoomName && (
        <div className="widget-room-control-panel">
          <div className="widget-room-control-topline">
            <div className="widget-room-control-status">
              <span className={`widget-room-status-dot${audioUnlocked ? ' live' : ''}`} aria-hidden="true" />
              <div>
                <strong>{callConfig.agentName || 'Studio agent'}</strong>
                <span>
                  {audioUnlocked
                    ? remoteAudioReady
                      ? `Live audio from ${connectedRoomName}`
                      : `Connected to ${connectedRoomName}; waiting for agent audio.`
                    : 'Tap the caller surface to enable microphone and speaker.'}
                </span>
              </div>
            </div>
            {showExtraControls && (
              <div className="widget-room-control-meta">
                <span>{widgetCallState.onHold ? 'On hold' : 'Call live'}</span>
                <span>{widgetCallState.activeMediaSource === 'human' ? 'Human source' : 'Agent source'}</span>
              </div>
            )}
          </div>

          <div className="widget-room-control-grid">
            <button
              type="button"
              className={`widget-room-control-btn${isMuted ? ' active' : ''}`}
              onClick={toggleMute}
              disabled={!audioUnlocked || !callControlReady}
            >
              {isMuted ? 'Unmute mic' : 'Mute mic'}
            </button>
            <label className="widget-room-device-field">
              <span>Microphone</span>
              <select
                value={selectedAudioInput}
                onChange={(event) => changeAudioInput(event.target.value)}
                disabled={!audioUnlocked || !roomConnected || deviceSwitching || availableAudioInputs.length === 0}
              >
                {!availableAudioInputs.length ? <option value="">Detecting microphones</option> : null}
                {availableAudioInputs.map((device, index) => (
                  <option key={device.deviceId || `audio-input-${index}`} value={device.deviceId}>
                    {device.label || `Microphone ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="widget-room-control-btn danger"
              onClick={endWidgetCall}
              disabled={!roomConnected}
            >
              End call
            </button>
            {showExtraControls && (
              <>
                <button
                  type="button"
                  className={`widget-room-control-btn${widgetCallState.onHold ? ' active' : ''}`}
                  onClick={() => holdWidgetCall(!widgetCallState.onHold)}
                  disabled={!callControlReady}
                >
                  {widgetCallState.onHold ? 'Resume call' : 'Hold call'}
                </button>
                <button
                  type="button"
                  className={`widget-room-control-btn${widgetCallState.activeMediaSource !== 'human' ? ' active' : ''}`}
                  onClick={() => switchWidgetSource('agent')}
                  disabled={!callControlReady}
                >
                  Route agent
                </button>
                <button
                  type="button"
                  className={`widget-room-control-btn${widgetCallState.activeMediaSource === 'human' ? ' active' : ''}`}
                  onClick={() => switchWidgetSource('human')}
                  disabled={!callControlReady}
                >
                  Route human
                </button>
              </>
            )}
          </div>

          <p className={`widget-room-control-note${deviceError ? ' warning' : ''}`}>
            {deviceError
              || (deviceSwitching
                ? 'Switching microphone...'
                : (!audioUnlocked
                  ? 'Tap anywhere in the caller to unlock audio before using microphone controls.'
                  : (callControlReady
                    ? (showExtraControls
                      ? 'Mute, hold, routing, and microphone changes apply directly to the live widget call.'
                      : 'Mute, microphone, and end-call controls apply directly to the live widget call.')
                    : (showExtraControls
                      ? 'Advanced call routing becomes available as soon as the widget call is fully active.'
                      : 'Mute and microphone controls become available once the live widget call is fully active.'))))}
          </p>
        </div>
      )}
        </>)}
      {compactCallMode && !roomConnected && (
        <div style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#061016',
          color: '#cbd5e1',
          font: '600 13px system-ui, sans-serif',
        }}>
          Connecting call...
        </div>
      )}
      {compactCallMode && roomConnected && !audioUnlocked && (
        <div className="widget-room-audio-gate">
          <button
            type="button"
            className="widget-room-audio-gate-button"
            onClick={() => { void unlockAudio(); }}
            aria-label="Enable call audio"
          >
            <span className="widget-room-audio-gate-status" aria-hidden="true">
              <span className="widget-room-audio-gate-dot" />
              Sound is off
            </span>
            <strong>Tap to hear the call</strong>
            <span className="widget-room-audio-gate-hint">Enable speaker and microphone</span>
          </button>
        </div>
      )}
      <ModernMediasfuGeneric
        PrejoinPage={ModernPreJoinPage}
        credentials={sdkCredentials}
        connectMediaSFU={true}
        returnUI={false}
        noUIPreJoinOptions={noUIOptions}
        sourceParameters={sourceParamsRef.current}
        updateSourceParameters={handleSourceParametersUpdate}
        createMediaSFURoom={handleMediaSFURequest}
        joinMediaSFURoom={handleMediaSFURequest}
      />
      {/* AudioGrid - Visually hidden but still plays remote participant audio */}
      {/* Using visibility:hidden + position:absolute instead of display:none to ensure audio plays */}
      <div style={{
        position: 'absolute',
        width: '1px',
        height: '1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: '0'
      }}>
        <AudioGrid
          componentsToRender={audioOnlyStreams}
        />
      </div>
    </div>
  );
}

// Meeting Room App Component
function MeetingRoomApp() {
  const [config] = useState<RoomConfig>(() => parseUrlParams());
  const [validating, setValidating] = useState(true);
  const [credentials, setCredentials] = useState<{ apiUserName: string; apiKey: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Validate token on mount
  useEffect(() => {
    validateToken(config.token).then(result => {
      setValidating(false);
      if (result.valid && result.credentials) {
        setCredentials(result.credentials);
        postToParent('ready', { room: config.room });
      } else {
        setError(result.error || 'Invalid session');
        postToParent('error', { code: 'INVALID_SESSION', message: result.error });
      }
    });
  }, [config.token, config.room]);

  // Apply custom branding color
  useEffect(() => {
    if (config.color) {
      document.documentElement.style.setProperty('--mediasfu-primary', config.color);
    }
  }, [config.color]);

  // Credentials object for SDK
  const sdkCredentials = useMemo(() => ({
    apiUserName: credentials?.apiUserName || '',
    apiKey: credentials?.apiKey || '',
  }), [credentials]);

  // Validation error
  if (!config.room) {
    return (
      <div className="error-container">
        <h1>Invalid Configuration</h1>
        <p>Room name is required. Please check your widget configuration.</p>
      </div>
    );
  }

  // Loading state
  if (validating) {
    return (
      <div className="loading-container">
        <div className="loading-spinner" />
        <p>Connecting to meeting...</p>
      </div>
    );
  }

  // Error state
  if (error || !credentials) {
    return (
      <div className="error-container">
        <h1>Session Error</h1>
        <p>{error || 'Failed to authenticate. Please try refreshing the widget.'}</p>
      </div>
    );
  }

  // Render the meeting room
  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <ModernMediasfuGeneric
        PrejoinPage={config.autoJoin ? undefined : ModernPreJoinPage}
        credentials={sdkCredentials}
        connectMediaSFU={true}
      />
    </div>
  );
}

// Main App - routes to appropriate component based on mode
function App() {
  // Check if this is a click-to-call request
  if (isClickToCall()) {
    return <ClickToCallApp />;
  }

  // Otherwise, render meeting room
  return <MeetingRoomApp />;
}

export default App;
