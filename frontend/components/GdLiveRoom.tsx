"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Clock, Users, Mic, MicOff, Volume2, Brain, AlertTriangle, Maximize2, Medal, BarChart3, Zap, Play, User } from "lucide-react";
import { useGdLiveWs, GDLiveWsMessage } from "@/lib/useGdLiveWs";
import { useVoiceAnnouncement } from "@/services/voice/useVoiceAnnouncement";
import { useProctoring } from "@/services/proctoring/lockdown";

function formatTime(s: number) {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return m + ":" + sec;
}

function anonLabel(m: any, idx: number, uid: number): string {
  if (m.user_id === uid) return "You";
  if (m.label) return m.label;
  return "Member " + (idx + 1);
}

function anonStatus(m: any, uid: number): string {
  if (m.user_id === uid && m.status === "recording") return "You";
  if (m.status === "finished") return "Finished";
  if (m.status === "recording") return "Recording";
  return m.status || "Waiting";
}

const STAGE_LABELS: Record<string, string> = {
  uploading: "Uploading Audio...",
  transcribing: "Transcribing...",
  evaluating: "Analyzing grammar, fluency, and confidence...",
  saving: "Saving results...",
  complete: "Complete!",
};

type SubmitStep = "idle" | "uploading" | "submitted" | "complete";

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
  const [members, setMembers] = useState<any[]>(initialMembers || []);
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
  const [aiResult, setAiResult] = useState<any>(null);
  const [results, setResults] = useState<any[]>([]);
  const [myResult, setMyResult] = useState<any>(null);
  const [myRank, setMyRank] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [submitStep, setSubmitStep] = useState<SubmitStep>("idle");
  const [audioError, setAudioError] = useState("");
  const [evalStage, setEvalStage] = useState("");
  const [generatingStep, setGeneratingStep] = useState<string>("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishLockRef = useRef(false);
  const userId = user?.user_id ?? user?.id;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const voice = useVoiceAnnouncement();
  const announcedMarkers = useRef<Set<string>>(new Set());
  const [showWarning, setShowWarning] = useState<string | null>(null);
  const [warningEvent, setWarningEvent] = useState<string>("");

  const proctoring = useProctoring({
    maxWarnings: 3,
    onWarning: (c, e) => { setShowWarning("Warning " + c + " of 3"); setWarningEvent(e); },
    onTerminated: () => { if (!finishLockRef.current) forceFinish("Rule violation"); },
  });

  const myFinished = finishedIds.has(userId);
  const finishedCount = finishedIds.size;
  const totalMembers = members.length;
  const allDone = totalMembers > 0 && finishedCount >= totalMembers;

  // Countdown effect
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      const id = setTimeout(() => { setCountdown(null); onCountdownDone?.(); }, 450);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setCountdown((c) => (c === null ? c : c - 1)), 500);
    return () => clearTimeout(id);
  }, [countdown, onCountdownDone]);

  // Timer effect
  useEffect(() => {
    if (!timerRunning) { if (timerRef.current) clearInterval(timerRef.current); return; }
    timerRef.current = setInterval(() => {
      setTimerSeconds((s) => {
        if (s <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          setTimerRunning(false);
          voice.announceTimeOver();
          return 0;
        }
        if (s === 61 && !announcedMarkers.current.has("60")) { announcedMarkers.current.add("60"); voice.announceOneMinute(); }
        if (s === 31 && !announcedMarkers.current.has("30")) { announcedMarkers.current.add("30"); voice.announceThirtySeconds(); }
        if (s === 11 && !announcedMarkers.current.has("10")) { announcedMarkers.current.add("10"); voice.announceTenSeconds(); }
        return s - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning]);

  // Thinking timer effect
  useEffect(() => {
    if (!thinkingPhase) { if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current); return; }
    thinkingTimerRef.current = setInterval(() => {
      setThinkingSeconds((s) => {
        if (s <= 1) { if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current); beginDiscussion(); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => { if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current); };
  }, [thinkingPhase]);

  // Auto-stop when timer hits 0
  useEffect(() => {
    if (timerRunning || timerSeconds > 0 || finishLockRef.current) return;
    if (myFinished || allFinished) return;
    executeFinish();
  }, [timerSeconds, timerRunning]);

  // Stop mic when timer stops
  useEffect(() => { if (!timerRunning && isRecording) stopMic(); }, [timerRunning]);

  // Auto-generating screen when all finished and submit is done
  useEffect(() => {
    if (!allDone || submitStep !== "complete") return;
    if (generatingStep) return;
    setGeneratingStep("generating");
    const s1 = setTimeout(() => setGeneratingStep("comparing"), 2000);
    const s2 = setTimeout(() => setGeneratingStep("ranking"), 4000);
    const s3 = setTimeout(() => setGeneratingStep("preparing"), 5500);
    return () => { clearTimeout(s1); clearTimeout(s2); clearTimeout(s3); };
  }, [allDone, submitStep]);

  async function startRecording() {
    try {
      setAudioError("");
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
        stream.getTracks().forEach((t) => t.stop());
        ctx.close();
        setIsRecording(false);
        setAudioLevel(0);
      };
      recorder.start(1000);
      setIsRecording(true);
    } catch (err) {
      setAudioError("Microphone access denied");
      console.warn("Recording start failed:", err);
    }
  }

  function stopMic() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
    }
    mediaRecorderRef.current = null;
    audioStreamRef.current = null;
    audioContextRef.current = null;
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
    proctoring.enable();
    voice.announceBeginSpeaking();
  }

  async function executeFinish() {
    if (finishLockRef.current) return;
    finishLockRef.current = true;
    setTimerRunning(false);
    if (timerRef.current) clearInterval(timerRef.current);
    stopMic();
    proctoring.disable();
    setSubmitStep("uploading");
    const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
    if (blob.size >= 100) {
      try {
        const formData = new FormData();
        formData.append("file", blob, "gd_" + sessionCode + "_" + userId + ".webm");
        const res = await fetch(apiUrl + "/gd-live/sessions/" + sessionCode + "/upload-audio", {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
          body: formData,
        });
        const data = await res.json();
        if (data.transcript) setTranscript(data.transcript);
        if (data.evaluation) setAiResult(data.evaluation);
      } catch (err) {
        console.warn("Upload failed:", err);
      }
    }
    send("SPEAKER_FINISHED", { user_id: userId });
    setSubmitStep("complete");
  }

  function forceFinish(reason: string) {
    if (finishLockRef.current) return;
    finishLockRef.current = true;
    setTimerRunning(false);
    if (timerRef.current) clearInterval(timerRef.current);
    stopMic();
    proctoring.disable();
    const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
    if (blob.size >= 100) {
      const formData = new FormData();
      formData.append("file", blob, "gd_" + sessionCode + "_" + userId + "_terminated.webm");
      fetch(apiUrl + "/gd-live/sessions/" + sessionCode + "/upload-audio", {
        method: "POST", headers: { Authorization: "Bearer " + token }, body: formData,
      }).catch(() => {});
    }
    send("SPEAKER_FINISHED", { user_id: userId, terminated: true, reason: reason });
    setSubmitStep("complete");
  }

  useEffect(() => {
    const unsub = subscribe((msg: GDLiveWsMessage) => {
      switch (msg.event) {
        case "STATE_SYNC":
        case "SESSION_STARTED": {
          const st = msg.payload?.state || msg.payload;
          if (msg.payload?.topic) setTopic(msg.payload.topic);
          const myTeam = st?.teams
            ? Object.values(st.teams).find((t: any) => t.members?.some((m: any) => m.user_id === userId)) as any
            : null;
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
        case "ALL_FINISHED": {
          setAllFinished(true);
          setTimerRunning(false);
          voice.announceAllFinished();
          break;
        }
        case "SESSION_RESULTS": {
          const all = msg.payload?.results || [];
          setResults(all);
          const sorted = [...all].sort((a: any, b: any) => b.overall_score - a.overall_score);
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
        case "EVALUATION_PROGRESS":
          if (msg.payload?.user_id === userId && msg.payload?.stage) {
            setEvalStage(msg.payload.stage);
          }
          break;
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

  useEffect(() => {
    if (!connected && announcedMarkers.current.has("connected")) {
      announcedMarkers.current.delete("connected");
      voice.announceConnectionLost();
    } else if (connected && !announcedMarkers.current.has("connected")) {
      announcedMarkers.current.add("connected");
      if (announcedMarkers.current.size > 1) voice.announceReconnected();
    }
  }, [connected]);

  // ─── RESULTS VIEW ───
  if (showResults && myResult) {
    const sorted = [...results].sort((a: any, b: any) => b.overall_score - a.overall_score);
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--bg)" }}>
        <div className="w-full max-w-lg space-y-6 animate-fade-up">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-heading">Your Results</h1>
            <p className="text-muted-soft mt-1">Team {teamNumber}</p>
          </div>
          <div className="flex justify-center">
            <div className="inline-flex flex-col items-center gap-2 p-6 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-600/10 border border-amber-500/30">
              <Medal className={"w-10 h-10 " + (myRank === 1 ? "text-amber-400" : myRank === 2 ? "text-slate-300" : "text-orange-400")} />
              <p className="text-sm text-muted-soft">Team Rank</p>
              <p className="text-4xl font-extrabold text-heading">#{myRank} <span className="text-lg text-muted-soft font-normal">of {sorted.length}</span></p>
            </div>
          </div>
          <div className="card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-heading flex items-center gap-1"><Zap className="w-4 h-4 text-amber-400" /> AI Assessment</h3>
            <div className="text-center mb-3"><p className="text-4xl font-extrabold text-amber-300">{myResult.overall_score}%</p><p className="text-xs text-muted-soft">Overall Score</p></div>
            {[{ label: "Grammar", value: myResult.grammar_score, g: "from-emerald-400 to-emerald-600" },
              { label: "Fluency", value: myResult.fluency_score, g: "from-blue-400 to-blue-600" },
              { label: "Confidence", value: myResult.confidence_score, g: "from-purple-400 to-purple-600" },
              { label: "Vocabulary", value: myResult.vocabulary_score, g: "from-amber-400 to-amber-600" },
              { label: "Pronunciation", value: myResult.pronunciation_score, g: "from-rose-400 to-rose-600" },
            ].map((m) => (
              <div key={m.label} className="flex items-center gap-3">
                <span className="text-sm text-muted-soft w-24 shrink-0">{m.label}</span>
                <div className="flex-1 h-2 rounded-full bg-gray-700/50 overflow-hidden">
                  <div className={"h-full rounded-full bg-gradient-to-r " + m.g + " transition-all duration-700"} style={{ width: m.value + "%" }} />
                </div>
                <span className="text-sm font-semibold text-heading w-12 text-right">{m.value}%</span>
              </div>
            ))}
          </div>
          {transcript && (
            <div className="card p-4">
              <h3 className="text-xs uppercase tracking-wide text-muted-soft mb-2">Your Transcript</h3>
              <p className="text-sm text-body leading-relaxed whitespace-pre-wrap">{transcript}</p>
            </div>
          )}
          <button onClick={onLeave} className="w-full btn-primary py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 border-0 font-semibold shadow-lg shadow-amber-500/25">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // ─── WAITING VIEW (before discussion starts) ───
  if (!discussionStarted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: "var(--bg)" }}>
        <div className="w-full max-w-lg space-y-8 animate-fade-up text-center">
          <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
            <Volume2 className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-heading">Group Discussion</h1>
          <p className="text-muted-soft">Session {sessionCode}</p>
          <div className="card p-6 space-y-3">
            <h2 className="text-xl font-semibold text-heading">Your Topic</h2>
            <p className="text-lg text-body leading-relaxed">{topic}</p>
            <p className="text-sm text-amber-400 flex items-center justify-center gap-2"><Clock className="w-4 h-4" /> Time: 10 minutes</p>
          </div>
          {members.length > 0 && (
            <div className="card p-4">
              <h3 className="text-xs uppercase tracking-wide text-muted-soft mb-3 flex items-center justify-center gap-1"><Users className="w-3 h-3" /> Team Members</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {members.map((m: any, i: number) => {
                  const label = anonLabel(m, i, userId);
                  return (
                    <div key={m.user_id} className={"p-2.5 rounded-lg text-center text-xs font-semibold " + (label === "You" ? "bg-gradient-to-br from-amber-500 to-orange-600 text-white" : "surface-2 text-heading")}>
                      {label}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <button onClick={startDiscussion}
            className="w-full btn-primary py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 border-0 text-lg font-bold shadow-lg shadow-amber-500/30 hover:shadow-amber-500/50 hover:scale-[1.02] transition-all duration-300 flex items-center justify-center gap-3"
          >
            <Play className="w-6 h-6" /> Start Discussion
          </button>
        </div>
      </div>
    );
  }

  // ─── COUNTDOWN VIEW ───
  if (countdown !== null) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <div className="text-center animate-fade-up">
          <span className="text-[10rem] font-extrabold text-heading tabular-nums" style={{ textShadow: "0 0 80px rgba(251,191,36,0.3)" }}>
            {countdown <= 0 ? "Go!" : countdown}
          </span>
        </div>
      </div>
    );
  }

  // ─── THINKING VIEW ───
  if (thinkingPhase) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: "var(--bg)" }}>
        <div className="w-full max-w-lg space-y-8 animate-fade-up text-center">
          <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-purple-500 to-amber-600 flex items-center justify-center animate-pulse">
            <Brain className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-heading">Prepare Your Thoughts</h1>
          <p className="text-muted-soft mt-2">You have time to think and structure your points</p>
          <div className="card p-6 space-y-3">
            <div className="flex items-center justify-center gap-3">
              <Clock className="w-6 h-6 text-amber-400" />
              <span className="text-4xl font-bold tabular-nums text-heading">{formatTime(thinkingSeconds)}</span>
            </div>
            <p className="text-xs text-muted-soft">remaining to prepare</p>
          </div>
          <button onClick={beginDiscussion}
            className="w-full btn-primary py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 border-0 text-lg font-bold shadow-lg shadow-amber-500/30 hover:shadow-amber-500/50 transition-all"
          >
            Start Speaking <Mic className="w-5 h-5 inline ml-1" />
          </button>
        </div>
      </div>
    );
  }

  // ─── SPEAKING / FINISHED VIEW ───
  const warnModal = showWarning ? (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => { setShowWarning(null); proctoring.dismissWarning(); }}>
      <div className="max-w-sm w-full mx-4 card p-8 text-center space-y-4 animate-fade-up" onClick={(e) => e.stopPropagation()}>
        <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center"><AlertTriangle className="w-8 h-8 text-white" /></div>
        <h2 className="text-xl font-bold text-heading">{showWarning}</h2>
        <p className="text-sm text-muted-soft">Please stay inside the discussion window.</p>
        <button onClick={() => { setShowWarning(null); proctoring.dismissWarning(); }} className="btn-primary bg-gradient-to-r from-amber-500 to-orange-600 border-0 px-8 py-2 rounded-xl font-semibold">Continue</button>
      </div>
    </div>
  ) : null;

  // Fullscreen guard
  if (discussionStarted && !thinkingPhase && !myFinished && submitStep === "idle" && !proctoring.isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm">
        <Maximize2 className="w-16 h-16 text-amber-400 mb-6" />
        <h2 className="text-2xl font-bold text-heading mb-2">Enter Fullscreen</h2>
        <p className="text-muted-soft mb-6 text-sm">Fullscreen mode is required for the discussion.</p>
        <button onClick={() => proctoring.enterFullscreen()} className="btn-primary bg-gradient-to-r from-amber-500 to-orange-600 border-0 px-8 py-3 rounded-xl font-bold flex items-center gap-2">
          <Maximize2 className="w-5 h-5" /> Enter Fullscreen
        </button>
      </div>
    );
  }

  // ─── SUBMITTED WAITING SCREEN ───
  if (submitStep !== "idle" && !allDone && generatingStep === "") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: "var(--bg)" }}>
        {warnModal}
        <div className="w-full max-w-lg space-y-6 animate-fade-up text-center">
          <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center">
            <CheckCircle2 className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-heading">Discussion Submitted</h1>
          <p className="text-muted-soft">Thank you. Your discussion has been recorded.</p>
          <p className="text-sm text-muted-soft">Please wait until the remaining team members finish.</p>
          <div className="card p-6 space-y-3">
            <p className="text-lg font-semibold text-heading">{finishedCount} / {totalMembers} Members Finished</p>
            {totalMembers > 0 && (
              <div className="h-2 rounded-full bg-gray-700/50 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-green-500 transition-all duration-500" style={{ width: ((finishedCount / totalMembers) * 100) + "%" }} />
              </div>
            )}
          </div>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-soft">
            <Loader2 className="w-4 h-4 animate-spin" /> {evalStage ? STAGE_LABELS[evalStage] || "Processing..." : "Your AI report is being generated..."}
          </div>
        </div>
      </div>
    );
  }

  // ─── GENERATING REPORT SCREEN ───
  if (generatingStep || (submitStep === "complete" && allDone)) {
    const steps = [
      { key: "generating", label: "Generating Team Analysis..." },
      { key: "comparing", label: "Comparing Discussions..." },
      { key: "ranking", label: "Ranking Members..." },
      { key: "preparing", label: "Preparing Report..." },
    ];
    const currentIdx = generatingStep ? steps.findIndex((s) => s.key === generatingStep) : -1;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: "var(--bg)" }}>
        <div className="w-full max-w-lg space-y-8 animate-fade-up text-center">
          <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
            <Loader2 className="w-12 h-12 text-white animate-spin" />
          </div>
          <h1 className="text-2xl font-bold text-heading">Analyzing Your Discussion</h1>
          <p className="text-muted-soft">Please wait while we process your team discussion.</p>
          <div className="card p-6 space-y-4 text-left">
            {steps.map((s, i) => {
              const done = currentIdx > i;
              const active = currentIdx === i;
              return (
                <div key={s.key} className={"flex items-center gap-3 p-2.5 rounded-lg text-sm transition-all " + (done || active ? "bg-amber-500/10" : "opacity-40")}>
                  <div className={"w-7 h-7 rounded-full flex items-center justify-center " + (done ? "bg-emerald-500 text-white" : active ? "bg-amber-500 text-white" : "surface-2 text-muted-soft")}>
                    {done ? <CheckCircle2 className="w-4 h-4" /> : active ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="text-xs font-bold">{i + 1}</span>}
                  </div>
                  <span className={"font-medium " + (done || active ? "text-heading" : "text-muted-soft")}>{s.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ─── LIVE DISCUSSION VIEW ───
  return (
    <div className="min-h-screen flex flex-col p-4" style={{ background: "var(--bg)" }}>
      {warnModal}
      <div className="max-w-4xl mx-auto w-full space-y-4 flex-1 flex flex-col">
        {/* Header: timer + team info */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-xl font-bold text-heading">Team Discussion</h1>
            <p className="text-xs text-muted-soft truncate max-w-[250px]">{topic}</p>
          </div>
          <div className={"flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-bold tabular-nums " + (timerSeconds <= 30 ? "bg-red-500/20 text-red-400" : "surface-2 text-heading")}>
            <Clock className="w-4 h-4" />
            {formatTime(timerSeconds)}
          </div>
        </div>

        {/* Recording indicator */}
        <div className="flex items-center gap-3 px-3 py-2 rounded-xl surface-2">
          <div className={"flex items-center gap-1.5 text-xs font-medium " + (isRecording ? "text-red-400" : "text-muted-soft")}>
            <span className={"w-2 h-2 rounded-full " + (isRecording ? "bg-red-500 animate-pulse" : "bg-gray-500")} />
            {isRecording ? "Recording" : "Stopped"}
          </div>
          {isRecording && (
            <div className="flex-1 h-1.5 rounded-full bg-gray-700/50 overflow-hidden max-w-[120px]">
              <div className="h-full rounded-full bg-gradient-to-r from-red-500 to-amber-400 transition-all duration-150" style={{ width: (audioLevel * 100) + "%" }} />
            </div>
          )}
          <div className="ml-auto text-xs text-muted-soft">
            {finishedCount}/{totalMembers} finished
          </div>
        </div>

        {/* Anonymous participant cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {members.map((m: any, i: number) => {
            const label = anonLabel(m, i, userId);
            const status = anonStatus(m, userId);
            const done = finishedIds.has(m.user_id);
            const isMe = m.user_id === userId;
            return (
              <div key={m.user_id}
                className={"relative p-3 rounded-xl text-center transition-all duration-500 " + (done ? "border border-emerald-500/40 bg-emerald-500/10" : isMe ? "bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg" : "surface-2 text-heading")}
              >
                {done && <CheckCircle2 className="absolute top-1 right-1 w-4 h-4 text-emerald-400" />}
                <div className="w-10 h-10 mx-auto rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center mb-2">
                  <User className="w-5 h-5 text-white" />
                </div>
                <p className="text-xs font-semibold truncate">{label}</p>
                <p className={"text-[10px] " + (done ? "text-emerald-400" : isMe ? "text-white/80" : "text-muted-soft")}>{done ? "Finished" : status}</p>
              </div>
            );
          })}
        </div>

        {/* Audio level meter */}
        {!myFinished && submitStep === "idle" && (
          <div className="mt-auto pt-4">
            <div className="p-4 rounded-xl surface-2 border" style={{ borderColor: "var(--border)" }}>
              <p className="text-xs text-muted-soft mb-2">Your Audio Level</p>
              <div className="h-6 rounded-full bg-gray-700/30 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-amber-500 to-red-500 transition-all duration-150" style={{ width: (audioLevel * 100) + "%" }} />
              </div>
            </div>
          </div>
        )}

        {/* Finish Discussion button */}
        {!myFinished && submitStep === "idle" && (
          <button onClick={() => executeFinish()}
            className="btn-primary py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 border-0 font-semibold shadow-lg shadow-amber-500/20 hover:shadow-amber-500/40 transition-all"
          >
            Finish Discussion
          </button>
        )}

        {audioError && (
          <div className="text-xs text-red-400 text-center p-2 bg-red-500/10 rounded-lg">{audioError}</div>
        )}
      </div>
    </div>
  );
}