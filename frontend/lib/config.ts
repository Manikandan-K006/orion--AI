/** Default backend port */
const DEFAULT_API_PORT = "8000";

/**
 * Get the backend API base URL.
 *
 * On the client: always derives from the current page hostname so LAN access
 *   http://10.206.99.142:3000  →  http://10.206.99.142:8000
 *   http://localhost:3000       →  http://localhost:8000
 *
 * On the server (SSR): uses NEXT_PUBLIC_API_URL env var or localhost.
 */
export function getApiUrl(): string {
  if (typeof window !== "undefined") {
    const hostname = window.location.hostname === "localhost" ? "127.0.0.1" : window.location.hostname;
    return `${window.location.protocol}//${hostname}:${DEFAULT_API_PORT}`;
  }
  const fallback = process.env.NEXT_PUBLIC_API_URL || `http://127.0.0.1:${DEFAULT_API_PORT}`;
  return fallback.replace("localhost", "127.0.0.1");
}

/**
 * Get the WebSocket backend base URL.
 *
 * Same strategy as getApiUrl but for ws:///wss:// protocol.
 */
export function getWsBase(): string {
  if (typeof window !== "undefined") {
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const hostname = window.location.hostname === "localhost" ? "127.0.0.1" : window.location.hostname;
    return `${wsProtocol}//${hostname}:${DEFAULT_API_PORT}`;
  }
  const fallback = process.env.NEXT_PUBLIC_WS_URL || `ws://127.0.0.1:${DEFAULT_API_PORT}`;
  return fallback.replace("localhost", "127.0.0.1");
}

