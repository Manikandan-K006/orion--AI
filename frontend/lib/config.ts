const DEFAULT_API_URL = "http://127.0.0.1:8000";

/**
 * Get the backend API base URL.
 */
export function getApiUrl(): string {
  let url = process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL;
  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    // If the user accesses the site via a LAN IP (e.g. 10.x.x.x) but the env var is set to localhost/127.0.0.1,
    // rewrite the API URL to point to the LAN IP so it doesn't fail trying to hit the client's own localhost.
    if (hostname !== "localhost" && hostname !== "127.0.0.1" && (url.includes("127.0.0.1") || url.includes("localhost"))) {
      url = url.replace(/localhost|127\.0\.0\.1/, hostname);
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

