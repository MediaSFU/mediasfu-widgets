/**
 * Widget Call Service
 *
 * Adapted from voipsrc/src/services/callService.ts.
 * Uses the standard /v1/sipcall/* endpoints with apiUserName:apiKey
 * credential auth via WidgetHttpClient.
 */

import { WidgetHttpClient } from './widgetHttpClient';
import { ApiResponse } from '../types/api.types';
import { Call, CallStats, CallStatus } from '../types/call.types';
import {
  extractCallRecords,
  isActiveCallRecord,
  normalizeCallRecord,
} from './activeCallIdentity';
import {
  studioCallControlPath,
  studioCallPath,
  studioCallsCollectionPath,
} from './studioOperatorRoutes';

export class WidgetCallService {
  private httpClient: WidgetHttpClient;
  private localStorageKey = 'widget_call_history';

  constructor(httpClient: WidgetHttpClient) {
    this.httpClient = httpClient;
  }

  /** Update the underlying HTTP client (e.g., after auth refresh) */
  setHttpClient(httpClient: WidgetHttpClient): void {
    this.httpClient = httpClient;
  }

  // ─── Read Operations ───────────────────────────────────────────

  /** Get all calls — GET /v1/sipcall/list */
  async getAllCalls(): Promise<ApiResponse<Call[]>> {
    try {
      const response = await this.httpClient.get(
        this.httpClient.hasOperatorGrant
          ? studioCallsCollectionPath()
          : '/v1/sipcall/list'
      );

      if (response.success && response.data) {
        const calls = extractCallRecords(response.data)
          .map(normalizeCallRecord)
          .filter((call): call is Call => Boolean(call));
        return { success: true, data: calls };
      }

      return { success: true, data: [] };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to fetch calls' };
    }
  }

  /** Get specific call state — finds the call from the list endpoint
   *  to ensure all fields (playingMusic, pendingHumanIntervention, etc.) are present.
   *  Falls back to GET /v1/sipcall/:sipCallId/state if not found in list. */
  async getCallState(callId: string): Promise<ApiResponse<Call | null>> {
    try {
      // Primary: find the call in the list (returns all fields including playingMusic, pendingHumanIntervention)
      const allCallsResponse = await this.getAllCalls();

      if (allCallsResponse.success && allCallsResponse.data) {
        const call = allCallsResponse.data.find(c =>
          c.sipCallId === callId || c.id === callId
        );

        if (call) {
          return { success: true, data: call };
        }
      }

      // Fallback: direct state endpoint (may have fewer fields)
      const response = await this.httpClient.get(
        this.httpClient.hasOperatorGrant
          ? studioCallPath(callId)
          : `/v1/sipcall/${callId}/state`
      );

      if (response.success && response.data) {
        // Unwrap nested data — httpClient wraps as { data: serverBody }
        // and serverBody is { success, data: callDetails }
        const callData = (response.data as any).data || response.data;
        return { success: true, data: callData as Call };
      }

      return { success: true, data: null };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to get call state' };
    }
  }

  /** Direct sipCallId lookup — bypasses apiUserName filter
   *  GET /v1/sipcall/:sipCallId/state */
  async getCallStateDirectly(sipCallId: string): Promise<ApiResponse<Call | null>> {
    try {
      const response = await this.httpClient.get(
        this.httpClient.hasOperatorGrant
          ? studioCallPath(sipCallId)
          : `/v1/sipcall/${sipCallId}/state`
      );
      if (response.success && response.data) {
        // Unwrap nested data — httpClient wraps as { data: serverBody }
        const callData = (response.data as any).data || response.data;
        return { success: true, data: callData as Call };
      }
      return { success: true, data: null };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to get call state directly' };
    }
  }

  /** Get active calls (filters from getAllCalls) */
  async getActiveCalls(): Promise<ApiResponse<Call[]>> {
    const response = await this.getAllCalls();
    if (response.success && response.data) {
      const active = response.data.filter(isActiveCallRecord);
      return { success: true, data: active };
    }
    return response;
  }

  // ─── Call Control ──────────────────────────────────────────────

  /** Make outgoing call — POST /v1/sipcall/outgoingCall */
  async makeCall(
    phoneNumber: string,
    callerIdNumber: string,
    roomName: string,
    initiatorName?: string,
    options?: {
      startWithInitiatorAudio?: boolean;
      calleeDisplayName?: string;
      useBackupPeer?: boolean;
    }
  ): Promise<ApiResponse<any>> {
    try {
      if (this.httpClient.hasOperatorGrant) {
        return {
          success: false,
          error: 'Starting an unrelated outgoing call is not available in a Studio-scoped session.',
          status: 403,
        };
      }
      if (!phoneNumber.match(/^\+?[1-9]\d{1,14}$/)) {
        return { success: false, error: 'Invalid phone number format. Must be E.164.' };
      }
      if (!callerIdNumber.match(/^\+?[1-9]\d{1,14}$/)) {
        return { success: false, error: 'Invalid caller ID format. Must be E.164.' };
      }

      const payload: any = {
        roomName,
        calledDid: phoneNumber,
        callerIdNumber,
        initiatorName: initiatorName || 'widgetuser',
      };
      if (options?.startWithInitiatorAudio) {
        payload.startWithInitiatorAudio = true;
      }

      const response = await this.httpClient.post('/v1/sipcall/outgoingCall', payload);

      if (response.success) {
        this.addToLocalHistory(this.createLocalCallEntry(phoneNumber, 'outbound', 'connecting'));
      }

      return response;
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to make call' };
    }
  }

  /** Alias for makeCall — matches the voipsrc callService API */
  async makeCallWithOptions(
    phoneNumber: string,
    callerIdNumber: string,
    roomName: string,
    initiatorName?: string,
    options?: {
      startWithInitiatorAudio?: boolean;
      calleeDisplayName?: string;
      useBackupPeer?: boolean;
    }
  ): Promise<ApiResponse<any>> {
    return this.makeCall(phoneNumber, callerIdNumber, roomName, initiatorName, options);
  }

  /** Hang up call — POST /v1/sipcall/:sipCallId/end */
  async hangupCall(callId: string): Promise<ApiResponse<any>> {
    try {
      const response = await this.httpClient.post(
        this.httpClient.hasOperatorGrant ? studioCallControlPath(callId, 'end') : `/v1/sipcall/${callId}/end`, {
        reason: 'User initiated hangup',
      });
      if (response.success) {
        this.updateLocalHistoryStatus(callId, 'completed');
      }
      return response;
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to hang up call' };
    }
  }

  /** Reject call — POST /v1/sipcall/:sipCallId/end */
  async rejectCall(callId: string): Promise<ApiResponse<any>> {
    try {
      const response = await this.httpClient.post(
        this.httpClient.hasOperatorGrant ? studioCallControlPath(callId, 'end') : `/v1/sipcall/${callId}/end`, {
        reason: 'Call rejected',
      });
      if (response.success) {
        this.updateLocalHistoryStatus(callId, 'rejected');
      }
      return response;
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to reject call' };
    }
  }

  /** Hold call — POST /v1/sipcall/:sipCallId/hold */
  async holdCall(callId: string, withMessage?: string, pauseRecording?: boolean): Promise<ApiResponse<any>> {
    try {
      return await this.httpClient.post(
        this.httpClient.hasOperatorGrant ? studioCallControlPath(callId, 'hold') : `/v1/sipcall/${callId}/hold`, {
        withMessage,
        pauseRecording: pauseRecording !== undefined ? pauseRecording : true,
      });
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to hold call' };
    }
  }

  /** Unhold call — POST /v1/sipcall/:sipCallId/unhold */
  async unholdCall(callId: string): Promise<ApiResponse<any>> {
    try {
      return await this.httpClient.post(
        this.httpClient.hasOperatorGrant ? studioCallControlPath(callId, 'unhold') : `/v1/sipcall/${callId}/unhold`, {});
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to unhold call' };
    }
  }

  /** Combined hold/unhold toggle */
  async toggleHold(callId: string, isHold: boolean): Promise<ApiResponse<any>> {
    return isHold ? this.holdCall(callId) : this.unholdCall(callId);
  }

  /** Play media — POST /v1/sipcall/:sipCallId/play */
  async playAudio(
    callId: string,
    _type: 'tts' | 'url',
    value: string,
    loop = false,
    immediately = true
  ): Promise<ApiResponse<any>> {
    try {
      return await this.httpClient.post(
        this.httpClient.hasOperatorGrant ? studioCallControlPath(callId, 'play') : `/v1/sipcall/${callId}/play`, {
        sourceValue: value,
        loop,
        immediately,
      });
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to play audio' };
    }
  }

  /** Switch source (agent/human) — POST /v1/sipcall/:sipCallId/switch-source */
  async switchSource(callId: string, sourceType: 'agent' | 'human', humanName?: string): Promise<ApiResponse<any>> {
    try {
      if (this.httpClient.hasOperatorGrant) {
        return { success: false, error: 'Switching media source is not enabled for this Studio operator grant.', status: 403 };
      }
      const payload: any = { targetType: sourceType };
      if (sourceType === 'human' && humanName) {
        payload.humanName = humanName;
      }
      return await this.httpClient.post(`/v1/sipcall/${callId}/switch-source`, payload);
    } catch (error: any) {
      return { success: false, error: error.message || `Failed to switch to ${sourceType}` };
    }
  }

  /** Start agent — POST /v1/sipcall/:sipCallId/start-agent */
  async startAgent(callId: string): Promise<ApiResponse<any>> {
    try {
      return await this.httpClient.post(
        this.httpClient.hasOperatorGrant ? studioCallControlPath(callId, 'startAgent') : `/v1/sipcall/${callId}/start-agent`, {});
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to start agent' };
    }
  }

  /** Stop agent — POST /v1/sipcall/:sipCallId/stop-agent */
  async stopAgent(callId: string): Promise<ApiResponse<any>> {
    try {
      return await this.httpClient.post(
        this.httpClient.hasOperatorGrant ? studioCallControlPath(callId, 'stopAgent') : `/v1/sipcall/${callId}/stop-agent`, {});
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to stop agent' };
    }
  }

  /** Update play-to-all — POST /v1/sipcall/:sipCallId/update-play-to-all */
  async updatePlayToAll(callId: string, playToAll: boolean): Promise<ApiResponse<any>> {
    try {
      if (this.httpClient.hasOperatorGrant) {
        return { success: false, error: 'Updating play-to-all is not enabled for this Studio operator grant.', status: 403 };
      }
      return await this.httpClient.post(`/v1/sipcall/${callId}/update-play-to-all`, {
        playToAll,
      });
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to update play-to-all' };
    }
  }

  /** Send DTMF — POST /v1/sipcall/:sipCallId/send-dtmf */
  async sendDTMF(callId: string, digit: string): Promise<ApiResponse<any>> {
    try {
      if (this.httpClient.hasOperatorGrant) {
        return { success: false, error: 'Sending DTMF is not enabled for this Studio operator grant.', status: 403 };
      }
      return await this.httpClient.post(`/v1/sipcall/${callId}/send-dtmf`, {
        digits: digit,
      });
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to send DTMF' };
    }
  }

  // ─── Legacy Aliases ────────────────────────────────────────────

  async switchToAgent(callId: string): Promise<ApiResponse<any>> {
    return this.switchSource(callId, 'agent');
  }

  async switchToHuman(callId: string, humanName?: string): Promise<ApiResponse<any>> {
    return this.switchSource(callId, 'human', humanName);
  }

  async answerCall(_callId: string): Promise<ApiResponse<any>> {
    // In widget context, calls are auto-answered by joining the MediaSFU room
    return { success: true, data: { message: 'Call auto-answered via room join' } };
  }

  async transferCall(_callId: string, _targetNumber: string): Promise<ApiResponse<any>> {
    return { success: false, error: 'Call transfer not available in widget mode' };
  }

  // ─── Local History (localStorage within iframe) ────────────────

  async getCallHistory(limit = 50): Promise<ApiResponse<Call[]>> {
    try {
      if (this.httpClient.hasOperatorGrant) {
        return { success: true, data: [] };
      }
      const stored = localStorage.getItem(this.localStorageKey);
      let history: Call[] = stored ? JSON.parse(stored) : [];

      history = history
        .sort((a, b) => {
          const aTime = a.startTimeISO ? new Date(a.startTimeISO).getTime() : 0;
          const bTime = b.startTimeISO ? new Date(b.startTimeISO).getTime() : 0;
          return bTime - aTime;
        })
        .slice(0, limit);

      return { success: true, data: history };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to fetch call history' };
    }
  }

  async getCallStats(): Promise<ApiResponse<CallStats>> {
    try {
      const allCallsResponse = await this.getAllCalls();
      const allCalls = allCallsResponse.success ? allCallsResponse.data || [] : [];
      const activeCalls = allCalls.filter(
        (c) => c.status === 'active' || c.status === 'connecting' || c.status === 'ringing'
      );

      const historyResponse = await this.getCallHistory(1000);
      const history = historyResponse.success ? historyResponse.data || [] : [];

      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const todayCalls = history.filter((c) => {
        const t = c.startTimeISO ? new Date(c.startTimeISO) : null;
        return t && t >= startOfDay;
      });
      const connected = history.filter((c) => c.status === 'connected' || c.status === 'completed');
      const totalDuration = history.reduce((s, c) => s + (c.duration || 0), 0);

      return {
        success: true,
        data: {
          totalCalls: history.length,
          activeCalls: activeCalls.length,
          incomingCalls: history.filter((c) => c.direction === 'inbound').length,
          outgoingCalls: history.filter((c) => c.direction === 'outbound').length,
          avgDuration: history.length > 0 ? Math.round(totalDuration / history.length) : 0,
          successRate: history.length > 0 ? (connected.length / history.length) * 100 : 0,
          todaysCalls: todayCalls.length,
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to calculate stats' };
    }
  }

  async clearCallHistory(): Promise<ApiResponse<boolean>> {
    try {
      localStorage.removeItem(this.localStorageKey);
      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ─── Internal Helpers ──────────────────────────────────────────

  private createLocalCallEntry(
    phoneNumber: string,
    direction: 'inbound' | 'outbound' = 'outbound',
    status: CallStatus = 'connecting'
  ): Call {
    const now = new Date();
    return {
      sipCallId: `local_${Date.now()}`,
      status,
      direction,
      startTimeISO: now.toISOString(),
      durationSeconds: 0,
      roomName: `room_${Date.now()}`,
      callerIdRaw: direction === 'outbound' ? 'widgetuser' : phoneNumber,
      calledUri: direction === 'outbound' ? phoneNumber : 'widgetuser',
      audioOnly: false,
      activeMediaSource: 'none',
      humanParticipantName: 'widgetuser',
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
      id: `call_${Date.now()}`,
      phoneNumber,
      callerName: `Call to ${phoneNumber}`,
      startTime: now,
      duration: 0,
    };
  }

  private addToLocalHistory(call: Call): void {
    if (this.httpClient.hasOperatorGrant) return;
    try {
      const stored = localStorage.getItem(this.localStorageKey);
      let history: Call[] = stored ? JSON.parse(stored) : [];
      history.unshift(call);
      if (history.length > 1000) history = history.slice(0, 1000);
      localStorage.setItem(this.localStorageKey, JSON.stringify(history));
    } catch {
      // ignore
    }
  }

  private updateLocalHistoryStatus(callId: string, status: string): void {
    if (this.httpClient.hasOperatorGrant) return;
    try {
      const stored = localStorage.getItem(this.localStorageKey);
      if (!stored) return;
      const history: Call[] = JSON.parse(stored);
      const idx = history.findIndex((c) => c.sipCallId === callId || c.id === callId);
      if (idx >= 0) {
        history[idx].status = status as any;
        if (status === 'completed' || status === 'rejected') {
          history[idx].endTime = new Date();
          const st = history[idx].startTimeISO;
          if (st) {
            history[idx].duration = Math.floor((Date.now() - new Date(st).getTime()) / 1000);
          }
        }
        localStorage.setItem(this.localStorageKey, JSON.stringify(history));
      }
    } catch {
      // ignore
    }
  }
}

// ─── Module-level singleton ──────────────────────────────────────
// Sub-components (AdvancedControlsModal, MediaSFURoomDisplay) import
// `callService` as a singleton. This proxy is set by WidgetConfigProvider
// once initialization is complete.

let _callServiceSingleton: WidgetCallService | null = null;

export function setCallServiceSingleton(svc: WidgetCallService): void {
  _callServiceSingleton = svc;
}

/**
 * Module-level callService singleton for sub-components.
 * A Proxy object that delegates all property access to the real service
 * once it has been set via setCallServiceSingleton().
 */
export const callService = new Proxy({} as WidgetCallService, {
  get(_target, prop) {
    if (!_callServiceSingleton) {
      throw new Error('callService not initialized – ensure WidgetConfigProvider has mounted');
    }
    const value = (_callServiceSingleton as any)[prop];
    if (typeof value === 'function') {
      return value.bind(_callServiceSingleton);
    }
    return value;
  },
});
