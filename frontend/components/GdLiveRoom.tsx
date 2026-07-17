"use client";

import { useEffect, useRef, useState } from "react";
import { Hand, MessageCircle, Maximize, PhoneOff, Radio, Clock, Users as UsersIcon, MicOff, CheckCircle2, XCircle, SkipForward, Pause, Play, RotateCcw, Flag, UserMinus } from "lucide-react";
import { useGdLiveWs, GDLiveWsMessage, RoomParticipant } from "@/lib/useGdLiveWs";

type ActivityItem = {
  id: number;
  text: string;
  kind: "system" | "join" | "left" | "speaker" | "timer" | "chat" | "ready" | "hand" | "mute" | "remove";
  ts: number;
};

function formatTime(s: number) {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

export default function GdLiveRoom({
  sessionCode,
  token,
  user,
  initialTopic,
  initialMembers,
  onLeave,
  onEnd,
}: {
  sessionCode: string;
  token: string;
  user: any;
  initialTopic: string;
  initialMembers: any[];
  onLeave: () => void;
  onEnd: (code: string) => void;
}) {
  const { connected, send, subscribe } = useGdLiveWs(sessionCode, token);
  const [topic, setTopic] = useState(initialTopic);
  const [members, setMembers] = useState<RoomParticipant[]>(
    (initialMembers || []).map((m: any) => ({
      user_id: m.user_id,
      name: m.name,
      label: m.label,
      department: m.department,
      year: m.year,
      team_number: m.team_number,
      status: m.status || "assigned",
      ready: false,
      hand_raised: false,
      muted: false,
      speaking: false,
    }))
  );
  const [speakerId, setSpeakerId] = useState<number | null>(null);
  const [round, setRound] = useState(1);
  const [paused, setPaused] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [ready, setReady] = useState(false);
  const [chat, setChat] = useState("");
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activityId = useRef(1);
  const isAdmin = user?.role === "admin";

  const pushActivity = (text: string, kind: ActivityItem["kind"]) => {
    setActivity((prev) => [...prev.slice(-60), { id: activityId.current++, text, kind, ts: Date.now() }]);
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activity]);

  // WebSocket events
  useEffect(() => {
    const unsub = subscribe((msg: GDLiveWsMessage) => {
      switch (msg.event) {
        case "STATE_SYNC":
        case "SESSION_STARTED": {
          const st = msg.payload?.state || msg.payload;
          if (msg.payload?.topic) setTopic(msg.payload.topic);
          if (Array.isArray(st?.participants)) {
            setMembers((prev) => {
              const map = new Map(prev.map((m) => [m.user_id, m]));
              for (const p of st.participants) {
                map.set(p.user_id, { ...map.get(p.user_id), ...p });
              }
              return Array.from(map.values());
            });
          } else if (Array.isArray(msg.payload?.members)) {
            setMembers(
              msg.payload.members.map((m: any) => ({
                user_id: m.user_id,
                name: m.name,
                label: m.label,
                department: m.department,
                year: m.year,
                team_number: m.team_number,
                status: m.status || "assigned",
                ready: false,
                hand_raised: false,
                muted: false,
                speaking: false,
              }))
            );
          }
          if (st?.speaker_user_id !== undefined) setSpeakerId(st.speaker_user_id);
          if (st?.round) setRound(st.round);
          if (st?.paused !== undefined) setPaused(st.paused);
          break;
        }
        case "PARTICIPANT_JOINED":
          pushActivity(`${msg.payload?.name || msg.payload?.label || "A participant"} joined`, "join");
          if (msg.payload?.user_id) {
            setMembers((prev) =>
              prev.some((m) => m.user_id === msg.payload.user_id)
                ? prev
                : [
                    ...prev,
                    {
                      user_id: msg.payload.user_id,
                      name: msg.payload.name,
                      label: msg.payload.label,
                      team_number: msg.payload.team_number,
                      status: "assigned",
                      ready: false,
                      hand_raised: false,
                      muted: false,
                      speaking: false,
                    },
                  ]
            );
          }
          break;
        case "PARTICIPANT_LEFT":
          pushActivity(`${msg.payload?.name || "A participant"} left`, "left");
          setMembers((prev) => prev.filter((m) => m.user_id !== msg.payload?.user_id));
          break;
        case "SPEAKER_CHANGED":
          setSpeakerId(msg.payload?.user_id ?? null);
          break;
        case "READY_STATUS":
          setMembers((prev) => prev.map((m) => (m.user_id === msg.payload?.user_id ? { ...m, ready: !!msg.payload?.ready } : m)));
          break;
        case "HAND_RAISED":
          setMembers((prev) => prev.map((m) => (m.user_id === msg.payload?.user_id ? { ...m, hand_raised: !!msg.payload?.raised } : m)));
          if (msg.payload?.user_id === user?.id) setHandRaised(!!msg.payload?.raised);
          pushActivity(`${msg.payload?.name || "Someone"} raised their hand`, "hand");
          break;
        case "CHAT_MESSAGE":
          pushActivity(`${msg.payload?.name || msg.payload?.label || "Participant"}: ${msg.payload?.text}`, "chat");
          break;
        case "ROUND_CHANGED":
          setRound(msg.payload?.round ?? round + 1);
          pushActivity(`Round ${msg.payload?.round ?? round + 1} started`, "system");
          break;
        case "TIMER_UPDATED":
          setTimerSeconds(msg.payload?.seconds ?? 0);
          setTimerRunning(!!msg.payload?.running);
          if (!msg.payload?.running) pushActivity("Timer reset", "timer");
          break;
        case "PARTICIPANT_MUTED": {
          setMembers((prev) => prev.map((m) => (m.user_id === msg.payload?.user_id ? { ...m, muted: !!msg.payload?.muted } : m)));
          const p = members.find((m) => m.user_id === msg.payload?.user_id);
          pushActivity(`${p?.label || p?.name || "A participant"} ${msg.payload?.muted ? "muted" : "unmuted"}`, "mute");
          break;
        }
        case "PARTICIPANT_REMOVED":
          setMembers((prev) => prev.filter((m) => m.user_id !== msg.payload?.user_id));
          pushActivity(`A participant was removed`, "remove");
          break;
        case "SESSION_PAUSED":
          setPaused(true);
          setTimerRunning(false);
          pushActivity("Session paused by admin", "system");
          break;
        case "SESSION_RESUMED":
          setPaused(false);
          pushActivity("Session resumed by admin", "system");
          break;
        case "SESSION_ENDED":
          pushActivity("Session ended", "system");
          onLeave();
          break;
        default:
          break;
      }
    });
    return unsub;
  }, [subscribe, onLeave, round, members]);

  function toggleHand() {
    const next = !handRaised;
    setHandRaised(next);
    send("RAISE_HAND", { raised: next });
  }
  function toggleReady() {
    const next = !ready;
    setReady(next);
    send("READY", { ready: next });
  }
  function sendMessage() {
    const text = chat.trim();
    if (!text) return;
    send("CHAT_MESSAGE", { text });
    setChat("");
  }
  function startTimer(minutes: number) {
    setTimerSeconds(minutes * 60);
    setTimerRunning(true);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimerSeconds((s) => {
        if (s <= 1) {
          if (timerRef.current) clearInterval(timerRef.current!);
          setTimerRunning(false);
          pushActivity("Time is up", "timer");
          send("TIMER_UPDATED", { seconds: 0, running: false });
          if (isAdmin) onEnd(sessionCode);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    send("TIMER_UPDATED", { seconds: minutes * 60, running: true });
  }
  function resetTimer() {
    setTimerSeconds(0);
    setTimerRunning(false);
    if (timerRef.current) clearInterval(timerRef.current!);
    send("RESET_TIMER", { seconds: 0 });
  }
  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  const speaker = members.find((m) => m.user_id === speakerId);
  const onlineCount = members.length;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 md:px-6 py-3 surface border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-red-500">
            <span className={`w-2.5 h-2.5 rounded-full bg-red-500 ${paused ? "" : "animate-pulse"}`} /> {paused ? "PAUSED" : "LIVE"}
          </span>
          <span className="text-sm text-muted-soft">Code <code className="font-mono text-amber-300">{sessionCode}</code></span>
          <span className="text-sm text-heading font-semibold truncate max-w-[40vw]">{topic || "—"}</span>
          {timerRunning && (
            <span className="flex items-center gap-1 text-sm text-heading font-mono"><Clock className="w-4 h-4" /> {formatTime(timerSeconds)}</span>
          )}
          <span className="text-xs text-muted-soft">Round {round}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-sm text-muted-soft"><UsersIcon className="w-4 h-4" /> {onlineCount} online</span>
          <span className="hidden md:inline-flex items-center gap-1 text-xs text-muted-soft">
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`} /> {connected ? "Realtime" : "Offline"}
          </span>
          <button className="p-2 rounded-lg btn-secondary" onClick={toggleFullscreen} title="Fullscreen"><Maximize className="w-4 h-4" /></button>
          <button className="p-2 rounded-lg flex items-center gap-2 px-4 text-white border-0" style={{ background: "#ef4444" }} onClick={onLeave}>
            <PhoneOff className="w-4 h-4" /> Leave
          </button>
        </div>
      </header>

      {/* Current speaker strip */}
      <div className="px-4 md:px-6 py-2 flex items-center gap-2 surface border-b" style={{ borderColor: "var(--border)" }}>
        <Radio className="w-4 h-4 text-emerald-400" />
        <span className="text-sm text-muted-soft">Current Speaker:</span>
        <span className="text-sm font-semibold text-heading">{speaker ? (speaker.label || speaker.name || "Participant") : "—"}</span>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[260px_1fr_320px] overflow-hidden">
        {/* Left: Participants */}
        <aside className="surface border-r p-3 overflow-y-auto" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-xs uppercase tracking-wide text-muted-soft mb-2 flex items-center gap-1"><UsersIcon className="w-3.5 h-3.5" /> Participants ({members.length})</h3>
          <ul className="space-y-1">
            {members.map((m) => {
              const isSpeaking = m.user_id === speakerId;
              return (
                <li
                  key={m.user_id}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${isSpeaking ? "bg-emerald-500/15 ring-1 ring-emerald-500/40" : "surface-2"}`}
                >
                  <span className={`w-2 h-2 rounded-full ${m.muted ? "bg-red-500" : "bg-emerald-500"}`} />
                  <span className={`text-sm truncate flex-1 ${isSpeaking ? "font-semibold text-emerald-300" : "text-heading"}`}>
                    {m.label || m.name || "Participant"}
                  </span>
                  {m.hand_raised && <Hand className="w-3.5 h-3.5 text-amber-400" />}
                  {m.ready && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                  {m.muted && <MicOff className="w-3.5 h-3.5 text-red-400" />}
                  {isAdmin && m.user_id !== user?.id && (
                    <div className="flex items-center gap-1">
                      <button
                        className="text-[10px] text-amber-400 hover:underline"
                        onClick={() => send("SET_SPEAKER", { user_id: m.user_id })}
                        title="Make speaker"
                      >
                        <Radio className="w-3.5 h-3.5" />
                      </button>
                      <button
                        className="text-[10px] text-red-400 hover:underline"
                        onClick={() => send("MUTE_PARTICIPANT", { user_id: m.user_id, muted: !m.muted })}
                        title={m.muted ? "Unmute" : "Mute"}
                      >
                        <MicOff className="w-3.5 h-3.5" />
                      </button>
                      <button
                        className="text-[10px] text-red-400 hover:underline"
                        onClick={() => send("REMOVE_PARTICIPANT", { user_id: m.user_id })}
                        title="Remove"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Center: Discussion area */}
        <main className="overflow-y-auto p-4 md:p-6 space-y-4">
          <div className="card p-5">
            <p className="text-xs text-muted-soft">Discussion Topic</p>
            <h2 className="text-lg font-bold text-heading">{topic || "—"}</h2>
          </div>
          <div className="card p-5">
            <p className="text-xs text-muted-soft mb-1">Instructions</p>
            <p className="text-sm text-body">This is a collaborative group discussion. Raise your hand to queue, mark <strong>Ready</strong> when prepared, and send messages in the activity panel. The admin controls the timer, speaker order, and rounds. No camera required — just join the conversation.</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="card p-4 text-center">
              <p className="text-xs text-muted-soft">Round</p>
              <p className="text-2xl font-bold text-heading">{round}</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-xs text-muted-soft">Remaining</p>
              <p className="text-2xl font-bold text-heading font-mono">{timerRunning ? formatTime(timerSeconds) : "—"}</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-xs text-muted-soft">Online</p>
              <p className="text-2xl font-bold text-heading">{onlineCount}</p>
            </div>
          </div>
          <div className="card p-4">
            <p className="text-xs text-muted-soft mb-2">Speaking Queue</p>
            <div className="flex flex-wrap gap-2">
              {members.filter((m) => !m.muted).map((m, i) => (
                <span key={m.user_id} className={`text-xs px-2 py-1 rounded-full ${m.user_id === speakerId ? "bg-emerald-500/20 text-emerald-300" : "surface-2 text-body"}`}>
                  {i + 1}. {m.label || m.name || "Participant"}
                </span>
              ))}
            </div>
          </div>
        </main>

        {/* Right: Live Activity */}
        <aside className="surface border-l p-3 overflow-y-auto flex flex-col" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-xs uppercase tracking-wide text-muted-soft mb-2">Live Activity</h3>
          <div className="flex-1 space-y-1.5 overflow-y-auto text-sm">
            {activity.length === 0 && <p className="text-muted-soft text-xs">Waiting for activity…</p>}
            {activity.map((a) => (
              <div key={a.id} className={`text-xs ${a.kind === "chat" ? "text-body" : a.kind === "system" ? "text-amber-300" : a.kind === "join" || a.kind === "speaker" ? "text-emerald-300" : "text-muted-soft"}`}>
                <span className="opacity-60 mr-1">{new Date(a.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                {a.text}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
        </aside>
      </div>

      {/* Bottom controls */}
      <footer className="flex items-center justify-center gap-3 py-3 surface border-t flex-wrap" style={{ borderColor: "var(--border)" }}>
        <CtrlButton active={handRaised} onClick={toggleHand} label="Raise Hand" activeClass="bg-amber-500 border-amber-500 text-white" icon={<Hand className="w-5 h-5" />} />
        <CtrlButton active={ready} onClick={toggleReady} label="Ready" activeClass="bg-emerald-500 border-emerald-500 text-white" icon={<CheckCircle2 className="w-5 h-5" />} />
        <div className="flex items-center gap-2 surface-2 rounded-xl px-3 py-2 border" style={{ borderColor: "var(--border)" }}>
          <MessageCircle className="w-5 h-5 text-muted-soft" />
          <input
            value={chat}
            onChange={(e) => setChat(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Send a message…"
            className="bg-transparent outline-none text-sm text-heading w-48"
          />
        </div>
        {isAdmin && (
          <>
            <button onClick={() => startTimer(15)} disabled={timerRunning} className="btn-primary text-xs h-11 px-3 flex items-center gap-1"><Play className="w-4 h-4" /> Start 15:00</button>
            <button onClick={() => startTimer(10)} disabled={timerRunning} className="btn-secondary text-xs h-11 px-3 flex items-center gap-1"><Play className="w-4 h-4" /> 10:00</button>
            <button onClick={resetTimer} className="btn-secondary text-xs h-11 px-3 flex items-center gap-1"><RotateCcw className="w-4 h-4" /> Reset</button>
            <button onClick={() => send("PAUSE_GD", {})} disabled={paused} className="btn-secondary text-xs h-11 px-3 flex items-center gap-1"><Pause className="w-4 h-4" /> Pause</button>
            <button onClick={() => send("RESUME_GD", {})} disabled={!paused} className="btn-secondary text-xs h-11 px-3 flex items-center gap-1"><Play className="w-4 h-4" /> Resume</button>
            <button onClick={() => send("NEXT_ROUND", {})} className="btn-secondary text-xs h-11 px-3 flex items-center gap-1"><Flag className="w-4 h-4" /> Next Round</button>
            <button onClick={() => send("NEXT_SPEAKER", {})} className="btn-secondary text-xs h-11 px-3 flex items-center gap-1"><SkipForward className="w-4 h-4" /> Next Speaker</button>
            <button onClick={() => onEnd(sessionCode)} className="btn-secondary text-xs h-11 px-3 text-red-500 border-red-500/40 flex items-center gap-1"><XCircle className="w-4 h-4" /> End GD</button>
          </>
        )}
      </footer>
    </div>
  );
}

function CtrlButton({ active, onClick, label, activeClass, icon }: any) {
  return (
    <button
      onClick={onClick}
      className={`p-3 rounded-xl border flex items-center gap-2 ${active ? (activeClass || "btn-secondary") : "bg-red-500/15 border-red-500/40 text-red-400"}`}
    >
      {icon}
      <span className="text-xs hidden md:inline">{label}</span>
    </button>
  );
}
