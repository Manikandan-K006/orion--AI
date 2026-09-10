const DEFAULT_API_URL = "http://127.0.0.1:8000";


/**
 * Get the backend API base URL.
 */
export function getApiUrl(): string {
  let url = process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL;
  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    // When accessing locally, normalize to 127.0.0.1 to avoid Windows IPv6 [::1] connection drops
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return url.replace(/localhost/, "127.0.0.1");
    }
    // When accessing via LAN IP, rewrite host to match the student's network origin
    url = url.replace(/127\.0\.0\.1|localhost/, hostname);
  }
  return url;
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

