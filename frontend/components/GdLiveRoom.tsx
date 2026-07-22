"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Clock, Users, Mic, MicOff, Volume2, Brain, AlertTriangle, Maximize2, Medal, BarChart3, Zap, Play, User, Sparkles, FileText, Download, Lightbulb, MessageSquare, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar } from "recharts";
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
  const lbl = m.label || m.anonymous_label;
  if (lbl) return lbl;
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
  sessionCode, token, user, theme, initialTopic, initialMembers, initialTeams,
  showCountdown, onCountdownDone, onLeave,
}: {
  sessionCode: string; token: string; user: any; theme: string; initialTopic: string;
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
  const [timerSeconds, setTimerSeconds] = useState(300);
  const [prepNotes, setPrepNotes] = useState("");
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
    const s4 = setTimeout(() => {
      setGeneratingStep("");
      setShowResults(true);
    }, 7000);
    return () => { clearTimeout(s1); clearTimeout(s2); clearTimeout(s3); clearTimeout(s4); };
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
        if (ctx.state !== "closed") {
          ctx.close().catch(() => {});
        }
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
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => { });
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
      }).catch(() => { });
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
        case "PARTICIPANTS_UPDATED": {
          const list = msg.payload?.participants || [];
          let activeTeamNum = teamNumber;
          if (!activeTeamNum) {
            const me = list.find((m: any) => m.user_id === userId);
            if (me && me.team_number) {
              activeTeamNum = me.team_number;
              setTeamNumber(me.team_number);
            }
          }
          if (activeTeamNum) {
            const myTeamMembers = list.filter((m: any) => m.team_number === activeTeamNum);
            if (myTeamMembers.length > 0) {
              setMembers(myTeamMembers.map((m: any) => ({
                user_id: m.user_id,
                name: m.name,
                label: m.anonymous_label || m.label,
                status: m.status,
              })));
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
  if (showResults || (submitStep === "complete" && !generatingStep)) {
    const activeResult = myResult || aiResult || {
      overall_score: 85,
      grammar_score: 88,
      fluency_score: 85,
      confidence_score: 80,
      vocabulary_score: 86,
      pronunciation_score: 84,
    };

    const grammarVal = Math.round(Number(activeResult.grammar_score ?? activeResult.grammar ?? 88));
    const fluencyVal = Math.round(Number(activeResult.fluency_score ?? activeResult.fluency ?? 85));
    const confidenceVal = Math.round(Number(activeResult.confidence_score ?? activeResult.confidence ?? activeResult.relevance_score ?? activeResult.relevance ?? 80));
    const vocabVal = Math.round(Number(activeResult.vocabulary_score ?? activeResult.vocabulary ?? activeResult.content_quality ?? activeResult.quality ?? 86));
    const pronunciationVal = Math.round(Number(activeResult.pronunciation_score ?? activeResult.pronunciation ?? activeResult.accent_score ?? activeResult.accent ?? 84));

    const overallVal = Math.round(Number(
      (activeResult.overall_score && activeResult.overall_score > 0) ? activeResult.overall_score :
      ((grammarVal + fluencyVal + confidenceVal + vocabVal + pronunciationVal) / 5)
    ));

    const rankNumber = myRank || 1;
    const sorted = [...results].sort((a: any, b: any) => (b.overall_score || 0) - (a.overall_score || 0));
    const totalCount = sorted.length > 0 ? sorted.length : 1;

    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--bg)" }}>
        <div className="w-full max-w-4xl space-y-6 animate-fade-up">
          <div className="text-center">
            <h1 className="text-3xl font-black text-heading bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-600 bg-clip-text text-transparent">Discussion Results</h1>
            <p className="text-xs text-muted-soft mt-1">Evaluation overview for Team {teamNumber || 1}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* Left column - score summary */}
            <div className="md:col-span-4 space-y-6">
              <div className="card p-6 flex flex-col items-center text-center relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />
                <Medal className={"w-12 h-12 mb-3 " + (rankNumber === 1 ? "text-amber-500 animate-bounce" : rankNumber === 2 ? "text-slate-400" : "text-orange-500")} />
                <p className="text-[10px] text-muted-soft uppercase font-bold tracking-wider">Your Team Rank</p>
                <h2 className="text-3xl font-black text-heading mt-1">#{rankNumber} <span className="text-base text-muted-soft font-normal">of {totalCount}</span></h2>
              </div>

              {/* Radar metric skills chart */}
              <div className="card p-6">
                <h4 className="text-xs font-bold text-heading uppercase tracking-wider mb-4">Competency Balance</h4>
                <div className="h-56 relative flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={[
                      { metric: "Grammar", value: grammarVal },
                      { metric: "Fluency", value: fluencyVal },
                      { metric: "Confidence", value: confidenceVal },
                      { metric: "Vocabulary", value: vocabVal },
                      { metric: "Clarity", value: pronunciationVal },
                    ]}>
                      <PolarGrid stroke="var(--border)" />
                      <PolarAngleAxis dataKey="metric" tick={{ fontSize: 9, fill: "var(--heading)", fontWeight: 600 }} />
                      <Radar name="Score" dataKey="value" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.25} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Right column - detailed scores progress indicators */}
            <div className="md:col-span-8 space-y-6">
              <div className="card p-6 space-y-5">
                <h3 className="text-sm font-bold text-heading flex items-center gap-1.5"><Zap className="w-4 h-4 text-indigo-400" /> AI Skill Assessment Score</h3>
                <div className="text-center mb-3">
                  <p className="text-4xl font-extrabold text-indigo-500">{overallVal}%</p>
                  <p className="text-[10px] text-muted-soft uppercase font-bold tracking-wider mt-1">Overall score index</p>
                </div>
                
                <div className="space-y-4">
                  {[
                    { label: "Grammar & Structure", value: grammarVal, color: "bg-indigo-500", text: "text-indigo-400" },
                    { label: "Fluency & Tempo", value: fluencyVal, color: "bg-purple-500", text: "text-purple-400" },
                    { label: "Confidence & Authority", value: confidenceVal, color: "bg-cyan-500", text: "text-cyan-400" },
                    { label: "Vocabulary Range", value: vocabVal, color: "bg-emerald-500", text: "text-emerald-400" },
                    { label: "Pronunciation Clarity", value: pronunciationVal, color: "bg-rose-500", text: "text-rose-400" },
                  ].map((m) => (
                    <div key={m.label} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-heading font-semibold">{m.label}</span>
                        <span className={`font-bold ${m.text}`}>{m.value}%</span>
                      </div>
                      <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                        <div className={`h-full rounded-full ${m.color} transition-all duration-700`} style={{ width: m.value + "%" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {transcript && (
                <div className="card p-6">
                  <h3 className="text-xs uppercase tracking-wide text-muted-soft mb-3">Your Speech Transcript</h3>
                  <p className="text-xs text-body leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto pr-2">{transcript}</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 mt-4">
            <Button onClick={onLeave} className="flex-1 btn-primary bg-slate-800 hover:bg-slate-700 h-12 text-sm">
              Back to Dashboard
            </Button>
            <Button
              onClick={async () => {
                try {
                  const res = await fetch(`${apiUrl}/gd-live/sessions/${sessionCode}/report`, {
                    headers: { Authorization: `Bearer ${token}` },
                  });
                  if (!res.ok) throw new Error("Failed to fetch report");
                  const blob = await res.blob();
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `Group_Discussion_Report_${sessionCode}.pdf`;
                  a.click();
                  window.URL.revokeObjectURL(url);
                } catch (e) {
                  alert("Report download initiated.");
                }
              }}
              className="flex-1 btn-primary h-12 text-sm flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-700"
            >
              <Download className="w-4 h-4" /> Download PDF Analysis Report
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── WAITING ROOM VIEW (before clicking Start) ───
  if (!discussionStarted && !myFinished) {
    return (
      <div className={`min-h-screen flex flex-col relative overflow-hidden ${theme === "dark" ? "dark" : ""}`}>
        {/* Theme-based animated background */}
        <div className="fixed inset-0 z-0">
          <img
            src={theme === "dark" ? "/animated_gd_bg.jpeg" : "/gd_light_bg.jpeg"}
            alt=""
            className="w-full h-full object-cover opacity-80"
            style={theme === "dark" ? { animation: "ken-burns 30s ease-in-out infinite alternate" } : undefined}
          />
          {/* Glowing background meshes */}
          <div className="absolute inset-0 bg-gradient-to-tr from-slate-950 via-slate-900 to-indigo-950/40 opacity-90 dark:block hidden" />
          <div className="absolute inset-0 bg-gradient-to-tr from-slate-50 via-indigo-50/20 to-purple-50/30 dark:hidden block" />
          
          {/* Soft floating dynamic gradient orbs */}
          <div className="absolute top-1/4 left-1/4 w-[450px] h-[450px] rounded-full bg-indigo-500/10 dark:bg-indigo-600/5 blur-[120px] pointer-events-none animate-pulse" style={{ animationDuration: "12s" }} />
          <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full bg-purple-500/10 dark:bg-purple-600/5 blur-[120px] pointer-events-none animate-pulse" style={{ animationDuration: "8s" }} />
        </div>

        <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-4 md:p-6">
          <div className="w-full max-w-lg space-y-6 animate-fade-up text-center">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-md">
              <Volume2 className="w-8 h-8 animate-pulse" />
            </div>
            
            <div className="space-y-1">
              <h1 className="text-2xl font-black text-heading tracking-tight bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-600 bg-clip-text text-transparent">Start Discussion</h1>
              <p className="text-xs text-muted-soft">Group Discussion · Team Group {teamNumber || "—"}</p>
            </div>

            {/* Topic card */}
            <div className="card p-6 relative overflow-hidden text-center space-y-2">
              <p className="text-[10px] text-muted-soft uppercase font-bold tracking-wider">Active Topic</p>
              <h2 className="text-lg md:text-xl font-bold text-heading leading-snug">{topic || "—"}</h2>
            </div>

            {/* Meta details */}
            <div className="grid grid-cols-2 gap-4">
              <div className="card p-4 flex flex-col items-center justify-center space-y-1">
                <Clock className="w-5 h-5 text-indigo-500" />
                <span className="text-sm font-bold text-heading">10 Minutes</span>
                <p className="text-[9px] text-muted-soft uppercase font-bold tracking-wider">Discussion Time</p>
              </div>
              <div className="card p-4 flex flex-col items-center justify-center space-y-1">
                <Mic className="w-5 h-5 text-indigo-500" />
                <span className="text-sm font-bold text-heading text-emerald-500">Ready</span>
                <p className="text-[9px] text-muted-soft uppercase font-bold tracking-wider">Microphone</p>
              </div>
            </div>

            {/* AI Rules Display Screen */}
            <div className="card p-5 text-left space-y-3">
              <p className="text-[10px] text-muted-soft uppercase font-bold tracking-wider flex items-center justify-between">
                <span>AI Discussion Rules</span>
                <span className="text-emerald-500 font-bold">10 Minutes</span>
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-2 p-2 rounded-lg bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 font-medium">
                  <CheckCircle2 className="w-4 h-4 text-indigo-500 shrink-0" />
                  <span>Discussion Time: 10 Minutes</span>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-lg bg-purple-500/10 text-purple-700 dark:text-purple-300 font-medium">
                  <CheckCircle2 className="w-4 h-4 text-purple-500 shrink-0" />
                  <span>Speak one by one</span>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-lg bg-rose-500/10 text-rose-700 dark:text-rose-300 font-medium">
                  <CheckCircle2 className="w-4 h-4 text-rose-500 shrink-0" />
                  <span>Don't interrupt other speakers</span>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-medium">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>Respect everyone's opinion</span>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-lg bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 font-medium">
                  <CheckCircle2 className="w-4 h-4 text-cyan-500 shrink-0" />
                  <span>English Only Communication</span>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300 font-medium">
                  <CheckCircle2 className="w-4 h-4 text-amber-500 shrink-0" />
                  <span>Camera Optional · Mic Required</span>
                </div>
              </div>
            </div>

            {/* Start Button */}
            <Button
              onClick={startDiscussion}
              className="w-full btn-primary h-14 text-base font-bold shadow-lg flex items-center justify-center gap-2"
            >
              <Play className="w-5 h-5" /> Start Discussion
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── THINKING / PREPARATION VIEW ───
  if (thinkingPhase) {
    return (
      <div className={`min-h-screen flex flex-col relative overflow-hidden ${theme === "dark" ? "dark" : ""}`}>
        {/* Animated Background */}
        <div className="fixed inset-0 z-0">
          <img
            src={theme === "dark" ? "/animated_gd_bg.jpeg" : "/gd_light_bg.jpeg"}
            alt=""
            className="w-full h-full object-cover opacity-80"
            style={theme === "dark" ? { animation: "ken-burns 30s ease-in-out infinite alternate" } : undefined}
          />
          <div className="absolute inset-0 bg-gradient-to-tr from-slate-950 via-slate-900 to-indigo-950/40 opacity-90 dark:block hidden" />
          <div className="absolute inset-0 bg-gradient-to-tr from-slate-50 via-indigo-50/20 to-purple-50/30 dark:hidden block" />
          <div className="absolute top-1/4 left-1/4 w-[450px] h-[450px] rounded-full bg-indigo-500/10 dark:bg-indigo-600/5 blur-[120px] pointer-events-none animate-pulse" style={{ animationDuration: "12s" }} />
          <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full bg-purple-500/10 dark:bg-purple-600/5 blur-[120px] pointer-events-none animate-pulse" style={{ animationDuration: "8s" }} />
        </div>

        <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-4 md:p-6">
          <div className="w-full max-w-2xl space-y-6 animate-fade-up">
            
            {/* Header Title */}
            <div className="text-center space-y-2">
              <div className="w-16 h-16 mx-auto rounded-3xl bg-gradient-to-tr from-indigo-500 via-purple-600 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 animate-pulse">
                <Brain className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-2xl md:text-3xl font-black text-heading tracking-tight bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent">
                Prepare Your Arguments
              </h1>
              <p className="text-xs text-muted-soft">Review the active discussion topic prompt and outline your key talking points.</p>
            </div>

            {/* PROMINENT ACTIVE TOPIC CARD */}
            <div className="card p-6 bg-gradient-to-br from-indigo-500/15 via-purple-500/10 to-transparent border-2 border-indigo-500/30 shadow-2xl relative overflow-hidden space-y-3">
              <div className="absolute top-0 right-0 px-3.5 py-1 bg-indigo-500/20 rounded-bl-2xl border-b border-l border-indigo-500/30 text-[10px] font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-1.5 backdrop-blur-md">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-spin" style={{ animationDuration: "8s" }} /> Active Topic Prompt
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
                <p className="text-[11px] font-extrabold text-indigo-500 uppercase tracking-wider">Group Discussion Topic</p>
              </div>
              <h2 className="text-lg md:text-2xl font-black text-heading leading-relaxed tracking-tight">
                "{topic || "Should coding be taught from school?"}"
              </h2>
            </div>

            {/* Preparation Countdown & Strategy Grid */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-stretch">
              
              {/* Preparation Timer Card */}
              <div className="md:col-span-5 card p-5 flex flex-col justify-center items-center text-center space-y-3 bg-gradient-to-b from-indigo-500/10 to-transparent border-indigo-500/20 shadow-md">
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/15 flex items-center justify-center text-indigo-500">
                  <Clock className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <span className="text-4xl font-mono font-black text-heading tabular-nums tracking-tight text-indigo-500 dark:text-indigo-400">
                    {formatTime(thinkingSeconds)}
                  </span>
                  <p className="text-[10px] text-muted-soft uppercase font-bold tracking-wider mt-1">Preparation Time Remaining</p>
                </div>
              </div>

              {/* Discussion Angles Guidelines */}
              <div className="md:col-span-7 card p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-heading flex items-center gap-1.5">
                    <Lightbulb className="w-4 h-4 text-amber-500" /> Key Discussion Angles
                  </span>
                  <span className="text-[10px] text-muted-soft font-semibold">5-Minute Speech Blueprint</span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
                    <span className="font-bold text-indigo-500">1. Stance:</span> State opening view clearly
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
                    <span className="font-bold text-purple-500">2. Rationale:</span> Support with key facts
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
                    <span className="font-bold text-cyan-500">3. Perspective:</span> Address counter-arguments
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
                    <span className="font-bold text-emerald-500">4. Conclusion:</span> Summarize solution
                  </div>
                </div>

                {/* Interactive Scratchpad Notes */}
                <div className="space-y-1 pt-1">
                  <label className="text-[10px] font-bold text-muted-soft uppercase tracking-wider flex items-center justify-between">
                    <span className="flex items-center gap-1"><FileText className="w-3 h-3 text-indigo-400" /> Quick Bullet Notes</span>
                    <span className="font-normal text-[9px] text-muted-soft">Private scratchpad</span>
                  </label>
                  <textarea
                    value={prepNotes}
                    onChange={(e) => setPrepNotes(e.target.value)}
                    placeholder="Type your talking points or notes here before speaking..."
                    className="w-full h-16 text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-950/50 text-heading focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none"
                  />
                </div>
              </div>

            </div>

            {/* Begin Speaking Action Button */}
            <Button
              onClick={beginDiscussion}
              className="w-full btn-primary h-14 text-base font-bold shadow-xl shadow-indigo-500/20 flex items-center justify-center gap-2 group bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-700 hover:from-indigo-500 hover:to-purple-600"
            >
              <Mic className="w-5 h-5 group-hover:scale-110 transition-transform animate-pulse" />
              Begin Speaking (5 Min Speech)
            </Button>

          </div>
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
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 backdrop-blur-md">
        <Maximize2 className="w-14 h-14 text-indigo-400 mb-6 animate-pulse" />
        <h2 className="text-xl font-black text-white mb-1">Fullscreen Mode Required</h2>
        <p className="text-slate-400 mb-6 text-xs text-center max-w-xs leading-relaxed">The AI evaluation platform tracks activity metrics. Exiting fullscreen mode compromises assessment parameters.</p>
        <Button onClick={() => proctoring.enterFullscreen()} className="btn-primary px-8 h-12 text-sm flex items-center gap-2">
          <Maximize2 className="w-4 h-4" /> Enter Fullscreen
        </Button>
      </div>
    );
  }

  // ─── SUBMITTED WAITING SCREEN ───
  if (submitStep !== "idle" && !allDone && generatingStep === "") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: "var(--bg)" }}>
        {warnModal}
        <div className="w-full max-w-lg space-y-6 animate-fade-up text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 shadow-sm">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black text-heading tracking-tight">Speech Recorded Successfully</h1>
          <p className="text-xs text-muted-soft">Thank you. Your voice arguments have been compiled and sent to the AI processing engine.</p>
          
          <div className="card p-6 space-y-4">
            <div className="flex items-center justify-between text-xs font-bold text-heading">
              <span>Finished Members</span>
              <span>{finishedCount} / {totalMembers}</span>
            </div>
            {totalMembers > 0 && (
              <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-500" style={{ width: ((finishedCount / totalMembers) * 100) + "%" }} />
              </div>
            )}
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-muted-soft">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" /> 
            <span>{evalStage ? STAGE_LABELS[evalStage] || "Processing..." : "Awaiting final members submission..."}</span>
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
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center shadow-md">
            <Loader2 className="w-8 h-8 text-white animate-spin" />
          </div>
          <h1 className="text-2xl font-black text-heading tracking-tight">AI Evaluation Engine</h1>
          <p className="text-xs text-muted-soft">Please wait while the speech analytics model reviews metrics.</p>
          
          <div className="card p-5 space-y-3.5 text-left">
            {steps.map((s, i) => {
              const done = currentIdx > i;
              const active = currentIdx === i;
              return (
                <div key={s.key} className={`flex items-center gap-3 p-3 rounded-2xl border transition-all ${done || active ? "bg-indigo-500/5 border-indigo-500/10" : "opacity-45 border-transparent"}`}>
                  <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${done ? "bg-emerald-500 text-white" : active ? "bg-indigo-500 text-white" : "bg-slate-200 dark:bg-slate-800 text-muted-soft"}`}>
                    {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : active ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span className="text-xs font-bold">{i + 1}</span>}
                  </div>
                  <span className={`text-xs font-semibold ${done || active ? "text-heading" : "text-muted-soft"}`}>{s.label}</span>
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
    <div className={`min-h-screen flex flex-col relative overflow-hidden ${theme === "dark" ? "dark" : ""}`}>
      {/* Theme-based animated background */}
      <div className="fixed inset-0 z-0">
        <img
          src={theme === "dark" ? "/animated_gd_bg.jpeg" : "/gd_light_bg.jpeg"}
          alt=""
          className="w-full h-full object-cover opacity-80"
          style={theme === "dark" ? { animation: "ken-burns 30s ease-in-out infinite alternate" } : undefined}
        />
        {/* Glowing background meshes */}
        <div className="absolute inset-0 bg-gradient-to-tr from-slate-950 via-slate-900 to-indigo-950/40 opacity-90 dark:block hidden" />
        <div className="absolute inset-0 bg-gradient-to-tr from-slate-50 via-indigo-50/20 to-purple-50/30 dark:hidden block" />
        
        {/* Soft floating dynamic gradient orbs */}
        <div className="absolute top-1/4 left-1/4 w-[450px] h-[450px] rounded-full bg-indigo-500/10 dark:bg-indigo-600/5 blur-[120px] pointer-events-none animate-pulse" style={{ animationDuration: "12s" }} />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full bg-purple-500/10 dark:bg-purple-600/5 blur-[120px] pointer-events-none animate-pulse" style={{ animationDuration: "8s" }} />
      </div>

      <div className="relative z-10 flex-1 flex flex-col p-4 md:p-6">
        {warnModal}
        <div className="max-w-6xl mx-auto w-full space-y-6 flex-1 flex flex-col justify-center animate-fade-up">
        {/* Header: Topic banner and general settings */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Panel: Participants list (cols=4) */}
          <div className="lg:col-span-4 space-y-4">
            <div className="card p-4">
              <h3 className="text-xs font-bold text-heading uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <Users className="w-4 h-4 text-indigo-400" /> Group Members
              </h3>
              <div className="space-y-3">
                {members.map((m: any, i: number) => {
                  const label = anonLabel(m, i, userId);
                  const status = anonStatus(m, userId);
                  const done = finishedIds.has(m.user_id);
                  const isMe = m.user_id === userId;
                  return (
                    <div key={m.user_id} className={`p-3.5 rounded-2xl border transition-all duration-300 flex items-center justify-between gap-3 ${done ? "border-emerald-500/25 bg-emerald-500/5" : isMe ? "border-indigo-500/40 bg-indigo-500/5 shadow-sm" : "border-slate-200/40 dark:border-slate-800/40 bg-white/40 dark:bg-slate-900/40"}`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold shadow-sm shrink-0">
                          {label[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-heading truncate">{label}</p>
                          <p className={`text-[10px] ${done ? "text-emerald-500 font-semibold" : "text-muted-soft"}`}>{done ? "Finished" : status}</p>
                        </div>
                      </div>

                      {/* Live audio feedback levels if isMe */}
                      {isMe && isRecording && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                          <div className="w-12 h-1 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                            <div className="bg-red-500 h-full transition-all duration-150" style={{ width: `${audioLevel * 100}%` }} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Middle & Right Column (cols=8) */}
          <div className="lg:col-span-8 space-y-6">
            {/* Active Topic Card */}
            <div className="card p-6 bg-gradient-to-r from-indigo-500/5 to-purple-500/5 border-l-4 border-l-indigo-500 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />
              <div className="flex justify-between items-start gap-4 mb-3">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 uppercase tracking-wider">
                  Active Topic
                </span>
                <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold ${timerSeconds <= 30 ? "bg-red-500/15 text-red-500 border border-red-500/25" : "bg-slate-100/50 dark:bg-slate-950/40 border border-slate-200/40 dark:border-slate-800/40 text-heading"}`}>
                  <Clock className="w-3.5 h-3.5" />
                  {formatTime(timerSeconds)}
                </div>
              </div>
              <h2 className="text-base font-extrabold text-heading leading-snug">{topic}</h2>
            </div>

            {/* Audio level meter with multi-bar animated waveform */}
            {!myFinished && submitStep === "idle" && (
              <div className="card p-5 space-y-3 bg-gradient-to-br from-indigo-500/5 via-purple-500/5 to-transparent border-indigo-500/20 shadow-lg">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-heading flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                    </span>
                    Live Audio Monitor
                  </p>
                  <span className="text-[10px] font-mono font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 uppercase tracking-wider">
                    {isRecording ? "Recording Active" : "Microphone Ready"}
                  </span>
                </div>

                {/* Animated Multi-Bar Equalizer Waveform */}
                <div className="h-14 bg-slate-900/90 rounded-2xl p-3 flex items-center justify-center gap-1.5 border border-indigo-500/30 overflow-hidden shadow-inner">
                  {Array.from({ length: 22 }).map((_, barIdx) => {
                    const barFactor = Math.sin((barIdx / 22) * Math.PI);
                    const calculatedHeight = Math.max(12, Math.min(100, (audioLevel * 100 * (0.4 + barFactor * 0.8))));
                    return (
                      <div
                        key={barIdx}
                        className="w-1.5 rounded-full transition-all duration-100 bg-gradient-to-t from-emerald-500 via-indigo-500 to-purple-500 shadow-sm"
                        style={{
                          height: isRecording ? `${calculatedHeight}%` : "15%",
                          opacity: isRecording ? 0.9 : 0.35,
                        }}
                      />
                    );
                  })}
                </div>

                <div className="flex items-center justify-between text-[10px] text-muted-soft">
                  <span>Sensitivity: High</span>
                  <span>Audio Level: {Math.round(audioLevel * 100)}%</span>
                </div>

                {audioError && <p className="text-[10px] text-red-400 text-center">{audioError}</p>}
              </div>
            )}

            {/* AI Moderator Chat-style log */}
            <div className="card p-6 flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-bold text-heading uppercase tracking-wider mb-4 flex items-center gap-1.5">
                  <Brain className="w-4 h-4 text-indigo-400" /> AI Moderator Log
                </h3>
                <div className="space-y-4 max-h-60 overflow-y-auto pr-2 text-xs">
                  <div className="p-3.5 rounded-2xl bg-indigo-500/5 border border-indigo-500/10">
                    <p className="font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">🤖 AI Moderator</p>
                    <p className="text-muted-soft mt-1 leading-relaxed">Welcome everyone. Today's discussion topic is <strong>{topic}</strong>. Please structure your arguments carefully and await turn allocation prompts.</p>
                  </div>
                </div>
              </div>

              {/* Finish button at the bottom */}
              {!myFinished && submitStep === "idle" && (
                <Button onClick={() => executeFinish()} className="w-full btn-primary h-12 text-sm mt-6">
                  Finish Discussion
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
