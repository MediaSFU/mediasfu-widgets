/**
 * ConnectionBlock
 *
 * Core building block that handles MediaSFU room creation/joining.
 * This wraps MediasfuGeneric in headless mode (0x0 pixels).
 *
 * Key concept: MediaSFU requires socket connections and room-based operations.
 * All other functionality depends on having an active room connection.
 *
 * Based on patterns from:
 * - voipsrc/components/MediaSFU/MediaSFUHandler.tsx
 * - agents-src/components/MediaSFUHandler.tsx
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import type {
  SourceParameters,
  MediaSFUCredentials,
  CreateRoomOptions,
  JoinRoomOptions,
  DisconnectReason
} from '../types/building-blocks';

// These would come from mediasfu-reactjs when integrated
// For now we define the interface
interface MediasfuGenericProps {
  PrejoinPage?: React.ComponentType<any>;
  sourceParameters: Record<string, any>;
  updateSourceParameters: (params: Record<string, any>) => void;
  returnUI: boolean;
  noUIPreJoinOptions?: CreateRoomOptions | JoinRoomOptions;
  connectMediaSFU?: boolean;
  credentials?: MediaSFUCredentials;
}

export interface ConnectionBlockProps {
  /**
   * Action to perform - create new room or join existing
   */
  action: 'create' | 'join';

  /**
   * Room name (required for join, optional for create)
   */
  roomName?: string;

  /**
   * Meeting ID (required for join)
   */
  meetingID?: string;

  /**
   * Duration in minutes (for create)
   */
  duration?: number;

  /**
   * Max participants (for create)
   */
  capacity?: number;

  /**
   * Event type
   */
  eventType?: 'conference' | 'broadcast' | 'webinar' | 'chat';

  /**
   * User name to join with
   */
  userName: string;

  /**
   * Enable SIP/PSTN telephony support
   */
  supportSIP?: boolean;

  /**
   * SIP direction: both, inbound, or outbound
   */
  directionSIP?: 'both' | 'inbound' | 'outbound';

  /**
   * API credentials
   */
  credentials?: MediaSFUCredentials;

  /**
   * Called when room connection is established
   */
  onConnected?: (params: SourceParameters) => void;

  /**
   * Called when room is disconnected
   */
  onDisconnected?: (reason: DisconnectReason) => void;

  /**
   * Called when MediaSFU returns the real room name (different from requested)
   */
  onRoomNameUpdate?: (realRoomName: string) => void;

  /**
   * Called on connection error
   */
  onError?: (error: Error) => void;

  /**
   * Called when sourceParameters update
   */
  onSourceParametersUpdate?: (params: SourceParameters) => void;

  /**
   * Children to render (they receive sourceParameters via context or props)
   */
  children?: React.ReactNode | ((props: ConnectionBlockChildProps) => React.ReactNode);
}

export interface ConnectionBlockChildProps {
  sourceParameters: SourceParameters;
  updateSourceParameters: (params: Partial<SourceParameters>) => void;
  isConnected: boolean;
  roomName: string;
  disconnect: () => Promise<void>;
}

/**
 * ConnectionBlock Component
 *
 * Renders MediasfuGeneric in headless mode (0x0 pixels) and manages
 * room state through sourceParameters.
 *
 * @example
 * ```tsx
 * <ConnectionBlock
 *   action="create"
 *   userName="visitor"
 *   duration={30}
 *   capacity={5}
 *   supportSIP={true}
 *   onConnected={(params) => console.log('Connected to room:', params.roomName)}
 * >
 *   {({ sourceParameters, isConnected }) => (
 *     <AudioControls sourceParameters={sourceParameters} />
 *   )}
 * </ConnectionBlock>
 * ```
 */
export const ConnectionBlock: React.FC<ConnectionBlockProps> = ({
  action,
  roomName: initialRoomName,
  meetingID,
  duration = 30,
  capacity = 5,
  eventType = 'conference',
  userName,
  supportSIP = false,
  directionSIP = 'both',
  credentials,
  onConnected,
  onDisconnected,
  onRoomNameUpdate,
  onError,
  onSourceParametersUpdate,
  children
}) => {
  // Refs for stable state management
  const sourceParametersRef = useRef<Record<string, any>>({});
  const initializedRef = useRef(false);
  const lastPropsRef = useRef({ action, duration, capacity, userName, meetingID });

  // State for rendering
  const [isConnected, setIsConnected] = useState(false);
  const [currentRoomName, setCurrentRoomName] = useState(initialRoomName || '');
  const [, setSourceChanged] = useState(0);

  // Build noUIPreJoinOptions based on action
  const noUIOptions = useRef<CreateRoomOptions | JoinRoomOptions | undefined>(undefined);

  // Initialize room options
  useEffect(() => {
    const currentProps = { action, duration, capacity, userName, meetingID };
    const propsChanged = JSON.stringify(currentProps) !== JSON.stringify(lastPropsRef.current);

    if (initializedRef.current && !propsChanged) {
      return;
    }

    try {
      if (action === 'create') {
        noUIOptions.current = {
          action: 'create',
          duration,
          capacity,
          userName: userName || 'widget-user',
          eventType,
          recordOnly: false,
          dataBuffer: true,
          bufferType: 'all',
          supportSIP,
          directionSIP,
        } as CreateRoomOptions;
      } else if (action === 'join') {
        if (!meetingID) {
          throw new Error('Meeting ID is required for joining a room');
        }

        noUIOptions.current = {
          action: 'join',
          userName: userName || 'widget-user',
          meetingID,
        } as JoinRoomOptions;
      }

      initializedRef.current = true;
      lastPropsRef.current = currentProps;
    } catch (error) {
      console.error('[ConnectionBlock] Error initializing room options:', error);
      onError?.(error as Error);
    }
  }, [action, duration, capacity, userName, meetingID, eventType, supportSIP, directionSIP, onError]);

  // Update source parameters handler
  const updateSourceParameters = useCallback((params: Record<string, any>) => {
    if (params === sourceParametersRef.current) return;

    sourceParametersRef.current = params;
    setSourceChanged(prev => prev + 1);

    // Check for connection status
    const hasSocket = !!(params.socket || params.localSocket);
    const isValidRoom = !!(params.roomName && params.roomName.trim());
    const noFailure = !params.alertMessage ||
      (!params.alertMessage.includes('ended') &&
       !params.alertMessage.includes('failed') &&
       !params.alertMessage.includes('error'));

    const connected = isValidRoom && hasSocket && noFailure;

    // Update connected state
    if (connected !== isConnected) {
      setIsConnected(connected);

      if (connected) {
        onConnected?.(params as SourceParameters);
      }
    }

    // Check for room name update
    if (params.roomName && params.roomName !== currentRoomName) {
      setCurrentRoomName(params.roomName);
      onRoomNameUpdate?.(params.roomName);
    }

    // Check for disconnection
    if (params.alertMessage) {
      const shouldDisconnect =
        params.alertMessage.includes('meeting has ended') ||
        params.alertMessage.includes('ended') ||
        params.alertMessage.includes('disconnected') ||
        params.alertMessage.includes('room not found');

      if (shouldDisconnect && isConnected) {
        const reason: DisconnectReason = {
          type: params.alertMessage.includes('meeting has ended') ? 'room-ended' : 'socket-error',
          details: params.alertMessage
        };
        onDisconnected?.(reason);
      }
    }

    // Notify parent of update
    onSourceParametersUpdate?.(params as SourceParameters);
  }, [isConnected, currentRoomName, onConnected, onDisconnected, onRoomNameUpdate, onSourceParametersUpdate]);

  // Disconnect function
  const disconnect = useCallback(async () => {
    const params = sourceParametersRef.current;
    if (Object.keys(params).length === 0) return;

    try {
      // Import confirmExit from mediasfu-reactjs
      const { confirmExit } = await import('mediasfu-reactjs');

      await confirmExit({
        member: params.member,
        socket: params.socket,
        localSocket: params.localSocket,
        roomName: params.roomName,
        ban: false
      });

      onDisconnected?.({ type: 'user', details: 'User disconnected' });
    } catch (error) {
      console.error('[ConnectionBlock] Error disconnecting:', error);
    }
  }, [onDisconnected]);

  // Child props
  const childProps: ConnectionBlockChildProps = {
    sourceParameters: sourceParametersRef.current as SourceParameters,
    updateSourceParameters: (partial) => {
      const updated = { ...sourceParametersRef.current, ...partial };
      updateSourceParameters(updated);
    },
    isConnected,
    roomName: currentRoomName,
    disconnect
  };

  return (
    <>
      {/* Headless MediasfuGeneric container */}
      <div
        style={{
          width: 0,
          height: 0,
          maxWidth: 0,
          maxHeight: 0,
          overflow: 'hidden',
          position: 'absolute',
          visibility: 'hidden'
        }}
      >
        {noUIOptions.current && (
          // This would be MediasfuGeneric from mediasfu-reactjs
          // For now, placeholder until integration
          <MediasfuGenericPlaceholder
            sourceParameters={sourceParametersRef.current}
            updateSourceParameters={updateSourceParameters}
            returnUI={false}
            noUIPreJoinOptions={noUIOptions.current}
            connectMediaSFU={true}
            credentials={credentials}
          />
        )}
      </div>

      {/* Render children with props */}
      {typeof children === 'function' ? children(childProps) : children}
    </>
  );
};

/**
 * Placeholder for MediasfuGeneric until integrated
 * In real implementation, this would be:
 * import { MediasfuGeneric, PreJoinPage } from 'mediasfu-reactjs';
 */
const MediasfuGenericPlaceholder: React.FC<MediasfuGenericProps> = ({
  updateSourceParameters
}) => {
  // Simulate connection for development
  useEffect(() => {
    const timer = setTimeout(() => {
      updateSourceParameters({
        roomName: `room_${Date.now()}`,
        member: 'widget-user',
        islevel: '2',
        socket: { id: 'mock', connected: true } as any,
        audioAlreadyOn: false,
        videoAlreadyOn: false,
        participants: [],
        audioOnlyStreams: [],
        audioLevel: 0,
        alertMessage: '',
        getUpdatedAllParams: () => ({} as any)
      });
    }, 1000);

    return () => clearTimeout(timer);
  }, [updateSourceParameters]);

  return null;
};

export default ConnectionBlock;
