import { useState, useCallback } from 'react';
import { Call, CallStatus, SIPConfig } from '../types/call.types';
import { useWidgetConfig } from './useWidgetConfig';
import {
  getMediaSFUParticipantName,
  storeCreatedOutgoingRoom
} from '../utils/outgoingCallUtils';

interface UseCallManagerReturn {
  calls: Call[];
  isOnCall: boolean;
  activeCall: Call | null;
  isLoading: boolean;
  error: string | null;
  makeCall: (toNumber: string) => void;
  makeCallWithConfig: (params: MakeCallParams) => Promise<CallResult>;
  createOrUseMediaRoom: (params: MediaRoomParams) => Promise<RoomResult>;
  endCall: (callId: string) => void;
  hangupCall: (callId: string) => void;
  answerCall: (callId: string) => void;
  rejectCall: (callId: string) => void;
  toggleMute: () => void;
  toggleHold: (callId: string, hold: boolean) => void;
  sendDTMF: (callId: string, digit: string) => void;
  transferCall: (callId: string, targetNumber: string) => void;
  isCallMuted: boolean;
}

interface MakeCallParams {
  phoneNumber: string;
  callerIdNumber: string;
  sipConfig: SIPConfig;
  roomName?: string;
  useAutoAgent?: boolean;
  startWithAgent?: boolean;
}

interface CallResult {
  success: boolean;
  error?: string;
  callId?: string;
}

interface MediaRoomParams {
  sipConfig: SIPConfig;
  duration?: number;
  participantName?: string; // Add optional participant name override
}

interface RoomResult {
  success: boolean;
  error?: string;
  roomName?: string;
  participantName?: string;
}

export const useCallManager = (): UseCallManagerReturn => {
  const { callService, widgetParams, httpClient } = useWidgetConfig();
  const [calls, setCalls] = useState<Call[]>([]);
  const [isCallMuted, setIsCallMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeCall = calls.find(call =>
    call.status === 'active' || call.status === 'connecting'
  ) || null;

  const isOnCall = activeCall !== null;

  const makeCall = useCallback((toNumber: string) => {
    // TODO: Implement actual call functionality with MediaSFU
    const newCall: Call = {
      // Core API fields
      sipCallId: `call_${Date.now()}`,
      status: 'connecting',
      direction: 'outgoing',
      startTimeISO: new Date().toISOString(),
      durationSeconds: 0,
      roomName: `room_${Date.now()}`,
      callerIdRaw: '+1234567890', // TODO: Get from user profile
      calledUri: toNumber,
      audioOnly: false,
      activeMediaSource: 'none',
      humanParticipantName: 'voipuser',
      playingMusic: false,
      playingPrompt: false,
      currentPromptType: null,
      pendingHumanIntervention: false,
      callbackState: 'none',
      callbackPin: null,
      activeSpeaker: null,
      callEnded: false,
      needsCallback: false,
      callbackHonored: false,
      calledBackRef: null,

      // Legacy compatibility fields (computed)
      id: `call_${Date.now()}`,
      from: '+1234567890',
      to: toNumber,
      phoneNumber: toNumber,
      startTime: new Date(),
      callerName: `Call to ${toNumber}`
    };
    setCalls(prev => [...prev, newCall]);
  }, []);

  // Enhanced call making with SIP configuration support
  const makeCallWithConfig = useCallback(async (params: MakeCallParams): Promise<CallResult> => {
    setIsLoading(true);
    setError(null);

    try {
      // Generate room name if not provided
      const roomName = params.roomName || `call_${Date.now()}`;

      // Use the MediaSFU API via callService
      const response = await callService.makeCall(
        params.phoneNumber,
        params.callerIdNumber,
        roomName,
        'voipuser' // initiator name
      );

      if (response.success) {
        // Add to local call list
        const newCall: Call = {
          // Core API fields
          sipCallId: `call_${Date.now()}`,
          status: 'connecting' as CallStatus,
          direction: 'outgoing',
          startTimeISO: new Date().toISOString(),
          durationSeconds: 0,
          roomName: roomName,
          callerIdRaw: params.callerIdNumber,
          calledUri: params.phoneNumber,
          audioOnly: false,
          activeMediaSource: 'none',
          humanParticipantName: 'voipuser',
          playingMusic: false,
          playingPrompt: false,
          currentPromptType: null,
          pendingHumanIntervention: false,
          callbackState: 'none',
          callbackPin: null,
          activeSpeaker: null,
          callEnded: false,
          needsCallback: false,
          callbackHonored: false,
          calledBackRef: null,

          // Legacy compatibility fields (computed)
          id: `call_${Date.now()}`,
          from: params.callerIdNumber,
          to: params.phoneNumber,
          phoneNumber: params.phoneNumber,
          startTime: new Date(),
          callerName: `Call to ${params.phoneNumber}`
        };
        setCalls(prev => [...prev, newCall]);

        return { success: true, callId: newCall.id };
      } else {
        setError(response.error || 'Failed to make call');
        return { success: false, error: response.error || 'Failed to make call' };
      }
    } catch (error: any) {
      const errorMsg = error.message || 'Failed to make call';
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setIsLoading(false);
    }
  }, [callService]);  // Create or use existing MediaSFU room following proper MediaSFU patterns
  const createOrUseMediaRoom = useCallback(async (params: MediaRoomParams): Promise<RoomResult> => {
    setIsLoading(true);
    setError(null);

    try {
      // In widget context, credentials come from validated session, not localStorage
      const apiUserName = widgetParams.apiUserName;
      const apiKey = widgetParams.apiKey;
      if (!apiUserName || !apiKey) {
        throw new Error('Widget credentials not available. Session may not be validated yet.');
      }

      // Get the proper MediaSFU participant name
      let participantName = params.participantName || getMediaSFUParticipantName(apiUserName);

      // Ensure the participant name is valid for MediaSFU (alphanumeric, max 10 chars)
      participantName = participantName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10);
      if (!participantName) {
        participantName = "widgetuser";
      }

      // Create room using MediaSFU API endpoint pattern
      const payload = {
        action: "create",
        duration: params.duration || 30,
        capacity: 5,
        userName: participantName,
        eventType: "conference",
        recordOnly: false,
        dataBuffer: true,
        bufferType: "all"
      };

      const baseUrl = widgetParams.baseUrl || 'https://mediasfu.com';
      const response = await fetch(`${baseUrl}/v1/rooms/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiUserName}:${apiKey}`,
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();

      // Check if the response is successful and extract room name
      // MediaSFU API returns the room name directly in the data object
      if (data.success) {
        const roomName = data.roomName || data.meetingID || data.data?.roomName;
        if (roomName) {

          // Store the created room for outgoing call management
          storeCreatedOutgoingRoom(roomName, participantName);

          return {
            success: true,
            roomName: roomName,
            participantName: participantName // Return the participant name for use in MediaSFU handler
          };
        } else {
          // Room name not found in response
          throw new Error('Room name not found in MediaSFU response');
        }
      } else {
        throw new Error(data.error || data.message || 'Failed to create MediaSFU room');
      }
    } catch (error: any) {
      // Handle room creation error silently
      const errorMsg = error.message || 'Failed to create/access room';
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setIsLoading(false);
    }
  }, [widgetParams]);

  // Resolve sipCallId from local call list (callId may be local id or sipCallId)
  const resolveSipCallId = useCallback((callId: string): string => {
    const call = calls.find(c => c.id === callId || c.sipCallId === callId);
    return call?.sipCallId || callId;
  }, [calls]);

  const endCall = useCallback(async (callId: string) => {
    const sipCallId = resolveSipCallId(callId);
    try {
      const result = await callService.hangupCall(sipCallId);
      if (result.success) {
        setCalls(prev => prev.map(call =>
          (call.id === callId || call.sipCallId === callId)
            ? { ...call, status: 'ended' as CallStatus, endTime: new Date(), callEnded: true }
            : call
        ));
      } else {
        setError(result.error || 'Failed to end call');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to end call');
    }
  }, [callService, resolveSipCallId]);

  const hangupCall = useCallback(async (callId: string) => {
    const sipCallId = resolveSipCallId(callId);
    try {
      const result = await callService.hangupCall(sipCallId);
      if (result.success) {
        setCalls(prev => prev.map(call =>
          (call.id === callId || call.sipCallId === callId)
            ? { ...call, status: 'ended' as CallStatus, endTime: new Date(), callEnded: true }
            : call
        ));
      } else {
        setError(result.error || 'Failed to hang up call');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to hang up call');
    }
  }, [callService, resolveSipCallId]);

  const answerCall = useCallback(async (callId: string) => {
    const sipCallId = resolveSipCallId(callId);
    try {
      // In widget context, answering is handled by joining the MediaSFU room
      const result = await callService.answerCall(sipCallId);
      if (result.success) {
        setCalls(prev => prev.map(call =>
          (call.id === callId || call.sipCallId === callId)
            ? { ...call, status: 'active' as CallStatus }
            : call
        ));
      } else {
        setError(result.error || 'Failed to answer call');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to answer call');
    }
  }, [callService, resolveSipCallId]);

  const rejectCall = useCallback(async (callId: string) => {
    const sipCallId = resolveSipCallId(callId);
    try {
      const result = await callService.rejectCall(sipCallId);
      if (result.success) {
        setCalls(prev => prev.map(call =>
          (call.id === callId || call.sipCallId === callId)
            ? { ...call, status: 'rejected' as CallStatus }
            : call
        ));
      } else {
        setError(result.error || 'Failed to reject call');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to reject call');
    }
  }, [callService, resolveSipCallId]);

  const toggleHold = useCallback(async (callId: string, hold: boolean) => {
    const sipCallId = resolveSipCallId(callId);
    try {
      const result = await callService.toggleHold(sipCallId, hold);
      if (result.success) {
        setCalls(prev => prev.map(call =>
          (call.id === callId || call.sipCallId === callId)
            ? { ...call, status: hold ? 'on-hold' as CallStatus : 'active' as CallStatus, onHold: hold }
            : call
        ));
      } else {
        setError(result.error || 'Failed to toggle hold');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to toggle hold');
    }
  }, [callService, resolveSipCallId]);

  const toggleMute = useCallback(() => {
    // Mute is a local media track action — no server call needed
    setIsCallMuted(prev => !prev);
  }, []);

  const sendDTMF = useCallback(async (callId: string, digit: string) => {
    const sipCallId = resolveSipCallId(callId);
    try {
      const result = await callService.sendDTMF(sipCallId, digit);
      if (!result.success) {
        setError(result.error || 'Failed to send DTMF');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to send DTMF');
    }
  }, [callService, resolveSipCallId]);

  const transferCall = useCallback(async (callId: string, targetNumber: string) => {
    const sipCallId = resolveSipCallId(callId);
    try {
      const result = await callService.transferCall(sipCallId, targetNumber);
      if (!result.success) {
        setError(result.error || 'Call transfer not available');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to transfer call');
    }
  }, [callService, resolveSipCallId]);

  return {
    calls,
    isOnCall,
    activeCall,
    isLoading,
    error,
    makeCall,
    makeCallWithConfig,
    createOrUseMediaRoom,
    endCall,
    hangupCall,
    answerCall,
    rejectCall,
    toggleMute,
    toggleHold,
    sendDTMF,
    transferCall,
    isCallMuted
  };
};
