import { useState, useCallback, useEffect } from 'react';
import { Call } from '../types/call.types';
import { callLogger } from '../utils/logger';

export interface CallHistoryHook {
  callHistory: Call[];
  addCallToHistory: (call: Call) => void;
  markCallAsTerminated: (sipCallId: string) => void;
  markCallsAsTerminated: (activeSipCallIds: string[]) => void;
  clearCallHistory: () => void;
  clearSpecificCallFromHistory: (sipCallId: string) => void;
  clearMultipleCallsFromHistory: (sipCallIds: string[]) => void;
  loadCallHistory: () => void;
  getCallHistoryStats: () => {
    total: number;
    byStatus: Record<string, number>;
    byDirection: Record<string, number>;
    averageDuration: number;
    totalDuration: number;
    connectedCalls: number;
    connectionRate: number;
    todaysCalls: number;
    thisWeeksCalls: number;
  };
}

const MAX_HISTORY_RECORDS = 100; // Maximum number of call records to keep
const STORAGE_KEY = 'voip_call_history';

export const useCallHistory = (): CallHistoryHook => {
  const [callHistory, setCallHistory] = useState<Call[]>([]);

  const saveCallHistory = useCallback((history: Call[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
      callLogger.debug('Saved call history:', history.length, 'records');
    } catch (error) {
      callLogger.error('Error saving call history:', error);
    }
  }, []);

  const loadCallHistory = useCallback(() => {
    try {
      const savedHistory = localStorage.getItem(STORAGE_KEY);
      if (savedHistory) {
        const parsed = JSON.parse(savedHistory) as Call[];
        setCallHistory(parsed);
        callLogger.info('Loaded call history:', parsed.length, 'records');
      }
    } catch (error) {
      callLogger.error('Error loading call history:', error);
    }
  }, []);

  const addCallToHistory = useCallback((call: Call) => {
    setCallHistory(prev => {
      // Check if call already exists in history (by sipCallId)
      const existingIndex = prev.findIndex(h =>
        h.sipCallId === call.sipCallId ||
        (h.id && h.id === call.sipCallId) ||
        (call.id && h.sipCallId === call.id)
      );

      let newHistory: Call[];

      if (existingIndex >= 0) {
        // Update existing record with latest data
        newHistory = [...prev];
        newHistory[existingIndex] = { ...newHistory[existingIndex], ...call };
      } else {
        // Add new record to the beginning (most recent first)
        newHistory = [call, ...prev];
      }

      // Enforce maximum history limit
      if (newHistory.length > MAX_HISTORY_RECORDS) {
        newHistory = newHistory.slice(0, MAX_HISTORY_RECORDS);
        callLogger.debug('Trimmed call history to', MAX_HISTORY_RECORDS, 'records');
      }

      // Save to localStorage
      saveCallHistory(newHistory);
      return newHistory;
    });
  }, [saveCallHistory]);

  const clearCallHistory = useCallback(() => {
    setCallHistory([]);
    localStorage.removeItem(STORAGE_KEY);
    callLogger.info('Cleared all call history');
  }, []);

  const clearSpecificCallFromHistory = useCallback((sipCallId: string) => {
    setCallHistory(prev => {
      const newHistory = prev.filter(call =>
        call.sipCallId !== sipCallId &&
        call.id !== sipCallId
      );
      saveCallHistory(newHistory);
      callLogger.info('Removed call from history:', sipCallId);
      return newHistory;
    });
  }, [saveCallHistory]);

  const clearMultipleCallsFromHistory = useCallback((sipCallIds: string[]) => {
    setCallHistory(prev => {
      const newHistory = prev.filter(call =>
        !sipCallIds.includes(call.sipCallId) &&
        (!call.id || !sipCallIds.includes(call.id))
      );
      saveCallHistory(newHistory);
      callLogger.info('Removed multiple calls from history:', sipCallIds.length);
      return newHistory;
    });
  }, [saveCallHistory]);

  const markCallAsTerminated = useCallback((sipCallId: string) => {
    setCallHistory(prev => {
      const newHistory = prev.map(call => {
        if (call.sipCallId === sipCallId || call.id === sipCallId) {
          return {
            ...call,
            status: 'terminated' as any,
            callEnded: true,
            endTime: new Date()
          };
        }
        return call;
      });

      // Only save if something actually changed
      const hasChanges = newHistory.some((call, index) =>
        call !== prev[index]
      );

      if (hasChanges) {
        saveCallHistory(newHistory);
        callLogger.info('Marked call as terminated:', sipCallId);
      }

      return newHistory;
    });
  }, [saveCallHistory]);

  const markCallsAsTerminated = useCallback((activeSipCallIds: string[]) => {
    setCallHistory(prev => {
      const newHistory = prev.map(call => {
        // If call is not in the active list and not already marked as terminated/ended
        const isActiveCall = activeSipCallIds.includes(call.sipCallId) ||
                           (call.id && activeSipCallIds.includes(call.id));
        const isAlreadyTerminated = ['terminated', 'ended', 'failed', 'completed'].includes(call.status || '');

        if (!isActiveCall && !isAlreadyTerminated) {
          return {
            ...call,
            status: 'terminated' as any,
            callEnded: true,
            endTime: call.endTime || new Date()
          };
        }
        return call;
      });

      // Only save if something actually changed
      const hasChanges = newHistory.some((call, index) =>
        call !== prev[index]
      );

      if (hasChanges) {
        saveCallHistory(newHistory);
        callLogger.info('Marked missing calls as terminated');
      }

      return newHistory;
    });
  }, [saveCallHistory]);

  const getCallHistoryStats = useCallback(() => {
    const stats = {
      total: callHistory.length,
      byStatus: {} as Record<string, number>,
      byDirection: {} as Record<string, number>,
      averageDuration: 0,
      totalDuration: 0,
      connectedCalls: 0,
      connectionRate: 0,
      todaysCalls: 0,
      thisWeeksCalls: 0
    };

    if (callHistory.length === 0) {
      return stats;
    }

    let totalDurationSeconds = 0;
    let connectedCallsCount = 0;
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const weekStart = new Date(today.getTime() - (7 * 24 * 60 * 60 * 1000));

    callHistory.forEach(call => {
      // Count by status
      const status = call.status || 'unknown';
      stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;

      // Count by direction
      const direction = call.direction || 'unknown';
      stats.byDirection[direction] = (stats.byDirection[direction] || 0) + 1;

      // Calculate duration stats
      const duration = call.durationSeconds || call.duration || 0;
      totalDurationSeconds += duration;

      // Count connected calls (calls that actually connected, not just attempted)
      if (['active', 'completed', 'ended', 'terminated'].includes(status) && duration > 0) {
        connectedCallsCount++;
      }

      // Count today's calls
      const callDate = call.startTime || (call.startTimeISO ? new Date(call.startTimeISO) : null);
      if (callDate && callDate >= todayStart) {
        stats.todaysCalls++;
      }

      // Count this week's calls
      if (callDate && callDate >= weekStart) {
        stats.thisWeeksCalls++;
      }
    });

    stats.totalDuration = totalDurationSeconds;
    stats.connectedCalls = connectedCallsCount;
    stats.averageDuration = connectedCallsCount > 0 ? Math.round(totalDurationSeconds / connectedCallsCount) : 0;
    stats.connectionRate = stats.total > 0 ? Math.round((connectedCallsCount / stats.total) * 100) : 0;

    return stats;
  }, [callHistory]);

  // Load call history on hook initialization
  useEffect(() => {
    loadCallHistory();
  }, [loadCallHistory]);

  return {
    callHistory,
    addCallToHistory,
    markCallAsTerminated,
    markCallsAsTerminated,
    clearCallHistory,
    clearSpecificCallFromHistory,
    clearMultipleCallsFromHistory,
    loadCallHistory,
    getCallHistoryStats
  };
};
