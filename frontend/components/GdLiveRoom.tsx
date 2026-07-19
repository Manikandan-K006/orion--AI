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
  "bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-purple-500",
  "bg-rose-500", "bg-cyan-500", "bg-orange-500", "bg-pink-500",
  "bg-teal-500", "bg-indigo-500",
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

  const userId = user?.user_id ?? user?.id;
  const isAdmin = user?.role === "admin";

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
    if (speakerId === userId && !isRecording && !allFinished) {
      startRecording();
    } else if (speakerId !== userId && isRecording) {
      stopRecording();
    }
  }, [speakerId, userId]);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;

      // Audio level meter
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

      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && send) {
          // Convert to base64 and send as AUDIO_CHUNK
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = reader.result?.toString().split(",")[1];
            if (base64) {
              send("AUDIO_CHUNK", { audio: base64 });
            }
          };
          reader.readAsDataURL(e.data);
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

  function finishEarly() {
    send("SPEAKER_FINISHED", { user_id: userId });
    stopRecording();
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

  // Leaderboard / results view
  if (showLeaderboard && results.length > 0) {
    const sorted = [...results].sort((a, b) => b.overall_score - a.overall_score);
    const bestSpeaker = sorted[0];
    const mostFluent = [...results].sort((a, b) => b.fluency_score - a.fluency_score)[0];
    const bestVocab = [...results].sort((a, b) => b.vocabulary_score - a.vocabulary_score)[0];
    const highestConf = [...results].sort((a, b) => b.confidence_score - a.confidence_score)[0];

    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--bg)" }}>
        <div className="w-full max-w-3xl space-y-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-heading">Team {teamNumber} Results</h1>
            <p className="text-muted-soft mt-1">{topic}</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Best Speaker", value: bestSpeaker.label || bestSpeaker.name, icon: <Radio className="w-4 h-4" />, color: "text-amber-400" },
              { label: "Most Fluent", value: mostFluent.label || mostFluent.name, icon: <Volume2 className="w-4 h-4" />, color: "text-emerald-400" },
              { label: "Best Vocabulary", value: bestVocab.label || bestVocab.name, icon: <BarChart3 className="w-4 h-4" />, color: "text-blue-400" },
              { label: "Highest Confidence", value: highestConf.label || highestConf.name, icon: <Zap className="w-4 h-4" />, color: "text-purple-400" },
            ].map((badge, i) => (
              <div key={i} className="card p-3 text-center">
                <div className={`flex justify-center mb-1 ${badge.color}`}>{badge.icon}</div>
                <p className="text-[10px] text-muted-soft uppercase tracking-wide">{badge.label}</p>
                <p className="text-sm font-semibold text-heading truncate">{badge.value}</p>
              </div>
            ))}
          </div>

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                  <th className="text-left p-3 text-muted-soft font-medium">Rank</th>
                  <th className="text-left p-3 text-muted-soft font-medium">Student</th>
                  <th className="text-center p-3 text-muted-soft font-medium">Overall</th>
                  <th className="text-center p-3 text-muted-soft font-medium">Grammar</th>
                  <th className="text-center p-3 text-muted-soft font-medium">Confidence</th>
                  <th className="text-center p-3 text-muted-soft font-medium">Fluency</th>
                  <th className="text-center p-3 text-muted-soft font-medium">Vocabulary</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, idx) => (
                  <tr key={r.user_id} className={idx === 0 ? "bg-amber-500/10" : ""} style={{ borderColor: "var(--border)" }}>
                    <td className="p-3">
                      <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${idx === 0 ? "bg-amber-500 text-white" : "surface-2 text-heading"}`}>
                        {idx + 1}
                      </span>
                    </td>
                    <td className="p-3 text-heading font-medium">{r.label || r.name}</td>
                    <td className="p-3 text-center font-bold text-heading">{r.overall_score}%</td>
                    <td className="p-3 text-center text-body">{r.grammar_score}%</td>
                    <td className="p-3 text-center text-body">{r.confidence_score}%</td>
                    <td className="p-3 text-center text-body">{r.fluency_score}%</td>
                    <td className="p-3 text-center text-body">{r.vocabulary_score}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button onClick={onLeave} className="w-full btn-primary py-3 rounded-xl">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // ALL_FINISHED awaiting results
  if (allFinished && !showLeaderboard) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 animate-spin text-amber-400 mx-auto" />
          <h2 className="text-2xl font-bold text-heading">Generating AI Report...</h2>
          <p className="text-muted-soft">Analyzing grammar, fluency, vocabulary, and confidence</p>
        </div>
      </div>
    );
  }

  const isCurrentSpeaker = speakerId === userId;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      {countdown !== null && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center" style={{ background: "var(--bg)", backdropFilter: "blur(2px)" }}>
          <p className="text-sm text-muted-soft mb-4 tracking-wide uppercase">Discussion starting</p>
          <div key={countdown} className="text-7xl font-extrabold text-amber-400 animate-ping-once">
            {countdown > 0 ? countdown : "✓"}
          </div>
          <p className="text-xs text-muted-soft mt-6">Connecting you to the live room...</p>
        </div>
      )}

      {/* Top bar */}
      <header className="flex items-center justify-between px-4 md:px-6 py-3 surface border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-red-500">
            <span className={`w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse`} /> LIVE
          </span>
          <span className="text-sm text-muted-soft">Team <code className="font-mono text-amber-300">{teamNumber || "—"}</code></span>
          <span className="text-sm text-heading font-semibold truncate max-w-[50vw]">{topic || "—"}</span>
          <span className="text-xs text-muted-soft flex items-center gap-1"><Users className="w-4 h-4" /> {members.length}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`} />
          <button className="p-2 rounded-lg flex items-center gap-2 px-4 text-white border-0" style={{ background: "#ef4444" }} onClick={onLeave}>
            Leave
          </button>
        </div>
      </header>

      {/* Current speaker strip */}
      <div className="px-4 md:px-6 py-2 flex items-center gap-2 surface border-b" style={{ borderColor: "var(--border)" }}>
        <Radio className="w-4 h-4 text-emerald-400" />
        <span className="text-sm text-muted-soft">Current Speaker:</span>
        <span className="text-sm font-semibold text-heading">{speaker ? (speaker.label || speaker.name || "Participant") : "—"}</span>
        {isMyTurn && <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold">YOUR TURN</span>}
        {isFinished && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-semibold">Finished</span>}
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
                    className={`relative card p-4 flex flex-col items-center text-center transition-all duration-300 ${
                      isSpeaking ? "ring-2 ring-emerald-500 shadow-lg shadow-emerald-500/20 scale-[1.02]" :
                      isFinishedMember ? "ring-1 ring-blue-500/40 opacity-70" : ""
                    }`}
                  >
                    {/* Avatar */}
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold mb-3 ${COLORS[idx % COLORS.length]} ${
                      isSpeaking ? "animate-pulse" : ""
                    }`}>
                      {(m.label || m.name || "?")[0].toUpperCase()}
                    </div>
                    {/* Label */}
                    <p className="text-sm font-semibold text-heading truncate max-w-full">{m.label || m.name || "Participant"}</p>
                    {/* Status badge */}
                    <div className="flex items-center gap-1 mt-1">
                      {isSpeaking && (
                        <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
                          <Volume2 className="w-3 h-3 animate-pulse" /> Speaking
                        </span>
                      )}
                      {isFinishedMember && (
                        <span className="text-[10px] text-blue-400 font-semibold">Finished</span>
                      )}
                      {!isSpeaking && !isFinishedMember && (
                        <span className="text-[10px] text-muted-soft">Waiting</span>
                      )}
                    </div>
                    {/* Mic icon */}
                    <div className="absolute top-2 right-2">
                      {isMe && isRecording ? (
                        <div className="flex items-center gap-1">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                          </span>
                          <Mic className="w-3.5 h-3.5 text-red-400" />
                        </div>
                      ) : (
                        <MicOff className="w-3.5 h-3.5 text-muted-soft" />
                      )}
                    </div>
                    {/* Audio level indicator */}
                    {isMe && isRecording && (
                      <div className="w-full mt-2 h-1 rounded-full bg-gray-700 overflow-hidden">
                        <div className="h-full bg-emerald-500 transition-all duration-100" style={{ width: `${audioLevel * 100}%` }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Controls bar */}
          <div className="px-4 md:px-6 py-3 surface border-t flex items-center gap-3 flex-wrap" style={{ borderColor: "var(--border)" }}>
            {/* Timer */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl surface-2">
              <Clock className="w-4 h-4 text-amber-400" />
              <span className="font-mono font-bold text-lg text-heading">{formatTime(timerSeconds)}</span>
              {timerRunning && <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />}
            </div>

            {/* Finish Speaking button (only for current speaker) */}
            {isMyTurn && !isFinished && (
              <button onClick={finishEarly} className="btn-primary bg-gradient-to-r from-amber-500 to-orange-600 border-0 flex items-center gap-2 h-11 px-5">
                <CheckCircle2 className="w-5 h-5" /> Finish Speaking
              </button>
            )}

            {/* Waiting indicator */}
            {!isMyTurn && !isFinished && (
              <span className="text-sm text-muted-soft italic">Waiting for your turn...</span>
            )}

            {/* Finished waiting for others */}
            {isFinished && (
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-blue-400" />
                <span className="text-sm text-blue-400">You've finished. Waiting for other team members...</span>
              </div>
            )}
          </div>
        </div>

        {/* Right panel: Transcript + AI Feedback */}
        <aside className="surface border-l overflow-y-auto flex flex-col" style={{ borderColor: "var(--border)" }}>
          {/* Transcript */}
          <div className="flex-1 p-4 overflow-y-auto">
            <h3 className="text-xs uppercase tracking-wide text-muted-soft mb-3 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" /> Live Transcript
            </h3>
            <div className="space-y-2">
              {transcript ? (
                <p className="text-sm text-body leading-relaxed whitespace-pre-wrap">{transcript}</p>
              ) : (
                <p className="text-xs text-muted-soft italic">Waiting for speech...</p>
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="border-t" style={{ borderColor: "var(--border)" }} />

          {/* AI Live Feedback */}
          <div className="p-4 space-y-3">
            <h3 className="text-xs uppercase tracking-wide text-muted-soft flex items-center gap-1">
              <Zap className="w-3.5 h-3.5 text-amber-400" /> Live AI Analysis
            </h3>
            <div className="space-y-2">
              {[
                { label: "Grammar", value: aiStatus.grammar, color: "bg-emerald-500" },
                { label: "Fluency", value: aiStatus.fluency, color: "bg-blue-500" },
                { label: "Confidence", value: aiStatus.confidence, color: "bg-purple-500" },
                { label: "Vocabulary", value: aiStatus.vocabulary, color: "bg-amber-500" },
                { label: "Pronunciation", value: aiStatus.pronunciation, color: "bg-rose-500" },
              ].map((metric) => (
                <div key={metric.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-soft">{metric.label}</span>
                    <span className="text-heading font-semibold">{metric.value ?? "—"}{metric.value !== undefined ? "%" : ""}</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-gray-700 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${metric.color}`}
                      style={{ width: `${metric.value ?? 0}%` }}
                    />
                  </div>
                </div>
              ))}

              {/* Additional metrics */}
              <div className="grid grid-cols-2 gap-2 pt-2">
                {aiStatus.fillers !== undefined && (
                  <div className="card p-2 text-center">
                    <p className="text-[10px] text-muted-soft">Fillers</p>
                    <p className="text-lg font-bold text-heading">{aiStatus.fillers}</p>
                  </div>
                )}
                {aiStatus.wpm !== undefined && (
                  <div className="card p-2 text-center">
                    <p className="text-[10px] text-muted-soft">Words/Min</p>
                    <p className="text-lg font-bold text-heading">{aiStatus.wpm}</p>
                  </div>
                )}
                {aiStatus.pauses !== undefined && (
                  <div className="card p-2 text-center">
                    <p className="text-[10px] text-muted-soft">Pauses</p>
                    <p className="text-lg font-bold text-heading">{aiStatus.pauses}</p>
                  </div>
                )}
                {aiStatus.energy !== undefined && (
                  <div className="card p-2 text-center">
                    <p className="text-[10px] text-muted-soft">Energy</p>
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
