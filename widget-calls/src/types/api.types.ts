// API response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  code?: number;
  status?: number;
}

export interface GraphQLResponse<T = any> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
  }>;
}

export interface MediaSFUCredentials {
  apiUserName: string;
  apiKey: string;
}

export interface BackendConfig {
  BASE_URL: string;
  AUTH_URL: string;
  TELEPHONY_URL: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// HTTP client configuration
export interface HttpClientConfig {
  baseURL: string;
  timeout: number;
  headers: Record<string, string>;
}

// API endpoints configuration
export interface ApiEndpoints {
  calls: {
    outbound: string;
    active: string;
    history: string;
    hangup: string;
    hold: string;
    unhold: string;
    transfer: string;
  };
  auth: {
    login: string;
    refresh: string;
    logout: string;
  };
}

export const DEFAULT_ENDPOINTS: ApiEndpoints = {
  calls: {
    outbound: '/api/calls/outbound',
    active: '/api/calls/active',
    history: '/api/calls/history',
    hangup: '/api/calls/{callId}/hangup',
    hold: '/api/calls/{callId}/hold',
    unhold: '/api/calls/{callId}/unhold',
    transfer: '/api/calls/{callId}/transfer'
  },
  auth: {
    login: '/api/auth/login',
    refresh: '/api/auth/refresh',
    logout: '/api/auth/logout'
  }
};
