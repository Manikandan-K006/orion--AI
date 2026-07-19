"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Mic, MicOff, Clock, Users, Radio, CheckCircle2, Loader2, ChevronRight, ChevronLeft, BarChart3, Zap, Volume2 } from "lucide-react";
import { useGdLiveWs, GDLiveWsMessage } from "@/lib/useGdLiveWs";

function formatTime(s: number) {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

interface MemberTile {
  user_id: number;
  name: string | null;
  label: string | null;
  status: "waiting" | "speaking" | "finished";
  muted: boolean;
  speaking: boolean;
}

interface AIStatus {
  grammar?: number;
  fluency?: number;
  confidence?: number;
  vocabulary?: number;
  pronunciation?: number;
  fillers?: number;
  wpm?: number;
  pauses?: number;
  energy?: number;
  professional_tone?: number;
}

interface TeamResult {
  user_id: number;
  name: string | null;
  label: string | null;
  overall_score: number;
  grammar_score: number;
  confidence_score: number;
  fluency_score: number;
  vocabulary_score: number;
  strengths?: string[];
  weaknesses?: string[];
  suggestions?: string[];
}

const COLORS = [
  "from-blue-500 to-blue-700", "from-emerald-500 to-emerald-700", "from-amber-500 to-amber-700",
  "from-purple-500 to-purple-700", "from-rose-500 to-rose-700", "from-cyan-500 to-cyan-700",
  "from-orange-500 to-orange-700", "from-pink-500 to-pink-700",
  "from-teal-500 to-teal-700", "from-indigo-500 to-indigo-700",
];

const GLOW_COLORS = [
  "shadow-blue-500/40", "shadow-emerald-500/40", "shadow-amber-500/40",
  "shadow-purple-500/40", "shadow-rose-500/40", "shadow-cyan-500/40",
  "shadow-orange-500/40", "shadow-pink-500/40",
  "shadow-teal-500/40", "shadow-indigo-500/40",
];

export default function GdLiveRoom({
  sessionCode,
  token,
  user,
  initialTopic,
  initialMembers,
  initialTeams,
  showCountdown,
  onCountdownDone,
  onLeave,
  onEnd,
}: {
  sessionCode: string;
  token: string;
  user: any;
  initialTopic: string;
  initialMembers: any[];
  initialTeams?: any[];
  showCountdown?: boolean;
  onCountdownDone?: () => void;
  onLeave: () => void;
  onEnd: (code: string) => void;
}) {
  const { connected, send, subscribe } = useGdLiveWs(sessionCode, token);
  const [countdown, setCountdown] = useState<number | null>(showCountdown ? 3 : null);
  const [topic, setTopic] = useState(initialTopic);
  const [teamNumber, setTeamNumber] = useState<number | null>(null);
  const [members, setMembers] = useState<MemberTile[]>([]);
  const [speakerId, setSpeakerId] = useState<number | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(180);
  const [timerRunning, setTimerRunning] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [aiStatus, setAiStatus] = useState<AIStatus>({});
  const [allFinished, setAllFinished] = useState(false);
  const [results, setResults] = useState<TeamResult[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [finishedIds, setFinishedIds] = useState<Set<number>>(new Set());
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [uploading, setUploading] = useState(false);

  const userId = user?.user_id ?? user?.id;
  const isAdmin = user?.role === "admin";
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  // Countdown
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      const id = setTimeout(() => { setCountdown(null); onCountdownDone?.(); }, 450);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setCountdown((c) => (c === null ? c : c - 1)), 500);
    return () => clearTimeout(id);
  }, [countdown, onCountdownDone]);

  // Timer tick
  useEffect(() => {
    if (!timerRunning) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      setTimerSeconds((s) => {
        if (s <= 1) {
          if (timerRef.current) clearInterval(timerRef.current!);
          setTimerRunning(false);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning]);

  // Start recording when user becomes speaker
  useEffect(() => {
    if (speakerId === userId && !isRecording && !allFinished && !uploading) {
      startRecording();
    } else if (speakerId !== userId && isRecording) {
      stopRecording();
    }
  }, [speakerId, userId]);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;

      const ctx = new AudioContext();
      audioContextRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const meter = setInterval(() => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setAudioLevel(Math.min(1, avg / 128));
      }, 100);

      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        clearInterval(meter);
        stream.getTracks().forEach((t) => t.stop());
        ctx.close();
        setIsRecording(false);
        setAudioLevel(0);
      };

      recorder.start(1000);
      setIsRecording(true);
    } catch (err) {
      console.warn("Recording start failed:", err);
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }

  async function finishEarly() {
    stopRecording();
    const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
    if (blob.size < 100) {
      send("SPEAKER_FINISHED", { user_id: userId });
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", blob, `gd_${sessionCode}_${userId}.webm`);
      const res = await fetch(`${apiUrl}/gd-live/sessions/${sessionCode}/upload-audio`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (data.transcript) {
        setTranscript((prev) => prev + (prev ? " " : "") + data.transcript);
      }
    } catch (err) {
      console.warn("Audio upload failed:", err);
    } finally {
      setUploading(false);
      send("SPEAKER_FINISHED", { user_id: userId });
    }
  }

  // WS events
  useEffect(() => {
    const unsub = subscribe((msg: GDLiveWsMessage) => {
      switch (msg.event) {
        case "STATE_SYNC":
        case "SESSION_STARTED": {
          const st = msg.payload?.state || msg.payload;
          if (msg.payload?.topic) setTopic(msg.payload.topic);
          // Find my team
          const myTeam = st?.teams ? Object.values(st.teams).find((t: any) =>
            t.members?.some((m: any) => m.user_id === userId)
          ) as any : null;
          if (myTeam) {
            setTeamNumber(myTeam.team_number);
            setMembers(myTeam.members?.map((m: any) => ({
              user_id: m.user_id,
              name: m.name,
              label: m.label,
              status: m.status || "waiting",
              muted: false,
              speaking: false,
            })) || []);
            setSpeakerId(myTeam.speaker_user_id);
            if (myTeam.timer_seconds) setTimerSeconds(myTeam.timer_seconds);
            setTimerRunning(myTeam.timer_running);
            setFinishedIds(new Set(myTeam.finished_user_ids || []));
            setAllFinished(myTeam.all_finished || false);
          }
          break;
        }
        case "TEAM_STATE_UPDATED": {
          const ts = msg.payload;
          setMembers(ts.members || []);
          setSpeakerId(ts.speaker_user_id);
          setTimerSeconds(ts.timer_seconds);
          setTimerRunning(ts.timer_running);
          setFinishedIds(new Set(ts.finished_user_ids || []));
          setAllFinished(ts.all_finished || false);
          break;
        }
        case "SPEAKER_CHANGED": {
          setSpeakerId(msg.payload?.user_id);
          if (msg.payload?.timer_seconds) setTimerSeconds(msg.payload.timer_seconds);
          setTimerRunning(true);
          break;
        }
        case "TRANSCRIPT": {
          const text = msg.payload?.text || "";
          setTranscript((prev) => prev + text);
          break;
        }
        case "AI_EVALUATION": {
          setAiStatus((prev) => ({
            ...prev,
            ...msg.payload,
          }));
          break;
        }
        case "ALL_FINISHED": {
          setAllFinished(true);
          setTimerRunning(false);
          break;
        }
        case "SESSION_RESULTS": {
          setResults(msg.payload?.results || []);
          setShowLeaderboard(true);
          break;
        }
        case "PARTICIPANT_LEFT":
          setMembers((prev) => prev.filter((m) => m.user_id !== msg.payload?.user_id));
          break;
        case "SESSION_ENDED":
          onLeave();
          break;
      }
    });
    return unsub;
  }, [subscribe, userId]);

  const me = members.find((m) => m.user_id === userId);
  const speaker = members.find((m) => m.user_id === speakerId);
  const isMyTurn = speakerId === userId;
  const isFinished = finishedIds.has(userId);

  // Leaderboard / results view with premium styling
  if (showLeaderboard && results.length > 0) {
    const sorted = [...results].sort((a, b) => b.overall_score - a.overall_score);
    const bestSpeaker = sorted[0];
    const mostFluent = [...results].sort((a, b) => b.fluency_score - a.fluency_score)[0];
    const bestVocab = [...results].sort((a, b) => b.vocabulary_score - a.vocabulary_score)[0];
    const highestConf = [...results].sort((a, b) => b.confidence_score - a.confidence_score)[0];

    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--bg)" }}>
        <div className="w-full max-w-3xl space-y-6 animate-fade-up">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-heading flex items-center justify-center gap-2">
              Team {teamNumber}
              <span className="text-lg text-muted-soft font-normal">Results</span>
            </h1>
            <p className="text-muted-soft mt-1">{topic}</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Best Speaker", value: bestSpeaker.label || bestSpeaker.name, icon: <Radio className="w-4 h-4" />, gradient: "from-amber-400 to-orange-500", shadow: "shadow-amber-500/20" },
              { label: "Most Fluent", value: mostFluent.label || mostFluent.name, icon: <Volume2 className="w-4 h-4" />, gradient: "from-emerald-400 to-emerald-600", shadow: "shadow-emerald-500/20" },
              { label: "Best Vocabulary", value: bestVocab.label || bestVocab.name, icon: <BarChart3 className="w-4 h-4" />, gradient: "from-blue-400 to-blue-600", shadow: "shadow-blue-500/20" },
              { label: "Highest Confidence", value: highestConf.label || highestConf.name, icon: <Zap className="w-4 h-4" />, gradient: "from-purple-400 to-purple-600", shadow: "shadow-purple-500/20" },
            ].map((badge, i) => (
              <div key={i} className={`card p-3 text-center backdrop-blur-sm bg-white/5 ${badge.shadow}`}>
                <div className={`flex justify-center mb-1 bg-gradient-to-r ${badge.gradient} bg-clip-text text-transparent`}>{badge.icon}</div>
                <p className="text-[10px] text-muted-soft uppercase tracking-wide">{badge.label}</p>
                <p className="text-sm font-semibold text-heading truncate">{badge.value}</p>
              </div>
            ))}
          </div>

          <div className="card overflow-hidden backdrop-blur-sm bg-white/5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                  <th className="text-left p-3 text-muted-soft font-medium uppercase tracking-wider text-[10px]">Rank</th>
                  <th className="text-left p-3 text-muted-soft font-medium uppercase tracking-wider text-[10px]">Student</th>
                  <th className="text-center p-3 text-muted-soft font-medium uppercase tracking-wider text-[10px]">Overall</th>
                  <th className="text-center p-3 text-muted-soft font-medium uppercase tracking-wider text-[10px]">Grammar</th>
                  <th className="text-center p-3 text-muted-soft font-medium uppercase tracking-wider text-[10px]">Confidence</th>
                  <th className="text-center p-3 text-muted-soft font-medium uppercase tracking-wider text-[10px]">Fluency</th>
                  <th className="text-center p-3 text-muted-soft font-medium uppercase tracking-wider text-[10px]">Vocabulary</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, idx) => (
                  <tr key={r.user_id} className={idx === 0 ? "bg-gradient-to-r from-amber-500/10 to-transparent" : "hover:bg-white/5"} style={{ borderColor: "var(--border)" }}>
                    <td className="p-3">
                      <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold shadow-lg ${
                        idx === 0 ? "bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-amber-500/30" :
                        idx === 1 ? "bg-gradient-to-br from-slate-300 to-slate-500 text-white shadow-slate-500/20" :
                        idx === 2 ? "bg-gradient-to-br from-orange-400 to-orange-600 text-white shadow-orange-500/20" :
                        "surface-2 text-heading"
                      }`}>
                        {idx + 1}
                      </span>
                    </td>
                    <td className="p-3 text-heading font-semibold">{r.label || r.name}</td>
                    <td className="p-3 text-center font-extrabold text-lg text-amber-300">{r.overall_score}%</td>
                    <td className="p-3 text-center text-body">{r.grammar_score}%</td>
                    <td className="p-3 text-center text-body">{r.confidence_score}%</td>
                    <td className="p-3 text-center text-body">{r.fluency_score}%</td>
                    <td className="p-3 text-center text-body">{r.vocabulary_score}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button onClick={onLeave} className="w-full btn-primary py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 border-0 font-semibold shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 transition-shadow">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // ALL_FINISHED awaiting results with premium loading animation
  if (allFinished && !showLeaderboard) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <div className="text-center space-y-6 animate-fade-up">
          <div className="relative inline-flex">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-white" />
            </div>
            <span className="absolute -top-1 -right-1 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500"></span>
            </span>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-heading mb-2">Generating AI Report</h2>
            <p className="text-muted-soft">Analyzing grammar, fluency, vocabulary, and confidence</p>
          </div>
          <div className="flex justify-center gap-1.5">
            {["Grammar", "Fluency", "Confidence", "Vocabulary", "Pronunciation"].map((label, i) => (
              <div key={label} className="px-3 py-1.5 rounded-full text-xs font-medium bg-white/5 text-muted-soft border border-white/10 animate-pulse" style={{ animationDelay: `${i * 200}ms`, animationDuration: "1.5s" }}>
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const isCurrentSpeaker = speakerId === userId;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      {countdown !== null && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-slate-900/95 to-slate-950/95 backdrop-blur-sm">
          <p className="text-sm text-muted-soft mb-8 tracking-[0.2em] uppercase font-medium">Discussion starting</p>
          <div
            key={countdown}
            className={`text-8xl font-extrabold transition-all duration-300 ${
              countdown > 0
                ? "text-transparent bg-clip-text bg-gradient-to-br from-amber-300 via-amber-500 to-orange-600 animate-bounce"
                : "text-emerald-400 scale-110"
            }`}
            style={countdown > 0 ? { animationDuration: "0.6s" } : {}}
          >
            {countdown > 0 ? countdown : <CheckCircle2 className="w-24 h-24" />}
          </div>
          <p className="text-xs text-muted-soft mt-8">
            {countdown > 0 ? "Get ready..." : "Connecting you to the live room..."}
          </p>
        </div>
      )}

      {/* Top bar with glass effect */}
      <header className="flex items-center justify-between px-4 md:px-6 py-3 surface border-b" style={{ borderColor: "var(--border)", backdropFilter: "blur(12px)" }}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-red-500 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20">
            <span className={`w-2 h-2 rounded-full bg-red-500 animate-pulse`} /> LIVE
          </span>
          <span className="text-sm text-muted-soft hidden sm:inline">Team</span>
          <code className="text-sm font-mono font-bold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-md">{teamNumber || "—"}</code>
          <span className="text-sm text-heading font-semibold truncate max-w-[40vw] md:max-w-[50vw]">{topic || "—"}</span>
          <span className="hidden md:flex text-xs text-muted-soft items-center gap-1 px-2 py-1 rounded-full bg-white/5"><Users className="w-3.5 h-3.5" /> {members.length}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`relative flex h-2.5 w-2.5 ${connected ? "" : "opacity-50"}`}>
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${connected ? "bg-emerald-400" : "bg-red-400"} opacity-75`} style={{ animationDuration: "1.5s" }}></span>
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${connected ? "bg-emerald-500" : "bg-red-500"}`}></span>
          </span>
          <button onClick={onLeave} className="relative px-4 py-2 rounded-lg text-white text-sm font-medium border-0 transition-all hover:brightness-110 active:scale-95 flex items-center gap-1.5" style={{ background: "linear-gradient(135deg, #ef4444, #dc2626)" }}>
            Leave
          </button>
        </div>
      </header>

      {/* Current speaker strip with gradient accent */}
      <div className="px-4 md:px-6 py-2.5 flex items-center gap-2.5 surface border-b bg-gradient-to-r from-emerald-500/5 to-transparent" style={{ borderColor: "var(--border)" }}>
        <div className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" style={{ animationDuration: "1.5s" }}></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
        </div>
        <span className="text-sm text-muted-soft">Current Speaker:</span>
        <span className="text-sm font-semibold text-heading">{speaker ? (speaker.label || speaker.name || "Participant") : "—"}</span>
        {isMyTurn && <span className="text-xs px-3 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30 shadow-sm shadow-emerald-500/10">YOUR TURN</span>}
        {isFinished && <span className="text-xs px-3 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-semibold border border-blue-500/30">Finished</span>}
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_340px] overflow-hidden">
        {/* Main area: profile tiles + topic */}
        <div className="flex flex-col overflow-hidden">
          {/* Profile tiles */}
          <div className="flex-1 p-4 md:p-6 overflow-y-auto">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {members.map((m, idx) => {
                const isSpeaking = m.user_id === speakerId;
                const isFinishedMember = finishedIds.has(m.user_id);
                const isMe = m.user_id === userId;
                return (
                  <div
                    key={m.user_id}
                    className={`relative card p-4 flex flex-col items-center text-center transition-all duration-500 ease-out ${
                      isSpeaking
                        ? `ring-2 ring-emerald-400 shadow-xl ${GLOW_COLORS[idx % GLOW_COLORS.length]} scale-[1.04] bg-gradient-to-b from-emerald-500/5 to-transparent`
                        : isFinishedMember
                          ? "ring-1 ring-blue-500/30 opacity-70 scale-[0.97]"
                          : "hover:scale-[1.02]"
                    }`}
                  >
                    {/* Avatar with animated glow ring when speaking */}
                    <div className="relative mb-3">
                      {isSpeaking && (
                        <span className="absolute inset-0 rounded-full animate-ping opacity-30 bg-emerald-400" style={{ animationDuration: "2s" }} />
                      )}
                      <div className={`relative w-16 h-16 rounded-full bg-gradient-to-br ${COLORS[idx % COLORS.length]} flex items-center justify-center text-white text-xl font-bold shadow-lg ${
                        isSpeaking ? "animate-pulse shadow-emerald-400/40" : ""
                      }`}>
                        {(m.label || m.name || "?")[0].toUpperCase()}
                      </div>
                    </div>
                    {/* Label */}
                    <p className="text-sm font-semibold text-heading truncate max-w-full">{m.label || m.name || "Participant"}</p>
                    {/* Status badge with glass effect */}
                    <div className="flex items-center gap-1 mt-1">
                      {isSpeaking && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 backdrop-blur-sm border border-emerald-500/20">
                          <Volume2 className="w-3 h-3 animate-pulse" /> Speaking
                        </span>
                      )}
                      {isFinishedMember && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/15 text-blue-300 backdrop-blur-sm border border-blue-500/20">
                          <CheckCircle2 className="w-3 h-3" /> Finished
                        </span>
                      )}
                      {!isSpeaking && !isFinishedMember && (
                        <span className="text-[10px] text-muted-soft italic">Waiting</span>
                      )}
                    </div>
                    {/* Mic icon with animated waves when recording */}
                    <div className="absolute top-2 right-2">
                      {isMe && isRecording ? (
                        <div className="flex items-center gap-1">
                          <span className="relative flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" style={{ animationDuration: "1.2s" }}></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                          </span>
                          <div className="flex items-end h-3 gap-[1.5px]">
                            {[1, 2, 3].map((i) => (
                              <span key={i} className="w-[2px] bg-red-400 rounded-full animate-pulse" style={{
                                height: `${30 + audioLevel * 70 * i}%`,
                                animationDuration: `${0.3 + i * 0.1}s`,
                              }} />
                            ))}
                          </div>
                        </div>
                      ) : (
                        <MicOff className="w-3.5 h-3.5 text-muted-soft/50" />
                      )}
                    </div>
                    {/* Audio level indicator with gradient */}
                    {isMe && isRecording && (
                      <div className="w-full mt-2 h-1 rounded-full bg-gray-700/50 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-100"
                          style={{ width: `${audioLevel * 100}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Controls bar with glass effect */}
          <div className="px-4 md:px-6 py-3 surface border-t flex items-center gap-3 flex-wrap" style={{ borderColor: "var(--border)", backdropFilter: "blur(12px)" }}>
            {/* Timer with glow */}
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl surface-2 shadow-inner">
              <Clock className="w-4 h-4 text-amber-400" />
              <span className="font-mono font-bold text-xl text-heading tabular-nums">{formatTime(timerSeconds)}</span>
              {timerRunning && (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                </span>
              )}
            </div>

            {/* Finish Speaking button (only for current speaker) */}
            {isMyTurn && !isFinished && (
              <button
                onClick={finishEarly}
                disabled={uploading}
                className="relative btn-primary bg-gradient-to-r from-amber-500 via-amber-500 to-orange-600 border-0 flex items-center gap-2 h-12 px-6 text-sm font-semibold disabled:opacity-50 shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 transition-shadow"
              >
                {uploading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-5 h-5" />
                )}
                {uploading ? "Transcribing & Evaluating..." : "Finish Speaking"}
              </button>
            )}

            {/* Waiting indicator with dots animation */}
            {!isMyTurn && !isFinished && (
              <span className="text-sm text-muted-soft flex items-center gap-1.5">
                <span className="flex gap-1">
                  <span className="w-1 h-1 rounded-full bg-muted-soft animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1 h-1 rounded-full bg-muted-soft animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1 h-1 rounded-full bg-muted-soft animate-bounce" style={{ animationDelay: "300ms" }} />
                </span>
                Waiting for your turn...
              </span>
            )}

            {/* Finished waiting for others */}
            {isFinished && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20">
                <CheckCircle2 className="w-4 h-4 text-blue-400" />
                <span className="text-sm text-blue-300">Finished. Waiting for team...</span>
              </div>
            )}
          </div>
        </div>

        {/* Right panel: Transcript + AI Feedback with glass effect */}
        <aside className="surface border-l overflow-y-auto flex flex-col" style={{ borderColor: "var(--border)", backdropFilter: "blur(8px)" }}>
          {/* Transcript with gradient border accent */}
          <div className="flex-1 p-4 overflow-y-auto relative">
            <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent" />
            <h3 className="text-xs uppercase tracking-wide text-muted-soft mb-3 flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" style={{ animationDuration: "2s" }}></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              Live Transcript
            </h3>
            <div className="space-y-2">
              {transcript ? (
                <p className="text-sm text-body leading-relaxed whitespace-pre-wrap">{transcript}</p>
              ) : (
                <p className="text-xs text-muted-soft italic flex items-center gap-1">
                  <span className="flex gap-0.5">
                    <span className="w-1 h-1 rounded-full bg-muted-soft animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1 h-1 rounded-full bg-muted-soft animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1 h-1 rounded-full bg-muted-soft animate-bounce" style={{ animationDelay: "300ms" }} />
                  </span>
                  Waiting for speech...
                </p>
              )}
            </div>
          </div>

          {/* Divider with gradient */}
          <div className="border-t mx-4" style={{ borderColor: "var(--border)" }} />

          {/* AI Live Feedback with premium styling */}
          <div className="p-4 space-y-3 relative">
            <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-amber-500/20 to-transparent" />
            <h3 className="text-xs uppercase tracking-wide text-muted-soft flex items-center gap-1.5">
              <div className="w-4 h-4 rounded-full bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center">
                <Zap className="w-2.5 h-2.5 text-white" />
              </div>
              Live AI Analysis
            </h3>
            <div className="space-y-2">
              {[
                { label: "Grammar", value: aiStatus.grammar, gradient: "from-emerald-400 to-emerald-600" },
                { label: "Fluency", value: aiStatus.fluency, gradient: "from-blue-400 to-blue-600" },
                { label: "Confidence", value: aiStatus.confidence, gradient: "from-purple-400 to-purple-600" },
                { label: "Vocabulary", value: aiStatus.vocabulary, gradient: "from-amber-400 to-amber-600" },
                { label: "Pronunciation", value: aiStatus.pronunciation, gradient: "from-rose-400 to-rose-600" },
              ].map((metric) => (
                <div key={metric.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-soft">{metric.label}</span>
                    <span className="text-heading font-semibold">{metric.value ?? "—"}{metric.value !== undefined ? "%" : ""}</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-gray-700/50 overflow-hidden">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${metric.gradient} transition-all duration-700 ease-out`}
                      style={{ width: `${metric.value ?? 0}%` }}
                    />
                  </div>
                </div>
              ))}

              {/* Additional metrics */}
              <div className="grid grid-cols-2 gap-2 pt-2">
                {aiStatus.fillers !== undefined && (
                  <div className="card p-2 text-center backdrop-blur-sm bg-white/5">
                    <p className="text-[10px] text-muted-soft uppercase tracking-wide">Fillers</p>
                    <p className="text-lg font-bold text-heading">{aiStatus.fillers}</p>
                  </div>
                )}
                {aiStatus.wpm !== undefined && (
                  <div className="card p-2 text-center backdrop-blur-sm bg-white/5">
                    <p className="text-[10px] text-muted-soft uppercase tracking-wide">Words/Min</p>
                    <p className="text-lg font-bold text-heading">{aiStatus.wpm}</p>
                  </div>
                )}
                {aiStatus.pauses !== undefined && (
                  <div className="card p-2 text-center backdrop-blur-sm bg-white/5">
                    <p className="text-[10px] text-muted-soft uppercase tracking-wide">Pauses</p>
                    <p className="text-lg font-bold text-heading">{aiStatus.pauses}</p>
                  </div>
                )}
                {aiStatus.energy !== undefined && (
                  <div className="card p-2 text-center backdrop-blur-sm bg-white/5">
                    <p className="text-[10px] text-muted-soft uppercase tracking-wide">Energy</p>
                    <p className="text-lg font-bold text-heading">{Math.round(aiStatus.energy)}%</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
