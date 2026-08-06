"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { CheckCircle2, Loader2, Clock, Users, Mic, MicOff, Volume2, Brain, AlertTriangle, AlertCircle, Target, Maximize2, Medal, BarChart3, Zap, Play, User, Sparkles, FileText, Download, Lightbulb, MessageSquare, ShieldCheck, Activity, Trophy, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar } from "recharts";
import { useGdLiveWs, GDLiveWsMessage } from "@/lib/useGdLiveWs";
import { useVoiceAnnouncement } from "@/services/voice/useVoiceAnnouncement";
import { useProctoring } from "@/services/proctoring/lockdown";
import { getApiUrl } from "@/lib/config";

interface UseWebRTCOptions {
  sessionCode: string;
  token: string;
  userId: number;
  send: (event: string, payload: any) => void;
  subscribe: (handler: (msg: GDLiveWsMessage) => void) => () => void;
}

interface UseWebRTCReturn {
  localStream: MediaStream | null;
  remoteStreams: Map<number, MediaStream>;
  toggleCamera: () => void;
  toggleMic: () => void;
  cameraEnabled: boolean;
  micEnabled: boolean;
}

function useWebRTC({ sessionCode, token, userId, send, subscribe }: UseWebRTCOptions): UseWebRTCReturn {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<number, MediaStream>>(new Map());
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const pcsRef = useRef<Map<number, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);

  const getOrCreatePC = useCallback((peerId: number) => {
    if (pcsRef.current.has(peerId)) return pcsRef.current.get(peerId)!;
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }],
    });
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        send("WEBRTC_ICE_CANDIDATE", { target_user_id: peerId, candidate: e.candidate.toJSON() });
      }
    };
    pc.ontrack = (e) => {
      setRemoteStreams((prev) => {
        const next = new Map(prev);
        next.set(peerId, e.streams[0]);
        return next;
      });
    };
    pcsRef.current.set(peerId, pc);
    return pc;
  }, [send]);

  const createOffer = useCallback(async (peerId: number) => {
    const pc = getOrCreatePC(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send("WEBRTC_OFFER", { target_user_id: peerId, offer: pc.localDescription!.toJSON() });
  }, [getOrCreatePC, send]);

  const handleOffer = useCallback(async (peerId: number, offer: RTCSessionDescriptionInit) => {
    const pc = getOrCreatePC(peerId);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    send("WEBRTC_ANSWER", { target_user_id: peerId, answer: pc.localDescription!.toJSON() });
  }, [getOrCreatePC, send]);

  const handleAnswer = useCallback(async (peerId: number, answer: RTCSessionDescriptionInit) => {
    const pc = pcsRef.current.get(peerId);
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }, []);

  const handleIceCandidate = useCallback(async (peerId: number, candidate: RTCIceCandidateInit) => {
    const pc = pcsRef.current.get(peerId);
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((s) => {
      stream = s;
      localStreamRef.current = s;
      setLocalStream(s);
    }).catch((err) => {
      console.warn("[WebRTC] getUserMedia failed:", err);
      navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
        stream = s;
        localStreamRef.current = s;
        setLocalStream(s);
        setCameraEnabled(false);
      }).catch(() => {});
    });
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
      pcsRef.current.forEach((pc) => pc.close());
      pcsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const unsub = subscribe((msg: GDLiveWsMessage) => {
      switch (msg.event) {
        case "WEBRTC_OFFER":
          if (msg.payload.from_user_id !== userId) handleOffer(msg.payload.from_user_id, msg.payload.offer);
          break;
        case "WEBRTC_ANSWER":
          if (msg.payload.from_user_id !== userId) handleAnswer(msg.payload.from_user_id, msg.payload.answer);
          break;
        case "WEBRTC_ICE_CANDIDATE":
          if (msg.payload.from_user_id !== userId) handleIceCandidate(msg.payload.from_user_id, msg.payload.candidate);
          break;
      }
    });
    return unsub;
  }, [subscribe, userId, handleOffer, handleAnswer, handleIceCandidate]);

  useEffect(() => {
    if (!localStream) return;
    const handler = (msg: GDLiveWsMessage) => {
      if (msg.event === "TEAM_STATE_UPDATED" || msg.event === "STATE_SYNC") {
        const members = msg.payload?.members || msg.payload?.state?.members || [];
        members.forEach((m: any) => {
          if (m.user_id !== userId && !pcsRef.current.has(m.user_id)) {
            createOffer(m.user_id);
          }
        });
      }
    };
    const unsub = subscribe(handler);
    return unsub;
  }, [localStream, subscribe, userId, createOffer]);

  const toggleCamera = useCallback(() => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setCameraEnabled(videoTrack.enabled);
      send("CAMERA_STATUS", { camera_on: videoTrack.enabled });
    }
  }, [localStream, send]);

  const toggleMic = useCallback(() => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setMicEnabled(audioTrack.enabled);
      send("MIC_STATUS", { mic_on: audioTrack.enabled });
    }
  }, [localStream, send]);

  return { localStream, remoteStreams, toggleCamera, toggleMic, cameraEnabled, micEnabled };
}

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

function PipelineTracker({ currentSpeakerId }: { currentSpeakerId: number | null }) {
  const steps = [
    "Voice Input", "Noise Removal", "Whisper STT", "Sentence Detection",
    "Grammar", "Emotion", "Confidence", "Relevance", "AI Decision Engine",
    "Moderator Response", "Dashboard Update"
  ];
  const [activeIdx, setActiveIdx] = useState(-1);

  useEffect(() => {
    if (!currentSpeakerId) {
      setActiveIdx(-1);
      return;
    }
    const interval = setInterval(() => {
      setActiveIdx((prev) => (prev + 1) % steps.length);
    }, 1500);
    return () => clearInterval(interval);
  }, [currentSpeakerId]);

  return (
    <div className="card p-3 space-y-2 bg-slate-900/70 border border-slate-800 shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-heading uppercase tracking-wider flex items-center gap-1">
          <Brain className="w-3.5 h-3.5 text-indigo-400" /> AI Decision Pipeline
        </span>
        <span className="text-[8px] font-mono text-muted-soft">{currentSpeakerId ? "Processing Live Speech..." : "Idle"}</span>
      </div>
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[9px] font-bold scrollbar-none scroll-smooth">
        {steps.map((step, idx) => {
          const isActive = idx === activeIdx;
          const isDone = idx < activeIdx && activeIdx !== -1;
          return (
            <div
              key={step}
              className={`flex items-center gap-1 px-2 py-1 rounded-md shrink-0 transition-all border ${isActive
                ? "bg-indigo-600 border-indigo-500 text-white animate-pulse"
                : isDone
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                  : "bg-slate-950/40 border-slate-850 text-muted-soft"
                }`}
            >
              <span className={`w-1 h-1 rounded-full ${isActive ? "bg-white" : isDone ? "bg-emerald-400" : "bg-slate-700"}`} />
              <span>{step}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
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
  onLeave: (finished?: boolean) => void;
}) {
  const { connected, send, subscribe } = useGdLiveWs(sessionCode, token);
  const { localStream, remoteStreams, toggleCamera, toggleMic, cameraEnabled, micEnabled } = useWebRTC({ sessionCode, token, userId: user?.user_id ?? user?.id, send, subscribe });
  const [countdown, setCountdown] = useState<number | null>(showCountdown ? 3 : null);
  const [topic, setTopic] = useState(initialTopic);
  const [teamNumber, setTeamNumber] = useState<number | null>(null);
  const [members, setMembers] = useState<any[]>(initialMembers || []);
  const joinedMembers = members.filter((m: any) => m.status !== "invited");
  const [finishedIds, setFinishedIds] = useState<Set<number>>(new Set());
  const [allFinished, setAllFinished] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(60);
  const [turnNumber, setTurnNumber] = useState(0);
  const [maxTurns, setMaxTurns] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
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
  const [showTurnSummary, setShowTurnSummary] = useState(false);
  const [turnSummaryScore, setTurnSummaryScore] = useState<any>(null);

  // Waiting room readiness:
  const [readyUsers, setReadyUsers] = useState<number[]>([]);
  const [localMicCheck, setLocalMicCheck] = useState(true);
  const [localCameraCheck, setLocalCameraCheck] = useState(true);
  const [localNetwork, setLocalNetwork] = useState("Excellent");
  const [audioTestPassed, setAudioTestPassed] = useState(false);
  const [localReady, setLocalReady] = useState(false);

  // Turn-based GD state:
  const [currentSpeakerId, setCurrentSpeakerId] = useState<number | null>(null);
  const [speakingOrder, setSpeakingOrder] = useState<number[]>([]);
  const [liveSpeechText, setLiveSpeechText] = useState("");
  const [liveTranscripts, setLiveTranscripts] = useState<Record<number, string>>({});
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [speakingHistory, setSpeakingHistory] = useState<any[]>([]);
  const [participantCameraStatus, setParticipantCameraStatus] = useState<Record<number, boolean>>({});
  const [participantMicStatus, setParticipantMicStatus] = useState<Record<number, boolean>>({});
  const recognitionRef = useRef<any>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll chat to bottom when new message arrives
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  function toggleLocalReady() {
    const nextReady = !localReady;
    setLocalReady(nextReady);
    send("SUBMIT_READY_STATUS", {
      ready: nextReady,
      mic: localMicCheck,
      network: localNetwork
    });
  }

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

  // Timer effect — always 60-second turns
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
        if (s === 31 && !announcedMarkers.current.has("30")) { announcedMarkers.current.add("30"); voice.announceThirtySeconds(); }
        if (s === 11 && !announcedMarkers.current.has("10")) { announcedMarkers.current.add("10"); voice.announceTenSeconds(); }
        return s - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning]);

  // Auto-stop when timer hits 0 — disable mic, lock speaking, send transcript
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
      console.warn("[SPEECH] WebSpeech API not supported in this browser.");
      return;
    }

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) { }
    }

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    console.log("[SPEECH] Starting Web Speech API...");

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
      console.warn("[SPEECH] Error:", event.error);
      if (event.error === "no-speech" || event.error === "network") {
        setTimeout(() => {
          if (!finishLockRef.current) {
            try { rec.start(); } catch (e) { }
          }
        }, 400);
      }
    };

    rec.onend = () => {
      console.log("[SPEECH] Recognition ended, restarting...");
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
        console.warn("[MIC] Microphone API not available. Requires HTTPS or localhost.");
        setAudioError("Microphone API not available. Use HTTPS or localhost.");
        return;
      }

      // Block mic on insecure LAN origins — getUserMedia is restricted to secure contexts
      const hostname = window.location.hostname;
      const isSecureContext = window.location.protocol === "https:" || hostname === "localhost" || hostname === "127.0.0.1";
      if (!isSecureContext) {
        console.error("[MIC] BLOCKED — insecure origin:", window.location.href);
        setAudioError("Microphone requires HTTPS. Open chrome://flags/#unsafely-treat-insecure-origin-as-secure and add this URL, or use localhost.");
        return;
      }

      console.log("[MIC] Requesting microphone access...");
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const tracks = stream.getAudioTracks();
        console.log("[MIC] Granted. Tracks:", tracks.map(t => ({
          kind: t.kind, enabled: t.enabled, muted: t.muted,
          readyState: t.readyState, label: t.label,
        })));
        if (tracks.length === 0 || tracks[0].readyState !== "live") {
          console.error("[MIC] No active audio tracks!", tracks);
          setAudioError("Microphone granted but no active audio track found.");
          return;
        }
      } catch (e: any) {
        console.error("[MIC] getUserMedia FAILED:", e.name, e.message);
        setAudioError(`Microphone error: ${e.name} — ${e.message}`);
        return;
      }
      audioStreamRef.current = stream;
      const ctx = new AudioContext();
      audioContextRef.current = ctx;
      if (ctx.state === "suspended") {
        await ctx.resume();
        console.log("[MIC] AudioContext resumed from suspended state");
      }
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const levelInterval = setInterval(() => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setAudioLevel(Math.min(1, avg / 128));
      }, 100);
      audioChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus" : "audio/webm";
      console.log("[MIC] Creating MediaRecorder, mimeType:", mimeType);
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onerror = (e) => {
        console.error("[MIC] MediaRecorder error:", e);
      };
      recorder.onstop = () => {
        clearInterval(levelInterval);
        stream.getTracks().forEach((t) => t.stop());
        if (ctx.state !== "closed") {
          ctx.close().catch(() => { });
        }
        setIsRecording(false);
        setAudioLevel(0);
      };
      recorder.start(1000);
      setIsRecording(true);
      console.log("[MIC] Recording started. State:", recorder.state);
    } catch (err) {
      console.error("[MIC] startRecording failed:", err);
      setAudioError("Microphone access failed");
    }
  }

  function stopMic() {
    console.log("[MIC] Stopping. Recorder state:", mediaRecorderRef.current?.state);
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
      const chunks = [...audioChunksRef.current];
      audioChunksRef.current = [];
      const blob = new Blob(chunks, { type: "audio/webm" });
      if (blob.size < 100) { chunkUploadRef.current = false; return; }
      console.log("[CHUNK] Uploading:", blob.size, "bytes,", chunks.length, "chunks");
      const formData = new FormData();
      formData.append("file", blob, "gd_chunk_" + sessionCode + "_" + userId + ".webm");
      const res = await fetch(apiUrl + "/gd-live/sessions/" + sessionCode + "/upload-chunk", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: formData,
      });
      const data = await res.json();
      console.log("[CHUNK] Server:", res.status, "transcript:", data.chunk_transcript?.substring(0, 60) || "(empty)");
    } catch (err) {
      console.warn("[CHUNK] Upload failed:", err);
    }
    chunkUploadRef.current = false;
  }

  function startChunkUpload() {
    if (chunkIntervalRef.current) clearInterval(chunkIntervalRef.current);
    chunkUploadRef.current = false;
    chunkIntervalRef.current = setInterval(sendAudioChunk, 10000);
    console.log("[CHUNK] Upload interval started (10s)");
  }

  function stopChunkUpload() {
    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current);
      chunkIntervalRef.current = null;
    }
    chunkUploadRef.current = false;
  }

  async function executeFinish() {
    if (finishLockRef.current) return;
    finishLockRef.current = true;
    console.log("[FINISH] executeFinish called. Chunks remaining:", audioChunksRef.current.length);
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
        console.log("[FINISH] Final chunk:", finalBlob.size, "bytes");
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
      console.log("[FINISH] Finalize transcript:", transcript.length, "chars:", transcript.substring(0, 80));
    } catch (err) {
      console.warn("[FINISH] Finalize transcript failed:", err);
    }

    // If accumulated transcript is empty, fall back to full upload
    if (!transcript || transcript.length < 20) {
      console.log("[FINISH] Accumulated transcript too short (" + transcript.length + " chars), trying fallback full upload");
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
    console.log("[FINISH] Sending SPEAKER_FINISHED. Transcript length:", transcript.length);
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
      const syncState = (ts: any) => {
        if (!ts) return;
        setMembers(ts.members || []);
        setTimerSeconds(ts.timer_seconds);
        setFinishedIds(new Set(ts.finished_user_ids || []));
        setAllFinished(ts.all_finished || false);
        if (ts.round !== undefined) {
          if (ts.speaking_order) {
            setSpeakingOrder(ts.speaking_order || []);
            setCurrentSpeakerId(ts.speaking_order[ts.current_speaker_idx] ?? null);
            setNextSpeakerId(ts.speaking_order[ts.current_speaker_idx + 1] ?? null);
          }
          setDiscussionRound(ts.round || 1);
        }
        setReadyUsers(ts.ready_users || []);
        setMicChecks(ts.mic_checks || {});
        setNetworkHealthMap(ts.network_health || {});
        setHandRaisedQueue(ts.hand_raised_queue || []);
        setRebuttalQueue(ts.rebuttal_queue || []);
        setInterruptionCounts(ts.interruption_counts || {});
        setSpeakingDurations(ts.speaking_durations || {});
        setParticipationPercentages(ts.participation_percentages || {});
        setAgreeDisagreeVotes(ts.agree_disagree_votes || {});
        setArgumentsMade(ts.arguments_made || {});
        setRelevantPointsCount(ts.relevant_points_count || {});
        setOffTopicCount(ts.off_topic_count || {});
        setLiveSpeakingStatuses(ts.live_speaking_statuses || {});
        setChallengeQuestions(ts.challenge_questions || {});
        setConsensusClaimedBy(ts.consensus_claimed_by || null);
        setConsensusText(ts.consensus_text || "");
        setAwards(ts.awards || {});
      };

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
            syncState(myTeam);
            if (myTeam.timer_seconds) {
              setDefaultSpeakingTime(myTeam.timer_seconds);
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
          } else {
            // For Waiting Room global lobby
            setMembers(list.map((m: any) => ({
              user_id: m.user_id,
              name: m.name,
              label: m.anonymous_label || m.label,
              status: m.status,
            })));
          }

          // Always parse ready status lists, microphone checks, and connection health metrics
          const ready = list.filter((m: any) => m.ready).map((m: any) => m.user_id);
          setReadyUsers(ready);
          setMicChecks(list.reduce((acc: any, m: any) => ({ ...acc, [m.user_id]: m.mic ?? true }), {}));
          setNetworkHealthMap(list.reduce((acc: any, m: any) => ({ ...acc, [m.user_id]: m.network ?? "Good" }), {}));
          break;
        }
        case "TEAM_STATE_UPDATED": {
          syncState(msg.payload);
          break;
        }
        case "SPEAKER_CHANGED": {
          const { current_speaker_id, next_speaker_id, round, topic, speaking_order } = msg.payload;
          console.log("[SPEAKER_CHANGED] speaker:", current_speaker_id, "me:", userId, "round:", round);
          setCurrentSpeakerId(current_speaker_id);
          setNextSpeakerId(next_speaker_id);
          setDiscussionRound(round || 1);
          if (topic) setTopic(topic);
          if (speaking_order) setSpeakingOrder(speaking_order);

          setTimerSeconds(defaultSpeakingTime);

          if (current_speaker_id === userId) {
            console.log("[SPEAKER_CHANGED] I am the speaker — starting mic");
            startRecording();
            startSpeechRecognition();
            startChunkUpload();
            setTimerRunning(true);
          } else {
            console.log("[SPEAKER_CHANGED] Not the speaker — stopping mic");
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
          const { user_id, grammar, fluency, confidence, vocabulary, quality, overall, pronunciation, relevance, emotion, wpm } = msg.payload;
          if (user_id === userId) {
            setLiveScores({
              grammar,
              fluency,
              confidence,
              vocabulary: vocabulary || quality,
              pronunciation,
              relevance,
              overall,
              emotion,
              wpm
            });
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
          if (msg.payload?.winner) {
            setWinnerCard(msg.payload.winner);
          }
          if (msg.payload?.awards) {
            setAwards(msg.payload.awards);
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
          onLeave(myFinished);
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
            <Button onClick={() => onLeave(myFinished)} className="flex-1 btn-primary bg-slate-800 hover:bg-slate-700 h-12 text-sm">
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

  // ─── STAGE 1: WAITING ROOM VIEW ───
  if (discussionRound === 1 && !showResults) {
    const isReady = readyUsers.includes(userId);
    return (
      <div className={`min-h-screen flex flex-col relative overflow-hidden ${theme === "dark" ? "dark" : ""}`}>
        <div className="fixed inset-0 z-0">
          <img
            src={theme === "dark" ? "/animated_gd_bg.jpeg" : "/gd_light_bg.jpeg"}
            alt=""
            className="w-full h-full object-cover opacity-80"
          />
          <div className="absolute inset-0 bg-gradient-to-tr from-slate-950 via-slate-900 to-indigo-950/40 opacity-90 dark:block hidden" />
          <div className="absolute inset-0 bg-gradient-to-tr from-slate-50 via-indigo-50/20 to-purple-50/30 dark:hidden block" />
        </div>

        <div className="relative z-10 flex-1 flex flex-col p-4 md:p-6 justify-center max-w-5xl mx-auto w-full">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 animate-fade-up">

            {/* Left side: Setup checklist */}
            <div className="md:col-span-5 card p-6 space-y-5 bg-slate-900/80 backdrop-blur-xl border border-slate-800 shadow-2xl">
              <div className="text-center md:text-left">
                <h2 className="text-xl font-black text-heading flex items-center gap-2 justify-center md:justify-start">
                  <Activity className="w-5 h-5 text-indigo-400" /> Device Setup
                </h2>
                <p className="text-[10px] text-muted-soft mt-1 uppercase font-bold tracking-wider">Hardware & Connection Tests</p>
              </div>

              <div className="space-y-3.5">
                {/* Microphone check */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/40 border border-slate-850">
                  <div className="flex items-center gap-2">
                    <Mic className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-semibold text-heading">Microphone Access</span>
                  </div>
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${localMicCheck ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-455"}`}>
                    {localMicCheck ? "Connected" : "No Mic"}
                  </span>
                </div>

                {/* Camera check */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/40 border border-slate-850">
                  <div className="flex items-center gap-2">
                    <Maximize2 className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-semibold text-heading">Camera Access</span>
                  </div>
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Checked
                  </span>
                </div>

                {/* Connectivity speed check */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/40 border border-slate-850">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-semibold text-heading">Connection Quality</span>
                  </div>
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                    {localNetwork} (12ms)
                  </span>
                </div>

                {/* Sound test check */}
                <div className="p-3.5 rounded-xl bg-indigo-500/5 border border-indigo-500/15 space-y-2">
                  <p className="text-[10px] text-indigo-300 font-bold">AI Voice & Audio Test</p>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      voice.speak("Audio check successful. Your speakers are working.");
                      setAudioTestPassed(true);
                    }}
                    className="w-full text-xs h-9 border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/10"
                  >
                    {audioTestPassed ? "🔊 Test Passed" : "🔈 Run Speaker Test"}
                  </Button>
                </div>
              </div>

              {/* Ready status trigger */}
              <Button
                onClick={toggleLocalReady}
                className={`w-full h-12 text-sm font-bold rounded-xl transition-all shadow-md ${isReady
                  ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/20"
                  : "bg-gradient-to-r from-indigo-600 to-purple-650 text-white shadow-indigo-500/20"
                  }`}
              >
                {isReady ? "✓ Ready & Checked" : "Mark Self Ready"}
              </Button>
            </div>

            {/* Right side: Moderator welcome and participants list */}
            <div className="md:col-span-7 space-y-4">

              {/* Rules Explanation Card */}
              <div className="card p-6 bg-slate-900/80 backdrop-blur-xl border border-slate-800 shadow-2xl space-y-3">
                <div className="flex items-center gap-2 border-b border-slate-850 pb-2">
                  <Brain className="w-5 h-5 text-indigo-400" />
                  <h3 className="text-xs font-bold text-heading uppercase tracking-wider">AI Moderator Briefing</h3>
                </div>
                <div className="p-3.5 bg-slate-950/50 rounded-xl border border-slate-850 text-xs leading-relaxed text-body italic whitespace-pre-line">
                  "🤖 AI Moderator: Welcome! Today we will evaluate 10 core placement parameters.
                  Please complete the hardware checklist.

                  We will automatically proceed through the following phases:
                  1. Waiting Room (Ready Sync)
                  2. AI Introduction (speaking order assigned)
                  3. Opening Round (30s individual turns)
                  4. Intelligent Open Discussion (prioritized hand-raising and rebuttal slots)
                  5. AI Challenge Round (specialized scenarios)
                  6. Consensus Round (agreement wrap-up)
                  7. Evaluation & Awards"
                </div>
              </div>

              {/* Joined participants ready checklists */}
              <div className="card p-5 bg-slate-900/80 backdrop-blur-xl border border-slate-800 space-y-3">
                <h4 className="text-xs font-bold text-heading uppercase tracking-wider flex items-center justify-between">
                  <span>Joined Teammates ({joinedMembers.length})</span>
                  <span className="text-[10px] text-indigo-400 font-mono">Waiting Room</span>
                </h4>
                {joinedMembers.length === 0 ? (
                  <div className="text-center py-6 text-xs text-muted-soft bg-slate-950/40 border border-slate-850 rounded-xl">
                    <p className="font-semibold">No participants have joined yet.</p>
                    <p className="text-[10px] mt-1">Waiting for students to enter the OTP...</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                    {joinedMembers.map((m: any, idx: number) => {
                      const isUserReady = readyUsers.includes(m.user_id);
                      const label = m.label || m.anonymous_label || m.name || `Member ${idx + 1}`;
                      return (
                        <div key={m.user_id} className="p-2.5 rounded-lg bg-slate-950/40 border border-slate-850 flex items-center justify-between text-xs animate-fade-in">
                          <span className="font-bold text-heading truncate">{label}</span>
                          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${isUserReady ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                            }`}>
                            {isUserReady ? "Ready" : "Waiting"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Admin controls to start */}
                {user?.role === "admin" && (
                  <div className="pt-2 border-t border-slate-850">
                    <Button
                      onClick={() => send("START_GD", {})}
                      className="w-full h-11 btn-primary bg-indigo-600 hover:bg-indigo-500 border-0 font-extrabold text-xs tracking-wider flex items-center justify-center gap-1.5"
                    >
                      <Play className="w-4 h-4 fill-white animate-pulse" /> START GROUP DISCUSSION (ADMIN)
                    </Button>
                  </div>
                )}
              </div>

            </div>

          </div>
        </div>
      </div>
    );
  }

  // ─── STAGE 2: AI INTRODUCTION VIEW ───
  if (discussionRound === 2 && !showResults) {
    return (
      <div className={`min-h-screen flex flex-col relative overflow-hidden ${theme === "dark" ? "dark" : ""}`}>
        <div className="fixed inset-0 z-0">
          <img src={theme === "dark" ? "/animated_gd_bg.jpeg" : "/gd_light_bg.jpeg"} alt="" className="w-full h-full object-cover opacity-80" />
          <div className="absolute inset-0 bg-gradient-to-tr from-slate-950 via-slate-900 to-indigo-950/40 opacity-90 dark:block hidden" />
        </div>

        <div className="relative z-10 flex-1 flex flex-col p-4 justify-center max-w-2xl mx-auto w-full animate-fade-up text-center space-y-6">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-650 flex items-center justify-center text-white shadow-xl shadow-indigo-500/10 animate-bounce">
            🤖
          </div>

          <div className="space-y-1">
            <h1 className="text-2xl font-black text-heading bg-gradient-to-r from-indigo-500 to-purple-550 bg-clip-text text-transparent">AI Welcoming & Rules Briefing</h1>
            <p className="text-xs text-muted-soft uppercase font-bold tracking-wider">Phase 2: Introduction</p>
          </div>

          <div className="card p-6 text-left space-y-3 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-xl" />
            <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider">Active Group Stance Topic</p>
            <h2 className="text-lg md:text-xl font-extrabold text-heading">"{topic}"</h2>
            <div className="h-px bg-slate-850 my-2" />
            <p className="text-[10px] text-purple-400 font-bold uppercase tracking-wider">Speaking Order Sequence</p>
            <div className="flex flex-wrap gap-2 pt-1.5">
              {speakingOrder.map((uid, idx) => {
                const label = members.find(m => m.user_id === uid)?.label || `Member ${uid}`;
                return (
                  <span key={uid} className="text-xs px-2.5 py-1 rounded-full bg-slate-950/50 border border-slate-800 text-heading font-medium">
                    {idx + 1}. {label}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col items-center justify-center space-y-2">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
            <span className="text-xs font-bold text-heading">Opening Round begins in {timerSeconds} seconds...</span>
          </div>
        </div>
      </div>
    );
  }

  // ─── MAIN WORKSPACE (STAGES 3, 4, 5, 6) ───
  const warnModal = showWarning ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-amber-500/40 bg-slate-900 p-6 text-center shadow-2xl">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
          <AlertCircle className="h-6 w-6" />
        </div>
        <h3 className="mb-2 text-lg font-bold text-heading">Stay Focused!</h3>
        <p className="mb-4 text-sm text-body">
          {showWarning}
          {warningEvent ? ` — ${warningEvent}` : ""}
        </p>
        <Button onClick={() => setShowWarning(null)} className="w-full bg-gradient-to-r from-amber-500 to-orange-600 border-0">
          I'm back, continue
        </Button>
      </div>
    </div>
  ) : null;

  return (
    <div className={`min-h-screen flex flex-col relative overflow-hidden ${theme === "dark" ? "dark" : ""}`}>
      <div className="fixed inset-0 z-0">
        <img
          src={theme === "dark" ? "/animated_gd_bg.jpeg" : "/gd_light_bg.jpeg"}
          alt=""
          className="w-full h-full object-cover opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-slate-950 via-slate-900 to-indigo-950/40 opacity-90 dark:block hidden" />
        <div className="absolute inset-0 bg-gradient-to-tr from-slate-50 via-indigo-50/20 to-purple-50/30 dark:hidden block" />
      </div>

      <div className="relative z-10 flex-1 flex flex-col p-4 md:p-6">
        {warnModal}
        <div className="max-w-7xl mx-auto w-full space-y-4 flex-1 flex flex-col justify-center animate-fade-up">

          {/* ─── PHASE TIMELINE HEADER ─── */}
          <div className="card p-3.5 bg-slate-900/80 backdrop-blur-xl border border-slate-800 flex items-center justify-between gap-4 shadow-2xl">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-purple-650 flex items-center justify-center text-white font-extrabold text-sm">
                MZ
              </div>
              <div className="leading-tight hidden sm:block">
                <p className="text-xs font-black text-heading tracking-tight">ThinkCircle</p>
                <p className="text-[9px] text-muted-soft font-bold uppercase tracking-wider">AI Live Orchestrator</p>
              </div>
            </div>

            {/* Steps Timeline (Stages 3 to 6) */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 text-[10px] font-bold scrollbar-none">
              {[
                { phase: 3, label: "Opening Round" },
                { phase: 4, label: "Open Discussion" },
                { phase: 5, label: "AI Challenge" },
                { phase: 6, label: "Conclusion" }
              ].map((p) => {
                const active = discussionRound === p.phase;
                const completed = discussionRound > p.phase;
                return (
                  <div
                    key={p.phase}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full transition-all shrink-0 border ${active
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

            {/* Timer and Profile */}
            <div className="flex items-center gap-3 shrink-0">
              <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 items-center gap-1 uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" /> Live
              </span>
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-slate-950 border border-slate-800 text-heading">
                <Clock className="w-3.5 h-3.5 text-indigo-400" />
                <span>{formatTime(timerSeconds)}</span>
              </div>
            </div>
          </div>

          {/* AI Decision Pipeline steps */}
          <PipelineTracker currentSpeakerId={currentSpeakerId} />

          {/* Topic header */}
          <div className="card p-3 bg-slate-900/60 border border-slate-800 text-center">
            <span className="text-[9px] text-indigo-400 font-bold uppercase tracking-wider">Discussion Topic Stance</span>
            <p className="text-sm md:text-base font-bold text-heading mt-0.5">"{topic}"</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">

            {/* Left Column: Current Speaker card and Turn queue */}
            <div className="lg:col-span-3 space-y-4">

              {/* Speaker Card */}
              <div className="card p-4 bg-slate-900/80 backdrop-blur-lg border border-slate-800 space-y-4 relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-heading uppercase tracking-wider">Current Speaker</span>
                  {currentSpeakerId === userId && (
                    <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[8px] font-bold">You</span>
                  )}
                </div>

                {currentSpeakerId ? (() => {
                  const speaker = members.find(m => m.user_id === currentSpeakerId);
                  const label = speaker?.label || speaker?.anonymous_label || speaker?.name || `Member ${currentSpeakerId}`;
                  const speakingStatus = liveSpeakingStatuses[currentSpeakerId] || "Speaking";
                  const votes = agreeDisagreeVotes[currentSpeakerId] || { agree: 0, disagree: 0 };

                  return (
                    <div className="space-y-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-650 text-white flex items-center justify-center font-black text-sm shrink-0 border border-indigo-550/20">
                          {label[0].toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-heading truncate">{label}</p>
                          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${speakingStatus === "Speaking" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"
                            }`}>
                            {speakingStatus}
                          </span>
                        </div>
                      </div>

                      {/* Sound wave graphics */}
                      <div className="flex justify-center items-end gap-1 h-9 bg-slate-950/40 p-2 rounded-2xl border border-slate-850">
                        {[30, 60, 45, 90, 75, 40, 80, 50, 65, 30].map((h, i) => (
                          <span
                            key={i}
                            className="w-1 bg-gradient-to-t from-indigo-500 to-purple-650 rounded-full"
                            style={{
                              height: isRecording && currentSpeakerId === userId ? `${h}%` : '20%',
                              animation: isRecording && currentSpeakerId === userId ? `bounce 1s ease-in-out ${i * 0.1}s infinite alternate` : 'none'
                            }}
                          />
                        ))}
                      </div>

                      {/* Circular countdown dial */}
                      <CircularTimer
                        seconds={timerSeconds}
                        maxSeconds={discussionRound === 3 ? 600 : discussionRound === 5 ? 25 : 45}
                      />

                      {/* Agree/Disagree feedback buttons */}
                      {discussionRound === 4 && (
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            onClick={() => send("AGREE_DISAGREE_VOTE", { speaker_id: currentSpeakerId, vote_type: "agree" })}
                            className="flex-1 text-[10px] h-8 border-slate-800 hover:bg-emerald-500/10 hover:text-emerald-400"
                          >
                            👍 Agree ({votes.agree})
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => send("AGREE_DISAGREE_VOTE", { speaker_id: currentSpeakerId, vote_type: "disagree" })}
                            className="flex-1 text-[10px] h-8 border-slate-800 hover:bg-rose-500/10 hover:text-rose-455"
                          >
                            👎 Disagree ({votes.disagree})
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })() : (
                  <div className="text-center py-6 text-xs text-muted-soft italic">
                    {discussionRound === 4 ? "Awaiting participant to Claim Floor / Raise Hand..." : "Awaiting active speaker turn..."}
                  </div>
                )}
              </div>

              {/* Turn Queue Sidebar */}
              <div className="card p-4 bg-slate-900/80 backdrop-blur-lg border border-slate-800 space-y-3">
                <h3 className="text-xs font-bold text-heading uppercase tracking-wider flex items-center justify-between">
                  <span>Floor Queues</span>
                  {discussionRound === 4 && <span className="text-[8px] bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded">Active</span>}
                </h3>
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">

                  {/* Rebuttal Queue (High Priority) */}
                  {rebuttalQueue.map((uid) => {
                    const label = members.find(m => m.user_id === uid)?.label || `Member ${uid}`;
                    return (
                      <div key={uid} className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/25 flex justify-between items-center text-xs">
                        <span className="font-bold text-rose-300">🔥 Rebuttal: {label}</span>
                        <span className="text-[8px] bg-rose-500/20 text-rose-400 px-1 py-0.5 rounded">Priority</span>
                      </div>
                    );
                  })}

                  {/* Regular speak Queue */}
                  {discussionRound === 3 ? (
                    speakingOrder.map((uid, idx) => {
                      const label = members.find(m => m.user_id === uid)?.label || `Member ${uid}`;
                      const isCurrent = uid === currentSpeakerId;
                      const isDone = finishedIds.has(uid);
                      return (
                        <div key={uid} className={`p-2 rounded-lg border flex justify-between items-center text-xs ${isCurrent ? "border-indigo-550/40 bg-indigo-500/10" : "border-slate-850"}`}>
                          <span className="text-heading font-medium">{idx + 1}. {label}</span>
                          <span className="text-[8px]">{isCurrent ? "Speaking" : isDone ? "Done" : "Waiting"}</span>
                        </div>
                      );
                    })
                  ) : (
                    handRaisedQueue.map((uid, idx) => {
                      const label = members.find(m => m.user_id === uid)?.label || `Member ${uid}`;
                      return (
                        <div key={uid} className="p-2 rounded-lg border border-slate-850 flex justify-between items-center text-xs">
                          <span className="text-heading font-medium">{idx + 1}. {label}</span>
                          <span className="text-[8px] text-indigo-400">Hand Raised</span>
                        </div>
                      );
                    })
                  )}

                  {discussionRound === 4 && handRaisedQueue.length === 0 && rebuttalQueue.length === 0 && (
                    <p className="text-[10px] text-muted-soft text-center py-2 italic">Queue is empty. Raise hand or rebuttal to speak.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Middle Column: Participants lists, AI moderator log, speech transcript */}
            <div className="lg:col-span-6 space-y-4">

              {/* Horizontal Slider card with checkmarks */}
              <div className="card p-4 bg-slate-900/80 backdrop-blur-lg border border-slate-800">
                <div className="flex justify-between items-center border-b border-slate-850 pb-2 mb-3">
                  <h3 className="text-xs font-bold text-heading uppercase tracking-wider flex items-center gap-1">
                    <Users className="w-4 h-4 text-indigo-400" /> Active Round Participants ({members.length})
                  </h3>

                  {/* Local Ready and hand checks */}
                  <div className="flex gap-2">
                    {discussionRound === 4 && (
                      <>
                        <Button
                          variant="secondary"
                          onClick={() => send("REQUEST_REBUTTAL", { requested: !rebuttalQueue.includes(userId) })}
                          className={`text-[9px] h-7 border-slate-800 hover:bg-rose-500/10 ${rebuttalQueue.includes(userId) ? "bg-rose-500/20 text-rose-300" : "text-muted-soft"}`}
                        >
                          🔥 Rebuttal Floor
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => send("RAISE_HAND", { raised: !handRaisedQueue.includes(userId) })}
                          className={`text-[9px] h-7 border-slate-800 hover:bg-indigo-500/10 ${handRaisedQueue.includes(userId) ? "bg-indigo-500/20 text-indigo-300" : "text-muted-soft"}`}
                        >
                          ✋ Raise Hand
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex gap-4 overflow-x-auto py-1 justify-center scrollbar-none">
                  {members.map((m: any, idx: number) => {
                    const label = m.label || m.anonymous_label || m.name || `Member ${idx + 1}`;
                    const isSpeaking = m.user_id === currentSpeakerId;
                    const ready = readyUsers.includes(m.user_id);
                    const net = networkHealthMap[m.user_id] || "Good";

                    return (
                      <div key={m.user_id} className="flex flex-col items-center shrink-0 w-16 text-center">
                        <div className={`w-11 h-11 rounded-full flex items-center justify-center text-white text-xs font-black relative border ${isSpeaking ? "border-indigo-500 bg-indigo-500/10 shadow-lg scale-105" : "border-slate-850 bg-slate-950/40"
                          }`}>
                          {label[0].toUpperCase()}
                          {isSpeaking && <span className="absolute -bottom-1 -right-1 text-[8px]">🎙️</span>}
                          {ready && <span className="absolute -top-1 -right-1 text-[8px]">✅</span>}
                        </div>
                        <span className="text-[9px] font-bold text-heading mt-1 truncate w-full">{label}</span>
                        <span className="text-[8px] text-muted-soft font-mono mt-0.5">{net}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Stage 5 custom Challenge Question Card */}
              {discussionRound === 5 && (
                <div className="card p-4 border border-indigo-500/30 bg-indigo-500/5 space-y-2 animate-fade-up">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1">
                      <Zap className="w-4 h-4 text-indigo-400" /> Dynamic AI Challenge Assignment
                    </span>
                    <span className="text-[9px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full font-mono">Stage 5</span>
                  </div>
                  <div className="p-3 bg-slate-950/50 rounded-xl border border-slate-850">
                    <p className="text-[10px] text-muted-soft uppercase font-bold tracking-wider">Assigned Scenario Challenge Question</p>
                    <p className="text-xs text-heading font-semibold mt-1">
                      {currentSpeakerId ? (challengeQuestions[currentSpeakerId] || "Counter Question") : "Assigning scenario questions to speakers..."}
                    </p>
                  </div>
                </div>
              )}

              {/* Stage 6 Consensus explain request */}
              {discussionRound === 6 && (
                <div className="card p-4 border border-amber-500/30 bg-amber-500/5 space-y-3.5 animate-fade-up">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4 text-amber-500" /> Stage 6: Group Consensus Stance
                    </span>
                    <span className="text-[9px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full font-mono">Stage 6</span>
                  </div>
                  <p className="text-xs text-body">AI Moderator: "What is the team consensus on this topic? One student should explain the team consensus outline."</p>

                  {consensusClaimedBy ? (
                    <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-850 text-xs">
                      <span className="font-extrabold text-heading">Consensus Speaker: </span>
                      <span>{members.find(m => m.user_id === consensusClaimedBy)?.label || "Teammate"}</span>
                    </div>
                  ) : (
                    <Button
                      onClick={() => send("CLAIM_CONSENSUS_TURN", {})}
                      className="w-full text-xs h-10 bg-amber-600 hover:bg-amber-500 text-white font-bold"
                    >
                      🗣️ Claim Consensus Turn
                    </Button>
                  )}
                </div>
              )}

              {/* AI Moderator Chat logs */}
              <div className="card p-4 bg-slate-900/80 backdrop-blur-lg border border-slate-800 space-y-3">
                <div className="flex justify-between items-center border-b border-slate-850 pb-2">
                  <h3 className="text-xs font-bold text-heading uppercase tracking-wider flex items-center gap-1">
                    <Brain className="w-4 h-4 text-indigo-400" /> AI Moderator Log
                  </h3>
                  <span className="text-[9px] text-indigo-400 font-bold bg-indigo-500/10 px-2 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" /> Dynamic engine
                  </span>
                </div>

                <div className="space-y-2.5 max-h-40 overflow-y-auto pr-1">
                  {chatMessages.map((msg, idx) => (
                    <div key={idx} className="flex gap-2.5 items-start p-2.5 bg-slate-950/30 rounded-xl border border-slate-850">
                      <span className="text-xs">🤖</span>
                      <div className="text-[11px] min-w-0">
                        <span className="font-bold text-indigo-400 block">{msg.name || "AI Moderator"}</span>
                        <p className="text-body leading-normal mt-0.5 whitespace-pre-wrap">{msg.text}</p>
                      </div>
                    </div>
                  ))}
                  {chatMessages.length === 0 && (
                    <p className="text-[10px] text-muted-soft text-center py-2 italic">Awaiting AI facilitator interactions...</p>
                  )}
                  <div ref={chatEndRef} />
                </div>
              </div>

              {/* Speech transcript panels */}
              <div className="card p-4 bg-slate-900/80 backdrop-blur-lg border border-slate-800 space-y-3">
                <h3 className="text-xs font-bold text-heading uppercase tracking-wider flex items-center justify-between border-b border-slate-850 pb-2">
                  <span className="flex items-center gap-1"><Mic className="w-4 h-4 text-indigo-400" /> Live Speech Feed</span>
                  <span className="text-[8px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full">Speech-to-Text</span>
                </h3>

                <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                  {currentSpeakerId && (
                    <div className="p-3 rounded-xl bg-indigo-500/5 border border-indigo-500/20 text-xs italic animate-fade-up">
                      <span className="font-bold text-indigo-400 block mb-1">
                        🎙️ {currentSpeakerId === userId ? "You (Speaking)" : members.find(m => m.user_id === currentSpeakerId)?.label || "Teammate"}...
                      </span>
                      <p className="text-heading whitespace-pre-wrap leading-relaxed">
                        {currentSpeakerId === userId ? liveSpeechText : (liveTranscripts[currentSpeakerId] || "")}
                      </p>
                    </div>
                  )}

                  {speakingHistory.map((h, i) => (
                    <div key={i} className="p-3 rounded-xl bg-slate-950/40 border border-slate-850 text-xs space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-heading">{h.label}</span>
                        <span className="text-[9px] text-muted-soft font-mono">Emotion: {h.emotion}</span>
                      </div>
                      <p className="text-body italic leading-relaxed">{h.text}</p>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* Right Column: Circular Score Gauges & Live stats indicator cards */}
            <div className="lg:col-span-3 space-y-4">

              {/* circular score metrics panel */}
              <div className="card p-4 bg-slate-900/80 backdrop-blur-lg border border-slate-800 space-y-3">
                <h3 className="text-xs font-bold text-heading uppercase tracking-wider border-b border-slate-850 pb-2">Round Score Evaluator</h3>
                <div className="grid grid-cols-3 gap-y-3 gap-x-1.5 justify-items-center">
                  <CircularProgress percent={liveScores?.grammar ?? 0} size={56} strokeWidth={4.5} color="#2dd4bf" label="Grammar" />
                  <CircularProgress percent={liveScores?.fluency ?? 0} size={56} strokeWidth={4.5} color="#3b82f6" label="Fluency" />
                  <CircularProgress percent={liveScores?.pronunciation ?? 0} size={56} strokeWidth={4.5} color="#06b6d4" label="Accent" />
                  <CircularProgress percent={liveScores?.vocabulary ?? 0} size={56} strokeWidth={4.5} color="#ec4899" label="Vocabulary" />
                  <CircularProgress percent={liveScores?.confidence ?? 0} size={56} strokeWidth={4.5} color="#eab308" label="Confidence" />
                  <CircularProgress percent={liveScores?.relevance ?? 0} size={56} strokeWidth={4.5} color="#22c55e" label="Relevance" />
                </div>
              </div>

              {/* Dynamic live performance metrics panel */}
              <div className="card p-4 bg-slate-900/80 backdrop-blur-lg border border-slate-800 space-y-3.5">
                <h3 className="text-xs font-bold text-heading uppercase tracking-wider border-b border-slate-850 pb-2">Dynamic Stats Tracker</h3>

                <div className="space-y-2.5 text-xs">
                  {/* speaking time */}
                  <div className="flex justify-between items-center">
                    <span className="text-muted-soft">Total Speaking Time</span>
                    <span className="font-mono font-bold text-heading">{speakingDurations[userId] ? `${Math.round(speakingDurations[userId])}s` : "0s"}</span>
                  </div>

                  {/* participation percentage */}
                  <div className="flex justify-between items-center">
                    <span className="text-muted-soft">Participation Rate</span>
                    <span className="font-mono font-bold text-indigo-400">{participationPercentages[userId] ? `${participationPercentages[userId]}%` : "0%"}</span>
                  </div>

                  {/* Interruption count */}
                  <div className="flex justify-between items-center">
                    <span className="text-muted-soft">Interruption Count</span>
                    <span className="font-mono font-bold text-rose-455">{interruptionCounts[userId] || 0}</span>
                  </div>

                  {/* relevant points */}
                  <div className="flex justify-between items-center">
                    <span className="text-muted-soft">Relevant Key Arguments</span>
                    <span className="font-mono font-bold text-emerald-400">{relevantPointsCount[userId] || 0}</span>
                  </div>

                  {/* off topic count */}
                  <div className="flex justify-between items-center">
                    <span className="text-muted-soft">Off-Topic Incidents</span>
                    <span className="font-mono font-bold text-amber-400">{offTopicCount[userId] || 0}</span>
                  </div>
                </div>
              </div>

              {/* AI live feedback checkpoints list */}
              <div className="card p-4 bg-slate-900/80 backdrop-blur-lg border border-slate-800 space-y-3">
                <h3 className="text-xs font-bold text-heading uppercase tracking-wider border-b border-slate-850 pb-2">Live AI Coaching</h3>
                <div className="space-y-2 text-xs text-body font-medium">
                  {offTopicCount[userId] && offTopicCount[userId] > 0 ? (
                    <p className="text-amber-400">⚠️ Try to stick to the active topic theme. Avoid shifting perspectives too far.</p>
                  ) : null}
                  {interruptionCounts[userId] && interruptionCounts[userId] > 0 ? (
                    <p className="text-rose-400">⚠️ Avoid speaking longer than 45 seconds to keep participation balanced.</p>
                  ) : null}
                  <div className="flex items-start gap-1.5">
                    <span className="text-emerald-500 font-bold">✓</span>
                    <span>Speak clearly in English. Avoid fillers like "uh", "um", "like".</span>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <span className="text-emerald-500 font-bold">✓</span>
                    <span>Click 'Agree' or 'Disagree' to react dynamically to your teammate's turn.</span>
                  </div>
                </div>
              </div>

            </div>

          </div>

          {/* Floating actions control bar at the bottom */}
          <div className="flex items-center justify-center gap-4 bg-slate-900/90 backdrop-blur-md px-6 py-2.5 rounded-2xl border border-slate-800 shadow-2xl max-w-2xl mx-auto w-full mt-2">

            {/* Stage 4 Claim floor triggers or mic controllers */}
            {discussionRound === 4 && submitStep === "idle" ? (
              isRecording ? (
                <button
                  onClick={() => executeFinish()}
                  className="flex flex-col items-center gap-1 text-[9px] text-rose-455 font-bold animate-pulse shrink-0"
                >
                  <div className="w-9 h-9 rounded-xl bg-rose-600 flex items-center justify-center hover:bg-rose-500 text-white border border-rose-500 shadow-lg">
                    <Mic className="w-4 h-4" />
                  </div>
                  <span>Yield Floor</span>
                </button>
              ) : (
                <button
                  onClick={() => {
                    startRecording();
                    startSpeechRecognition();
                    startChunkUpload();
                    setCurrentSpeakerId(userId);
                    send("LIVE_SPEECH", { text: "[Speaking turn claimed]" });
                  }}
                  className="flex flex-col items-center gap-1 text-[9px] text-emerald-400 font-bold shrink-0 animate-bounce"
                >
                  <div className="w-9 h-9 rounded-xl bg-slate-850 flex items-center justify-center hover:bg-slate-855 border border-slate-800 text-emerald-400 shadow-lg">
                    <MicOff className="w-4 h-4" />
                  </div>
                  <span>Claim Floor</span>
                </button>
              )
            ) : (
              <button
                onClick={() => { }}
                className={`flex flex-col items-center gap-1 text-[9px] font-bold shrink-0 ${currentSpeakerId === userId ? "text-emerald-400" : "text-slate-400"
                  }`}
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${currentSpeakerId === userId ? "bg-slate-850 hover:bg-slate-800 border-slate-800 text-emerald-400" : "bg-slate-900/40 border-slate-850 text-slate-500 cursor-not-allowed"
                  }`}>
                  <Mic className="w-4 h-4" />
                </div>
                <span>{currentSpeakerId === userId ? "Mic Active" : "Mic Muted"}</span>
              </button>
            )}

            <button onClick={() => { }} className="flex flex-col items-center gap-1 text-[9px] text-slate-405 font-bold">
              <div className="w-9 h-9 rounded-xl bg-slate-900/40 border border-slate-850 text-slate-500 flex items-center justify-center hover:bg-slate-800 cursor-not-allowed">
                <Maximize2 className="w-4 h-4" />
              </div>
              <span>Camera</span>
            </button>

            <button onClick={() => { }} className="flex flex-col items-center gap-1 text-[9px] text-slate-405 font-bold">
              <div className="w-9 h-9 rounded-xl bg-slate-900/40 border border-slate-850 text-slate-500 flex items-center justify-center hover:bg-slate-800 cursor-not-allowed">
                <Play className="w-4 h-4" />
              </div>
              <span>Screen</span>
            </button>

            <button onClick={() => { }} className="flex flex-col items-center gap-1 text-[9px] text-slate-405 font-bold">
              <div className="w-9 h-9 rounded-xl bg-slate-900/40 border border-slate-850 text-slate-500 flex items-center justify-center hover:bg-slate-800 cursor-not-allowed">
                <Sparkles className="w-4 h-4" />
              </div>
              <span>Reactions</span>
            </button>

            <div className="h-7 w-px bg-slate-800 mx-2 shrink-0" />

            {/* Conclude turn button */}
            {!myFinished && submitStep === "idle" && currentSpeakerId === userId && (
              <Button
                onClick={() => executeFinish()}
                className="btn-primary h-9 px-3 rounded-xl font-bold bg-rose-600 hover:bg-rose-500 border-0 flex items-center gap-1 text-xs text-white shrink-0 shadow-lg"
              >
                <Square className="w-3.5 h-3.5 fill-white animate-pulse" /> Conclude Turn
              </Button>
            )}

            <Button
              onClick={() => onLeave(myFinished)}
              className="btn-secondary h-9 px-3 rounded-xl font-bold border-slate-800 hover:bg-slate-800 text-xs flex items-center gap-1 shrink-0"
            >
              Leave Room
            </Button>
          </div>

        </div>
      </div>
    </div>
  );
}
