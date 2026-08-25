import React, { useRef, useEffect } from "react";
import {
  CreateMediaSFURoomOptions,
  JoinMediaSFURoomOptions,
  MediasfuGeneric,
  PreJoinPage,
  Credentials,
} from "mediasfu-reactjs";
import {
  getParticipantNameForRoom
} from '../../utils/outgoingCallUtils';
import { roomLogger } from '../../utils/logger';

export interface MediaSFUHandlerProps {
  action: "create" | "join";
  duration?: number;
  capacity?: number;
  name: string;
  meetingID?: string; // Optional for create, required for join
  sourceParameters: Record<string, any>;
  updateSourceParameters: (params: Record<string, any>) => void;
}

/**
 * MediaSFUHandler Component
 *
 * This component handles MediaSFU room creation and joining.
 * It renders the MediasfuGeneric component with 0 width and height for headless operation.
 *
 * KEY DIFFERENCES FROM ORIGINAL:
 * - Simplified initialization logic without complex state management
 * - Direct room creation without excessive duplicate prevention
 * - Immediate rendering when options are available
 */
const MediaSFUHandler: React.FC<MediaSFUHandlerProps> = ({
  action,
  duration,
  capacity,
  name,
  meetingID,
  sourceParameters,
  updateSourceParameters,
}) => {
  const noUIOptions = useRef<
    CreateMediaSFURoomOptions | JoinMediaSFURoomOptions | undefined
  >(undefined);

  // Stable reference to prevent re-renders
  const initializedRef = useRef(false);
  const lastPropsRef = useRef({ action, duration, capacity, name, meetingID });

  // Get credentials from localStorage
  const getCredentials = (): Credentials => {
    try {
      const mediaSFUCredentials = localStorage.getItem('mediaSFUCredentials');
      if (mediaSFUCredentials) {
        const credentials = JSON.parse(mediaSFUCredentials);
        return {
          apiUserName: credentials.apiUserName || "",
          apiKey: credentials.apiKey || "",
        };
      }
    } catch (error) {
      roomLogger.error('Error getting MediaSFU credentials:', error);
    }
    return {
      apiUserName: "",
      apiKey: "",
    };
  };

  const credentials = useRef<Credentials>(getCredentials());

  // Only initialize options once or when key props change
  useEffect(() => {
    const currentProps = { action, duration, capacity, name, meetingID };
    const propsChanged = JSON.stringify(currentProps) !== JSON.stringify(lastPropsRef.current);

    if (initializedRef.current && !propsChanged) {
      return; // Skip re-initialization if already initialized and props haven't changed
    }

    try {
      // Get the appropriate participant name for this room
      const participantName = meetingID
        ? getParticipantNameForRoom(meetingID, name)
        : name;

      if (action === "create") {
        roomLogger.debug('MediaSFUHandler initializing room creation options:', {
          action,
          duration: duration || 30,
          capacity: capacity || 5,
          participantName,
          meetingID,
          isReinitialization: initializedRef.current
        });

        // Prepare parameters for creating a room
        // Include meetingID for outgoing rooms to improve duplicate detection
        noUIOptions.current = {
          action: "create",
          duration: duration || 30,
          capacity: capacity || 5,
          userName: participantName || "voipuser",
          eventType: "conference",
          recordOnly: false,
          dataBuffer: true,
          bufferType: "all",
          supportSIP: true,
          directionSIP: "both",

        } as CreateMediaSFURoomOptions
      } else if (action === "join") {
        if (!meetingID) {
          throw new Error("Meeting ID is required for joining a room.");
        }

        roomLogger.debug('MediaSFUHandler initializing room join options:', {
          action,
          participantName,
          meetingID,
          isReinitialization: initializedRef.current
        });

        // Prepare parameters for joining a room
        noUIOptions.current = {
          action: "join",
          userName: participantName || "voipuser",
          meetingID,
        };
      } else {
        throw new Error('Invalid action. Must be either "create" or "join".');
      }

      initializedRef.current = true;
      lastPropsRef.current = currentProps;
    } catch (error) {
      roomLogger.error("Error handling MediaSFU action:", error);
    }
  }, [action, duration, capacity, name, meetingID]); // Only re-run when these key props change


  return (
    <div
      style={{
        width: 0,
        height: 0,
        maxHeight: 0,
        maxWidth: 0,
        overflow: "hidden",
      }}
    >
      {noUIOptions.current && (
        <MediasfuGeneric
          PrejoinPage={(options: any) => <PreJoinPage {...options} />}
          sourceParameters={sourceParameters}
          updateSourceParameters={updateSourceParameters}
          returnUI={false}
          noUIPreJoinOptions={noUIOptions.current}
          connectMediaSFU={false}
          credentials={credentials.current}
        />
      )}
    </div>
  );
};

export default MediaSFUHandler;
