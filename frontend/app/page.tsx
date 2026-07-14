"use client";

import { AlertCircle, Award, Clock, LogOut, MessageSquare, Mic, MicOff, RefreshCw, Trophy, Users, Zap, Loader2, Copy, Check, Target, TrendingUp, ArrowUp, ArrowDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GDLeaderboardEntry, GDSession, GDTopic, Progress, SoloQuote, SoloStartResponse, SoloSubmitResponse, User, apiRequest } from "@/lib/api";

type PageView = "login" | "dashboard" | "gd-create" | "gd-session" | "gd-leaderboard" | "solo-practice" | "solo-session" | "solo-result";

export default function Home() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<PageView>("login");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const [registerNumber, setRegisterNumber] = useState("");
  const [password, setPassword] = useState("");

  const [topics, setTopics] = useState<GDTopic[]>([]);
  const [currentTopic, setCurrentTopic] = useState<GDTopic | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const [sessions, setSessions] = useState<GDSession[]>([]);
  const [activeSession, setActiveSession] = useState<GDSession | null>(null);
  const [leaderboard, setLeaderboard] = useState<GDLeaderboardEntry[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [transcript, setTranscript] = useState("");
  const [gdTranscripts, setGdTranscripts] = useState<Record<string, string>>({});
  const [sessionCodeInput, setSessionCodeInput] = useState("");
  const [lastCreatedCode, setLastCreatedCode] = useState("");
  const [copied, setCopied] = useState(false);

  // Solo Practice state
  const [soloSession, setSoloSession] = useState<SoloStartResponse | null>(null);
  const [soloQuote, setSoloQuote] = useState<SoloQuote | null>(null);
  const [soloResult, setSoloResult] = useState<SoloSubmitResponse | null>(null);
  const [soloHistory, setSoloHistory] = useState<SoloSubmitResponse["last_session"][]>([]);

  const [prepSeconds, setPrepSeconds] = useState(0);
  const [speakingSeconds, setSpeakingSeconds] = useState(0);
  const [isPrepPhase, setIsPrepPhase] = useState(false);
  const [isSpeakingPhase, setIsSpeakingPhase] = useState(false);
  const [isGdDone, setIsGdDone] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [liveDetectedText, setLiveDetectedText] = useState("");

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
      const s = await apiRequest<GDSession[]>("/gd/sessions", {}, t).catch(() => []);
      setSessions(s);
    } catch { localStorage.removeItem("mzgd_token"); setView("login"); }
  }

  async function handleLogin() {
    if (!registerNumber.trim()) { setMessage("Enter your register number"); return; }
    setLoading(true); setMessage(""); setSuccess("");
    try {
      const res = await apiRequest<{ access_token: string; user: User }>("/login/register-number", {
        method: "POST",
        body: JSON.stringify({ register_number: registerNumber, password: password || "Password123" })
      });
      localStorage.setItem("mzgd_token", res.access_token);
      setToken(res.access_token);
      await loadProfile(res.access_token);
    } catch (err: any) {
      setMessage(err.message || "Login failed");
    } finally { setLoading(false); }
  }

  async function loadTopics() {
    setRefreshCount(0);
    setCurrentTopic(null);
    setLastCreatedCode("");
    const t = await apiRequest<GDTopic[]>("/gd/topics", {}, token);
    setTopics(t);
    await doRefresh();
    setView("gd-create");
  }

  async function doRefresh() {
    if (refreshCount >= 3) {
      setMessage("You have used all 3 topic refreshes.");
      return;
    }
    setLoading(true);
    try {
      const topic = await apiRequest<GDTopic>("/gd/topics/refresh", { method: "POST" }, token);
      setCurrentTopic(topic);
      setRefreshCount(prev => prev + 1);
      setMessage("");
    } catch (err: any) {
      setMessage(err.message);
    } finally { setLoading(false); }
  }

  async function createSession() {
    if (!currentTopic) { setMessage("No topic selected"); return; }
    setLoading(true);
    try {
      const res = await apiRequest<{ session_code: string; message: string }>(
        "/gd/sessions", { method: "POST", body: JSON.stringify({ topic_id: currentTopic.id, team_size: 6 }) }, token
      );
      setLastCreatedCode(res.session_code);
      setSuccess(`Session created! Code: ${res.session_code}`);
      const s = await apiRequest<GDSession[]>("/gd/sessions", {}, token);
      setSessions(s);
    } catch (err: any) { setMessage(err.message); }
    finally { setLoading(false); }
  }

  async function joinSession() {
    const code = sessionCodeInput.trim().toUpperCase();
    if (!code) { setMessage("Enter session code"); return; }
    setLoading(true);
    try {
      await apiRequest(`/gd/sessions/${code}/join`, { method: "POST" }, token);
      setSuccess("Joined session!");
      const s = await apiRequest<GDSession[]>("/gd/sessions", {}, token);
      setSessions(s);
    } catch (err: any) { setMessage(err.message); }
    finally { setLoading(false); }
  }

  async function openSession(session: GDSession) {
    const s = await apiRequest<GDSession>(`/gd/sessions/${session.session_code}`, {}, token);
    setActiveSession(s);
    if (s.status === "completed") {
      const lb = await apiRequest<GDLeaderboardEntry[]>(`/gd/sessions/${session.session_code}/leaderboard`, {}, token);
      setLeaderboard(lb);
      setView("gd-leaderboard");
    } else {
      setTranscript("");
      setIsGdDone(false);
      setIsPrepPhase(false);
      setIsSpeakingPhase(false);
      setPrepSeconds(0);
      setSpeakingSeconds(0);
      setGdTranscripts({});
      setView("gd-session");
    }
  }

  async function startGd() {
    if (!activeSession) return;
    setLoading(true);
    try {
      const res = await apiRequest<{ message: string; topic: string; preparation_minutes: number; speaking_minutes: number }>(`/gd/sessions/${activeSession.session_code}/start`, { method: "POST" }, token);
      setSuccess(res.message);
      setIsPrepPhase(true);
      setPrepSeconds(240);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setPrepSeconds(prev => {
          if (prev <= 1) {
            clearInterval(timerRef.current!);
            setIsPrepPhase(false);
            setIsSpeakingPhase(true);
            setSpeakingSeconds(960);
            setSuccess("Preparation time over! Start speaking now.");
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
    } catch (err: any) { setMessage(err.message); }
    finally { setLoading(false); }
  }

  async function submitTranscriptForEval() {
    if (!activeSession || !transcript.trim()) { setMessage("Write your transcript first"); return; }
    setLoading(true);
    try {
      const res = await apiRequest<{ message: string; overall_score: number; credential_points: number }>(`/gd/sessions/${activeSession.session_code}/submit`, {
        method: "POST", body: JSON.stringify({ transcript })
      }, token);
      setSuccess(`${res.message} — Score: ${res.overall_score}, Points: ${res.credential_points}`);
      setGdTranscripts(prev => ({ ...prev, [activeSession.session_code]: transcript }));
      setTranscript("");
    } catch (err: any) { setMessage(err.message); }
    finally { setLoading(false); }
  }

  async function finishGd() {
    if (!activeSession) return;
    setLoading(true);
    try {
      await apiRequest(`/gd/sessions/${activeSession.session_code}/finish`, { method: "POST" }, token);
      const lb = await apiRequest<GDLeaderboardEntry[]>(`/gd/sessions/${activeSession.session_code}/leaderboard`, {}, token);
      setLeaderboard(lb);
      if (timerRef.current) clearInterval(timerRef.current);
      setIsPrepPhase(false);
      setIsSpeakingPhase(false);
      setIsGdDone(true);
      setView("gd-leaderboard");
      setSuccess("GD completed! See leaderboard below.");
    } catch (err: any) { setMessage(err.message); }
    finally { setLoading(false); }
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function toggleRecording() {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      setRecordingStatus("Processing audio...");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
    setActiveSession(null); setLeaderboard([]);
    setMessage(""); setSuccess("");
    setSoloSession(null); setSoloResult(null); setSoloQuote(null);
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
    setPrepSeconds(240);
    setIsSpeakingPhase(false);
    setSpeakingSeconds(0);
    setView("solo-session");
    setSuccess("You have 4 minutes to prepare. Use the notes area below.");
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setPrepSeconds(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          setIsPrepPhase(false);
          setIsSpeakingPhase(true);
          setSpeakingSeconds(600);
          setSuccess("Preparation time over! Start speaking now. You have 10 minutes.");
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
      if (timerRef.current) clearInterval(timerRef.current);
      setIsPrepPhase(false);
      setIsSpeakingPhase(false);
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
    return (
      <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0">
          <img src="/college_image.jpeg" alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/60" />
        </div>
        <div className="relative z-10 w-full max-w-md mx-4">
          <div className="text-center mb-8">
            <img src="/MZ_logo_DB.webp" alt="Mount Zion Logo" className="w-24 h-24 rounded-2xl mx-auto mb-4 shadow-lg shadow-purple-500/30 object-cover animate-bounce-slow" />
            <h1 className="text-4xl font-bold text-white mb-2">Mount Zion GD</h1>
            <p className="text-purple-200/80">Group Discussion Assessment Platform</p>
          </div>
          <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-8 border border-white/20 shadow-2xl">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-purple-200 mb-1">Register Number</label>
                <Input
                  placeholder="911724205001"
                  value={registerNumber}
                  onChange={(e) => setRegisterNumber(e.target.value)}
                  className="bg-white/5 border-white/20 text-white placeholder:text-white/40"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-purple-200 mb-1">Password</label>
                <Input
                  type="password"
                  placeholder="Default: Password123"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-white/5 border-white/20 text-white placeholder:text-white/40"
                />
              </div>
              <Button
                className="w-full bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white border-0 h-12 text-lg font-semibold shadow-lg shadow-orange-500/30"
                onClick={handleLogin}
                disabled={loading}
              >
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5" />}
                Enter GD Portal
              </Button>
              {message && (
                <div className="flex items-center gap-2 rounded-lg bg-red-500/20 p-3 text-sm text-red-200">
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900/80 border-r border-white/10 flex flex-col shrink-0">
        <div className="p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <img src="/MZ_logo_DB.webp" alt="Mount Zion Logo" className="w-10 h-10 rounded-xl object-cover shadow-lg" />
            <div>
              <p className="text-sm font-bold text-white">Mount Zion GD</p>
              <p className="text-xs text-purple-300/60">{user.name}</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {[
            { icon: <Users className="w-5 h-5" />, label: "Dashboard", view: "dashboard" as PageView },
            { icon: <MessageSquare className="w-5 h-5" />, label: "New GD", view: "gd-create" as PageView },
            { icon: <Target className="w-5 h-5" />, label: "Solo Practice", view: "solo-practice" as PageView },
            { icon: <Trophy className="w-5 h-5" />, label: "Leaderboard", view: "gd-leaderboard" as PageView, badge: leaderboard.length > 0 ? `${leaderboard.length}` : undefined },
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => {
                if (item.view === "gd-leaderboard") { if (activeSession) openSession(activeSession); else setView("dashboard"); }
                else if (item.view === "gd-create") loadTopics();
                else if (item.view === "solo-practice") startSoloPractice();
                else setView(item.view);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${view === item.view ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.badge && <span className="ml-auto bg-amber-500 text-white text-xs px-2 py-0.5 rounded-full">{item.badge}</span>}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-white/10">
          <button onClick={logout} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-red-300 hover:bg-red-500/10 transition-all">
            <LogOut className="w-5 h-5" /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6 max-w-6xl mx-auto">
          {(success || message) && (
            <div className={`mb-4 flex items-center gap-2 rounded-xl p-4 text-sm ${success ? "bg-emerald-500/20 text-emerald-200 border border-emerald-500/30" : "bg-red-500/20 text-red-200 border border-red-500/30"}`}>
              {success ? <Zap className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
              <span>{success || message}</span>
              <button onClick={() => { setMessage(""); setSuccess(""); }} className="ml-auto text-white/50 hover:text-white">&times;</button>
            </div>
          )}

          {/* Dashboard View */}
          {view === "dashboard" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { icon: <Users className="w-6 h-6" />, label: "Active Sessions", value: sessions.filter(s => s.status !== "completed").length.toString(), color: "from-blue-500 to-cyan-600" },
                  { icon: <Trophy className="w-6 h-6" />, label: "Avg Score", value: progress ? `${progress.average_score}` : "0", color: "from-amber-500 to-orange-600" },
                  { icon: <Award className="w-6 h-6" />, label: "Credits", value: progress ? `${progress.total_credits || 0}` : "0", color: "from-purple-500 to-pink-600" },
                ].map((card) => (
                  <div key={card.label} className={`rounded-xl bg-gradient-to-br ${card.color} p-5 shadow-lg`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-white/80">{card.icon}</div>
                      <span className="text-white/50 text-xs font-medium uppercase tracking-wider">{card.label}</span>
                    </div>
                    <p className="text-3xl font-bold text-white">{card.value}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 p-5">
                <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2"><Users className="w-5 h-5 text-amber-400" /> Recent Sessions</h2>
                {sessions.length === 0 && <p className="text-slate-400 text-sm">No sessions yet. Create or join one!</p>}
                <div className="space-y-2">
                  {sessions.slice(0, 10).map((s) => (
                    <div key={s.session_code} className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition cursor-pointer" onClick={() => openSession(s)}>
                      <div>
                        <p className="text-sm font-medium text-white">{s.topic}</p>
                        <p className="text-xs text-slate-400">Code: {s.session_code} · {s.status} · {s.member_count}/{s.team_size} members</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full ${s.status === "completed" ? "bg-emerald-500/20 text-emerald-300" : s.status === "waiting" ? "bg-amber-500/20 text-amber-300" : "bg-blue-500/20 text-blue-300"}`}>{s.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* GD Create/Join View */}
          {view === "gd-create" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 p-6">
                <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2"><MessageSquare className="w-5 h-5 text-amber-400" /> Create GD Session</h2>
                {currentTopic && (
                  <div className="mb-4 p-4 rounded-lg bg-gradient-to-r from-amber-500/20 to-orange-600/20 border border-amber-500/30">
                    <p className="text-xs text-amber-300/80 mb-1">Selected Topic</p>
                    <p className="text-sm font-medium text-white">{currentTopic.topic}</p>
                    <p className="text-xs text-slate-400 mt-1 capitalize">{currentTopic.category}</p>
                  </div>
                )}
                <div className="space-y-3">
                  <Button onClick={doRefresh} disabled={loading || refreshCount >= 3} className="w-full bg-white/10 border border-white/20 text-white hover:bg-white/20">
                    <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh Topic ({3 - refreshCount} left)
                  </Button>
                  {lastCreatedCode && (
                    <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                      <p className="text-xs text-emerald-300 mb-1">Session Code</p>
                      <div className="flex items-center gap-2">
                        <code className="text-lg font-mono font-bold text-white tracking-widest">{lastCreatedCode}</code>
                        <button onClick={() => copyCode(lastCreatedCode)} className="p-1.5 rounded-md hover:bg-white/10 text-emerald-300">
                          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </button>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">Share this code with your team to join</p>
                    </div>
                  )}
                  <Button onClick={createSession} disabled={loading || !currentTopic} className="w-full bg-gradient-to-r from-amber-500 to-orange-600 border-0">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Create Session
                  </Button>
                </div>
              </div>
              <div className="rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 p-6">
                <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2"><Users className="w-5 h-5 text-amber-400" /> Join Session</h2>
                <div className="space-y-3">
                  <Input placeholder="Enter Session Code (e.g. A3F9K2B7X1M4)" value={sessionCodeInput} onChange={(e) => setSessionCodeInput(e.target.value.toUpperCase())} className="bg-white/10 border-white/20 text-white placeholder:text-white/40 font-mono tracking-wider" />
                  <Button onClick={joinSession} disabled={loading} className="w-full bg-gradient-to-r from-purple-500 to-pink-600 border-0">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />} Join Session
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* GD Session View */}
          {view === "gd-session" && activeSession && (
            <div className="space-y-4">
              <div className="rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-white">{activeSession.topic}</h2>
                    <p className="text-sm text-slate-400">Code: {activeSession.session_code} · {activeSession.status}</p>
                  </div>
                  <div className="flex gap-2">
                    {activeSession.status === "waiting" && (
                      <Button onClick={startGd} disabled={loading} className="bg-gradient-to-r from-emerald-500 to-green-600 border-0">
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Start GD
                      </Button>
                    )}
                    {activeSession.status !== "completed" && !isGdDone && (
                      <Button onClick={finishGd} disabled={loading} variant="secondary" className="bg-red-500/20 text-red-300 border-red-500/30 hover:bg-red-500/30">End GD</Button>
                    )}
                    {isGdDone && (
                      <Button onClick={() => { if (activeSession) openSession(activeSession); }} className="bg-gradient-to-r from-amber-500 to-orange-600 border-0">
                        <Trophy className="h-4 w-4" /> View Results
                      </Button>
                    )}
                  </div>
                </div>
                {(isPrepPhase || isSpeakingPhase) && (
                  <div className={`rounded-lg p-4 text-center mb-4 ${isPrepPhase ? "bg-blue-500/20 border border-blue-500/30" : "bg-emerald-500/20 border border-emerald-500/30"}`}>
                    <p className="text-sm text-slate-300 mb-1">{isPrepPhase ? "Preparation Phase" : "Speaking Phase"}</p>
                    <p className="text-4xl font-bold text-white font-mono">{formatTime(isPrepPhase ? prepSeconds : speakingSeconds)}</p>
                  </div>
                )}
                {activeSession.status === "waiting" && !isPrepPhase && !isSpeakingPhase && (
                  <p className="text-slate-400 text-sm mb-4">Waiting for host to start the GD session.</p>
                )}
                <div className="mb-4">
                  <p className="text-sm font-medium text-slate-300 mb-2">Team Members ({activeSession.members?.length || 0})</p>
                  <div className="flex flex-wrap gap-2">
                    {activeSession.members?.map((m) => (
                      <span key={m.id} className="text-xs bg-white/10 text-slate-200 px-3 py-1.5 rounded-full border border-white/10">{m.name}</span>
                    ))}
                  </div>
                </div>
                {(isPrepPhase || isSpeakingPhase) && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Button onClick={toggleRecording} className={`border-0 ${isRecording ? "bg-red-500 hover:bg-red-600" : "bg-gradient-to-r from-amber-500 to-orange-600"}`}>
                        {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />} {isRecording ? "Stop" : "Record"}
                      </Button>
                      {recordingStatus && <span className="text-xs text-slate-400">{recordingStatus}</span>}
                    </div>
                    {liveDetectedText && <p className="text-xs text-emerald-300 bg-emerald-500/10 p-2 rounded"><span className="font-medium">Detected:</span> {liveDetectedText}</p>}
                    <Textarea placeholder="Type or record your speech contribution here..." value={transcript} onChange={(e) => setTranscript(e.target.value)} className="bg-white/10 border-white/20 text-white placeholder:text-white/40 min-h-[100px]" />
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-slate-400">{transcript.trim().split(/\s+/).filter(Boolean).length} words</span>
                      <Button onClick={submitTranscriptForEval} disabled={loading || !transcript.trim()} className="bg-gradient-to-r from-amber-500 to-orange-600 border-0">
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Award className="h-4 w-4" />} Submit for Evaluation
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              {Object.keys(gdTranscripts).length > 0 && (
                <div className="rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 p-4">
                  <p className="text-sm font-medium text-slate-300 mb-2">Submitted Contributions</p>
                  {Object.entries(gdTranscripts).map(([sc, txt]) => (
                    <p key={sc} className="text-xs text-slate-400 bg-white/5 p-2 rounded mb-1">{txt.slice(0, 100)}...</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Leaderboard View */}
          {view === "gd-leaderboard" && (
            <div className="space-y-6">
              {activeSession && (
                <div className="rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-xl font-bold text-white flex items-center gap-2"><Trophy className="w-6 h-6 text-amber-400" /> Leaderboard</h2>
                      <p className="text-sm text-slate-400">{activeSession.topic} · Code: {activeSession.session_code}</p>
                    </div>
                    <Button onClick={() => { setView("dashboard"); }} variant="secondary" className="bg-white/10 text-white border-white/20">Back</Button>
                  </div>
                  {leaderboard.length === 0 && <p className="text-slate-400 text-sm">Leaderboard not ready yet. Finish the GD first.</p>}
                  {leaderboard.length > 0 && (
                    <div className="space-y-2">
                      {leaderboard.map((entry, idx) => (
                        <div key={entry.id} className={`flex items-center gap-4 p-4 rounded-xl ${idx === 0 ? "bg-amber-500/20 border border-amber-500/30" : idx === 1 ? "bg-slate-400/10 border border-slate-400/20" : idx === 2 ? "bg-orange-500/10 border border-orange-500/20" : "bg-white/5"}`}>
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${idx === 0 ? "bg-amber-500 text-white" : idx === 1 ? "bg-slate-400 text-white" : idx === 2 ? "bg-orange-500 text-white" : "bg-white/10 text-slate-300"}`}>{entry.rank_position}</div>
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-white">{entry.name}</p>
                            <p className="text-xs text-slate-400">{entry.register_number}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-bold text-amber-300">{entry.overall_score}</p>
                            <p className="text-xs text-emerald-400">{entry.credential_points} pts</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {leaderboard.length > 0 && (
                    <div className="mt-4 rounded-lg bg-white/5 p-4">
                      <p className="text-sm font-medium text-slate-300 mb-3">Score Breakdown</p>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={leaderboard.map(e => ({ name: e.name.split(" ")[0], score: e.overall_score, points: e.credential_points }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" />
                            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                            <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#94a3b8" }} />
                            <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #ffffff20", borderRadius: "8px", color: "#fff" }} />
                            <Bar dataKey="score" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ─── Solo Practice ─── */}
          {view === "solo-practice" && soloSession && (
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Motivational Quote */}
              {soloQuote && (
                <div className="rounded-xl bg-gradient-to-r from-purple-600/30 to-pink-600/30 border border-purple-500/30 p-6 text-center">
                  <p className="text-sm text-purple-300/80 mb-2">Motivational Quote</p>
                  <p className="text-lg font-medium text-white italic">"{soloQuote.quote}"</p>
                  <p className="text-sm text-purple-300/60 mt-2">— {soloQuote.author}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 p-6">
                  <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2"><Target className="w-5 h-5 text-amber-400" /> Solo Practice</h2>
                  <div className="mb-4 p-4 rounded-lg bg-gradient-to-r from-amber-500/20 to-orange-600/20 border border-amber-500/30">
                    <p className="text-xs text-amber-300/80 mb-1">Your Topic</p>
                    <p className="text-sm font-medium text-white">{soloSession.topic}</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-400 mb-4">
                    <Clock className="w-4 h-4" /> Session #{soloSession.session_number} · 4 min prep · 10 min speak
                  </div>
                  <Button onClick={beginSoloPrep} className="w-full bg-gradient-to-r from-emerald-500 to-green-600 border-0 h-12 text-lg">
                    <Zap className="h-5 w-5 mr-2" /> Begin Practice
                  </Button>
                </div>

                <div className="rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 p-6">
                  <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2"><TrendingUp className="w-5 h-5 text-amber-400" /> Your Progress</h2>
                  {soloSession.is_new_user ? (
                    <div className="text-center py-6">
                      <p className="text-white font-medium mb-2">Welcome to Solo Practice!</p>
                      <p className="text-sm text-slate-400">This is your first session. AI will evaluate your fluency, grammar, accent, and delivery.</p>
                    </div>
                  ) : soloSession.last_session ? (
                    <div className="space-y-3">
                      <p className="text-sm text-slate-400">Previous Session Scores</p>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { label: "Overall", value: soloSession.last_session.overall_score, color: "text-amber-300" },
                          { label: "Fluency", value: soloSession.last_session.fluency_score, color: "text-emerald-300" },
                          { label: "Grammar", value: soloSession.last_session.grammar_score, color: "text-purple-300" },
                          { label: "Delivery", value: soloSession.last_session.delivery_score, color: "text-cyan-300" },
                        ].map(s => (
                          <div key={s.label} className="bg-white/5 rounded-lg p-3 text-center">
                            <p className="text-xs text-slate-400">{s.label}</p>
                            <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                          </div>
                        ))}
                      </div>
                      {soloSession.last_session.weaknesses && (
                        <div className="bg-red-500/10 rounded-lg p-3">
                          <p className="text-xs text-red-300 mb-1">Areas to Improve</p>
                          <p className="text-xs text-slate-300">{soloSession.last_session.weaknesses}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-6">
                      <p className="text-sm text-slate-400">Complete your first session to see progress.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ─── Solo Session (Prep + Speaking) ─── */}
          {view === "solo-session" && soloSession && (
            <div className="max-w-3xl mx-auto space-y-4">
              <div className="rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-white">{soloSession.topic}</h2>
                    <p className="text-sm text-slate-400">Session #{soloSession.session_number} · Solo Practice</p>
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
                    <p className="text-sm text-slate-300 mb-1">{isPrepPhase ? "Preparation Phase — Think & Take Notes" : "Speaking Phase — Deliver Your Thoughts"}</p>
                    <p className="text-4xl font-bold text-white font-mono">{formatTime(isPrepPhase ? prepSeconds : speakingSeconds)}</p>
                  </div>
                )}
                <div className="mb-4">
                  <p className="text-sm font-medium text-slate-300 mb-2">Your Topic</p>
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <p className="text-sm text-white">{soloSession.topic}</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Button onClick={toggleRecording} className={`border-0 ${isRecording ? "bg-red-500 hover:bg-red-600" : "bg-gradient-to-r from-amber-500 to-orange-600"}`}>
                      {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />} {isRecording ? "Stop" : "Record"}
                    </Button>
                    {recordingStatus && <span className="text-xs text-slate-400">{recordingStatus}</span>}
                    <span className="ml-auto text-xs text-slate-500">{isPrepPhase ? "Prepare your thoughts..." : "Speak clearly into the mic..."}</span>
                  </div>
                  {liveDetectedText && <p className="text-xs text-emerald-300 bg-emerald-500/10 p-2 rounded"><span className="font-medium">Detected:</span> {liveDetectedText}</p>}
                  <Textarea
                    placeholder={isPrepPhase ? "Jot down notes and key points for your speech..." : "Type or record your speech here..."}
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/40 min-h-[150px]"
                  />
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-400">{transcript.trim().split(/\s+/).filter(Boolean).length} words</span>
                    <div className="flex gap-2">
                      <Button onClick={() => { setView("solo-practice"); if (timerRef.current) clearInterval(timerRef.current); setIsPrepPhase(false); setIsSpeakingPhase(false); }} variant="secondary" className="bg-white/10 text-white border-white/20">
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
                <div className="rounded-xl bg-gradient-to-r from-purple-600/30 to-pink-600/30 border border-purple-500/30 p-4 text-center">
                  <p className="text-sm text-white/80 italic">"{soloQuote.quote}"</p>
                  <p className="text-xs text-purple-300/60 mt-1">— {soloQuote.author}</p>
                </div>
              )}

              {/* Score Overview */}
              <div className="rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-white flex items-center gap-2"><Target className="w-6 h-6 text-amber-400" /> Practice Results</h2>
                    <p className="text-sm text-slate-400">{soloSession.topic} · Session #{soloSession.session_number}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-bold text-amber-300">{soloResult.overall_score}</p>
                    <p className="text-xs text-slate-400">Overall Score</p>
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
                      <p key={i} className="text-xs text-slate-300 flex items-start gap-2 mb-1">
                        <ArrowDown className="w-3 h-3 text-red-400 mt-0.5 shrink-0" /> {w}
                      </p>
                    ))}
                  </div>
                  <div className="bg-emerald-500/10 rounded-lg p-4 border border-emerald-500/20">
                    <p className="text-sm font-medium text-emerald-300 mb-2">Improvement Tips</p>
                    {soloResult.improvement_tips.map((tip, i) => (
                      <p key={i} className="text-xs text-slate-300 flex items-start gap-2 mb-1">
                        <ArrowUp className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" /> {tip}
                      </p>
                    ))}
                  </div>
                </div>
              </div>

              {/* Improvement Comparison */}
              {soloResult.last_session && (
                <div className="rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 p-6">
                  <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2"><TrendingUp className="w-5 h-5 text-amber-400" /> Improvement from Last Session</h3>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: "Overall", current: soloResult.overall_score, prev: soloResult.last_session.overall_score },
                      { label: "Fluency", current: soloResult.fluency_score, prev: soloResult.last_session.fluency_score },
                      { label: "Grammar", current: soloResult.grammar_score, prev: soloResult.last_session.grammar_score },
                      { label: "Delivery", current: soloResult.delivery_score, prev: soloResult.last_session.delivery_score },
                    ].map(s => {
                      const diff = s.current - s.prev;
                      return (
                        <div key={s.label} className="bg-white/5 rounded-lg p-3 text-center">
                          <p className="text-xs text-slate-400">{s.label}</p>
                          <p className="text-lg font-bold text-white">{s.current}</p>
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
                <Button onClick={() => { setView("dashboard"); }} variant="secondary" className="bg-white/10 text-white border-white/20">
                  Back to Dashboard
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
