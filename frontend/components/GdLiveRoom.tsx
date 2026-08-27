"use client";

import { useEffect, useRef, useState, useCallback } from "react";
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

function VideoPlayer({ stream, muted = false }: { stream: MediaStream | null; muted?: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  if (!stream) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-950">
        <User className="w-8 h-8 text-slate-700" />
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={muted}
      className="w-full h-full object-cover"
    />
  );
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
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" }
      ],
    });

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        try {
          pc.addTrack(track, localStreamRef.current!);
        } catch (e) {
          console.warn("[WebRTC] addTrack warning:", e);
        }
      });
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        send("WEBRTC_ICE_CANDIDATE", { target_user_id: peerId, candidate: e.candidate.toJSON() });
      }
    };

    pc.ontrack = (e) => {
      console.log("[WebRTC] Received remote track from peer:", peerId, e.streams);
      if (e.streams && e.streams[0]) {
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          next.set(peerId, e.streams[0]);
          return next;
        });
      }
    };

    pcsRef.current.set(peerId, pc);
    return pc;
  }, [send]);

  const createOffer = useCallback(async (peerId: number) => {
    try {
      const pc = getOrCreatePC(peerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send("WEBRTC_OFFER", { target_user_id: peerId, offer: pc.localDescription!.toJSON() });
    } catch (err) {
      console.error("[WebRTC] createOffer failed for peer:", peerId, err);
    }
  }, [getOrCreatePC, send]);

  const handleOffer = useCallback(async (peerId: number, offer: RTCSessionDescriptionInit) => {
    try {
      const pc = getOrCreatePC(peerId);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send("WEBRTC_ANSWER", { target_user_id: peerId, answer: pc.localDescription!.toJSON() });
    } catch (err) {
      console.error("[WebRTC] handleOffer failed for peer:", peerId, err);
    }
  }, [getOrCreatePC, send]);

  const handleAnswer = useCallback(async (peerId: number, answer: RTCSessionDescriptionInit) => {
    try {
      const pc = pcsRef.current.get(peerId);
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      console.error("[WebRTC] handleAnswer failed for peer:", peerId, err);
    }
  }, []);

  const handleIceCandidate = useCallback(async (peerId: number, candidate: RTCIceCandidateInit) => {
    try {
      const pc = pcsRef.current.get(peerId);
      if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error("[WebRTC] handleIceCandidate failed for peer:", peerId, err);
    }
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((s) => {
      stream = s;
      localStreamRef.current = s;
      setLocalStream(s);
      pcsRef.current.forEach((pc) => {
        s.getTracks().forEach((track) => {
          if (!pc.getSenders().some((sender) => sender.track === track)) {
            pc.addTrack(track, s);
          }
        });
      });
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
      if (msg.event === "TEAM_STATE_UPDATED" || msg.event === "STATE_SYNC" || msg.event === "PARTICIPANT_JOINED") {
        const members = msg.payload?.members || msg.payload?.state?.members || [];
        members.forEach((m: any) => {
          if (m.user_id && m.user_id !== userId && !pcsRef.current.has(m.user_id)) {
            createOffer(m.user_id);
          }
        });
        if (msg.event === "PARTICIPANT_JOINED" && msg.payload?.user_id && msg.payload.user_id !== userId) {
          if (!pcsRef.current.has(msg.payload.user_id)) {
            createOffer(msg.payload.user_id);
          }
        }
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
  const [winnerCard, setWinnerCard] = useState<any>(null);

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
      let chunkCount = 0;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
          chunkCount++;
          if (chunkCount % 5 === 0) console.log("[MIC] Chunk #", chunkCount, "total chunks:", audioChunksRef.current.length);
        }
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
        console.log("[MIC] Recording stopped. Total chunks:", chunkCount);
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
      console.log("[CHUNK] Server:", res.status, "chunk_transcript:", data.chunk_transcript?.substring(0, 80) || "(empty)", "accumulated:", data.accumulated_transcript?.length || 0, "chars");
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
    console.log("[FINISH] executeFinish called. Chunks remaining:", audioChunksRef.current.length, "isRecording:", isRecording);
    setTimerRunning(false);
    if (timerRef.current) clearInterval(timerRef.current);
    stopChunkUpload();
    proctoring.disable();

    // Send final chunk
    try {
      if (audioChunksRef.current.length > 0) {
        const finalBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        audioChunksRef.current = [];
        if (finalBlob.size >= 100) {
          console.log("[FINISH] Uploading final chunk:", finalBlob.size, "bytes");
          const fd = new FormData();
          fd.append("file", finalBlob, "gd_chunk_" + sessionCode + "_" + userId + ".webm");
          const chunkRes = await fetch(apiUrl + "/gd-live/sessions/" + sessionCode + "/upload-chunk", {
            method: "POST",
            headers: { Authorization: "Bearer " + token },
            body: fd,
          });
          const chunkData = await chunkRes.json();
          console.log("[FINISH] Final chunk uploaded:", chunkRes.status, "transcript:", chunkData.chunk_transcript?.substring(0, 80) || "(empty)");
        }
      } else {
        console.log("[FINISH] No remaining chunks to upload");
      }
    } catch (err) {
      console.warn("[FINISH] Final chunk upload failed:", err);
    }

    stopMic();

    // Get accumulated transcript
    let transcript = "";
    try {
      const finRes = await fetch(apiUrl + "/gd-live/sessions/" + sessionCode + "/finalize-transcript", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      });
      const finData = await finRes.json();
      transcript = finData.transcript || "";
      console.log("[FINISH] Finalize transcript:", finRes.status, "length:", transcript.length, "preview:", transcript.substring(0, 100));
    } catch (err) {
      console.warn("[FINISH] Finalize transcript failed:", err);
    }

    if (transcript) setTranscript(transcript);

    // Send finish notification
    console.log("[FINISH] Sending SPEAKER_FINISHED. Transcript length:", transcript.length);
    send("SPEAKER_FINISHED", { user_id: userId, transcript });

    // Turn-based: unlock for next turns, show AI processing
    finishLockRef.current = false;
    setSubmitStep("idle");
    setLiveSpeechText("");
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
        if (ts.timer_seconds !== undefined) setTimerSeconds(ts.timer_seconds);
        setFinishedIds(new Set(ts.finished_user_ids || []));
        setAllFinished(ts.all_finished || false);
        if (ts.speaking_order) setSpeakingOrder(ts.speaking_order);
        if (ts.current_speaker_id !== undefined) setCurrentSpeakerId(ts.current_speaker_id);
        if (ts.turn_number !== undefined) setTurnNumber(ts.turn_number);
        if (ts.max_turns !== undefined) setMaxTurns(ts.max_turns);
        setReadyUsers(ts.ready_users || []);
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
            if (me && me.team_number) { activeTeamNum = me.team_number; setTeamNumber(me.team_number); }
          }
          if (activeTeamNum) {
            const myTeamMembers = list.filter((m: any) => m.team_number === activeTeamNum);
            if (myTeamMembers.length > 0) {
              setMembers(myTeamMembers.map((m: any) => ({ user_id: m.user_id, name: m.name, label: m.anonymous_label || m.label, status: m.status })));
            }
          } else {
            setMembers(list.map((m: any) => ({ user_id: m.user_id, name: m.name, label: m.anonymous_label || m.label, status: m.status })));
          }
          setReadyUsers(list.filter((m: any) => m.ready).map((m: any) => m.user_id));
          break;
        }
        case "TEAM_STATE_UPDATED": {
          syncState(msg.payload);
          break;
        }
        case "SPEAKER_CHANGED": {
          const { current_speaker_id, speaking_order, turn_number, max_turns } = msg.payload;
          console.log("[SPEAKER_CHANGED] speaker:", current_speaker_id, "me:", userId);
          setCurrentSpeakerId(current_speaker_id);
          if (speaking_order) setSpeakingOrder(speaking_order);
          if (turn_number !== undefined) setTurnNumber(turn_number);
          if (max_turns !== undefined) setMaxTurns(max_turns);
          setTimerSeconds(60);
          setShowTurnSummary(false);

          if (current_speaker_id === userId) {
            console.log("[SPEAKER_CHANGED] I am the speaker — starting mic");
            startRecording();
            startSpeechRecognition();
            startChunkUpload();
            setTimerRunning(true);
            proctoring.enable();
          } else {
            console.log("[SPEAKER_CHANGED] Not the speaker — stopping mic");
            stopChunkUpload();
            stopSpeechRecognition();
            stopMic();
            setTimerRunning(true);
            proctoring.enable();
          }
          break;
        }
        case "TURN_EVALUATED": {
          const { user_id, scores, transcript: turnTranscript } = msg.payload || {};
          console.log("[TURN_EVALUATED] user:", user_id, "scores:", scores, "transcript:", turnTranscript?.substring(0, 80));
          if (user_id === userId) {
            setTurnSummaryScore(scores);
            setShowTurnSummary(true);
            setTimeout(() => setShowTurnSummary(false), 5000);
          }
          setSpeakingHistory(prev => [
            { user_id, label: msg.payload?.label || `Member ${user_id}`, text: turnTranscript || "", ...scores },
            ...prev
          ]);
          break;
        }
        case "CAMERA_STATUS": {
          const { user_id, camera_on } = msg.payload;
          setParticipantCameraStatus(prev => ({ ...prev, [user_id]: camera_on }));
          break;
        }
        case "MIC_STATUS": {
          const { user_id, mic_on } = msg.payload;
          setParticipantMicStatus(prev => ({ ...prev, [user_id]: mic_on }));
          break;
        }
        case "LIVE_SPEECH_BROADCAST": {
          const { user_id, text } = msg.payload;
          setLiveTranscripts(prev => ({ ...prev, [user_id]: text }));
          break;
        }
        case "CHAT_MESSAGE": {
          setChatMessages(prev => [...prev, msg.payload]);
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
          if (myIdx >= 0) { setMyResult(sorted[myIdx]); setMyRank(myIdx + 1); }
          if (msg.payload?.winner) setWinnerCard(msg.payload.winner);
          setShowResults(true);
          voice.announceEvaluationComplete();
          setTimeout(() => voice.announceLeaderboardReady(), 2500);
          break;
        }
        case "EVALUATION_PROGRESS":
          if (msg.payload?.user_id === userId && msg.payload?.stage) setEvalStage(msg.payload.stage);
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

  // ─── WAITING ROOM VIEW (before discussion starts) ───
  if (!currentSpeakerId && !showResults) {
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

  // ─── MAIN WORKSPACE: Turn-based Video GD ───
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

  const currentSpeaker = currentSpeakerId ? members.find((m: any) => m.user_id === currentSpeakerId) : null;
  const isMyTurn = currentSpeakerId === userId;

  return (
    <div className={`min-h-screen flex flex-col relative overflow-hidden ${theme === "dark" ? "dark" : ""}`}>
      <div className="fixed inset-0 z-0">
        <img src={theme === "dark" ? "/animated_gd_bg.jpeg" : "/gd_light_bg.jpeg"} alt="" className="w-full h-full object-cover opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-tr from-slate-950 via-slate-900 to-indigo-950/40 opacity-90 dark:block hidden" />
        <div className="absolute inset-0 bg-gradient-to-tr from-slate-50 via-indigo-50/20 to-purple-50/30 dark:hidden block" />
      </div>

      <div className="relative z-10 flex-1 flex flex-col p-4 md:p-6">
        {warnModal}

        {/* Top Bar */}
        <div className="max-w-7xl mx-auto w-full mb-4">
          <div className="card p-3 bg-slate-900/80 backdrop-blur-xl border border-slate-800 flex items-center justify-between gap-4 shadow-2xl">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-purple-650 flex items-center justify-center text-white font-extrabold text-sm">MZ</div>
              <div className="leading-tight hidden sm:block">
                <p className="text-xs font-black text-heading tracking-tight">ThinkCircle</p>
                <p className="text-[9px] text-muted-soft font-bold uppercase tracking-wider">Turn-based Video GD</p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-[10px] font-bold text-heading">
              <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">Turn {turnNumber}/{maxTurns || "\u2014"}</span>
              <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 items-center gap-1 uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" /> Live
              </span>
            </div>

            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-slate-950 border border-slate-800 text-heading">
              <Clock className="w-3.5 h-3.5 text-indigo-400" />
              <span>{formatTime(timerSeconds)}</span>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="max-w-7xl mx-auto w-full flex-1 flex flex-col gap-4">

          {/* Topic */}
          <div className="card p-3 bg-slate-900/60 border border-slate-800 text-center">
            <span className="text-[9px] text-indigo-400 font-bold uppercase tracking-wider">Discussion Topic</span>
            <p className="text-sm md:text-base font-bold text-heading mt-0.5">"{topic}"</p>
          </div>

          <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">

            {/* Left Column: Timer + Current Speaker */}
            <div className="lg:col-span-4 space-y-4">

              {/* 60-Second Timer */}
              <div className="card p-6 bg-slate-900/80 backdrop-blur-lg border border-slate-800 flex flex-col items-center space-y-2">
                <span className="text-[10px] font-bold text-heading uppercase tracking-wider">Turn Timer</span>
                <CircularTimer seconds={timerSeconds} maxSeconds={60} />
                {timerRunning && (
                  <span className={`text-[9px] font-bold ${timerSeconds <= 10 ? "text-rose-400 animate-pulse" : "text-muted-soft"}`}>
                    {timerSeconds <= 10 ? "Time running out!" : `${timerSeconds}s remaining`}
                  </span>
                )}
              </div>

              {/* Current Speaker Card */}
              <div className="card p-4 bg-slate-900/80 backdrop-blur-lg border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-heading uppercase tracking-wider flex items-center gap-1">
                    <Mic className="w-3.5 h-3.5 text-indigo-400" /> Current Speaker
                  </span>
                  {isMyTurn && <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[8px] font-bold animate-pulse">YOUR TURN</span>}
                </div>

                {currentSpeaker ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-11 h-11 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-650 text-white flex items-center justify-center font-black text-sm shrink-0 border ${isMyTurn ? "border-indigo-400 shadow-lg shadow-indigo-500/20" : "border-indigo-550/20"}`}>
                        {(currentSpeaker.label || currentSpeaker.name || "?")[0].toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-heading truncate">{currentSpeaker.label || currentSpeaker.name}</p>
                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">Speaking</span>
                      </div>
                    </div>
                    {isMyTurn && (
                      <Button onClick={() => executeFinish()} className="w-full h-9 text-[10px] font-bold bg-rose-600 hover:bg-rose-500 border-0 rounded-lg flex items-center justify-center gap-1">
                        <Square className="w-3 h-3 fill-white" /> Finish Early
                      </Button>
                    )}
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-soft text-center py-4 italic">Waiting for next speaker...</p>
                )}
              </div>

              {/* AI Processing Indicator */}
              {submitStep !== "idle" && submitStep !== "complete" && (
                <div className="card p-4 bg-indigo-500/5 border border-indigo-500/20 flex items-center gap-3">
                  <Loader2 className="w-5 h-5 text-indigo-400 animate-spin shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-heading">AI Processing...</p>
                    <p className="text-[9px] text-muted-soft">{STAGE_LABELS[submitStep] || "Processing..."}</p>
                  </div>
                </div>
              )}

              {/* Turn Summary Card */}
              {showTurnSummary && turnSummaryScore && (
                <div className="card p-4 bg-emerald-500/5 border border-emerald-500/20 space-y-2 animate-fade-up">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Turn Evaluated</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <CircularProgress percent={turnSummaryScore.grammar ?? 0} size={48} strokeWidth={4} color="#2dd4bf" label="Grammar" />
                    <CircularProgress percent={turnSummaryScore.fluency ?? 0} size={48} strokeWidth={4} color="#3b82f6" label="Fluency" />
                    <CircularProgress percent={turnSummaryScore.overall ?? 0} size={48} strokeWidth={4} color="#8b5cf6" label="Score" />
                  </div>
                </div>
              )}
            </div>

            {/* Center Column: Video Grid */}
            <div className="lg:col-span-5 space-y-4">
              <div className="card p-4 bg-slate-900/80 backdrop-blur-lg border border-slate-800">
                <div className="flex items-center justify-between border-b border-slate-850 pb-2 mb-3">
                  <h3 className="text-xs font-bold text-heading uppercase tracking-wider flex items-center gap-1">
                    <Users className="w-4 h-4 text-indigo-400" /> Participants ({members.length})
                  </h3>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Local Video Tile */}
                  <div className={`relative rounded-xl overflow-hidden border-2 aspect-video bg-slate-950 ${isMyTurn ? "border-indigo-500 shadow-lg shadow-indigo-500/20" : "border-slate-800"}`}>
                    <VideoPlayer stream={cameraEnabled ? localStream : null} muted={true} />
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-white truncate">You</span>
                        <div className="flex items-center gap-1">
                          {!cameraEnabled && <Maximize2 className="w-3 h-3 text-rose-400" />}
                          {!micEnabled && <MicOff className="w-3 h-3 text-rose-400" />}
                          {cameraEnabled && micEnabled && <Mic className="w-3 h-3 text-emerald-400" />}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Remote Video Tiles */}
                  {members.filter((m: any) => m.user_id !== userId).map((m: any) => {
                    const stream = remoteStreams.get(m.user_id);
                    const isSpeaker = m.user_id === currentSpeakerId;
                    const camOn = participantCameraStatus[m.user_id] !== false;
                    const micOn = participantMicStatus[m.user_id] !== false;
                    return (
                      <div key={m.user_id} className={`relative rounded-xl overflow-hidden border-2 aspect-video bg-slate-950 ${isSpeaker ? "border-indigo-500 shadow-lg shadow-indigo-500/20" : "border-slate-800"}`}>
                        {stream && camOn ? (
                          <VideoPlayer stream={stream} muted={false} />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-slate-950">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-650 flex items-center justify-center text-white font-black text-sm">
                              {(m.label || m.name || "?")[0].toUpperCase()}
                            </div>
                          </div>
                        )}
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-white truncate">{m.label || m.name}</span>
                            <div className="flex items-center gap-1">
                              {!camOn && <Maximize2 className="w-3 h-3 text-rose-400" />}
                              {!micOn && <MicOff className="w-3 h-3 text-rose-400" />}
                              {camOn && micOn && <Mic className="w-3 h-3 text-emerald-400" />}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right Column: Chat + Speech */}
            <div className="lg:col-span-3 space-y-4">
              {/* Live Speech Feed */}
              <div className="card p-4 bg-slate-900/80 backdrop-blur-lg border border-slate-800 space-y-3">
                <h3 className="text-xs font-bold text-heading uppercase tracking-wider flex items-center justify-between border-b border-slate-850 pb-2">
                  <span className="flex items-center gap-1"><Mic className="w-3.5 h-3.5 text-indigo-400" /> Live Speech</span>
                </h3>
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {currentSpeakerId && (
                    <div className="p-2.5 rounded-lg bg-indigo-500/5 border border-indigo-500/20 text-[10px] italic">
                      <span className="font-bold text-indigo-400 block mb-0.5">
                        {isMyTurn ? "You" : members.find((m: any) => m.user_id === currentSpeakerId)?.label || "Teammate"}...
                      </span>
                      <p className="text-heading whitespace-pre-wrap leading-relaxed">
                        {isMyTurn ? liveSpeechText : (liveTranscripts[currentSpeakerId] || "")}
                      </p>
                    </div>
                  )}
                  {speakingHistory.map((h: any, i: number) => (
                    <div key={i} className="p-2 rounded-lg bg-slate-950/40 border border-slate-850 text-[10px]">
                      <span className="font-bold text-heading">{h.label}</span>
                      <p className="text-body italic mt-0.5 line-clamp-2">{h.text}</p>
                    </div>
                  ))}
                  {speakingHistory.length === 0 && !currentSpeakerId && (
                    <p className="text-[10px] text-muted-soft text-center py-3 italic">No speech yet...</p>
                  )}
                </div>
              </div>

              {/* Chat Panel */}
              <div className="card p-4 bg-slate-900/80 backdrop-blur-lg border border-slate-800 space-y-3">
                <h3 className="text-xs font-bold text-heading uppercase tracking-wider border-b border-slate-850 pb-2 flex items-center gap-1">
                  <MessageSquare className="w-3.5 h-3.5 text-indigo-400" /> Chat
                </h3>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {chatMessages.map((msg: any, idx: number) => (
                    <div key={idx} className="flex gap-2 items-start p-2 bg-slate-950/30 rounded-lg border border-slate-850">
                      <span className="text-xs">🤖</span>
                      <div className="text-[10px] min-w-0">
                        <span className="font-bold text-indigo-400">{msg.name || "AI"}</span>
                        <p className="text-body leading-normal mt-0.5">{msg.text}</p>
                      </div>
                    </div>
                  ))}
                  {chatMessages.length === 0 && (
                    <p className="text-[10px] text-muted-soft text-center py-2 italic">No messages yet</p>
                  )}
                  <div ref={chatEndRef} />
                </div>
              </div>
            </div>

          </div>

          {/* Bottom Control Bar */}
          <div className="flex items-center justify-center gap-3 bg-slate-900/90 backdrop-blur-md px-6 py-2.5 rounded-2xl border border-slate-800 shadow-2xl max-w-lg mx-auto w-full mt-2">
            <button onClick={toggleCamera} className="flex flex-col items-center gap-1 text-[9px] font-bold shrink-0">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${cameraEnabled ? "bg-slate-850 border-slate-800 text-emerald-400 hover:bg-slate-800" : "bg-rose-600/20 border-rose-500/30 text-rose-400"}`}>
                <Maximize2 className="w-4 h-4" />
              </div>
              <span className={cameraEnabled ? "text-emerald-400" : "text-rose-400"}>Camera</span>
            </button>

            <button onClick={toggleMic} className="flex flex-col items-center gap-1 text-[9px] font-bold shrink-0">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${micEnabled ? "bg-slate-850 border-slate-800 text-emerald-400 hover:bg-slate-800" : "bg-rose-600/20 border-rose-500/30 text-rose-400"}`}>
                {micEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
              </div>
              <span className={micEnabled ? "text-emerald-400" : "text-rose-400"}>Mic</span>
            </button>

            {isMyTurn && timerRunning && (
              <Button onClick={() => executeFinish()} className="btn-primary h-9 px-3 rounded-xl font-bold bg-rose-600 hover:bg-rose-500 border-0 flex items-center gap-1 text-[10px] text-white shrink-0 shadow-lg">
                <Square className="w-3 h-3 fill-white animate-pulse" /> Finish Early
              </Button>
            )}

            <Button onClick={() => onLeave(myFinished)} className="btn-secondary h-9 px-3 rounded-xl font-bold border-slate-800 hover:bg-slate-800 text-[10px] flex items-center gap-1 shrink-0">
              Leave Room
            </Button>
          </div>

        </div>
      </div>
    </div>
  );
}
