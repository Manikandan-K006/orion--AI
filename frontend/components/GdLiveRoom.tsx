"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Clock, Users, Mic, MicOff, Volume2, Brain, AlertTriangle, AlertCircle, Target, Maximize2, Medal, BarChart3, Zap, Play, User, Sparkles, FileText, Download, Lightbulb, MessageSquare, ShieldCheck, Activity, Trophy, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar } from "recharts";
import { useGdLiveWs, GDLiveWsMessage } from "@/lib/useGdLiveWs";
import { useVoiceAnnouncement } from "@/services/voice/useVoiceAnnouncement";
import { useProctoring } from "@/services/proctoring/lockdown";
import { getApiUrl } from "@/lib/config";

interface CircularProgressProps {
  percent: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
}

function CircularProgress({ percent, size = 60, strokeWidth = 6, color = "#4f46e5", label }: CircularProgressProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (Math.min(100, Math.max(0, percent)) / 100) * circumference;

  return (
    <div className="flex flex-col items-center justify-center space-y-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg className="w-full h-full transform -rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            className="stroke-slate-800 fill-none"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-500 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-xs font-black text-heading">
          {Math.round(percent)}%
        </div>
      </div>
      {label && <span className="text-[9px] text-muted-soft uppercase font-bold text-center tracking-wider">{label}</span>}
    </div>
  );
}

interface CircularTimerProps {
  seconds: number;
  maxSeconds: number;
}

function CircularTimer({ seconds, maxSeconds }: CircularTimerProps) {
  const size = 110;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const percent = (seconds / maxSeconds) * 100;
  const strokeDashoffset = circumference - (Math.min(100, Math.max(0, percent)) / 100) * circumference;

  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");

  return (
    <div className="flex flex-col items-center justify-center my-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg className="w-full h-full transform -rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            className="stroke-slate-800/85 fill-none"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="url(#timerGradient)"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-300 ease-out"
          />
          <defs>
            <linearGradient id="timerGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4f46e5" />
              <stop offset="100%" stopColor="#c084fc" />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          <span className="text-xl font-black text-heading font-mono tabular-nums">{m}:{s}</span>
          <span className="text-[9px] text-muted-soft uppercase font-bold mt-1">Time Left</span>
        </div>
      </div>
    </div>
  );
}

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
  finalizing: "Finalizing audio...",
  analyzing: "Analyzing discussion...",
  generating: "Generating report...",
  transcribing: "Transcribing...",
  evaluating: "Analyzing grammar, fluency, and confidence...",
  saving: "Saving results...",
  complete: "Complete!",
};

type SubmitStep = "idle" | "uploading" | "finalizing" | "analyzing" | "generating" | "submitted" | "complete";

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
  const [defaultSpeakingTime, setDefaultSpeakingTime] = useState(300);
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
  const [evalStage, setEvalStage] = useState("");
  const [generatingStep, setGeneratingStep] = useState<string>("");

  // Turn, round, speech streaming and alerts state variables
  const [currentSpeakerId, setCurrentSpeakerId] = useState<number | null>(null);
  const [nextSpeakerId, setNextSpeakerId] = useState<number | null>(null);
  const [speakingOrder, setSpeakingOrder] = useState<number[]>([]);
  const [discussionRound, setDiscussionRound] = useState<number>(1);
  const [liveSpeechText, setLiveSpeechText] = useState("");
  const [liveTranscripts, setLiveTranscripts] = useState<Record<number, string>>({});
  const [liveScores, setLiveScores] = useState<any>({ grammar: 85, fluency: 85, confidence: 85, vocabulary: 85, overall: 85, emotion: "Analytical", wpm: 135 });
  const [aiAlertsList, setAiAlertsList] = useState<any[]>([]);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [speakingHistory, setSpeakingHistory] = useState<any[]>([]);
  const recognitionRef = useRef<any>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll chat to bottom when new message arrives
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishLockRef = useRef(false);
  const chunkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunkUploadRef = useRef(false);
  const userId = user?.user_id ?? user?.id;
  const apiUrl = getApiUrl();
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
    if (currentSpeakerId === userId) {
      executeFinish();
    }
  }, [timerSeconds, timerRunning, currentSpeakerId, userId]);

  // Stop mic when timer stops
  useEffect(() => { if (!timerRunning && isRecording) { stopChunkUpload(); stopMic(); } }, [timerRunning]);

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

  const [audioError, setAudioError] = useState("");

  function startSpeechRecognition() {
    if (typeof window === "undefined") return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("WebSpeech API is not supported in this browser.");
      return;
    }

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) { }
    }

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onresult = (event: any) => {
      let fullTranscript = "";
      for (let i = 0; i < event.results.length; ++i) {
        fullTranscript += event.results[i][0].transcript;
      }
      if (fullTranscript.trim()) {
        setLiveSpeechText(fullTranscript);
        send("LIVE_SPEECH", { text: fullTranscript });
      }
    };

    rec.onerror = (event: any) => {
      console.warn("Speech recognition notice:", event.error);
      if (event.error === "no-speech" || event.error === "network") {
        setTimeout(() => {
          if (!finishLockRef.current) {
            try { rec.start(); } catch (e) { }
          }
        }, 400);
      }
    };

    rec.onend = () => {
      if (!finishLockRef.current) {
        try {
          rec.start();
        } catch (e) { }
      }
    };

    recognitionRef.current = rec;
    try {
      rec.start();
    } catch (e) {
      console.warn("Speech recognition start error:", e);
    }
  }

  function stopSpeechRecognition() {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) { }
      recognitionRef.current = null;
    }
  }

  async function startRecording() {
    try {
      setAudioError("");
      if (typeof window === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.warn("Microphone access requires HTTPS or localhost (or chrome://flags/#unsafely-treat-insecure-origin-as-secure).");
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e: any) {
        if (e.name === "NotFoundError" || e.message.includes("not found")) {
          console.warn("No microphone found. Using a silent dummy audio stream for testing.");
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const dest = ctx.createMediaStreamDestination();
          stream = dest.stream;
        } else {
          throw e;
        }
      }
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
          ctx.close().catch(() => { });
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

  async function sendAudioChunk() {
    if (!isRecording || chunkUploadRef.current || audioChunksRef.current.length === 0) return;
    chunkUploadRef.current = true;
    try {
      // Take a snapshot of current chunks and clear for new recording
      const chunks = [...audioChunksRef.current];
      audioChunksRef.current = [];
      const blob = new Blob(chunks, { type: "audio/webm" });
      if (blob.size < 100) { chunkUploadRef.current = false; return; }
      const formData = new FormData();
      formData.append("file", blob, "gd_chunk_" + sessionCode + "_" + userId + ".webm");
      await fetch(apiUrl + "/gd-live/sessions/" + sessionCode + "/upload-chunk", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: formData,
      });
    } catch (err) {
      console.warn("Chunk upload failed:", err);
    }
    chunkUploadRef.current = false;
  }

  function startChunkUpload() {
    if (chunkIntervalRef.current) clearInterval(chunkIntervalRef.current);
    chunkUploadRef.current = false;
    chunkIntervalRef.current = setInterval(sendAudioChunk, 20000);
  }

  function stopChunkUpload() {
    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current);
      chunkIntervalRef.current = null;
    }
    chunkUploadRef.current = false;
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
    if (currentSpeakerId === userId) {
      startRecording();
      startChunkUpload();
      startSpeechRecognition();
    } else {
      stopMic();
      stopChunkUpload();
      stopSpeechRecognition();
    }
    proctoring.enable();
    voice.announceBeginSpeaking();
  }

  async function executeFinish() {
    if (finishLockRef.current) return;
    finishLockRef.current = true;
    setTimerRunning(false);
    if (timerRef.current) clearInterval(timerRef.current);
    stopChunkUpload();
    proctoring.disable();
    setSubmitStep("finalizing");

    // Send final chunk (remaining audio since last interval)
    try {
      if (audioChunksRef.current.length > 0) {
        const finalBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        audioChunksRef.current = [];
        if (finalBlob.size >= 100) {
          const fd = new FormData();
          fd.append("file", finalBlob, "gd_chunk_" + sessionCode + "_" + userId + ".webm");
          await fetch(apiUrl + "/gd-live/sessions/" + sessionCode + "/upload-chunk", {
            method: "POST",
            headers: { Authorization: "Bearer " + token },
            body: fd,
          });
        }
      }
    } catch (err) {
      console.warn("Final chunk upload failed:", err);
    }

    // Stop mic after final chunk is sent
    stopMic();

    // Get accumulated transcript from server
    setSubmitStep("analyzing");
    let transcript = "";
    try {
      const finRes = await fetch(apiUrl + "/gd-live/sessions/" + sessionCode + "/finalize-transcript", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      });
      const finData = await finRes.json();
      transcript = finData.transcript || "";
    } catch (err) {
      console.warn("Finalize transcript failed:", err);
    }

    // If accumulated transcript is empty, fall back to full upload
    if (!transcript || transcript.length < 20) {
      const blob = new Blob(audioChunksRef.current.length > 0
        ? audioChunksRef.current
        : [new Blob()], { type: "audio/webm" });
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
          if (data.transcript) transcript = data.transcript;
          if (data.evaluation) setAiResult(data.evaluation);
        } catch (err) {
          console.warn("Fallback upload failed:", err);
        }
      }
    }

    if (transcript) setTranscript(transcript);
    
    // Send finish notification
    send("SPEAKER_FINISHED", { user_id: userId, transcript });
    
    // For continuous discussion rounds, unlock for future turns
    if (discussionRound === 2 || discussionRound === 3) {
      finishLockRef.current = false;
      setSubmitStep("idle");
      setLiveSpeechText("");
    } else {
      setSubmitStep("complete");
    }
  }

  function forceFinish(reason: string) {
    if (finishLockRef.current) return;
    finishLockRef.current = true;
    setTimerRunning(false);
    if (timerRef.current) clearInterval(timerRef.current);
    stopChunkUpload();
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
            : (st?.team_states ? Object.values(st.team_states).find((t: any) => t.members?.some((m: any) => m.user_id === userId)) : null) as any;
          if (myTeam) {
            setTeamNumber(myTeam.team_number);
            setMembers(myTeam.members || []);
            if (myTeam.timer_seconds) {
              setTimerSeconds(myTeam.timer_seconds);
              setDefaultSpeakingTime(myTeam.timer_seconds);
            }
            setFinishedIds(new Set(myTeam.finished_user_ids || []));
            setAllFinished(myTeam.all_finished || false);

            if (myTeam.speaking_order) {
              setSpeakingOrder(myTeam.speaking_order || []);
              setCurrentSpeakerId(myTeam.speaking_order[myTeam.current_speaker_idx] || null);
              setNextSpeakerId(myTeam.speaking_order[myTeam.current_speaker_idx + 1] || null);
              setDiscussionRound(myTeam.round || 1);
            }

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
          if (ts.speaking_order) {
            setSpeakingOrder(ts.speaking_order || []);
            setCurrentSpeakerId(ts.speaking_order[ts.current_speaker_idx] || null);
            setNextSpeakerId(ts.speaking_order[ts.current_speaker_idx + 1] || null);
            setDiscussionRound(ts.round || 1);
          }
          break;
        }
        case "SPEAKER_CHANGED": {
          const { current_speaker_id, next_speaker_id, round, topic, speaking_order } = msg.payload;
          setCurrentSpeakerId(current_speaker_id);
          setNextSpeakerId(next_speaker_id);
          setDiscussionRound(round || 1);
          if (topic) setTopic(topic);
          if (speaking_order) setSpeakingOrder(speaking_order);
          
          setTimerSeconds(defaultSpeakingTime);
          
          if (current_speaker_id === userId) {
            startRecording();
            startSpeechRecognition();
            startChunkUpload();
            setTimerRunning(true);
          } else {
            stopChunkUpload();
            stopSpeechRecognition();
            stopMic();
            setTimerRunning(true);
          }
          break;
        }
        case "ROUND_CHANGED": {
          const { round } = msg.payload;
          setDiscussionRound(round);
          stopMic();
          stopSpeechRecognition();
          stopChunkUpload();
          break;
        }
        case "SPEAKER_EVALUATED": {
          const { user_id, name, label, text, grammar, fluency, confidence, emotion } = msg.payload;
          setSpeakingHistory(prev => [
            {
              user_id,
              name: name || label || `Member ${user_id}`,
              label: label || name || `Member ${user_id}`,
              text,
              grammar: grammar || 85,
              fluency: fluency || 85,
              confidence: confidence || 85,
              emotion: emotion || "Analytical"
            },
            ...prev
          ]);
          break;
        }
        case "LIVE_SPEECH_BROADCAST": {
          const { user_id, text } = msg.payload;
          setLiveTranscripts(prev => ({
            ...prev,
            [user_id]: text
          }));
          break;
        }
        case "LIVE_EVALUATION_UPDATE": {
          const { user_id, grammar, fluency, confidence, vocabulary, quality, overall } = msg.payload;
          if (user_id === userId) {
            setLiveScores({ grammar, fluency, confidence, vocabulary: vocabulary || quality, overall });
          }
          break;
        }
        case "AI_ALERT": {
          const alert = msg.payload;
          setAiAlertsList(prev => [alert, ...prev].slice(0, 5));
          if (alert.type === "repetition" && alert.user_id === userId) {
            voice.speak("Please do not repeat the question. Provide your own points.");
          }
          break;
        }
        case "CHAT_MESSAGE": {
          const chat = msg.payload;
          setChatMessages(prev => [...prev, chat]);
          break;
        }
        case "ALL_FINISHED": {
          setAllFinished(true);
          setTimerRunning(false);
          stopSpeechRecognition();
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
          stopSpeechRecognition();
          onLeave();
          break;
      }
    });
    return unsub;
  }, [subscribe, userId, topic, teamNumber]);

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

    const contentQualityVal = Math.round(Number(activeResult.content_quality_score ?? activeResult.content_quality ?? 85));
    const topicUnderstandingVal = Math.round(Number(activeResult.topic_understanding_score ?? 85));
    const originalityVal = Math.round(Number(activeResult.originality_score ?? 85));
    const criticalThinkingVal = Math.round(Number(activeResult.critical_thinking_score ?? 85));
    const relevanceVal = Math.round(Number(activeResult.topic_relevance_score ?? activeResult.relevance_score ?? 88));

    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--bg)" }}>
        <div className="w-full max-w-5xl space-y-6 animate-fade-up">
          <div className="text-center">
            <h1 className="text-3xl font-black text-heading bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-600 bg-clip-text text-transparent">Discussion Evaluation Report</h1>
            <p className="text-xs text-muted-soft mt-1">Comprehensive AI Analysis for Team {teamNumber || 1}</p>
          </div>

          {activeResult.is_question_repetition && (
            <div className="card p-4 border-l-4 border-l-rose-500 bg-rose-500/10 text-rose-700 dark:text-rose-300 space-y-1">
              <div className="flex items-center gap-2 font-bold text-sm">
                <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
                <span>Question Repetition / No Meaningful Content Detected</span>
              </div>
              <p className="text-xs">{activeResult.repetition_reason || "The AI detected that the speech mainly repeated the assigned topic prompt without providing original reasoning or examples."}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* Left column - score summary */}
            <div className="md:col-span-4 space-y-6">
              <div className="card p-6 flex flex-col items-center text-center relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />
                <Medal className={"w-12 h-12 mb-3 " + (rankNumber === 1 ? "text-amber-500 animate-bounce" : rankNumber === 2 ? "text-slate-400" : "text-orange-500")} />
                <p className="text-[10px] text-muted-soft uppercase font-bold tracking-wider">Your Team Rank</p>
                <h2 className="text-3xl font-black text-heading mt-1">#{rankNumber} <span className="text-base text-muted-soft font-normal">of {totalCount}</span></h2>
              </div>

              {/* Team Leaderboard Card */}
              <div className="card p-6 space-y-4">
                <h4 className="text-xs font-bold text-heading uppercase tracking-wider flex items-center gap-1.5">
                  <Trophy className="w-4 h-4 text-amber-400 animate-pulse" /> Team Standings
                </h4>
                <div className="space-y-3">
                  {sorted.map((item: any, idx: number) => (
                    <div key={item.user_id} className={`flex items-center justify-between p-3 rounded-xl border ${item.user_id === userId ? "border-amber-500/40 bg-amber-500/5" : "border-[var(--border)] surface-2"}`}>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-base shrink-0">
                          {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}`}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-heading truncate">{item.name}</p>
                          <p className="text-[10px] text-muted-soft font-mono truncate">{item.label || "Member"}</p>
                        </div>
                      </div>
                      <span className="text-xs font-extrabold text-emerald-400 shrink-0">
                        {Number(item.overall_score || item.overall).toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Radar metric skills chart */}
              <div className="card p-6">
                <h4 className="text-xs font-bold text-heading uppercase tracking-wider mb-4">Competency Balance</h4>
                <div className="h-56 relative flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={[
                      { metric: "Content", value: contentQualityVal },
                      { metric: "Understanding", value: topicUnderstandingVal },
                      { metric: "Originality", value: originalityVal },
                      { metric: "Grammar", value: grammarVal },
                      { metric: "Fluency", value: fluencyVal },
                      { metric: "Confidence", value: confidenceVal },
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
                <h3 className="text-sm font-bold text-heading flex items-center gap-1.5"><Zap className="w-4 h-4 text-indigo-400" /> Comprehensive Skill Assessment</h3>
                <div className="text-center mb-3">
                  <p className="text-4xl font-extrabold text-indigo-500">{overallVal}%</p>
                  <p className="text-[10px] text-muted-soft uppercase font-bold tracking-wider mt-1">Overall Evaluation Index</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { label: "Content Quality & Reasoning", value: contentQualityVal, color: "bg-indigo-500", text: "text-indigo-400" },
                    { label: "Topic Understanding", value: topicUnderstandingVal, color: "bg-purple-500", text: "text-purple-400" },
                    { label: "Originality of Ideas", value: originalityVal, color: "bg-emerald-500", text: "text-emerald-400" },
                    { label: "Critical Thinking", value: criticalThinkingVal, color: "bg-cyan-500", text: "text-cyan-400" },
                    { label: "Topic Relevance", value: relevanceVal, color: "bg-amber-500", text: "text-amber-400" },
                    { label: "Grammar & Structure", value: grammarVal, color: "bg-indigo-400", text: "text-indigo-300" },
                    { label: "Fluency & Tempo", value: fluencyVal, color: "bg-purple-400", text: "text-purple-300" },
                    { label: "Confidence & Delivery", value: confidenceVal, color: "bg-rose-500", text: "text-rose-400" },
                  ].map((m) => (
                    <div key={m.label} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-heading font-medium truncate max-w-[170px]">{m.label}</span>
                        <span className={`font-bold ${m.text}`}>{m.value}%</span>
                      </div>
                      <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                        <div className={`h-full rounded-full ${m.color} transition-all duration-700`} style={{ width: m.value + "%" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Detailed AI Feedback Grids */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="card p-4 space-y-2 border-l-4 border-l-emerald-500">
                  <h4 className="text-xs font-bold text-heading uppercase tracking-wider flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Key Strengths</h4>
                  <ul className="space-y-1 text-xs text-body">
                    {(activeResult.strengths && activeResult.strengths.length > 0 ? activeResult.strengths : ["Presents original thoughts relevant to topic", "Clear voice delivery"]).map((s: string, idx: number) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="text-emerald-500 font-bold">•</span> <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="card p-4 space-y-2 border-l-4 border-l-amber-500">
                  <h4 className="text-xs font-bold text-heading uppercase tracking-wider flex items-center gap-1.5"><AlertCircle className="w-4 h-4 text-amber-500" /> Areas of Improvement</h4>
                  <ul className="space-y-1 text-xs text-body">
                    {(activeResult.weaknesses && activeResult.weaknesses.length > 0 ? activeResult.weaknesses : ["Reduce filler words like 'umm' and 'like'", "Elaborate with concrete examples"]).map((w: string, idx: number) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="text-amber-500 font-bold">•</span> <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Missing Discussion Points & Recommendations */}
              <div className="card p-5 space-y-3">
                <h4 className="text-xs font-bold text-heading uppercase tracking-wider flex items-center gap-1.5"><Target className="w-4 h-4 text-indigo-500" /> Actionable AI Recommendations</h4>
                <div className="space-y-2 text-xs text-body">
                  {(activeResult.recommendations && activeResult.recommendations.length > 0 ? activeResult.recommendations : [
                    "Express original thoughts instead of repeating the topic title.",
                    "Support your main thesis with a real-life case study or statistics."
                  ]).map((rec: string, idx: number) => (
                    <div key={idx} className="p-2.5 rounded-lg bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 flex items-start gap-2">
                      <Zap className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
                      <span>{rec}</span>
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
                  const res = await fetch(`${apiUrl}/reports/gd-live/${sessionCode}/pdf`, {
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
                  alert("Report download failed. Please try again.");
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

  // ─── SUBMITTED WAITING SCREEN ───
  if (submitStep !== "idle" && !allDone && generatingStep === "") {
    const stepLabel: Record<string, string> = {
      uploading: "Uploading final audio...",
      finalizing: "Finalizing audio...",
      analyzing: "Analyzing discussion...",
      generating: "Generating report...",
      submitted: "Processing...",
      complete: "Done",
    };
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: "var(--bg)" }}>
        {warnModal}
        <div className="w-full max-w-lg space-y-6 animate-fade-up text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 shadow-sm">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
          <h1 className="text-2xl font-black text-heading tracking-tight">{stepLabel[submitStep] || "Processing..."}</h1>
          <p className="text-xs text-muted-soft">Your discussion is being evaluated. Please wait.</p>

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

    return (
    <div className={`min-h-screen flex flex-col relative overflow-hidden ${theme === "dark" ? "dark" : ""}`}>
      <div className="fixed inset-0 z-0">
        <img
          src={theme === "dark" ? "/animated_gd_bg.jpeg" : "/gd_light_bg.jpeg"}
          alt=""
          className="w-full h-full object-cover opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-slate-950 via-slate-900 to-indigo-950/40 opacity-90 dark:block hidden" />
      </div>

      <div className="relative z-10 flex-1 flex flex-col p-4 md:p-6">
        {warnModal}
        <div className="max-w-7xl mx-auto w-full space-y-5 flex-1 flex flex-col justify-center animate-fade-up">

          {/* ─── PHASE TIMELINE HEADER ─── */}
          <div className="card p-4 bg-slate-900/80 backdrop-blur-xl border border-slate-800 flex items-center justify-between gap-4 shadow-2xl">
            {/* Logo */}
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-purple-650 flex items-center justify-center text-white font-extrabold text-sm animate-pulse">
                MZ
              </div>
              <div className="leading-tight hidden sm:block">
                <p className="text-xs font-black text-heading tracking-tight">ThinkCircle</p>
                <p className="text-[9px] text-muted-soft font-bold uppercase tracking-wider">AI Group Discussion</p>
              </div>
            </div>

            {/* Stepper tracker */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 text-[11px] font-bold scrollbar-none">
              {[
                { phase: 1, label: "Opening Round" },
                { phase: 2, label: "Open Discussion" },
                { phase: 3, label: "Rapid Fire" },
                { phase: 4, label: "Final Summary" }
              ].map((p) => {
                const active = discussionRound === p.phase;
                const completed = discussionRound > p.phase;
                return (
                  <div
                    key={p.phase}
                    className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full transition-all shrink-0 border ${
                      active
                        ? "bg-indigo-600 border-indigo-500 text-white shadow-md shadow-indigo-600/20"
                        : completed
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                        : "bg-slate-950/40 border-slate-800 text-muted-soft"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-white animate-ping" : completed ? "bg-emerald-400" : "bg-slate-700"}`} />
                    <span>{p.label}</span>
                  </div>
                );
              })}
            </div>

            {/* Right details */}
            <div className="flex items-center gap-3 shrink-0">
              <span className="hidden sm:inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 items-center gap-1 uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" /> Live Session
              </span>
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-slate-950 border border-slate-800 text-heading">
                <Clock className="w-3.5 h-3.5 text-indigo-400" />
                <span>00:{timerSeconds < 10 ? `0${timerSeconds}` : timerSeconds}</span>
              </div>
              <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-heading">
                {user?.name?.[0]?.toUpperCase() || "U"}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            
            {/* Left Column: Current Speaker & Turn Queue */}
            <div className="lg:col-span-3 space-y-4">
              
              {/* Current Speaker Card */}
              <div className="card p-4 bg-slate-900/80 backdrop-blur-lg border border-slate-800 space-y-4 relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-heading uppercase tracking-wider">Current Speaker</h3>
                  {currentSpeakerId === userId && (
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/35">
                      You
                    </span>
                  )}
                </div>

                {currentSpeakerId ? (() => {
                  const speaker = members.find(m => m.user_id === currentSpeakerId);
                  const sLabel = speaker?.label || speaker?.anonymous_label || speaker?.name || `Member ${currentSpeakerId}`;
                  const isMe = currentSpeakerId === userId;
                  return (
                    <div className="space-y-4">
                      {/* Profile details */}
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-650 text-white flex items-center justify-center font-black text-sm shrink-0 border border-indigo-500/30">
                          {sLabel[0].toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-heading truncate">{sLabel} {isMe && "(You)"}</p>
                          <p className="text-[10px] text-muted-soft font-semibold mt-0.5">Novice Speaker</p>
                        </div>
                      </div>

                      {/* Animated Sound Wave */}
                      <div className="flex justify-center items-end gap-1.5 h-10 bg-slate-950/40 p-2.5 rounded-2xl border border-slate-850">
                        {[30, 60, 45, 90, 75, 40, 80, 50, 65, 30].map((h, i) => (
                          <span 
                            key={i} 
                            className="w-1 bg-gradient-to-t from-indigo-500 to-purple-650 rounded-full transition-all duration-300"
                            style={{ 
                              height: isRecording ? `${h}%` : '20%',
                              animation: isRecording ? `bounce 1s ease-in-out infinite alternate` : 'none',
                              animationDelay: `${i * 0.1}s`
                            }}
                          />
                        ))}
                      </div>

                      {/* Radial Progress Clock */}
                      <CircularTimer 
                        seconds={timerSeconds} 
                        maxSeconds={discussionRound === 1 ? 30 : discussionRound === 3 ? 15 : 120} 
                      />

                      {/* Listening badge */}
                      <div className="flex items-center justify-center gap-1.5 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 py-1.5 rounded-xl border border-emerald-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                        <span>Listening...</span>
                      </div>
                    </div>
                  );
                })() : (
                  <div className="text-xs text-muted-soft italic text-center py-6">
                    Awaiting active speaker turn...
                  </div>
                )}
              </div>

              {/* Turn Queue Card */}
              <div className="card p-4 bg-slate-900/80 backdrop-blur-lg border border-slate-800 space-y-3">
                <h3 className="text-xs font-bold text-heading uppercase tracking-wider">Turn Queue</h3>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {speakingOrder.map((uid: number, idx: number) => {
                    const m = members.find(member => member.user_id === uid);
                    if (!m) return null;
                    const label = m.label || m.anonymous_label || `Member ${uid}`;
                    const isCurrent = uid === currentSpeakerId;
                    const isDone = finishedIds.has(uid);

                    return (
                      <div 
                        key={uid} 
                        className={`p-2.5 rounded-xl border flex items-center justify-between text-xs transition-all ${
                          isCurrent 
                            ? "border-indigo-500/50 bg-indigo-500/10" 
                            : isDone 
                            ? "border-slate-800/40 opacity-55" 
                            : "border-slate-855 bg-slate-950/20"
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-5 h-5 rounded-md bg-slate-800 text-muted-soft text-[10px] font-bold flex items-center justify-center font-mono shrink-0">
                            {idx + 1}
                          </span>
                          <span className="font-bold text-heading truncate">{label}</span>
                        </div>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                          isCurrent 
                            ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30" 
                            : isDone 
                            ? "bg-rose-500/15 text-rose-455 border-rose-500/30" 
                            : "bg-slate-900 border-slate-800 text-muted-soft"
                        }`}>
                          {isCurrent ? "Next" : isDone ? "Done" : "Waiting"}
                        </span>
                      </div>
                    );
                  })}
                  {speakingOrder.length === 0 && (
                    <div className="text-xs text-muted-soft italic text-center py-4">No turns queued</div>
                  )}
                </div>
                <Button variant="secondary" className="w-full text-[10px] border-slate-800 hover:bg-slate-850 h-9 font-bold">
                  View All Participants
                </Button>
              </div>
            </div>

            {/* Middle Column: Participants Slider, AI Moderator, Live Transcript */}
            <div className="lg:col-span-6 space-y-4">
              
              {/* Participants horizontal slider card */}
              <div className="card p-4 bg-slate-900/80 backdrop-blur-lg border border-slate-800">
                <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2">
                  <h3 className="text-xs font-bold text-heading uppercase tracking-wider flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-indigo-400" /> Participants ({members.length})
                  </h3>
                  <button className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-slate-950 border border-slate-800 text-muted-soft hover:text-heading transition-colors">
                    ✋ Raise Hand
                  </button>
                </div>

                <div className="flex items-center justify-between gap-1.5">
                  <button className="text-muted-soft hover:text-heading p-1 shrink-0 text-xs font-bold font-mono">{"<"}</button>
                  <div className="flex items-center gap-4 overflow-x-auto py-1 flex-1 justify-center scrollbar-none">
                    {members.map((m: any, idx: number) => {
                      const label = m.label || m.anonymous_label || m.name || `Member ${idx + 1}`;
                      const isMe = m.user_id === userId;
                      const isSpeaking = currentSpeakerId === m.user_id;
                      return (
                        <div key={m.user_id} className="flex flex-col items-center text-center shrink-0 w-20">
                          <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-extrabold relative border ${isSpeaking ? "border-indigo-500 bg-indigo-500/10 shadow-lg shadow-indigo-500/10 scale-105" : "border-slate-850 bg-slate-950/40"}`}>
                            {label[0].toUpperCase()}
                            {isSpeaking && (
                              <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-indigo-500 rounded-full flex items-center justify-center text-[8px] text-white">
                                🎙️
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-heading font-semibold mt-1.5 truncate w-full">{label} {isMe && "(You)"}</span>
                          {isSpeaking ? (
                            <span className="text-[8px] font-bold text-indigo-400 bg-indigo-500/15 px-1.5 py-0.5 rounded-full mt-0.5 border border-indigo-550/20">
                              Speaking
                            </span>
                          ) : (
                            <span className="text-[8px] font-bold text-muted-soft mt-0.5">
                              Waiting
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button className="text-muted-soft hover:text-heading p-1 shrink-0 text-xs font-bold font-mono">{">"}</button>
                </div>
              </div>

              {/* AI Moderator Chat speech bubble */}
              <div className="card p-4 bg-slate-900/80 backdrop-blur-lg border border-slate-800 space-y-3">
                <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                  <h3 className="text-xs font-bold text-heading uppercase tracking-wider flex items-center gap-1.5">
                    <Brain className="w-4 h-4 text-indigo-400" /> AI Moderator
                  </h3>
                  <span className="text-[9px] font-mono text-indigo-400 flex items-center gap-1 bg-indigo-500/10 px-2 py-0.5 rounded-full">
                    <span className="w-1 h-1 rounded-full bg-indigo-400 animate-pulse" /> Thinking...
                  </span>
                </div>

                <div className="flex gap-3.5 items-start p-3 bg-slate-950/40 rounded-2xl border border-slate-850">
                  <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white shrink-0 font-bold text-sm">
                    🤖
                  </div>
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <p className="text-xs font-black text-indigo-400">AI Facilitator Feedback</p>
                    <p className="text-xs text-body leading-relaxed whitespace-pre-wrap">
                      {chatMessages.length > 0 
                        ? chatMessages[chatMessages.length - 1].text 
                        : `Great start! Welcome to ThinkCircle. Please take turns naturally, support or challenge teammate arguments, and present structured ideas.`}
                    </p>
                  </div>
                </div>
                <div className="flex justify-center gap-1.5 pt-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-800" />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-800" />
                </div>
              </div>

              {/* Live Transcript scrollable cards feed */}
              <div className="card p-4 bg-slate-900/80 backdrop-blur-lg border border-slate-800 space-y-3">
                <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                  <h3 className="text-xs font-bold text-heading uppercase tracking-wider flex items-center gap-1.5">
                    <Mic className="w-4 h-4 text-indigo-400" /> Live Transcript
                  </h3>
                  <span className="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" /> Real-time
                  </span>
                </div>

                <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                  {/* Active speech card */}
                  {currentSpeakerId && (
                    <div className="p-3.5 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 space-y-1 animate-fade-up">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-indigo-400 flex items-center gap-1">
                          🎙️ {currentSpeakerId === userId ? "You" : members.find(m => m.user_id === currentSpeakerId)?.label || "Teammate"} Speaking...
                        </span>
                        <span className="text-[9px] font-mono text-indigo-300">Confidence: {currentSpeakerId === userId ? liveScores.confidence : 88}%</span>
                      </div>
                      <p className="text-xs text-heading italic whitespace-pre-wrap leading-relaxed">
                        {currentSpeakerId === userId ? liveSpeechText : (liveTranscripts[currentSpeakerId] || "")}
                      </p>
                    </div>
                  )}

                  {/* Speech contributions feed */}
                  {speakingHistory.map((item: any, idx: number) => (
                    <div key={idx} className="p-4 rounded-2xl text-xs border border-slate-850 bg-slate-950/20 space-y-2 animate-fade-up">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-650 text-white flex items-center justify-center font-bold text-xs shrink-0">
                            {item.label?.[0]?.toUpperCase() || "S"}
                          </div>
                          <div className="min-w-0">
                            <span className="font-extrabold text-heading truncate block">{item.name}</span>
                            <span className="text-[9px] text-muted-soft font-semibold block">{idx === 0 ? "Just now" : `${idx} min ago`}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[9px] font-mono text-indigo-400 font-bold bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">
                            Grammar {item.grammar}%
                          </span>
                          <span className="text-[9px] font-mono text-purple-400 font-bold bg-purple-500/10 px-2 py-0.5 rounded-full border border-purple-500/20">
                            Confidence {item.confidence}%
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-4 mt-2">
                        <p className="text-body italic leading-relaxed text-xs flex-1">{item.text}</p>
                        <div className="flex items-center gap-2 shrink-0">
                          {/* Small visualizer waveform */}
                          <div className="flex gap-0.5 items-center h-3 bg-slate-950 px-2 py-1 rounded-md border border-slate-850">
                            <span className="w-0.5 h-1.5 bg-indigo-400 rounded-full" />
                            <span className="w-0.5 h-3 bg-indigo-400 rounded-full animate-pulse" />
                            <span className="w-0.5 h-2.5 bg-indigo-400 rounded-full" />
                            <span className="w-0.5 h-1.5 bg-indigo-400 rounded-full" />
                          </div>
                          <span className="text-[10px] font-mono text-muted-soft font-semibold">00:22</span>
                        </div>
                      </div>
                    </div>
                  ))}

                  {speakingHistory.length === 0 && !currentSpeakerId && (
                    <div className="text-xs text-muted-soft italic text-center py-6">No transcript history logs recorded yet.</div>
                  )}
                </div>

                <div className="text-center text-[10px] font-mono text-muted-soft py-1 animate-pulse border-t border-slate-850 flex items-center justify-center gap-1.5 mt-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                  <span>Transcribing speech...</span>
                </div>
              </div>
            </div>

            {/* Right Column: Speech Analytics radial gauges, AI Feedback card, Leaderboard standings */}
            <div className="lg:col-span-3 space-y-4">
              
              {/* Speech Analytics radial gauges card */}
              <div className="card p-4 bg-slate-900/80 backdrop-blur-lg border border-slate-800 space-y-4">
                <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                  <h3 className="text-xs font-bold text-heading uppercase tracking-wider">Speech Analytics</h3>
                  <span className="text-[9px] text-indigo-400 font-bold bg-indigo-500/10 px-2 py-0.5 rounded-full">
                    This Session
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-y-4 gap-x-2 justify-items-center">
                  <CircularProgress percent={liveScores.grammar || 85} size={64} strokeWidth={5} color="#2dd4bf" label="Grammar" />
                  <CircularProgress percent={liveScores.fluency || 85} size={64} strokeWidth={5} color="#3b82f6" label="Fluency" />
                  <CircularProgress percent={liveScores.pronunciation || 87} size={64} strokeWidth={5} color="#06b6d4" label="Pronunciation" />
                  <CircularProgress percent={liveScores.vocabulary || 85} size={64} strokeWidth={5} color="#ec4899" label="Vocabulary" />
                  <CircularProgress percent={liveScores.confidence || 85} size={64} strokeWidth={5} color="#eab308" label="Confidence" />
                  <CircularProgress percent={liveScores.relevance || 91} size={64} strokeWidth={5} color="#22c55e" label="Relevance" />
                </div>

                <div className="text-center text-[10px] font-bold text-emerald-400 flex items-center justify-center gap-1 border-t border-slate-850 pt-2.5">
                  <Activity className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Live updates in real-time</span>
                </div>
              </div>

              {/* AI Feedback tips card */}
              <div className="card p-4 bg-slate-900/80 backdrop-blur-lg border border-slate-800 space-y-3.5">
                <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                  <h3 className="text-xs font-bold text-heading uppercase tracking-wider">AI Feedback</h3>
                  <span className="text-[9px] text-purple-400 font-bold bg-purple-500/10 px-2 py-0.5 rounded-full">
                    For You
                  </span>
                </div>

                <div className="p-3 bg-gradient-to-tr from-amber-500/10 via-amber-600/5 to-slate-900/40 border border-amber-500/35 rounded-2xl flex gap-2.5 items-start">
                  <div className="w-6 h-6 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-500 text-xs shrink-0 mt-0.5">
                    🏆
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-black text-heading leading-tight">Great Job! 🎉</p>
                    <p className="text-[10px] text-muted-soft font-semibold mt-0.5">You're expressing your ideas well.</p>
                  </div>
                </div>

                <div className="space-y-2 text-xs text-body font-medium">
                  {[
                    "Maintain eye contact while speaking",
                    "Try to reduce filler words like 'um', 'actually'",
                    "Add more examples to strengthen your point"
                  ].map((tip, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-emerald-500 font-bold shrink-0">✓</span>
                      <span className="text-[11px] leading-relaxed">{tip}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Leaderboard Card standings */}
              <div className="card p-4 bg-slate-900/80 backdrop-blur-lg border border-slate-800 space-y-3.5">
                <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                  <h3 className="text-xs font-bold text-heading uppercase tracking-wider">Leaderboard</h3>
                  <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Live
                  </span>
                </div>

                <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
                  {results.length > 0 ? [...results].sort((a: any, b: any) => b.overall_score - a.overall_score).map((item: any, idx: number) => {
                    const isMe = item.user_id === userId;
                    return (
                      <div 
                        key={item.user_id} 
                        className={`flex items-center justify-between p-2 rounded-xl border text-xs ${
                          isMe ? "border-indigo-500/40 bg-indigo-500/5" : "border-slate-850 bg-slate-950/20"
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs shrink-0 font-bold font-mono">
                            {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}`}
                          </span>
                          <div className="min-w-0 flex items-center gap-1">
                            <span className="font-bold text-heading truncate block max-w-[90px]">{item.name}</span>
                            {isMe && <span className="text-[8px] bg-indigo-500/25 text-indigo-400 px-1 rounded">You</span>}
                          </div>
                        </div>
                        <span className="text-xs font-extrabold text-emerald-400 shrink-0">
                          {Number(item.overall_score || 75).toFixed(1)}
                        </span>
                      </div>
                    );
                  }) : [
                    { name: "HARIHARAN V", score: 92.5, isMe: true },
                    { name: "Keerthana S", score: 88.3 },
                    { name: "Dharun R", score: 85.7 },
                    { name: "Praveen M", score: 82.4 },
                    { name: "Nandhini P", score: 79.6 }
                  ].map((item, idx) => (
                    <div 
                      key={idx} 
                      className={`flex items-center justify-between p-2 rounded-xl border text-xs ${
                        item.isMe ? "border-indigo-500/40 bg-indigo-500/5" : "border-slate-855 bg-slate-950/20"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs shrink-0 font-bold font-mono">
                          {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}`}
                        </span>
                        <div className="min-w-0 flex items-center gap-1">
                          <span className="font-bold text-heading truncate block max-w-[95px]">{item.name}</span>
                          {item.isMe && <span className="text-[8px] bg-indigo-500/25 text-indigo-455 px-1 rounded shrink-0">You</span>}
                        </div>
                      </div>
                      <span className="text-xs font-extrabold text-emerald-400 shrink-0">
                        {item.score}
                      </span>
                    </div>
                  ))}
                </div>
                <Button variant="secondary" className="w-full text-[10px] border-slate-800 hover:bg-slate-850 h-9 font-bold">
                  View Full Leaderboard
                </Button>
              </div>
            </div>
          </div>

          {/* Bottom Controls Floating bar */}
          <div className="flex items-center justify-center gap-4 bg-slate-900/90 backdrop-blur-md px-6 py-3 rounded-2xl border border-slate-800 shadow-2xl max-w-2xl mx-auto w-full mt-4">
            
            {/* Unmute/speak toggle button for Open discussion or regular Mic indicator */}
            {!myFinished && submitStep === "idle" && discussionRound === 2 ? (
              isRecording ? (
                <button 
                  onClick={() => executeFinish()} 
                  className="flex flex-col items-center gap-1 text-[9px] text-rose-455 font-bold animate-pulse shrink-0"
                >
                  <div className="w-10 h-10 rounded-xl bg-rose-600 flex items-center justify-center hover:bg-rose-500 text-white border border-rose-500">
                    <Mic className="w-4 h-4" />
                  </div>
                  <span>Mute mic</span>
                </button>
              ) : (
                <button 
                  onClick={() => {
                    startRecording();
                    startSpeechRecognition();
                    startChunkUpload();
                    setCurrentSpeakerId(userId);
                  }} 
                  className="flex flex-col items-center gap-1 text-[9px] text-emerald-400 font-bold shrink-0 animate-bounce"
                >
                  <div className="w-10 h-10 rounded-xl bg-slate-850 flex items-center justify-center hover:bg-slate-800 border border-slate-800 text-emerald-400">
                    <MicOff className="w-4 h-4" />
                  </div>
                  <span>Unmute to Speak</span>
                </button>
              )
            ) : (
              <button 
                onClick={() => {}} 
                className={`flex flex-col items-center gap-1 text-[9px] font-bold shrink-0 ${
                  currentSpeakerId === userId ? "text-emerald-400" : "text-slate-400"
                }`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
                  currentSpeakerId === userId ? "bg-slate-850 hover:bg-slate-800 border-slate-800 text-emerald-400" : "bg-slate-900/40 border-slate-850 text-slate-500 cursor-not-allowed"
                }`}>
                  <Mic className="w-4 h-4" />
                </div>
                <span>{currentSpeakerId === userId ? "Mic Active" : "Mic Muted"}</span>
              </button>
            )}

            <button onClick={() => {}} className="flex flex-col items-center gap-1 text-[9px] text-slate-405 font-bold">
              <div className="w-10 h-10 rounded-xl bg-slate-900/40 border border-slate-850 text-slate-500 flex items-center justify-center hover:bg-slate-800 cursor-not-allowed">
                <Maximize2 className="w-4 h-4" />
              </div>
              <span>Camera On</span>
            </button>
            <button onClick={() => {}} className="flex flex-col items-center gap-1 text-[9px] text-slate-405 font-bold">
              <div className="w-10 h-10 rounded-xl bg-slate-900/40 border border-slate-850 text-slate-500 flex items-center justify-center hover:bg-slate-800 cursor-not-allowed">
                <Play className="w-4 h-4" />
              </div>
              <span>Screen Share</span>
            </button>
            <button onClick={() => {}} className="flex flex-col items-center gap-1 text-[9px] text-slate-405 font-bold">
              <div className="w-10 h-10 rounded-xl bg-slate-900/40 border border-slate-850 text-slate-500 flex items-center justify-center hover:bg-slate-800 cursor-not-allowed">
                <Sparkles className="w-4 h-4" />
              </div>
              <span>Reactions</span>
            </button>
            <button onClick={() => {}} className="flex flex-col items-center gap-1 text-[9px] text-slate-405 font-bold">
              <div className="w-10 h-10 rounded-xl bg-slate-900/40 border border-slate-850 text-slate-500 flex items-center justify-center hover:bg-slate-800 cursor-not-allowed">
                <Sparkles className="w-4 h-4" />
              </div>
              <span>Settings</span>
            </button>
            
            <div className="h-8 w-px bg-slate-800 mx-2 shrink-0" />
            
            {!myFinished && submitStep === "idle" && currentSpeakerId === userId && (
              <Button 
                onClick={() => executeFinish()} 
                className="btn-primary h-10 px-4 rounded-xl font-bold bg-rose-600 hover:bg-rose-500 border-0 flex items-center gap-1.5 text-xs text-white shrink-0"
              >
                <Square className="w-3.5 h-3.5 fill-white animate-pulse" /> Conclude Turn
              </Button>
            )}
            <Button 
              onClick={onLeave} 
              className="btn-secondary h-10 px-4 rounded-xl font-bold border-slate-800 hover:bg-slate-800 text-xs flex items-center gap-1.5 shrink-0"
            >
              Leave Session
            </Button>
          </div>

        </div>
      </div>
    </div>
  );
}
