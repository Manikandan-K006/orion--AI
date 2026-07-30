const DEFAULT_API_URL = "http://127.0.0.1:8000";

/**
 * Get the backend API base URL.
 */
export function getApiUrl(): string {
  let url = process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL;
  // When a student/admin opens the frontend via LAN IP (e.g. http://10.x.x.x:3000),
  // rewrite the API base URL to use the same hostname so the backend is reachable.
  // This is needed because 127.0.0.1/localhost only resolves on the server machine,
  // not on the student's phone/laptop connecting over LAN.
  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    const isLanAccess =
      hostname !== "localhost" &&
      hostname !== "127.0.0.1";
    if (isLanAccess) {
      // Replace the loopback address with the actual LAN hostname
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

