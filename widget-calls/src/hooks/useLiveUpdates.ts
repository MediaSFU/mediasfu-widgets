import { useState, useEffect, useCallback, useRef } from 'react';
import { Call } from '../types';

interface UseLiveUpdatesOptions {
  enabled: boolean;
  interval: number;
  fetchFunction: () => Promise<void>;
  onError?: (error: string) => void;
}

export const useLiveUpdates = (options: UseLiveUpdatesOptions) => {
  const [isRunning, setIsRunning] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [updateCount, setUpdateCount] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Start live updates
  const start = useCallback(() => {
    if (!options.enabled || isRunning) return;

    setIsRunning(true);
    setUpdateCount(0);

    const runUpdate = async () => {
      try {
        await options.fetchFunction();
        setLastUpdate(new Date());
        setUpdateCount(prev => prev + 1);
      } catch (error: any) {
        // Handle live update error silently
        if (options.onError) {
          options.onError(error.message || 'Update failed');
        }
      }
    };

    // Run immediately
    runUpdate();

    // Set up interval
    intervalRef.current = setInterval(runUpdate, options.interval);
  }, [options, isRunning]);

  // Stop live updates
  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsRunning(false);
  }, []);

  // Toggle live updates
  const toggle = useCallback(() => {
    if (isRunning) {
      stop();
    } else {
      start();
    }
  }, [isRunning, start, stop]);

  // Effect to handle enabled state changes
  useEffect(() => {
    if (options.enabled && !isRunning) {
      start();
    } else if (!options.enabled && isRunning) {
      stop();
    }
  }, [options.enabled, isRunning, start, stop]);

  // Effect to handle interval changes
  useEffect(() => {
    if (isRunning) {
      stop();
      start();
    }
  }, [options.interval]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    isRunning,
    lastUpdate,
    updateCount,
    start,
    stop,
    toggle
  };
};

// Hook for managing real-time call updates
export const useRealTimeCallUpdates = (
  fetchActiveCalls: () => Promise<void>,
  enabled: boolean,
  interval: number = 6000 // 6 seconds to respect API rate limit of 1 per 5 seconds
) => {
  const [errors, setErrors] = useState<string[]>([]);

  const handleError = useCallback((error: string) => {
    setErrors(prev => [...prev.slice(-4), error]); // Keep last 5 errors
  }, []);

  const clearErrors = useCallback(() => {
    setErrors([]);
  }, []);

  const liveUpdates = useLiveUpdates({
    enabled,
    interval,
    fetchFunction: fetchActiveCalls,
    onError: handleError
  });

  return {
    ...liveUpdates,
    errors,
    clearErrors
  };
};

// Hook for tracking call duration
export const useCallDuration = (call: Call | null) => {
  const [duration, setDuration] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!call || call.status !== 'active') {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setDuration(call?.duration || 0);
      return;
    }

    // Calculate initial duration
    const startTimeString = call.startTimeISO || call.startTime?.toISOString();
    if (!startTimeString) {
      return;
    }

    const startTime = new Date(startTimeString).getTime();
    const now = Date.now();
    const initialDuration = Math.floor((now - startTime) / 1000);
    setDuration(initialDuration);

    // Update duration every second
    intervalRef.current = setInterval(() => {
      const currentTime = Date.now();
      const currentDuration = Math.floor((currentTime - startTime) / 1000);
      setDuration(currentDuration);
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [call]);

  // Format duration as MM:SS or HH:MM:SS
  const formatDuration = useCallback((seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
  }, []);

  return {
    duration,
    formattedDuration: formatDuration(duration)
  };
};
