"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const WS_BASE = "ws://localhost:8000";

export type GDLiveWsEvent =
  | "SESSION_STARTED"
  | "SESSION_ENDED"
  | "PARTICIPANT_JOINED"
  | "PARTICIPANT_LEFT"
  | "MIC_TOGGLED"
  | "CAMERA_TOGGLED"
  | "HAND_RAISED"
  | "SPEAKER_CHANGED"
  | "TIMER_UPDATED"
  | "CHAT_MESSAGE"
  | "ERROR";

export type GDLiveWsMessage = {
  event: GDLiveWsEvent;
  payload?: any;
};

type Listener = (msg: GDLiveWsMessage) => void;

export function useGdLiveWs(sessionCode: string | null, token: string | null) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Set<Listener>>(new Set());

  const send = useCallback((event: string, payload?: any) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event, payload }));
    }
  }, []);

  const subscribe = useCallback((fn: Listener) => {
    listenersRef.current.add(fn);
    return () => { listenersRef.current.delete(fn); };
  }, []);

  useEffect(() => {
    if (!sessionCode || !token) return;
    const url = `${WS_BASE}/ws/gd-live/${sessionCode}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as GDLiveWsMessage;
        listenersRef.current.forEach((fn) => fn(msg));
      } catch { /* ignore malformed */ }
    };

    return () => {
      ws.onclose = null;
      ws.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [sessionCode, token]);

  return { connected, send, subscribe };
}
