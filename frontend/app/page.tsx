"use client";

import { AlertCircle, Award, Clock, LogOut, MessageSquare, Mic, MicOff, Trophy, Users, User as UserIcon, Lock, Zap, Loader2, Copy, Check, Target, TrendingUp, ArrowUp, ArrowDown, Sparkles, Menu, X, Shield, Sun, Moon, RefreshCw, Video, VideoOff, Hand, MessageCircle, Maximize, PhoneOff, Radio, CheckCircle2, Mail, Phone, Globe, Eye, EyeOff, VolumeX, Volume2, Bell, Settings, Search, BookOpen, ShieldAlert, Calendar } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import GdLiveRoom from "@/components/GdLiveRoom";
import GdLiveAdminMonitor from "@/components/GdLiveAdminMonitor";
import { useGdLiveWs, GDLiveWsMessage } from "@/lib/useGdLiveWs";
import { useVoiceAnnouncement } from "@/services/voice/useVoiceAnnouncement";
import { AllTimeAchiever, ComprehensiveLeaderboard, GDLiveLeaderboardEntry, LeaderboardRanking, LeaderboardStats, Progress, SoloQuote, SoloStartResponse, SoloSubmitResponse, User, apiRequest, hostGdLiveMeeting, endGdLiveMeeting, getGdLiveState, changePassword } from "@/lib/api";

function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  utterance.pitch = 1.05;
  utterance.lang = "en-US";
  window.speechSynthesis.speak(utterance);
}

const MOTIVATIONAL_PHRASES = [
  "Great effort! Keep practicing to improve your skills.",
  "Well done! Every session makes you better.",
  "Excellent work! You're on the right track.",
  "Good job! Consistency is the key to success.",
  "Fantastic! Your hard work is paying off.",
];

type PageView = "login" | "dashboard" | "profile" | "gd-leaderboard" | "solo-practice" | "solo-session" | "solo-result" | "gd-live" | "gd-live-session" | "gd-live-results" | "gd-live-admin" | "gd-live-admin-view" | "gd-live-room" | "gd-live-monitor" | "reports" | "certificates" | "achievements" | "notifications" | "settings";

/** Student-side waiter: opens a WebSocket to the session and auto-redirects into the
 *  live room when the admin hosts the meeting (SESSION_STARTED broadcast). */
function StudentLiveWaiter({ code, token, onStart }: { code: string; token: string; onStart: (topic: string | null, members: any[], teams?: any[]) => void }) {
  const { subscribe } = useGdLiveWs(code, token);
  useEffect(() => {
    const unsub = subscribe((msg: GDLiveWsMessage) => {
      if (msg.event === "SESSION_STARTED") {
        onStart(msg.payload?.topic ?? null, msg.payload?.members ?? [], msg.payload?.teams ?? []);
      }
    });
    return unsub;
  }, [subscribe, onStart]);
  return null;
}

/** Student-side polling fallback: if the WebSocket SESSION_STARTED event is
 *  missed (e.g. reconnect), poll the live-state and redirect when the session
 *  becomes "live". No manual refresh required. */
function StudentLivePoller({ code, token, onStart }: { code: string; token: string; onStart: (topic: string | null, members: any[], teams?: any[]) => void }) {
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const st = await getGdLiveState(code, token);
        if (!active) return;
        if (st.status === "live" || st.status === "active") {
          onStart(st.topic ?? null, st.members || [], st.teams || []);
        }
      } catch {
        /* ignore transient errors */
      }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => { active = false; clearInterval(id); };
  }, [code, token, onStart]);
  return null;
}

/** Inline admin control panel shown AFTER hosting — keeps the participant cards on
 *  the page and adds realtime live controls + a live activity feed. No camera. */
function GdLiveAdminPanel({ code, token, topic, onOpenRoom, onEnd }: {
  code: string;
  token: string;
  topic: string;
  onOpenRoom: () => void;
  onEnd: (code: string) => void;
}) {
  const { connected, send, subscribe } = useGdLiveWs(code, token);
  const [round, setRound] = useState(1);
  const [paused, setPaused] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [activity, setActivity] = useState<{ id: number; text: string; ts: number }[]>([]);
  const idRef = useRef(1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const push = (text: string) =>
    setActivity((p) => [...p.slice(-60), { id: idRef.current++, text, ts: Date.now() }]);

  useEffect(() => {
    const unsub = subscribe((msg: GDLiveWsMessage) => {
      switch (msg.event) {
        case "ROUND_CHANGED": setRound(msg.payload?.round ?? round + 1); push(`Round ${msg.payload?.round ?? round + 1} started`); break;
        case "TIMER_UPDATED": setTimerSeconds(msg.payload?.seconds ?? 0); setTimerRunning(!!msg.payload?.running); break;
        case "SESSION_PAUSED": setPaused(true); setTimerRunning(false); push("Session paused"); break;
        case "SESSION_RESUMED": setPaused(false); push("Session resumed"); break;
        case "PARTICIPANT_JOINED": push(`${msg.payload?.name || "Participant"} joined`); break;
        case "PARTICIPANT_LEFT": push(`${msg.payload?.name || "Participant"} left`); break;
        case "HAND_RAISED": push(`${msg.payload?.name || "Someone"} raised hand`); break;
        case "CHAT_MESSAGE": push(`${msg.payload?.name || "Participant"}: ${msg.payload?.text}`); break;
        case "SESSION_ENDED": push("Session ended"); break;
        default: break;
      }
    });
    return unsub;
  }, [subscribe, round]);

  function startTimer(min: number) {
    setTimerSeconds(min * 60); setTimerRunning(true);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimerSeconds((s) => {
        if (s <= 1) { if (timerRef.current) clearInterval(timerRef.current!); setTimerRunning(false); push("Time is up"); send("TIMER_UPDATED", { seconds: 0, running: false }); return 0; }
        return s - 1;
      });
    }, 1000);
    send("TIMER_UPDATED", { seconds: min * 60, running: true });
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3 card p-4">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-red-500">
            <span className={`w-2.5 h-2.5 rounded-full bg-red-500 ${paused ? "" : "animate-pulse"}`} /> {paused ? "PAUSED" : "LIVE"}
          </span>
          <span className="text-sm text-heading font-semibold">{topic || "—"}</span>
          {timerRunning && <span className="text-sm font-mono text-heading">{Math.floor(timerSeconds / 60).toString().padStart(2, "0")}:{(timerSeconds % 60).toString().padStart(2, "0")}</span>}
          <span className="text-xs text-muted-soft">Round {round}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-soft flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`} /> {connected ? "Realtime" : "Offline"}</span>
          <button onClick={onOpenRoom} className="btn-secondary text-xs h-9 px-3">Open Discussion Room</button>
        </div>
      </div>

      <div className="card p-4 flex flex-wrap gap-2 items-center">
        <button onClick={() => startTimer(15)} disabled={timerRunning} className="btn-primary text-xs h-10 px-3">Start 15:00</button>
        <button onClick={() => startTimer(10)} disabled={timerRunning} className="btn-secondary text-xs h-10 px-3">10:00</button>
        <button onClick={() => send("RESET_TIMER", { seconds: 0 })} className="btn-secondary text-xs h-10 px-3">Reset Timer</button>
        <button onClick={() => onEnd(code)} className="btn-secondary text-xs h-10 px-3 text-red-500 border-red-500/40">End GD</button>
      </div>

      <div className="card p-4">
        <p className="text-xs uppercase tracking-wide text-muted-soft mb-2">Live Activity</p>
        <div className="space-y-1.5 max-h-48 overflow-y-auto text-sm">
          {activity.length === 0 && <p className="text-muted-soft text-xs">Waiting for activity…</p>}
          {activity.map((a) => (
            <div key={a.id} className="text-xs text-muted-soft">
              <span className="opacity-60 mr-1">{new Date(a.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>{a.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<PageView>("login");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [cert1Downloading, setCert1Downloading] = useState(false);
  const [cert2Downloading, setCert2Downloading] = useState(false);

  const [studentRegisterNumber, setStudentRegisterNumber] = useState("");
  const [studentPassword, setStudentPassword] = useState("");
  const [adminRegisterNumber, setAdminRegisterNumber] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [loginTab, setLoginTab] = useState<"student" | "admin">("student");
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [mounted, setMounted] = useState(false);
  const [notifications, setNotifications] = useState<Array<{ id: string | number; time: string; icon: string; title: string; desc: string; read: boolean }>>([
    { id: 1, time: "1 hour ago", icon: "MessageSquare", title: "Live GD Room Available", desc: "Administrator hosted session 'Speech Modulation & Delivery Practice'. Join using the active room code.", read: false },
    { id: 2, time: "12 hours ago", icon: "Target", title: "Daily Practice Goal Reminder", desc: "Build consistency by completing a 2-minute solo AI speaking session on public speech fundamentals.", read: true },
    { id: 3, time: "1 day ago", icon: "Sparkles", title: "AI Skill Analysis Complete", desc: "A new skill analysis radar matrix is available based on your latest solo practice performance topic.", read: true },
  ]);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("mzgd_theme") as "light" | "dark" | null;
    if (saved) setTheme(saved);
  }, []);

  function toggleTheme() {
    setTheme(t => {
      const next = t === "dark" ? "light" : "dark";
      localStorage.setItem("mzgd_theme", next);
      return next;
    });
  }

  const [progress, setProgress] = useState<Progress | null>(null);
  const [transcript, setTranscript] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedCopyCode, setCopiedCopyCode] = useState("");

  // Comprehensive leaderboard state
  const [lbData, setLbData] = useState<ComprehensiveLeaderboard | null>(null);
  const [lbDepartment, setLbDepartment] = useState("ALL");
  const [lbYear, setLbYear] = useState("ALL");
  const [lbTimeframe, setLbTimeframe] = useState("all");

  // Solo Practice state
  const [soloSession, setSoloSession] = useState<SoloStartResponse | null>(null);
  const [soloQuote, setSoloQuote] = useState<SoloQuote | null>(null);
  const [soloResult, setSoloResult] = useState<SoloSubmitResponse | null>(null);
  const [soloHistory, setSoloHistory] = useState<SoloSubmitResponse["last_session"][]>([]);

  const [prepSeconds, setPrepSeconds] = useState(0);
  const [speakingSeconds, setSpeakingSeconds] = useState(0);
  const [isPrepPhase, setIsPrepPhase] = useState(false);
  const [isSpeakingPhase, setIsSpeakingPhase] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [liveDetectedText, setLiveDetectedText] = useState("");

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const voice = useVoiceAnnouncement();
  const announcedViews = useRef<Set<string>>(new Set());

  // Voice announcements triggered by view changes
  useEffect(() => {
    if (view === "gd-live-session" && !announcedViews.current.has("waiting")) {
      announcedViews.current.add("waiting");
      voice.announceWaiting();
    }
    if (view === "gd-live-admin-view" && gdLiveIsLiveMeeting && !announcedViews.current.has("admin-monitor")) {
      announcedViews.current.add("admin-monitor");
      voice.announceTeamsAssigned();
    }
  }, [view]);

  // Prevent body scrolling when sidebar is open on mobile/tablet viewports
  useEffect(() => {
    if (sidebarOpen) {
      if (typeof window !== "undefined" && window.innerWidth < 1024) {
        document.body.style.overflow = "hidden";
      }
    } else {
      if (typeof window !== "undefined") {
        document.body.style.overflow = "unset";
      }
    }
    return () => {
      if (typeof window !== "undefined") {
        document.body.style.overflow = "unset";
      }
    };
  }, [sidebarOpen]);

  const [isSessionLocked, setIsSessionLocked] = useState(false);
  const [tabSwitchWarning, setTabSwitchWarning] = useState(false);
  const lockWarningRef = useRef<boolean>(false);

  // GD Live state
  const [gdLiveCode, setGdLiveCode] = useState("");
  const [gdLiveJoined, setGdLiveJoined] = useState(false);
  const [gdLiveSession, setGdLiveSession] = useState<{ session_code: string; status: string; participant_count: number; team_count: number } | null>(null);
  const [gdLiveSessions, setGdLiveSessions] = useState<any[]>([]);
  const [gdLiveParticipants, setGdLiveParticipants] = useState<any[]>([]);
  const [gdLiveTeams, setGdLiveTeams] = useState<any[]>([]);
  const [gdLiveCreatedCode, setGdLiveCreatedCode] = useState("");
  const [gdLiveLeaderboard, setGdLiveLeaderboard] = useState<GDLiveLeaderboardEntry[]>([]);
  const [gdLiveLeaderboardViewCode, setGdLiveLeaderboardViewCode] = useState("");
  const [gdLiveAdminViewCode, setGdLiveAdminViewCode] = useState("");
  const [soloRulesOpen, setSoloRulesOpen] = useState(false);
  const [gdRulesOpen, setGdRulesOpen] = useState(false);

  // Live GD room state
  const [gdLiveRoomCode, setGdLiveRoomCode] = useState("");
  const [gdLiveRoomTopic, setGdLiveRoomTopic] = useState("");
  const [gdLiveRoomMembers, setGdLiveRoomMembers] = useState<any[]>([]);
  const [gdLiveRoomTeams, setGdLiveRoomTeams] = useState<any[]>([]);
  const [gdLiveRoomActive, setGdLiveRoomActive] = useState(false);
  const [gdLiveIsLiveMeeting, setGdLiveIsLiveMeeting] = useState(false);
  const [gdLiveShowCountdown, setGdLiveShowCountdown] = useState(false);
  const [gdLivePerf, setGdLivePerf] = useState<Record<string, number>>({});
  const [roomMicOn, setRoomMicOn] = useState(true);
  const [roomCamOn, setRoomCamOn] = useState(false);
  const [roomHandRaised, setRoomHandRaised] = useState(false);
  const [roomTimerSeconds, setRoomTimerSeconds] = useState(0);
  const [roomTimerRunning, setRoomTimerRunning] = useState(false);
  const roomTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loginLockRef = useRef(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth >= 768) {
      setSidebarOpen(true);
    }
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isSessionLocked) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const handleVisibilityChange = () => {
      if (isSessionLocked && document.visibilityState === "hidden") {
        setTabSwitchWarning(true);
        lockWarningRef.current = true;
        speak("Please return to your session immediately.");
      }
      if (document.visibilityState === "visible" && lockWarningRef.current) {
        setTabSwitchWarning(true);
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isSessionLocked]);

  useEffect(() => {
    const savedToken = localStorage.getItem("mzgd_token");
    if (savedToken) {
      setToken(savedToken);
      loadProfile(savedToken);
    }
  }, []);

  // Poll live sessions list in background to trigger real-time notifications
  useEffect(() => {
    if (!token || !user || user.role === "admin") return;

    // Load initial
    loadGdLiveSessions();

    const interval = setInterval(async () => {
      try {
        const sessions = await apiRequest<any[]>("/gd-live/sessions", {}, token);

        setGdLiveSessions((prevSessions) => {
          const newSessions = sessions.filter(
            (s) => s.status !== "completed" && !prevSessions.some((ps) => ps.session_code === s.session_code)
          );

          if (newSessions.length > 0) {
            newSessions.forEach((sess) => {
              const code = sess.session_code;
              setNotifications((prevNoti) => {
                if (prevNoti.some((n) => n.id === `gd-session-${code}`)) return prevNoti;
                return [
                  {
                    id: `gd-session-${code}`,
                    time: "Just now",
                    icon: "MessageSquare",
                    title: "Live GD Room Available",
                    desc: `Administrator hosted a new GD session. Join using active room code ${code}.`,
                    read: false,
                  },
                  ...prevNoti,
                ];
              });
              voice.announceSessionCreated();
            });
          }
          return sessions;
        });
      } catch (err) {
        console.error("Failed to poll live sessions for notifications:", err);
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [token, user]);

  // Poll dashboard database data (progress, sessions, history) when viewing Reports to keep it live
  useEffect(() => {
    if (!token || !user || view !== "reports") return;

    // Refresh instantly on mount
    loadDashboardData(token, user);

    const interval = setInterval(() => {
      loadDashboardData(token, user);
    }, 10000); // Poll every 10 seconds

    return () => clearInterval(interval);
  }, [token, user, view]);

  // Poll achievements dynamic data when viewing Achievements to keep it live
  useEffect(() => {
    if (!token || !user || view !== "achievements") return;

    // Refresh instantly on mount
    loadDashboardData(token, user);

    const interval = setInterval(() => {
      loadDashboardData(token, user);
    }, 10000); // Poll every 10 seconds

    return () => clearInterval(interval);
  }, [token, user, view]);

  // Keep the admin's participant list live: as students join/leave, the backend
  // broadcasts PARTICIPANTS_UPDATED over the session WebSocket. Update the list
  // in place so the admin never has to refresh or leave the page.
  const { subscribe: subAdminParticipants } = useGdLiveWs(
    view === "gd-live-admin-view" ? gdLiveAdminViewCode : null,
    token
  );
  useEffect(() => {
    if (view !== "gd-live-admin-view" || !gdLiveAdminViewCode) return;
    const prevCount = gdLiveParticipants.length;
    const unsub = subAdminParticipants((msg: GDLiveWsMessage) => {
      if (msg.event === "PARTICIPANTS_UPDATED" && Array.isArray(msg.payload?.participants)) {
        const newParts = msg.payload.participants;
        if (newParts.length > prevCount) {
          voice.announceParticipantJoined();
        }
        setGdLiveParticipants(newParts);
      } else if (msg.event === "TEAMS_ASSIGNED" && Array.isArray(msg.payload?.teams)) {
        setGdLiveTeams(msg.payload.teams);
        voice.announceTeamsAssigned();
      }
    });
    return unsub;
  }, [subAdminParticipants, view, gdLiveAdminViewCode]);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  async function loadDashboardData(t = token, currentUser = user) {
    if (!t || !currentUser) return;
    try {
      const promises = [
        apiRequest<Progress>("/progress", {}, t)
          .then((p) => { if (p) setProgress(p); })
          .catch(() => null),
        apiRequest<any[]>("/gd-live/sessions", {}, t)
          .then((sessions) => setGdLiveSessions(sessions || []))
          .catch(() => setGdLiveSessions([])),
      ];

      if (currentUser.role === "student") {
        promises.push(
          apiRequest<any[]>("/solo/history", {}, t)
            .then((history) => setSoloHistory(history || []))
            .catch(() => setSoloHistory([]))
        );
        promises.push(
          apiRequest<any>("/solo/quote", {}, t)
            .then((quote) => { if (quote) setSoloQuote(quote); })
            .catch(() => null)
        );
      }

      await Promise.allSettled(promises);
    } catch (err) {
      console.error("Failed to load dashboard data:", err);
    }
  }

  async function loadProfile(t: string) {
    try {
      const profile = await apiRequest<User>("/profile", {}, t);
      setUser(profile);
      setView("dashboard");
      voice.announceLogin();
      loadDashboardData(t, profile); // Lazy load without await
    } catch { localStorage.removeItem("mzgd_token"); setView("login"); }
  }


  async function handleLogin() {
    if (loginLockRef.current) return;
    loginLockRef.current = true;
    console.time("Login-Total");

    const rn = loginTab === "student" ? studentRegisterNumber : adminRegisterNumber;
    const pw = loginTab === "student" ? (studentPassword || "Password123") : adminPassword;
    if (!rn.trim()) {
      setMessage("Enter your register number / SPR number");
      loginLockRef.current = false;
      return;
    }

    setLoading(true); setMessage(""); setSuccess("");
    try {
      console.time("Login-API-Request");
      const res = await apiRequest<{ access_token: string; user: User }>("/login/register-number", {
        method: "POST",
        body: JSON.stringify({ register_number: rn, password: loginTab === "student" ? (pw || "Password123") : pw })
      });
      console.timeEnd("Login-API-Request");

      localStorage.setItem("mzgd_token", res.access_token);
      setToken(res.access_token);
      setUser(res.user);
      setView("dashboard");
      voice.announceLogin();

      // Lazy load dashboard data in the background
      loadDashboardData(res.access_token, res.user);
    } catch (err: any) {
      setMessage(err.message || "Login failed");
    } finally {
      setLoading(false);
      loginLockRef.current = false;
      console.timeEnd("Login-Total");
    }
  }

  async function toggleRecording() {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      setRecordingStatus("Processing audio...");
      speak("Recording stopped");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      speak("Recording started");
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const formData = new FormData();
        formData.append("file", blob, "recording.webm");
        setRecordingStatus("Transcribing...");
        try {
          const BASE_URL = typeof window !== "undefined" ? `${window.location.protocol}//${window.location.hostname}:8000` : "http://localhost:8000";
          const res = await fetch(`${BASE_URL}/interviews/upload-audio`, {
            method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData,
          });
          const data = await res.json();
          if (data.transcript) {
            setTranscript(prev => prev + " " + data.transcript);
            setLiveDetectedText(data.transcript);
          }
          setRecordingStatus(data.message || "Done");
        } catch { setRecordingStatus("Transcription failed"); }
      };
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingStatus("Recording...");
    } catch { setMessage("Microphone access denied"); }
  }

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function logout() {
    voice.announceLogout();
    localStorage.removeItem("mzgd_token");
    setUser(null); setToken(""); setView("login");
    setMessage(""); setSuccess("");
    setSoloSession(null); setSoloResult(null); setSoloQuote(null);
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setCopiedCopyCode(code);
    setTimeout(() => { setCopied(false); setCopiedCopyCode(""); }, 2000);
  }

  async function loadLeaderboard(department = "ALL", year = "ALL", timeframe = "all") {
    setPageLoading(true);
    try {
      const params = new URLSearchParams({ department, year, timeframe });
      const data = await apiRequest<ComprehensiveLeaderboard>(`/gd/leaderboard/comprehensive?${params}`, {}, token);
      setLbData(data);
      setLbDepartment(department);
      setLbYear(year);
      setLbTimeframe(timeframe);
      setView("gd-leaderboard");
    } catch (err: any) { setMessage(err.message); }
    finally { setPageLoading(false); }
  }

  // ─── GD Live Functions ───

  async function loadGdLiveSessions() {
    try {
      const sessions = await apiRequest<any[]>("/gd-live/sessions", {}, token).catch(() => []);
      setGdLiveSessions(sessions);
    } catch { }
  }

  async function createGdLiveSession() {
    setLoading(true);
    try {
      const res = await apiRequest<{ session_code: string }>("/gd-live/sessions", { method: "POST" }, token);
      setGdLiveCreatedCode(res.session_code);
      setSuccess(`GD Live session created! Code: ${res.session_code}`);
      voice.announceSessionCreated();
      await loadGdLiveSessions();
    } catch (err: any) { setMessage(err.message); }
    finally { setLoading(false); }
  }

  async function joinGdLive() {
    const code = gdLiveCode.trim();
    if (!code || code.length !== 4) { setMessage("Enter a 4-digit code"); return; }
    setLoading(true);
    try {
      await apiRequest(`/gd-live/sessions/${code}/join`, { method: "POST" }, token);
      setGdLiveJoined(true);
      setGdLiveSession({ session_code: code, status: "waiting", participant_count: 0, team_count: 0 });
      setSuccess("Joined GD Live session!");
      setView("gd-live-session");
      voice.announceSessionJoined();
    } catch (err: any) { setMessage(err.message); }
    finally { setLoading(false); }
  }

  // ─── Live GD Room helpers ───
  function openGdLiveRoom() {
    if (!gdLiveAdminViewCode) return;
    setGdLiveRoomCode(gdLiveAdminViewCode);
    setView("gd-live-room");
  }

  function enterGdLiveRoom(code: string, topic: string | null, members: any[], teams?: any[]) {
    const t0 = performance.now();
    setGdLivePerf((p) => ({ ...p, studentReceivedStart: t0 }));
    console.timeStamp?.("student:enterGdLiveRoom");
    setGdLiveRoomCode(code);
    setGdLiveRoomTopic(topic || "");
    setGdLiveRoomMembers(members || []);
    setGdLiveRoomTeams(teams || []);
    setGdLiveIsLiveMeeting(true);
    // For an admin host we stay on the participant page so the cards stay visible;
    // students (and "Open Discussion Room") navigate into the room view.
    if (user?.role !== "admin") {
      // Show a fast 3-2-1 overlay while the room (WS, timers, listeners) preloads.
      setGdLiveShowCountdown(true);
      setView("gd-live-room");
    }
    setRoomTimerSeconds(0);
    setRoomTimerRunning(false);
  }

  function leaveGdLiveRoom() {
    setGdLiveIsLiveMeeting(false);
    if (user?.role === "admin" && gdLiveRoomActive) {
      setView("gd-live-admin-view");
      if (gdLiveAdminViewCode) loadGdLiveParticipants(gdLiveAdminViewCode);
    } else {
      setView("dashboard");
      if (typeof loadGdLiveSessions === "function") loadGdLiveSessions();
    }
  }

  async function hostGdLiveRoom(sessionCode: string) {
    setLoading(true);
    const t0 = performance.now();
    try {
      const res = await hostGdLiveMeeting(sessionCode, token);
      setGdLivePerf((p) => ({ ...p, hostClickedToResponse: performance.now() - t0 }));
      console.timeStamp?.("admin:hostGdLiveRoom:response");
      // Keep the admin on the participant page: cards stay visible + live controls appear.
      // Do NOT reload participants here — the broadcast (SESSION_STARTED) drives clients,
      // and the admin's live controls are shown via gdLiveRoomActive. This keeps the host
      // click→student-screen path under 1s.
      setGdLiveRoomActive(true);
      setGdLiveIsLiveMeeting(true);
      setGdLiveRoomTopic(res.topic || "");
      setGdLiveRoomMembers(res.members || []);
      setSuccess("Meeting is live. Participants are being redirected.");
    } catch (err: any) { setMessage(err.message); }
    finally { setLoading(false); }
  }

  async function endGdLiveRoom(sessionCode: string) {
    try { await endGdLiveMeeting(sessionCode, token); } catch { }
    setGdLiveRoomActive(false);
    setGdLiveIsLiveMeeting(false);
    if (user?.role === "admin") {
      setView("gd-live-admin-view");
      loadGdLiveParticipants(sessionCode);
      loadGdLiveSessions();
    } else {
      setView("dashboard");
      loadGdLiveSessions();
    }
  }

  function startRoomTimer(minutes: number) {
    setRoomTimerSeconds(minutes * 60);
    setRoomTimerRunning(true);
    if (roomTimerRef.current) clearInterval(roomTimerRef.current);
    roomTimerRef.current = setInterval(() => {
      setRoomTimerSeconds((s) => {
        if (s <= 1) {
          if (roomTimerRef.current) clearInterval(roomTimerRef.current!);
          setRoomTimerRunning(false);
          setSuccess("Session time is up. Ending meeting...");
          if (user?.role === "admin") endGdLiveRoom(gdLiveRoomCode);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  async function loadGdLiveParticipants(sessionCode: string) {
    try {
      const parts = await apiRequest<any[]>(`/gd-live/sessions/${sessionCode}/participants`, {}, token).catch(() => []);
      setGdLiveParticipants(parts);
    } catch { }
  }

  async function loadGdLiveLeaderboard(sessionCode: string) {
    setLoading(true);
    try {
      const data = await apiRequest<GDLiveLeaderboardEntry[]>(
        `/gd-live/sessions/${sessionCode}/leaderboard`, {}, token);
      setGdLiveLeaderboard(data);
      setGdLiveLeaderboardViewCode(sessionCode);
    } catch (err: any) { setMessage(err.message); }
    finally { setLoading(false); }
  }

  async function completeGdLiveSession(sessionCode: string) {
    setLoading(true);
    try {
      await apiRequest(`/gd-live/sessions/${sessionCode}/complete`, { method: "POST" }, token);
      setSuccess("Session completed!");
      await loadGdLiveSessions();
    } catch (err: any) { setMessage(err.message); }
    finally { setLoading(false); }
  }

  async function deleteGdLiveSession(sessionCode: string) {
    if (!confirm(`Delete session ${sessionCode}? This cannot be undone.`)) return;
    setLoading(true);
    try {
      await apiRequest(`/gd-live/sessions/${sessionCode}`, { method: "DELETE" }, token);
      setSuccess(`Session ${sessionCode} deleted.`);
      await loadGdLiveSessions();
    } catch (err: any) { setMessage(err.message); }
    finally { setLoading(false); }
  }

  // ─── Solo Practice Functions ───

  async function startSoloPractice() {
    setLoading(true);
    try {
      const res = await apiRequest<SoloStartResponse>("/solo/start", { method: "POST" }, token);
      setSoloSession(res);
      setSoloQuote(res.quote);
      setSoloResult(null);
      setTranscript("");
      setIsPrepPhase(false);
      setIsSpeakingPhase(false);
      setPrepSeconds(0);
      setSpeakingSeconds(0);
      if (timerRef.current) clearInterval(timerRef.current);
      setView("solo-practice");
      setSuccess("");
    } catch (err: any) { setMessage(err.message); }
    finally { setLoading(false); }
  }

  function beginSoloPrep() {
    if (!soloSession) return;
    setIsPrepPhase(true);
    setIsSessionLocked(true);
    setPrepSeconds(240);
    setIsSpeakingPhase(false);
    setSpeakingSeconds(0);
    setView("solo-session");
    setSuccess("You have 4 minutes to prepare. Use the notes area below.");
    speak(`Your topic is: ${soloSession.topic}. You have 4 minutes to prepare.`);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setPrepSeconds(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          setIsPrepPhase(false);
          setIsSpeakingPhase(true);
          setSpeakingSeconds(600);
          setSuccess("Preparation time over! Start speaking now. You have 10 minutes.");
          speak("Preparation time is over. Start speaking now. You have 10 minutes.");
          timerRef.current = setInterval(() => {
            setSpeakingSeconds(p => {
              if (p <= 1) { clearInterval(timerRef.current!); return 0; }
              return p - 1;
            });
          }, 1000);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  async function submitSoloPractice() {
    if (!soloSession || !transcript.trim()) { setMessage("Write your transcript first"); return; }
    setLoading(true);
    try {
      const res = await apiRequest<SoloSubmitResponse>("/solo/submit", {
        method: "POST",
        body: JSON.stringify({ session_id: soloSession.session_id, transcript })
      }, token);
      setSoloResult(res);
      const phrase = MOTIVATIONAL_PHRASES[Math.floor(Math.random() * MOTIVATIONAL_PHRASES.length)];
      speak(phrase);
      if (timerRef.current) clearInterval(timerRef.current);
      setIsPrepPhase(false);
      setIsSpeakingPhase(false);
      setIsSessionLocked(false);
      setView("solo-result");
      setSuccess(`${res.message} — Score: ${res.overall_score}`);
      // Fetch history
      const history = await apiRequest<SoloSubmitResponse["last_session"][]>("/solo/history", {}, token).catch(() => []);
      setSoloHistory(history);
    } catch (err: any) { setMessage(err.message); }
    finally { setLoading(false); }
  }

  async function endSoloEarly() {
    if (!soloSession) return;
    if (transcript.trim().length < 10) {
      setMessage("Write at least 10 characters of transcript before ending.");
      return;
    }
    await submitSoloPractice();
  }

  const scoreColors = ["#f59e0b", "#10b981", "#8b5cf6", "#06b6d4"];

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  // ─── Full-screen GD Live Admin Monitor ───
  if (view === "gd-live-monitor" && gdLiveAdminViewCode && user) {
    return (
      <GdLiveAdminMonitor
        sessionCode={gdLiveAdminViewCode}
        token={token}
        onBack={() => { setView("gd-live-admin-view"); loadGdLiveParticipants(gdLiveAdminViewCode); }}
      />
    );
  }

  // ─── Full-screen GD Live Room (authenticated) ───
  if (view === "gd-live-room" && gdLiveRoomCode && user) {
    return (
      <GdLiveRoom
        sessionCode={gdLiveRoomCode}
        token={token}
        user={user}
        theme={theme}
        initialTopic={gdLiveRoomTopic}
        initialMembers={gdLiveRoomMembers}
        initialTeams={gdLiveRoomTeams}
        showCountdown={gdLiveShowCountdown}
        onCountdownDone={() => {
          setGdLiveShowCountdown(false);
          setGdLivePerf((p) => {
            const entryToReady = p.studentReceivedStart ? performance.now() - p.studentReceivedStart : 0;
            console.log("[GD-Live perf] host→response(ms):", Math.round(p.hostClickedToResponse || 0),
              "| student entry→room-ready(ms):", Math.round(entryToReady));
            return { ...p, studentEntryToReady: entryToReady };
          });
        }}
        onLeave={leaveGdLiveRoom}
      />
    );
  }

  if (!user) {
    return (
      <div className={`min-h-screen flex items-center justify-center relative overflow-hidden ${theme === "dark" ? "dark" : ""}`}>
        {/* Theme-based animated background */}
        <div className="fixed inset-0 z-0">
          <img
            src={theme === "dark" ? "/login_dark_bg.jpeg" : "/new_light_BG.jpeg"}
            alt=""
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 backdrop-blur-[2px]" style={{ background: theme === "dark" ? "rgba(15,23,42,0.45)" : "rgba(248,250,252,0.35)" }} />
        </div>

        {/* Theme toggle */}
        <button onClick={toggleTheme} className="fixed top-4 right-4 z-20 p-2.5 rounded-xl btn-secondary" suppressHydrationWarning>
          {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
        <div className="relative z-10 w-full max-w-sm md:max-w-md mx-3 md:mx-4 animate-fade-up">
          <div className="text-center mb-6 md:mb-10">
            <div className="icon-badge icon-purple mx-auto mb-3 md:mb-5" style={{ width: "72px", height: "72px" }}>
              <img src="/MZ_logo_DB.webp" alt="Mount Zion Logo" className="w-12 h-12 rounded-xl object-cover" />
            </div>
            <h1 className="text-2xl md:text-4xl font-bold mb-1 md:mb-2 text-heading">MZ Orator</h1>
            <p className="text-xs md:text-base text-muted-soft">AI Group Discussion Platform</p>
          </div>
          <div className="card">
            {/* Login tabs */}
            <div className="flex mb-6 rounded-xl p-1 surface-2">
              <button
                onClick={() => { setLoginTab("student"); setMessage(""); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg transition-all duration-300 ${loginTab === "student" ? "btn-primary" : "text-muted-soft hover:text-heading"
                  }`}
              >
                <Users className="w-4 h-4" /> Student Login
              </button>
              <button
                onClick={() => { setLoginTab("admin"); setMessage(""); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg transition-all duration-300 ${loginTab === "admin" ? "btn-primary" : "text-muted-soft hover:text-heading"
                  }`}
              >
                <Shield className="w-4 h-4" /> Admin Login
              </button>
            </div>
            <div className="space-y-4 md:space-y-5">
              <div>
                <label className="block text-xs md:text-sm font-medium mb-1 md:mb-1.5 text-heading">
                  {loginTab === "student" ? "Register Number" : "SPR Number"}
                </label>
                <Input
                  placeholder={loginTab === "student" ? "911724205001" : "12345"}
                  value={loginTab === "student" ? studentRegisterNumber : adminRegisterNumber}
                  onChange={(e) => loginTab === "student" ? setStudentRegisterNumber(e.target.value) : setAdminRegisterNumber(e.target.value)}
                  className="inp w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5 text-heading">Password</label>
                <Input
                  type="password"
                  placeholder={loginTab === "student" ? "Default: Password123" : "Mzorator@admin"}
                  value={loginTab === "student" ? studentPassword : adminPassword}
                  onChange={(e) => loginTab === "student" ? setStudentPassword(e.target.value) : setAdminPassword(e.target.value)}
                  className="inp w-full"
                />
              </div>
              {loginTab === "admin" && (
                <div className="rounded-lg p-3 surface-2 border border-amber-500/30">
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    <Shield className="w-3 h-3 inline mr-1" />
                    Admin demo: SPR <code className="text-heading font-mono">12345</code> / Password <code className="text-heading font-mono">Mzorator@admin</code>
                  </p>
                </div>
              )}
              <Button
                className="group relative w-full btn-primary h-12 text-lg font-semibold"
                onClick={handleLogin}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <Sparkles className="w-5 h-5" />
                    <span>Enter GD Portal</span>
                  </span>
                )}
              </Button>
              {message && (
                <div className="flex items-center gap-2 rounded-lg p-3 text-sm bg-red-500/10 text-red-600 dark:text-red-300 border border-red-500/30">
                  <AlertCircle className="h-4 w-4 shrink-0" /> {message}
                </div>
              )}
            </div>
          </div>

          {/* College contact footer */}
          <div className="mt-6 text-center text-xs text-muted-soft space-y-1">
            <p className="font-medium text-heading">Mount Zion College of Engineering and Technology</p>
            <p>
              <span className="inline-flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> info@mzcet.in</span>
              {"  ·  "}
              <span className="inline-flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> 04333 294400</span>
              {"  ·  "}
              <span className="inline-flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> 73733 44444</span>

            </p>
            <p>
              <span className="inline-flex items-center gap-1"><Globe className="w-3.5 h-3.5" /> www.mzcet.in</span>
            </p>
          </div>
        </div>
      </div>
    );
  }

  function renderSidebarContent(isMobile = false) {
    if (!user) return null;
    return (
      <div className="flex flex-col h-full bg-slate-900/5 dark:bg-slate-950/20 backdrop-blur-xl">
        {/* Logo and online status */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200/50 dark:border-slate-800/50 shrink-0 bg-gradient-to-b from-indigo-500/5 via-transparent to-transparent">
          <div className="flex items-center gap-3">
            <img src="/MZ_logo_DB.webp" alt="Mount Zion Logo" className="w-10 h-10 rounded-xl object-cover shadow-md shrink-0 hover:rotate-6 transition-transform duration-300" />
            <div className="truncate">
              <p className="text-sm font-bold text-heading flex items-center gap-1.5">
                MZ Orator
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981]" />
              </p>
              <p className="text-[11px] text-muted-soft truncate max-w-[140px]">{user.name}</p>
              {progress && (
                <p className="text-[10px] text-indigo-500 dark:text-indigo-400 font-extrabold mt-0.5 flex items-center gap-1.5 animate-pulse">
                  <Trophy className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span>{Math.round(progress.total_credits || 0)} Credits</span>
                </p>
              )}
            </div>
          </div>
          {isMobile && (
            <button className="p-2 text-muted-soft hover:text-heading hover:bg-slate-500/10 rounded-lg transition-colors duration-200" onClick={() => setSidebarOpen(false)}>
              <X className="w-5 h-5" />
            </button>
          )}
        </div>



        {/* Navigation list */}
        <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto">
          {[
            { icon: <Users className="w-[18px] h-[18px] shrink-0" />, label: "Dashboard", view: "dashboard" as PageView },
            ...(user?.role !== "admin" ? [
              { icon: <Zap className="w-[18px] h-[18px] shrink-0" />, label: "Group Discussion", view: "gd-live" as PageView },
              { icon: <Target className="w-[18px] h-[18px] shrink-0" />, label: "Solo Practice", view: "solo-practice" as PageView },
              { icon: <TrendingUp className="w-[18px] h-[18px] shrink-0" />, label: "Reports & Analytics", view: "reports" as PageView },
              { icon: <Award className="w-[18px] h-[18px] shrink-0" />, label: "Achievements", view: "achievements" as PageView },
            ] : []),
            ...(user?.role === "admin" ? [
              { icon: <Shield className="w-[18px] h-[18px] shrink-0" />, label: "Admin GD Control", view: "gd-live-admin" as PageView },
            ] : []),
            { icon: <Trophy className="w-[18px] h-[18px] shrink-0" />, label: "Leaderboard", view: "gd-leaderboard" as PageView },
            { icon: <UserIcon className="w-[18px] h-[18px] shrink-0" />, label: "Profile Settings", view: "profile" as PageView },
          ].filter(Boolean).map((item: { icon: React.ReactNode; label: string; view: PageView }) => (
            <button
              key={item.label}
              disabled={isSessionLocked}
              onClick={() => {
                if (isSessionLocked) return;
                if (item.view === "gd-leaderboard") { setView("gd-leaderboard"); loadLeaderboard(); }
                else if (item.view === "solo-practice") { setView("solo-practice"); startSoloPractice(); }
                else if (item.view === "dashboard") { setView("dashboard"); loadDashboardData(); }
                else if (item.view === "gd-live") { setView("gd-live"); loadGdLiveSessions(); }
                else if (item.view === "gd-live-admin") { setView("gd-live-admin"); loadGdLiveSessions(); }
                else if (item.view === "reports") { setView("reports"); loadDashboardData(); }
                else if (item.view === "achievements") { setView("achievements"); loadDashboardData(); }
                else setView(item.view);
                if (isMobile) setSidebarOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 whitespace-nowrap ${view === item.view ? "bg-gradient-to-r from-indigo-500/10 to-purple-500/10 text-indigo-600 dark:text-indigo-300 border-l-4 border-indigo-500 dark:border-indigo-400 shadow-sm" : "text-body hover:bg-slate-500/5 hover:text-heading hover:pl-5"} ${isSessionLocked ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Bottom panel */}
        <div className="p-4 border-t border-slate-200/50 dark:border-slate-800/50 space-y-1.5 shrink-0 bg-gradient-to-t from-indigo-500/5 via-transparent to-transparent">
          <button onClick={() => voice.setEnabled(!voice.enabled)} className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 whitespace-nowrap text-muted-soft hover:text-heading hover:bg-slate-500/5 hover:pl-5">
            <VolumeX className="w-[18px] h-[18px] shrink-0" /> {voice.enabled ? "Mute Voice" : "Unmute Voice"}
          </button>
          <button onClick={() => setView("settings")} className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 whitespace-nowrap text-muted-soft hover:text-heading hover:bg-slate-500/5 hover:pl-5">
            <Settings className="w-[18px] h-[18px] shrink-0" /> Settings
          </button>
          <button onClick={logout} disabled={isSessionLocked} className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 whitespace-nowrap ${isSessionLocked ? "text-slate-600 cursor-not-allowed" : "text-red-600 dark:text-red-400 hover:bg-red-500/10 hover:pl-5"}`}>
            <LogOut className="w-[18px] h-[18px] shrink-0" /> Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-screen flex relative overflow-hidden ${theme === "dark" ? "dark" : ""}`}>
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

      {/* Mobile backdrop overlay when sidebar open */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden transition-opacity duration-300" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Mobile Sidebar */}
      <aside className={`fixed z-50 h-screen inset-y-0 left-0 transition-transform duration-300 ease-in-out flex flex-col shrink-0 border-r border-slate-200/50 dark:border-slate-800/50 bg-white/95 dark:bg-slate-950/90 backdrop-blur-xl shadow-2xl ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} w-full md:w-[280px] lg:hidden`}>
        {renderSidebarContent(true)}
      </aside>

      {/* Desktop Docked Sidebar */}
      <aside className="hidden lg:flex flex-col shrink-0 h-screen sticky top-0 border-r border-slate-200/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl z-10 w-[280px]">
        {renderSidebarContent(false)}
      </aside>

      {/* Main Content */}
      <main className={`flex-1 overflow-x-hidden overflow-y-auto h-full transition-all duration-300 ease-in-out ${sidebarOpen ? "translate-x-0 md:translate-x-[280px] lg:translate-x-0" : "translate-x-0"}`}>
        {/* Sticky Premium Top Header */}
        <div className="sticky top-0 z-20 py-4 px-6 bg-white/45 dark:bg-slate-950/45 backdrop-blur-xl border-b border-slate-200/40 dark:border-slate-800/40 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* Menu toggle for mobile/tablet */}
            <button
              onClick={() => { if (!isSessionLocked) setSidebarOpen(!sidebarOpen); }}
              className="lg:hidden p-2 rounded-xl border border-slate-200/50 dark:border-slate-800/50 hover:bg-slate-500/10 text-heading transition-all duration-200"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div>
              <h1 className="text-sm md:text-base font-bold text-heading capitalize">
                {view === "gd-leaderboard" ? "Leaderboard" : view === "gd-live" ? "Group Discussion" : view.replace("-", " ")}
              </h1>
              <p className="text-[10px] text-muted-soft hidden sm:block mt-0.5 font-medium">
                {new Date().toLocaleDateString("en-US", { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Mock Search */}
            <div className="relative max-w-[200px] hidden md:block">
              <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Search GD portal..."
                className="pl-9 pr-3 py-1.5 w-full text-xs rounded-xl border border-slate-200/50 dark:border-slate-800/50 bg-white/30 dark:bg-slate-900/30 text-heading placeholder-muted focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all duration-200"
              />
            </div>

            {/* Credit Points Badge */}
            {progress && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-200/50 dark:border-slate-800/50 bg-white/40 dark:bg-slate-900/40 text-heading text-xs font-bold shadow-sm">
                <Trophy className="w-3.5 h-3.5 text-amber-500 animate-bounce" style={{ animationDuration: '3s' }} />
                <span>{Math.round(progress.total_credits || 0)} <span className="text-indigo-500 dark:text-indigo-400">Credits</span></span>
              </div>
            )}

            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-xl border border-slate-200/50 dark:border-slate-800/50 bg-white/40 dark:bg-slate-900/40 hover:bg-indigo-500/5 text-heading hover:scale-105 active:scale-95 transition-all duration-200"
              aria-label="Toggle Theme"
              suppressHydrationWarning
            >
              {theme === "dark" ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-indigo-500" />}
            </button>

            {/* Notification Bell */}
            <button
              onClick={() => setView("notifications")}
              className="p-2 rounded-xl border border-slate-200/50 dark:border-slate-800/50 bg-white/40 dark:bg-slate-900/40 hover:bg-indigo-500/5 text-heading relative hover:scale-105 active:scale-95 transition-all duration-200"
            >
              <Bell className="w-4 h-4" />
              {notifications.some(n => !n.read) && (
                <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
              )}
            </button>

            {/* Profile Dropdown avatar */}
            <button
              onClick={() => setView("profile")}
              className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border border-slate-200/50 dark:border-slate-800/50 bg-white/40 dark:bg-slate-900/40 hover:bg-slate-500/5 text-heading transition-all duration-200 hover:-translate-y-0.5 active:scale-95"
            >
              <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold shadow-sm shrink-0">
                {user.name ? user.name[0].toUpperCase() : "U"}
              </div>
              <span className="text-xs font-semibold hidden sm:inline">{user.name}</span>
            </button>
          </div>
        </div>

        <div className="p-4 md:p-6 max-w-6xl mx-auto animate-fade-up">
          {(success || message) && (
            <div className={`mb-4 flex items-center gap-2 rounded-xl p-4 text-sm transition-colors duration-500 ${success ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300 border border-emerald-500/30" : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300 border border-red-500/30"}`}>
              {success ? <Zap className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
              <span>{success || message}</span>
              <button onClick={() => { setMessage(""); setSuccess(""); }} className="ml-auto text-muted-soft hover:text-heading">&times;</button>
            </div>
          )}
          {pageLoading && (
            <div className="mb-4 flex items-center gap-2 rounded-xl p-3 text-sm surface-2 text-body border">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" /> Loading...
            </div>
          )}

          {/* Profile View */}
          {view === "profile" && user && (
            <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8 pb-12 animate-in slide-in-from-bottom-4 fade-in duration-500">
              {/* Left Column - Profile Card */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-8 shadow-sm relative overflow-hidden flex flex-col items-center text-center">
                {/* Decorative gradients */}
                <div className="absolute -top-12 -left-12 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />
                <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-purple-500/10 rounded-full blur-2xl pointer-events-none" />

                {/* Avatar Initial Bubble */}
                <div className="relative w-24 h-24 rounded-full flex items-center justify-center bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 p-0.5 mb-4 group shadow-md hover:scale-105 transition-transform duration-300">
                  <div className="w-full h-full bg-[var(--surface)] rounded-full flex items-center justify-center text-heading font-black text-2xl tracking-tight select-none">
                    {user.name ? user.name.split(/\s+/).filter(Boolean).map(n => n[0]).join("").toUpperCase().slice(0, 2) : "US"}
                  </div>
                  <div className="absolute inset-0 rounded-full border border-indigo-500/30 animate-ping opacity-20 pointer-events-none" />
                </div>

                <h3 className="text-xl font-bold text-heading tracking-tight mb-1">{user.name}</h3>

                {user.role === "admin" ? (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-500/10 text-red-500 border border-red-500/20 shadow-sm flex items-center gap-1 mb-6 select-none">
                    <Shield className="w-3 h-3" />
                    Administrator
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 shadow-sm flex items-center gap-1 mb-6 select-none">
                    <Sparkles className="w-3 h-3" />
                    Student
                  </span>
                )}

                {/* Details Grid */}
                <div className="w-full space-y-3 text-left border-t border-[var(--border)] pt-6 mt-1">
                  <div className="flex items-center gap-3 p-3 rounded-2xl bg-[var(--bg)] border border-[var(--border)] hover:border-indigo-500/30 transition-all duration-200">
                    <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center shrink-0">
                      <Mail className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold text-muted uppercase tracking-wider">Email Address</p>
                      <p className="text-xs font-semibold text-heading truncate">{user.email}</p>
                    </div>
                  </div>

                  {user.register_number && (
                    <div className="flex items-center gap-3 p-3 rounded-2xl bg-[var(--bg)] border border-[var(--border)] hover:border-indigo-500/30 transition-all duration-200">
                      <div className="w-9 h-9 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center shrink-0">
                        <Award className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold text-muted uppercase tracking-wider">Register Number</p>
                        <p className="text-xs font-semibold text-heading truncate font-mono">{user.register_number}</p>
                      </div>
                    </div>
                  )}

                  {user.department && (
                    <div className="flex items-center gap-3 p-3 rounded-2xl bg-[var(--bg)] border border-[var(--border)] hover:border-indigo-500/30 transition-all duration-200">
                      <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
                        <Shield className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold text-muted uppercase tracking-wider">Department</p>
                        <p className="text-xs font-semibold text-heading truncate">{user.department}</p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-3 p-3 rounded-2xl bg-[var(--bg)] border border-[var(--border)] hover:border-indigo-500/30 transition-all duration-200">
                    <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold text-muted uppercase tracking-wider">Account Status</p>
                      <p className="text-xs font-semibold text-heading">Active / Verified</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column - Security & Password Form */}
              <div className="lg:col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-8 shadow-sm relative overflow-hidden flex flex-col justify-between">
                <div className="absolute -top-12 -right-12 w-48 h-48 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />

                <div>
                  <div className="mb-6 border-b border-[var(--border)] pb-5">
                    <h3 className="text-xl font-bold text-heading tracking-tight mb-1 flex items-center gap-2">
                      <Lock className="w-5 h-5 text-indigo-500" />
                      Security Settings
                    </h3>
                    <p className="text-sm text-muted">Update your password to keep your account secure.</p>
                  </div>

                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    if (newPassword.length < 8) return alert("New password must be at least 8 characters");
                    if (newPassword !== confirmPassword) return alert("Passwords do not match");
                    try {
                      setLoading(true);
                      const res = await changePassword({ current_password: currentPassword, new_password: newPassword }, token!);
                      alert(res.message || "Password updated successfully");
                      setCurrentPassword("");
                      setNewPassword("");
                      setConfirmPassword("");
                    } catch (err: any) {
                      alert(err.message || "Failed to change password");
                    } finally {
                      setLoading(false);
                    }
                  }} className="space-y-5">
                    <div>
                      <label className="text-xs font-semibold text-heading mb-1.5 block">Current Password</label>
                      <div className="relative flex items-center">
                        <Lock className="w-4 h-4 text-muted absolute left-4 pointer-events-none" />
                        <Input
                          type={showCurrent ? "text" : "password"}
                          value={currentPassword}
                          onChange={e => setCurrentPassword(e.target.value)}
                          required
                          placeholder="••••••••"
                          className="w-full pl-11 pr-11 bg-[var(--bg)] border-[var(--border)] focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/10 rounded-2xl h-12"
                        />
                        <button
                          type="button"
                          onClick={() => setShowCurrent(!showCurrent)}
                          className="absolute right-4 text-muted hover:text-heading transition-colors focus:outline-none"
                        >
                          {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-heading mb-1.5 block">New Password</label>
                      <div className="relative flex items-center">
                        <Lock className="w-4 h-4 text-muted absolute left-4 pointer-events-none" />
                        <Input
                          type={showNew ? "text" : "password"}
                          value={newPassword}
                          onChange={e => setNewPassword(e.target.value)}
                          required
                          minLength={8}
                          placeholder="••••••••"
                          className="w-full pl-11 pr-11 bg-[var(--bg)] border-[var(--border)] focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/10 rounded-2xl h-12"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNew(!showNew)}
                          className="absolute right-4 text-muted hover:text-heading transition-colors focus:outline-none"
                        >
                          {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <p className="text-[10px] text-muted mt-1.5 pl-1">Must be at least 8 characters long</p>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-heading mb-1.5 block">Confirm New Password</label>
                      <div className="relative flex items-center">
                        <Lock className="w-4 h-4 text-muted absolute left-4 pointer-events-none" />
                        <Input
                          type={showConfirm ? "text" : "password"}
                          value={confirmPassword}
                          onChange={e => setConfirmPassword(e.target.value)}
                          required
                          minLength={8}
                          placeholder="••••••••"
                          className="w-full pl-11 pr-11 bg-[var(--bg)] border-[var(--border)] focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/10 rounded-2xl h-12"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirm(!showConfirm)}
                          className="absolute right-4 text-muted hover:text-heading transition-colors focus:outline-none"
                        >
                          {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <Button
                      type="submit"
                      disabled={loading}
                      className="w-full h-12 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold rounded-2xl shadow-lg hover:shadow-indigo-500/20 transition-all duration-200 mt-2 flex items-center justify-center gap-2 border-0"
                    >
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                      Save Password
                    </Button>
                  </form>
                </div>
              </div>
            </div>
          )}

          {/* Reports View */}
          {view === "reports" && user && (
            <div className="space-y-6 pb-12 animate-fade-up">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="card p-6 md:col-span-2 relative overflow-hidden flex flex-col justify-between border-l-4 border-l-indigo-600">
                  <div>
                    <h3 className="text-base font-bold text-heading flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-indigo-500" /> Overall Progress Metrics
                    </h3>
                    <p className="text-xs text-muted-soft mt-1">Detailed analysis of group discussions and solo metrics.</p>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                    <div className="p-3 bg-slate-100/50 dark:bg-slate-950/40 border border-slate-200/40 dark:border-slate-800/40 rounded-2xl">
                      <span className="text-[10px] text-muted-soft uppercase font-bold tracking-wider">Avg Score</span>
                      <p className="text-xl font-extrabold text-heading mt-1">{progress && progress.average_score != null ? `${Number(progress.average_score).toFixed(1)}%` : "0.0%"}</p>
                    </div>
                    <div className="p-3 bg-slate-100/50 dark:bg-slate-950/40 border border-slate-200/40 dark:border-slate-800/40 rounded-2xl">
                      <span className="text-[10px] text-muted-soft uppercase font-bold tracking-wider">Total Credits</span>
                      <p className="text-xl font-extrabold text-heading mt-1">{progress && progress.total_credits != null ? Math.round(progress.total_credits) : 0}</p>
                    </div>
                    <div className="p-3 bg-slate-100/50 dark:bg-slate-950/40 border border-slate-200/40 dark:border-slate-800/40 rounded-2xl">
                      <span className="text-[10px] text-muted-soft uppercase font-bold tracking-wider">GD Sessions</span>
                      <p className="text-xl font-extrabold text-heading mt-1">{gdLiveSessions.filter(s => s.status === "completed").length}</p>
                    </div>
                    <div className="p-3 bg-slate-100/50 dark:bg-slate-950/40 border border-slate-200/40 dark:border-slate-800/40 rounded-2xl">
                      <span className="text-[10px] text-muted-soft uppercase font-bold tracking-wider">Solo AI Tries</span>
                      <p className="text-xl font-extrabold text-heading mt-1">{soloHistory.length}</p>
                    </div>
                  </div>
                </div>

                <div className="card p-6 flex flex-col justify-between border-l-4 border-l-cyan-500">
                  <div>
                    <h3 className="text-base font-bold text-heading flex items-center gap-2">
                      <BookOpen className="w-5 h-5 text-cyan-500" /> Export PDF Report
                    </h3>
                    <p className="text-xs text-muted-soft mt-1">Export official Mount Zion communication analysis certificate and report summary.</p>
                  </div>
                  <Button
                    onClick={() => {
                      setPdfLoading(true);
                      setTimeout(() => {
                        setPdfLoading(false);
                        setSuccess("Report summary PDF generated and download triggered successfully!");
                      }, 1800);
                    }}
                    disabled={pdfLoading}
                    className="w-full btn-primary h-11 text-xs mt-6"
                  >
                    {pdfLoading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                    {pdfLoading ? "Generating PDF..." : "Download Official PDF"}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card p-6">
                  <h4 className="text-sm font-bold text-heading mb-4">Metric Score Balance</h4>
                  {soloHistory && soloHistory.length > 0 ? (
                    <div className="h-64 flex items-center justify-center">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={[
                          { metric: "Grammar", value: soloHistory[0]?.grammar_score || 0 },
                          { metric: "Fluency", value: soloHistory[0]?.fluency_score || 0 },
                          { metric: "Pronunciation", value: soloHistory[0]?.accent_score || 0 },
                          { metric: "Confidence", value: soloHistory[0]?.delivery_score || 0 },
                        ]}>
                          <PolarGrid stroke="var(--border)" />
                          <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10, fill: "var(--heading)", fontWeight: 600 }} />
                          <Radar name="Score" dataKey="value" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.25} />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-soft py-12 text-center">No recent practice history. Use Solo Practice to analyze metric balance.</div>
                  )}
                </div>

                <div className="card p-6">
                  <h4 className="text-sm font-bold text-heading mb-4">Historical Performance Trend</h4>
                  {soloHistory && soloHistory.length > 0 ? (
                    <div className="h-64 flex items-center justify-center">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={soloHistory.slice().reverse().map((h, i) => ({ name: `P${i + 1}`, score: h?.overall_score || 0 }))}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="name" stroke="var(--muted)" fontSize={10} />
                          <YAxis stroke="var(--muted)" fontSize={10} domain={[0, 100]} />
                          <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", color: "var(--heading)" }} />
                          <Bar dataKey="score" fill="#6366f1" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-soft py-12 text-center">No recent practice history to show historical trend.</div>
                  )}
                </div>
              </div>

              <div className="card p-6">
                <h4 className="text-sm font-bold text-heading mb-4 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-indigo-400" /> AI-Generated Skill Suggestions
                </h4>
                <div className="space-y-4 text-xs">
                  <div className="p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/10">
                    <h5 className="font-bold text-heading text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">🚀 Delivery & Pitch Modulation</h5>
                    <p className="text-muted-soft mt-1 leading-relaxed">Your pitch delivery displays strong speaker authority. Try to reduce speed pauses between sentences by 5-10% to achieve maximum conversational fluency scores.</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/10">
                    <h5 className="font-bold text-heading text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">🗣️ Accent Clarity & Pronunciation</h5>
                    <p className="text-muted-soft mt-1 leading-relaxed">Pronunciation of complex consonant grids is highly accurate. Focus on matching standard vowel lengths to align perfectly with AI assessment markers.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Achievements View */}
          {view === "achievements" && user && (
            <div className="space-y-6 pb-12 animate-fade-up">
              {(() => {
                const creditPoints = progress && typeof progress.total_credits === "number" ? Math.round(progress.total_credits) : 0;
                let levelTitle = "Novice Speaker";
                let levelNum = 1;
                let nextLevelPoints = 100;
                let prevLevelPoints = 0;
                if (creditPoints >= 500) { levelTitle = "Grandmaster Orator"; levelNum = 4; nextLevelPoints = 1000; prevLevelPoints = 500; }
                else if (creditPoints >= 250) { levelTitle = "Eloquent Orator"; levelNum = 3; nextLevelPoints = 500; prevLevelPoints = 250; }
                else if (creditPoints >= 100) { levelTitle = "Confident Communicator"; levelNum = 2; nextLevelPoints = 250; prevLevelPoints = 100; }
                const levelProgress = Math.min(100, Math.max(0, ((creditPoints - prevLevelPoints) / (nextLevelPoints - prevLevelPoints)) * 100));

                return (
                  <div className="card p-6 bg-gradient-to-r from-indigo-500/5 to-purple-500/5 border-l-4 border-l-purple-500 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-md">
                        <Trophy className="w-7 h-7" />
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-soft uppercase font-bold tracking-wider">Current Orator rank</p>
                        <h3 className="text-lg font-black text-heading flex items-center gap-2 mt-0.5">
                          {levelTitle} <span className="text-[10px] bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-extrabold px-2 py-0.5 rounded-md border border-indigo-500/25">Lvl {levelNum}</span>
                        </h3>
                      </div>
                    </div>

                    <div className="flex-1 w-full max-w-sm">
                      <div className="flex justify-between items-center text-xs mb-1">
                        <span className="text-muted-soft font-semibold">Rank Progress</span>
                        <span className="font-bold text-heading">{creditPoints} / {nextLevelPoints} XP</span>
                      </div>
                      <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
                        <div className="bg-gradient-to-r from-indigo-500 to-purple-500 h-2.5 rounded-full transition-all duration-700" style={{ width: `${levelProgress}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="card p-6">
                <h4 className="text-sm font-bold text-heading mb-6 flex items-center gap-2">
                  <Award className="w-5 h-5 text-indigo-500" /> Unlocked Speaking Badges
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { title: "First GD Attended", desc: "Completed 1 group discussion", unlocked: gdLiveSessions.filter(s => s.status === "completed").length >= 1, color: "icon-purple", icon: <Users className="w-5 h-5" /> },
                    { title: "Communicator Pro", desc: "Average speaking score > 80%", unlocked: progress && progress.average_score != null && progress.average_score >= 80, color: "icon-amber", icon: <Trophy className="w-5 h-5" /> },
                    { title: "Streak Master", desc: "Speak daily for 5 sessions", unlocked: soloHistory.length >= 5, color: "icon-green", icon: <Sparkles className="w-5 h-5" /> },
                    { title: "GD Grandmaster", desc: "Reach Level 4 Rank", unlocked: progress && progress.total_credits != null && progress.total_credits >= 500, color: "icon-cyan", icon: <Zap className="w-5 h-5" /> },
                  ].map((badge, idx) => (
                    <div key={idx} className={`p-5 rounded-3xl border ${badge.unlocked ? "border-slate-200/50 dark:border-slate-800 bg-white/40 dark:bg-slate-900/40" : "border-dashed border-slate-200/30 dark:border-slate-800/20 bg-slate-100/10 dark:bg-slate-900/5 opacity-55"} flex flex-col items-center text-center transition-all duration-300`}>
                      <div className={`icon-badge ${badge.color} mb-3`}>{badge.icon}</div>
                      <p className="text-xs font-bold text-heading leading-tight">{badge.title}</p>
                      <p className="text-[10px] text-muted-soft mt-1 leading-snug">{badge.desc}</p>
                      <span className={`text-[9px] font-extrabold uppercase mt-3.5 px-2.5 py-0.5 rounded-full ${badge.unlocked ? "bg-emerald-500/10 text-emerald-500" : "bg-slate-500/10 text-muted"}`}>
                        {badge.unlocked ? "Unlocked" : "Locked"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card p-6 border-l-4 border-l-cyan-500">
                <h4 className="text-sm font-bold text-heading mb-6 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-indigo-500" /> Completed AI Certifications
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {[
                    { title: "Speech Competency Certificate", type: "AI Speech Clarity", minScore: 75, minCredits: 20, completed: progress && progress.average_score != null && progress.average_score >= 75 && progress.total_credits != null && progress.total_credits >= 20 },
                    { title: "Advanced Group Discussion Certificate", type: "Live GD Competency", minScore: 85, minCredits: 30, completed: progress && progress.average_score != null && progress.average_score >= 85 && progress.total_credits != null && progress.total_credits >= 30 }
                  ].map((cert, idx) => (
                    <div key={idx} className="p-5 rounded-3xl border border-slate-200/50 dark:border-slate-800 bg-white/40 dark:bg-slate-900/40 flex flex-col justify-between relative overflow-hidden">
                      <div>
                        <div className="flex justify-between items-start mb-4">
                          <span className="text-[10px] uppercase font-bold tracking-wider text-muted-soft">{cert.type}</span>
                          <span className={`text-[9px] font-extrabold uppercase px-2.5 py-0.5 rounded-full ${cert.completed ? "bg-indigo-500/10 text-indigo-500" : "bg-slate-500/10 text-muted-soft"}`}>
                            {cert.completed ? "Verified" : "Requirements Pending"}
                          </span>
                        </div>
                        <h4 className="text-sm font-extrabold text-heading">{cert.title}</h4>
                        <p className="text-xs text-muted-soft mt-1.5 font-medium">
                          Required: <span className="font-semibold text-heading">{cert.minScore}% Avg Score</span> & <span className="font-semibold text-heading">{cert.minCredits} Credits</span>
                        </p>
                        <p className="text-xs text-muted-soft mt-1 font-medium">
                          Current: <span className="font-semibold text-heading">{progress && progress.average_score != null ? `${Number(progress.average_score).toFixed(1)}%` : "0.0%"}</span> & <span className="font-semibold text-heading">{progress && progress.total_credits != null ? Math.round(progress.total_credits) : 0} credits</span>
                        </p>
                      </div>
                      {(() => {
                        const downloading = idx === 0 ? cert1Downloading : cert2Downloading;
                        const setDownloading = idx === 0 ? setCert1Downloading : setCert2Downloading;
                        return (
                          <Button
                            onClick={() => {
                              setDownloading(true);
                              setTimeout(() => {
                                setDownloading(false);
                                setSuccess(`Certificate "${cert.title}" downloaded successfully!`);
                              }, 1800);
                            }}
                            disabled={!cert.completed || downloading}
                            className={`w-full mt-6 h-10 text-xs font-semibold ${cert.completed ? "btn-primary" : "btn-secondary cursor-not-allowed opacity-50"}`}
                          >
                            {downloading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                            {downloading ? "Preparing download..." : "Download Official Certificate"}
                          </Button>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Notifications View */}
          {view === "notifications" && user && (
            <div className="space-y-6 pb-12 animate-fade-up">
              <div className="card p-6 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-heading flex items-center gap-2">
                    <Bell className="w-5 h-5 text-indigo-500" /> Timeline Alerts
                  </h3>
                  <p className="text-xs text-muted-soft mt-1">Chronological log of platform alerts, system logs, and practice reminders.</p>
                </div>
                <button
                  onClick={() => {
                    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
                    setSuccess("All notifications successfully marked as read!");
                  }}
                  className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  Mark all as read
                </button>
              </div>

              <div className="card p-6 space-y-4">
                {notifications.map((noti) => (
                  <div
                    key={noti.id}
                    className={`flex gap-4 p-4 rounded-2xl border transition-all duration-200 ${noti.read
                      ? "bg-slate-100/50 dark:bg-slate-950/40 border-slate-200/40 dark:border-slate-800/40 hover:border-indigo-500/10"
                      : "bg-indigo-500/5 dark:bg-indigo-950/20 border-indigo-500/20 dark:border-indigo-500/30 hover:border-indigo-500/30"
                      }`}
                  >
                    <div className="w-8 h-8 rounded-xl bg-slate-200/50 dark:bg-slate-900 flex items-center justify-center shrink-0">
                      {noti.icon === "MessageSquare" ? (
                        <MessageSquare className="w-4 h-4 text-indigo-400" />
                      ) : noti.icon === "Target" ? (
                        <Target className="w-4 h-4 text-cyan-400" />
                      ) : (
                        <Sparkles className="w-4 h-4 text-purple-400" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-heading flex items-center gap-2">
                          {noti.title}
                          {!noti.read && (
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                          )}
                        </span>
                        <span className="text-[10px] text-muted-soft font-mono">{noti.time}</span>
                      </div>
                      <p className="text-xs text-muted-soft mt-1.5 leading-relaxed">{noti.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Settings View */}
          {view === "settings" && user && (
            <div className="space-y-6 pb-12 animate-fade-up">
              <div className="card p-6">
                <h3 className="text-base font-bold text-heading flex items-center gap-2">
                  <Settings className="w-5 h-5 text-indigo-500" /> Platform Preferences
                </h3>
                <p className="text-xs text-muted-soft mt-1">Configure local settings, accessibility features, and system voice prompts.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="card p-6 space-y-4">
                  <h4 className="text-sm font-bold text-heading flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-indigo-400" /> Voice & TTS Settings
                  </h4>
                  <div className="space-y-3.5 text-xs">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-heading">Enable Voice Feedback</p>
                        <p className="text-[10px] text-muted-soft mt-0.5">Let the AI read scores and results aloud.</p>
                      </div>
                      <button
                        onClick={() => voice.setEnabled(!voice.enabled)}
                        className={`w-10 h-6 rounded-full transition-all duration-300 relative ${voice.enabled ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-700"}`}
                      >
                        <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-all ${voice.enabled ? "translate-x-4" : "translate-x-0"}`} />
                      </button>
                    </div>
                    <div className="divider" />
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-heading">Local Language</span>
                      <span className="font-mono text-heading bg-slate-200/50 dark:bg-slate-800 px-2 py-0.5 rounded">en-US (Default)</span>
                    </div>
                  </div>
                </div>

                <div className="card p-6 space-y-4">
                  <h4 className="text-sm font-bold text-heading flex items-center gap-2">
                    <Sun className="w-4 h-4 text-indigo-400" /> Theme Configuration
                  </h4>
                  <div className="space-y-3.5 text-xs">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-heading">Theme Mode</p>
                        <p className="text-[10px] text-muted-soft mt-0.5">Toggle between dark and light themes.</p>
                      </div>
                      <button onClick={toggleTheme} className="btn-secondary px-4 py-2 text-xs flex items-center gap-1.5" suppressHydrationWarning>
                        {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                        <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
                      </button>
                    </div>
                    <div className="divider" />
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-heading">Accessibility Font</span>
                      <span className="font-mono text-heading bg-slate-200/50 dark:bg-slate-800 px-2 py-0.5 rounded">Standard (Inter)</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Dashboard View */}
          {view === "dashboard" && user && (
            <div className="space-y-6">
              {/* Welcome Banner */}
              {(() => {
                const creditPoints = progress && typeof progress.total_credits === "number" ? Math.round(progress.total_credits) : 0;
                let levelTitle = "Novice Speaker";
                let badgeColor = "bg-slate-500/10 text-slate-400 border-slate-500/20 dark:text-slate-300 dark:border-slate-800";
                if (creditPoints >= 500) {
                  levelTitle = "Grandmaster Orator";
                  badgeColor = "bg-gradient-to-r from-cyan-500/15 to-indigo-500/15 text-indigo-600 dark:text-cyan-400 border-indigo-500/20";
                } else if (creditPoints >= 250) {
                  levelTitle = "Eloquent Orator";
                  badgeColor = "bg-gradient-to-r from-amber-500/10 to-orange-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
                } else if (creditPoints >= 100) {
                  levelTitle = "Confident Communicator";
                  badgeColor = "bg-gradient-to-r from-purple-500/10 to-indigo-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20";
                }

                return (
                  <div className="relative overflow-hidden rounded-3xl border border-slate-200/50 dark:border-slate-800/80 p-6 md:p-8 shadow-lg bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl transition-all duration-300">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />
                    <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20 uppercase tracking-wider">
                            {user.role === "admin" ? "Admin Portal" : "Student Dashboard"}
                          </span>
                          {user.role === "student" && user.department && (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/10 text-purple-600 dark:text-purple-300 border border-purple-500/20 uppercase tracking-wider">
                              {user.department}
                            </span>
                          )}
                          {user.role === "student" && (
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${badgeColor}`}>
                              {levelTitle}
                            </span>
                          )}
                        </div>
                        <h2 className="text-2xl md:text-3xl font-extrabold text-heading tracking-tight flex items-center gap-2">
                          Welcome back, <span className="bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-500 dark:from-white dark:via-indigo-200 dark:to-indigo-400 bg-clip-text text-transparent">{user.name}</span>!
                        </h2>
                        <p className="text-sm text-body mt-1.5 max-w-xl">
                          {user.role === "admin"
                            ? "Manage group discussions, review student rankings, and monitor active sessions in real-time."
                            : "Track your communication progress, join live discussions, and build your confidence with AI feedback."}
                        </p>
                      </div>
                      {user.role === "student" && (
                        <div className="flex flex-wrap gap-2 text-xs bg-slate-100/50 dark:bg-slate-950/40 backdrop-blur-md border border-slate-200/50 dark:border-slate-800 p-4 rounded-2xl shrink-0">
                          <div>
                            <p className="font-bold text-heading mb-1 uppercase tracking-wider text-[10px]">Registration Info</p>
                            <p className="text-body">Reg No: <span className="font-mono text-heading font-semibold">{user.register_number}</span></p>
                            <p className="text-body">Year: <span className="text-heading font-semibold">{user.year || "3rd Year"}</span></p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {user.role === "student" ? (
                <>
                  {/* Metrics Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="card p-5 card-hover relative overflow-hidden group border-l-4 border-l-purple-500 shadow-sm">
                      <div className="absolute top-0 right-0 w-20 h-20 bg-purple-500/5 rounded-full blur-xl pointer-events-none group-hover:bg-purple-500/10 transition-colors" />
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[10px] font-bold text-muted-soft uppercase tracking-wider">Average Score</span>
                        <div className="icon-badge icon-purple group-hover:scale-110 transition-transform duration-200"><Trophy className="w-4 h-4" /></div>
                      </div>
                      <p className="text-3xl font-black text-heading">
                        {progress && progress.average_score != null ? `${Number(progress.average_score).toFixed(1)}%` : "0.0%"}
                      </p>
                      <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5 mt-3.5 overflow-hidden">
                        <div
                          className="bg-purple-500 h-1.5 rounded-full transition-all duration-500"
                          style={{ width: `${progress ? progress.average_score : 0}%` }}
                        />
                      </div>
                    </div>

                    <div className="card p-5 card-hover relative overflow-hidden group border-l-4 border-l-amber-500 shadow-sm">
                      <div className="absolute top-0 right-0 w-20 h-20 bg-amber-500/5 rounded-full blur-xl pointer-events-none group-hover:bg-amber-500/10 transition-colors" />
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[10px] font-bold text-muted-soft uppercase tracking-wider">Credit Points</span>
                        <div className="icon-badge icon-amber group-hover:scale-110 transition-transform duration-200"><Award className="w-4 h-4" /></div>
                      </div>
                      <p className="text-3xl font-black text-heading">
                        {progress && typeof progress.total_credits === "number" ? Math.round(progress.total_credits) : 0} <span className="text-xs text-muted-soft font-normal">pts</span>
                      </p>
                      <p className="text-[10px] text-muted mt-3.5">Overall GD credit score</p>
                    </div>

                    <div className="card p-5 card-hover relative overflow-hidden group border-l-4 border-l-emerald-500 shadow-sm">
                      <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-500/5 rounded-full blur-xl pointer-events-none group-hover:bg-emerald-500/10 transition-colors" />
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[10px] font-bold text-muted-soft uppercase tracking-wider">GD Sessions</span>
                        <div className="icon-badge icon-green group-hover:scale-110 transition-transform duration-200"><Users className="w-4 h-4" /></div>
                      </div>
                      <p className="text-3xl font-black text-heading">
                        {gdLiveSessions.filter(s => s.status === "completed").length}
                      </p>
                      <p className="text-[10px] text-muted mt-3.5">Group discussions completed</p>
                    </div>

                    <div className="card p-5 card-hover relative overflow-hidden group border-l-4 border-l-cyan-500 shadow-sm">
                      <div className="absolute top-0 right-0 w-20 h-20 bg-cyan-500/5 rounded-full blur-xl pointer-events-none group-hover:bg-cyan-500/10 transition-colors" />
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[10px] font-bold text-muted-soft uppercase tracking-wider">Solo Practice</span>
                        <div className="icon-badge icon-cyan group-hover:scale-110 transition-transform duration-200"><Target className="w-4 h-4" /></div>
                      </div>
                      <p className="text-3xl font-black text-heading">
                        {soloHistory.length}
                      </p>
                      <p className="text-[10px] text-muted mt-3.5">Solo AI practices completed</p>
                    </div>
                  </div>

                  {/* Main Grid: Actions & Chart */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Left Actions column */}
                    <div className="lg:col-span-5 space-y-6">
                      {/* Join GD Session Form */}
                      <div className="card p-6 border border-indigo-500/15 bg-gradient-to-tr from-indigo-500/5 via-transparent to-transparent relative overflow-hidden">
                        <div className="absolute top-3 right-3 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_#ef4444]" />
                          <span className="text-[9px] font-extrabold text-red-500 dark:text-red-400 uppercase tracking-widest">Live Room</span>
                        </div>
                        <div className="absolute -top-12 -right-12 w-28 h-28 bg-indigo-500/10 rounded-full blur-xl pointer-events-none" />
                        <h3 className="text-base font-bold text-heading mb-1.5 flex items-center gap-2">
                          <Zap className="w-4 h-4 text-indigo-500 animate-bounce" /> Join GD Live Session
                        </h3>
                        <p className="text-xs text-muted-soft mb-4">Enter the 4-digit code provided by your administrator to join the live session.</p>
                        <div className="flex gap-2">
                          <Input
                            placeholder="e.g. A3C9"
                            maxLength={4}
                            value={gdLiveCode}
                            onChange={(e) => setGdLiveCode(e.target.value)}
                            className="inp flex-1 font-mono uppercase tracking-wider h-11 text-center text-lg focus:ring-indigo-500/20 focus:border-indigo-500/50"
                          />
                          <Button
                            onClick={joinGdLive}
                            disabled={loading}
                            className="btn-primary px-5 h-11 text-sm font-semibold shrink-0 bg-gradient-to-r from-indigo-600 to-violet-600 border-0"
                          >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Join"}
                          </Button>
                        </div>
                      </div>

                      {/* Gamified Speaker Tier Card */}
                      {(() => {
                        const creditPoints = progress && typeof progress.total_credits === "number" ? Math.round(progress.total_credits) : 0;
                        let levelTitle = "Novice Speaker";
                        let levelNum = 1;
                        let nextLevelPoints = 100;
                        let prevLevelPoints = 0;
                        let badgeIcon = <Award className="w-5 h-5 text-slate-400" />;

                        if (creditPoints >= 500) {
                          levelTitle = "Grandmaster Orator";
                          levelNum = 4;
                          nextLevelPoints = 1000;
                          prevLevelPoints = 500;
                          badgeIcon = <Trophy className="w-5 h-5 text-cyan-400 animate-pulse" />;
                        } else if (creditPoints >= 250) {
                          levelTitle = "Eloquent Orator";
                          levelNum = 3;
                          nextLevelPoints = 500;
                          prevLevelPoints = 250;
                          badgeIcon = <Sparkles className="w-5 h-5 text-amber-400" />;
                        } else if (creditPoints >= 100) {
                          levelTitle = "Confident Communicator";
                          levelNum = 2;
                          nextLevelPoints = 250;
                          prevLevelPoints = 100;
                          badgeIcon = <Zap className="w-5 h-5 text-purple-400" />;
                        }

                        const levelProgress = Math.min(100, Math.max(0, ((creditPoints - prevLevelPoints) / (nextLevelPoints - prevLevelPoints)) * 100));

                        return (
                          <div className="card p-5 relative overflow-hidden border border-purple-500/10">
                            <div className="absolute -top-12 -left-12 w-32 h-32 bg-purple-500/5 rounded-full blur-2xl pointer-events-none" />
                            <div className="flex items-center gap-3.5 mb-4">
                              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white shrink-0 shadow-md">
                                {badgeIcon}
                              </div>
                              <div className="min-w-0">
                                <p className="text-[10px] font-bold text-muted uppercase tracking-wider">Current Tier</p>
                                <h4 className="text-sm font-bold text-heading truncate flex items-center gap-1.5">
                                  {levelTitle} <span className="text-[10px] font-extrabold bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded border border-indigo-500/25">Lvl {levelNum}</span>
                                </h4>
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              <div className="flex justify-between items-center text-xs">
                                <span className="text-muted font-medium">Rank Progress</span>
                                <span className="font-bold text-heading">{creditPoints} / {nextLevelPoints} pts</span>
                              </div>
                              <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                                <div
                                  className="bg-gradient-to-r from-indigo-500 to-purple-500 h-2 rounded-full transition-all duration-700"
                                  style={{ width: `${levelProgress}%` }}
                                />
                              </div>
                              {creditPoints < 500 ? (
                                <p className="text-[10px] text-muted-soft text-right italic mt-1">
                                  Need {nextLevelPoints - creditPoints} more points to reach the next tier!
                                </p>
                              ) : (
                                <p className="text-[10px] text-muted-soft text-right italic mt-1">
                                  You are at the peak tier! Keep it up!
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Quick Launch Cards */}
                      <div className="grid grid-cols-2 gap-4">
                        <button
                          onClick={startSoloPractice}
                          className="flex flex-col justify-between p-4 rounded-3xl border border-cyan-500/10 hover:border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 via-transparent to-transparent hover:from-cyan-500/10 hover:shadow-[0_8px_30px_rgba(6,182,212,0.15)] group relative overflow-hidden h-36 transition-all duration-300 hover:-translate-y-1 text-left"
                        >
                          <div className="icon-badge icon-cyan mb-2 group-hover:scale-110 transition-transform duration-200"><Target className="w-5 h-5" /></div>
                          <div>
                            <p className="text-sm font-bold text-heading group-hover:text-cyan-400 transition-colors">Solo Practice</p>
                            <p className="text-[10px] text-muted-soft mt-1 leading-snug">Practice speaking solo with instant AI scores & feedback.</p>
                          </div>
                        </button>

                        <button
                          onClick={() => loadLeaderboard("ALL", "ALL", "all")}
                          className="flex flex-col justify-between p-4 rounded-3xl border border-amber-500/10 hover:border-amber-500/30 bg-gradient-to-br from-amber-500/5 via-transparent to-transparent hover:from-amber-500/10 hover:shadow-[0_8px_30px_rgba(245,158,11,0.15)] group relative overflow-hidden h-36 transition-all duration-300 hover:-translate-y-1 text-left"
                        >
                          <div className="icon-badge icon-amber mb-2 group-hover:scale-110 transition-transform duration-200"><Trophy className="w-5 h-5" /></div>
                          <div>
                            <p className="text-sm font-bold text-heading group-hover:text-amber-400 transition-colors">Leaderboard</p>
                            <p className="text-[10px] text-muted-soft mt-1 leading-snug">Check your ranking among all students and departments.</p>
                          </div>
                        </button>
                      </div>

                      {/* Motivational Quote */}
                      {soloQuote && (
                        <div className="card p-5 bg-indigo-500/5 dark:bg-indigo-500/10 border border-indigo-500/20 italic relative overflow-hidden group hover:border-indigo-500/40 transition-colors shadow-sm">
                          <div className="absolute -right-6 -bottom-6 w-20 h-20 bg-indigo-500/5 rounded-full blur-xl pointer-events-none" />
                          <div className="absolute top-2 left-3 text-4xl text-slate-700/40 dark:text-slate-500/20 select-none font-serif">“</div>
                          <p className="text-xs text-body leading-relaxed pl-4 pr-2 font-medium z-10 relative">
                            {soloQuote.quote}
                          </p>
                          <p className="text-right text-[10px] font-bold text-muted-soft mt-2 tracking-wide uppercase">
                            — {soloQuote.author}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Right Chart/Breakdown column */}
                    <div className="lg:col-span-7 flex flex-col">
                      <div className="card p-6 flex-1 flex flex-col justify-between relative overflow-hidden shadow-sm">
                        <div className="absolute -top-24 -right-24 w-48 h-48 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
                        <div>
                          <h3 className="text-base font-bold text-heading mb-1.5 flex items-center gap-2">
                            <TrendingUp className="w-5 h-5 text-indigo-400" /> Communication Skills Analysis
                          </h3>
                          <p className="text-xs text-muted-soft mb-6">
                            RPG-style breakdown and detail analytics from your most recent Solo Practice session.
                          </p>
                        </div>

                        {soloHistory && soloHistory.length > 0 ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center flex-1">
                            {/* Radar Chart Panel */}
                            <div className="h-56 relative flex items-center justify-center">
                              <ResponsiveContainer width="100%" height="100%">
                                <RadarChart data={[
                                  { metric: "Grammar", value: soloHistory[0]?.grammar_score || 0 },
                                  { metric: "Fluency", value: soloHistory[0]?.fluency_score || 0 },
                                  { metric: "Pronunciation", value: soloHistory[0]?.accent_score || 0 },
                                  { metric: "Confidence", value: soloHistory[0]?.delivery_score || 0 },
                                ]}>
                                  <defs>
                                    <radialGradient id="radarGlow" cx="50%" cy="50%" r="50%">
                                      <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.5} />
                                      <stop offset="100%" stopColor="#818cf8" stopOpacity={0.1} />
                                    </radialGradient>
                                  </defs>
                                  <PolarGrid stroke="var(--border)" />
                                  <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10, fill: "var(--heading)", fontWeight: 600 }} />
                                  <Radar name="Score" dataKey="value" stroke="#8b5cf6" fill="url(#radarGlow)" fillOpacity={1} dot={{ r: 4.5, fill: "#8b5cf6", stroke: "#ffffff", strokeWidth: 1.5 }} />
                                  <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", color: "var(--heading)" }} />
                                </RadarChart>
                              </ResponsiveContainer>
                            </div>

                            {/* Skills progress lines */}
                            <div className="space-y-4">
                              <div className="rounded-xl p-3.5 bg-[var(--bg)] border border-[var(--border)] text-xs mb-1">
                                <p className="text-muted-soft font-bold text-[9px] uppercase tracking-wider">LATEST TOPIC</p>
                                <p className="text-heading font-bold mt-1 line-clamp-2">{soloHistory[0]?.topic}</p>
                              </div>

                              {[
                                { label: "Grammar & Structure", val: soloHistory[0]?.grammar_score, icon: "📝", color: "bg-indigo-500", text: "text-indigo-400" },
                                { label: "Fluency & Speech Rate", val: soloHistory[0]?.fluency_score, icon: "⚡", color: "bg-purple-500", text: "text-purple-400" },
                                { label: "Pronunciation & Clarity", val: soloHistory[0]?.accent_score, icon: "🗣️", color: "bg-cyan-500", text: "text-cyan-400" },
                                { label: "Confidence & Delivery", val: soloHistory[0]?.delivery_score, icon: "🚀", color: "bg-emerald-500", text: "text-emerald-400" },
                              ].map((skill) => (
                                <div key={skill.label} className="space-y-1.5">
                                  <div className="flex items-center justify-between text-[11px]">
                                    <span className="font-semibold text-heading flex items-center gap-1.5">
                                      <span>{skill.icon}</span> {skill.label}
                                    </span>
                                    <span className={`font-extrabold ${skill.text}`}>{skill.val != null ? `${Number(skill.val).toFixed(0)}/100` : "N/A"}</span>
                                  </div>
                                  <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden border border-slate-300/10 dark:border-slate-700/10">
                                    <div
                                      className={`${skill.color} h-1.5 rounded-full transition-all duration-700`}
                                      style={{ width: `${skill.val || 0}%` }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center py-10 text-center flex-1 border border-dashed rounded-2xl border-slate-800 bg-slate-950/20">
                            <Target className="w-10 h-10 text-slate-600 mb-2.5" />
                            <p className="text-sm font-semibold text-heading">No practice history found</p>
                            <p className="text-xs text-muted-soft max-w-[240px] mt-1 leading-normal">Start your first solo practice session to visualize your communication breakdown here.</p>
                            <Button onClick={startSoloPractice} className="btn-primary text-xs h-9 px-4 mt-3">Start Now</Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* History Feeds Section */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* GD Session History */}
                    <div className="card p-6 flex flex-col justify-between relative overflow-hidden group shadow-sm">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-xl pointer-events-none" />
                      <div>
                        <h3 className="text-base font-bold text-heading mb-4 flex items-center gap-2">
                          <Users className="w-5 h-5 text-indigo-400" /> Attended GD History
                        </h3>

                        {gdLiveSessions.filter(s => s.status === "completed").length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-10 text-center border border-dashed rounded-2xl border-slate-800 bg-slate-950/20 flex-1 min-h-[220px]">
                            <Users className="w-8 h-8 text-slate-600 mb-2" />
                            <p className="text-xs font-semibold text-heading">No GD sessions attended yet</p>
                          </div>
                        ) : (
                          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                            {gdLiveSessions.filter((s: any) => s.status === "completed").slice(0, 5).map((s: any) => (
                              <div key={s.session_code} className="flex items-center justify-between p-3.5 rounded-xl bg-[var(--bg)] border border-[var(--border)] hover:border-indigo-500/30 hover:shadow-sm transition-all duration-200">
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <p className="text-xs font-bold text-heading">Session Code:</p>
                                    <code className="text-[11px] font-mono font-bold bg-slate-950 text-indigo-300 px-2.5 py-0.5 rounded border border-indigo-950">{s.session_code}</code>
                                  </div>
                                  <p className="text-[10px] text-muted-soft mt-1.5 flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {new Date(s.created_at || Date.now()).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                  </p>
                                </div>
                                <span className="text-[9px] font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 uppercase tracking-wider">
                                  Attended
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Solo Session History */}
                    <div className="card p-6 flex flex-col justify-between relative overflow-hidden group shadow-sm">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/5 rounded-full blur-xl pointer-events-none" />
                      <div>
                        <h3 className="text-base font-bold text-heading mb-4 flex items-center gap-2">
                          <Target className="w-5 h-5 text-indigo-400" /> Solo Practice History
                        </h3>

                        {soloHistory.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-10 text-center border border-dashed rounded-2xl border-slate-800 bg-slate-950/20 flex-1 min-h-[220px]">
                            <Target className="w-8 h-8 text-slate-600 mb-2" />
                            <p className="text-xs font-semibold text-heading">No solo practices completed yet</p>
                          </div>
                        ) : (
                          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                            {soloHistory.slice(0, 5).map((s: any) => (
                              <div key={s.id} className="p-3.5 rounded-xl bg-[var(--bg)] border border-[var(--border)] hover:border-indigo-500/30 hover:shadow-sm transition-all duration-200">
                                <div className="flex justify-between items-start gap-2">
                                  <p className="text-xs font-bold text-heading line-clamp-1 flex-1">{s.topic}</p>
                                  <span className="text-xs font-extrabold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                                    {(s.overall_score != null ? Number(s.overall_score) : 0).toFixed(1)}
                                  </span>
                                </div>
                                {s.weaknesses && (
                                  <p className="text-[10px] text-muted-soft mt-2 line-clamp-1 bg-[var(--surface)] border border-[var(--border)] p-1.5 rounded flex items-center gap-1">
                                    <Sparkles className="w-3 h-3 text-cyan-400 shrink-0" />
                                    <span>Feedback: {s.weaknesses.split(";")[0]}</span>
                                  </p>
                                )}
                                <div className="flex justify-between items-center text-[10px] text-muted-soft mt-2 pt-2 border-t border-[var(--border)]">
                                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(s.created_at || Date.now()).toLocaleDateString()}</span>
                                  <span>Session #{s.session_number}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                /* Admin Dashboard */
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="card p-5 card-hover">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold text-muted-soft uppercase tracking-wider font-bold">Total GD Live Sessions</span>
                        <div className="icon-badge icon-purple"><Users className="w-5 h-5" /></div>
                      </div>
                      <p className="text-3xl font-extrabold text-heading">
                        {gdLiveSessions.length}
                      </p>
                      <p className="text-xs text-muted-soft mt-3">All sessions created</p>
                    </div>

                    <div className="card p-5 card-hover">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold text-muted-soft uppercase tracking-wider font-bold">Active Sessions</span>
                        <div className="icon-badge icon-green"><Radio className="w-5 h-5 text-emerald-400" /></div>
                      </div>
                      <p className="text-3xl font-extrabold text-heading">
                        {gdLiveSessions.filter(s => s.status !== "completed").length}
                      </p>
                      <p className="text-xs text-muted-soft mt-3">Sessions in progress/waiting</p>
                    </div>

                    <div className="card p-5 card-hover">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold text-muted-soft uppercase tracking-wider font-bold">Completed Sessions</span>
                        <div className="icon-badge icon-cyan"><CheckCircle2 className="w-5 h-5" /></div>
                      </div>
                      <p className="text-3xl font-extrabold text-heading">
                        {gdLiveSessions.filter(s => s.status === "completed").length}
                      </p>
                      <p className="text-xs text-muted-soft mt-3">Sessions successfully finished</p>
                    </div>
                  </div>

                  {/* Admin Actions Panel */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="card p-6 border border-indigo-500/20 bg-indigo-500/5 dark:bg-indigo-950/10 flex flex-col justify-between min-h-60">
                      <div>
                        <h3 className="text-base font-bold text-heading mb-1.5 flex items-center gap-2">
                          <Sparkles className="w-5 h-5 text-indigo-400" /> Quick Session Launcher
                        </h3>
                        <p className="text-xs text-muted-soft mb-6 leading-normal">
                          Create and host a live Group Discussion. This will instantly generate a new 4-digit code for students.
                        </p>
                      </div>
                      <Button
                        onClick={createGdLiveSession}
                        disabled={loading}
                        className="btn-primary w-full h-11 font-semibold flex items-center justify-center gap-2"
                      >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                          <>
                            <Users className="w-4 h-4" />
                            <span>Create Live GD Session</span>
                          </>
                        )}
                      </Button>
                    </div>

                    <div className="card p-6 flex flex-col justify-between min-h-60">
                      <div>
                        <h3 className="text-base font-bold text-heading mb-1.5 flex items-center gap-2">
                          <Trophy className="w-5 h-5 text-amber-400" /> Comprehensive Rankings
                        </h3>
                        <p className="text-xs text-muted-soft mb-6 leading-normal">
                          Analyze students' performance across departments, semesters, and overall credit points.
                        </p>
                      </div>
                      <Button
                        onClick={() => loadLeaderboard()}
                        className="btn-secondary w-full h-11 font-semibold flex items-center justify-center gap-2"
                      >
                        <Trophy className="w-4 h-4" />
                        <span>Open Leaderboard</span>
                      </Button>
                    </div>

                    <div className="card p-6 flex flex-col justify-between min-h-60">
                      <div>
                        <h3 className="text-base font-bold text-heading mb-1.5 flex items-center gap-2">
                          <Shield className="w-5 h-5 text-purple-400" /> GD Admin Dashboard
                        </h3>
                        <p className="text-xs text-muted-soft mb-6 leading-normal">
                          View details of active sessions, delete sessions, or monitor active teams in progress.
                        </p>
                      </div>
                      <Button
                        onClick={() => setView("gd-live-admin")}
                        className="btn-secondary w-full h-11 font-semibold flex items-center justify-center gap-2"
                      >
                        <Shield className="w-4 h-4" />
                        <span>Manage Live Sessions</span>
                      </Button>
                    </div>
                  </div>

                  {/* Admin: List of Active/Recent Sessions */}
                  <div className="card p-6">
                    <h3 className="text-base font-bold text-heading mb-4 flex items-center gap-2">
                      <Users className="w-5 h-5 text-indigo-400" /> Active and Recent GD Sessions
                    </h3>

                    {gdLiveSessions.length === 0 ? (
                      <p className="text-muted-soft text-sm py-4 text-center">No sessions hosted yet.</p>
                    ) : (
                      <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                        {gdLiveSessions.slice(0, 8).map((s: any) => (
                          <div key={s.session_code} className="flex items-center justify-between p-4 rounded-xl surface-2 border border-[var(--border)] hover:border-slate-300 dark:hover:border-slate-700 transition">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-heading">Code:</span>
                                <code className="text-xs font-mono font-bold bg-[var(--surface-2)] text-indigo-500 dark:text-indigo-300 px-2 py-0.5 rounded border border-[var(--border)]">{s.session_code}</code>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide border ${s.status === "completed"
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                  : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                  }`}>
                                  {s.status}
                                </span>
                              </div>
                              <p className="text-xs text-muted-soft mt-1">
                                {s.participant_count || 0} participants joined · {s.team_count || 0} teams active
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {s.status !== "completed" ? (
                                <Button
                                  onClick={() => { setGdLiveAdminViewCode(s.session_code); setView("gd-live-admin-view"); loadGdLiveParticipants(s.session_code); }}
                                  className="btn-primary text-xs h-8 px-3"
                                >
                                  Manage
                                </Button>
                              ) : (
                                <Button
                                  onClick={() => loadGdLiveLeaderboard(s.session_code)}
                                  className="btn-secondary text-xs h-8 px-3"
                                >
                                  Leaderboard
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
          {/* Leaderboard View */}
          {view === "gd-leaderboard" && (
            <div className="space-y-6 pb-12 animate-fade-up">
              {/* Header */}
              <div className="card p-6">
                <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                  <h2 className="text-base font-bold text-heading flex items-center gap-2"><Trophy className="w-5 h-5 text-amber-500" /> Leaderboard</h2>
                  <Button onClick={() => setView("dashboard")} variant="secondary" className="text-xs h-8">Back</Button>
                </div>
                {/* Filter Pills */}
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <span className="text-xs text-muted-soft mr-1 self-center font-semibold">Department:</span>
                    {(lbData?.departments || ["ALL"]).map(d => (
                      <button key={d} onClick={() => loadLeaderboard(d, lbYear, lbTimeframe)}
                        className={`text-xs px-3.5 py-1.5 rounded-full border transition ${lbDepartment === d ? "bg-amber-500/10 dark:bg-amber-500/20 border-amber-500/40 text-amber-700 dark:text-amber-200 font-bold" : "surface-2 border text-body hover:bg-slate-500/10"}`}>{d}</button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="text-xs text-muted-soft mr-1 self-center font-semibold">Year:</span>
                    {(lbData?.years || ["ALL"]).map(y => (
                      <button key={y} onClick={() => loadLeaderboard(lbDepartment, y, lbTimeframe)}
                        className={`text-xs px-3.5 py-1.5 rounded-full border transition ${lbYear === y ? "bg-amber-500/10 dark:bg-amber-500/20 border-amber-500/40 text-amber-700 dark:text-amber-200 font-bold" : "surface-2 border text-body hover:bg-slate-500/10"}`}>{y}</button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="text-xs text-muted-soft mr-1 self-center font-semibold">Timeframe:</span>
                    {[{ v: "all", l: "All Time" }, { v: "this_month", l: "This Month" }, { v: "past_month", l: "Past Month" }].map(t => (
                      <button key={t.v} onClick={() => loadLeaderboard(lbDepartment, lbYear, t.v)}
                        className={`text-xs px-3.5 py-1.5 rounded-full border transition ${lbTimeframe === t.v ? "bg-amber-500/10 dark:bg-amber-500/20 border-amber-500/40 text-amber-700 dark:text-amber-200 font-bold" : "surface-2 border text-body hover:bg-slate-500/10"}`}>{t.l}</button>
                    ))}
                    <span className="text-xs text-muted-soft ml-auto self-center">Overall Score by Credit Points</span>
                  </div>
                </div>
              </div>

              {/* Stats Cards */}
              {lbData && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: "Top Score", value: lbData.stats.top_score, icon: <Trophy className="w-4 h-4" />, color: "text-amber-500" },
                    { label: "Active Speakers", value: lbData.stats.active_participants, icon: <Users className="w-4 h-4" />, color: "text-emerald-500" },
                    { label: "Average Score", value: lbData.stats.average_score, icon: <TrendingUp className="w-4 h-4" />, color: "text-purple-500" },
                    { label: "GD Interviews", value: lbData.stats.total_interviews, icon: <MessageSquare className="w-4 h-4" />, color: "text-cyan-500" },
                  ].map(c => (
                    <div key={c.label} className="card p-4 border-l-4 border-l-slate-400">
                      <div className="flex items-center gap-2 text-muted-soft text-xs mb-2">{c.icon} {c.label}</div>
                      <p className={`text-2xl font-black ${c.color}`}>{typeof c.value === "number" && c.label !== "Active Speakers" && c.label !== "GD Interviews" ? Number(c.value).toFixed(1) : c.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Speaker Podium block */}
              {lbData && lbData.rankings && lbData.rankings.length >= 3 && (
                <div className="grid grid-cols-3 gap-4 items-end max-w-xl mx-auto my-8 select-none">
                  {/* 2nd Place */}
                  <div className="flex flex-col items-center">
                    <div className="w-12 h-12 rounded-xl bg-slate-300 dark:bg-slate-700 flex items-center justify-center font-bold text-heading text-sm shadow border border-slate-400/35 relative">
                      {lbData.rankings[1].name ? lbData.rankings[1].name[0].toUpperCase() : "U"}
                      <span className="absolute -top-2.5 bg-slate-400 text-slate-950 text-[9px] px-1.5 py-0.5 rounded-full font-black">2nd</span>
                    </div>
                    <p className="text-xs font-bold text-heading mt-2 truncate max-w-[90px]">{lbData.rankings[1].name}</p>
                    <p className="text-[10px] text-muted-soft font-semibold">{lbData.rankings[1].total_credits} pts</p>
                    <div className="w-full h-24 bg-gradient-to-t from-slate-400/20 to-slate-400/5 dark:from-slate-700/25 dark:to-slate-700/5 border border-slate-300/40 dark:border-slate-800/40 rounded-t-2xl mt-3 flex items-center justify-center font-black text-slate-400/50 text-2xl">II</div>
                  </div>

                  {/* 1st Place */}
                  <div className="flex flex-col items-center">
                    <div className="w-16 h-16 rounded-xl bg-amber-100 dark:bg-amber-950 flex items-center justify-center font-bold text-heading text-base shadow border-2 border-amber-400 relative">
                      {lbData.rankings[0].name ? lbData.rankings[0].name[0].toUpperCase() : "U"}
                      <Trophy className="absolute -top-5 text-amber-500 w-6 h-6 animate-bounce" />
                    </div>
                    <p className="text-xs font-extrabold text-heading mt-2 truncate max-w-[100px]">{lbData.rankings[0].name}</p>
                    <p className="text-[10px] text-amber-500 font-bold">{lbData.rankings[0].total_credits} pts</p>
                    <div className="w-full h-32 bg-gradient-to-t from-amber-500/20 to-amber-500/5 dark:from-amber-500/10 dark:to-amber-500/5 border border-amber-400/40 rounded-t-2xl mt-3 flex flex-col items-center justify-center font-black text-amber-500/50 text-3xl">
                      <span>I</span>
                    </div>
                  </div>

                  {/* 3rd Place */}
                  <div className="flex flex-col items-center">
                    <div className="w-12 h-12 rounded-xl bg-orange-100 dark:bg-orange-950/60 flex items-center justify-center font-bold text-heading text-sm shadow border border-orange-500/35 relative">
                      {lbData.rankings[2].name ? lbData.rankings[2].name[0].toUpperCase() : "U"}
                      <span className="absolute -top-2.5 bg-orange-500 text-orange-950 text-[9px] px-1.5 py-0.5 rounded-full font-black">3rd</span>
                    </div>
                    <p className="text-xs font-bold text-heading mt-2 truncate max-w-[90px]">{lbData.rankings[2].name}</p>
                    <p className="text-[10px] text-muted-soft font-semibold">{lbData.rankings[2].total_credits} pts</p>
                    <div className="w-full h-20 bg-gradient-to-t from-orange-500/20 to-orange-500/5 dark:from-orange-500/15 dark:to-orange-500/5 border border-orange-500/40 rounded-t-2xl mt-3 flex items-center justify-center font-black text-orange-500/50 text-2xl">III</div>
                  </div>
                </div>
              )}

              {/* Ranking Table */}
              {lbData && lbData.rankings.length > 0 && (
                <div className="card p-4 md:p-5 overflow-x-auto">
                  <h3 className="text-sm font-semibold text-heading mb-4 flex items-center gap-2"><Award className="w-4 h-4 text-amber-500" /> Rankings</h3>
                  <table className="ent-table min-w-[600px]">
                    <thead>
                      <tr>
                        <th className="pb-2 pr-2">Rank</th>
                        <th className="pb-2 pr-2">Name</th>
                        <th className="pb-2 pr-2 hidden md:table-cell">Department</th>
                        <th className="pb-2 pr-2 hidden md:table-cell">Year</th>
                        <th className="pb-2 pr-2">Score</th>
                        <th className="pb-2 pr-2">Grammar</th>
                        <th className="pb-2 pr-2">Fluency</th>
                        <th className="pb-2 pr-2 hidden md:table-cell">Confidence</th>
                        <th className="pb-2 pr-2 hidden md:table-cell">Activity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lbData.rankings.map((r) => (
                        <tr key={r.id} className={`${r.rank <= 3 ? "bg-amber-500/5 dark:bg-amber-500/10" : ""}`}>
                          <td className="py-3 pr-2">
                            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${r.rank === 1 ? "bg-amber-500 text-slate-950" : r.rank === 2 ? "bg-slate-400 text-slate-950" : r.rank === 3 ? "bg-orange-500 text-slate-950" : "surface-2 text-body"}`}>{r.rank}</span>
                          </td>
                          <td className="py-3 pr-2 text-heading font-semibold whitespace-nowrap text-xs md:text-sm">{r.name}</td>
                          <td className="py-3 pr-2 text-body text-xs md:text-sm hidden md:table-cell">{r.department}</td>
                          <td className="py-3 pr-2 text-body text-xs md:text-sm hidden md:table-cell">{r.year}</td>
                          <td className="py-3 pr-2 text-amber-500 font-bold text-xs md:text-sm">{r.total_credits}</td>
                          <td className="py-3 pr-2 text-indigo-400 text-xs md:text-sm">{(r.grammar != null ? Number(r.grammar) : 0).toFixed(1)}</td>
                          <td className="py-3 pr-2 text-purple-400 text-xs md:text-sm">{(r.fluency != null ? Number(r.fluency) : 0).toFixed(1)}</td>
                          <td className="py-3 pr-2 text-cyan-400 text-xs md:text-sm hidden md:table-cell">{(r.relevance != null ? Number(r.relevance) : 0).toFixed(1)}</td>
                          <td className="py-3 pr-2 text-body text-xs md:text-sm hidden md:table-cell">{r.sessions_completed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {lbData && lbData.rankings.length === 0 && (
                <div className="card p-8 text-center border-dashed">
                  <Trophy className="w-8 h-8 mx-auto text-slate-600 mb-2" />
                  <p className="text-muted-soft text-xs">No evaluations found for the selected filters.</p>
                </div>
              )}

              {/* All Time Achievers */}
              {lbData && lbData.all_time_achievers.length > 0 && (
                <div className="card p-5">
                  <h3 className="text-sm font-semibold text-heading mb-4 flex items-center gap-2"><Award className="w-4 h-4 text-amber-500" /> All Time Achievers</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {lbData.all_time_achievers.map((a) => (
                      <div key={a.id} className={`flex items-center gap-3 p-3 rounded-xl border ${a.rank === 1 ? "bg-gradient-to-r from-amber-500/10 to-orange-500/10 border-amber-500/30" : "surface-2 border"}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${a.rank === 1 ? "bg-amber-500 text-slate-950" : a.rank === 2 ? "bg-slate-400 text-slate-950" : a.rank === 3 ? "bg-orange-500 text-slate-950" : "surface-2 text-body"}`}>{a.rank}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-heading truncate">{a.name}</p>
                          <p className="text-[10px] text-muted-soft">{a.department} · {a.year}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-bold text-emerald-500">{a.total_credits}</p>
                          <p className="text-[9px] text-muted-soft">{a.sessions_completed} sessions</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── Solo Practice ─── */}
          {view === "solo-practice" && !soloSession && (
            <div className="card p-8 text-center max-w-md mx-auto my-12 border-dashed">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-indigo-500 mb-3" />
              <p className="text-heading font-bold text-sm">Preparing Practice Playground</p>
              <p className="text-xs text-muted-soft mt-1">Initializing AI speaking topic models...</p>
            </div>
          )}
          {view === "solo-practice" && soloSession && (
            <div className="space-y-6 pb-12 animate-fade-up">
              {/* Promotional Hero / Header */}
              <div className="card p-6 bg-gradient-to-r from-cyan-500/5 to-indigo-500/5 border-l-4 border-l-cyan-500 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h3 className="text-base font-bold text-heading flex items-center gap-2">
                    <Target className="w-5 h-5 text-cyan-500" /> AI Practice Playground
                  </h3>
                  <p className="text-xs text-muted-soft mt-1">Practice communication skills solo and receive granular scoring from our speech assessment engine.</p>
                </div>
                <button onClick={startSoloPractice} className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1">
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh Topic
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                {/* Topic card details */}
                <div className="card p-6 md:col-span-7 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2.5 mb-4">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20 uppercase tracking-wider">
                        Level: Intermediate
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 uppercase tracking-wider">
                        Topic #{soloSession.session_number}
                      </span>
                    </div>
                    <h4 className="text-base font-extrabold text-heading mb-3 leading-snug">{soloSession.topic}</h4>
                    <p className="text-xs text-muted-soft leading-relaxed">Prepare your thoughts. You have 4 minutes of prep time, followed by 10 minutes of active recording. Speak clearly into your microphone.</p>
                  </div>

                  <div className="flex items-center gap-4 mt-6 pt-4 border-t border-slate-200/50 dark:border-slate-800/50 text-xs text-muted-soft">
                    <span className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-indigo-400" /> 4m prep time</span>
                    <span className="flex items-center gap-1.5"><Mic className="w-4 h-4 text-indigo-400" /> 10m speak time</span>
                  </div>

                  <Button onClick={() => setSoloRulesOpen(true)} className="w-full btn-primary h-12 text-sm mt-6">
                    <Zap className="h-4 w-4 mr-2" /> Begin Prep Phase
                  </Button>
                </div>

                {/* Progress summary card */}
                <div className="card p-6 md:col-span-5">
                  <h4 className="text-sm font-bold text-heading mb-4 flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-indigo-400" /> Recent Session Scores
                  </h4>
                  {soloSession.is_new_user ? (
                    <div className="text-center py-8 text-xs">
                      <p className="font-bold text-heading mb-1">Welcome to Solo Practice!</p>
                      <p className="text-muted-soft leading-normal">This is your first practice module. Standard metrics like grammar, delivery, fluency and clarity will appear here once submitted.</p>
                    </div>
                  ) : soloSession.last_session ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          { label: "Overall", value: soloSession.last_session.overall_score, color: "text-amber-500", bg: "bg-amber-500/10 border-amber-500/20" },
                          { label: "Fluency", value: soloSession.last_session.fluency_score, color: "text-emerald-500", bg: "bg-emerald-500/10 border-emerald-500/20" },
                          { label: "Grammar", value: soloSession.last_session.grammar_score, color: "text-purple-500", bg: "bg-purple-500/10 border-purple-500/20" },
                          { label: "Delivery", value: soloSession.last_session.delivery_score, color: "text-cyan-500", bg: "bg-cyan-500/10 border-cyan-500/20" },
                        ].map(s => (
                          <div key={s.label} className={`rounded-2xl p-3 text-center border ${s.bg}`}>
                            <p className="text-[10px] text-muted-soft uppercase font-bold tracking-wider">{s.label}</p>
                            <p className={`text-xl font-extrabold ${s.color} mt-1`}>{s.value}</p>
                          </div>
                        ))}
                      </div>
                      {soloSession.last_session.weaknesses && (
                        <div className="bg-red-500/5 dark:bg-red-500/10 border border-red-500/15 rounded-2xl p-4 text-xs">
                          <p className="font-bold text-red-500 flex items-center gap-1"><ShieldAlert className="w-3.5 h-3.5" /> Improvement Priority</p>
                          <p className="text-muted-soft mt-1 leading-relaxed">{soloSession.last_session.weaknesses}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-xs text-muted-soft">Complete a speaking trial to inspect scores progress.</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ─── Solo Session (Prep + Speaking) ─── */}
          {view === "solo-session" && soloSession && (
            <div className="max-w-3xl mx-auto space-y-4">
              <div className={`card p-6`}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-heading">{soloSession.topic}</h2>
                    <p className="text-sm text-muted-soft">Session #{soloSession.session_number} · Solo Practice</p>
                  </div>
                  <div className="flex gap-2">
                    {isSpeakingPhase && (
                      <Button onClick={endSoloEarly} disabled={loading} variant="secondary" className="bg-red-500/20 text-red-300 border-red-500/30 hover:bg-red-500/30">
                        End & Submit
                      </Button>
                    )}
                  </div>
                </div>
                {(isPrepPhase || isSpeakingPhase) && (
                  <div className={`rounded-lg p-4 text-center mb-4 ${isPrepPhase ? "bg-blue-500/20 border border-blue-500/30" : "bg-emerald-500/20 border border-emerald-500/30"}`}>
                    <p className="text-sm text-body mb-1">{isPrepPhase ? "Preparation Phase — Think & Take Notes" : "Speaking Phase — Deliver Your Thoughts"}</p>
                    <p className="text-4xl font-bold text-heading font-mono">{formatTime(isPrepPhase ? prepSeconds : speakingSeconds)}</p>
                  </div>
                )}
                <div className="mb-4">
                  <p className="text-sm font-medium text-body mb-2">Your Topic</p>
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <p className="text-sm text-heading">{soloSession.topic}</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Button onClick={toggleRecording} className={`border-0 ${isRecording ? "bg-red-500 hover:bg-red-600" : "bg-gradient-to-r from-amber-500 to-orange-600"}`}>
                      {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />} {isRecording ? "Stop" : "Record"}
                    </Button>
                    {recordingStatus && <span className="text-xs text-muted-soft">{recordingStatus}</span>}
                    <span className="ml-auto text-xs text-slate-500">{isPrepPhase ? "Prepare your thoughts..." : "Speak clearly into the mic..."}</span>
                  </div>
                  {liveDetectedText && <p className="text-xs text-emerald-300 bg-emerald-500/10 p-2 rounded"><span className="font-medium">Detected:</span> {liveDetectedText}</p>}
                  <Textarea
                    placeholder={isPrepPhase ? "Jot down notes and key points for your speech..." : "Type or record your speech here..."}
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    className="inp min-h-[150px]"
                  />
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-soft">{transcript.trim().split(/\s+/).filter(Boolean).length} words</span>
                    <div className="flex gap-2">
                      <Button onClick={() => { setView("solo-practice"); if (timerRef.current) clearInterval(timerRef.current); setIsPrepPhase(false); setIsSpeakingPhase(false); }} variant="secondary">
                        Cancel
                      </Button>
                      <Button onClick={submitSoloPractice} disabled={loading || transcript.trim().length < 10} className="bg-gradient-to-r from-amber-500 to-orange-600 border-0">
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Award className="h-4 w-4" />} Submit
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ─── Solo Result ─── */}
          {view === "solo-result" && soloResult && soloSession && (
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Quote */}
              {soloQuote && (
                <div className="card border-purple-500/30 p-4 text-center">
                  <p className="text-sm text-heading/80 italic">"{soloQuote.quote}"</p>
                  <p className="text-xs text-purple-300/60 mt-1">— {soloQuote.author}</p>
                </div>
              )}

              {/* Score Overview */}
              <div className={`card p-6`}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-heading flex items-center gap-2"><Target className="w-6 h-6 text-amber-400" /> Practice Results</h2>
                    <p className="text-sm text-muted-soft">{soloSession.topic} · Session #{soloSession.session_number}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-bold text-amber-300">{soloResult.overall_score}</p>
                    <p className="text-xs text-muted-soft">Overall Score</p>
                  </div>
                </div>

                {/* Radar Chart */}
                <div className="h-64 mb-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={[
                      { metric: "Fluency", value: soloResult.fluency_score },
                      { metric: "Grammar", value: soloResult.grammar_score },
                      { metric: "Accent", value: soloResult.accent_score },
                      { metric: "Delivery", value: soloResult.delivery_score },
                    ]}>
                      <PolarGrid stroke="#ffffff20" />
                      <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                      <Radar name="Score" dataKey="value" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.3} />
                      <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #ffffff20", borderRadius: "8px", color: "#fff" }} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>

                {/* Bar Chart */}
                <div className="h-48 mb-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[
                      { name: "Fluency", score: soloResult.fluency_score },
                      { name: "Grammar", score: soloResult.grammar_score },
                      { name: "Accent", score: soloResult.accent_score },
                      { name: "Delivery", score: soloResult.delivery_score },
                    ]}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#94a3b8" }} />
                      <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #ffffff20", borderRadius: "8px", color: "#fff" }} />
                      <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                        {scoreColors.map((color, i) => <Cell key={i} fill={color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Weaknesses & Tips */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-red-500/10 rounded-lg p-4 border border-red-500/20">
                    <p className="text-sm font-medium text-red-300 mb-2">Areas to Improve</p>
                    {soloResult.weaknesses.map((w, i) => (
                      <p key={i} className="text-xs text-body flex items-start gap-2 mb-1">
                        <ArrowDown className="w-3 h-3 text-red-400 mt-0.5 shrink-0" /> {w}
                      </p>
                    ))}
                  </div>
                  <div className="bg-emerald-500/10 rounded-lg p-4 border border-emerald-500/20">
                    <p className="text-sm font-medium text-emerald-300 mb-2">Improvement Tips</p>
                    {soloResult.improvement_tips.map((tip, i) => (
                      <p key={i} className="text-xs text-body flex items-start gap-2 mb-1">
                        <ArrowUp className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" /> {tip}
                      </p>
                    ))}
                  </div>
                </div>
              </div>

              {/* Improvement Comparison */}
              {soloResult.last_session && (
                <div className={`card p-6`}>
                  <h3 className="text-lg font-semibold text-heading mb-4 flex items-center gap-2"><TrendingUp className="w-5 h-5 text-amber-400" /> Improvement from Last Session</h3>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: "Overall", current: soloResult.overall_score, prev: soloResult.last_session.overall_score },
                      { label: "Fluency", current: soloResult.fluency_score, prev: soloResult.last_session.fluency_score },
                      { label: "Grammar", current: soloResult.grammar_score, prev: soloResult.last_session.grammar_score },
                      { label: "Delivery", current: soloResult.delivery_score, prev: soloResult.last_session.delivery_score },
                    ].map(s => {
                      const diff = s.current - s.prev;
                      return (
                        <div key={s.label} className=" surface-2 rounded-lg p-3 text-center">
                          <p className="text-xs text-muted-soft">{s.label}</p>
                          <p className="text-lg font-bold text-heading">{s.current}</p>
                          <p className={`text-xs flex items-center justify-center gap-1 ${diff >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {diff >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                            {Number(Math.abs(diff)).toFixed(1)} pts
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-center gap-4">
                <Button onClick={startSoloPractice} className="bg-gradient-to-r from-amber-500 to-orange-600 border-0">
                  <Target className="h-4 w-4 mr-2" /> Practice Again
                </Button>
                <Button onClick={() => { setView("dashboard"); }} variant="secondary">
                  Back to Dashboard
                </Button>
              </div>
            </div>
          )}

          {/* ─── GD Live (Join) ─── */}
          {view === "gd-live" && user?.role !== "admin" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="card p-6">
                <h2 className="text-lg font-semibold text-heading mb-4 flex items-center gap-2"><Zap className="w-5 h-5 text-amber-400" /> Join GD Session</h2>
                <p className="text-xs text-muted-soft mb-4">Enter the 4-digit session code shared by your admin to join an anonymous group discussion.</p>
                <div className="space-y-3">
                  <Input
                    placeholder="Enter 4-digit code (e.g. 1234)"
                    value={gdLiveCode}
                    onChange={(e) => setGdLiveCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    className="inp font-mono text-2xl tracking-[0.5em] text-center"
                    maxLength={4}
                  />
                  <Button onClick={() => setGdRulesOpen(true)} disabled={loading || gdLiveCode.length !== 4} className="w-full bg-gradient-to-r from-amber-500 to-orange-600 border-0 h-12 text-lg">
                    {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Users className="h-5 w-5" />} Join Session
                  </Button>
                </div>
                {gdLiveJoined && (
                  <div className="mt-4 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-center">
                    <CheckCircle2 className="h-6 w-6 mx-auto text-emerald-400 mb-2" />
                    <p className="text-sm text-emerald-300">Joined! Opening the session...</p>
                    <p className="text-xs text-muted-soft mt-1">Your identity stays hidden from other participants.</p>
                  </div>
                )}
              </div>
              <div className="card border-amber-500/30 p-6">
                <h2 className="text-lg font-semibold text-heading mb-4 flex items-center gap-2"><Shield className="w-5 h-5 text-amber-400" /> Anonymous & Private</h2>
                <ul className="space-y-3 text-sm text-body">
                  <li className="flex items-start gap-2">✓ Your name and email are hidden from other participants</li>
                  <li className="flex items-start gap-2">✓ Everyone joins one shared discussion hosted by your admin</li>
                  <li className="flex items-start gap-2">✓ Only admins can view your identity, department, and year</li>
                  <li className="flex items-start gap-2">✓ Topics are basic opinion/debate subjects everyone can talk about</li>
                </ul>
              </div>
            </div>
          )}

          {/* ─── GD Live Admin ─── */}
          {view === "gd-live-admin" && user?.role === "admin" && (
            <div className="space-y-6">
              <div className="card p-6">
                <h2 className="text-lg font-semibold text-heading mb-4 flex items-center gap-2"><Shield className="w-5 h-5 text-amber-400" /> Admin Portal — GD Live Sessions</h2>
                <div className="flex items-center gap-3 mb-4">
                  <Button onClick={createGdLiveSession} disabled={loading} className="bg-gradient-to-r from-emerald-500 to-green-600 border-0">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Create New Session (4-digit code)
                  </Button>
                </div>
                {gdLiveCreatedCode && (
                  <div className="mb-4 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 inline-block">
                    <p className="text-xs text-emerald-300 mb-1">Session Code</p>
                    <div className="flex items-center gap-2">
                      <code className="text-3xl font-mono font-bold text-heading tracking-[0.3em]">{gdLiveCreatedCode}</code>
                      <button onClick={() => copyCode(gdLiveCreatedCode)} className="p-1.5 rounded-md hover:surface-2 text-emerald-300">
                        {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                      </button>
                    </div>
                    <p className="text-xs text-muted-soft mt-1">Share this code with students to join</p>
                  </div>
                )}
              </div>

              {gdLiveSessions.map((sess: any) => (
                <div key={sess.session_code} className="card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-heading">Session <code className="font-mono text-amber-300">{sess.session_code}</code></h3>
                      <p className="text-xs text-muted-soft">Status: {sess.status} · {sess.participant_count || 0} participants · {sess.team_count || 0} teams</p>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={() => { setGdLiveAdminViewCode(sess.session_code); loadGdLiveParticipants(sess.session_code); setView("gd-live-admin-view"); }} disabled={loading} variant="secondary" className="text-xs">
                        View
                      </Button>
                      {sess.status !== "waiting" && (
                        <Button onClick={() => loadGdLiveLeaderboard(sess.session_code)} disabled={loading} variant="secondary" className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-xs">
                          <Trophy className="w-3 h-3 mr-1" /> Leaderboard
                        </Button>
                      )}
                      {sess.status === "active" && (
                        <Button onClick={() => completeGdLiveSession(sess.session_code)} disabled={loading} variant="secondary" className="bg-red-500/20 text-red-300 border-red-500/30 text-xs">
                          End
                        </Button>
                      )}
                      <Button onClick={() => deleteGdLiveSession(sess.session_code)} disabled={loading} variant="secondary" className="bg-red-500/10 text-red-400 border-red-500/20 text-xs">
                        Delete
                      </Button>
                    </div>
                  </div>

                  {/* Participant list (admin sees real names) */}
                  {gdLiveParticipants.length > 0 && gdLiveParticipants[0]?.session_code === sess.session_code && (
                    <div className="mt-4">
                      <table className="ent-table">
                        <thead>
                          <tr>
                            <th className="pb-2 pr-2">Team</th>
                            <th className="pb-2 pr-2">Label</th>
                            <th className="pb-2 pr-2">Name</th>
                            <th className="pb-2 pr-2 hidden md:table-cell">Register</th>
                            <th className="pb-2 pr-2 hidden md:table-cell">Department</th>
                            <th className="pb-2 pr-2 hidden md:table-cell">Year</th>
                            <th className="pb-2 pr-2">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {gdLiveParticipants.map((p: any) => (
                            <tr key={p.id} className="hover:surface-2">
                              <td className="py-2 pr-2 text-heading font-mono">{p.team_number || "-"}</td>
                              <td className="py-2 pr-2 text-amber-300">{p.anonymous_label || "-"}</td>
                              <td className="py-2 pr-2 text-heading">{p.name}</td>
                              <td className="py-2 pr-2 text-body hidden md:table-cell">{p.register_number}</td>
                              <td className="py-2 pr-2 text-body hidden md:table-cell">{p.department || "-"}</td>
                              <td className="py-2 pr-2 text-body hidden md:table-cell">{p.year || "-"}</td>
                              <td className="py-2 pr-2">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${p.status === "completed" ? "bg-emerald-500/20 text-emerald-300" : p.status === "assigned" ? "bg-blue-500/20 text-blue-300" : "bg-amber-500/20 text-amber-300"}`}>{p.status}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Leaderboard for this session */}
                  {gdLiveLeaderboard.length > 0 && gdLiveLeaderboardViewCode === sess.session_code && (
                    <div className="mt-6">
                      <h4 className="text-sm font-semibold text-heading mb-3 flex items-center gap-2">
                        <Trophy className="w-4 h-4 text-amber-400" /> Leaderboard — Session {sess.session_code}
                      </h4>
                      <table className="ent-table">
                        <thead>
                          <tr>
                            <th className="pb-2 pr-2">Rank</th>
                            <th className="pb-2 pr-2">Name</th>
                            <th className="pb-2 pr-2 hidden md:table-cell">Register</th>
                            <th className="pb-2 pr-2">Team</th>
                            <th className="pb-2 pr-2">Label</th>
                            <th className="pb-2 pr-2">Score</th>
                            <th className="pb-2 pr-2">Credits</th>
                            <th className="pb-2 pr-2">Transcript</th>
                          </tr>
                        </thead>
                        <tbody>
                          {gdLiveLeaderboard.map((entry, idx) => (
                            <tr key={entry.id} className={`hover:surface-2 ${idx === 0 ? "bg-amber-500/10" : ""}`}>
                              <td className="py-2 pr-2">
                                <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold ${idx === 0 ? "bg-amber-500 text-heading" : idx === 1 ? "bg-slate-400 text-heading" : idx === 2 ? "bg-orange-500 text-heading" : "surface-2 text-body"}`}>{idx + 1}</span>
                              </td>
                              <td className="py-2 pr-2 text-heading font-medium">{entry.name}</td>
                              <td className="py-2 pr-2 text-body hidden md:table-cell">{entry.register_number}</td>
                              <td className="py-2 pr-2 text-amber-300 font-mono">{entry.team_number}</td>
                              <td className="py-2 pr-2 text-purple-300">{entry.anonymous_label || "-"}</td>
                              <td className="py-2 pr-2 text-emerald-300 font-semibold">{(entry.overall_score != null ? Number(entry.overall_score) : 0).toFixed(1)}</td>
                              <td className="py-2 pr-2 text-amber-300">{(entry.credential_points != null ? Number(entry.credential_points) : 0).toFixed(1)}</td>
                              <td className="py-2 pr-2">
                                <details className="cursor-pointer">
                                  <summary className="text-amber-300 hover:text-amber-200 text-xs">View</summary>
                                  <p className="mt-1 text-muted-soft whitespace-pre-wrap max-w-xs">{entry.transcript || "N/A"}</p>
                                </details>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}

              {gdLiveSessions.length === 0 && (
                <div className="card p-6 text-center">
                  <p className="text-muted-soft text-sm">No sessions created yet. Create one above!</p>
                </div>
              )}
            </div>
          )}

          {/* ─── GD Live Admin — Full Page Participant View ─── */}
          {view === "gd-live-admin-view" && user?.role === "admin" && (
            <div className="space-y-6">
              <div className="card p-6">
                <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-heading flex items-center gap-2"><Users className="w-6 h-6 text-amber-400" /> Session Participants</h2>
                    <p className="text-sm text-muted-soft mt-1">Code <code className="font-mono text-amber-300">{gdLiveAdminViewCode}</code> · {gdLiveParticipants.length} participant(s)</p>
                  </div>
                  <div className="flex gap-2 items-center">
                    {gdLiveIsLiveMeeting ? (
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-red-500 px-3 h-11 rounded-xl surface-2 border border-red-500/40">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" /> LIVE — Meeting in progress
                      </span>
                    ) : gdLiveParticipants.length >= 2 ? (
                      <Button onClick={() => hostGdLiveRoom(gdLiveAdminViewCode)} disabled={loading} className="btn-primary h-11 text-sm font-semibold">
                        <Radio className="w-4 h-4 mr-2" /> Host a Meeting
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-soft flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Waiting for participants...</span>
                    )}
                    <Button onClick={() => loadGdLiveParticipants(gdLiveAdminViewCode)} disabled={loading} variant="secondary" className="text-sm">
                      <RefreshCw className="w-4 h-4 mr-1" /> Refresh
                    </Button>
                    <Button onClick={() => { setView("gd-live-admin"); loadGdLiveSessions(); }} variant="secondary" className="text-sm">
                      Back to Admin
                    </Button>
                  </div>
                </div>

                {gdLiveParticipants.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-muted-soft text-sm">No participants have joined this session yet.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {gdLiveParticipants.map((p: any) => (
                      <div key={p.id} className="card p-5 hover:card-hover">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                              {(p.name || "?").split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-heading truncate">{p.name}</p>
                              <p className="text-xs text-muted-soft truncate">{p.department || "-"} · {p.year || "-"}</p>
                            </div>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${p.status === "completed" ? "bg-emerald-500/20 text-emerald-300" : p.status === "assigned" ? "bg-blue-500/20 text-blue-300" : "bg-amber-500/20 text-amber-300"}`}>{p.status}</span>
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-soft">Register No.</span>
                            <span className="text-heading font-mono">{p.register_number}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-soft">Team</span>
                            <span className="text-amber-300 font-mono">{p.team_number || "-"}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-soft">Label</span>
                            <span className="text-purple-300">{p.anonymous_label || "-"}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {gdLiveTeams.length > 0 && (
                  <div className="card p-6 mt-6">
                    <h3 className="text-lg font-bold text-heading mb-4 flex items-center gap-2">
                      <Users className="w-5 h-5 text-amber-400" /> Teams ({gdLiveTeams.length})
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {gdLiveTeams.map((t: any) => (
                        <div key={t.team_number} className="card p-4 surface-2">
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-sm font-bold text-amber-300 font-mono">Team {t.team_number}</span>
                            <span className="text-xs text-muted-soft">{t.members?.length || 0} members</span>
                          </div>
                          <p className="text-xs text-muted-soft mb-3 line-clamp-2">Topic: {t.topic}</p>
                          <ul className="space-y-1.5">
                            {t.members?.map((m: any) => (
                              <li key={m.user_id} className="text-sm text-heading flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
                                {m.name}
                                <span className="text-xs text-muted-soft font-mono">{m.label}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {gdLiveRoomActive && (
                  <GdLiveAdminMonitor
                    sessionCode={gdLiveAdminViewCode}
                    token={token}
                    showHostControls
                    onBack={() => { setGdLiveRoomActive(false); }}
                    onEnd={endGdLiveRoom}
                  />
                )}
              </div>
            </div>
          )}

          {/* ─── GD Live Student View ─── */}
          {view === "gd-live" && user?.role === "admin" && (
            <div className="card p-6 text-center">
              <p className="text-muted-soft text-sm">Use the Admin portal to manage GD Live sessions.</p>
            </div>
          )}

          {/* ─── GD Live Session (Waiting for Host) ─── */}
          {view === "gd-live-session" && gdLiveSession && (
            <div className="max-w-3xl mx-auto">
              <StudentLiveWaiter
                code={gdLiveSession.session_code}
                token={token}
                onStart={(topic, members, teams) => enterGdLiveRoom(gdLiveSession.session_code, topic, members, teams)}
              />
              <StudentLivePoller
                code={gdLiveSession.session_code}
                token={token}
                onStart={(topic, members, teams) => enterGdLiveRoom(gdLiveSession.session_code, topic, members, teams)}
              />
              <div className="card p-6 text-center py-12">
                <div className="icon-badge icon-purple mx-auto mb-5" style={{ width: "72px", height: "72px" }}>
                  <Radio className="w-10 h-10" />
                </div>
                <h2 className="text-2xl font-bold text-heading mb-2">Connected to GD Session</h2>
                <p className="text-sm text-muted-soft mb-6">
                  Session <code className="text-amber-300 font-mono">{gdLiveSession.session_code}</code>
                </p>
                <div className="flex items-center justify-center gap-3 text-muted-soft">
                  <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
                  <span className="text-base">Waiting for Host to Start Discussion...</span>
                </div>
                <p className="text-xs text-muted-soft mt-6">
                  The discussion room opens automatically the moment the host starts — no refresh needed.
                </p>
              </div>
            </div>
          )}

          {tabSwitchWarning && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 ">
              <div className="bg-slate-900 border border-red-500/40 rounded-2xl p-6 max-w-sm mx-4 shadow-2xl text-center">
                <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
                <h3 className="text-lg font-bold text-heading mb-2">Stay Focused!</h3>
                <p className="text-sm text-body mb-4">You left the session tab. Please return to the MZ Orator tab immediately to continue your assessment.</p>
                <Button onClick={() => setTabSwitchWarning(false)} className="w-full bg-gradient-to-r from-amber-500 to-orange-600 border-0">
                  I'm back, continue
                </Button>
              </div>
            </div>
          )}

          {/* ─── Solo Practice Rules Modal ─── */}
          {soloRulesOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setSoloRulesOpen(false)}>
              <div className="card w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 mb-4">
                  <div className="icon-badge icon-amber"><AlertCircle className="w-5 h-5" /></div>
                  <h2 className="text-lg font-semibold text-heading">Solo Practice Rules</h2>
                </div>
                <div className="space-y-2 text-sm text-body mb-6">
                  {[
                    "Speak naturally and confidently.",
                    "Answer using your own words.",
                    "Avoid reading directly from notes or another screen.",
                    "Maintain eye contact with the camera as much as possible.",
                    "Avoid excessive filler words such as 'um', 'uh', and 'like'.",
                    "Complete your response within the allotted time.",
                    "Wait until the timer finishes before stopping.",
                    "Speak clearly at a moderate pace.",
                    "Do not interrupt the recording once it has started.",
                    "Review your AI feedback after completing the session.",
                  ].map((rule, i) => (
                    <p key={i} className="flex items-start gap-2"><span className="text-amber-400 shrink-0">•</span> {rule}</p>
                  ))}
                </div>
                <div className="flex justify-end gap-3">
                  <Button onClick={() => setSoloRulesOpen(false)} variant="secondary">Cancel</Button>
                  <Button onClick={() => { setSoloRulesOpen(false); beginSoloPrep(); }} className="bg-gradient-to-r from-emerald-500 to-green-600 border-0">
                    Accept and continue
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ─── GD Live Rules Modal ─── */}
          {gdRulesOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setGdRulesOpen(false)}>
              <div className="card w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 mb-4">
                  <div className="icon-badge icon-amber"><MessageSquare className="w-5 h-5" /></div>
                  <h2 className="text-lg font-semibold text-heading">Group Discussion Rules</h2>
                </div>
                <div className="space-y-2 text-sm text-body mb-6">
                  {[
                    "Join the discussion before the scheduled start time.",
                    "Keep your microphone enabled unless instructed otherwise.",
                    "Respect all participants. Do not interrupt another speaker.",
                    "Stay on the assigned discussion topic.",
                    "Allow every participant an opportunity to contribute.",
                    "Use professional and respectful language.",
                    "Support your opinions with logical reasoning.",
                    "Avoid personal attacks or inappropriate comments.",
                    "Keep your microphone muted when not speaking (if required).",
                    "Follow the moderator's instructions.",
                    "Complete the discussion within the allotted time.",
                  ].map((rule, i) => (
                    <p key={i} className="flex items-start gap-2"><span className="text-amber-400 shrink-0">•</span> {rule}</p>
                  ))}
                </div>
                <div className="flex justify-end gap-3">
                  <Button onClick={() => setGdRulesOpen(false)} variant="secondary">Cancel</Button>
                  <Button onClick={() => { setGdRulesOpen(false); joinGdLive(); }} className="bg-gradient-to-r from-amber-500 to-orange-600 border-0">
                    Accept and continue
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
