import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faMicrophone,
  faMicrophoneSlash,
  faVolumeUp,
  faVolumeMute,
  faPhone,
  faPhoneSlash,
  faPause,
  faPlay,
  faCog,
  faRobot,
  faUser,
  faUsers,
  faStop,
  faTimes,
  faTowerBroadcast,
  faCircle,
  faMusic,
  faPhoneVolume
} from '@fortawesome/free-solid-svg-icons';
import { AudioGrid } from 'mediasfu-reactjs';
import MediaSFUHandler from './MediaSFUHandler';
import AdvancedControlsModal from './AdvancedControlsModal';
import ConfirmationModal from '../Common/ConfirmationModal';
import { roomLogger } from '../../utils/logger';
import { callService } from '../../services/callService';
import { toggleAudio } from '../../hooks/useAudioVideoSDK';
import { extractCleanIdentifier } from '../../utils/sipCallerParser';
import './MediaSFURoomDisplay.css';

type ParticipantSnapshot = {
  id: string;
  name: string;
  muted: boolean;
  islevel?: string;
};

const normalizeParticipants = (participants: any[] = []): ParticipantSnapshot[] => {
  return participants
    .map((participant) => {
      const rawId =
        participant?.id !== undefined && participant?.id !== null
          ? String(participant.id)
          : '';
      const fallbackName =
        participant?.name ?? participant?.displayName ?? participant?.participantName ?? '';
      const rawName = String(fallbackName);

      return {
        id: rawId.trim(),
        name: rawName.trim(),
        muted: Boolean(participant?.muted),
        islevel: participant?.islevel != null ? String(participant.islevel) : undefined,
      };
    })
    .map((participant) => ({
      id: participant.id || participant.name,
      name: participant.name,
      muted: participant.muted,
      islevel: participant.islevel,
    }))
    .sort((a, b) => {
      const leftKey = (a.id || a.name || '').toLowerCase();
      const rightKey = (b.id || b.name || '').toLowerCase();
      return leftKey.localeCompare(rightKey);
    });
};

const areParticipantSnapshotsEqual = (
  previous: ParticipantSnapshot[],
  next: ParticipantSnapshot[],
): boolean => {
  if (previous.length !== next.length) {
    return false;
  }

  for (let index = 0; index < previous.length; index += 1) {
    const prev = previous[index];
    const curr = next[index];

    if (prev.id !== curr.id || prev.name !== curr.name || prev.muted !== curr.muted || prev.islevel !== curr.islevel) {
      return false;
    }
  }

  return true;
};

// No complex object processing needed - direct use of MediaSFU params

interface MediaSFURoomDisplayProps {
  roomName: string;
  callId?: string; // SIP call ID for backend operations (required for hold, transfer, source switching)
  participantName?: string;
  isConnected?: boolean;
  onConnectionChange?: (connected: boolean) => void;
  onMicrophoneChange?: (enabled: boolean) => void;
  onDisconnect?: (reason?: { type: 'user' | 'room-ended' | 'socket-error', details?: string }) => void;
  onEndCall?: (callId: string) => void; // New prop for ending SIP calls
  autoJoin?: boolean;
  isOutgoingCallSetup?: boolean; // Flag to indicate this is a room for outgoing call preparation
  onRoomNameUpdate?: (realRoomName: string) => void; // Callback when MediaSFU returns the real room name
  currentCall?: any; // Current call data for this room (when a call is active)
  duration?: number; // Duration for room creation (in minutes)
  onParticipantsUpdate?: (participants: ParticipantSnapshot[]) => void;
  autoUnmute?: boolean; // Auto-unmute after connection (Flutter pattern)
  onAutoUnmuteComplete?: (success: boolean) => void; // Callback when auto-unmute completes
}

interface MediaSFUState {
  isConnected: boolean;
  isMicEnabled: boolean;
  isAudioEnabled: boolean;
  audioLevel: number;
  participants: any[];
  roomAudio: any[];
  roomStatus: string;
  alertMessage: string;
  isPlayToAll: boolean;
  currentCallData?: any; // Store fetched call data including activeMediaSource
}

const MediaSFURoomDisplay: React.FC<MediaSFURoomDisplayProps> = ({
  roomName,
  callId,
  participantName = 'voipuser',
  isConnected = false,
  onConnectionChange,
  onMicrophoneChange,
  onDisconnect,
  onEndCall,
  autoJoin = true,
  isOutgoingCallSetup = false,
  onRoomNameUpdate,
  currentCall,
  duration = 30,
  onParticipantsUpdate,
  autoUnmute = false,
  onAutoUnmuteComplete,
}) => {
  const [roomState, setRoomState] = useState<MediaSFUState>({
    isConnected: false,
    isMicEnabled: false,
    isAudioEnabled: true,
    audioLevel: 0,
    participants: [],
    roomAudio: [],
    roomStatus: 'active',
    alertMessage: '',
    isPlayToAll: false,
    currentCallData: null
  });

  const [sourceChanged, setSourceChanged] = useState(0);
  const [showRoomAudio, setShowRoomAudio] = useState(true);
  const [isOnHold, setIsOnHold] = useState(false);
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
  const [isPlayToAllLoading, setIsPlayToAllLoading] = useState(false);
  const [isHoldLoading, setIsHoldLoading] = useState(false);
  const [isAgentLoading, setIsAgentLoading] = useState(false);
  const [isEndCallLoading, setIsEndCallLoading] = useState(false);
  const [isTakeControlLoading, setIsTakeControlLoading] = useState(false);
  const [isSmartSwitchLoading, setIsSmartSwitchLoading] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const [showHoldModal, setShowHoldModal] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  // Track previous parameters for optimized updates
  const previousParamsRef = useRef<Record<string, any>>({});
  const [confirmationConfig, setConfirmationConfig] = useState<{
    title: string;
    message: string;
    type: 'warning' | 'danger' | 'info';
    onConfirm: () => void;
  } | null>(null);
  const [hasHumanControl, setHasHumanControl] = useState(false); // Track if we have control
  const sourceParameters = useRef<Record<string, any>>({});

  // Widget call detection: widget calls have '_widget_' in their sipCallId
  const isWidgetCall = Boolean(callId?.includes('_widget_'));

  // Auto-unmute tracking ref — ensures we only attempt once per mount/autoUnmute toggle
  const autoUnmuteAttemptedRef = useRef(false);

  // Fetch current call data including activeMediaSource
  const fetchCallData = useCallback(async () => {
    if (!callId) {
      roomLogger.debug('fetchCallData: No callId provided');
      return null;
    }

    // Only proceed if callId starts with 'prod' - otherwise it's invalid or a dummy
    if (!callId.startsWith('prod')) {
      return null;
    }

    try {
      const result = await callService.getCallState(callId);
      if (result.success && result.data) {
        // Store more complete call data for UI display
        const callData = {
          activeMediaSource: result.data.activeMediaSource,
          status: result.data.status,
          onHold: result.data.onHold,
          durationSeconds: result.data.durationSeconds,
          calledUri: result.data.calledUri,
          callerIdRaw: result.data.callerIdRaw,
          direction: result.data.direction,
          playingMusic: result.data.playingMusic,
          pendingHumanIntervention: result.data.pendingHumanIntervention,
          agentCreated: result.data.agentCreated,
          isWidgetCall: result.data.isWidgetCall,
        };

        // Use setTimeout to avoid setState during render
        setTimeout(() => {
          setRoomState(prev => ({ ...prev, currentCallData: callData }));
          // Sync hold state from backend so UI reflects actual call state
          if (typeof callData.onHold === 'boolean') {
            setIsOnHold(callData.onHold);
          }
        }, 0);
        return callData;
      } else {

      }
    } catch (error) {

    }
    return null;
  }, [callId]);

  // Intelligent agent detection function
  const hasAgentInRoom = useCallback(() => {
    if (!roomState.participants || roomState.participants.length === 0) {
      return false;
    }

    // Check for SIP agents only: ID starts with 'sip_' and ends with '_agent'
    return roomState.participants.some((participant: any) => {
      const id = (participant.id || '').toLowerCase();

      // SIP agent must start with 'sip_' and end with '_agent'
      return id.startsWith('sip_') && id.endsWith('_agent');
    });
  }, [roomState.participants]);

  // Enhanced source detection based on SIP call data and participant patterns
  const isActiveMediaSourceAgent = useCallback(() => {
    // Primary check: Use activeMediaSource from fetched call data (case insensitive)
    const activeSource = roomState.currentCallData?.activeMediaSource?.toLowerCase();
    if (activeSource === 'agent') {
      return true;
    }

    // Secondary check: Analyze actual room participants for SIP agent detection
    if (!roomState.participants || roomState.participants.length === 0) {
      return false;
    }

    // Find the currently speaking/active participant
    const activeParticipant = roomState.participants.find((participant: any) => {
      // Check for microphone activity indicators (only using properties that exist)
      const hasActiveMic = participant.muted === false;

      // Check for active stream indicators
      const hasActiveStream = participant.audioID && !participant.muted;

      return (hasActiveMic || hasActiveStream) && participant.id.startsWith('sip_') && participant.id.endsWith('_agent');
    });

    if (activeParticipant) {
      // Check if active participant is a SIP agent: starts with 'sip_' and ends with '_agent'
      const id = (activeParticipant.id || '').toLowerCase();

      return id.startsWith('sip_') && id.endsWith('_agent');
    }

    // If only one participant, check if they are a SIP agent
    if (roomState.participants.length === 1) {
      const singleParticipant = roomState.participants[0];
      const id = (singleParticipant.id || '').toLowerCase();

      return id.startsWith('sip_') && id.endsWith('_agent');
    }

    //if direction is outgoing and activeMediaSource is not human, then it is agent
    if (roomState.currentCallData?.direction === 'outgoing') {
      if (!activeSource || (activeSource && activeSource !== 'human') || (activeSource === 'human' && !roomState.currentCallData?.humanName)) {
        //first check if not part of our outgoing call setup
        if (!isOutgoingCallSetup) {
          return true;
        }
      }
    }

    return false;
  }, [roomState.participants, roomState.currentCallData, isOutgoingCallSetup]);

  // Intelligent agent status detection based on activeMediaSource
  const getAgentStatus = useCallback(() => {
    const activeSource = roomState.currentCallData?.activeMediaSource?.toLowerCase();
    const isPlayingMusic = roomState.currentCallData?.playingMusic;

    if (!activeSource || activeSource === 'none') {
      return 'stopped'; // Agent is stopped/paused
    } else if (activeSource === 'agent') {
      // If agent is the source but music is playing, it's effectively paused (wait music)
      if (isPlayingMusic) {
        return 'waiting'; // Wait music playing over agent
      }
      return 'active'; // Agent is active and speaking
    } else if (activeSource === 'human') {
      return 'paused'; // Agent is paused while human speaks
    } else if (activeSource === 'playback') {
      return 'stopped'; // Playback (wait music) - agent not active
    }

    return 'unknown'; // Unknown state
  }, [roomState.currentCallData]);

  // Determine if start or stop agent should be enabled
  const shouldShowStartAgent = useCallback(() => {
    const agentStatus = getAgentStatus();
    return agentStatus === 'stopped'; // Only show start when agent is fully stopped
  }, [getAgentStatus]);

  const shouldShowStopAgent = useCallback(() => {
    const agentStatus = getAgentStatus();
    return agentStatus === 'active' || agentStatus === 'paused'; // Show stop when agent is active or paused
  }, [getAgentStatus]);

  // Get current agent detection state
  const agentInRoom = hasAgentInRoom();
  const activeSourceIsAgent = isActiveMediaSourceAgent();

  // Allow any user to control agents (no host privilege requirement)
  const canControlAgent = !!callId; // Only require call ID for agent controls

  // Fetch call data periodically when callId is available
  useEffect(() => {
    if (!callId) return;

    // Initial fetch
    fetchCallData();

    // Set up periodic fetching every 2 seconds
    const interval = setInterval(fetchCallData, 2000);

    return () => clearInterval(interval);
  }, [callId, fetchCallData]);

  // Continuous sourceParameters monitoring for outgoing room setup
  // This is critical for detecting real-time changes when no call is active yet
  useEffect(() => {
    if (!isOutgoingCallSetup || (callId && callId.trim())) return; // Only for outgoing setup without active call

    const monitorSourceParameters = () => {
      const params = sourceParameters.current;

      if (Object.keys(params).length > 0) {
        // Force update of room state with current sourceParameters
        const isValidRoom = !!(params.roomName && params.roomName.trim());

        if (isValidRoom) {
          const hasSocket = !!(params.socket || params.localSocket);
          // Use socket and room name presence to determine if room is active
          const hasValidConnection = hasSocket && isValidRoom;
          const hasParticipants = params.participants && params.participants.length > 0;
          const noFailureMessage = !params.alertMessage ||
                                   (!params.alertMessage.includes("ended") &&
                                    !params.alertMessage.includes("failed") &&
                                    !params.alertMessage.includes("error"));

          const connected = isValidRoom && (hasSocket || hasValidConnection || hasParticipants) && noFailureMessage;

          // CRITICAL: If roomName has changed from our prop roomName, call onRoomNameUpdate
          if (params.roomName !== roomName && onRoomNameUpdate) {
            onRoomNameUpdate(params.roomName);
          }

          // Update room state with latest sourceParameters data - use setTimeout to avoid setState during render
          // Only update essential connection state, let main effect handle audio streams properly
          setTimeout(() => {
            setRoomState(prev => ({
              ...prev,
              isConnected: connected,
              isMicEnabled: params.audioAlreadyOn || false,
              audioLevel: params.audioLevel || 0,
              participants: params.participants || [],
              roomAudio: params.audioOnlyStreams || [],
              roomStatus: '', // roomStatus property doesn't exist on sourceParameters
              alertMessage: params.alertMessage || ''

            }));
          }, 0);

          // Check for room closure or failure based on room name and socket state
          const shouldDisconnect =
            !isValidRoom ||
            !hasSocket ||
            (params.alertMessage &&
             (params.alertMessage.includes("meeting has ended") ||
              params.alertMessage.includes("ended") ||
              params.alertMessage.includes("disconnected") ||
              params.alertMessage.includes("room not found") ||
              params.alertMessage.includes("invalid room")));

          if (shouldDisconnect) {
            roomLogger.info('Outgoing room closure detected during monitoring:', {
              alertMessage: params.alertMessage,
              roomName: params.roomName
            });

            // Determine the disconnect reason based on the detected conditions
            let disconnectReason: { type: 'user' | 'room-ended' | 'socket-error', details?: string };

            if (params.alertMessage && params.alertMessage.includes("meeting has ended")) {
              disconnectReason = { type: 'room-ended', details: `Room ended: ${params.alertMessage}` };
            } else if (params.alertMessage && params.alertMessage.includes("disconnected")) {
              disconnectReason = { type: 'socket-error', details: `Connection lost: ${params.alertMessage}` };
            } else if (params.alertMessage &&
                      (params.alertMessage.includes("room not found") || params.alertMessage.includes("invalid room"))) {
              disconnectReason = { type: 'room-ended', details: `Room invalid: ${params.alertMessage}` };
            } else if (!hasSocket) {
              disconnectReason = { type: 'socket-error', details: 'Socket disconnected' };
            } else {
              disconnectReason = { type: 'room-ended', details: 'Room ended: Unknown reason' };
            }

            // Add a small delay to ensure MediaSFU cleanup completes
            setTimeout(() => {
              roomLogger.info('Executing onDisconnect callback for closed outgoing room with reason:', disconnectReason);
              onDisconnect?.(disconnectReason);
            }, 100);
          }
        }
      }
    };

    // Initial check
    monitorSourceParameters();

    // Set up periodic monitoring every 5 seconds for outgoing rooms
    const monitoringInterval = setInterval(monitorSourceParameters, 5000);

    return () => {
      roomLogger.info('Stopping continuous sourceParameters monitoring for outgoing room');
      clearInterval(monitoringInterval);
    };
  }, [isOutgoingCallSetup, callId, roomName, onDisconnect, onRoomNameUpdate]);

  // Update sourceParameters and trigger re-render
  const updateSourceParameters = useCallback((params: Record<string, any>) => {
    if (params !== sourceParameters.current) {
      sourceParameters.current = params;

      // Use setTimeout to avoid setState during render
      setTimeout(() => {
        setSourceChanged((prev) => prev + 1);
      }, 0);
    }
  }, []);

  // Handle sourceParameters changes with enhanced room validation and optimized updates
  useEffect(() => {
    if (Object.keys(sourceParameters.current).length > 0) {
      const params = sourceParameters.current;
      const previousParams = previousParamsRef.current;
      const normalizedParticipants = normalizeParticipants(params.participants || []);
      const previousNormalizedParticipants = normalizeParticipants(
        previousParams.participants || [],
      );
      const participantsChanged = !areParticipantSnapshotsEqual(
        previousNormalizedParticipants,
        normalizedParticipants,
      );

      // Check for room validity - room should have a valid name
      const isValidRoom = !!(params.roomName && params.roomName.trim());

      // Update parent component with real room name if it's different from the initial dummy name
      if (isValidRoom && params.roomName !== roomName && params.roomName.trim() !== roomName.trim()) {
        roomLogger.info('MediaSFU returned real room name:', {
          initialName: roomName,
          realName: params.roomName,
          isOutgoingCallSetup,
          hasCallId: !!callId,
          sourceParamsKeys: Object.keys(params),
          participants: params.participants?.length || 0
        });
        // Use setTimeout to avoid setState during render
        setTimeout(() => {
          roomLogger.info('Calling onRoomNameUpdate with real room name:', {
            roomName: params.roomName,
            callback: !!onRoomNameUpdate
          });
          onRoomNameUpdate?.(params.roomName);
        }, 0);
      }

      // Enhanced connection detection - check multiple indicators
      const hasSocket = !!(params.socket || params.localSocket);
      const hasValidConnection = hasSocket && isValidRoom;
      const hasParticipants = params.participants && params.participants.length > 0;
      const noFailureMessage = !params.alertMessage ||
                               (!params.alertMessage.includes("ended") &&
                                !params.alertMessage.includes("failed") &&
                                !params.alertMessage.includes("error"));

      // Consider connected if room is valid AND (has socket OR has participants) AND no failure
      const connected = isValidRoom && (hasSocket || hasParticipants) && noFailureMessage;

      // Only update state for changed values to prevent unnecessary re-renders
      setTimeout(() => {
        setRoomState(prev => {
          const updates: Partial<typeof prev> = {};

          if (connected !== prev.isConnected) {
            updates.isConnected = connected;
          }

          if ((params.audioAlreadyOn || false) !== prev.isMicEnabled) {
            updates.isMicEnabled = params.audioAlreadyOn || false;
          }

          // Audio level update - check for undefined like ref implementation
          if (params.audioLevel !== undefined &&
              params.audioLevel !== (previousParams.audioLevel)) {
            updates.audioLevel = params.audioLevel || 0;
          }

          // Real-time audio grid update - ensure new streams are properly utilized
          if (params.audioOnlyStreams !== previousParams.audioOnlyStreams) {
            updates.roomAudio = params.audioOnlyStreams || [];
            if (params.audioOnlyStreams && params.audioOnlyStreams.length > 0) {
              roomLogger.debug('Audio grid updated with new streams:', {
                streamCount: params.audioOnlyStreams.length,
                roomName,
                isOutgoingSetup: isOutgoingCallSetup,
                hasCallId: !!callId,
                streams: params.audioOnlyStreams.map((stream: any) => ({
                  id: stream.id || 'unknown',
                  name: stream.name || 'unnamed'
                }))
              });
            } else {
            }
          }

          // Participants update - use deep comparison like the ref implementation
          if (participantsChanged) {
            updates.participants = params.participants || [];
          }

          // Room status is derived from socket state and room name, not from params
          const currentRoomStatus = (hasSocket && isValidRoom) ? 'active' : '';
          if (currentRoomStatus !== prev.roomStatus) {
            updates.roomStatus = currentRoomStatus;
          }

          if ((params.alertMessage || '') !== prev.alertMessage) {
            updates.alertMessage = params.alertMessage || '';
          }

          // Return updated state only if there are actual changes
          return Object.keys(updates).length > 0 ? { ...prev, ...updates } : prev;
        });
        if (participantsChanged) {
          onParticipantsUpdate?.(normalizedParticipants);
        }
      }, 0);

      // Store complete sourceParameters like ref implementation
      previousParamsRef.current = params;


      // Use setTimeout to avoid setState during render
      if (connected !== roomState.isConnected) {
        roomLogger.info('MediaSFU connection state changing:', {
          from: roomState.isConnected,
          to: connected,
          roomName: params.roomName,
          hasSocket,
          hasValidConnection,
          hasParticipants,
          alertMessage: params.alertMessage,
          isOutgoingSetup: isOutgoingCallSetup
        });
        setTimeout(() => onConnectionChange?.(connected), 0);
      }

      // Use setTimeout to avoid setState during render
      const micEnabled = params.audioAlreadyOn || false;
      if (micEnabled !== roomState.isMicEnabled) {
        setTimeout(() => onMicrophoneChange?.(micEnabled), 0);
      }

      // Enhanced room end/disconnect detection
      const shouldDisconnect =
        // Invalid room name indicates room no longer exists
        !isValidRoom ||
        // Alert message indicators
        (params.alertMessage &&
         (params.alertMessage.includes("meeting has ended") ||
          params.alertMessage.includes("ended") ||
          params.alertMessage.includes("disconnected") ||
          params.alertMessage.includes("room not found") ||
          params.alertMessage.includes("invalid room")));

      if (shouldDisconnect) {
        roomLogger.info('Room disconnection detected:', {
          isValidRoom,
          alertMessage: params.alertMessage,
          isOutgoingSetup: isOutgoingCallSetup,
          hasCallId: !!callId
        });

        // Determine the disconnect reason based on the detected conditions
        let disconnectReason: { type: 'user' | 'room-ended' | 'socket-error', details?: string };

        if (params.alertMessage && params.alertMessage.includes("meeting has ended")) {
          disconnectReason = { type: 'room-ended', details: `Room ended: ${params.alertMessage}` };
        } else if (params.alertMessage && params.alertMessage.includes("disconnected")) {
          disconnectReason = { type: 'socket-error', details: `Connection lost: ${params.alertMessage}` };
        } else if (params.alertMessage &&
                  (params.alertMessage.includes("room not found") || params.alertMessage.includes("invalid room"))) {
          disconnectReason = { type: 'room-ended', details: `Room invalid: ${params.alertMessage}` };
        } else if (!isValidRoom) {
          disconnectReason = { type: 'room-ended', details: 'Invalid room name detected' };
        } else {
          disconnectReason = { type: 'room-ended', details: `Room ended: ${params.alertMessage || 'Unknown reason'}` };
        }

        setTimeout(() => {
          roomLogger.info('Executing onDisconnect callback with reason:', disconnectReason);
          onDisconnect?.(disconnectReason);
        }, 0);
      }
    }
  }, [
    sourceChanged,
    roomState.isConnected,
    onConnectionChange,
    onMicrophoneChange,
    onDisconnect,
    roomState.isMicEnabled,
    onRoomNameUpdate,
    roomName,
    isOutgoingCallSetup,
    callId,
    onParticipantsUpdate,
  ]);

  // Fallback connection detection - check periodically if we should be connected
  useEffect(() => {
    if (!roomState.isConnected && roomName && autoJoin) {
      const checkConnection = () => {
        const params = sourceParameters.current;
        roomLogger.debug('Fallback connection check:', {
          paramsKeys: Object.keys(params),
          roomName: params.roomName,
          participants: params.participants?.length || 0,
          socket: !!params.socket,
          localSocket: !!params.localSocket,
          alertMessage: params.alertMessage
        });

        if (Object.keys(params).length > 0) {
          const hasValidRoomName = params.roomName === roomName;
          const hasParticipants = params.participants && params.participants.length > 0;
          const hasSocket = !!(params.socket || params.localSocket);
          const noFailureMessages = !params.alertMessage ||
                                   (!params.alertMessage.includes("ended") &&
                                    !params.alertMessage.includes("failed") &&
                                    !params.alertMessage.includes("error"));

          roomLogger.debug('Fallback connection criteria:', {
            hasValidRoomName,
            hasParticipants,
            hasSocket,
            noFailureMessages
          });

          if (hasValidRoomName && (hasParticipants || hasSocket) && noFailureMessages) {
            roomLogger.info('Fallback connection detection triggered - updating connection state');
            onConnectionChange?.(true);
          }
        }
      };

      // Immediate check after 1 second, then every 3 seconds for up to 30 seconds
      const timeouts = [1000, 4000, 7000, 10000, 13000, 16000, 19000, 22000, 25000, 28000].map(delay =>
        setTimeout(checkConnection, delay)
      );

      return () => timeouts.forEach(clearTimeout);
    }
  }, [roomState.isConnected, roomName, autoJoin, onConnectionChange]);

  // Sync hasHumanControl with activeSourceIsAgent state
  useEffect(() => {
    // If agent is active, we don't have control
    // If agent is not active and there's an agent in room, we likely have control
    if (activeSourceIsAgent) {
      // Use setTimeout to avoid setState during render
      setTimeout(() => {
        setHasHumanControl(false);
      }, 0);
    } else if (agentInRoom && roomState.isConnected) {
      // Only set to true if we're connected and there's an agent but it's not active
      // This means human is likely in control; first check if our mic is enabled

      setTimeout(() => {
        console.log('Setting hasHumanControl to true - agent in room but not active');
        setHasHumanControl(true);
      }, 0);
    } else {
      // No agent in room or not connected
      setTimeout(() => {
        setHasHumanControl(false);
      }, 0);
    }
  }, [activeSourceIsAgent, agentInRoom, roomState.isConnected]);

  // Connection timeout effect to handle stuck room creation
  useEffect(() => {
    if (!roomState.isConnected && autoJoin && isOutgoingCallSetup) {
      // Set up a 30-second timeout for connection
      const connectionTimeout = setTimeout(() => {
        roomLogger.error('Room connection timeout - connection never established:', {
          roomName,
          isOutgoingCallSetup,
          autoJoin,
          timeoutSeconds: 30
        });

        // Trigger disconnect callback with socket error
        onDisconnect?.({
          type: 'socket-error',
          details: 'Connection timeout - room creation took too long'
        });
      }, 30000); // 30 seconds

      return () => clearTimeout(connectionTimeout);
    }
  }, [roomState.isConnected, autoJoin, isOutgoingCallSetup, roomName, onDisconnect]);

  // Auto-unmute effect — when autoUnmute=true, automatically toggle mic on after connected
  // Follows Flutter's _triggerAutoUnmuteIfNeeded pattern:
  //   1. Wait 750ms after connection established
  //   2. Toggle microphone on
  //   3. Poll for confirmation up to 3 seconds
  //   4. Fire onAutoUnmuteComplete callback with success/failure
  useEffect(() => {
    if (!autoUnmute || !roomState.isConnected || autoUnmuteAttemptedRef.current) {
      return;
    }

    // Mark as attempted so we don't retry
    autoUnmuteAttemptedRef.current = true;

    const autoUnmuteTimer = setTimeout(async () => {
      // If mic is already on, report success immediately
      if (roomState.isMicEnabled) {
        roomLogger.info('Auto-unmute: mic already enabled');
        onAutoUnmuteComplete?.(true);
        return;
      }

      // Need sourceParameters to toggle
      if (Object.keys(sourceParameters.current).length === 0) {
        roomLogger.warn('Auto-unmute: no sourceParameters available, cannot toggle');
        onAutoUnmuteComplete?.(false);
        return;
      }

      roomLogger.info('Auto-unmute: toggling microphone on...');

      try {
        await toggleAudio({ sourceParameters: sourceParameters.current });
      } catch (err) {
        roomLogger.warn('Auto-unmute: hook failed, trying fallback', err);
        try {
          const { clickAudio } = await import('mediasfu-reactjs');
          await clickAudio({ parameters: sourceParameters.current as any });
        } catch (fallbackErr) {
          roomLogger.error('Auto-unmute: fallback also failed', fallbackErr);
          onAutoUnmuteComplete?.(false);
          return;
        }
      }

      // Poll for mic confirmation (up to 3 seconds, check every 300ms)
      let confirmAttempts = 0;
      const maxConfirmAttempts = 10;
      const confirmInterval = setInterval(() => {
        confirmAttempts++;
        const micNowOn = sourceParameters.current?.audioAlreadyOn === true;
        if (micNowOn) {
          clearInterval(confirmInterval);
          roomLogger.info('Auto-unmute: confirmed mic is ON');
          onAutoUnmuteComplete?.(true);
        } else if (confirmAttempts >= maxConfirmAttempts) {
          clearInterval(confirmInterval);
          // Even if poll didn't detect it, the toggle likely succeeded
          roomLogger.warn('Auto-unmute: confirmation timed out, assuming success');
          onAutoUnmuteComplete?.(true);
        }
      }, 300);
    }, 750); // 750ms delay after connection, matching Flutter

    return () => clearTimeout(autoUnmuteTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoUnmute, roomState.isConnected]);

  // Reset auto-unmute tracking when autoUnmute prop turns off
  useEffect(() => {
    if (!autoUnmute) {
      autoUnmuteAttemptedRef.current = false;
    }
  }, [autoUnmute]);

  // Toggle microphone using MediaSFU's audio toggle
  const toggleMicrophone = useCallback(async () => {
    if (Object.keys(sourceParameters.current).length === 0) {
      roomLogger.warn('Cannot toggle microphone: Not connected to MediaSFU room');
      return;
    }

    try {
      // Use our improved audio SDK hook
      await toggleAudio({ sourceParameters: sourceParameters.current });
      roomLogger.debug('Microphone toggled successfully via useAudioVideoSDK');
    } catch (error) {
      roomLogger.warn('Hook failed, falling back to direct MediaSFU import:', error);

      try {
        // Fallback to direct MediaSFU import
        const { clickAudio } = await import('mediasfu-reactjs');
        await clickAudio({
          parameters: sourceParameters.current as any
        });
        roomLogger.debug('Microphone toggled successfully via fallback');
      } catch (fallbackError) {
        roomLogger.error('Error toggling microphone:', fallbackError);
      }
    }
  }, []);

  // Toggle room audio (show/hide AudioGrid)
  const toggleRoomAudio = useCallback(() => {
    setShowRoomAudio(prev => !prev);
  }, []);

  // Hold/resume call functionality
  const toggleHold = useCallback(async () => {
    if (Object.keys(sourceParameters.current).length === 0) {
      roomLogger.warn('Cannot toggle hold: Not connected to MediaSFU room');
      return;
    }

    if (!callId) {
      roomLogger.warn('Cannot toggle hold: Call ID is required for SIP operations', {
        roomName,
        hasParameters: Object.keys(sourceParameters.current).length > 0
      });
      return;
    }

    if (isOnHold) {
      // Resume call directly
      setIsHoldLoading(true);
      try {
        const result = await callService.unholdCall(callId);
        if (result.success) {
          setIsOnHold(false);
          roomLogger.info('Call resumed from hold', { callId, roomName });
        } else {
          roomLogger.error('Failed to resume call', { callId, error: result.error });
        }
      } catch (error) {
        roomLogger.error('Error resuming call:', { error, callId, roomName });
      } finally {
        setIsHoldLoading(false);
      }
    } else {
      // Show hold modal for options
      setShowHoldModal(true);
    }
  }, [isOnHold, callId, roomName]);

  // Handle hold with options from modal
  const handleHoldWithOptions = useCallback(async (message: string, pauseRecording: boolean) => {
    setIsHoldLoading(true);
    setShowHoldModal(false);

    try {
      const result = await callService.holdCall(callId!, message, pauseRecording);
      if (result.success) {
        setIsOnHold(true);
        roomLogger.info('Call placed on hold', { callId, roomName, message, pauseRecording });
      } else {
        roomLogger.error('Failed to hold call', { callId, error: result.error });
      }
    } catch (error) {
      roomLogger.error('Error holding call:', { error, callId, roomName });
    } finally {
      setIsHoldLoading(false);
    }
  }, [callId, roomName]);

  // Switch source handlers - using unified switchSource endpoint
  const handleSwitchToAgent = useCallback(async () => {
    if (!callId || Object.keys(sourceParameters.current).length === 0) {
      roomLogger.warn('Cannot switch source: Not connected to MediaSFU room or missing call ID');
      return;
    }

    try {
      const result = await callService.switchSource(callId, 'agent');

      if (result.success) {
        setHasHumanControl(false); // Agent now has control, we don't
        roomLogger.info('Successfully switched to AI agent', { callId, roomName });
      } else {
        roomLogger.error('Failed to switch to agent', { callId, error: result.error });
      }
    } catch (error) {
      roomLogger.error('Error switching to agent:', { error, callId, roomName });
    }
  }, [callId, roomName]);

  // Start agent handler
  const handleStartAgent = useCallback(async () => {
    if (!callId || Object.keys(sourceParameters.current).length === 0) {
      roomLogger.warn('Cannot start agent: Not connected to MediaSFU room or missing call ID');
      return;
    }

    setIsAgentLoading(true);
    try {
      const result = await callService.startAgent(callId);

      if (result.success) {
        roomLogger.info('Successfully started agent', { callId, roomName });
      } else {
        roomLogger.error('Failed to start agent', { callId, error: result.error });
      }
    } catch (error) {
      roomLogger.error('Error starting agent:', { error, callId, roomName });
    } finally {
      setIsAgentLoading(false);
    }
  }, [callId, roomName]);

  // Stop agent handler
  const handleStopAgent = useCallback(async () => {
    if (!callId || Object.keys(sourceParameters.current).length === 0) {
      roomLogger.warn('Cannot stop agent: Not connected to MediaSFU room or missing call ID');
      return;
    }

    setIsAgentLoading(true);
    try {
      const result = await callService.stopAgent(callId);

      if (result.success) {
        roomLogger.info('Successfully stopped agent', { callId, roomName });
      } else {
        roomLogger.error('Failed to stop agent', { callId, error: result.error });
      }
    } catch (error) {
      roomLogger.error('Error stopping agent:', { error, callId, roomName });
    } finally {
      setIsAgentLoading(false);
    }
  }, [callId, roomName]);

  // Get current human participant name from room participants
  const getCurrentHumanParticipantName = useCallback(() => {
    // Priority 1: Use the exact name we joined the MediaSFU room with
    // This is the most reliable way to identify ourselves in the room
    if (roomState.participants && roomState.participants.length > 0) {
      // First, try to find ourselves by matching the exact name we joined with
      const ourParticipant = roomState.participants.find((participant: any) => {
        const id = (participant.id || '').toLowerCase();
        // Must be non-SIP and match our participant name
        return !id.startsWith('sip_') && participant.name === participantName;
      });

      if (ourParticipant) {
        // Found ourselves - use our exact name
        return ourParticipant.name;
      }

      if (isWidgetCall) {
        // Widget call: the widget caller created the room (islevel '2').
        // We (the dashboard user) joined with a different islevel.
        // Find ourselves as the non-host, non-SIP, non-agent participant.
        const dashboardUser = roomState.participants.find((participant: any) => {
          const id = (participant.id || '').toLowerCase();
          const islevel = participant.islevel != null ? String(participant.islevel) : undefined;
          return !id.startsWith('sip_') && !id.endsWith('_agent') && islevel !== '2';
        });
        if (dashboardUser) {
          return dashboardUser.name || participantName;
        }
      } else {
        // Regular SIP call: find the only non-SIP human
        const humanParticipants = roomState.participants.filter((participant: any) => {
          const id = (participant.id || '').toLowerCase();
          return !id.startsWith('sip_');
        });

        if (humanParticipants.length === 1) {
          // Only one human in room - that must be us
          return humanParticipants[0].name || participantName;
        }
      }
    }

    // Priority 2: Fallback to the participantName prop (what we joined with)
    // This should match what we used when joining the MediaSFU room
    return participantName;
  }, [roomState.participants, participantName, isWidgetCall]);

  // Take control flow - intelligent interaction for human takeover
  const handleTakeControl = useCallback(async () => {
    if (!callId || Object.keys(sourceParameters.current).length === 0) {
      roomLogger.warn('Cannot take control: Not connected to MediaSFU room or missing call ID');
      return;
    }

    // Internal function to perform the actual switch
    const performSwitch = async () => {
      try {
        const humanName = getCurrentHumanParticipantName();
        const result = await callService.switchSource(callId, 'human', humanName || 'Human User');

        if (result.success) {
          setHasHumanControl(true); // Mark that we now have control
          roomLogger.info('Successfully took control of conversation', {
            callId,
            roomName,
            humanName,
            micEnabled: roomState.isMicEnabled
          });
        } else {
          roomLogger.error('Failed to take control', { callId, error: result.error });
        }
      } catch (error) {
        roomLogger.error('Error taking control:', { error, callId, roomName });
      }
    };

    try {
      setIsTakeControlLoading(true);
      // Step 1: Check if user's microphone is muted and prompt to unmute
      if (!roomState.isMicEnabled) {
        setConfirmationConfig({
          title: 'Unmute Microphone',
          message: 'Your microphone is currently muted. Would you like to unmute it before taking control of the conversation?',
          type: 'warning',
          onConfirm: async () => {
            setShowConfirmation(false);
            await toggleMicrophone();
            // Give a moment for the microphone to activate
            await new Promise(resolve => setTimeout(resolve, 500));
            // Continue with taking control
            await performSwitch();
          }
        });
        setShowConfirmation(true);
        setIsTakeControlLoading(false);
        return;
      }

      // If microphone is already enabled, proceed directly
      await performSwitch();
    } catch (error) {
      roomLogger.error('Error in take control flow:', { error, callId, roomName });
    } finally {
      setIsTakeControlLoading(false);
    }
  }, [callId, roomName, roomState.isMicEnabled, getCurrentHumanParticipantName, toggleMicrophone]);

  // Smart source switching - automatically detect best action
  const handleSmartSourceSwitch = useCallback(async () => {
    if (!callId || Object.keys(sourceParameters.current).length === 0) {
      roomLogger.warn('Cannot perform smart switch: Not connected to MediaSFU room or missing call ID');
      return;
    }

    try {
      setIsSmartSwitchLoading(true);
      if (activeSourceIsAgent) {
        // Agent is active - offer to take control
        await handleTakeControl();
      } else if (agentInRoom) {
        // Human is active, agent available - switch to agent
        await handleSwitchToAgent();
      } else {
        // No agent available - start agent
        await handleStartAgent();
      }
    } catch (error) {
      roomLogger.error('Error in smart source switch:', { error, callId, roomName });
    } finally {
      setIsSmartSwitchLoading(false);
    }
  }, [callId, roomName, activeSourceIsAgent, agentInRoom, handleTakeControl, handleSwitchToAgent, handleStartAgent]);

  // Handle play to all toggle
  const handlePlayToAllToggle = useCallback(async () => {
    if (!callId || Object.keys(sourceParameters.current).length === 0) {
      roomLogger.warn('Cannot toggle play to all: Not connected to MediaSFU room or missing call ID');
      return;
    }

    setIsPlayToAllLoading(true);
    try {
      const newPlayToAll = !roomState.isPlayToAll;
      const result = await callService.updatePlayToAll(callId, newPlayToAll);

      if (result.success) {
        setRoomState(prev => ({ ...prev, isPlayToAll: newPlayToAll }));
        roomLogger.info('Successfully updated play to all', {
          callId,
          roomName,
          playToAll: newPlayToAll
        });
      } else {
        roomLogger.error('Failed to update play to all', { callId, error: result.error });
      }
    } catch (error) {
      roomLogger.error('Error updating play to all:', { error, callId, roomName });
    } finally {
      setIsPlayToAllLoading(false);
    }
  }, [callId, roomName, roomState.isPlayToAll]);

  // End SIP call vs Close room functionality
  const handleEndCall = useCallback(async () => {
    if (!callId) {
      roomLogger.warn('Cannot end call: No call ID available');
      return;
    }
    // Provide immediate visual feedback during action
    setIsEndCallLoading(true);
    try {
      if (onEndCall) {
        // Call handler immediately; support sync or async
        await Promise.resolve(onEndCall(callId));
      } else {
        roomLogger.warn('No onEndCall handler provided');
      }
    } catch (error) {
      roomLogger.error('Error while ending call via onEndCall handler:', error);
    } finally {
      setIsEndCallLoading(false);
    }
  }, [callId, onEndCall]);

  // Disconnect from room
  const handleDisconnect = useCallback(async () => {
    roomLogger.info('Disconnecting from MediaSFU room...');
    if (Object.keys(sourceParameters.current).length === 0) {
      roomLogger.warn('Cannot disconnect: Not connected to MediaSFU room');
      return;
    }

    try {
      setIsDisconnecting(true);
      // Import MediaSFU's disconnect function
      const { confirmExit } = await import('mediasfu-reactjs');
      await confirmExit({
        member: sourceParameters.current.member,
        socket: sourceParameters.current.socket,
        localSocket: sourceParameters.current.localSocket,
        roomName: sourceParameters.current.roomName,
        ban: false
      });

      roomLogger.info('Successfully disconnected from MediaSFU room');
      roomLogger.info('Successfully disconnected from MediaSFU room');
      roomLogger.info('Successfully disconnected from MediaSFU room');
      onDisconnect?.({ type: 'user', details: 'User manually disconnected from room' });
    } catch (error) {
      roomLogger.error('Error disconnecting from room:', error);
    } finally {
      setIsDisconnecting(false);
    }
  }, [onDisconnect]);

  // Get microphone status indicator
  const getMicrophoneStatus = () => {
    if (!roomState.isConnected) {
      return { text: 'Not connected', color: '#6c757d' };
    }
    if (roomState.isMicEnabled) {
      return { text: 'Microphone active', color: '#28a745' };
    }
    return { text: 'Microphone muted', color: '#dc3545' };
  };

  const micStatus = getMicrophoneStatus();

  return (
    <div className="mediasfu-room-display">
      <div className="room-header">
        <FontAwesomeIcon icon={faTowerBroadcast} style={{ color: 'var(--mrd-primary)', fontSize: '0.78rem' }} />
        <h3 className="room-title">MediaSFU Room</h3>
        <div className="room-name">{roomName}</div>
        <div className={`connection-dot ${roomState.isConnected ? 'connected' : 'disconnected'}`}
             title={roomState.isConnected ? 'Connected' : 'Disconnected'} />

        {/* Outgoing Call Setup Information */}
        {isOutgoingCallSetup && (
          <div className={`outgoing-call-setup-info ${!roomState.isConnected && !currentCall ? 'disconnected' : ''}`}>
            {currentCall ? (
              <>
                <div className="setup-message">
                  <FontAwesomeIcon icon={faPhoneVolume} style={{ fontSize: '0.65rem' }} /> <strong>Active Call</strong>
                </div>
                <div className="setup-instructions">
                  {(() => {
                    // Use the most current status and call info - prefer fetched data over prop
                    const currentStatus = roomState.currentCallData?.status || currentCall.status || 'in progress';

                    // Get the called number - prefer fetched data
                    const currentCalledUri = roomState.currentCallData?.calledUri || currentCall.calledUri || '';
                    const cleanCalledNumber = extractCleanIdentifier(currentCalledUri);

                    if (currentStatus === 'connected' || currentStatus === 'active') {
                      return `Connected call to ${cleanCalledNumber}`;
                    } else {
                      return `Call ${currentStatus} - ${cleanCalledNumber}`;
                    }
                  })()}
                </div>
              </>
            ) : !roomState.isConnected ? (
              <>
                <div className="setup-message error">
                  <FontAwesomeIcon icon={faCircle} style={{ fontSize: '0.5rem', color: '#f87171' }} /> <strong>Connection Lost</strong>
                </div>
                <div className="setup-instructions">
                  Close this room and create a new one to make calls.
                </div>
              </>
            ) : (
              <>
                <div className="setup-message success">
                  <FontAwesomeIcon icon={faPhoneVolume} style={{ fontSize: '0.65rem' }} /> <strong>Outgoing Call Room</strong>
                </div>
                <div className="setup-instructions">
                  {roomState.isMicEnabled ? (
                    <><FontAwesomeIcon icon={faMicrophone} style={{ fontSize: '0.6rem' }} /> Mic ready — make calls from this room.</>
                  ) : (
                    <><FontAwesomeIcon icon={faMicrophoneSlash} style={{ fontSize: '0.6rem' }} /> Turn on mic before making calls.</>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <div className="header-status-row">
          {/* Connection status hidden - replaced by dot in header */}

          {/* Participants display - simple row on desktop */}
          {roomState.participants && roomState.participants.length > 0 && (
            <div className={`participants-row ${agentInRoom ? 'has-agent' : ''}`}>
              <FontAwesomeIcon icon={faUsers} className="participants-icon" />
              <span className="participants-count">
                {roomState.participants.length} participant{roomState.participants.length !== 1 ? 's' : ''}
              </span>
              <div className="participants-list">
                {roomState.participants.slice(0, 3).map((participant: any, index: number) => {
                  const id = (participant.id || '').toLowerCase();

                  // Check if this is a SIP agent: starts with 'sip_' and ends with '_agent'
                  const isSipAgent = id.startsWith('sip_') && id.endsWith('_agent');

                  // Check if this is a SIP participant (starts with 'sip_')
                  const isSipParticipant = id.startsWith('sip_');

                  return (
                    <span
                      key={participant.id || participant.name || index}
                      className={`participant-name ${isSipAgent ? 'agent' : ''} ${isSipParticipant ? 'sip-participant' : ''}`}
                    >
                      {participant.name || `User ${index + 1}`}
                    </span>
                  );
                })}
                {roomState.participants.length > 3 && (
                  <span className="more-participants">
                    +{roomState.participants.length - 3} more
                  </span>
                )}
              </div>
            </div>
          )}

          {showRoomAudio && roomState.roomAudio.length > 0 && (
            <div className="room-audio-header">
              <div className="audio-info">
                <FontAwesomeIcon icon={faMusic} style={{ fontSize: '0.6rem', color: 'var(--mrd-text-secondary)' }} />
                <div className="audio-dots">
                  {Array.from({ length: Math.min(roomState.roomAudio.length, 5) }).map((_, i) => (
                    <div key={i} className="audio-dot"></div>
                  ))}
                </div>
              </div>
              {/* Hidden AudioGrid for functionality */}
              <div style={{ display: 'none' }}>
                <AudioGrid
                  componentsToRender={roomState.roomAudio}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="room-controls">
        <div className="primary-controls">
          {/* Microphone Control - Always available */}
          <button
            className={`control-btn mic-btn ${roomState.isMicEnabled ? 'active' : 'muted'}`}
            onClick={toggleMicrophone}
            disabled={!roomState.isConnected}
            title={roomState.isMicEnabled ? 'Mute microphone' : 'Unmute microphone'}
          >
            <FontAwesomeIcon
              icon={roomState.isMicEnabled ? faMicrophone : faMicrophoneSlash}
            />
            <span className="control-label">{roomState.isMicEnabled ? 'Mute' : 'Unmute'}</span>
          </button>

          {/* SIP Call Controls - Only show when we have a valid call ID */}
          {callId ? (
            <>
              {/* End Call */}
              <button
                className="control-btn end-btn"
                onClick={handleEndCall}
                disabled={!roomState.isConnected || isEndCallLoading}
                title="End SIP call"
              >
                <FontAwesomeIcon icon={isEndCallLoading ? faCog : faPhoneSlash} className={isEndCallLoading ? 'fa-spin' : ''} />
                <span className="control-label">{isEndCallLoading ? 'Ending...' : 'End Call'}</span>
              </button>

              {/* Hold/Resume */}
              {(() => {
                const callData = roomState.currentCallData;
                const canHold = !(!isOnHold && callData?.playingMusic && callData?.pendingHumanIntervention && callData?.activeMediaSource?.toLowerCase() !== 'agent');
                return (
                  <button
                    className={`control-btn hold-btn ${isOnHold ? 'active' : ''} ${isHoldLoading ? 'loading' : ''}`}
                    onClick={toggleHold}
                    disabled={!roomState.isConnected || isHoldLoading || !canHold}
                    title={
                      isHoldLoading
                        ? 'Processing...'
                        : !canHold
                          ? 'Wait music already playing'
                          : isOnHold ? 'Resume call' : 'Hold call'
                    }
                  >
                    <FontAwesomeIcon
                      icon={isHoldLoading ? faCog : isOnHold ? faPlay : faPause}
                      className={isHoldLoading ? 'fa-spin' : ''}
                    />
                    <span className="control-label">
                      {isHoldLoading ? 'Processing...' : isOnHold ? 'Resume' : 'Hold'}
                    </span>
                  </button>
                );
              })()}

              {/* Leave Room - For incoming calls (safe to leave without ending call) */}
              {!isOutgoingCallSetup && (
                <button
                  className="control-btn leave-room-btn"
                  onClick={handleDisconnect}
                  disabled={!roomState.isConnected || isDisconnecting}
                  title="Leave MediaSFU room (call continues in background)"
                >
                  <FontAwesomeIcon icon={isDisconnecting ? faCog : faTimes} className={isDisconnecting ? 'fa-spin' : ''} />
                  <span className="control-label">{isDisconnecting ? 'Leaving...' : 'Leave Room'}</span>
                </button>
              )}

              {/* Close Room for Outgoing Setups - Always available with warning */}
              {isOutgoingCallSetup && (
                <button
                  className="control-btn close-room-btn warning"
                  onClick={() => {
                    if (callId || currentCall) {
                      // Show warning modal if there's an active call
                      setConfirmationConfig({
                        title: 'Close Voice Room',
                        message: 'Closing this room may end any active calls. Are you sure you want to continue?',
                        type: 'warning',
                        onConfirm: () => {
                          setShowConfirmation(false);
                          handleDisconnect();
                        }
                      });
                      setShowConfirmation(true);
                    } else {
                      // No active call, safe to close
                      handleDisconnect();
                    }
                  }}
                  title="Close voice room (may end active calls)"
                >
                  <FontAwesomeIcon icon={isDisconnecting ? faCog : faTimes} className={isDisconnecting ? 'fa-spin' : ''} />
                  <span className="control-label">{isDisconnecting ? 'Closing...' : 'Close Room'}</span>
                </button>
              )}
            </>
          ) : (
            /* Close Room - Only show when no active call (non-outgoing setup) */
            !isOutgoingCallSetup ? (
              <button
                className="control-btn close-room-btn"
                onClick={handleDisconnect}
                disabled={!roomState.isConnected}
                title="Close room and disconnect"
              >
                <FontAwesomeIcon icon={faTimes} />
                <span className="control-label">Close Room</span>
              </button>
            ) : (
              /* For outgoing setups without active calls, show close with warning */
              <button
                className="control-btn close-room-btn warning"
                onClick={() => {
                  setConfirmationConfig({
                    title: 'Close Voice Room',
                    message: 'Are you sure you want to close this voice room? You can create a new one anytime.',
                    type: 'warning',
                    onConfirm: () => {
                      setShowConfirmation(false);
                      handleDisconnect();
                    }
                  });
                  setShowConfirmation(true);
                }}
                title="Close voice room"
              >
                <FontAwesomeIcon icon={faTimes} />
                <span className="control-label">Close Room</span>
              </button>
            )
          )}
        </div>

        {/* Secondary Controls - Conditional display based on call state */}
        {callId ? (
          // Full SIP controls when we have an active call
          <div className="secondary-controls">
            {/* Advanced Controls Toggle */}
            <button
              className={`control-btn advanced-btn ${showAdvancedControls ? 'active' : ''}`}
              onClick={() => setShowAdvancedControls(prev => !prev)}
              disabled={!roomState.isConnected}
              title={
                showAdvancedControls
                  ? 'Hide Advanced Controls'
                  : 'Show Advanced Controls (TTS, Audio, Source Switching)'
              }
            >
              <FontAwesomeIcon icon={faCog} />
              <span className="control-label">
                {showAdvancedControls ? 'Hide Advanced' : 'Advanced'}
                {!showAdvancedControls && <span className="expand-hint">click to expand</span>}
              </span>
            </button>

            {/* Take Control / Answer Call - Show whenever source is NOT already "human"
                Covers: agent active, wait music (playback), pendingHumanIntervention, or any non-human source */}
            {(() => {
              const currentSource = roomState.currentCallData?.activeMediaSource?.toLowerCase();
              const needsHumanTakeover = currentSource && currentSource !== 'human';
              const isPlayback = currentSource === 'playback';
              const isPending = roomState.currentCallData?.pendingHumanIntervention;
              const shouldShow = activeSourceIsAgent || hasHumanControl || needsHumanTakeover || isPending;

              if (!shouldShow) return null;

              // Determine button label based on current state
              const label = hasHumanControl
                ? 'You Have Control'
                : isTakeControlLoading
                  ? 'Taking...'
                  : (isPlayback || isPending) && !activeSourceIsAgent
                    ? 'Answer Call'
                    : 'Take Control';

              return (
                <button
                  className={`control-btn take-control-btn ${hasHumanControl ? 'has-control' : ''} ${(isPlayback || isPending) && !activeSourceIsAgent ? 'answer-call' : ''}`}
                  onClick={hasHumanControl ? undefined : handleTakeControl}
                  disabled={!roomState.isConnected || !canControlAgent || hasHumanControl || isTakeControlLoading}
                  title={
                    hasHumanControl
                      ? 'You have control of the conversation'
                      : (isPlayback || isPending)
                        ? 'Answer the call — stop wait music and talk to the caller'
                        : !roomState.isMicEnabled
                          ? 'Take control (will prompt to unmute microphone)'
                          : 'Take control of conversation'
                  }
                >
                  <FontAwesomeIcon
                    icon={isTakeControlLoading ? faCog : (isPlayback || isPending) && !activeSourceIsAgent && !hasHumanControl ? faPhone : faUser}
                    className={isTakeControlLoading ? 'fa-spin' : ''}
                  />
                  <span className="control-label">{label}</span>
                </button>
              );
            })()}

            {/* Smart Switch - Intelligent source switching */}
            {(!activeSourceIsAgent && agentInRoom) && (
              <button
                className="control-btn smart-switch-btn"
                onClick={handleSmartSourceSwitch}
                disabled={!roomState.isConnected || !canControlAgent || isSmartSwitchLoading}
                title="Switch to AI agent"
              >
                <FontAwesomeIcon
                  icon={isSmartSwitchLoading ? faCog : faRobot}
                  className={isSmartSwitchLoading ? 'fa-spin' : ''}
                />
                <span className="control-label">{isSmartSwitchLoading ? 'Switching...' : 'To Agent'}</span>
              </button>
            )}

            {/* Start/Stop Agent - Show based on intelligent agent status */}
            {agentInRoom && (
              <>
                {/* Start Agent - Show when agent is stopped */}
                {shouldShowStartAgent() && (
                  <button
                    className={`control-btn start-agent-btn ${isAgentLoading ? 'loading' : ''}`}
                    onClick={handleStartAgent}
                    disabled={!roomState.isConnected || !canControlAgent || isAgentLoading}
                    title={
                      isAgentLoading
                        ? 'Starting agent...'
                        : 'Start AI agent'
                    }
                  >
                    <FontAwesomeIcon
                      icon={isAgentLoading ? faCog : faPlay}
                      className={isAgentLoading ? 'fa-spin' : ''}
                    />
                    <span className="control-label">
                      {isAgentLoading ? 'Starting...' : 'Start Agent'}
                    </span>
                  </button>
                )}

                {/* Stop Agent - Show when agent is active or paused */}
                {shouldShowStopAgent() && (
                  <button
                    className={`control-btn stop-agent-btn ${isAgentLoading ? 'loading' : ''}`}
                    onClick={handleStopAgent}
                    disabled={!roomState.isConnected || !canControlAgent || isAgentLoading}
                    title={
                      isAgentLoading
                        ? 'Stopping agent...'
                        : 'Stop AI agent'
                    }
                  >
                    <FontAwesomeIcon
                      icon={isAgentLoading ? faCog : faStop}
                      className={isAgentLoading ? 'fa-spin' : ''}
                    />
                    <span className="control-label">
                      {isAgentLoading ? 'Stopping...' : 'Stop Agent'}
                    </span>
                  </button>
                )}
              </>
            )}

            {/* Bot Audio Scope - Only show when there's an agent in the room */}
            {agentInRoom && (
            <button
              className={`control-btn audio-scope-btn ${
                isPlayToAllLoading ? 'loading' :
                roomState.isPlayToAll ? 'active' : 'inactive'
              }`}
              onClick={handlePlayToAllToggle}
              disabled={!roomState.isConnected || isPlayToAllLoading}
              title={
                isPlayToAllLoading
                  ? 'Updating bot audio scope...'
                  : roomState.isPlayToAll
                    ? 'Bot audio playing to ALL participants'
                    : 'Bot audio playing to SIP caller ONLY'
              }
            >
              <FontAwesomeIcon
                icon={isPlayToAllLoading ? faCog : faVolumeUp}
                className={isPlayToAllLoading ? 'fa-spin' : ''}
              />
              <span className="control-label">
                {isPlayToAllLoading ? 'Updating...' : roomState.isPlayToAll ? 'Bot Audio: To ALL' : 'Bot Audio: Caller Only'}
              </span>
              <span className="control-state">
                {isPlayToAllLoading
                  ? '(Please wait)'
                  : roomState.isPlayToAll
                    ? '(Everyone)'
                    : '(Caller Only)'
                }
              </span>
            </button>
            )}
          </div>
        ) : (
          <></>
        )}

        <div className="audio-controls">
          {/* Room Audio Toggle */}
          <button
            className={`control-btn audio-btn ${showRoomAudio ? 'active' : 'muted'}`}
            onClick={toggleRoomAudio}
            title={showRoomAudio ? 'Hide room audio' : 'Show room audio'}
          >
            <FontAwesomeIcon
              icon={showRoomAudio ? faVolumeUp : faVolumeMute}
            />
            <span className="control-label">Room Audio</span>
          </button>

          <div className="audio-status">
            <span className={`audio-status-text ${showRoomAudio ? 'active' : 'inactive'}`}>
              Room Audio: {showRoomAudio ? 'Listening' : 'Muted'}
            </span>
          </div>
        </div>

        <div className="status-indicators">
          <div className="mic-status">
            <div
              className="mic-indicator"
              style={{ color: micStatus.color }}
            >
              {micStatus.text}
            </div>
            {roomState.isMicEnabled && (
              <div className="audio-level-meter">
                <div
                  className="audio-level-bar"
                  style={{ width: `${Math.min(roomState.audioLevel * 100, 100)}%` }}
                />
              </div>
            )}
          </div>

          {isOnHold && (
            <div className="hold-status">
              <span className="hold-indicator"><FontAwesomeIcon icon={faPause} style={{ fontSize: '0.6rem' }} /> On Hold</span>
            </div>
          )}
        </div>

        {/* Advanced Controls Section - separate from status indicators */}
        {showAdvancedControls && (
          <div className="advanced-controls-section">
            <div className="advanced-controls-header">
              <h4>Advanced SIP Controls</h4>
              {!callId && (
                <div className="warning-message">
                  Call ID required for full SIP functionality
                </div>
              )}
            </div>

            <div className="advanced-controls-content">
              <AdvancedControlsModal
                callId={callId || ''}
                participants={roomState.participants}
                sourceParameters={sourceParameters.current}
              />
            </div>
          </div>
        )}
      </div>

      {/* Hidden MediaSFU Handler for room management */}
      {autoJoin && (
        <MediaSFUHandler
          action={isOutgoingCallSetup && !callId ? "create" : "join"}
          meetingID={roomName}
          name={participantName}
          duration={duration}
          sourceParameters={sourceParameters.current}
          updateSourceParameters={updateSourceParameters}
        />
      )}

      {/* Hold Options Modal */}
      {showHoldModal && (
        <HoldOptionsModal
          isOpen={showHoldModal}
          onConfirm={handleHoldWithOptions}
          onCancel={() => setShowHoldModal(false)}
        />
      )}

      {/* Confirmation Modal */}
      {confirmationConfig && (
        <ConfirmationModal
          isOpen={showConfirmation}
          title={confirmationConfig.title}
          message={confirmationConfig.message}
          type={confirmationConfig.type}
          onConfirm={confirmationConfig.onConfirm}
          onCancel={() => {
            setShowConfirmation(false);
            setConfirmationConfig(null);
          }}
        />
      )}
    </div>
  );
};

// Hold Options Modal Component
interface HoldOptionsModalProps {
  isOpen: boolean;
  onConfirm: (message: string, pauseRecording: boolean) => void;
  onCancel: () => void;
}

const HoldOptionsModal: React.FC<HoldOptionsModalProps> = ({ isOpen, onConfirm, onCancel }) => {
  const [message, setMessage] = useState('');
  const [pauseRecording, setPauseRecording] = useState(true);

  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm(message, pauseRecording);
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content hold-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Hold Call Options</h3>
          <button onClick={onCancel} className="close-btn">
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Optional Hold Message (to play before hold):</label>
            <input
              type="text"
              className="form-input"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Message to play during hold"
            />
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={pauseRecording}
                onChange={(e) => setPauseRecording(e.target.checked)}
              />
              <span>Pause recording during hold</span>
            </label>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onCancel} className="btn btn-secondary">
            Cancel
          </button>
          <button onClick={handleConfirm} className="btn btn-primary">
            Hold Call
          </button>
        </div>
      </div>
    </div>
  );
};

export default MediaSFURoomDisplay;
