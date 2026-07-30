const DEFAULT_API_URL = "http://127.0.0.1:8000";

/**
 * Get the backend API base URL.
 */
export function getApiUrl(): string {
  let url = process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL;
  // When a student opens the frontend via LAN IP (e.g. http://10.x.x.x:3000),
  // rewrite the API base URL to use the same hostname so the backend is reachable.
  // This avoids Private Network Access (PNA) blocks that occur when mixing
  // localhost frontend with a LAN-IP backend.
  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    if (
      hostname !== "localhost" &&
      hostname !== "127.0.0.1" &&
      (url.includes("127.0.0.1") || url.includes("localhost"))
    ) {
      url = url.replace(/127\.0\.0\.1|localhost/, hostname);
    }
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

