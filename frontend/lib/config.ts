const DEFAULT_API_URL = "http://127.0.0.1:8000";

/**
 * Get the backend API base URL.
 */
export function getApiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL;
}

/**
 * Get the WebSocket backend base URL.
 */
export function getWsBase(): string {
  const apiUrl = getApiUrl();
  if (apiUrl.startsWith("https://")) {
    return apiUrl.replace("https://", "wss://");
  }
  return apiUrl.replace("http://", "ws://");
}

