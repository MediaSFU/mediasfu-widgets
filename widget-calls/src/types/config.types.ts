// Configuration types
export interface VoipConfig {
  apiKey: string;
  apiUserName: string;
  baseUrl: string;
  enableLiveUpdates: boolean;
  updateInterval: number; // milliseconds
}

export interface AppConfig {
  api: {
    key: string;
    userName: string;
    baseUrl: string;
  };
  realtime: {
    enabled: boolean;
    interval: number; // milliseconds
  };
  ui: {
    theme: 'light' | 'dark';
    compactMode: boolean;
  };
  calls: {
    autoAnswer: boolean;
    recordCalls: boolean;
    defaultRingTime: number; // seconds
  };
}

// Default configuration
export const DEFAULT_CONFIG: AppConfig = {
  api: {
    key: '',
    userName: '',
    baseUrl: 'https://mediasfu.com'
  },
  realtime: {
    enabled: true,
    interval: 6000 // 6 seconds default (respecting API rate limit of 1 per 5 seconds)
  },
  ui: {
    theme: 'light',
    compactMode: false
  },
  calls: {
    autoAnswer: false,
    recordCalls: false,
    defaultRingTime: 30
  }
};
