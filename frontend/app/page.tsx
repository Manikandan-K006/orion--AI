"use client";

import { AlertCircle, Award, Clock, LogOut, MessageSquare, Mic, MicOff, Trophy, Users, Zap, Loader2, Copy, Check, Target, TrendingUp, ArrowUp, ArrowDown, Sparkles, Menu, X, Shield, Sun, Moon, RefreshCw, Video, VideoOff, Hand, MessageCircle, Maximize, PhoneOff, Radio, CheckCircle2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import GdLiveRoom from "@/components/GdLiveRoom";
import { useGdLiveWs, GDLiveWsMessage } from "@/lib/useGdLiveWs";
import { AllTimeAchiever, ComprehensiveLeaderboard, GDLiveEvaluation, GDLiveLeaderboardEntry, GDLiveTeamStatus, LeaderboardRanking, LeaderboardStats, Progress, SoloQuote, SoloStartResponse, SoloSubmitResponse, User, apiRequest, hostGdLiveMeeting, endGdLiveMeeting, getGdLiveState } from "@/lib/api";

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

type PageView = "login" | "dashboard" | "gd-leaderboard" | "solo-practice" | "solo-session" | "solo-result" | "gd-live" | "gd-live-session" | "gd-live-results" | "gd-live-admin" | "gd-live-admin-view" | "gd-live-room";

/** Student-side waiter: opens a WebSocket to the session and auto-redirects into the
 *  live room when the admin hosts the meeting (SESSION_STARTED broadcast). */
function StudentLiveWaiter({ code, token, onStart }: { code: string; token: string; onStart: (topic: string | null, members: any[]) => void }) {
  const { subscribe } = useGdLiveWs(code, token);
  useEffect(() => {
    const unsub = subscribe((msg: GDLiveWsMessage) => {
      if (msg.event === "SESSION_STARTED") {
        onStart(msg.payload?.topic ?? null, msg.payload?.members ?? []);
      }
    });
    return unsub;
  }, [subscribe, onStart]);
  return null;
}

/** Student-side polling fallback: if the WebSocket SESSION_STARTED event is
 *  missed (e.g. reconnect), poll the live-state and redirect when the session
 *  becomes "live". No manual refresh required. */
function StudentLivePoller({ code, token, onStart }: { code: string; token: string; onStart: (topic: string | null, members: any[]) => void }) {
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const st = await getGdLiveState(code, token);
        if (!active) return;
        if (st.status === "live") {
          onStart(st.topic ?? null, st.members || []);
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
        <button onClick={() => send("PAUSE_GD", {})} disabled={paused} className="btn-secondary text-xs h-10 px-3">Pause GD</button>
        <button onClick={() => send("RESUME_GD", {})} disabled={!paused} className="btn-secondary text-xs h-10 px-3">Resume GD</button>
        <button onClick={() => send("NEXT_ROUND", {})} className="btn-secondary text-xs h-10 px-3">Next Round</button>
        <button onClick={() => send("NEXT_SPEAKER", {})} className="btn-secondary text-xs h-10 px-3">Next Speaker</button>
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
  const [loading, setLoading] = useState(false);

  const [studentRegisterNumber, setStudentRegisterNumber] = useState("");
  const [studentPassword, setStudentPassword] = useState("");
  const [adminRegisterNumber, setAdminRegisterNumber] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [loginTab, setLoginTab] = useState<"student" | "admin">("student");
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
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
  const [isSessionLocked, setIsSessionLocked] = useState(false);
  const [tabSwitchWarning, setTabSwitchWarning] = useState(false);
  const lockWarningRef = useRef<boolean>(false);

  // GD Live state
  const [gdLiveCode, setGdLiveCode] = useState("");
  const [gdLiveJoined, setGdLiveJoined] = useState(false);
  const [gdLiveSession, setGdLiveSession] = useState<{ session_code: string; status: string; participant_count: number; team_count: number } | null>(null);
  const [gdLiveMyTeam, setGdLiveMyTeam] = useState<{ team_number: number; topic: string; team_status: string; members: string[] } | null>(null);
  const [gdLiveSessions, setGdLiveSessions] = useState<any[]>([]);
  const [gdLiveParticipants, setGdLiveParticipants] = useState<any[]>([]);
  const [gdLiveCreatedCode, setGdLiveCreatedCode] = useState("");
  const [gdLivePrepSeconds, setGdLivePrepSeconds] = useState(0);
  const [gdLiveSpeakSeconds, setGdLiveSpeakSeconds] = useState(0);
  const [gdLiveIsPrepPhase, setGdLiveIsPrepPhase] = useState(false);
  const [gdLiveIsSpeakingPhase, setGdLiveIsSpeakingPhase] = useState(false);
  const [gdLiveTeamStatus, setGdLiveTeamStatus] = useState<GDLiveTeamStatus | null>(null);
  const [gdLiveMyResult, setGdLiveMyResult] = useState<GDLiveEvaluation | null>(null);
  const [gdLiveLeaderboard, setGdLiveLeaderboard] = useState<GDLiveLeaderboardEntry[]>([]);
  const [gdLiveLeaderboardViewCode, setGdLiveLeaderboardViewCode] = useState("");
  const [gdLiveAdminViewCode, setGdLiveAdminViewCode] = useState("");
  const [soloRulesOpen, setSoloRulesOpen] = useState(false);
  const [gdRulesOpen, setGdRulesOpen] = useState(false);

  // Live GD room state
  const [gdLiveRoomCode, setGdLiveRoomCode] = useState("");
  const [gdLiveRoomTopic, setGdLiveRoomTopic] = useState("");
  const [gdLiveRoomMembers, setGdLiveRoomMembers] = useState<any[]>([]);
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

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  async function loadProfile(t: string) {
    try {
      const profile = await apiRequest<User>("/profile", {}, t);
      setUser(profile);
      setView("dashboard");
      const p = await apiRequest<Progress>("/progress", {}, t).catch(() => null);
      if (p) setProgress(p);
    } catch { localStorage.removeItem("mzgd_token"); setView("login"); }
  }

  async function handleLogin() {
    const rn = loginTab === "student" ? studentRegisterNumber : adminRegisterNumber;
    const pw = loginTab === "student" ? (studentPassword || "Password123") : adminPassword;
    if (!rn.trim()) { setMessage("Enter your register number / SPR number"); return; }
    setLoading(true); setMessage(""); setSuccess("");
    try {
      const res = await apiRequest<{ access_token: string; user: User }>("/login/register-number", {
        method: "POST",
        body: JSON.stringify({ register_number: rn, password: loginTab === "student" ? (pw || "Password123") : pw })
      });
      localStorage.setItem("mzgd_token", res.access_token);
      setToken(res.access_token);
      await loadProfile(res.access_token);
    } catch (err: any) {
      setMessage(err.message || "Login failed");
    } finally { setLoading(false); }
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
          const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001"}/interviews/upload-audio`, {
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
    } catch {}
  }

  async function createGdLiveSession() {
    setLoading(true);
    try {
      const res = await apiRequest<{ session_code: string }>("/gd-live/sessions", { method: "POST" }, token);
      setGdLiveCreatedCode(res.session_code);
      setSuccess(`GD Live session created! Code: ${res.session_code}`);
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
      // Load team / topic immediately
      await loadGdLiveTeamInfo(code);
    } catch (err: any) { setMessage(err.message); }
    finally { setLoading(false); }
  }

  async function loadGdLiveTeamInfo(code: string) {
    // Poll for team assignment + status. For a HOSTED (live) meeting we must NOT
    // start the old prep/speak recording flow — the live discussion room is opened
    // via the WebSocket / poller redirect. Only start prep for the classic team GD.
    const poll = setInterval(async () => {
      try {
        const team = await apiRequest<any>(`/gd-live/sessions/${code}/my-team`, {}, token);
        if (team && team.team_number) {
          setGdLiveMyTeam(team);
          if (gdLiveIsLiveMeeting) {
            clearInterval(poll);
            return;
          }
          if (team.team_status === "active" && team.status !== "completed" && !gdLiveIsPrepPhase && !gdLiveIsSpeakingPhase && !gdLiveIsLiveMeeting) {
            clearInterval(poll);
            startGdLivePrep(team);
          }
          if (team.team_status === "completed" || team.status === "completed") {
            clearInterval(poll);
          }
        }
      } catch {}
    }, 2000);
  }

  function startGdLivePrep(teamArg?: any) {
    const team = teamArg || gdLiveMyTeam;
    if (!team) { setMessage("Wait for team assignment first"); return; }
    // Never start the prep/speak recording flow for a hosted (live) meeting.
    if (gdLiveIsLiveMeeting) return;
    setGdLiveIsPrepPhase(true);
    setGdLivePrepSeconds(180);
    setIsSessionLocked(true);
    setTranscript("");
    setGdLiveIsSpeakingPhase(false);
    setSuccess("You have 3 minutes to prepare. Think about the topic and organize your thoughts.");
    speak("You have 3 minutes to prepare. Think about the topic and organize your thoughts.");
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setGdLivePrepSeconds(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          setGdLiveIsPrepPhase(false);
          setGdLiveIsSpeakingPhase(true);
          setGdLiveSpeakSeconds(600);
          setSuccess("Preparation time over! Start speaking now. You have 10 minutes (finish early anytime).");
          speak("Preparation time over. Start speaking now. You have 10 minutes.");
          // Speaking countdown
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = setInterval(() => {
            setGdLiveSpeakSeconds(s => {
              if (s <= 1) {
                clearInterval(timerRef.current!);
                if (transcript.trim()) { submitGdLiveAndEvaluate(); }
                else { setSuccess("Time is up. Please submit your speech."); }
                return 0;
              }
              return s - 1;
            });
          }, 1000);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  async function assignGdLiveTeams(sessionCode: string) {
    setLoading(true);
    try {
      const res = await apiRequest<{ teams: any[]; message: string }>(`/gd-live/sessions/${sessionCode}/assign-teams`, { method: "POST" }, token);
      setSuccess(res.message);
      await loadGdLiveSessions();
      await loadGdLiveParticipants(sessionCode);
    } catch (err: any) { setMessage(err.message); }
    finally { setLoading(false); }
  }

  async function startGdLiveAll(sessionCode: string) {
    setLoading(true);
    try {
      const res = await apiRequest<{ message: string; teams: any[]; prep_seconds: number; speak_seconds: number }>(
        `/gd-live/sessions/${sessionCode}/start-all`, { method: "POST" }, token);
      setSuccess(res.message);
      await loadGdLiveSessions();
      await loadGdLiveParticipants(sessionCode);
    } catch (err: any) { setMessage(err.message); }
    finally { setLoading(false); }
  }

  async function startGdLiveMeeting(sessionCode: string) {
    setLoading(true);
    try {
      const res = await apiRequest<{ message: string; teams: any[]; prep_seconds: number; speak_seconds: number }>(
        `/gd-live/sessions/${sessionCode}/start-meeting`, { method: "POST" }, token);
      setSuccess(res.message);
      await loadGdLiveSessions();
      await loadGdLiveParticipants(sessionCode);
    } catch (err: any) { setMessage(err.message); }
    finally { setLoading(false); }
  }

  // ─── Live GD Room helpers ───
  function openGdLiveRoom() {
    if (!gdLiveAdminViewCode) return;
    setGdLiveRoomCode(gdLiveAdminViewCode);
    setView("gd-live-room");
  }

  function enterGdLiveRoom(code: string, topic: string | null, members: any[]) {
    const t0 = performance.now();
    setGdLivePerf((p) => ({ ...p, studentReceivedStart: t0 }));
    console.timeStamp?.("student:enterGdLiveRoom");
    setGdLiveRoomCode(code);
    setGdLiveRoomTopic(topic || "");
    setGdLiveRoomMembers(members || []);
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
    try { await endGdLiveMeeting(sessionCode, token); } catch {}
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
    } catch {}
  }

  async function startGdLiveTeam(sessionCode: string, teamNumber: number) {
    setLoading(true);
    try {
      await apiRequest(`/gd-live/sessions/${sessionCode}/start-team/${teamNumber}`, { method: "POST" }, token);
      setSuccess(`Team ${teamNumber} started!`);
      await loadGdLiveSessions();
    } catch (err: any) { setMessage(err.message); }
    finally { setLoading(false); }
  }

  async function submitGdLiveAndEvaluate() {
    if (!gdLiveMyTeam || !gdLiveSession || !transcript.trim()) { setMessage("Write your transcript first"); return; }
    setLoading(true);
    try {
      const res = await apiRequest<{ message: string; all_completed: boolean; evaluation: GDLiveEvaluation }>(
        `/gd-live/sessions/${gdLiveSession.session_code}/submit-and-evaluate`,
        { method: "POST", body: JSON.stringify({ transcript }) }, token);
      setGdLiveMyResult(res.evaluation);
      setSuccess(res.message);
      speak("Transcript submitted and evaluated.");
      if (timerRef.current) clearInterval(timerRef.current);
      setGdLiveIsPrepPhase(false);
      setGdLiveIsSpeakingPhase(false);
      setIsSessionLocked(false);
      if (res.all_completed) {
        setSuccess("All team members completed! Redirecting to results...");
        // small delay then show results
        setTimeout(() => setView("gd-live-results"), 1500);
      } else {
        // Start polling for team completion
        setSuccess("Transcript submitted! Waiting for team members to finish...");
        const poll = setInterval(async () => {
          try {
            const status = await apiRequest<GDLiveTeamStatus>(
              `/gd-live/sessions/${gdLiveSession.session_code}/my-team-status`, {}, token);
            setGdLiveTeamStatus(status);
            if (status.all_completed) {
              clearInterval(poll);
              setSuccess("All team members completed! Viewing results.");
              setView("gd-live-results");
            }
          } catch {}
        }, 3000);
      }
    } catch (err: any) { setMessage(err.message); }
    finally { setLoading(false); }
  }

  async function loadGdLiveTeamStatus() {
    if (!gdLiveSession) return;
    try {
      const status = await apiRequest<GDLiveTeamStatus>(
        `/gd-live/sessions/${gdLiveSession.session_code}/my-team-status`, {}, token);
      setGdLiveTeamStatus(status);
    } catch {}
  }

  async function loadGdLiveMyResult() {
    if (!gdLiveSession) return;
    try {
      const res = await apiRequest<GDLiveEvaluation>(
        `/gd-live/sessions/${gdLiveSession.session_code}/my-result`, {}, token);
      setGdLiveMyResult(res);
    } catch {}
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

  if (!user) {
  if (view === "gd-live-room" && gdLiveRoomCode) {
    return (
      <GdLiveRoom
        sessionCode={gdLiveRoomCode}
        token={token}
        user={user}
        initialTopic={gdLiveRoomTopic}
        initialMembers={gdLiveRoomMembers}
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
        onEnd={endGdLiveRoom}
      />
    );
  }

  return (
    <div className={`min-h-screen flex items-center justify-center relative overflow-hidden ${theme === "dark" ? "dark" : ""}`} style={{ background: "var(--bg)" }}>
        {/* Theme toggle */}
        <button onClick={toggleTheme} className="fixed top-4 right-4 z-20 p-2.5 rounded-xl btn-secondary">
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
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg transition-all duration-300 ${
                  loginTab === "student" ? "btn-primary" : "text-muted-soft hover:text-heading"
                }`}
              >
                <Users className="w-4 h-4" /> Student Login
              </button>
              <button
                onClick={() => { setLoginTab("admin"); setMessage(""); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg transition-all duration-300 ${
                  loginTab === "admin" ? "btn-primary" : "text-muted-soft hover:text-heading"
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
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen flex relative overflow-hidden ${theme === "dark" ? "dark" : ""}`} style={{ background: "var(--bg)" }}>
      {/* Subtle app background accent (no image bleed) */}
      <div className="fixed inset-0 pointer-events-none" style={{ background: "radial-gradient(1200px 600px at 80% -10%, rgba(139,92,246,0.10), transparent 60%), radial-gradient(900px 500px at -10% 110%, rgba(37,99,235,0.08), transparent 60%)" }} />

      {/* Theme toggle */}
      <button onClick={toggleTheme} className="fixed top-4 right-4 z-50 p-2.5 rounded-xl btn-secondary" title="Toggle theme">
        {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
      </button>

      {/* Mobile backdrop overlay when sidebar open */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/50" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed z-30 h-full transition-all duration-300 ease-in-out flex flex-col shrink-0 surface ${theme === "dark" ? "border-r border-[#334155]" : "border-r border-[#e5e7eb]"} ${sidebarOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"}`} style={{ width: "16rem", background: "var(--surface)" }}>
        <div className="flex items-center justify-between p-4 md:p-5 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-3">
            <img src="/MZ_logo_DB.webp" alt="Mount Zion Logo" className="w-10 h-10 rounded-xl object-cover shadow-lg shrink-0" />
            <div className="truncate">
              <p className="text-sm font-bold text-heading">MZ Orator</p>
              <p className="text-xs text-muted-soft">{user.name}</p>
            </div>
          </div>
          <button className="p-2 text-muted-soft hover:text-heading hover:bg-[var(--surface-hover)] rounded-lg" onClick={() => setSidebarOpen(false)}><X className="w-5 h-5" /></button>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {[
            { icon: <Users className="w-5 h-5 shrink-0" />, label: "Dashboard", view: "dashboard" as PageView },
            ...(user?.role !== "admin" ? [
              { icon: <Zap className="w-5 h-5 shrink-0" />, label: "GD", view: "gd-live" as PageView },
              { icon: <Target className="w-5 h-5 shrink-0" />, label: "Solo Practice", view: "solo-practice" as PageView },
            ] : []),
            ...(user?.role === "admin" ? [
              { icon: <Shield className="w-5 h-5 shrink-0" />, label: "Admin", view: "gd-live-admin" as PageView },
            ] : []),
            { icon: <Trophy className="w-5 h-5 shrink-0" />, label: "Leaderboard", view: "gd-leaderboard" as PageView },
          ].filter(Boolean).map((item: { icon: React.ReactNode; label: string; view: PageView; badge?: string }) => (
            <button
              key={item.label}
              disabled={isSessionLocked}
              onClick={() => {
                if (isSessionLocked) return;
                if (item.view === "gd-leaderboard") { setView("gd-leaderboard"); loadLeaderboard(); }
                else if (item.view === "solo-practice") { setView("solo-practice"); startSoloPractice(); }
                else if (item.view === "dashboard") { setView("dashboard"); }
                else if (item.view === "gd-live") { setView("gd-live"); loadGdLiveSessions(); }
                else if (item.view === "gd-live-admin") { setView("gd-live-admin"); loadGdLiveSessions(); }
                else setView(item.view);
                setSidebarOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${view === item.view ? "bg-[rgba(139,92,246,0.12)] text-[#7c3aed] dark:text-[#a78bfa] border border-[#8b5cf6]" : "text-body hover:bg-[var(--surface-hover)] hover:text-heading"} ${isSessionLocked ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.badge && <span className="ml-auto bg-amber-500 text-heading text-xs px-2 py-0.5 rounded-full">{item.badge}</span>}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t space-y-2" style={{ borderColor: "var(--border)" }}>
          <button onClick={logout} disabled={isSessionLocked} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${isSessionLocked ? "text-slate-600 cursor-not-allowed" : "text-red-600 dark:text-red-400 hover:bg-red-500/10"}`}>
            <LogOut className="w-5 h-5 shrink-0" /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto min-h-screen">
        <div className="p-4 md:p-6 max-w-6xl mx-auto animate-fade-up">
          {/* Top bar */}
          <div className={`flex items-center justify-between mb-4 sticky top-0 z-10 py-3 -mx-4 px-4 md:px-0 md:py-3 md:mx-0 surface rounded-b-2xl`} style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
            <button onClick={() => { if (!isSessionLocked) setSidebarOpen(!sidebarOpen); }} className={`p-2 rounded-lg transition-all hover:scale-110 text-muted-soft hover:bg-[var(--surface-hover)] ${isSessionLocked ? "opacity-40 cursor-not-allowed" : ""}`} title={sidebarOpen ? "Close menu" : "Open menu"}>
              {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
            <div className="text-sm font-semibold text-heading">{view === "dashboard" ? "Dashboard" : view === "gd-leaderboard" ? "Leaderboard" : view === "solo-practice" ? "Solo Practice" : view === "solo-session" ? "Solo Session" : view === "solo-result" ? "Results" : view === "gd-live" ? "GD" : view === "gd-live-session" ? "GD Room" : view === "gd-live-results" ? "GD Results" : view === "gd-live-admin" ? "GD Admin" : ""}</div>
            <div className="w-10" /> {/* spacer */}
          </div>
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

          {/* Dashboard View */}
          {view === "dashboard" && (
            <div className="space-y-6">
              <div className="card p-6">
                <h2 className="text-lg font-semibold text-heading mb-4 flex items-center gap-2"><Zap className="w-5 h-5 text-amber-400" /> Attended GD Sessions</h2>
                {gdLiveSessions.filter(s => s.status === "completed").length === 0 ? (
                  <p className="text-muted-soft text-sm py-4 text-center">No completed sessions yet.</p>
                ) : (
                  <div className="grid gap-3">
                    {gdLiveSessions.filter((s: any) => s.status === "completed").map((s: any) => (
                      <div key={s.session_code} className="flex items-center justify-between p-3 rounded-lg surface-2 border border">
                        <div>
                          <p className="text-sm font-medium text-heading">Session <code className="font-mono text-amber-300">{s.session_code}</code></p>
                          <p className="text-xs text-muted-soft">{s.participant_count || 0} participants · {s.team_count || 0} teams</p>
                        </div>
                        <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-300">Completed</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {/* Leaderboard View */}
          {view === "gd-leaderboard" && (
            <div className="space-y-6">
              {/* Header */}
              <div className={`card p-6`}>
                <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                  <h2 className="text-xl font-bold text-heading flex items-center gap-2"><Trophy className="w-6 h-6 text-amber-400" /> Leaderboard</h2>
                  <Button onClick={() => setView("dashboard")} variant="secondary" className="text-sm">Back</Button>
                </div>
                {/* Filter Pills */}
                <div className="flex flex-wrap gap-2 mb-2">
                  <span className="text-xs text-muted-soft mr-1 self-center">Department:</span>
                  {(lbData?.departments || ["ALL"]).map(d => (
                    <button key={d} onClick={() => loadLeaderboard(d, lbYear, lbTimeframe)}
                      className={`text-xs px-3 py-1 rounded-full border transition ${lbDepartment === d ? "bg-amber-500/30 border-amber-500/50 text-amber-200" : "surface-2 border text-body hover:bg-white/10"}`}>{d}</button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 mb-2">
                  <span className="text-xs text-muted-soft mr-1 self-center">Year:</span>
                  {(lbData?.years || ["ALL"]).map(y => (
                    <button key={y} onClick={() => loadLeaderboard(lbDepartment, y, lbTimeframe)}
                      className={`text-xs px-3 py-1 rounded-full border transition ${lbYear === y ? "bg-amber-500/30 border-amber-500/50 text-amber-200" : "surface-2 border text-body hover:bg-white/10"}`}>{y}</button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="text-xs text-muted-soft mr-1 self-center">Time:</span>
                  {[{ v: "all", l: "All Time" }, { v: "this_month", l: "This Month" }, { v: "past_month", l: "Past Month" }].map(t => (
                    <button key={t.v} onClick={() => loadLeaderboard(lbDepartment, lbYear, t.v)}
                      className={`text-xs px-3 py-1 rounded-full border transition ${lbTimeframe === t.v ? "bg-amber-500/30 border-amber-500/50 text-amber-200" : "surface-2 border text-body hover:bg-white/10"}`}>{t.l}</button>
                  ))}
                  <span className="text-xs text-muted-soft ml-auto self-center">Overall Score by Credit Points</span>
                </div>
              </div>

              {/* Stats Cards */}
              {lbData && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: "Top Score", value: lbData.stats.top_score, icon: <Trophy className="w-5 h-5" />, color: "text-amber-400" },
                    { label: "Active Participants", value: lbData.stats.active_participants, icon: <Users className="w-5 h-5" />, color: "text-emerald-400" },
                    { label: "Average Score", value: lbData.stats.average_score, icon: <TrendingUp className="w-5 h-5" />, color: "text-purple-400" },
                    { label: "Total Interviews Today", value: lbData.stats.total_interviews, icon: <MessageSquare className="w-5 h-5" />, color: "text-cyan-400" },
                  ].map(c => (
                    <div key={c.label} className="card p-4">
                      <div className="flex items-center gap-2 text-muted-soft text-xs mb-2">{c.icon} {c.label}</div>
                      <p className={`text-2xl font-bold ${c.color}`}>{typeof c.value === "number" && c.label !== "Active Participants" && c.label !== "Total Interviews Today" ? c.value.toFixed(1) : c.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Ranking Table */}
              {lbData && lbData.rankings.length > 0 && (
                <div className="card p-4 md:p-5 overflow-x-auto">
                  <h3 className="text-sm font-semibold text-heading mb-3 flex items-center gap-2"><Award className="w-4 h-4 text-amber-400" /> Rankings</h3>
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
                        <tr key={r.id} className={`${r.rank <= 3 ? "bg-amber-500/10" : ""}`}>
                          <td className="py-3 pr-2">
                            <span className={`inline-flex items-center justify-center w-6 h-6 md:w-7 md:h-7 rounded-full text-xs font-bold ${r.rank === 1 ? "bg-amber-500 text-heading" : r.rank === 2 ? "bg-slate-400 text-heading" : r.rank === 3 ? "bg-orange-500 text-heading" : "surface-2 text-body"}`}>{r.rank}</span>
                          </td>
                          <td className="py-3 pr-2 text-heading font-medium whitespace-nowrap text-xs md:text-sm">{r.name}</td>
                          <td className="py-3 pr-2 text-body text-xs md:text-sm hidden md:table-cell">{r.department}</td>
                          <td className="py-3 pr-2 text-body text-xs md:text-sm hidden md:table-cell">{r.year}</td>
                          <td className="py-3 pr-2 text-amber-300 font-semibold text-xs md:text-sm">{r.total_credits}</td>
                          <td className="py-3 pr-2 text-emerald-300 text-xs md:text-sm">{r.grammar.toFixed(1)}</td>
                          <td className="py-3 pr-2 text-purple-300 text-xs md:text-sm">{r.fluency.toFixed(1)}</td>
                          <td className="py-3 pr-2 text-cyan-300 text-xs md:text-sm hidden md:table-cell">{r.relevance.toFixed(1)}</td>
                          <td className="py-3 pr-2 text-body text-xs md:text-sm hidden md:table-cell">{r.sessions_completed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {lbData && lbData.rankings.length === 0 && (
                <div className={`card p-6 text-center`}>
                  <p className="text-muted-soft text-sm">No evaluations found for the selected filters.</p>
                </div>
              )}

              {/* All Time Achievers */}
              {lbData && lbData.all_time_achievers.length > 0 && (
                <div className={`card p-5`}>
                  <h3 className="text-sm font-semibold text-heading mb-3 flex items-center gap-2"><Award className="w-4 h-4 text-amber-400" /> All Time Achievers</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {lbData.all_time_achievers.map((a) => (
                      <div key={a.id} className={`flex items-center gap-3 p-3 rounded-xl ${a.rank === 1 ? "bg-gradient-to-r from-amber-500/20 to-orange-600/10 border border-amber-500/30" : "surface-2 border border"}`}>
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold shrink-0 ${a.rank === 1 ? "bg-amber-500 text-heading" : a.rank === 2 ? "bg-slate-400 text-heading" : a.rank === 3 ? "bg-orange-500 text-heading" : "surface-2 text-body"}`}>{a.rank}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-heading truncate">{a.name}</p>
                          <p className="text-xs text-muted-soft">{a.department} · {a.year}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-emerald-300">{a.total_credits}</p>
                          <p className="text-xs text-muted-soft">{a.sessions_completed} sessions</p>
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
            <div className="card p-6 text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-amber-400 mb-3" />
              <p className="text-heading font-medium">Preparing your solo practice...</p>
              <p className="text-sm text-muted-soft mt-1">Loading your topic and motivational quote</p>
            </div>
          )}
          {view === "solo-practice" && soloSession && (
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Motivational Quote */}
              {soloQuote && (
                <div className="card border-purple-500/30 p-6 text-center">
                  <p className="text-sm text-purple-300/80 mb-2">Motivational Quote</p>
                  <p className="text-lg font-medium text-heading italic">"{soloQuote.quote}"</p>
                  <p className="text-sm text-purple-300/60 mt-2">— {soloQuote.author}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className={`card p-6`}>
                  <h2 className="text-lg font-semibold text-heading mb-4 flex items-center gap-2"><Target className="w-5 h-5 text-amber-400" /> Solo Practice</h2>
                  <div className="mb-4 p-4 rounded-lg bg-gradient-to-r from-amber-500/20 to-orange-600/20 border border-amber-500/30">
                    <p className="text-xs text-amber-300/80 mb-1">Your Topic</p>
                    <p className="text-sm font-medium text-heading">{soloSession.topic}</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-soft mb-4">
                    <Clock className="w-4 h-4" /> Session #{soloSession.session_number} · 4 min prep · 10 min speak
                  </div>
                  <Button onClick={() => setSoloRulesOpen(true)} className="w-full bg-gradient-to-r from-emerald-500 to-green-600 border-0 h-12 text-lg">
                    <Zap className="h-5 w-5 mr-2" /> Begin Practice
                  </Button>
                </div>

                <div className={`card p-6`}>
                  <h2 className="text-lg font-semibold text-heading mb-4 flex items-center gap-2"><TrendingUp className="w-5 h-5 text-amber-400" /> Your Progress</h2>
                  {soloSession.is_new_user ? (
                    <div className="text-center py-6">
                      <p className="text-heading font-medium mb-2">Welcome to Solo Practice!</p>
                      <p className="text-sm text-muted-soft">This is your first session. AI will evaluate your fluency, grammar, accent, and delivery.</p>
                    </div>
                  ) : soloSession.last_session ? (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-soft">Previous Session Scores</p>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { label: "Overall", value: soloSession.last_session.overall_score, color: "text-amber-300" },
                          { label: "Fluency", value: soloSession.last_session.fluency_score, color: "text-emerald-300" },
                          { label: "Grammar", value: soloSession.last_session.grammar_score, color: "text-purple-300" },
                          { label: "Delivery", value: soloSession.last_session.delivery_score, color: "text-cyan-300" },
                        ].map(s => (
                          <div key={s.label} className=" surface-2 rounded-lg p-3 text-center">
                            <p className="text-xs text-muted-soft">{s.label}</p>
                            <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                          </div>
                        ))}
                      </div>
                      {soloSession.last_session.weaknesses && (
                        <div className="bg-red-500/10 rounded-lg p-3">
                          <p className="text-xs text-red-300 mb-1">Areas to Improve</p>
                          <p className="text-xs text-body">{soloSession.last_session.weaknesses}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-6">
                      <p className="text-sm text-muted-soft">Complete your first session to see progress.</p>
                    </div>
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
                            {Math.abs(diff).toFixed(1)} pts
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
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-emerald-400 mb-2" />
                    <p className="text-sm text-emerald-300">Joined! Waiting for admin to assign teams...</p>
                    <p className="text-xs text-muted-soft mt-1">You will be placed in a team of 3. Your identity is hidden from other members.</p>
                  </div>
                )}
              </div>
              <div className="card border-amber-500/30 p-6">
                <h2 className="text-lg font-semibold text-heading mb-4 flex items-center gap-2"><Shield className="w-5 h-5 text-amber-400" /> Anonymous & Private</h2>
                <ul className="space-y-3 text-sm text-body">
                  <li className="flex items-start gap-2">✓ Your name and email are hidden from other participants</li>
                  <li className="flex items-start gap-2">✓ Teams of 3 are formed randomly from all participants</li>
                  <li className="flex items-start gap-2">✓ Each member is labeled as "Member 1", "Member 2", "Member 3"</li>
                  <li className="flex items-start gap-2">✓ Each team gets a separate discussion topic</li>
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
                      {sess.status === "waiting" && sess.participant_count > 0 && (
                        <Button onClick={() => startGdLiveMeeting(sess.session_code)} disabled={loading} className="bg-gradient-to-r from-emerald-500 to-green-600 border-0 text-xs">
                          <Zap className="w-3 h-3 mr-1" /> Start Meeting
                        </Button>
                      )}
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
                              <td className="py-2 pr-2 text-emerald-300 font-semibold">{entry.overall_score.toFixed(1)}</td>
                              <td className="py-2 pr-2 text-amber-300">{entry.credential_points.toFixed(1)}</td>
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

                {gdLiveRoomActive && (
                  <GdLiveAdminPanel
                    code={gdLiveAdminViewCode}
                    token={token}
                    topic={gdLiveRoomTopic}
                    onOpenRoom={openGdLiveRoom}
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

          {/* ─── GD Live Session (Anonymous Team) ─── */}
          {view === "gd-live-session" && gdLiveSession && (
            <div className="max-w-3xl mx-auto space-y-4">
              <StudentLiveWaiter
                code={gdLiveSession.session_code}
                token={token}
                onStart={(topic, members) => enterGdLiveRoom(gdLiveSession.session_code, topic, members)}
              />
              <StudentLivePoller
                code={gdLiveSession.session_code}
                token={token}
                onStart={(topic, members) => enterGdLiveRoom(gdLiveSession.session_code, topic, members)}
              />
              <div className="card p-6">
                {/* Team not yet assigned — staged progress so the wait never feels indefinite */}
                {!gdLiveMyTeam && (
                  <div className="py-8">
                    <p className="text-heading font-medium text-center mb-5">Joined session <code className="text-amber-300 font-mono">{gdLiveSession.session_code}</code></p>
                    <ul className="max-w-md mx-auto space-y-3">
                      <li className="flex items-center gap-3">
                        <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                        <span className="text-sm text-heading">Connected to session</span>
                      </li>
                      <li className="flex items-center gap-3">
                        <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
                        <span className="text-sm text-muted-soft">Waiting for admin to assign your team &amp; topic…</span>
                      </li>
                      <li className="flex items-center gap-3 opacity-50">
                        <span className="h-5 w-5 rounded-full border border-dashed border-muted-soft flex items-center justify-center text-xs">3</span>
                        <span className="text-sm text-muted-soft">Enter the live discussion room</span>
                      </li>
                    </ul>
                    <p className="text-xs text-muted-soft text-center mt-5">The discussion room opens automatically the moment the host starts — no refresh needed.</p>
                  </div>
                )}

                {/* Team assigned - show room */}
                {gdLiveMyTeam && (
                  <>
                    {/* Topic + Team Info */}
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="text-xl font-bold text-heading">{gdLiveMyTeam.topic}</h2>
                        <p className="text-sm text-muted-soft">Team #{gdLiveMyTeam.team_number} · Session Code: {gdLiveSession.session_code}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full ${gdLiveMyTeam.team_status === "active" ? "bg-emerald-500/20 text-emerald-300" : gdLiveMyTeam.team_status === "completed" ? "bg-blue-500/20 text-blue-300" : "bg-amber-500/20 text-amber-300"}`}>
                        {gdLiveMyTeam.team_status === "active" ? "Live" : gdLiveMyTeam.team_status === "completed" ? "Done" : "Waiting"}
                      </span>
                    </div>

                    <div className="mb-4 p-4 rounded-lg bg-gradient-to-r from-amber-500/20 to-orange-600/20 border border-amber-500/30">
                      <p className="text-xs text-amber-300/80 mb-2">Your Team (Identities Hidden)</p>
                      <div className="flex flex-wrap gap-2">
                        {gdLiveMyTeam.members.map((m: string, idx: number) => (
                          <span key={idx} className="text-sm surface-2 text-heading px-4 py-2 rounded-full border font-medium">{m}</span>
                        ))}
                      </div>
                    </div>

                    {/* Phase: Waiting for team start */}
                    {gdLiveMyTeam.team_status === "waiting" && !gdLiveIsPrepPhase && !gdLiveIsSpeakingPhase && (
                      <div className="text-center py-6">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto text-amber-400 mb-2" />
                        <p className="text-heading font-medium">Waiting for admin to start your team's discussion...</p>
                        <p className="text-xs text-muted-soft mt-1">The admin will initiate the discussion when ready.</p>
                      </div>
                    )}

                    {/* Phase: Ready to prepare (team is active, prep about to start automatically) */}
                    {gdLiveMyTeam.team_status === "active" && !gdLiveIsPrepPhase && !gdLiveIsSpeakingPhase && !gdLiveMyResult && (
                      <div className="text-center py-6">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto text-amber-400 mb-2" />
                        <p className="text-heading font-medium">Your team discussion is live!</p>
                        <p className="text-sm text-muted-soft mt-1">Preparation will start automatically. Get ready — 3 minutes to think, then 10 minutes to speak.</p>
                      </div>
                    )}

                    {/* Phase: Preparation (3 min countdown) */}
                    {gdLiveIsPrepPhase && (
                      <div className="text-center py-6">
                        <div className="relative inline-flex items-center justify-center mb-4">
                          <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
                            <circle cx="50" cy="50" r="45" fill="none" stroke="var(--border-strong)" strokeWidth="6" />
                            <circle cx="50" cy="50" r="45" fill="none" stroke="#f59e0b" strokeWidth="6"
                              strokeDasharray={`${2 * Math.PI * 45}`}
                              strokeDashoffset={`${2 * Math.PI * 45 * (1 - gdLivePrepSeconds / 180)}`}
                              strokeLinecap="round" className="transition-all duration-1000" />
                          </svg>
                          <span className="absolute text-3xl font-bold text-amber-400">{formatTime(gdLivePrepSeconds)}</span>
                        </div>
                        <p className="text-heading font-medium">Preparation Phase</p>
                        <p className="text-sm text-muted-soft mt-1">Think about the topic and organize your thoughts. Speaking starts automatically after the timer.</p>
                      </div>
                    )}

                    {/* Phase: Speaking */}
                    {gdLiveIsSpeakingPhase && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <span className="text-sm font-medium text-emerald-400 flex items-center gap-1"><Mic className="w-4 h-4" /> Speaking Phase</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-soft font-mono">{formatTime(gdLiveSpeakSeconds)} left</span>
                            <Button onClick={submitGdLiveAndEvaluate} disabled={loading || !transcript.trim()} variant="secondary" className="text-xs">
                              Finish early
                            </Button>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button onClick={toggleRecording} className={`border-0 ${isRecording ? "bg-red-500 hover:bg-red-600" : "bg-gradient-to-r from-amber-500 to-orange-600"}`}>
                            {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />} {isRecording ? "Stop" : "Record"}
                          </Button>
                          {recordingStatus && <span className="text-xs text-muted-soft">{recordingStatus}</span>}
                        </div>
                        {liveDetectedText && <p className="text-xs text-emerald-300 bg-emerald-500/10 p-2 rounded"><span className="font-medium">Detected:</span> {liveDetectedText}</p>}
                        <Textarea placeholder="Type or record your speech here..." value={transcript}
                          onChange={(e) => setTranscript(e.target.value)}
                          className="inp min-h-[120px]" />
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-muted-soft">{transcript.trim().split(/\s+/).filter(Boolean).length} words</span>
                          <Button onClick={submitGdLiveAndEvaluate} disabled={loading || !transcript.trim()}
                            className="bg-gradient-to-r from-amber-500 to-orange-600 border-0">
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Award className="h-4 w-4" />} Submit & Evaluate
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Phase: Waiting for team after submission */}
                    {!gdLiveIsPrepPhase && !gdLiveIsSpeakingPhase && gdLiveMyTeam.team_status === "active" && gdLiveMyResult && !gdLiveTeamStatus?.all_completed && (
                      <div className="text-center py-6">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto text-amber-400 mb-2" />
                        <p className="text-heading font-medium">You're done! Waiting for team members...</p>
                        {gdLiveTeamStatus && (
                          <p className="text-sm text-muted-soft mt-1">
                            {gdLiveTeamStatus.members_done} of {gdLiveTeamStatus.members_total} members completed
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* GD Live Results */}
          {view === "gd-live-results" && gdLiveSession && (
            <div className="max-w-3xl mx-auto space-y-4">
              <div className="card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-heading flex items-center gap-2">
                    <Award className="w-6 h-6 text-amber-400" /> GD Results
                  </h2>
                  <Button onClick={() => { setView("dashboard"); loadGdLiveSessions(); }}
                    variant="secondary" className="text-sm">
                    Dashboard
                  </Button>
                </div>
                <p className="text-sm text-muted-soft mb-4">Session Code: <code className="text-amber-300 font-mono">{gdLiveSession.session_code}</code></p>

                {!gdLiveMyResult && (
                  <div className="text-center py-6">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-amber-400 mb-2" />
                    <p className="text-heading font-medium">Loading your results...</p>
                  </div>
                )}

                {gdLiveMyResult && (
                  <div className="space-y-4">
                    {/* Score Card */}
                    <div className="text-center p-6 rounded-xl bg-gradient-to-r from-amber-500/20 to-orange-600/20 border border-amber-500/30">
                      <p className="text-5xl font-bold text-amber-400 mb-1">{gdLiveMyResult.overall_score.toFixed(1)}</p>
                      <p className="text-sm text-amber-300/80">Overall Score</p>
                      <p className="text-xs text-muted-soft mt-2">
                        <Trophy className="w-3 h-3 inline mr-1" />
                        {gdLiveMyResult.credential_points.toFixed(1)} Credential Points
                      </p>
                    </div>

                    {/* Score Bars */}
                    <div className="space-y-2">
                      {[
                        { label: "Fluency", value: gdLiveMyResult.fluency_score, color: "bg-emerald-500" },
                        { label: "Grammar", value: gdLiveMyResult.grammar_score, color: "bg-purple-500" },
                        { label: "Accent", value: gdLiveMyResult.accent_score, color: "bg-blue-500" },
                        { label: "Relevance", value: gdLiveMyResult.relevance_score, color: "bg-amber-500" },
                        { label: "Content Quality", value: gdLiveMyResult.content_quality, color: "bg-cyan-500" },
                      ].map(s => (
                        <div key={s.label}>
                          <div className="flex justify-between text-xs text-muted-soft mb-1">
                            <span>{s.label}</span>
                            <span>{s.value.toFixed(1)}%</span>
                          </div>
                          <div className="w-full surface-2 rounded-full h-2">
                            <div className={`${s.color} h-2 rounded-full transition-all duration-500`} style={{ width: `${s.value}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Weaknesses + Tips */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                        <p className="text-xs font-medium text-red-300 mb-2">Areas to Improve</p>
                        <ul className="space-y-1">
                          {gdLiveMyResult.weaknesses.split("; ").map((w, i) => (
                            <li key={i} className="text-xs text-red-200/80 flex items-start gap-1">
                              <span className="text-red-400 shrink-0">•</span> {w}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                        <p className="text-xs font-medium text-emerald-300 mb-2">Improvement Tips</p>
                        <ul className="space-y-1">
                          {gdLiveMyResult.improvement_tips.split("; ").map((t, i) => (
                            <li key={i} className="text-xs text-emerald-200/80 flex items-start gap-1">
                              <span className="text-emerald-400 shrink-0">•</span> {t}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {/* Transcript */}
                    <div className="p-4 rounded-lg surface-2 border border">
                      <p className="text-xs font-medium text-body mb-2">Your Transcript</p>
                      <p className="text-xs text-muted-soft whitespace-pre-wrap">{gdLiveMyResult.transcript}</p>
                    </div>
                  </div>
                )}

                {/* Leaderboard link for viewing results */}
                <div className="mt-4 text-center">
                  <Button onClick={() => { setView("dashboard"); loadGdLiveSessions(); }}
                    className="bg-gradient-to-r from-amber-500 to-orange-600 border-0">
                    Back to Dashboard
                  </Button>
                </div>
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
