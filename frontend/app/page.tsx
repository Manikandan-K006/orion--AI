"use client";

import { AlertCircle, Award, Clock, LogOut, MessageSquare, Mic, MicOff, Trophy, Users, User as UserIcon, Lock, Zap, Loader2, Copy, Check, Target, TrendingUp, ArrowUp, ArrowDown, Sparkles, Menu, X, Shield, Sun, Moon, RefreshCw, Video, VideoOff, Hand, MessageCircle, Maximize, PhoneOff, Radio, CheckCircle2, Mail, Phone, Globe, Eye, EyeOff, VolumeX, Volume2, Bell, Settings, Search, BookOpen, ShieldAlert, Calendar, Upload, ArrowLeft, ArrowRight, ChevronRight, Play, ShieldCheck, ChevronDown, Star, Activity, Cpu, Lightbulb, FileText, CheckCircle, MapPin } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import GdLiveRoom from "@/components/GdLiveRoom";
import GdLiveAdminMonitor from "@/components/GdLiveAdminMonitor";
import StudentDashboard from "@/components/dashboard/StudentDashboard";
import AdminDashboard from "@/components/dashboard/AdminDashboard";
import ProfileView from "@/components/profile/ProfileView";
import LeaderboardView from "@/components/leaderboard/LeaderboardView";
import AchievementsView from "@/components/achievements/AchievementsView";
import ReportsView from "@/components/reports/ReportsView";
import { useGdLiveWs, GDLiveWsMessage } from "@/lib/useGdLiveWs";
import { useVoiceAnnouncement } from "@/services/voice/useVoiceAnnouncement";
import { AllTimeAchiever, ComprehensiveLeaderboard, GDLiveLeaderboardEntry, LeaderboardRanking, LeaderboardStats, Progress, SoloQuote, SoloStartResponse, SoloSubmitResponse, User, apiRequest, hostGdLiveMeeting, endGdLiveMeeting, getGdLiveState, changePassword, getApiUrl, downloadGdLivePdfReport, downloadGdLiveExcelReport, exportGdLiveAttendance, downloadOverallPdfReport } from "@/lib/api";

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
function StudentLiveWaiter({
  code,
  token,
  onStart,
  onParticipantsUpdate
}: {
  code: string;
  token: string;
  onStart: (topic: string | null, members: any[], teams?: any[]) => void;
  onParticipantsUpdate?: (parts: any[]) => void;
}) {
  const { subscribe } = useGdLiveWs(code, token);
  const startedRef = useRef(false);

  useEffect(() => {
    let active = true;
    apiRequest<any[]>(`/gd-live/sessions/${code}/participants`, {}, token)
      .then(data => {
        if (active && onParticipantsUpdate) onParticipantsUpdate(data || []);
      })
      .catch(() => { });
    return () => { active = false; };
  }, [code, token]);

  useEffect(() => {
    const unsub = subscribe((msg: GDLiveWsMessage) => {
      if (msg.event === "SESSION_STARTED" && !startedRef.current) {
        startedRef.current = true;
        onStart(msg.payload?.topic ?? null, msg.payload?.members ?? [], msg.payload?.teams ?? []);
      } else if (msg.event === "PARTICIPANTS_UPDATED") {
        if (onParticipantsUpdate) onParticipantsUpdate(msg.payload?.participants || []);
      } else if (msg.event === "PARTICIPANT_JOINED" || msg.event === "PARTICIPANT_LEFT") {
        apiRequest<any[]>(`/gd-live/sessions/${code}/participants`, {}, token)
          .then(data => { if (onParticipantsUpdate) onParticipantsUpdate(data || []); })
          .catch(() => { });
      }
    });
    return unsub;
  }, [subscribe, onStart, onParticipantsUpdate, code, token]);

  return null;
}

/** Student-side polling fallback: if the WebSocket SESSION_STARTED event is
 *  missed (e.g. reconnect), poll the live-state and redirect when the session
 *  becomes "live". No manual refresh required. */
function StudentLivePoller({
  code,
  token,
  onStart,
  onParticipantsUpdate
}: {
  code: string;
  token: string;
  onStart: (topic: string | null, members: any[], teams?: any[]) => void;
  onParticipantsUpdate?: (parts: any[]) => void;
}) {
  const startedRef = useRef(false);
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const st = await getGdLiveState(code, token);
        if (!active || startedRef.current) return;
        if (st.status === "live" || st.status === "active") {
          startedRef.current = true;
          onStart(st.topic ?? null, st.members || [], st.teams || []);
        } else {
          const parts = await apiRequest<any[]>(`/gd-live/sessions/${code}/participants`, {}, token);
          if (active && onParticipantsUpdate) onParticipantsUpdate(parts || []);
        }
      } catch {
        /* ignore transient errors */
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { active = false; clearInterval(id); };
  }, [code, token, onStart, onParticipantsUpdate]);
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
          {activity.length === 0 && <p className="text-muted-soft text-xs">Waiting for activity...</p>}
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

function mergeTranscripts(a: string, b: string): string {
  const cleanA = a.trim();
  const cleanB = b.trim();
  if (!cleanA) return cleanB;
  if (!cleanB) return cleanA;

  const wordsA = cleanA.split(/\s+/);
  const wordsB = cleanB.split(/\s+/);

  let maxOverlap = 0;
  const maxSearch = Math.min(wordsA.length, wordsB.length, 15);

  for (let len = 1; len <= maxSearch; len++) {
    const suffix = wordsA.slice(wordsA.length - len).join(" ").toLowerCase();
    const prefix = wordsB.slice(0, len).join(" ").toLowerCase();

    // Clean punctuation for matching
    const cleanSuffix = suffix.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "").replace(/\s+/g, " ");
    const cleanPrefix = prefix.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "").replace(/\s+/g, " ");

    if (cleanSuffix === cleanPrefix) {
      maxOverlap = len;
    }
  }

  if (maxOverlap > 0) {
    return wordsA.concat(wordsB.slice(maxOverlap)).join(" ");
  }
  return cleanA + " " + cleanB;
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
  const [loginRoleTab, setLoginRoleTab] = useState<"student" | "admin" | "principal" | "coordinator">("student");
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [pendingGdRedirect, setPendingGdRedirect] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);
  const [activeTopicCategory, setActiveTopicCategory] = useState<"all" | "tech" | "placement" | "society">("all");
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [mounted, setMounted] = useState(false);
  const [notifications, setNotifications] = useState<Array<{ id: string | number; time: string; icon: string; title: string; desc: string; read: boolean }>>([
    { id: 1, time: "1 hour ago", icon: "MessageSquare", title: "Live GD Room Available", desc: "Administrator hosted session 'Speech Modulation & Delivery Practice'. Join using the active room code.", read: false },
    { id: 2, time: "12 hours ago", icon: "Target", title: "Daily Practice Goal Reminder", desc: "Build consistency by completing a 2-minute solo AI speaking session on public speech fundamentals.", read: true },
    { id: 3, time: "1 day ago", icon: "Sparkles", title: "AI Skill Analysis Complete", desc: "A new skill analysis radar matrix is available based on your latest solo practice performance topic.", read: true },
  ]);

  const [activeNav, setActiveNav] = useState<string>("home");

  useEffect(() => {
    const handleScroll = () => {
      const sections = ["contact", "faqs", "features", "how-it-works", "home"];
      const scrollPos = window.scrollY + 140;
      for (const s of sections) {
        const el = document.getElementById(s);
        if (el && el.offsetTop <= scrollPos) {
          setActiveNav(s);
          break;
        }
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (id: string) => {
    setActiveNav(id);
    const element = document.getElementById(id);
    if (element) {
      const yOffset = -70;
      const y = element.getBoundingClientRect().top + window.pageYOffset + yOffset;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  };

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
  const [lbLastUpdated, setLbLastUpdated] = useState<string>("");

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

  // New state machine state & refs for Solo Practice
  const [soloState, setSoloState] = useState<"IDLE" | "PREPARING" | "RECORDING" | "FINALIZING" | "EVALUATING" | "RESULT">("IDLE");
  const [remainingPrepSeconds, setRemainingPrepSeconds] = useState<number | null>(null);
  const lastTranscribedTimeRef = useRef<number>(0.0);
  const chunkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isChunkUploadingRef = useRef<boolean>(false);
  const recordingEndedAtRef = useRef<number>(0);
  const audioStreamRef = useRef<MediaStream | null>(null);

  // Ref wrappers to avoid stale closures in setInterval timers
  const stopSoloRecordingRef = useRef(stopSoloRecording);
  const sendSoloAudioChunkRef = useRef(sendSoloAudioChunk);
  useEffect(() => {
    stopSoloRecordingRef.current = stopSoloRecording;
    sendSoloAudioChunkRef.current = sendSoloAudioChunk;
  });

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
  const [gdLiveWsConnected, setGdLiveWsConnected] = useState(false);
  const [gdLiveWsError, setGdLiveWsError] = useState<string | null>(null);
  const [gdLiveRoomCode, setGdLiveRoomCode] = useState("");
  const [gdLiveRoomTopic, setGdLiveRoomTopic] = useState("");
  const [gdLiveRoomMembers, setGdLiveRoomMembers] = useState<any[]>([]);
  const [gdLiveRoomTeams, setGdLiveRoomTeams] = useState<any[]>([]);
  const [gdLiveRoomActive, setGdLiveRoomActive] = useState(false);
  const [gdLiveIsLiveMeeting, setGdLiveIsLiveMeeting] = useState(false);
  const [gdLiveShowCountdown, setGdLiveShowCountdown] = useState(false);
  const [gdLivePerf, setGdLivePerf] = useState<Record<string, number>>({});
  const [gdLivePendingFinish, setGdLivePendingFinish] = useState<any>(null);
  const [gdLiveResultData, setGdLiveResultData] = useState<any>(null);
  const [gdLiveFinishing, setGdLiveFinishing] = useState(false);

  // Group Discussion system extension states
  const [selectedTopicId, setSelectedTopicId] = useState<number>(1);
  const [teamSize, setTeamSize] = useState<number>(4);
  const [selectedDept, setSelectedDept] = useState<string>("ALL");
  const [selectedYear, setSelectedYear] = useState<string>("ALL");
  const [selectedSection, setSelectedSection] = useState<string>("ALL");
  const [easyTopicsList, setEasyTopicsList] = useState<any[]>([]);
  const [studentList, setStudentList] = useState<any[]>([]);
  const [optDirDept, setOptDirDept] = useState<string>("ALL");
  const [optDirYear, setOptDirYear] = useState<string>("ALL");
  const [optDirSec, setOptDirSec] = useState<string>("ALL");
  const [departmentList, setDepartmentList] = useState<string[]>([]);
  const [yearList, setYearList] = useState<string[]>([]);
  const [sessionStudents, setSessionStudents] = useState<any[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
  const [waitingRoomParticipants, setWaitingRoomParticipants] = useState<any[]>([]);
  const [adminSubTab, setAdminSubTab] = useState<"sessions" | "students" | "analytics">("sessions");
  const [studentModalOpen, setStudentModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<any | null>(null);
  const [studentForm, setStudentForm] = useState({ name: "", email: "", password: "", register_number: "", department: "IT", year: "2nd Year", section: "A" });
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
      loadProfile(savedToken);
    }

    const handleAuthExpired = () => {
      logout();
    };

    window.addEventListener("auth-expired", handleAuthExpired);
    return () => {
      window.removeEventListener("auth-expired", handleAuthExpired);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      } catch (err: any) {
        if (err.message && (err.message.includes("timed out") || err.message.includes("Failed to fetch") || err.message.includes("Reconnecting"))) {
          console.warn("Polling live sessions skipped (backend reconnecting)");
        } else {
          console.warn("Background notification poll issue:", err?.message || err);
        }
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

  // Derived states for live room participants
  const joinedParticipants = gdLiveParticipants.filter((p: any) => p.status !== "invited");
  const curSession = gdLiveSessions.find((s: any) => s.session_code === gdLiveAdminViewCode);
  const totalAssignedCount = curSession?.total_assigned_count || 0;
  const notJoinedCount = Math.max(0, totalAssignedCount - joinedParticipants.length);

  // Track WebSocket connection status for student waiting screen
  const gdLiveWsHook = useGdLiveWs(
    view === "gd-live-session" && gdLiveSession ? gdLiveSession.session_code : null,
    token
  );
  useEffect(() => {
    setGdLiveWsConnected(gdLiveWsHook.connected);
    setGdLiveWsError(gdLiveWsHook.error);
  }, [gdLiveWsHook.connected, gdLiveWsHook.error]);

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
        if (msg.payload.counts) {
          const { total_assigned, joined, not_joined } = msg.payload.counts;
          setGdLiveSessions((prev) => 
            prev.map((s) => 
              s.session_code === gdLiveAdminViewCode 
                ? { ...s, total_assigned_count: total_assigned, joined_count: joined, not_joined_count: not_joined }
                : s
            )
          );
        }
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
      setToken(t);
      setUser(profile);
      setView("dashboard");
      voice.announceLogin();
      loadDashboardData(t, profile); // Lazy load without await
    } catch {
      localStorage.removeItem("mzgd_token");
      setToken("");
      setView("login");
    }
  }


  async function handleLogin() {
    if (loginLockRef.current) return;
    loginLockRef.current = true;
    console.time("Login-Total");

    const isStudent = loginRoleTab === "student" || loginTab === "student";
    const rn = (isStudent ? studentRegisterNumber : adminRegisterNumber).trim();
    const pw = isStudent ? (studentPassword || "Password123") : adminPassword;
    if (!rn) {
      setMessage(`Enter your ${isStudent ? "register number" : "SPR / Faculty ID"}`);
      loginLockRef.current = false;
      return;
    }

    setLoading(true); setMessage(""); setSuccess("");
    try {
      console.time("Login-API-Request");
      const res = await apiRequest<{ access_token: string; user: User }>("/login/register-number", {
        method: "POST",
        body: JSON.stringify({ register_number: rn, password: isStudent ? (pw || "Password123") : pw })
      });
      console.timeEnd("Login-API-Request");

      localStorage.setItem("mzgd_token", res.access_token);
      setToken(res.access_token);
      setUser(res.user);
      setIsLoginModalOpen(false);
      voice.announceLogin();

      if (pendingGdRedirect && gdLiveCode.trim()) {
        setPendingGdRedirect(false);
        setView("gd-live");
        setTimeout(() => {
          joinGdLive();
        }, 300);
      } else {
        setView("dashboard");
      }

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

  const isRequestingMicRef = useRef(false);

  async function checkMicPermissionAndStartRecording() {
    if (isRequestingMicRef.current || soloState === "RECORDING") return;
    isRequestingMicRef.current = true;
    setMessage("");
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e: any) {
        if (e.name === "NotFoundError" || e.message?.toLowerCase().includes("not found")) {
          console.warn("No microphone found. Using a silent dummy audio stream for testing.");
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const dest = ctx.createMediaStreamDestination();
          stream = dest.stream;
        } else {
          throw e;
        }
      }
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setRemainingPrepSeconds(prepSeconds);
      
      audioStreamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      
      mediaRecorder.start(1000); // 1-second chunks
      setIsRecording(true);
      setIsPrepPhase(false);
      setIsSpeakingPhase(true);
      setSoloState("RECORDING");
      setRecordingStatus("Listening...");
      speak("Recording started");
      
      setSpeakingSeconds(600);
      timerRef.current = setInterval(() => {
        setSpeakingSeconds(prev => {
          if (prev <= 1) {
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
            stopSoloRecordingRef.current();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      
      lastTranscribedTimeRef.current = 0.0;
      isChunkUploadingRef.current = false;
      if (chunkIntervalRef.current) {
        clearInterval(chunkIntervalRef.current);
      }
      chunkIntervalRef.current = setInterval(() => sendSoloAudioChunkRef.current(), 15000);
      
    } catch (err) {
      console.warn("Mic permission denied:", err);
      setMessage("Microphone access is required to participate in the GD.");
    } finally {
      isRequestingMicRef.current = false;
    }
  }

  async function sendSoloAudioChunk() {
    if (soloState !== "RECORDING" && soloState !== "FINALIZING") return;
    if (isChunkUploadingRef.current) return;
    if (audioChunksRef.current.length === 0) return;

    isChunkUploadingRef.current = true;
    try {
      const chunks = [...audioChunksRef.current];
      const blob = new Blob(chunks, { type: "audio/webm" });
      if (blob.size < 100) {
        isChunkUploadingRef.current = false;
        return;
      }

      const startTime = Math.max(0, lastTranscribedTimeRef.current - 3.0);
      const currentDuration = Math.round(audioChunksRef.current.length);
      
      const formData = new FormData();
      formData.append("file", blob, `solo_chunk_${soloSession?.session_id}.webm`);

      setRecordingStatus("Transcribing...");
      const res = await fetch(`${getApiUrl()}/interviews/upload-chunk?start_time=${startTime}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) throw new Error("Chunk upload failed");

      const data = await res.json();
      if (data.chunk_transcript) {
        setTranscript(prev => mergeTranscripts(prev, data.chunk_transcript));
        setLiveDetectedText(data.chunk_transcript);
      }
      
      lastTranscribedTimeRef.current = currentDuration;
      setRecordingStatus("Listening...");
    } catch (err) {
      console.warn("Solo chunk upload failed:", err);
      setRecordingStatus("Listening (reconnecting)...");
    } finally {
      isChunkUploadingRef.current = false;
    }
  }

  async function stopSoloRecording() {
    if (soloState !== "RECORDING") return;
    setSoloState("FINALIZING");
    setRecordingStatus("Finalizing transcript...");
    speak("Recording stopped");

    recordingEndedAtRef.current = Date.now();

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current);
      chunkIntervalRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {}
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
      audioStreamRef.current = null;
    }
    setIsRecording(false);

    await new Promise(resolve => setTimeout(resolve, 500));

    let finalTranscriptText = transcript;
    try {
      const chunks = [...audioChunksRef.current];
      const blob = new Blob(chunks, { type: "audio/webm" });
      if (blob.size >= 100) {
        const startTime = Math.max(0, lastTranscribedTimeRef.current - 3.0);
        const formData = new FormData();
        formData.append("file", blob, `solo_final_${soloSession?.session_id}.webm`);

        const res = await fetch(`${getApiUrl()}/interviews/upload-chunk?start_time=${startTime}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });

        if (res.ok) {
          const data = await res.json();
          if (data.chunk_transcript) {
            finalTranscriptText = mergeTranscripts(finalTranscriptText, data.chunk_transcript);
            setTranscript(finalTranscriptText);
            setLiveDetectedText(data.chunk_transcript);
          }
        }
      }
    } catch (err) {
      console.warn("Final chunk upload failed:", err);
    }

    const transcriptionCompletedAt = Date.now();
    const transcriptionLatency = (transcriptionCompletedAt - recordingEndedAtRef.current) / 1000;
    console.log(`[Solo Practice] Transcription Latency: ${transcriptionLatency.toFixed(2)} seconds`);

    setRecordingStatus("Evaluating performance...");
    setSoloState("EVALUATING");

    await executeSoloSubmission(finalTranscriptText);
  }

  async function executeSoloSubmission(textToSubmit: string) {
    if (!soloSession) return;
    
    const cleanText = textToSubmit.trim();
    if (cleanText.length < 10) {
      setRecordingStatus("Evaluation failed");
      setSoloState("PREPARING");
      setMessage("Audio transcript is too short (min 10 characters required). Please try recording again.");
      return;
    }

    setLoading(true);
    try {
      const res = await apiRequest<SoloSubmitResponse>("/solo/submit", {
        method: "POST",
        body: JSON.stringify({ session_id: soloSession.session_id, transcript: cleanText })
      }, token);
      
      setSoloResult(res);
      setSoloState("RESULT");
      setView("solo-result");
      setSuccess(`${res.message} — Score: ${res.overall_score}`);
      
      const phrase = MOTIVATIONAL_PHRASES[Math.floor(Math.random() * MOTIVATIONAL_PHRASES.length)];
      speak(phrase);
      
      setIsPrepPhase(false);
      setIsSpeakingPhase(false);
      setIsSessionLocked(false);
      
      const history = await apiRequest<SoloSubmitResponse["last_session"][]>("/solo/history", {}, token).catch(() => []);
      setSoloHistory(history);
      await loadDashboardData(token, user);
    } catch (err: any) {
      setMessage(err.message || "Evaluation failed");
      setRecordingStatus("Evaluation failed");
      setSoloState("PREPARING");
    } finally {
      setLoading(false);
    }
  }

  function cancelSoloSession() {
    setView("solo-practice");
    setSoloState("IDLE");
    setIsPrepPhase(false);
    setIsSpeakingPhase(false);
    setIsSessionLocked(false);
    setIsRecording(false);
    setPrepSeconds(0);
    setSpeakingSeconds(0);
    setRemainingPrepSeconds(null);
    lastTranscribedTimeRef.current = 0.0;
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current);
      chunkIntervalRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {}
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
      audioStreamRef.current = null;
    }
  }

  async function toggleRecording() {
    if (isRecording || soloState === "RECORDING") {
      await stopSoloRecording();
    } else {
      await checkMicPermissionAndStartRecording();
    }
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

  async function loadLeaderboard(department = "ALL", year = "ALL", timeframe = "all", silent = false) {
    if (!silent) setPageLoading(true);
    try {
      const params = new URLSearchParams({ department, year, timeframe });
      const data = await apiRequest<ComprehensiveLeaderboard>(`/gd/leaderboard/comprehensive?${params}`, {}, token);
      setLbData(data);
      setLbDepartment(department);
      setLbYear(year);
      setLbTimeframe(timeframe);
      setLbLastUpdated(new Date().toLocaleTimeString());
      if (!silent) setView("gd-leaderboard");
    } catch (err: any) {
      if (!silent) setMessage(err.message);
    } finally {
      if (!silent) setPageLoading(false);
    }
  }

  // Real-time automatic leaderboard polling (every 4 seconds)
  useEffect(() => {
    if (view !== "gd-leaderboard" || !token) return;
    loadLeaderboard(lbDepartment, lbYear, lbTimeframe, true);
    const interval = setInterval(() => {
      loadLeaderboard(lbDepartment, lbYear, lbTimeframe, true);
    }, 4000);
    return () => clearInterval(interval);
  }, [view, lbDepartment, lbYear, lbTimeframe, token]);

  // ─── GD Live Functions ───

  async function loadGdLiveSessions() {
    try {
      const sessions = await apiRequest<any[]>("/gd-live/sessions", {}, token).catch(() => []);
      setGdLiveSessions(sessions);
    } catch { }
  }

  async function loadAdminDetails() {
    try {
      const topics = await apiRequest<any[]>("/gd-live/easy-topics", {}, token).catch(() => []);
      setEasyTopicsList(topics);

      const depts = await apiRequest<string[]>("/gd-live/departments", {}, token).catch(() => []);
      setDepartmentList(depts);

      const yrs = await apiRequest<string[]>("/gd-live/years", {}, token).catch(() => []);
      setYearList(yrs);

      const studs = await apiRequest<any[]>("/gd-live/students", {}, token).catch(() => []);
      setStudentList(studs);
    } catch { }
  }

  async function loadSessionStudents() {
    if (!token) return;
    try {
      const d = selectedDept === "ALL" ? "" : selectedDept;
      const y = selectedYear === "ALL" ? "" : selectedYear;
      const s = selectedSection === "ALL" ? "" : selectedSection;
      const data = await apiRequest<any[]>(`/gd-live/students?department=${encodeURIComponent(d)}&year=${encodeURIComponent(y)}&section=${encodeURIComponent(s)}`, {}, token);
      setSessionStudents(data || []);
      setSelectedStudentIds(data ? data.map(st => st.id || st.user_id) : []);
    } catch (err) {
      console.warn("Failed to load session students:", err);
    }
  }

  useEffect(() => {
    if (token && user?.role === "admin" && view === "gd-live-admin") {
      loadSessionStudents();
    }
  }, [selectedDept, selectedYear, selectedSection, view, token]);

  useEffect(() => {
    if (token && user?.role === "admin" && (view === "gd-live-admin" || view === "gd-live-admin-view")) {
      loadAdminDetails();
    }
  }, [view, token, user]);

  async function deleteStudent(studentId: number) {
    if (!confirm("Are you sure you want to delete this student?")) return;
    try {
      await apiRequest(`/gd-live/students/${studentId}`, { method: "DELETE" }, token);
      setSuccess("Student deleted successfully");
      await loadAdminDetails();
    } catch (err: any) { setMessage(err.message); }
  }

  async function saveStudent() {
    try {
      if (editingStudent) {
        await apiRequest(`/gd-live/students/${editingStudent.id}`, {
          method: "PUT",
          body: JSON.stringify(studentForm)
        }, token);
        setSuccess("Student updated successfully");
      } else {
        await apiRequest("/gd-live/students", {
          method: "POST",
          body: JSON.stringify(studentForm)
        }, token);
        setSuccess("Student created successfully");
      }
      setStudentModalOpen(false);
      setEditingStudent(null);
      await loadAdminDetails();
    } catch (err: any) { setMessage(err.message); }
  }

  async function handleExcelUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    setLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/gd-live/import-students`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to import excel");
      setSuccess(`Excel import complete! Imported: ${data.imported ?? 0}, Updated: ${data.updated ?? 0}${data.errors?.length ? `, Errors: ${data.errors.length}` : ""}`);
      await loadAdminDetails();
    } catch (err: any) { setMessage(err.message); }
    finally { setLoading(false); }
  }

  async function exportAttendance(sessionCode: string) {
    setLoading(true);
    try {
      await exportGdLiveAttendance(sessionCode, token);
      setSuccess("Attendance exported successfully!");
    } catch (err: any) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function exportEvaluations(sessionCode: string) {
    setLoading(true);
    try {
      await downloadGdLiveExcelReport(sessionCode, token);
      setSuccess("Evaluation details exported successfully!");
    } catch (err: any) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function createGdLiveSession() {
    setLoading(true);
    try {
      const res = await apiRequest<{ session_code: string }>("/gd-live/sessions", {
        method: "POST",
        body: JSON.stringify({
          topic_id: selectedTopicId || 1,
          team_size: teamSize || 4,
          department: selectedDept === "ALL" ? null : selectedDept,
          year: selectedYear === "ALL" ? null : selectedYear,
          section: selectedSection === "ALL" || !selectedSection ? null : selectedSection,
          student_ids: selectedStudentIds.length > 0 ? selectedStudentIds : null
        })
      }, token);
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

  function leaveGdLiveRoom(finished: boolean = false) {
    setGdLiveIsLiveMeeting(false);
    if (user?.role === "admin" && gdLiveRoomActive) {
      setView("gd-live-admin-view");
      if (gdLiveAdminViewCode) loadGdLiveParticipants(gdLiveAdminViewCode);
    } else {
      if (user?.role === "student") {
        if (finished) {
          setGdLivePendingFinish(null);
        } else if (gdLiveRoomCode) {
          setGdLivePendingFinish({
            code: gdLiveRoomCode,
            topic: gdLiveRoomTopic,
            members: gdLiveRoomMembers,
            teams: gdLiveRoomTeams,
          });
        }
      }
      setView("dashboard");
      loadDashboardData(token, user);
      if (typeof loadGdLiveSessions === "function") loadGdLiveSessions();
    }
  }

  async function finishGdLiveSpeech() {
    if (!gdLivePendingFinish || gdLiveFinishing) return;
    const code = gdLivePendingFinish.code;
    setGdLiveFinishing(true);
    try {
      // 1. Pull whatever transcript was captured before leaving the room.
      let transcript = "";
      try {
        const finRes = await fetch(getApiUrl() + "/gd-live/sessions/" + code + "/finalize-transcript", {
          method: "POST",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        });
        const finData = await finRes.json();
        transcript = finData.transcript || "";
      } catch (err) {
        console.warn("Finalize transcript failed:", err);
      }

      // 2. If there is almost nothing captured, send the student back to the room
      //    to actually speak, then they can finish with the Conclude Turn button.
      if (!transcript || transcript.length < 10) {
        setMessage("Not enough speech captured yet. Returning to the room to continue speaking.");
        setView("gd-live-room");
        return;
      }

      // 3. Evaluate the finished speech and save the overall result.
      const res = await fetch(getApiUrl() + "/gd-live/sessions/" + code + "/submit-and-evaluate", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to finish speech");
      setGdLiveResultData({
        code,
        topic: gdLivePendingFinish.topic || "",
        transcript,
        evaluation: data.evaluation,
        allCompleted: !!data.all_completed,
      });
      setGdLivePendingFinish(null);
      setView("gd-live-results");
      await loadDashboardData(token, user);
    } catch (err: any) {
      setMessage(err.message || "Failed to finish speech");
    } finally {
      setGdLiveFinishing(false);
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

      const sessions = await apiRequest<any[]>("/gd-live/sessions", {}, token).catch(() => []);
      const curSession = sessions.find((s: any) => s.session_code === sessionCode);
      if (curSession) {
        const isLive = curSession.status === "active";
        setGdLiveIsLiveMeeting(isLive);
        if (!isLive) {
          setGdLiveRoomActive(false);
        }
      }
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
      setRemainingPrepSeconds(null);
      setSoloState("IDLE");
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (chunkIntervalRef.current) {
        clearInterval(chunkIntervalRef.current);
        chunkIntervalRef.current = null;
      }
      lastTranscribedTimeRef.current = 0.0;
      isChunkUploadingRef.current = false;
      setView("solo-practice");
      setSuccess("");
    } catch (err: any) { setMessage(err.message); }
    finally { setLoading(false); }
  }

  function beginSoloPrep() {
    if (!soloSession) return;
    setSoloState("PREPARING");
    setIsPrepPhase(true);
    setIsSessionLocked(true);
    setPrepSeconds(240);
    setIsSpeakingPhase(false);
    setSpeakingSeconds(0);
    setRemainingPrepSeconds(null);
    setView("solo-session");
    setSuccess("You have 4 minutes to prepare. Use the notes area below.");
    speak(`Your topic is: ${soloSession.topic}. You have 4 minutes to prepare.`);
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    
    timerRef.current = setInterval(() => {
      setPrepSeconds(prev => {
        if (prev <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          setPrepSeconds(0);
          setSuccess("Preparation Complete! Start recording when you are ready.");
          speak("Preparation is complete. Click start recording when you are ready.");
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
      await loadDashboardData(token, user);
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
            console.log("[GD-Live perf] host -> response(ms):", Math.round(p.hostClickedToResponse || 0),
              "| student entry -> room-ready(ms):", Math.round(entryToReady));
            return { ...p, studentEntryToReady: entryToReady };
          });
        }}
        onLeave={leaveGdLiveRoom}
      />
    );
  }

  // ───── GD Live Results (finished speech from dashboard) ─────
  if (view === "gd-live-results" && gdLiveResultData && user) {
    const e = gdLiveResultData.evaluation || {};
    const num = (v: any) => Math.round(Number(v ?? 0));
    const overall = num(e.overall_score);
    const metrics = [
      { label: "Grammar & Structure", value: num(e.grammar_score), color: "#2dd4bf" },
      { label: "Fluency & Tempo", value: num(e.fluency_score), color: "#3b82f6" },
      { label: "Confidence & Delivery", value: num(e.confidence_score), color: "#eab308" },
      { label: "Accent / Clarity", value: num(e.accent_score ?? e.voice_clarity_score), color: "#06b6d4" },
      { label: "Topic Relevance", value: num(e.relevance_score), color: "#22c55e" },
      { label: "Content Quality", value: num(e.content_quality), color: "#ec4899" },
    ];
    const strengths = String(e.strengths || "").split(";").map((s: string) => s.trim()).filter(Boolean);
    const weaknesses = String(e.improvement_tips || "").split(";").map((s: string) => s.trim()).filter(Boolean);
    const recommendations = String(e.recommendations || "").split(";").map((s: string) => s.trim()).filter(Boolean);

    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--bg)" }}>
        <div className="w-full max-w-4xl space-y-6 animate-fade-up">
          <div className="text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold uppercase tracking-wider mb-2">
              <CheckCircle2 className="w-3.5 h-3.5" /> Speech Completed
            </div>
            <h1 className="text-3xl font-black text-heading bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-600 bg-clip-text text-transparent">
              Your Overall Result
            </h1>
            <p className="text-xs text-muted-soft mt-1">
              {gdLiveResultData.topic ? `Topic: "${gdLiveResultData.topic}"` : "Group Discussion Evaluation"}
            </p>
          </div>

          <div className="card p-8 text-center relative overflow-hidden">
            <div className="absolute top-0 right-0 w-40 h-40 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
            <Trophy className="w-10 h-10 text-amber-400 mx-auto mb-2" />
            <p className="text-6xl font-black text-heading">{overall}<span className="text-2xl text-muted-soft">%</span></p>
            <p className="text-[10px] text-muted-soft uppercase font-bold tracking-wider mt-1">Overall Evaluation Index</p>
            {gdLiveResultData.allCompleted && (
              <p className="text-[10px] text-emerald-400 font-bold mt-2">Your team has completed the discussion!</p>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {metrics.map((m) => (
              <div key={m.label} className="card p-4 space-y-2">
                <p className="text-[10px] text-muted-soft font-bold uppercase tracking-wider">{m.label}</p>
                <p className="text-2xl font-black text-heading">{m.value}<span className="text-xs text-muted-soft">%</span></p>
                <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                  <div className="h-1.5 rounded-full transition-all duration-700" style={{ width: `${m.value}%`, background: m.color }} />
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="card p-4 flex-1 min-w-[150px]">
              <p className="text-[10px] text-muted-soft font-bold uppercase tracking-wider">Credit Points Earned</p>
              <p className="text-2xl font-black text-heading">{num(e.credential_points)} <span className="text-xs text-muted-soft">pts</span></p>
            </div>
            <div className="card p-4 flex-1 min-w-[150px]">
              <p className="text-[10px] text-muted-soft font-bold uppercase tracking-wider">Speech Speed</p>
              <p className="text-2xl font-black text-heading">{num(e.speech_speed_wpm)} <span className="text-xs text-muted-soft">wpm</span></p>
            </div>
            <div className="card p-4 flex-1 min-w-[150px]">
              <p className="text-[10px] text-muted-soft font-bold uppercase tracking-wider">Filler Words</p>
              <p className="text-2xl font-black text-heading">{num(e.filler_words_count)}</p>
            </div>
          </div>

          {(strengths.length > 0 || weaknesses.length > 0 || recommendations.length > 0) && (
            <div className="card p-6 space-y-5">
              <h3 className="text-sm font-bold text-heading">AI Feedback</h3>
              {strengths.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-emerald-400 mb-2 flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> Strengths</p>
                  <ul className="space-y-1">
                    {strengths.map((s, i) => <li key={i} className="text-xs text-body flex gap-2"><span className="text-emerald-400">•</span>{s}</li>)}
                  </ul>
                </div>
              )}
              {weaknesses.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-amber-400 mb-2 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Areas to Improve</p>
                  <ul className="space-y-1">
                    {weaknesses.map((s, i) => <li key={i} className="text-xs text-body flex gap-2"><span className="text-amber-400">•</span>{s}</li>)}
                  </ul>
                </div>
              )}
              {recommendations.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-indigo-400 mb-2 flex items-center gap-1"><BookOpen className="w-3.5 h-3.5" /> Recommendations</p>
                  <ul className="space-y-1">
                    {recommendations.map((s, i) => <li key={i} className="text-xs text-body flex gap-2"><span className="text-indigo-400">•</span>{s}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {gdLiveResultData.transcript && (
            <div className="card p-6">
              <h3 className="text-xs font-bold text-heading uppercase tracking-wider mb-2">Your Finished Speech</h3>
              <p className="text-xs text-body leading-relaxed max-h-40 overflow-y-auto">{gdLiveResultData.transcript}</p>
            </div>
          )}

          <Button onClick={() => setView("dashboard")} className="btn-primary w-full h-11 text-sm font-bold">
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className={`min-h-screen relative overflow-x-hidden ${theme === "dark" ? "dark" : ""}`}>
        {/* ─── Premium Aurora Mesh & Subtle Vignette Grid Background (Replaces Dot Pattern) ─── */}
        <div className="fixed inset-0 z-0 bg-[#f8fafc] dark:bg-[#070b12] transition-colors pointer-events-none overflow-hidden">
          {/* Subtle Modern Linear Grid with Soft Radial Mask Fade */}
          <div
            className="absolute inset-0 opacity-40 dark:opacity-20"
            style={{
              backgroundImage:
                theme === "dark"
                  ? "linear-gradient(to right, rgba(148, 163, 184, 0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(148, 163, 184, 0.08) 1px, transparent 1px)"
                  : "linear-gradient(to right, rgba(100, 116, 139, 0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(100, 116, 139, 0.12) 1px, transparent 1px)",
              backgroundSize: "48px 48px",
              maskImage: "radial-gradient(ellipse 80% 60% at 50% 25%, black 40%, transparent 90%)",
              WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 50% 25%, black 40%, transparent 90%)"
            }}
          />

          {/* Ambient Radiant Aurora Glow Orbs */}
          <div className="absolute -top-[20%] left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-gradient-to-b from-indigo-500/15 via-blue-500/10 to-transparent blur-[140px] rounded-full pointer-events-none" />
          <div className="absolute top-[10%] -left-[10%] w-[500px] h-[500px] bg-gradient-to-tr from-sky-400/12 to-transparent blur-[120px] rounded-full pointer-events-none" />
          <div className="absolute top-[15%] -right-[10%] w-[550px] h-[550px] bg-gradient-to-tl from-purple-500/12 to-transparent blur-[130px] rounded-full pointer-events-none" />
          <div className="absolute top-[65%] left-1/2 -translate-x-1/2 w-[800px] h-[450px] bg-gradient-to-t from-blue-600/8 via-indigo-600/5 to-transparent blur-[140px] rounded-full pointer-events-none" />
        </div>

        {/* ─── Top Sticky Navbar (Screenshot 1) ─── */}
        <header className="sticky top-0 z-40 w-full border-b border-slate-200/80 dark:border-slate-800/80 bg-white/85 dark:bg-slate-950/85 backdrop-blur-md transition-colors">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            {/* Logo + Brand (Without plus symbol) */}
            <div className="flex items-center gap-2.5">
              <img
                src="/MZ_logo_DB.webp"
                alt="Mount Zion Logo"
                className="w-9 h-9 rounded-lg object-cover shadow-sm"
              />
              <span className="font-extrabold text-xl tracking-tight text-slate-900 dark:text-white">
                MZ ThinkCircle
              </span>
            </div>

            {/* Navigation links (ONLY 5 items matching user request: Home, How It Works, Features, FAQs, Contact) */}
            <nav className="hidden md:flex items-center gap-8 text-sm font-medium">
              {[
                { id: "home", label: "Home" },
                { id: "how-it-works", label: "How It Works" },
                { id: "features", label: "Features" },
                { id: "faqs", label: "FAQs" },
                { id: "contact", label: "Contact" }
              ].map((item) => {
                const isActive = activeNav === item.id;
                return (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      scrollToSection(item.id);
                    }}
                    className={`transition-all duration-200 cursor-pointer ${
                      isActive
                        ? "text-blue-600 dark:text-blue-400 font-bold"
                        : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    {item.label}
                  </a>
                );
              })}
            </nav>

            {/* Right Controls */}
            <div className="flex items-center gap-3">
              <button
                onClick={toggleTheme}
                className="w-10 h-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 text-slate-700 dark:text-slate-200 flex items-center justify-center hover:scale-105 transition-transform shadow-sm"
                title="Toggle light/dark theme"
              >
                {theme === "dark" ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-600" />}
              </button>
              <button
                onClick={() => {
                  setIsLoginModalOpen(true);
                  setMessage("");
                }}
                className="h-10 px-5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm shadow-md shadow-blue-500/20 transition-all flex items-center gap-1.5"
              >
                <span>Login</span>
              </button>
            </div>
          </div>
        </header>

        {/* ─── Full-Viewport Hero Section ─── */}
        <section
          id="home"
          className="relative z-10 min-h-[calc(100vh-4rem)] flex flex-col justify-center items-center py-6 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto text-center scroll-mt-16"
        >
          {/* Ambient Glow Aura */}
          <div className="pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 w-[700px] h-[360px] bg-gradient-to-tr from-blue-500/15 via-indigo-500/20 to-purple-500/15 blur-[130px] rounded-full" />

          <div className="w-full space-y-6 sm:space-y-7 flex flex-col items-center my-auto">
            {/* Institutional Pill Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold bg-blue-50/90 dark:bg-blue-950/60 border border-blue-200/90 dark:border-blue-800/80 text-blue-700 dark:text-blue-300 shadow-sm animate-fade-in">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>AI Group Discussion & Speech Intelligence — Mount Zion College</span>
            </div>

            {/* Subtitle & Title */}
            <div className="space-y-2.5 max-w-4xl">
              <p className="text-xs sm:text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                Mount Zion College of Engineering And Technology
              </p>
              <h1 className="text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-[1.12]">
                <span className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent">
                  Master Campus Group Discussions
                </span>
                <br />
                <span className="text-slate-900 dark:text-white">With Real-Time Speech AI</span>
              </h1>
            </div>

            <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 max-w-3xl mx-auto font-medium leading-relaxed">
              Articulate with confidence, master turn-taking dynamics, and receive instantaneous 8-pillar acoustic feedback. Engineered for campus recruitment and Tier-1 placement rounds.
            </p>

            {/* Primary Action Buttons */}
            <div className="flex flex-wrap items-center justify-center gap-3.5 pt-1">
              <button
                onClick={() => {
                  setIsLoginModalOpen(true);
                  setMessage("");
                }}
                className="h-12 px-8 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm sm:text-base shadow-xl shadow-blue-600/25 transition-all flex items-center gap-2 hover:-translate-y-0.5 cursor-pointer"
              >
                <span>🚀 Enter Live GD Arena</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <a
                href="#how-it-works"
                onClick={(e) => {
                  e.preventDefault();
                  scrollToSection("how-it-works");
                }}
                className="h-12 px-7 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-sm sm:text-base border border-slate-200 dark:border-slate-800 shadow-sm transition-all flex items-center gap-2 cursor-pointer"
              >
                <span>See How It Works</span>
              </a>
            </div>

            {/* ─── 4-Card Placement Telemetry Stats Row ─── */}
            <div className="pt-4 w-full max-w-5xl mx-auto">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                {[
                  { number: "50+", label: "Campus GD Topics", sub: "TCS, Zoho, Infosys prompts", icon: BookOpen, color: "text-blue-600" },
                  { number: "8", label: "Speech AI Pillars", sub: "Real-time acoustic radar", icon: Cpu, color: "text-indigo-600" },
                  { number: "<100ms", label: "Ultra Low Latency", sub: "Multi-peer WebRTC audio", icon: Radio, color: "text-purple-600" },
                  { number: "94.2%", label: "Placement Success", sub: "Tier-1 offer conversions", icon: Trophy, color: "text-emerald-600" }
                ].map((stat, i) => (
                  <div key={i} className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/85 dark:bg-slate-900/70 backdrop-blur-xl text-left shadow-sm space-y-1">
                    <div className="flex items-center justify-between">
                      <span className={`text-2xl sm:text-3xl font-black font-mono ${stat.color}`}>{stat.number}</span>
                      <stat.icon className="w-5 h-5 text-slate-400" />
                    </div>
                    <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">{stat.label}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">{stat.sub}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ─── How It Works Section ─── */}
        <section id="how-it-works" className="scroll-mt-20 py-8 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto space-y-6">
          <div className="text-center max-w-2xl mx-auto space-y-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              Campus Placement Pipeline
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
              How It Works: 4 Steps to Placement Mastery
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              Simulates authentic corporate placement rounds with AI-guided preparation, live debate, and diagnostic scoring.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              {
                step: "01",
                title: "Room Entry & Brief",
                desc: "Enter a 4-digit room code or select from 50+ campus recruitment topics. Receive 2 minutes of prep with suggested thesis points.",
                tag: "Matchmaking & Prep"
              },
              {
                step: "02",
                title: "Live Audio Debate",
                desc: "Take turns speaking with peers over crystal-clear WebRTC audio. Automated AI timekeeper prevents interruptions and ensures balance.",
                tag: "Spatial WebRTC"
              },
              {
                step: "03",
                title: "Neural AI Evaluation",
                desc: "Speech intelligence engine listens to voiceprints, evaluating grammar, articulation, vocabulary, and relevance in real time.",
                tag: "8-Pillar Scoring"
              },
              {
                step: "04",
                title: "Dossier & Rankings",
                desc: "Gain Elo credits, climb department leaderboards across CSE/IT/AIDS/ECE, and download official placement PDF reports.",
                tag: "Verified Analytics"
              }
            ].map((item) => (
              <div
                key={item.step}
                className="p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/85 dark:bg-slate-900/60 backdrop-blur-xl space-y-3 shadow-sm hover:shadow-lg transition-all hover:-translate-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-black px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                    STAGE {item.step}
                  </span>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{item.tag}</span>
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white pt-1">{item.title}</h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ─── Features Section ─── */}
        <section id="features" className="scroll-mt-20 py-8 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto space-y-6">
          <div className="text-center max-w-2xl mx-auto space-y-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              State-of-the-Art Architecture
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
              Engineered for Campus GD Excellence
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              Purpose-built tools for Mount Zion students and placement coordinators to accelerate oral proficiency.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              {
                icon: Cpu,
                title: "8-Pillar Acoustic Intelligence",
                desc: "Calculates scores for grammar accuracy, voice confidence, fluency cadence, pronunciation, topic relevance, reasoning, vocabulary, and delivery.",
                badge: "Core AI Engine"
              },
              {
                icon: Zap,
                title: "Autonomous AI Moderator",
                desc: "Interjects intelligently when discussions stall, introduces provocative counter-arguments, and guarantees equitable candidate speaking distribution.",
                badge: "Dynamic Moderation"
              },
              {
                icon: Target,
                title: "Solo AI Practice Simulator",
                desc: "Practice solo drills 24/7. Get random campus debate prompts, record responses, and receive instantaneous radar calibration and improvement critiques.",
                badge: "Anytime Drills"
              },
              {
                icon: Trophy,
                title: "Department & Year Leaderboards",
                desc: "Competitive ranking across CSE, IT, AIDS, and ECE cohorts. Earn Elo rating points, climb tiers, and showcase verified placement readiness badges.",
                badge: "Gamified Growth"
              },
              {
                icon: Radio,
                title: "Low-Latency WebRTC Arena",
                desc: "Spatial peer-to-peer audio pipeline optimized for Indian college networks with adaptive bitrate, zero echo, and active speaker glow detection.",
                badge: "Sub-100ms Voice"
              },
              {
                icon: FileText,
                title: "Institutional Placement Reports",
                desc: "One-click download of official Anna University and corporate recruitment assessment reports in PDF and Excel formats with student voiceprints.",
                badge: "Audit & PDF Dossiers"
              }
            ].map((f, i) => (
              <div
                key={i}
                className="p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 backdrop-blur-xl space-y-3 shadow-sm hover:border-blue-500/40 transition-all hover:-translate-y-0.5"
              >
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-50 to-indigo-50 dark:from-blue-950/80 dark:to-indigo-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold shadow-sm">
                    <f.icon className="w-4 h-4" />
                  </div>
                  <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    {f.badge}
                  </span>
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">{f.title}</h3>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ─── Trending Campus GD Topics Section ─── */}
        <section className="scroll-mt-20 py-8 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto space-y-6">
          <div className="text-center max-w-2xl mx-auto space-y-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              Campus Placement Practice Library
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
              Trending Campus Recruitment GD Topics
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              Curated from recent campus recruitment interview rounds at TCS, Zoho, Cognizant, and Infosys.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                title: "Artificial Intelligence in Healthcare: Ethical Frontiers vs Diagnostic Speed",
                category: "Tech & AI",
                difficulty: "Advanced",
                rounds: 42,
                desc: "Examines ethical dilemmas of algorithmic diagnosis, doctor accountability, and medical data confidentiality."
              },
              {
                title: "Remote vs Hybrid Engineering: Impact on Innovation and Team Cohesion",
                category: "Workplace",
                difficulty: "Intermediate",
                rounds: 58,
                desc: "Discusses productivity metrics, spontaneous ideation, and junior developer mentoring in distributed tech teams."
              },
              {
                title: "Green Hydrogen & Sustainable Mobility: India's Path to Net Zero by 2070",
                category: "Socio-Tech",
                difficulty: "Placement Favorite",
                rounds: 37,
                desc: "Evaluates electric vehicles versus hydrogen fuel cells, grid infrastructure, and manufacturing economics."
              }
            ].map((topic, i) => (
              <div
                key={i}
                className="p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 backdrop-blur-xl shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-3.5"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
                      {topic.category}
                    </span>
                    <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
                      ★ {topic.difficulty}
                    </span>
                  </div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white leading-snug">{topic.title}</h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{topic.desc}</p>
                </div>

                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-500">{topic.rounds} debate rounds</span>
                  <button
                    onClick={() => {
                      setIsLoginModalOpen(true);
                      setMessage("");
                    }}
                    className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                  >
                    <span>Practice Topic</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ─── Interactive FAQs Accordion Section ─── */}
        <section id="faqs" className="scroll-mt-20 py-8 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto space-y-6">
          <div className="text-center max-w-xl mx-auto space-y-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              Clear Answers
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
              Frequently Asked Questions
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              Everything you need to know about the MZ ThinkCircle Group Discussion platform.
            </p>
          </div>

          <div className="space-y-2.5">
            {[
              {
                q: "What is Speaksense AI ThinkCircle?",
                a: "MZ ThinkCircle is an institutional AI speech evaluation platform engineered specifically for Mount Zion College of Engineering and Technology students to master Group Discussions, public speaking, and campus placement interview rounds."
              },
              {
                q: "How does real-time AI evaluation work during a Group Discussion?",
                a: "Our speech AI listens via WebRTC audio stream, transcribes each participant's turn, and evaluates 8 speech pillars in real-time: Grammar, Fluency, Pronunciation, Confidence, Topic Relevance, Critical Thinking, Originality, and Content Quality."
              },
              {
                q: "Can I practice alone before joining a peer live debate?",
                a: "Yes! Solo AI Practice Drills allow you to pick or receive a random topic, record your response, and receive instantaneous radar feedback with detailed improvement tips."
              },
              {
                q: "How do I enter an active live GD session?",
                a: "Click 'Login' or 'Enter Live GD Arena', log in with your college Register Number (default password: Password123), and enter the 4-digit session code provided by your faculty or session host."
              },
              {
                q: "How are the department and college leaderboards calculated?",
                a: "Every concluded discussion awards Elo performance credits based on your speaking turn ratings, vocabulary richness, consensus building, and articulation scores."
              },
              {
                q: "Can faculty and coordinators download official assessment reports?",
                a: "Yes, administrators and faculty can export comprehensive student speech analytics, attendance rosters, and radar charts as official PDF and Excel reports."
              }
            ].map((faq, idx) => {
              const isOpen = openFaqIndex === idx;
              return (
                <div
                  key={idx}
                  className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/85 dark:bg-slate-900/60 backdrop-blur-xl shadow-sm overflow-hidden transition-all"
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                    className="w-full p-4 text-left flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
                  >
                    <span className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
                      <span className="w-5 h-5 rounded-md bg-blue-50 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xs font-bold shrink-0">
                        {idx + 1}
                      </span>
                      {faq.q}
                    </span>
                    <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180 text-blue-600" : ""}`} />
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 pt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400 pl-12 leading-relaxed border-t border-slate-100 dark:border-slate-800/50">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ─── High-Impact Placement Call-to-Action (CTA) Pre-Footer Banner ─── */}
        <section className="py-6 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto">
          <div className="rounded-3xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 p-6 sm:p-8 text-center text-white shadow-xl space-y-4 relative overflow-hidden">
            <div className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 bg-white/10 rounded-full blur-2xl" />
            <span className="inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-white/15 backdrop-blur-md">
              Mount Zion Placement Training 2026
            </span>
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight">
              Ready to Ace Your Next Placement GD?
            </h2>
            <p className="text-xs sm:text-sm text-blue-100 max-w-2xl mx-auto leading-relaxed">
              Join 1,200+ Mount Zion engineering students accelerating their speaking confidence and securing dream corporate job offers.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
              <button
                onClick={() => {
                  setIsLoginModalOpen(true);
                  setMessage("");
                }}
                className="h-11 px-7 rounded-xl bg-white text-blue-600 hover:bg-slate-100 font-extrabold text-sm shadow-xl transition-all hover:scale-105"
              >
                🚀 Launch Live GD Arena
              </button>
              <button
                onClick={() => {
                  setIsLoginModalOpen(true);
                  setMessage("");
                }}
                className="h-11 px-6 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-sm border border-white/20 backdrop-blur-md transition-all"
              >
                Start Solo Practice Drill
              </button>
            </div>
          </div>
        </section>

        {/* ─── Official Institutional Footer Section ─── */}
        <footer id="contact" className="scroll-mt-20 border-t border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 backdrop-blur-xl relative z-10 transition-colors">
          {/* Subtle Top Accent Gradient Line */}
          <div className="h-1 w-full bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600" />

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-8">
            {/* Top Multi-Column Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-8 lg:gap-10 pb-10 border-b border-slate-200/80 dark:border-slate-800/80">
              {/* Column 1: Brand & College Info (4 cols on lg) */}
              <div className="lg:col-span-4 space-y-4 text-left">
                <div className="flex items-center gap-3">
                  <img
                    src="/MZ_logo_DB.webp"
                    alt="Mount Zion College of Engineering and Technology"
                    className="w-10 h-10 rounded-xl object-cover shadow-md ring-2 ring-blue-500/20"
                  />
                  <div>
                    <span className="text-lg font-black tracking-tight">
                      <span className="text-blue-600 dark:text-blue-400">MZ Think</span>
                      <span className="text-emerald-500">Circle</span>
                    </span>
                    <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">Speech & GD AI Colosseum</p>
                  </div>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-w-sm">
                  The institutional group discussion training and speech intelligence platform for <strong>Mount Zion College of Engineering & Technology</strong>. Engineered to accelerate student verbal fluency, debate argumentation, and corporate placement offer conversions.
                </p>

                {/* Accreditation & Institutional Badges */}
                <div className="flex flex-wrap gap-2 pt-1">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800/80 text-[10px] font-bold">
                    <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                    NAAC 'A' Grade
                  </span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/80 text-[10px] font-bold">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                    Anna University Affiliated
                  </span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200/80 dark:border-purple-800/80 text-[10px] font-bold">
                    <Award className="w-3.5 h-3.5 text-purple-600" />
                    AICTE Approved
                  </span>
                </div>
              </div>

              {/* Column 2: Quick Links (2 cols on lg) */}
              <div className="lg:col-span-2 space-y-3 text-left">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white">Quick Navigation</h4>
                <ul className="space-y-2 text-xs">
                  {[
                    { id: "home", label: "Home" },
                    { id: "how-it-works", label: "How It Works" },
                    { id: "features", label: "Features" },
                    { id: "faqs", label: "FAQs" },
                    { id: "contact", label: "Contact Us" }
                  ].map((item) => (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          scrollToSection(item.id);
                        }}
                        className="text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex items-center gap-1.5 cursor-pointer font-medium"
                      >
                        <ChevronRight className="w-3 h-3 text-slate-400" />
                        <span>{item.label}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Column 3: Platform Features (3 cols on lg) */}
              <div className="lg:col-span-3 space-y-3 text-left">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white">Placement Intelligence</h4>
                <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
                  <li className="flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    <span>8-Pillar Acoustic Intelligence</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span>Autonomous AI Turn Moderator</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    <span>24/7 Solo Speech Practice Drills</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Trophy className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span>Department & Cohort Leaderboards</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                    <span>Low-Latency Spatial WebRTC Audio</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                    <span>Official Audit PDF & Excel Dossiers</span>
                  </li>
                </ul>
              </div>

              {/* Column 4: Official Contact & Campus Location (3 cols on lg) */}
              <div className="lg:col-span-3 space-y-3 text-left">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white">Campus Location & Contact</h4>
                <div className="space-y-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  <div className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <span>
                      Lena Vilakku, Pilivalam P.O, Pudukkottai District, Tamil Nadu — 622 507
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>+91 4333 294400 / +91 73733 44444</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-blue-600 shrink-0" />
                    <a href="mailto:info@mzcet.in" className="hover:text-blue-600 transition-colors">info@mzcet.in</a>
                    <span>·</span>
                    <a href="mailto:placements@mzcet.in" className="hover:text-blue-600 transition-colors">placements@mzcet.in</a>
                  </div>
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-blue-600 shrink-0" />
                    <a href="https://www.mzcet.in" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 transition-colors font-medium">www.mzcet.in</a>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    onClick={() => {
                      setIsLoginModalOpen(true);
                      setMessage("");
                    }}
                    className="w-full py-2 px-3 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 font-bold text-xs hover:bg-blue-100 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>🚀 Launch Student & Faculty Portal</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Bottom Sub-Footer Bar */}
            <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-2 text-center sm:text-left">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>All Speech AI Systems Operational · Server Latency: 42ms</span>
              </div>

              <div className="text-center">
                <span>© 2026 Mount Zion College of Engineering and Technology. All rights reserved.</span>
              </div>

              <button
                onClick={() => scrollToSection("home")}
                className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer group"
              >
                <span>Back to Top</span>
                <ArrowUp className="w-3.5 h-3.5 group-hover:-translate-y-0.5 transition-transform" />
              </button>
            </div>
          </div>
        </footer>

        {/* ──────────────────────────────────────────────────────────── */}
        {/* LOGIN MODAL (SCREENSHOT 2 - NO PLUS SYMBOL) */}
        {/* ──────────────────────────────────────────────────────────── */}
        {isLoginModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
            <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-7 sm:p-8 shadow-2xl border border-slate-100 dark:border-slate-800 relative animate-scale-up space-y-6">
              {/* Back button */}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setIsLoginModalOpen(false);
                    setMessage("");
                  }}
                  className="w-9 h-9 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
                  title="Go back"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Mount Zion GD</span>
                </div>
              </div>

              {/* Title & Branding (No plus symbol) */}
              <div className="text-center space-y-1">
                <h2 className="text-xl font-bold tracking-tight">
                  <span className="text-blue-600 font-extrabold">MZ Think</span>
                  <span className="text-emerald-500 font-black">Circle</span>
                </h2>
                <h3 className="text-2xl font-black text-slate-900 dark:text-white">Welcome Back</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Login to your GD account to continue</p>
              </div>

              {/* Role Navigation Tabs: Student, Admin, Principal, Coordinator (Screenshot 2) */}
              <div className="flex border-b border-slate-200 dark:border-slate-800 justify-between px-1">
                {[
                  { id: "student", label: "Student" },
                  { id: "admin", label: "Admin" },
                  { id: "principal", label: "Principal" },
                  { id: "coordinator", label: "Coordinator" }
                ].map((tab) => {
                  const isActive = loginRoleTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setLoginRoleTab(tab.id as any);
                        setLoginTab(tab.id === "student" ? "student" : "admin");
                        setMessage("");
                      }}
                      className={`pb-2.5 text-xs sm:text-sm font-semibold transition-all relative ${
                        isActive
                          ? "text-blue-600 dark:text-blue-400 font-bold"
                          : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                      }`}
                    >
                      {tab.label}
                      {isActive && (
                        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400 rounded-full" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Form Inputs (Screenshot 2) */}
              <div className="space-y-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                    {loginRoleTab === "student" ? "REGISTER NUMBER" : "SPR / FACULTY ID"}
                  </label>
                  <Input
                    placeholder={loginRoleTab === "student" ? "e.g., 911724205001" : "e.g., 12345"}
                    value={loginRoleTab === "student" ? studentRegisterNumber : adminRegisterNumber}
                    onChange={(e) =>
                      loginRoleTab === "student"
                        ? setStudentRegisterNumber(e.target.value)
                        : setAdminRegisterNumber(e.target.value)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleLogin();
                    }}
                    className="w-full h-12 rounded-xl bg-slate-50/90 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm font-mono px-4 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                    PASSWORD
                  </label>
                  <Input
                    type="password"
                    placeholder="Enter your password"
                    value={loginRoleTab === "student" ? studentPassword : adminPassword}
                    onChange={(e) =>
                      loginRoleTab === "student"
                        ? setStudentPassword(e.target.value)
                        : setAdminPassword(e.target.value)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleLogin();
                    }}
                    className="w-full h-12 rounded-xl bg-slate-50/90 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm px-4 text-slate-900 dark:text-white"
                  />
                </div>

                {/* Quick Auto-fill Demo Helpers & Forgot Password */}
                <div className="flex items-center justify-between text-xs pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (loginRoleTab === "student") {
                        setStudentRegisterNumber("911724205001");
                        setStudentPassword("Password123");
                      } else {
                        setAdminRegisterNumber("12345");
                        setAdminPassword("Mzorator@admin");
                      }
                    }}
                    className="text-blue-600 dark:text-blue-400 hover:underline font-semibold text-[11px]"
                  >
                    Auto-fill demo {loginRoleTab === "student" ? "(911724205001)" : "(12345)"}
                  </button>

                  <span className="text-blue-600 dark:text-blue-400 hover:underline font-semibold cursor-pointer text-[11px]">
                    Forgot password?
                  </span>
                </div>

                {message && (
                  <div className="flex items-center gap-2 rounded-xl p-3 text-xs bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/25">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{message}</span>
                  </div>
                )}

                <Button
                  onClick={handleLogin}
                  disabled={loading}
                  className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-bold text-base rounded-xl shadow-lg shadow-blue-600/25 border-0 transition-all"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Login"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderSidebarContent(isMobile = false) {
    if (!user) return null;
    return (
      <div className="flex flex-col h-full [background:var(--surface)] dark:bg-slate-950/20 backdrop-blur-xl">
        {/* Logo and online status */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200/50 dark:border-slate-800/50 shrink-0 bg-gradient-to-b from-indigo-500/5 via-transparent to-transparent">
          <div className="flex items-center gap-3">
            <img src="/MZ_logo_DB.webp" alt="Mount Zion Logo" className="w-10 h-10 rounded-xl object-cover shadow-md shrink-0 hover:rotate-6 transition-transform duration-300" />
            <div className="truncate">
              <p className="text-sm font-bold text-heading flex items-center gap-1.5">
                MZ ThinkCircle
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
          {gdLiveCreatedCode && (
            <div className="mb-6 p-6 rounded-2xl bg-gradient-to-r from-indigo-500/20 via-purple-500/20 to-pink-500/20 border-2 border-indigo-500/40 backdrop-blur-xl flex flex-col md:flex-row items-center justify-between gap-4 animate-fade-up shadow-xl">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black text-2xl shadow-lg shrink-0">
                  <Sparkles className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-lg font-extrabold text-heading">GD Session Created Successfully!</h3>
                  <p className="text-xs text-muted-soft">Share this 4-digit room code with students to let them join:</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <code className="text-3xl font-black font-mono tracking-widest text-indigo-500 dark:text-indigo-400 bg-white/80 dark:bg-slate-900/80 px-6 py-2 rounded-xl border-2 border-indigo-500/30 shadow-inner select-all">
                  {gdLiveCreatedCode}
                </code>
                <Button
                  onClick={() => {
                    navigator.clipboard.writeText(gdLiveCreatedCode);
                    setSuccess(`Code ${gdLiveCreatedCode} copied to clipboard!`);
                  }}
                  className="btn-primary h-12 px-4 flex items-center gap-2"
                >
                  <Copy className="w-4 h-4" /> Copy Code
                </Button>
                <button
                  onClick={() => setGdLiveCreatedCode("")}
                  className="p-2 text-muted-soft hover:text-heading rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
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
            <ProfileView
              user={user}
              token={token}
              progress={progress}
              setSuccess={setSuccess}
              setMessage={setMessage}
            />
          )}

          {/* Reports View */}
          {view === "reports" && user && (
            <ReportsView
              user={user}
              progress={progress}
              gdLiveSessions={gdLiveSessions}
              soloHistory={soloHistory}
              token={token}
              pdfLoading={pdfLoading}
              setPdfLoading={setPdfLoading}
              setSuccess={setSuccess}
              setMessage={setMessage}
              setView={setView}
              startSoloPractice={startSoloPractice}
            />
          )}

          {/* Achievements View */}
          {view === "achievements" && user && (
            <AchievementsView
              user={user}
              progress={progress}
              gdLiveSessions={gdLiveSessions}
              soloHistory={soloHistory}
              cert1Downloading={cert1Downloading}
              setCert1Downloading={setCert1Downloading}
              cert2Downloading={cert2Downloading}
              setCert2Downloading={setCert2Downloading}
              setSuccess={setSuccess}
              setView={setView}
              startSoloPractice={startSoloPractice}
            />
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
            user.role === "admin" ? (
              <AdminDashboard
                user={user}
                gdLiveSessions={gdLiveSessions}
                loading={loading}
                createGdLiveSession={createGdLiveSession}
                setGdLiveAdminViewCode={setGdLiveAdminViewCode}
                loadGdLiveParticipants={loadGdLiveParticipants}
                loadGdLiveLeaderboard={loadGdLiveLeaderboard}
                loadLeaderboard={loadLeaderboard}
                setView={setView}
                gdLiveCreatedCode={gdLiveCreatedCode}
              />
            ) : (
              <StudentDashboard
                user={user}
                progress={progress}
                gdLiveSessions={gdLiveSessions}
                soloHistory={soloHistory}
                soloQuote={soloQuote}
                gdLiveCode={gdLiveCode}
                setGdLiveCode={setGdLiveCode}
                joinGdLive={joinGdLive}
                loading={loading}
                gdLivePendingFinish={gdLivePendingFinish}
                finishGdLiveSpeech={finishGdLiveSpeech}
                gdLiveFinishing={gdLiveFinishing}
                setView={setView}
                startSoloPractice={startSoloPractice}
                loadLeaderboard={loadLeaderboard}
              />
            )
          )}
          {/* Leaderboard View */}
          {view === "gd-leaderboard" && (
            <LeaderboardView
              lbData={lbData}
              lbDepartment={lbDepartment}
              lbYear={lbYear}
              lbTimeframe={lbTimeframe}
              lbLastUpdated={lbLastUpdated}
              loadLeaderboard={loadLeaderboard}
              setView={setView}
              user={user}
            />
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
              <div className="card p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-heading">{soloSession.topic}</h2>
                    <p className="text-sm text-muted-soft">Session #{soloSession.session_number} · Solo Practice</p>
                  </div>
                  <div className="flex gap-2">
                    {soloState === "RECORDING" && (
                      <Button onClick={stopSoloRecording} disabled={loading} variant="secondary" className="bg-red-500/20 text-red-300 border-red-500/30 hover:bg-red-500/30">
                        End & Submit
                      </Button>
                    )}
                  </div>
                </div>

                {/* State-aware Timer Panel */}
                {(soloState === "PREPARING" || soloState === "RECORDING" || soloState === "FINALIZING" || soloState === "EVALUATING") && (
                  <div className={`rounded-xl p-6 text-center mb-6 border transition-all ${
                    soloState === "PREPARING"
                      ? "bg-blue-500/10 border-blue-500/30 animate-pulse"
                      : soloState === "RECORDING"
                      ? "bg-emerald-500/10 border-emerald-500/30"
                      : "bg-purple-500/10 border-purple-500/30"
                  }`}>
                    <p className="text-sm font-semibold text-body mb-2">
                      {soloState === "PREPARING"
                        ? (prepSeconds > 0 ? "Preparation Phase — Think & Take Notes" : "Preparation Complete!")
                        : soloState === "RECORDING"
                        ? "Speaking Phase — Deliver Your Thoughts"
                        : soloState === "FINALIZING"
                        ? "Finalizing transcript..."
                        : "Evaluating performance..."}
                    </p>
                    
                    {(soloState === "PREPARING" || soloState === "RECORDING") && (
                      <p className="text-5xl font-extrabold text-heading font-mono tracking-wider mb-4">
                        {formatTime(soloState === "PREPARING" ? prepSeconds : speakingSeconds)}
                      </p>
                    )}

                    {/* Mic Permission Error Alert */}
                    {message && message.includes("Microphone") && (
                      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 my-3 max-w-md mx-auto text-xs text-red-300 flex flex-col items-center gap-2">
                        <span>{message}</span>
                        <Button onClick={checkMicPermissionAndStartRecording} className="btn-secondary h-8 px-4 text-xs font-bold">
                          Retry Permission
                        </Button>
                      </div>
                    )}

                    {/* Main Interaction Button */}
                    {soloState === "PREPARING" && (
                      <Button onClick={checkMicPermissionAndStartRecording} className="btn-primary w-full max-w-sm h-12 text-sm font-bold bg-gradient-to-r from-amber-500 to-orange-600 border-0">
                        <Mic className="h-4 w-4 mr-2" /> Start Recording
                      </Button>
                    )}

                    {soloState === "RECORDING" && (
                      <Button onClick={stopSoloRecording} className="btn-primary w-full max-w-sm h-12 text-sm font-bold bg-red-500 hover:bg-red-600 border-0 animate-pulse">
                        <MicOff className="h-4 w-4 mr-2" /> Stop Recording
                      </Button>
                    )}

                    {(soloState === "FINALIZING" || soloState === "EVALUATING") && (
                      <div className="flex flex-col items-center justify-center gap-3 py-4">
                        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
                        <span className="text-xs text-muted-soft">
                          {soloState === "FINALIZING" ? "Assembling audio slices and finalizing transcript..." : "Analyzing speech characteristics & scoring..."}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Topic info */}
                <div className="mb-6">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-soft mb-2">Selected Topic</p>
                  <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
                    <p className="text-sm font-semibold text-heading leading-relaxed">{soloSession.topic}</p>
                  </div>
                </div>

                {/* Live Transcript & Notes Area */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-soft">
                      {soloState === "PREPARING" ? "Preparation Notes" : "Speech Transcript"}
                    </span>
                    {recordingStatus && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-800 text-amber-400 border border-slate-700 animate-pulse">
                        {recordingStatus}
                      </span>
                    )}
                  </div>

                  {liveDetectedText && (
                    <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 animate-in fade-in duration-300">
                      <p className="text-xs text-emerald-300 leading-normal">
                        <span className="font-bold mr-1">Live Detected:</span> "{liveDetectedText}"
                      </p>
                    </div>
                  )}

                  <Textarea
                    placeholder={
                      soloState === "PREPARING"
                        ? "Jot down notes, bullet points, and key arguments during preparation..."
                        : "Your spoken transcript will appear here progressively..."
                    }
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    className="inp min-h-[180px] font-sans text-sm leading-relaxed"
                    disabled={soloState === "FINALIZING" || soloState === "EVALUATING"}
                  />

                  <div className="flex justify-between items-center pt-2">
                    <span className="text-xs font-semibold text-muted-soft">
                      {transcript.trim().split(/\s+/).filter(Boolean).length} words
                    </span>
                    <div className="flex gap-2">
                      <Button onClick={cancelSoloSession} variant="secondary" className="text-xs font-bold">
                        Cancel
                      </Button>
                      <Button
                        onClick={() => executeSoloSubmission(transcript)}
                        disabled={loading || transcript.trim().length < 10 || soloState === "FINALIZING" || soloState === "EVALUATING"}
                        className="bg-gradient-to-r from-amber-500 to-orange-600 border-0 text-xs font-bold"
                      >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Award className="h-4 w-4" />} Submit Transcript
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
                    <p className="text-sm text-muted-soft">{soloSession.topic} Â· Session #{soloSession.session_number}</p>
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
                    placeholder="Enter 4-digit code (e.g. 4589)"
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
              {/* Sub Navigation */}
              <div className="flex gap-4 border-b border-[var(--border)] pb-3">
                <button
                  onClick={() => setAdminSubTab("sessions")}
                  className={`text-sm font-bold pb-2 transition border-b-2 px-1 ${adminSubTab === "sessions" ? "border-amber-500 text-amber-400" : "border-transparent text-muted hover:text-heading"}`}
                >
                  Active Sessions
                </button>
                <button
                  onClick={() => setAdminSubTab("students")}
                  className={`text-sm font-bold pb-2 transition border-b-2 px-1 ${adminSubTab === "students" ? "border-amber-500 text-amber-400" : "border-transparent text-muted hover:text-heading"}`}
                >
                  Student Directory
                </button>
                <button
                  onClick={() => setAdminSubTab("analytics")}
                  className={`text-sm font-bold pb-2 transition border-b-2 px-1 ${adminSubTab === "analytics" ? "border-amber-500 text-amber-400" : "border-transparent text-muted hover:text-heading"}`}
                >
                  Analytics & AI Usage
                </button>
              </div>

              {adminSubTab === "sessions" && (
                <div className="space-y-6">
                  <div className="card p-6">
                    <h2 className="text-lg font-semibold text-heading mb-4 flex items-center gap-2"><Shield className="w-5 h-5 text-amber-400" /> Host a Group Discussion Session</h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5 border-b border-[var(--border)] pb-5">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-muted-soft">Discussion Topic</label>
                        <select
                          value={selectedTopicId}
                          onChange={(e) => setSelectedTopicId(Number(e.target.value))}
                          className="w-full h-11 px-4 rounded-xl border border-[var(--border)] text-heading text-sm focus:outline-none focus:border-amber-500/60 focus:ring-2 focus:ring-amber-400/20 transition-all inp"
                        >
                          {easyTopicsList.map((t: any) => (
                            <option key={t.id} value={t.id}>{t.topic}</option>
                          ))}
                          {easyTopicsList.length === 0 && (
                            <option value={1}>Introduce yourself and share your thoughts</option>
                          )}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-muted-soft">Team Size (Target)</label>
                        <select
                          value={teamSize}
                          onChange={(e) => setTeamSize(Number(e.target.value))}
                          className="w-full h-11 px-4 rounded-xl border border-[var(--border)] text-heading text-sm focus:outline-none focus:border-amber-500/60 focus:ring-2 focus:ring-amber-400/20 transition-all inp"
                        >
                          {[2, 3, 4, 5, 6, 7, 8].map((size) => (
                            <option key={size} value={size}>{size} students per team</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-muted-soft">Academic Year Filter</label>
                        <select
                          value={selectedYear}
                          onChange={(e) => setSelectedYear(e.target.value)}
                          className="w-full h-11 px-4 rounded-xl border border-[var(--border)] text-heading text-sm focus:outline-none focus:border-amber-500/60 focus:ring-2 focus:ring-amber-400/20 transition-all inp"
                        >
                          <option value="ALL">All Years</option>
                          <option value="2nd Year">2nd Year</option>
                          <option value="3rd Year">3rd Year</option>
                          <option value="4th Year">4th Year</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-muted-soft">Department Filter</label>
                        <select
                          value={selectedDept}
                          onChange={(e) => { const v = e.target.value; setSelectedDept(v); if (v !== "CSE") setSelectedSection("ALL"); }}
                          className="w-full h-11 px-4 rounded-xl border border-[var(--border)] text-heading text-sm focus:outline-none focus:border-amber-500/60 focus:ring-2 focus:ring-amber-400/20 transition-all inp"
                        >
                          <option value="ALL">All Departments</option>
                          <option value="IT">IT</option>
                          <option value="CSE">CSE</option>
                          <option value="AI&DS">AI&DS</option>
                          <option value="MECH">MECH</option>
                          <option value="CIVIL">CIVIL</option>
                          <option value="ECE">ECE</option>
                          <option value="EEE">EEE</option>
                        </select>
                      </div>
                      {selectedDept === "CSE" && (
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-muted-soft">Section Filter</label>
                          <select
                            value={selectedSection}
                            onChange={(e) => setSelectedSection(e.target.value)}
                            className="w-full h-11 px-4 rounded-xl border border-[var(--border)] text-heading text-sm focus:outline-none focus:border-amber-500/60 focus:ring-2 focus:ring-amber-400/20 transition-all inp"
                          >
                            <option value="ALL">All Sections</option>
                            <option value="A">Section A</option>
                            <option value="B">Section B</option>
                          </select>
                        </div>
                      )}
                    </div>

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
                          <p className="text-xs text-muted-soft">Status: {sess.status} Â· {sess.participant_count || 0} participants Â· {sess.team_count || 0} teams</p>
                          {(sess.department || sess.year) && (
                            <p className="text-xs text-amber-400 mt-1">Filters: {sess.year || "All Years"} Â· {sess.department || "All Depts"} {sess.section ? `Â· Sec ${sess.section}` : ""}</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button onClick={() => { setGdLiveAdminViewCode(sess.session_code); loadGdLiveParticipants(sess.session_code); setView("gd-live-admin-view"); }} disabled={loading} variant="secondary" className="text-xs">
                            View Room
                          </Button>
                          <Button onClick={() => exportAttendance(sess.session_code)} variant="secondary" className="text-xs">
                            Export Attendance
                          </Button>
                          {sess.status !== "waiting" && (
                            <>
                              <Button onClick={() => loadGdLiveLeaderboard(sess.session_code)} disabled={loading} variant="secondary" className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-xs">
                                <Trophy className="w-3 h-3 mr-1" /> Leaderboard
                              </Button>
                              <Button onClick={() => exportEvaluations(sess.session_code)} variant="secondary" className="text-xs bg-purple-500/20 text-purple-300 border-purple-500/30">
                                Export Evaluation
                              </Button>
                            </>
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
                                <th className="pb-2 pr-2">Transcript</th>
                              </tr>
                            </thead>
                            <tbody>
                              {gdLiveLeaderboard.map((entry, idx) => (
                                <tr key={entry.user_id} className={`hover:surface-2 ${idx === 0 ? "bg-amber-500/10" : ""}`}>
                                  <td className="py-2 pr-2">
                                    <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold ${idx === 0 ? "bg-amber-500 text-heading" : idx === 1 ? "bg-slate-400 text-heading" : idx === 2 ? "bg-orange-500 text-heading" : "surface-2 text-body"}`}>{idx + 1}</span>
                                  </td>
                                  <td className="py-2 pr-2 text-heading font-medium">{entry.name}</td>
                                  <td className="py-2 pr-2 text-body hidden md:table-cell">{entry.register_number}</td>
                                  <td className="py-2 pr-2 text-amber-300 font-mono">{entry.team_number}</td>
                                  <td className="py-2 pr-2 text-purple-300">{entry.anonymous_label || "-"}</td>
                                  <td className="py-2 pr-2 text-emerald-300 font-semibold">{(entry.overall_score != null ? Number(entry.overall_score) : 0).toFixed(1)}</td>
                                  <td className="py-2 pr-2 font-semibold">
                                    <div className="flex items-center gap-2">
                                      <details className="cursor-pointer flex-1">
                                        <summary className="text-amber-300 hover:text-amber-200 text-xs">View</summary>
                                        <p className="mt-1 text-muted-soft whitespace-pre-wrap max-w-xs">{entry.transcript || "N/A"}</p>
                                      </details>
                                      <Button
                                        onClick={async () => {
                                          setLoading(true);
                                          try {
                                            await downloadGdLivePdfReport(sess.session_code, entry.user_id, token);
                                            setSuccess(`PDF Report downloaded!`);
                                          } catch (err: any) {
                                            setMessage(err.message);
                                          } finally {
                                            setLoading(false);
                                          }
                                        }}
                                        variant="ghost"
                                        className="h-6 px-1.5 py-0 text-[10px] text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 font-bold border border-indigo-500/20 rounded"
                                      >
                                        PDF
                                      </Button>
                                    </div>
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

              {adminSubTab === "students" && (
                <div className="space-y-6">
                  {/* Excel Import Card */}
                  <div className="card p-6">
                    <h3 className="text-base font-semibold text-heading mb-3 flex items-center gap-2"><Upload className="w-5 h-5 text-indigo-400" /> Excel Student Import</h3>
                    <p className="text-xs text-muted-soft mb-4">
                      Upload an Excel spreadsheet containing students details. The Excel sheet should contain columns for: <code className="text-indigo-300">Student_Name</code>, <code className="text-indigo-300">Register_No</code>, <code className="text-indigo-300">Email</code>, <code className="text-indigo-300">Year</code>, <code className="text-indigo-300">Dept</code>, and optional <code className="text-indigo-300">Sec</code>.
                    </p>
                    <div className="flex items-center gap-3">
                      <label className="btn-primary px-4 py-2 cursor-pointer rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold text-sm">
                        Select Excel File
                        <input type="file" accept=".xlsx, .xls" onChange={handleExcelUpload} className="hidden" />
                      </label>
                      <Button onClick={() => {
                        setEditingStudent(null);
                        setStudentForm({ name: "", email: "", password: "Password123", register_number: "", department: "IT", year: "2nd Year", section: "A" });
                        setStudentModalOpen(true);
                      }} variant="secondary" className="text-sm">
                        Add Single Student
                      </Button>
                    </div>
                  </div>

                  {/* Student Directory Table */}
                  <div className="card p-6">
                    <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                      <h3 className="text-base font-semibold text-heading">Student Directory</h3>
                      <span className="text-xs text-muted-soft bg-[var(--surface-2)]/50 px-2.5 py-1 rounded-full border border-[var(--border)]/10 font-medium">
                        Showing {
                          studentList.filter((stud) => {
                            const matchDept = optDirDept === "ALL" || (stud.department && stud.department.toUpperCase() === optDirDept.toUpperCase());
                            const matchYear = optDirYear === "ALL" || (
                              (optDirYear === "1" && (stud.year?.includes("1") || stud.year?.toLowerCase().includes("first"))) ||
                              (optDirYear === "2" && (stud.year?.includes("2") || stud.year?.toLowerCase().includes("second"))) ||
                              (optDirYear === "3" && (stud.year?.includes("3") || stud.year?.toLowerCase().includes("third"))) ||
                              (optDirYear === "4" && (stud.year?.includes("4") || stud.year?.toLowerCase().includes("fourth") || stud.year?.toLowerCase().includes("final")))
                            );
                            const matchSec = optDirSec === "ALL" || (stud.section && stud.section.toUpperCase() === optDirSec.toUpperCase());
                            return matchDept && matchYear && matchSec;
                          }).length
                        } of {studentList.length} Students
                      </span>
                    </div>

                    {/* Filters Bar */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6 p-4 rounded-lg bg-[var(--surface-2)]/30 border border-[var(--border)]/10">
                      <div>
                        <label className="block text-xs font-semibold text-muted-soft mb-1">Academic Year</label>
                        <select
                          value={optDirYear}
                          onChange={(e) => setOptDirYear(e.target.value)}
                          className="w-full h-10 px-3 rounded-lg bg-[var(--background)] border border-[var(--border)]/30 text-heading text-sm focus:border-indigo-500 focus:outline-none"
                        >
                          <option value="ALL">All Years</option>
                          <option value="1">1st Year</option>
                          <option value="2">2nd Year</option>
                          <option value="3">3rd Year</option>
                          <option value="4">4th Year</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-muted-soft mb-1">Department</label>
                        <select
                          value={optDirDept}
                          onChange={(e) => { const v = e.target.value; setOptDirDept(v); if (v !== "CSE") setOptDirSec("ALL"); }}
                          className="w-full h-10 px-3 rounded-lg bg-[var(--background)] border border-[var(--border)]/30 text-heading text-sm focus:border-indigo-500 focus:outline-none"
                        >
                          <option value="ALL">All Departments</option>
                          <option value="CSE">CSE</option>
                          <option value="IT">IT</option>
                          <option value="AI&DS">AI&DS</option>
                          <option value="ECE">ECE</option>
                          <option value="EEE">EEE</option>
                          <option value="MECH">MECH</option>
                          <option value="CIVIL">CIVIL</option>
                        </select>
                      </div>

                      {optDirDept === "CSE" && (
                        <div>
                          <label className="block text-xs font-semibold text-muted-soft mb-1">Section</label>
                          <select
                            value={optDirSec}
                            onChange={(e) => setOptDirSec(e.target.value)}
                            className="w-full h-10 px-3 rounded-lg bg-[var(--background)] border border-[var(--border)]/30 text-heading text-sm focus:border-indigo-500 focus:outline-none"
                          >
                            <option value="ALL">All Sections</option>
                            <option value="A">Section A</option>
                            <option value="B">Section B</option>
                          </select>
                        </div>
                      )}
                    </div>

                    <div className="overflow-x-auto">
                      <table className="ent-table">
                        <thead>
                          <tr>
                            <th className="pb-2 pr-2 text-left">Name</th>
                            <th className="pb-2 pr-2 text-left font-mono">Register No</th>
                            <th className="pb-2 pr-2 text-left">Department</th>
                            <th className="pb-2 pr-2 text-left">Year</th>
                            <th className="pb-2 pr-2 text-left">Section</th>
                            <th className="pb-2 pr-2 text-left">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {studentList
                            .filter((stud) => {
                              const matchDept = optDirDept === "ALL" || (stud.department && stud.department.toUpperCase() === optDirDept.toUpperCase());
                              const matchYear = optDirYear === "ALL" || (
                                (optDirYear === "1" && (stud.year?.includes("1") || stud.year?.toLowerCase().includes("first"))) ||
                                (optDirYear === "2" && (stud.year?.includes("2") || stud.year?.toLowerCase().includes("second"))) ||
                                (optDirYear === "3" && (stud.year?.includes("3") || stud.year?.toLowerCase().includes("third"))) ||
                                (optDirYear === "4" && (stud.year?.includes("4") || stud.year?.toLowerCase().includes("fourth") || stud.year?.toLowerCase().includes("final")))
                              );
                              const matchSec = optDirSec === "ALL" || (stud.section && stud.section.toUpperCase() === optDirSec.toUpperCase());
                              return matchDept && matchYear && matchSec;
                            })
                            .map((stud) => (
                              <tr key={stud.id} className="hover:surface-2 border-b border-[var(--border)]/30">
                                <td className="py-2.5 pr-2 text-heading font-medium">{stud.name}</td>
                                <td className="py-2.5 pr-2 text-body font-mono">{stud.register_number}</td>
                                <td className="py-2.5 pr-2 text-body">{stud.department || "-"}</td>
                                <td className="py-2.5 pr-2 text-body">{stud.year || "-"}</td>
                                <td className="py-2.5 pr-2 text-body font-bold text-amber-400">{stud.section || "-"}</td>
                                <td className="py-2.5 pr-2">
                                  <div className="flex gap-2">
                                    <button onClick={() => {
                                      setEditingStudent(stud);
                                      setStudentForm({
                                        name: stud.name,
                                        email: stud.email || "",
                                        password: "",
                                        register_number: stud.register_number,
                                        department: stud.department || "IT",
                                        year: stud.year || "2nd Year",
                                        section: stud.section || "A"
                                      });
                                      setStudentModalOpen(true);
                                    }} className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold">
                                      Edit
                                    </button>
                                    <button onClick={() => deleteStudent(stud.id)} className="text-xs text-red-400 hover:text-red-300 font-semibold">
                                      Delete
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          {studentList.filter((stud) => {
                            const matchDept = optDirDept === "ALL" || (stud.department && stud.department.toUpperCase() === optDirDept.toUpperCase());
                            const matchYear = optDirYear === "ALL" || (
                              (optDirYear === "1" && (stud.year?.includes("1") || stud.year?.toLowerCase().includes("first"))) ||
                              (optDirYear === "2" && (stud.year?.includes("2") || stud.year?.toLowerCase().includes("second"))) ||
                              (optDirYear === "3" && (stud.year?.includes("3") || stud.year?.toLowerCase().includes("third"))) ||
                              (optDirYear === "4" && (stud.year?.includes("4") || stud.year?.toLowerCase().includes("fourth") || stud.year?.toLowerCase().includes("final")))
                            );
                            const matchSec = optDirSec === "ALL" || (stud.section && stud.section.toUpperCase() === optDirSec.toUpperCase());
                            return matchDept && matchYear && matchSec;
                          }).length === 0 && (
                              <tr>
                                <td colSpan={6} className="py-8 text-center text-muted-soft text-sm">No students registered yet matching these criteria.</td>
                              </tr>
                            )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {adminSubTab === "analytics" && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="card p-5 surface-2">
                    <h3 className="text-xs text-muted-soft uppercase font-bold tracking-wider mb-1">Total Registered Students</h3>
                    <p className="text-3xl font-extrabold text-heading">{studentList.length}</p>
                  </div>
                  <div className="card p-5 surface-2">
                    <h3 className="text-xs text-muted-soft uppercase font-bold tracking-wider mb-1">Active Departments</h3>
                    <p className="text-3xl font-extrabold text-heading">{departmentList.length || 4}</p>
                  </div>
                  <div className="card p-5 surface-2">
                    <h3 className="text-xs text-muted-soft uppercase font-bold tracking-wider mb-1">Total Live Sessions</h3>
                    <p className="text-3xl font-extrabold text-heading">{gdLiveSessions.length}</p>
                  </div>
                </div>
              )}

              {/* Student Form Modal */}
              {studentModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                  <div className="card w-full max-w-md p-6 animate-scaleUp">
                    <h3 className="text-lg font-bold text-heading mb-4">{editingStudent ? "Edit Student Details" : "Add New Student"}</h3>
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-muted-soft">Name</label>
                        <input
                          type="text"
                          value={studentForm.name}
                          onChange={(e) => setStudentForm({ ...studentForm, name: e.target.value })}
                          className="w-full h-10 px-3 rounded-lg border border-[var(--border)] text-heading text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/30 transition-all inp"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-muted-soft">Email</label>
                        <input
                          type="email"
                          value={studentForm.email}
                          onChange={(e) => setStudentForm({ ...studentForm, email: e.target.value })}
                          className="w-full h-10 px-3 rounded-lg border border-[var(--border)] text-heading text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/30 transition-all inp"
                        />
                      </div>
                      {!editingStudent && (
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-muted-soft">Password</label>
                          <input
                            type="password"
                            placeholder="Password123"
                            value={studentForm.password}
                            onChange={(e) => setStudentForm({ ...studentForm, password: e.target.value })}
                            className="w-full h-10 px-3 rounded-lg border border-[var(--border)] text-heading text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/30 transition-all inp"
                          />
                        </div>
                      )}
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-muted-soft">Register Number</label>
                        <input
                          type="text"
                          value={studentForm.register_number}
                          onChange={(e) => setStudentForm({ ...studentForm, register_number: e.target.value })}
                          className="w-full h-10 px-3 rounded-lg border border-[var(--border)] text-heading text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400/30 transition-all inp"
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-muted-soft">Dept</label>
                          <select
                            value={studentForm.department}
                            onChange={(e) => { const v = e.target.value; setStudentForm({ ...studentForm, department: v, ...(v !== "CSE" ? { section: "A" } : {}) }); }}
                            className="w-full h-10 px-2 rounded-lg border border-[var(--border)] text-heading text-xs focus:outline-none transition-all inp"
                          >
                            <option value="IT">IT</option>
                            <option value="CSE">CSE</option>
                            <option value="AI&DS">AI&DS</option>
                            <option value="MECH">MECH</option>
                            <option value="CIVIL">CIVIL</option>
                            <option value="ECE">ECE</option>
                            <option value="EEE">EEE</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-muted-soft">Year</label>
                          <select
                            value={studentForm.year}
                            onChange={(e) => setStudentForm({ ...studentForm, year: e.target.value })}
                            className="w-full h-10 px-2 rounded-lg border border-[var(--border)] text-heading text-xs focus:outline-none transition-all inp"
                          >
                            <option value="2nd Year">2nd Year</option>
                            <option value="3rd Year">3rd Year</option>
                            <option value="4th Year">4th Year</option>
                          </select>
                        </div>
                        {studentForm.department === "CSE" && (
                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-muted-soft">Section</label>
                            <select
                              value={studentForm.section}
                              onChange={(e) => setStudentForm({ ...studentForm, section: e.target.value })}
                              className="w-full h-10 px-2 rounded-lg border border-[var(--border)] text-heading text-xs focus:outline-none transition-all inp"
                            >
                              <option value="A">Sec A</option>
                              <option value="B">Sec B</option>
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-end gap-3 mt-6">
                      <Button onClick={() => { setStudentModalOpen(false); setEditingStudent(null); }} variant="secondary" className="text-sm">Cancel</Button>
                      <Button onClick={saveStudent} className="bg-gradient-to-r from-indigo-500 to-purple-600 border-0 text-sm">Save</Button>
                    </div>
                  </div>
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
                    <h2 className="text-xl font-bold text-heading flex items-center gap-2"><Users className="w-6 h-6 text-amber-400" /> Waiting Room</h2>
                    <div className="flex flex-col sm:flex-row gap-x-4 gap-y-1 mt-1.5 text-xs text-muted-soft">
                      <p>OTP : <code className="font-mono font-bold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded text-sm tracking-wider">{gdLiveAdminViewCode}</code></p>
                      <p className="flex items-center gap-3">
                        <span className="text-emerald-400 font-bold">Joined : {joinedParticipants.length}</span>
                        <span className="text-slate-600">•</span>
                        <span className="text-slate-400 font-bold">Not Joined : {notJoinedCount}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 items-center">
                    {gdLiveIsLiveMeeting ? (
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-red-500 px-3 h-11 rounded-xl surface-2 border border-red-500/40">
                          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" /> LIVE — Meeting in progress
                        </span>
                        <Button onClick={() => hostGdLiveRoom(gdLiveAdminViewCode)} disabled={loading} variant="secondary" className="h-11 text-xs">
                          Re-Host / Re-assign Teams
                        </Button>
                      </div>
                    ) : (
                      <Button 
                        onClick={() => hostGdLiveRoom(gdLiveAdminViewCode)} 
                        disabled={loading || joinedParticipants.length < 2} 
                        className="btn-primary h-11 text-sm font-bold shadow-lg flex items-center gap-2 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-500 hover:to-teal-600"
                      >
                        <Radio className="w-4 h-4 animate-pulse" /> 
                        {loading ? "Allocating Teams..." : joinedParticipants.length < 2 ? "Waiting for Participants (Need 2+)" : "Start GD"}
                      </Button>
                    )}
                    <Button onClick={() => loadGdLiveParticipants(gdLiveAdminViewCode)} disabled={loading} variant="secondary" className="text-sm">
                      <RefreshCw className="w-4 h-4 mr-1" /> Refresh
                    </Button>
                    <Button onClick={() => { setView("gd-live-admin"); loadGdLiveSessions(); }} variant="secondary" className="text-sm">
                      Back to Admin
                    </Button>
                  </div>
                </div>

                {joinedParticipants.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-muted-soft text-sm font-semibold">No participants have joined yet.</p>
                    <p className="text-muted-soft text-xs mt-1">Waiting for students to enter the OTP...</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {joinedParticipants.map((p: any) => (
                      <div key={p.user_id} className="card p-5 hover:card-hover">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                              {(p.name || "?").split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-heading truncate">{p.name}</p>
                              <p className="text-xs text-muted-soft truncate">{p.department || "-"} Â· {p.year || "-"}</p>
                            </div>
                          </div>
                          <span className={`text-xs px-2.5 py-0.5 rounded-full shrink-0 font-bold ${
                            p.status === "completed" 
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" 
                              : p.status === "assigned" 
                              ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30" 
                              : "bg-teal-500/20 text-teal-300 border border-teal-500/30"
                          }`}>
                            {p.status === "joined" ? "Joined" : p.status === "assigned" ? "Assigned" : p.status}
                          </span>
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
                onParticipantsUpdate={(parts) => setWaitingRoomParticipants(parts)}
              />
              <StudentLivePoller
                code={gdLiveSession.session_code}
                token={token}
                onStart={(topic, members, teams) => enterGdLiveRoom(gdLiveSession.session_code, topic, members, teams)}
                onParticipantsUpdate={(parts) => setWaitingRoomParticipants(parts)}
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
                  <span className={`w-2 h-2 rounded-full ${gdLiveWsConnected ? "bg-emerald-500" : "bg-red-500 animate-pulse"}`} />
                  <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
                  <span className="text-base font-semibold">
                    {gdLiveWsConnected
                      ? "Waiting for Host to Start Discussion..."
                      : "Connecting to session server..."}
                  </span>
                </div>
                {gdLiveWsError && (
                  <p className="text-xs text-red-500 mt-3">{gdLiveWsError}</p>
                )}

                {waitingRoomParticipants.length > 0 ? (
                  <div className="mt-8 border-t border-[var(--border)] pt-6 text-left">
                    <h3 className="text-xs font-bold text-heading uppercase tracking-wider mb-4 flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-indigo-400" /> Joined Participants ({waitingRoomParticipants.length})
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {waitingRoomParticipants.map((p: any) => (
                        <div key={p.user_id || p.id} className="flex items-center gap-2.5 p-3 rounded-xl border border-[var(--border)] bg-slate-900/10 dark:bg-slate-900/50">
                          <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white text-[9px] font-bold">
                            {(p.name || "?")[0].toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-heading truncate">{p.name}</p>
                            <p className="text-[10px] text-muted-soft truncate">{p.department || "-"} Â· {p.year || "-"}</p>
                          </div>
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" title="Joined" />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-8 border-t border-[var(--border)] pt-6 text-center">
                    <p className="text-xs text-muted-soft">Waiting for other participants to connect...</p>
                  </div>
                )}

                <p className="text-xs text-muted-soft mt-6">
                  The discussion room opens automatically the moment the host starts â€” no refresh needed.
                </p>
              </div>
            </div>
          )}

          {tabSwitchWarning && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 ">
              <div className="[background:var(--input-bg)] border border-red-500/40 rounded-2xl p-6 max-w-sm mx-4 shadow-2xl text-center">
                <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
                <h3 className="text-lg font-bold text-heading mb-2">Stay Focused!</h3>
                <p className="text-sm text-body mb-4">You left the session tab. Please return to the MZ ThinkCircle tab immediately to continue your assessment.</p>
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
                    "Avoid excessive filler words such as \"um\", \"uh\", and \"like\".",
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
