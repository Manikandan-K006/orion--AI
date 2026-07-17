"use client";

import { useEffect, useRef, useState } from "react";
import { Video, VideoOff, Mic, MicOff, Hand, MessageCircle, Maximize, PhoneOff, Radio, Clock, Users as UsersIcon } from "lucide-react";
import { useGdLiveWs, GDLiveWsMessage } from "@/lib/useGdLiveWs";

type Member = {
  user_id: number;
  name: string | null;
  label: string | null;
  department: string | null;
  year: string | null;
  status: string;
  mic_on?: boolean;
  cam_on?: boolean;
  hand_raised?: boolean;
  speaking?: boolean;
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
  initialMembers: Member[];
  onLeave: () => void;
  onEnd: (code: string) => void;
}) {
  const { connected, send, subscribe } = useGdLiveWs(sessionCode, token);
  const [topic, setTopic] = useState(initialTopic);
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [handRaised, setHandRaised] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isAdmin = user?.role === "admin";

  // Local camera
  useEffect(() => {
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setMicOn(stream.getAudioTracks().some((t) => t.enabled));
        setCamOn(stream.getVideoTracks().some((t) => t.enabled));
      } catch {
        /* permission denied — still join room */
      }
    })();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // WebSocket events
  useEffect(() => {
    const unsub = subscribe((msg: GDLiveWsMessage) => {
      switch (msg.event) {
        case "SESSION_STARTED":
          if (msg.payload?.topic) setTopic(msg.payload.topic);
          if (Array.isArray(msg.payload?.members)) setMembers(msg.payload.members);
          break;
        case "SESSION_ENDED":
          onLeave();
          break;
        case "MIC_TOGGLED":
          setMembers((prev) => prev.map((m) => (m.user_id === msg.payload?.user_id ? { ...m, mic_on: !!msg.payload?.on } : m)));
          break;
        case "CAMERA_TOGGLED":
          setMembers((prev) => prev.map((m) => (m.user_id === msg.payload?.user_id ? { ...m, cam_on: !!msg.payload?.on } : m)));
          break;
        case "HAND_RAISED":
          setMembers((prev) => prev.map((m) => (m.user_id === msg.payload?.user_id ? { ...m, hand_raised: !!msg.payload?.raised } : m)));
          break;
        case "SPEAKER_CHANGED":
          setMembers((prev) => prev.map((m) => ({ ...m, speaking: m.user_id === msg.payload?.user_id ? !!msg.payload?.speaking : false })));
          break;
        default:
          break;
      }
    });
    return unsub;
  }, [subscribe, onLeave]);

  function toggleMic() {
    const next = !micOn;
    setMicOn(next);
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
    send("MIC_TOGGLED", { on: next });
  }
  function toggleCam() {
    const next = !camOn;
    setCamOn(next);
    streamRef.current?.getVideoTracks().forEach((t) => (t.enabled = next));
    send("CAMERA_TOGGLED", { on: next });
  }
  function toggleHand() {
    const next = !handRaised;
    setHandRaised(next);
    send("HAND_RAISED", { raised: next });
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
          onEnd(sessionCode);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }
  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  const me = members.find((m) => m.user_id === user?.id);
  const displayMembers = members.length ? members : (me ? [me] : []);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 md:px-6 py-3 surface border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-red-500">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" /> LIVE
          </span>
          <span className="text-sm text-muted-soft">Code <code className="font-mono text-amber-300">{sessionCode}</code></span>
          {timerRunning && (
            <span className="flex items-center gap-1 text-sm text-heading font-mono"><Clock className="w-4 h-4" /> {formatTime(timerSeconds)}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-sm text-muted-soft"><UsersIcon className="w-4 h-4" /> {displayMembers.length}</span>
          <span className="hidden md:inline-flex items-center gap-1 text-xs text-muted-soft"><span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`} /> {connected ? "Realtime" : "Offline"}</span>
          <Button leave onClick={onLeave} />
        </div>
      </header>

      {/* Topic + timer controls (admin) */}
      <div className="px-4 md:px-6 py-3 flex flex-wrap items-center gap-3 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-soft">Discussion Topic</p>
          <p className="text-sm font-semibold text-heading truncate">{topic || "—"}</p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <button onClick={() => startTimer(15)} disabled={timerRunning} className="btn-primary text-xs h-9 px-3">Start 15:00</button>
            <button onClick={() => startTimer(10)} disabled={timerRunning} className="btn-secondary text-xs h-9 px-3">10:00</button>
            <button onClick={() => onEnd(sessionCode)} className="btn-secondary text-xs h-9 px-3 text-red-500 border-red-500/40">End Session</button>
          </div>
        )}
      </div>

      {/* Video grid */}
      <main className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {/* Local participant */}
          <ParticipantCard
            name={user?.name || "You"}
            label="You"
            department={me?.department}
            year={me?.year}
            micOn={micOn}
            camOn={camOn}
            handRaised={handRaised}
            speaking={false}
            isLocal
            videoRef={videoRef}
          />
          {/* Remote (simulated grid) participants */}
          {displayMembers.filter((m) => m.user_id !== user?.id).map((m) => (
            <ParticipantCard
              key={m.user_id}
              name={m.label || m.name || "Participant"}
              label={m.label}
              department={m.department}
              year={m.year}
              micOn={m.mic_on !== false}
              camOn={m.cam_on !== false}
              handRaised={!!m.hand_raised}
              speaking={!!m.speaking}
            />
          ))}
        </div>
        {displayMembers.length <= 1 && (
          <p className="text-center text-muted-soft text-sm mt-8">Waiting for other participants to join the room…</p>
        )}
      </main>

      {/* Bottom controls */}
      <footer className="flex items-center justify-center gap-3 py-4 surface border-t" style={{ borderColor: "var(--border)" }}>
        <CtrlButton active={micOn} onClick={toggleMic} on={<Mic className="w-5 h-5" />} off={<MicOff className="w-5 h-5" />} label="Mic" />
        <CtrlButton active={camOn} onClick={toggleCam} on={<Video className="w-5 h-5" />} off={<VideoOff className="w-5 h-5" />} label="Camera" />
        <CtrlButton active={handRaised} onClick={toggleHand} on={<Hand className="w-5 h-5" />} off={<Hand className="w-5 h-5" />} label="Raise Hand" activeClass="bg-amber-500 border-amber-500 text-white" />
        <button className="p-3 rounded-xl btn-secondary" title="Chat"><MessageCircle className="w-5 h-5" /></button>
        <button className="p-3 rounded-xl btn-secondary" onClick={toggleFullscreen} title="Fullscreen"><Maximize className="w-5 h-5" /></button>
        <button className="p-3 rounded-xl flex items-center gap-2 px-5 text-white border-0" style={{ background: "#ef4444" }} onClick={onLeave}>
          <PhoneOff className="w-5 h-5" /> Leave
        </button>
      </footer>
    </div>
  );
}

function CtrlButton({ active, onClick, on, off, label, activeClass }: any) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`p-3 rounded-xl border flex items-center gap-2 ${active ? (activeClass || "btn-secondary") : "bg-red-500/15 border-red-500/40 text-red-400"}`}
    >
      {active ? on : off}
      <span className="text-xs hidden md:inline">{label}</span>
    </button>
  );
}

function ParticipantCard({ name, label, department, year, micOn, camOn, handRaised, speaking, isLocal, videoRef }: any) {
  return (
    <div className={`relative card overflow-hidden p-0 ${speaking ? "ring-2 ring-emerald-500" : ""}`} style={{ minHeight: 200 }}>
      {isLocal ? (
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-48 object-cover bg-black" />
      ) : camOn ? (
        <div className="w-full h-48 flex items-center justify-center bg-gradient-to-br from-purple-600/30 to-blue-600/30">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white text-xl font-bold">
            {(name || "?").split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
          </div>
        </div>
      ) : (
        <div className="w-full h-48 flex items-center justify-center bg-black/40">
          <VideoOff className="w-8 h-8 text-muted-soft" />
        </div>
      )}
      <div className="absolute top-2 left-2 flex items-center gap-1">
        {speaking && <Radio className="w-4 h-4 text-emerald-400" />}
        {!micOn && <MicOff className="w-4 h-4 text-red-400" />}
        {handRaised && <Hand className="w-4 h-4 text-amber-400" />}
      </div>
      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/70 to-transparent">
        <p className="text-sm font-semibold text-white truncate">{name}{isLocal ? " (You)" : ""}</p>
        <p className="text-xs text-white/70 truncate">{[department, year].filter(Boolean).join(" · ")}</p>
      </div>
    </div>
  );
}

function Button({ onClick, children }: any) {
  return (
    <button onClick={onClick} className="btn-secondary text-xs h-9 px-3 flex items-center gap-1">
      {children}
    </button>
  );
}
