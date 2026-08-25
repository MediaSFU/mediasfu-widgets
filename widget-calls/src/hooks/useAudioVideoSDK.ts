import {
  clickVideo, ClickVideoOptions, clickAudio, ClickAudioOptions, confirmExit, ConfirmExitOptions,
  switchAudio, SwitchAudioOptions
} from 'mediasfu-reactjs';
import { roomLogger } from '../utils/logger';

interface UseAudioVideoSDKProps {
  sourceParameters: Record<string, any>;
  deviceId?: string;
}

export const disconnectRoom = async ({ sourceParameters }: UseAudioVideoSDKProps): Promise<void> => {
  try {
    if (Object.keys(sourceParameters).length > 0) {
      const options: ConfirmExitOptions = {
        member: sourceParameters.member,
        socket: sourceParameters.socket,
        localSocket: sourceParameters.localSocket!,
        roomName: sourceParameters.roomName,
        ban: false,
      };
      await confirmExit(options);
    }
  } catch (e) {
    roomLogger.error('Error disconnecting room:', e);
  }
}

export const toggleAudio = async ({ sourceParameters }: UseAudioVideoSDKProps): Promise<void> => {
  try {
    if (Object.keys(sourceParameters).length > 0) {
      const options: ClickAudioOptions = {
        parameters: sourceParameters.getUpdatedAllParams ? sourceParameters.getUpdatedAllParams() : sourceParameters,
      };
      await clickAudio(options);
    }
  } catch (e) {
    roomLogger.error('Error toggling audio:', e);
  }
}

export const toggleVideo = async ({ sourceParameters }: UseAudioVideoSDKProps): Promise<void> => {
  try {
    if (Object.keys(sourceParameters).length > 0) {
      const options: ClickVideoOptions = {
        parameters: sourceParameters.getUpdatedAllParams ? sourceParameters.getUpdatedAllParams() : sourceParameters,
      };
      await clickVideo(options);
    }
  } catch (e) {
    roomLogger.error('Error toggling video:', e);
  }
}

export const switchAudioDevice = async ({ sourceParameters, deviceId }: UseAudioVideoSDKProps): Promise<void> => {
  try {
    if (Object.keys(sourceParameters).length > 0 && deviceId) {
      const options: SwitchAudioOptions = {
        audioPreference: deviceId,
        parameters: sourceParameters.getUpdatedAllParams ? sourceParameters.getUpdatedAllParams() : sourceParameters,
      };
      await switchAudio(options);
      roomLogger.info('Successfully switched audio device:', deviceId);
    }
  } catch (e) {
    roomLogger.error("Error switching audio device:", e);
    throw e; // Re-throw so caller can handle fallback
  }
}
