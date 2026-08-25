import { useState, useCallback, useEffect } from 'react';
import { Call } from '../types/call.types';
import { roomLogger, callLogger } from '../utils/logger';

// Enhanced outgoing call room interface following reference pattern
interface OutgoingCallRoom {
  roomName: string;
  requestedRoomName: string;
  displayName: string;
  createdAt: Date;
  isActive: boolean;
  hasActiveSipCall: boolean;
  isMediaSFUConnected: boolean;
  sipCallId?: string;
  callData?: {
    status: string;
    direction: string;
    callerIdRaw?: string;
    calledUri?: string;
    startTimeISO?: string;
    durationSeconds?: number;
    onHold?: boolean;
    activeMediaSource?: string;
    humanParticipantName?: string;
  };
}

interface UseOutgoingCallRoomManagerProps {
  currentCalls: Call[];
  currentRoomName: string;
  currentParticipantName: string;
}

export const useOutgoingCallRoomManager = ({
  currentCalls,
  currentRoomName,
  currentParticipantName
}: UseOutgoingCallRoomManagerProps) => {
  const [outgoingCallRoom, setOutgoingCallRoom] = useState<OutgoingCallRoom | null>(null);
  const [outgoingCallStatus, setOutgoingCallStatus] = useState<string>("");
  const [isMonitoringConnection, setIsMonitoringConnection] = useState(false);

  // Store outgoing room data in localStorage (following reference pattern)
  const getStoredOutgoingRoom = useCallback(() => {
    try {
      const stored = localStorage.getItem("mediasfu_outgoing_room");
      if (stored) {
        const parsed = JSON.parse(stored);
        // Check if room is expired (older than 1 hour)
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        if (
          parsed.createdAt &&
          new Date(parsed.createdAt).getTime() > oneHourAgo
        ) {
          return parsed;
        } else {
          localStorage.removeItem("mediasfu_outgoing_room");
        }
      }
    } catch (error) {
      roomLogger.warn("Failed to retrieve stored outgoing room:", error);
      localStorage.removeItem("mediasfu_outgoing_room");
    }
    return null;
  }, []);

  const setStoredOutgoingRoom = useCallback((room: OutgoingCallRoom | null) => {
    try {
      if (room) {
        localStorage.setItem("mediasfu_outgoing_room", JSON.stringify(room));
        roomLogger.info("Stored outgoing room:", { roomName: room.roomName, displayName: room.displayName });
      } else {
        localStorage.removeItem("mediasfu_outgoing_room");
        roomLogger.info("Cleared stored outgoing room");
      }
    } catch (error) {
      roomLogger.warn("Failed to store outgoing room:", error);
    }
  }, []);

  const clearStoredOutgoingRoom = useCallback(() => {
    setStoredOutgoingRoom(null);
  }, [setStoredOutgoingRoom]);

  // Create new outgoing call room (following reference pattern)
  const createOutgoingRoom = useCallback((requestedRoomName: string, displayName?: string) => {
    const room: OutgoingCallRoom = {
      roomName: requestedRoomName, // Will be updated with real MediaSFU room name
      requestedRoomName,
      displayName: displayName || `Outgoing Call Room (${currentParticipantName})`,
      createdAt: new Date(),
      isActive: true,
      hasActiveSipCall: false,
      isMediaSFUConnected: false,
      sipCallId: undefined,
      callData: undefined
    };

    setOutgoingCallRoom(room);
    setStoredOutgoingRoom(room);

    roomLogger.info("Created outgoing call room:", {
      requestedRoomName,
      displayName: room.displayName,
      participantName: currentParticipantName
    });

    return room;
  }, [currentParticipantName, setStoredOutgoingRoom]);

  // Update outgoing room when MediaSFU provides real room name
  const updateRoomName = useCallback((realRoomName: string) => {
    if (outgoingCallRoom?.isActive) {
      const updatedRoom = {
        ...outgoingCallRoom,
        roomName: realRoomName,
        isMediaSFUConnected: true
      };

      setOutgoingCallRoom(updatedRoom);
      setStoredOutgoingRoom(updatedRoom);

      roomLogger.info("Updated outgoing room with real MediaSFU name:", {
        requestedName: outgoingCallRoom.requestedRoomName,
        realName: realRoomName
      });
    }
  }, [outgoingCallRoom, setStoredOutgoingRoom]);

  // Mark room as MediaSFU connected
  const markRoomConnected = useCallback(() => {
    if (outgoingCallRoom?.isActive) {
      const updatedRoom = {
        ...outgoingCallRoom,
        isMediaSFUConnected: true
      };

      setOutgoingCallRoom(updatedRoom);
      setStoredOutgoingRoom(updatedRoom);

      roomLogger.info("Marked outgoing room as MediaSFU connected:", {
        roomName: outgoingCallRoom.roomName
      });
    }
  }, [outgoingCallRoom, setStoredOutgoingRoom]);

  // Sync SIP call data to outgoing room when call is established (following reference pattern)
  const syncCallDataToRoom = useCallback((call: Call) => {
    return {
      status: call.status,
      direction: call.direction,
      callerIdRaw: call.callerIdRaw,
      calledUri: call.calledUri,
      startTimeISO: call.startTimeISO,
      durationSeconds: call.durationSeconds,
      onHold: call.onHold,
      activeMediaSource: call.activeMediaSource,
      humanParticipantName: call.humanParticipantName || undefined
    };
  }, []);

  // Sync SIP call to outgoing room when call is established
  const syncCallToRoom = useCallback((call: Call) => {
    if (outgoingCallRoom?.isActive) {
      const updatedRoom = {
        ...outgoingCallRoom,
        hasActiveSipCall: true,
        sipCallId: call.sipCallId || call.id,
        callData: syncCallDataToRoom(call)
      };

      setOutgoingCallRoom(updatedRoom);
      setStoredOutgoingRoom(updatedRoom);

      roomLogger.info("Synced SIP call to outgoing room:", {
        sipCallId: call.sipCallId || call.id,
        status: call.status,
        roomName: outgoingCallRoom.roomName
      });

      return true; // Indicate sync was successful
    }
    return false;
  }, [outgoingCallRoom, setStoredOutgoingRoom, syncCallDataToRoom]);

  // Clear just the call data from the room (keeping room alive for next call)
  const clearCallFromRoom = useCallback(() => {
    if (outgoingCallRoom?.isActive) {
      const updatedRoom = {
        ...outgoingCallRoom,
        hasActiveSipCall: false,
        sipCallId: undefined,
        callData: undefined
      };

      setOutgoingCallRoom(updatedRoom);
      setStoredOutgoingRoom(updatedRoom);

      roomLogger.info("Cleared call from outgoing room - keeping room alive for next call", {
        roomName: outgoingCallRoom.roomName,
        preservingRoom: true
      });

      return true;
    }
    return false;
  }, [outgoingCallRoom, setStoredOutgoingRoom]);

  // Clear outgoing room when call ends or room is closed
  const clearOutgoingRoom = useCallback(() => {
    setOutgoingCallRoom(null);
    setStoredOutgoingRoom(null);
    roomLogger.info("Cleared outgoing call room");
  }, [setStoredOutgoingRoom]);

  // Get enhanced call data for UI display (following reference pattern)
  const getDummyCallForOutgoingRoom = useCallback((): Call | null => {
    if (!outgoingCallRoom?.isActive) {
      return null;
    }

    // Only return dummy call if we have an actual SIP call connected to the room
    // This prevents showing "Setting up call..." when just room is ready
    const hasActiveCall = outgoingCallRoom.hasActiveSipCall && outgoingCallRoom.callData;

    if (!hasActiveCall) {
      // No real call connected yet - don't show dummy call
      return null;
    }

    const callData = outgoingCallRoom.callData!; // Safe to use ! since we checked above

    // Create enhanced call with real call data
    const enhancedCall: Call = {
      sipCallId: outgoingCallRoom.sipCallId || `dummy_outgoing_${outgoingCallRoom.roomName}`,
      id: outgoingCallRoom.sipCallId || `dummy_outgoing_${outgoingCallRoom.roomName}`,
      roomName: outgoingCallRoom.roomName,

      // Use real call data
      status: callData.status as any,
      direction: callData.direction as any,
      callerIdRaw: callData.callerIdRaw || "Unknown Caller",
      calledUri: callData.calledUri || "",
      startTimeISO: callData.startTimeISO || outgoingCallRoom.createdAt.toISOString(),
      durationSeconds: callData.durationSeconds || 0,
      onHold: callData.onHold || false,

      // Enhanced properties with real-time data
      activeMediaSource: callData.activeMediaSource || "none",
      humanParticipantName: callData.humanParticipantName || currentParticipantName,

      // Required properties for Call type
      audioOnly: true,
      playingMusic: false,
      playingPrompt: false,
      currentPromptType: null,
      pendingHumanIntervention: false,
      callbackState: "",
      callbackPin: null,
      activeSpeaker: null,
      callEnded: false,
      needsCallback: false,
      callbackHonored: false,
      calledBackRef: null,

      // Additional properties for display
      phoneNumber: callData.calledUri || "",
      callerName: `Outgoing to ${callData.calledUri || "Unknown"}`,
      startTime: new Date(callData.startTimeISO || outgoingCallRoom.createdAt),
      duration: callData.durationSeconds || 0
    };

    return enhancedCall;
  }, [outgoingCallRoom, currentParticipantName]);

  // Auto-sync with current calls to detect establishment (following reference pattern)
  useEffect(() => {
    if (!outgoingCallRoom?.isActive) return;

    // Check if there's a SIP call in our outgoing room
    const sipCallInRoom = currentCalls.find(
      call => call.roomName === outgoingCallRoom.roomName &&
              call.status !== "ended" &&
              call.status !== "failed"
    );

    const newSipCallId = sipCallInRoom?.sipCallId || sipCallInRoom?.id;

    if (sipCallInRoom && !outgoingCallRoom.hasActiveSipCall) {
      // SIP call started in our room - sync complete call data
      callLogger.info("SIP call started in outgoing room - syncing data:", {
        sipCallId: newSipCallId,
        status: sipCallInRoom.status,
        roomName: outgoingCallRoom.roomName
      });

      setOutgoingCallRoom(prev => prev ? {
        ...prev,
        hasActiveSipCall: true,
        sipCallId: newSipCallId,
        callData: syncCallDataToRoom(sipCallInRoom)
      } : null);

    } else if (!sipCallInRoom && outgoingCallRoom.hasActiveSipCall) {
      // SIP call ended in our room
      callLogger.info("SIP call ended in outgoing room - clearing data:", {
        sipCallId: outgoingCallRoom.sipCallId,
        roomName: outgoingCallRoom.roomName
      });

      setOutgoingCallRoom(prev => prev ? {
        ...prev,
        hasActiveSipCall: false,
        sipCallId: undefined,
        callData: undefined,
      } : null);
    }
    // Note: We intentionally don't continuously update callData to avoid infinite loops
    // The real call data will be displayed through the enhanced call filtering
  }, [currentCalls, outgoingCallRoom?.isActive, outgoingCallRoom?.hasActiveSipCall, outgoingCallRoom?.roomName, outgoingCallRoom?.sipCallId, syncCallDataToRoom]);

  return {
    // State
    outgoingCallRoom,
    outgoingCallStatus,
    isMonitoringConnection,

    // Setters
    setOutgoingCallRoom,
    setOutgoingCallStatus,
    setIsMonitoringConnection,

    // Actions
    createOutgoingRoom,
    updateRoomName,
    markRoomConnected,
    syncCallToRoom,
    clearCallFromRoom,
    clearOutgoingRoom,
    getDummyCallForOutgoingRoom,

    // Storage utilities
    getStoredOutgoingRoom,
    setStoredOutgoingRoom,
    clearStoredOutgoingRoom,
  };
};
