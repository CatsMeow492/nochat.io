/**
 * Converts WebSocket URLs to HTTP URLs for REST endpoints
 * and ensures consistency in URL formatting
 */
export const getHttpUrl = (wsUrl: string): string => {
  return wsUrl
    .replace(/\/$/, '')  // Remove trailing slash
    .replace('wss://', 'https://')
    .replace('ws://', 'http://');
};

/**
 * Gets WebSocket URL for real-time connections
 */
export const getWsUrl = (baseUrl: string): string => {
  return baseUrl
    .replace(/\/$/, '')  // Remove trailing slash
    .replace('https://', 'wss://')
    .replace('http://', 'ws://');
}; 