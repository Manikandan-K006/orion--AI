"use client";

import { useCallback, useEffect, useRef, useState } from "react";
const WS_BASE = typeof window !== "undefined" ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.hostname}:8000` : "ws://localhost:8000";
export type GDLiveWsEvent =
  | "SESSION_STARTED"
  | "TEAMS_ASSIGNED"
  | "SESSION_PAUSED"
  | "SESSION_RESUMED"
  | "SESSION_ENDED"
  | "PARTICIPANT_JOINED"
  | "PARTICIPANTS_UPDATED"
  | "PARTICIPANT_LEFT"
  | "SPEAKER_CHANGED"
  | "READY_STATUS"
  | "HAND_RAISED"
  | "CHAT_MESSAGE"
  | "ROUND_CHANGED"
  | "TIMER_UPDATED"
  | "PARTICIPANT_MUTED"
  | "PARTICIPANT_REMOVED"
  | "STATE_SYNC"
  | "ERROR"
  | "TEAM_STATE_UPDATED"
  | "TRANSCRIPT"
  | "AI_EVALUATION"
  | "ALL_FINISHED"
  | "TEAM_PROGRESS"
  | "SESSION_RESULTS"
  | "AUDIO_CHUNK"
  | "SPEAKER_FINISHED"
  | "EVALUATION_PROGRESS";

export type GDLiveWsMessage = {
  event: GDLiveWsEvent;
  payload?: any;
};

export type RoomParticipant = {
  user_id: number;
  name: string | null;
  label: string | null;
  department?: string | null;
  year?: string | null;
  team_number?: number | null;
  status: string;
  ready?: boolean;
  hand_raised?: boolean;
  muted?: boolean;
  speaking?: boolean;
};

type Listener = (msg: GDLiveWsMessage) => void;

export function useGdLiveWs(sessionCode: string | null, token: string | null) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Set<Listener>>(new Set());
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUs = useRef(false);

  const send = useCallback((event: string, payload?: any) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event, payload }));
    }
  }, []);

  const subscribe = useCallback((fn: Listener) => {
    listenersRef.current.add(fn);
    return () => {
      listenersRef.current.delete(fn);
    };
  }, []);

  useEffect(() => {
    if (!sessionCode || !token) return;
    closedByUs.current = false;

    const connect = () => {
      const url = `${WS_BASE}/ws/gd-live/${sessionCode}?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closedByUs.current) {
          reconnectRef.current = setTimeout(connect, 2000);
        }
      };
      ws.onerror = () => setConnected(false);
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as GDLiveWsMessage;
          listenersRef.current.forEach((fn) => fn(msg));
        } catch {
          /* ignore malformed */
        }
      };
    };

    connect();

    return () => {
      closedByUs.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      wsRef.current = null;
      setConnected(false);
    };
  }, [sessionCode, token]);

  return { connected, send, subscribe };
}
