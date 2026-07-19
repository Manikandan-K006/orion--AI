"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Clock, Users, CheckCircle2, Loader2, BarChart3, Zap, Flag, Medal, Play, Volume2, Brain } from "lucide-react";
import { useGdLiveWs, GDLiveWsMessage } from "@/lib/useGdLiveWs";
import { useVoiceAnnouncement } from "@/services/voice/useVoiceAnnouncement";

function formatTime(s: number) {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

interface AIResult {
  overridden?: number;
  grammar?: number;
  fluency?: number;
  confidence?: number;
  vocabulary?: number;
  pronunciation?: number;
}

const COLORS = [
  "from-blue-500 to-blue-700", "from-emerald-500 to-emerald-700", "from-amber-500 to-amber-700",
  "from-purple-500 to-purple-700", "from-rose-500 to-rose-700", "from-cyan-500 to-cyan-700",
  "from-orange-500 to-orange-700", "from-pink-500 to-pink-700",
  "from-teal-500 to-teal-700", "from-indigo-500 to-indigo-700",
];

export default function GdLiveRoom({
  sessionCode, token, user, initialTopic, initialMembers, initialTeams,
  showCountdown, onCountdownDone, onLeave,
}: {
  sessionCode: string; token: string; user: any; initialTopic: string;
  initialMembers: any[]; initialTeams?: any[];
  showCountdown?: boolean; onCountdownDone?: () => void;
  onLeave: () => void;
}) {
  const { connected, send, subscribe } = useGdLiveWs(sessionCode, token);
  const [countdown, setCountdown] = useState<number | null>(showCountdown ? 3 : null);
  const [topic, setTopic] = useState(initialTopic);
  const [teamNumber, setTeamNumber] = useState<number | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [finishedIds, setFinishedIds] = useState<Set<number>>(new Set());
  const [allFinished, setAllFinished] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(600);
  const [timerRunning, setTimerRunning] = useState(false);
  const [discussionStarted, setDiscussionStarted] = useState(false);
  const [thinkingPhase, setThinkingPhase] = useState(false);
  const [thinkingSeconds, setThinkingSeconds] = useState(120);
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [aiResult, setAiResult] = useState<AIResult | null>(null);
  const [results, setResults] = useState<any[]>([]);
  const [myResult, setMyResult] = useState<any>(null);
  const [myRank, setMyRank] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [uploading, setUploading] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const userId = user?.user_id ?? user?.id;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const voice = useVoiceAnnouncement();
  const announcedMarkers = useRef<Set<string>>(new Set());
  const finishingRef = useRef(false);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) { const id = setTimeout(() => { setCountdown(null); onCountdownDone?.(); }, 450); return () => clearTimeout(id); }
    const id = setTimeout(() => setCountdown((c) => (c === null ? c : c - 1)), 500);
    return () => clearTimeout(id);
  }, [countdown, onCountdownDone]);

  // Timer countdown
  useEffect(() => {
    if (!timerRunning) { if (timerRef.current) clearInterval(timerRef.current); return; }
    timerRef.current = setInterval(() => {
      setTimerSeconds((s) => {
        if (s <= 1) {
          if (timerRef.current) clearInterval(timerRef.current!);
          setTimerRunning(false);
          voice.announceTimeOver();
          return 0;
        }
        if (s === 61 && !announcedMarkers.current.has("60")) {
          announcedMarkers.current.add("60");
          voice.announceOneMinute();
        }
        if (s === 31 && !announcedMarkers.current.has("30")) {
          announcedMarkers.current.add("30");
          voice.announceThirtySeconds();
        }
        if (s === 11 && !announcedMarkers.current.has("10")) {
          announcedMarkers.current.add("10");
          voice.announceTenSeconds();
        }
        return s - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning]);

  // Thinking timer countdown (2 minutes)
  useEffect(() => {
    if (!thinkingPhase) { if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current); return; }
    thinkingTimerRef.current = setInterval(() => {
      setThinkingSeconds((s) => {
        if (s <= 1) {
          if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
          beginDiscussion();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => { if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current); };
  }, [thinkingPhase]);

  // Stop recording when timer stops (auto-finish or manual)
  useEffect(() => {
    if (!timerRunning && isRecording) {
      stopRecording();
    }
  }, [timerRunning]);

  // Auto-finish when timer expires
  useEffect(() => {
    if (timerRunning || timerSeconds > 0 || !discussionStarted || finishingRef.current) return;
    if (myFinished || allFinished) return;
    finishingRef.current = true;
    finishDiscussion();
  }, [timerSeconds, timerRunning, discussionStarted]);

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
      setInterval(() => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setAudioLevel(Math.min(1, avg / 128));
      }, 100);

      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop()); ctx.close();
        setIsRecording(false); setAudioLevel(0);
      };
      recorder.start(1000);
      setIsRecording(true);
      voice.announceRecordingStarted();
    } catch (err) { console.warn("Recording start failed:", err); }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      voice.announceRecordingStopped();
    }
  }

  function startDiscussion() {
    setDiscussionStarted(true);
    setThinkingPhase(true);
    setThinkingSeconds(120);
    voice.announceDiscussionStarted();
    setTimeout(() => voice.announceTopic(topic), 2000);
  }

  function beginDiscussion() {
    if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
    setThinkingPhase(false);
    setTimerRunning(true);
    startRecording();
    voice.announceBeginSpeaking();
  }

  async function finishDiscussion() {
    stopRecording();
    const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
    setUploading(true);
    let finalTranscript = transcript;
    if (blob.size >= 100) {
      try {
        const formData = new FormData();
        formData.append("file", blob, `gd_${sessionCode}_${userId}.webm`);
        const res = await fetch(`${apiUrl}/gd-live/sessions/${sessionCode}/upload-audio`, {
          method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData,
        });
        const data = await res.json();
        if (data.transcript) {
          finalTranscript = data.transcript;
          setTranscript(finalTranscript);
        }
        if (data.evaluation) {
          setAiResult(data.evaluation);
        }
      } catch (err) { console.warn("Audio upload failed:", err); }
    }
    setUploading(false);
    send("SPEAKER_FINISHED", { user_id: userId });
    voice.announceFinishEarly();
  }

  useEffect(() => {
    const unsub = subscribe((msg: GDLiveWsMessage) => {
      switch (msg.event) {
        case "STATE_SYNC":
        case "SESSION_STARTED": {
          const st = msg.payload?.state || msg.payload;
          if (msg.payload?.topic) setTopic(msg.payload.topic);
          const myTeam = st?.teams ? Object.values(st.teams).find((t: any) =>
            t.members?.some((m: any) => m.user_id === userId)
          ) as any : null;
          if (myTeam) {
            setTeamNumber(myTeam.team_number);
            setMembers(myTeam.members || []);
            if (myTeam.timer_seconds) setTimerSeconds(myTeam.timer_seconds);
            setFinishedIds(new Set(myTeam.finished_user_ids || []));
            setAllFinished(myTeam.all_finished || false);
            if (!announcedMarkers.current.has("welcome")) {
              announcedMarkers.current.add("welcome");
              voice.announceDiscussionStart();
              setTimeout(() => voice.announceTopic(topic || myTeam.topic || ""), 3000);
              announcedMarkers.current.add("start");
            }
          }
          break;
        }
        case "TEAM_STATE_UPDATED": {
          const ts = msg.payload;
          setMembers(ts.members || []);
          setTimerSeconds(ts.timer_seconds);
          setFinishedIds(new Set(ts.finished_user_ids || []));
          setAllFinished(ts.all_finished || false);
          break;
        }
        case "TIMER_UPDATED":
          setTimerSeconds(msg.payload?.seconds ?? 600);
          setTimerRunning(!!msg.payload?.running);
          break;
        case "TRANSCRIPT":
          setTranscript((prev) => prev + (msg.payload?.text || ""));
          break;
        case "AI_EVALUATION":
          if (msg.payload?.user_id === userId) {
            setAiResult(msg.payload);
          }
          break;
        case "ALL_FINISHED":
          setAllFinished(true);
          setTimerRunning(false);
          voice.announceAllFinished();
          break;
        case "SESSION_RESULTS": {
          const all = msg.payload?.results || [];
          setResults(all);
          const sorted = [...all].sort((a, b) => b.overall_score - a.overall_score);
          const myIdx = sorted.findIndex((r: any) => r.user_id === userId);
          if (myIdx >= 0) {
            setMyResult(sorted[myIdx]);
            setMyRank(myIdx + 1);
          }
          setShowResults(true);
          voice.announceEvaluationComplete();
          setTimeout(() => voice.announceLeaderboardReady(), 2500);
          break;
        }
        case "PARTICIPANT_LEFT":
          setMembers((prev) => prev.filter((m: any) => m.user_id !== msg.payload?.user_id));
          break;
        case "SESSION_ENDED":
          onLeave();
          break;
      }
    });
    return unsub;
  }, [subscribe, userId]);

  const myFinished = finishedIds.has(userId);
  const me = members.find((m: any) => m.user_id === userId);

  // Connection lost / restored announcements
  useEffect(() => {
    if (!connected && announcedMarkers.current.has("connected")) {
      announcedMarkers.current.delete("connected");
      voice.announceConnectionLost();
    } else if (connected && !announcedMarkers.current.has("connected")) {
      announcedMarkers.current.add("connected");
      if (announcedMarkers.current.size > 1) voice.announceReconnected();
    }
  }, [connected]);

  // ── Results View ──
  if (showResults && myResult) {
    const sorted = [...results].sort((a: any, b: any) => b.overall_score - a.overall_score);
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--bg)" }}>
        <div className="w-full max-w-lg space-y-6 animate-fade-up">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-heading">Your Results</h1>
            <p className="text-muted-soft mt-1">Team {teamNumber} · {topic}</p>
          </div>

          {/* Rank badge */}
          <div className="flex justify-center">
            <div className="inline-flex flex-col items-center gap-2 p-6 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-600/10 border border-amber-500/30">
              <Medal className={`w-10 h-10 ${myRank === 1 ? "text-amber-400" : myRank === 2 ? "text-slate-300" : "text-orange-400"}`} />
              <p className="text-sm text-muted-soft">Team Rank</p>
              <p className="text-4xl font-extrabold text-heading">#{myRank} <span className="text-lg text-muted-soft font-normal">of {sorted.length}</span></p>
            </div>
          </div>

          {/* Personal scores */}
          <div className="card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-heading flex items-center gap-1"><Zap className="w-4 h-4 text-amber-400" /> AI Assessment</h3>
            <div className="text-center mb-3">
              <p className="text-4xl font-extrabold text-amber-300">{myResult.overall_score}%</p>
              <p className="text-xs text-muted-soft">Overall Score</p>
            </div>
            {[
              { label: "Grammar", value: myResult.grammar_score, gradient: "from-emerald-400 to-emerald-600" },
              { label: "Fluency", value: myResult.fluency_score, gradient: "from-blue-400 to-blue-600" },
              { label: "Confidence", value: myResult.confidence_score, gradient: "from-purple-400 to-purple-600" },
              { label: "Vocabulary", value: myResult.vocabulary_score, gradient: "from-amber-400 to-amber-600" },
              { label: "Pronunciation", value: myResult.pronunciation_score, gradient: "from-rose-400 to-rose-600" },
            ].map((m) => (
              <div key={m.label} className="flex items-center gap-3">
                <span className="text-sm text-muted-soft w-24 shrink-0">{m.label}</span>
                <div className="flex-1 h-2 rounded-full bg-gray-700/50 overflow-hidden">
                  <div className={`h-full rounded-full bg-gradient-to-r ${m.gradient} transition-all duration-700`} style={{ width: `${m.value}%` }} />
                </div>
                <span className="text-sm font-semibold text-heading w-12 text-right">{m.value}%</span>
              </div>
            ))}
          </div>

          {/* Transcript */}
          {transcript && (
            <div className="card p-4">
              <h3 className="text-xs uppercase tracking-wide text-muted-soft mb-2">Your Transcript</h3>
              <p className="text-sm text-body leading-relaxed whitespace-pre-wrap">{transcript}</p>
            </div>
          )}

          {/* Team ranking */}
          <div className="card overflow-hidden">
            <h3 className="text-sm font-semibold text-heading p-4 pb-2 flex items-center gap-1"><BarChart3 className="w-4 h-4 text-amber-400" /> Team Rankings</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                  <th className="text-left p-3 text-muted-soft text-[10px] uppercase tracking-wider">Rank</th>
                  <th className="text-left p-3 text-muted-soft text-[10px] uppercase tracking-wider">Member</th>
                  <th className="text-center p-3 text-muted-soft text-[10px] uppercase tracking-wider">Overall</th>
                  <th className="text-center p-3 text-muted-soft text-[10px] uppercase tracking-wider">Grammar</th>
                  <th className="text-center p-3 text-muted-soft text-[10px] uppercase tracking-wider">Fluency</th>
                  <th className="text-center p-3 text-muted-soft text-[10px] uppercase tracking-wider">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r: any, idx: number) => {
                  const isMe = r.user_id === userId;
                  return (
                    <tr key={r.user_id} className={isMe ? "bg-amber-500/10" : "hover:bg-white/5"} style={{ borderColor: "var(--border)" }}>
                      <td className="p-3">
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                          idx === 0 ? "bg-amber-500 text-white" : idx === 1 ? "bg-slate-400 text-white" : idx === 2 ? "bg-orange-500 text-white" : "surface-2 text-heading"
                        }`}>{idx + 1}</span>
                      </td>
                      <td className="p-3 text-heading font-medium">
                        {r.label || r.name}
                        {isMe && <span className="ml-1.5 text-[10px] text-amber-300">(You)</span>}
                      </td>
                      <td className="p-3 text-center font-bold text-heading">{r.overall_score}%</td>
                      <td className="p-3 text-center text-body">{r.grammar_score}%</td>
                      <td className="p-3 text-center text-body">{r.fluency_score}%</td>
                      <td className="p-3 text-center text-body">{r.confidence_score}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button onClick={onLeave} className="w-full btn-primary py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 border-0 font-semibold shadow-lg shadow-amber-500/25">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // ── ALL Finished / Awaiting Results ──
  if (allFinished && !showResults) {
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
        </div>
      </div>
    );
  }

  // ── Waiting for Others ──
  if (myFinished && !allFinished) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
        <header className="flex items-center justify-between px-4 md:px-6 py-3 surface border-b" style={{ borderColor: "var(--border)", backdropFilter: "blur(12px)" }}>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-500 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-500" /> FINISHED
            </span>
            <span className="text-sm text-heading font-semibold truncate max-w-[50vw]">{topic || "—"}</span>
          </div>
          <button onClick={onLeave} className="px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ background: "linear-gradient(135deg, #ef4444, #dc2626)" }}>
            Leave
          </button>
        </header>

        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-6 max-w-md px-4">
            <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-blue-400 to-purple-600 flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-heading">Your discussion has been submitted successfully.</h2>
            <p className="text-muted-soft">Waiting for the remaining team members to complete their discussion.</p>
            <p className="text-xs text-muted-soft">AI evaluation will begin automatically once everyone has finished.</p>
            <div className="flex justify-center gap-2">
              {members.filter((m: any) => !finishedIds.has(m.user_id)).map((m: any, idx: number) => (
                <div key={m.user_id} className="flex flex-col items-center gap-1 animate-pulse" style={{ animationDelay: `${idx * 200}ms` }}>
                  <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${COLORS[idx % COLORS.length]} flex items-center justify-center text-white text-sm font-bold`}>
                    {(m.label || m.name || "?")[0]}
                  </div>
                  <span className="text-[10px] text-muted-soft">{m.label || m.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <footer className="px-4 md:px-6 py-3 surface border-t text-center" style={{ borderColor: "var(--border)" }}>
          <p className="text-xs text-muted-soft">
            {members.filter((m: any) => finishedIds.has(m.user_id)).length} / {members.length} finished
          </p>
        </footer>
      </div>
    );
  }

  // ── Countdown Overlay ──
  if (countdown !== null) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-slate-900/95 to-slate-950/95 backdrop-blur-sm">
        <p className="text-sm text-muted-soft mb-8 tracking-[0.2em] uppercase font-medium">Discussion starting</p>
        <div key={countdown} className={`text-8xl font-extrabold transition-all duration-300 ${countdown > 0 ? "text-transparent bg-clip-text bg-gradient-to-br from-amber-300 via-amber-500 to-orange-600 animate-bounce" : "text-emerald-400 scale-110"}`} style={countdown > 0 ? { animationDuration: "0.6s" } : {}}>
          {countdown > 0 ? countdown : <CheckCircle2 className="w-24 h-24" />}
        </div>
        <p className="text-xs text-muted-soft mt-8">{countdown > 0 ? "Get ready..." : "Connecting you to the live room..."}</p>
      </div>
    );
  }

  // ── Waiting / Start Discussion Screen (before user clicks Start) ──
  if (!discussionStarted && !myFinished) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
        <header className="flex items-center justify-between px-4 md:px-6 py-3 surface border-b" style={{ borderColor: "var(--border)", backdropFilter: "blur(12px)" }}>
          <div className="flex items-center gap-3">
            <code className="text-sm font-mono font-bold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-md">{teamNumber || "—"}</code>
            <span className="text-sm text-heading font-semibold truncate max-w-[50vw]">{topic || "—"}</span>
            <span className="hidden md:flex text-xs text-muted-soft items-center gap-1 px-2 py-1 rounded-full bg-white/5">
              <Users className="w-3.5 h-3.5" /> {members.length}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${connected ? "bg-emerald-400" : "bg-red-400"} opacity-75`} style={{ animationDuration: "1.5s" }} />
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${connected ? "bg-emerald-500" : "bg-red-500"}`} />
            </span>
          </div>
        </header>

        <div className="flex-1 flex items-center justify-center p-4 md:p-8">
          <div className="w-full max-w-lg space-y-8 animate-fade-up">
            {/* Topic card */}
            <div className="card p-6 text-center space-y-2">
              <p className="text-xs uppercase tracking-wider text-muted-soft font-semibold">Discussion Topic</p>
              <p className="text-xl md:text-2xl font-bold text-heading leading-snug">{topic || "—"}</p>
            </div>

            {/* Duration */}
            <div className="flex items-center justify-center gap-4">
              <div className="flex items-center gap-2 px-5 py-3 rounded-xl surface-2">
                <Clock className="w-5 h-5 text-amber-400" />
                <span className="font-mono font-bold text-2xl text-heading tabular-nums tracking-wider">{formatTime(timerSeconds)}</span>
              </div>
            </div>

            {/* Mic status */}
            <div className="flex items-center justify-center gap-2">
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/20">
                <MicOff className="w-4 h-4 text-amber-400" />
                <span className="text-sm text-amber-300 font-medium">Microphone Ready</span>
              </div>
            </div>

            {/* Instructions */}
            <div className="card p-5 space-y-2">
              <p className="text-xs uppercase tracking-wider text-muted-soft font-semibold">Instructions</p>
              <ul className="space-y-1.5 text-sm text-body">
                <li className="flex items-start gap-2">
                  <span className="mt-1 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <span>Read the topic carefully before beginning.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <span>Speak naturally and stay on the given topic.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <span>Finish within 10 minutes.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <span>Click <strong>Start Discussion</strong> when you are ready.</span>
                </li>
              </ul>
            </div>

            {/* Start button */}
            <button
              onClick={startDiscussion}
              className="w-full btn-primary bg-gradient-to-r from-amber-500 via-amber-500 to-orange-600 border-0 flex items-center justify-center gap-3 h-14 text-base font-bold shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 transition-all active:scale-[0.97] rounded-2xl"
            >
              <Play className="w-6 h-6" />
              Start Discussion
            </button>
          </div>
        </div>

        <footer className="px-4 md:px-6 py-3 surface border-t text-center" style={{ borderColor: "var(--border)" }}>
          <p className="text-xs text-muted-soft">
            {members.length} member{members.length !== 1 ? "s" : ""} assigned
          </p>
        </footer>
      </div>
    );
  }

  // ── Thinking Phase (2 min preparation) ──
  if (thinkingPhase && !myFinished) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
        <header className="flex items-center justify-between px-4 md:px-6 py-3 surface border-b" style={{ borderColor: "var(--border)", backdropFilter: "blur(12px)" }}>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-blue-500 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20">
              <Brain className="w-3.5 h-3.5" /> THINKING
            </span>
            <code className="text-sm font-mono font-bold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-md">{teamNumber || "—"}</code>
            <span className="text-sm text-heading font-semibold truncate max-w-[50vw]">{topic || "—"}</span>
            <span className="hidden md:flex text-xs text-muted-soft items-center gap-1 px-2 py-1 rounded-full bg-white/5">
              <Users className="w-3.5 h-3.5" /> {members.length}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${connected ? "bg-emerald-400" : "bg-red-400"} opacity-75`} style={{ animationDuration: "1.5s" }} />
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${connected ? "bg-emerald-500" : "bg-red-500"}`} />
            </span>
          </div>
        </header>

        <div className="flex-1 flex items-center justify-center p-4 md:p-8">
          <div className="w-full max-w-lg space-y-8 animate-fade-up text-center">
            {/* Brain icon */}
            <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-blue-400 to-purple-600 flex items-center justify-center">
              <Brain className="w-8 h-8 text-white" />
            </div>

            {/* Thinking timer */}
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-soft font-semibold mb-2">Preparation Time</p>
              <div className="inline-flex items-center gap-3 px-6 py-3 rounded-2xl surface-2 shadow-inner">
                <Clock className="w-6 h-6 text-blue-400" />
                <span className="font-mono font-bold text-5xl text-heading tabular-nums tracking-wider">{formatTime(thinkingSeconds)}</span>
              </div>
            </div>

            {/* Topic reminder */}
            <div className="card p-5 space-y-2">
              <p className="text-xs uppercase tracking-wider text-muted-soft font-semibold">Discussion Topic</p>
              <p className="text-lg md:text-xl font-bold text-heading leading-snug">{topic || "—"}</p>
            </div>

            {/* Instructions */}
            <div className="card p-4 space-y-2">
              <p className="text-xs uppercase tracking-wider text-muted-soft font-semibold">Prepare Your Thoughts</p>
              <ul className="space-y-1.5 text-sm text-body text-left">
                <li className="flex items-start gap-2">
                  <span className="mt-1 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                  <span>Think about your opening statement and key points.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                  <span>Structure your arguments logically.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                  <span>You have <strong>2 minutes</strong> to prepare.</span>
                </li>
              </ul>
            </div>

            {/* Start Speaking button */}
            <button
              onClick={beginDiscussion}
              className="w-full btn-primary bg-gradient-to-r from-emerald-500 via-emerald-500 to-green-600 border-0 flex items-center justify-center gap-3 h-14 text-base font-bold shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 transition-all active:scale-[0.97] rounded-2xl"
            >
              <Play className="w-6 h-6" />
              Start Speaking
            </button>
            <p className="text-xs text-muted-soft -mt-4">You can start speaking before the timer ends</p>
          </div>
        </div>

        <footer className="px-4 md:px-6 py-3 surface border-t text-center" style={{ borderColor: "var(--border)" }}>
          <p className="text-xs text-muted-soft">
            {members.length} member{members.length !== 1 ? "s" : ""} assigned
          </p>
        </footer>
      </div>
    );
  }

  // ── Active Discussion Screen ──
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <header className="flex items-center justify-between px-4 md:px-6 py-3 surface border-b" style={{ borderColor: "var(--border)", backdropFilter: "blur(12px)" }}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-red-500 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> LIVE
          </span>
          <code className="text-sm font-mono font-bold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-md">{teamNumber || "—"}</code>
          <span className="text-sm text-heading font-semibold truncate max-w-[40vw]">{topic || "—"}</span>
          <span className="hidden md:flex text-xs text-muted-soft items-center gap-1 px-2 py-1 rounded-full bg-white/5">
            <Users className="w-3.5 h-3.5" /> {members.length}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${connected ? "bg-emerald-400" : "bg-red-400"} opacity-75`} style={{ animationDuration: "1.5s" }} />
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${connected ? "bg-emerald-500" : "bg-red-500"}`} />
          </span>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-8">
        {/* Timer */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 px-6 py-3 rounded-2xl surface-2 shadow-inner backdrop-blur-sm bg-white/5">
            <Clock className="w-6 h-6 text-amber-400" />
            <span className="font-mono font-bold text-5xl md:text-6xl text-heading tabular-nums tracking-wider">{formatTime(timerSeconds)}</span>
            {timerRunning && (
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
              </span>
            )}
          </div>
        </div>

        {/* Recording status */}
        {!myFinished && (
          <div className="flex items-center gap-3 mb-6">
            {isRecording ? (
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-500/10 border border-red-500/30">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                </span>
                <span className="text-sm text-red-300 font-semibold">Recording</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/20">
                <MicOff className="w-4 h-4 text-amber-400" />
                <span className="text-sm text-amber-300">Mic Ready</span>
              </div>
            )}
            {isRecording && (
              <div className="w-32 h-1.5 rounded-full bg-gray-700/50 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-100" style={{ width: `${audioLevel * 100}%` }} />
              </div>
            )}
          </div>
        )}

        {/* Participants status row */}
        <div className="flex flex-wrap justify-center gap-3 mb-8">
          {members.map((m: any, idx: number) => {
            const done = finishedIds.has(m.user_id);
            const isMe = m.user_id === userId;
            return (
              <div key={m.user_id} className={`flex flex-col items-center gap-1.5 transition-all duration-300 ${done ? "opacity-60 scale-95" : "scale-100"}`}>
                <div className={`relative w-14 h-14 rounded-full bg-gradient-to-br ${COLORS[idx % COLORS.length]} flex items-center justify-center text-white font-bold text-lg shadow-lg ${!done && timerRunning ? "animate-pulse shadow-emerald-500/20" : ""}`}>
                  {(m.label || m.name || "?")[0].toUpperCase()}
                  {done && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                      <CheckCircle2 className="w-3 h-3 text-white" />
                    </span>
                  )}
                </div>
                <span className="text-xs font-semibold text-heading truncate max-w-[80px]">{m.label || m.name}</span>
                {isMe && <span className="text-[10px] text-amber-400 font-semibold">You</span>}
              </div>
            );
          })}
        </div>

        {/* Finish Discussion button */}
        {!myFinished && (
          <button
            onClick={() => { finishingRef.current = true; finishDiscussion(); }}
            disabled={uploading}
            className="relative btn-primary bg-gradient-to-r from-amber-500 via-amber-500 to-orange-600 border-0 flex items-center gap-2 h-14 px-8 text-base font-bold disabled:opacity-50 shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 transition-all active:scale-[0.97] rounded-2xl"
          >
            {uploading ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <Flag className="w-6 h-6" />
            )}
            {uploading ? "Transcribing & Evaluating..." : "Finish Discussion"}
          </button>
        )}
      </div>

      {/* Footer */}
      <footer className="px-4 md:px-6 py-3 surface border-t text-center" style={{ borderColor: "var(--border)" }}>
        <p className="text-xs text-muted-soft">
          {finishedIds.size > 0
            ? `${finishedIds.size} / ${members.length} finished`
            : "All members are recording independently"}
        </p>
      </footer>
    </div>
  );
}
