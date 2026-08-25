/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useRef } from "react";
import {
  PreJoinPageOptions,
  CreateMediaSFURoomOptions,
  JoinMediaSFURoomOptions,
  Credentials,
  CreateJoinRoomError,
  CreateJoinRoomResponse,
  CreateJoinRoomType,
} from "mediasfu-reactjs";
import { MediasfuGeneric, PreJoinPage } from "mediasfu-reactjs";

/**
 * Creates a room-creation/join function bound to a specific API base URL.
 */
export function createRoomFunction(apiBaseUrl: string): CreateJoinRoomType {
  return async ({
    payload,
    apiUserName,
    apiKey,
    localLink = "",
  }: {
    payload: JoinMediaSFURoomOptions | CreateMediaSFURoomOptions;
    apiUserName: string;
    apiKey: string;
    localLink?: string;
  }): Promise<{
    data: CreateJoinRoomResponse | CreateJoinRoomError | null;
    success: boolean;
  }> => {
    try {
      if (
        !apiUserName ||
        !apiKey ||
        apiUserName === "yourAPIUSERNAME" ||
        apiKey === "yourAPIKEY" ||
        apiKey.length !== 64 ||
        apiUserName.length < 6
      ) {
        return { data: { error: "Invalid credentials" }, success: false };
      }

      const finalLink = `${apiBaseUrl}/v1/rooms`;

      const response = await fetch(finalLink, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiUserName}:${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();
      return { data, success: true };
    } catch (error) {
      const errorMessage = (error as any).reason
        ? (error as any).reason
        : "unknown error";
      return {
        data: { error: `Unable to join room, ${errorMessage}` },
        success: false,
      };
    }
  };
}

export interface MediaSFUHandlerProps {
  action: "create" | "join";
  duration?: number;
  capacity?: number;
  name: string;
  meetingID?: string;
  sourceParameters: Record<string, any>;
  updateSourceParameters: (params: Record<string, any>) => void;
  /** API base URL – e.g. https://mediasfu.com */
  apiBaseUrl?: string;
  /** Credentials resolved from widget session validation */
  credentials?: { apiUserName: string; apiKey: string };
}

/**
 * MediaSFUHandler Component (Widget-adapted)
 *
 * Accepts credentials and apiBaseUrl via props rather than process.env.
 */
const MediaSFUHandler: React.FC<MediaSFUHandlerProps> = ({
  action,
  duration,
  capacity,
  name,
  meetingID,
  sourceParameters,
  updateSourceParameters,
  apiBaseUrl = "https://mediasfu.com",
  credentials: credentialsProp,
}) => {
  const noUIOptions = useRef<
    CreateMediaSFURoomOptions | JoinMediaSFURoomOptions | undefined
  >(undefined);
  const apiUserName = credentialsProp?.apiUserName || "";
  const apiKey = credentialsProp?.apiKey || "";
  const credentials = useRef<Credentials | undefined>({ apiUserName, apiKey });
  const roomFunction = useRef(createRoomFunction(apiBaseUrl));

  try {
    if (action === "create") {
      // Prepare parameters for creating a room for MediaSFU with one-way production and egress support
      noUIOptions.current = {
        action: "create",
        duration: duration || 15,
        capacity: capacity || 5,
        userName: name || "agent",
        eventType: "conference",
        recordOnly: false, // One-way production and egress support
        dataBuffer: true, // Buffer data for egress support
        bufferType: "all",
      };
    } else if (action === "join") {
      if (!meetingID) {
        throw new Error("Meeting ID is required for joining a room.");
      }

      // Prepare parameters for joining a room
      noUIOptions.current = {
        action: "join",
        userName: name || "agent",
        meetingID,
      };
    } else {
      throw new Error('Invalid action. Must be either "create" or "join".');
    }
  } catch (error) {
    console.error("Error handling MediaSFU action:", error);
  }

  // return (<>  </>);

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
          connectMediaSFU={true}
          credentials={credentials.current}
          joinMediaSFURoom={roomFunction.current}
          createMediaSFURoom={roomFunction.current}
        />
      )}
    </div>
  );
};

export default MediaSFUHandler;
