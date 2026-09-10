"use client";

import React, { useState } from "react";
import {
  Trophy,
  Zap,
  Target,
  Users,
  Award,
  Sparkles,
  TrendingUp,
  Clock,
  ArrowRight,
  Radio,
  Copy,
  Check,
  ChevronRight,
  Flame,
  Volume2,
  ShieldCheck,
  BarChart3,
  BookOpen,
  Calendar,
  AlertCircle,
  Loader2,
  Mic,
  Activity,
  Compass,
  Star,
  Layers,
  ArrowUpRight,
  MessageSquare,
  Lock,
  Unlock,
  CheckCircle2,
  Play
} from "lucide-react";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  Tooltip
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { User, Progress, SoloQuote, PageView } from "@/lib/api";

interface StudentDashboardProps {
  user: User;
  progress: Progress | null;
  gdLiveSessions: any[];
  soloHistory: any[];
  soloQuote: SoloQuote | null;
  gdLiveCode: string;
  setGdLiveCode: (code: string) => void;
  joinGdLive: () => void;
  loading: boolean;
  gdLivePendingFinish: any;
  finishGdLiveSpeech: () => void;
  gdLiveFinishing: boolean;
  setView: (view: PageView) => void;
  startSoloPractice: () => void;
  loadLeaderboard: (dept?: string, year?: string, timeframe?: string) => void;
}

export default function StudentDashboard({
  user,
  progress,
  gdLiveSessions,
  soloHistory,
  soloQuote,
  gdLiveCode,
  setGdLiveCode,
  joinGdLive,
  loading,
  gdLivePendingFinish,
  finishGdLiveSpeech,
  gdLiveFinishing,
  setView,
  startSoloPractice,
  loadLeaderboard
}: StudentDashboardProps) {
  const [activeTab, setActiveTab] = useState<"skills" | "sessions" | "solo">("skills");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Gamification Rank Calculation
  const creditPoints = progress && typeof progress.total_credits === "number" ? Math.round(progress.total_credits) : 0;
  const xpPoints = creditPoints * 1000;
  let levelTitle = "Novice Speaker";
  let levelNum = 1;
  let nextLevelPoints = 100000;
  let prevLevelPoints = 0;
  let tierGradient = "from-slate-500 to-slate-700";
  let tierBadge = "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700";

  if (xpPoints >= 500000) {
    levelTitle = "Grandmaster Orator";
    levelNum = 4;
    nextLevelPoints = 1000000;
    prevLevelPoints = 500000;
    tierGradient = "from-amber-400 via-rose-500 to-purple-600";
    tierBadge = "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30";
  } else if (xpPoints >= 250000) {
    levelTitle = "Eloquent Orator";
    levelNum = 3;
    nextLevelPoints = 500000;
    prevLevelPoints = 250000;
    tierGradient = "from-purple-500 to-indigo-600";
    tierBadge = "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30";
  } else if (xpPoints >= 100000) {
    levelTitle = "Confident Communicator";
    levelNum = 2;
    nextLevelPoints = 250000;
    prevLevelPoints = 100000;
    tierGradient = "from-cyan-500 to-blue-600";
    tierBadge = "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30";
  }

  const levelProgress = Math.min(100, Math.max(0, ((xpPoints - prevLevelPoints) / (nextLevelPoints - prevLevelPoints)) * 100));

  // Sessions filtering
  const activeSessions = (gdLiveSessions || []).filter(
    (s: any) => s.status === "waiting" || s.status === "active" || s.status === "live"
  );
  const completedSessions = (gdLiveSessions || []).filter((s: any) => s.status === "completed");
  const latestSolo = soloHistory && soloHistory.length > 0 ? soloHistory[0] : null;

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  // Recommended GD Topics
  const trendingTopics = [
    {
      title: "AI in Higher Education: Personalized Learning vs Academic Integrity",
      category: "Technology",
      difficulty: "Intermediate",
      duration: "3 mins",
      accent: "from-indigo-500 to-purple-600"
    },
    {
      title: "Remote vs Hybrid Engineering Work: Impact on Innovation & Collaboration",
      category: "Corporate Careers",
      difficulty: "Advanced",
      duration: "3 mins",
      accent: "from-cyan-500 to-blue-600"
    },
    {
      title: "Green Mobility Transition: Are Developing Nations Ready for 100% EVs?",
      category: "Sustainability",
      difficulty: "Analytical",
      duration: "3 mins",
      accent: "from-emerald-500 to-teal-600"
    }
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      {/* ──────────────────────────────────────────────────────────── */}
      {/* PENDING SPEECH RECOVERY ALERT (IF APPLICABLE) */}
      {/* ──────────────────────────────────────────────────────────── */}
      {gdLivePendingFinish && (
        <div className="relative overflow-hidden rounded-2xl border-2 border-rose-500/30 bg-gradient-to-r from-rose-50/90 via-white to-amber-50/90 dark:from-rose-950/40 dark:via-slate-900/90 dark:to-amber-950/30 p-5 shadow-lg backdrop-blur-xl">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-rose-500 text-white flex items-center justify-center shrink-0 shadow-lg shadow-rose-500/30 animate-pulse">
                <Mic className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-500 text-white shadow-sm">
                    Incomplete Turn
                  </span>
                  <span className="text-xs text-rose-600 dark:text-rose-400 font-bold">Action Needed</span>
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white mt-1">
                  You left "{gdLivePendingFinish.topic || "Discussion Round"}" mid-turn
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                  Finish your speaking turn now to calculate your evaluation points and final score.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto shrink-0">
              <Button
                onClick={() => setView("gd-live-room")}
                variant="secondary"
                className="h-10 px-4 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              >
                Back to Live Room
              </Button>
              <Button
                onClick={finishGdLiveSpeech}
                disabled={gdLiveFinishing}
                className="h-10 px-5 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/25 border-0"
              >
                {gdLiveFinishing ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
                {gdLiveFinishing ? "Submitting..." : "Finish Speech"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────── */}
      {/* HERO SECTION: MODERN CLEAN GD ARENA HUB */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-200/90 dark:border-indigo-500/20 bg-gradient-to-br from-white via-indigo-50/30 to-purple-50/25 dark:from-slate-900/95 dark:via-indigo-950/40 dark:to-slate-900/90 p-6 md:p-8 backdrop-blur-2xl shadow-xl shadow-slate-200/50 dark:shadow-none">
        {/* Soft Ambient Mesh Orbs */}
        <div className="absolute top-0 right-1/4 w-80 h-80 bg-indigo-500/10 dark:bg-indigo-500/15 rounded-full blur-3xl pointer-events-none -z-10" />
        <div className="absolute bottom-0 right-0 w-72 h-72 bg-purple-500/10 dark:bg-purple-500/15 rounded-full blur-3xl pointer-events-none -z-10" />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left Column: Welcome & Persona Info */}
          <div className="lg:col-span-7 space-y-4">
            {/* Institutional & Status Badges */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25 shadow-sm">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                Live Arena Active
              </span>
              {user.department && (
                <span className="px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/20">
                  {user.department} {user.year ? `· ${user.year}` : ""} {user.section ? `(${user.section})` : ""}
                </span>
              )}
              <span className={`px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border ${tierBadge}`}>
                {levelTitle} · Lvl {levelNum}
              </span>
            </div>

            {/* Main Greeting */}
            <div>
              <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                Welcome to the Arena,{" "}
                <span className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 dark:from-indigo-300 dark:via-purple-300 dark:to-pink-300 bg-clip-text text-transparent">
                  {user.name}
                </span>
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-300 mt-2 leading-relaxed max-w-xl font-medium">
                Enter an active discussion session, articulate your perspectives under real-time AI observation, and climb the cohort leaderboard.
              </p>
            </div>

            {/* Clean Student Metadata Chips with 1-Click Copy */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => user.register_number && handleCopy(user.register_number)}
                className="flex items-center gap-2 bg-white/90 dark:bg-slate-950/60 px-3.5 py-1.5 rounded-xl border border-slate-200/90 dark:border-slate-800 hover:border-indigo-400 shadow-sm transition-all group"
                title="Click to copy register number"
              >
                <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">Reg No:</span>
                <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">{user.register_number || "—"}</span>
                {copiedCode === user.register_number ? (
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Copy className="w-3 h-3 text-slate-400 group-hover:text-indigo-600 transition-colors" />
                )}
              </button>
              <div className="flex items-center gap-2 bg-white/90 dark:bg-slate-950/60 px-3.5 py-1.5 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-sm">
                <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">Role:</span>
                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 capitalize">{user.role}</span>
              </div>
              <div className="flex items-center gap-2 bg-white/90 dark:bg-slate-950/60 px-3.5 py-1.5 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-sm">
                <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">Credits:</span>
                <span className="text-xs font-bold text-amber-600 dark:text-amber-400 font-mono">{creditPoints} PTS</span>
              </div>
            </div>
          </div>

          {/* Right Column: Sleek Join Discussion Console */}
          <div className="lg:col-span-5">
            <div className="rounded-2xl border border-indigo-200/90 dark:border-indigo-500/30 bg-white/95 dark:bg-slate-950/90 backdrop-blur-xl p-6 shadow-xl shadow-indigo-100/50 dark:shadow-none">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold shadow-sm">
                    <Zap className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">Join Live Discussion</h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Enter the 4-digit code provided by your host</p>
                  </div>
                </div>
                <span className="flex h-2.5 w-2.5 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                </span>
              </div>

              <div className="space-y-3">
                <div className="relative">
                  <Input
                    placeholder="E.G. 6106"
                    maxLength={4}
                    value={gdLiveCode}
                    onChange={(e) => setGdLiveCode(e.target.value.replace(/\D/g, ""))}
                    onKeyDown={(e) => { if (e.key === "Enter" && gdLiveCode.trim()) joinGdLive(); }}
                    className="w-full h-14 text-center font-mono text-2xl font-black tracking-[0.35em] uppercase rounded-xl border-2 border-indigo-200 dark:border-indigo-500/40 focus:border-indigo-600 dark:focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 bg-slate-50/80 dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 placeholder:tracking-normal placeholder:text-sm shadow-inner"
                  />
                  {gdLiveCode.length === 4 && (
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-emerald-500 dark:text-emerald-400">
                      <Check className="w-5 h-5 stroke-[3]" />
                    </span>
                  )}
                </div>

                <Button
                  onClick={joinGdLive}
                  disabled={loading || !gdLiveCode.trim()}
                  className="w-full h-12 text-sm font-bold rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 hover:opacity-90 text-white shadow-lg shadow-indigo-600/25 border-0 flex items-center justify-center gap-2 transition-all duration-200"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <span>Enter GD Colosseum</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </Button>
              </div>

              {/* Active Room Quick Join Strip */}
              {activeSessions.length > 0 && (
                <div className="mt-4 pt-3.5 border-t border-slate-100 dark:border-slate-800">
                  <p className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider mb-2 flex items-center gap-1.5">
                    <Radio className="w-3 h-3 text-emerald-500 animate-pulse" />
                    Active Room Available
                  </p>
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono font-black text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/60">
                        {activeSessions[0].session_code}
                      </code>
                      <span className="text-[11px] text-slate-700 dark:text-slate-300 font-medium truncate max-w-[140px]">
                        {activeSessions[0].topic || "Live Session"}
                      </span>
                    </div>
                    <Button
                      onClick={() => setGdLiveCode(activeSessions[0].session_code)}
                      className="h-7 text-[10px] font-bold px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm border-0"
                    >
                      Use Code
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 4 CORE KPI METRIC CARDS */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Average Speaking Score */}
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white/80 dark:bg-slate-900/70 p-5 backdrop-blur-xl shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Average Score
            </span>
            <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center">
              <Trophy className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-1">
            <span className="text-3xl font-black text-slate-900 dark:text-white font-mono">
              {progress && progress.average_score != null ? `${Number(progress.average_score).toFixed(1)}%` : "0.0%"}
            </span>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 mt-3.5 overflow-hidden">
            <div
              className="bg-purple-600 dark:bg-purple-500 h-1.5 rounded-full transition-all duration-700"
              style={{ width: `${progress?.average_score || 10}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-2 text-[10px] text-slate-500 dark:text-slate-400 font-medium">
            <span>Weighted evaluation</span>
            <span className="text-purple-600 dark:text-purple-400 font-bold">Target: 80%+</span>
          </div>
        </div>

        {/* Metric 2: Credit / Elo Points */}
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white/80 dark:bg-slate-900/70 p-5 backdrop-blur-xl shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Credit Points
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Award className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-3xl font-black text-slate-900 dark:text-white font-mono">
              {progress && typeof progress.total_credits === "number" ? Math.round(progress.total_credits) : 0}
            </span>
            <span className="text-xs font-bold text-amber-600 dark:text-amber-400">PTS</span>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 mt-3.5 overflow-hidden">
            <div
              className="bg-amber-500 h-1.5 rounded-full transition-all duration-700"
              style={{ width: `${Math.min(100, Math.max(8, (creditPoints / 500) * 100))}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-2 text-[10px] text-slate-500 dark:text-slate-400 font-medium">
            <span>Accumulated credits</span>
            <span className="text-amber-600 dark:text-amber-400 font-bold">+25 PTS/GD</span>
          </div>
        </div>

        {/* Metric 3: Group Discussions Completed */}
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white/80 dark:bg-slate-900/70 p-5 backdrop-blur-xl shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              GD Matches
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-3xl font-black text-slate-900 dark:text-white font-mono">
              {completedSessions.length}
            </span>
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">matches</span>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 mt-3.5 overflow-hidden">
            <div
              className="bg-emerald-500 h-1.5 rounded-full transition-all duration-700"
              style={{ width: `${Math.min(100, Math.max(8, completedSessions.length * 10))}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-2 text-[10px] text-slate-500 dark:text-slate-400 font-medium">
            <span>Completed debates</span>
            <span className="text-emerald-600 dark:text-emerald-400 font-bold">Multiplayer</span>
          </div>
        </div>

        {/* Metric 4: Solo Practice Drills */}
        <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white/80 dark:bg-slate-900/70 p-5 backdrop-blur-xl shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Solo AI Drills
            </span>
            <div className="w-8 h-8 rounded-xl bg-cyan-100 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-400 flex items-center justify-center">
              <Target className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-3xl font-black text-slate-900 dark:text-white font-mono">
              {soloHistory.length}
            </span>
            <span className="text-xs font-bold text-cyan-600 dark:text-cyan-400">drills</span>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 mt-3.5 overflow-hidden">
            <div
              className="bg-cyan-500 h-1.5 rounded-full transition-all duration-700"
              style={{ width: `${Math.min(100, Math.max(8, soloHistory.length * 10))}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-2 text-[10px] text-slate-500 dark:text-slate-400 font-medium">
            <span>Impromptu rounds</span>
            <span className="text-cyan-600 dark:text-cyan-400 font-bold">AI Coach</span>
          </div>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* MAIN WORKSPACE: BENTO GRID WITH INTEGRATED CARD TABS */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (5 Cols): Oratory Tier Card & Quick Launchers */}
        <div className="lg:col-span-5 space-y-6">
          {/* Tier & XP Progression Card */}
          <div className="rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white/80 dark:bg-slate-900/70 p-6 backdrop-blur-xl shadow-sm relative overflow-hidden">
            <div className="flex items-center gap-4 mb-4">
              <div className={`w-14 h-14 rounded-2xl bg-gradient-to-tr ${tierGradient} flex items-center justify-center text-white shadow-xl shadow-indigo-500/20 shrink-0`}>
                <Flame className="w-7 h-7 animate-pulse" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Current Mastery Tier</p>
                <h4 className="text-lg font-extrabold text-slate-900 dark:text-white mt-0.5">{levelTitle}</h4>
                <div className="flex items-center gap-2 mt-1">
                  <span className="px-2.5 py-0.5 rounded-md text-[10px] font-black bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                    Tier {levelNum}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold font-mono">
                    {xpPoints.toLocaleString()} XP
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-2 mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-600 dark:text-slate-400 font-semibold">Tier Progress</span>
                <span className="font-bold text-slate-900 dark:text-white font-mono">
                  {xpPoints.toLocaleString()} / {nextLevelPoints.toLocaleString()} XP
                </span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 h-2.5 rounded-full transition-all duration-700"
                  style={{ width: `${Math.max(5, levelProgress)}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 text-right italic font-medium">
                {xpPoints < 500000
                  ? `${(nextLevelPoints - xpPoints).toLocaleString()} XP needed to reach next tier`
                  : "You have achieved top tier orator mastery!"}
              </p>
            </div>

            {/* Tier Perks Checklist */}
            <div className="mt-4 pt-3.5 border-t border-slate-100 dark:border-slate-800 space-y-2 text-xs">
              <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider block mb-1">
                Tier Perks & Capabilities
              </span>
              <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span>Standard Turn-Based Live GD Colosseum (Active)</span>
              </div>
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>AI Moderator Real-time Inquiries (Unlocks at Tier 2)</span>
              </div>
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>Inter-Department Championship (Unlocks at Tier 3)</span>
              </div>
            </div>

            {/* Daily Booster Mission */}
            <div className="mt-4 p-3.5 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-500/30 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-[10px] font-black uppercase text-indigo-700 dark:text-indigo-400 tracking-wide flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-500" /> Daily Oratory Mission
                </span>
                <p className="text-xs font-bold text-slate-900 dark:text-white truncate mt-0.5">
                  Complete 1 Solo AI Drill (+1,000 XP)
                </p>
              </div>
              <Button
                onClick={startSoloPractice}
                className="h-8 px-3 rounded-xl text-[11px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm border-0 shrink-0 flex items-center gap-1"
              >
                <span>Start Drill</span>
                <ArrowRight className="w-3 h-3" />
              </Button>
            </div>
          </div>

          {/* Quick Launchers */}
          <div className="grid grid-cols-2 gap-3.5">
            <button
              onClick={startSoloPractice}
              className="flex flex-col justify-between p-5 rounded-2xl border border-cyan-200/80 dark:border-cyan-500/20 bg-gradient-to-br from-cyan-50/70 via-white to-transparent dark:from-cyan-950/20 dark:via-transparent dark:to-transparent hover:border-cyan-400 dark:hover:border-cyan-500/50 hover:shadow-md transition-all duration-200 text-left group"
            >
              <div className="w-10 h-10 rounded-xl bg-cyan-100 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-400 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform shadow-sm">
                <Target className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors flex items-center justify-between">
                  <span>Solo AI Drill</span>
                  <ArrowUpRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                  1-on-1 AI evaluation with voice feedback
                </p>
              </div>
            </button>

            <button
              onClick={() => loadLeaderboard("ALL", "ALL", "all")}
              className="flex flex-col justify-between p-5 rounded-2xl border border-amber-200/80 dark:border-amber-500/20 bg-gradient-to-br from-amber-50/70 via-white to-transparent dark:from-amber-950/20 dark:via-transparent dark:to-transparent hover:border-amber-400 dark:hover:border-amber-500/50 hover:shadow-md transition-all duration-200 text-left group"
            >
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform shadow-sm">
                <Trophy className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors flex items-center justify-between">
                  <span>Leaderboard</span>
                  <ArrowUpRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                  Department & college speaking ranks
                </p>
              </div>
            </button>
          </div>

          {/* Motivational Quote */}
          {soloQuote && (
            <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white/80 dark:bg-slate-900/70 p-5 backdrop-blur-xl relative overflow-hidden shadow-sm">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 italic leading-relaxed font-medium">
                    "{soloQuote.quote}"
                  </p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 mt-2 text-right">
                    — {soloQuote.author}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column (7 Cols): UNIFIED INTELLIGENCE CARD WITH INTEGRATED TABS */}
        <div className="lg:col-span-7">
          <div className="rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white/90 dark:bg-slate-900/70 p-6 backdrop-blur-xl shadow-sm space-y-6">
            {/* Integrated Header with Segmented Navigation Tabs */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Activity className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  Speaking Intelligence Hub
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Real-time analytics and activity history
                </p>
              </div>

              {/* Integrated Modern Segmented Pill Tabs */}
              <div className="flex items-center gap-1 p-1 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-950/70 shrink-0">
                <button
                  onClick={() => setActiveTab("skills")}
                  className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all duration-200 flex items-center gap-1.5 ${
                    activeTab === "skills"
                      ? "bg-white dark:bg-indigo-600 text-slate-900 dark:text-white shadow-sm"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5 text-indigo-500 dark:text-white" />
                  <span>Skill Matrix</span>
                </button>

                <button
                  onClick={() => setActiveTab("sessions")}
                  className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all duration-200 flex items-center gap-1.5 ${
                    activeTab === "sessions"
                      ? "bg-white dark:bg-indigo-600 text-slate-900 dark:text-white shadow-sm"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <Users className="w-3.5 h-3.5 text-emerald-500 dark:text-white" />
                  <span>GD Matches ({completedSessions.length})</span>
                </button>

                <button
                  onClick={() => setActiveTab("solo")}
                  className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all duration-200 flex items-center gap-1.5 ${
                    activeTab === "solo"
                      ? "bg-white dark:bg-indigo-600 text-slate-900 dark:text-white shadow-sm"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <Target className="w-3.5 h-3.5 text-cyan-500 dark:text-white" />
                  <span>Solo Drills ({soloHistory.length})</span>
                </button>
              </div>
            </div>

            {/* TAB CONTENT 1: SKILL MATRIX */}
            {activeTab === "skills" && (
              <div className="space-y-6">
                {latestSolo ? (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                    {/* Radar Chart */}
                    <div className="md:col-span-6 h-64 relative flex items-center justify-center">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart
                          data={[
                            { metric: "Grammar", value: latestSolo.grammar_score || 0 },
                            { metric: "Fluency", value: latestSolo.fluency_score || 0 },
                            { metric: "Pronunciation", value: latestSolo.accent_score || 0 },
                            { metric: "Delivery", value: latestSolo.delivery_score || 0 },
                          ]}
                        >
                          <PolarGrid stroke="var(--border)" />
                          <PolarAngleAxis
                            dataKey="metric"
                            tick={{ fontSize: 11, fill: "var(--heading)", fontWeight: 700 }}
                          />
                          <Radar
                            name="Score"
                            dataKey="value"
                            stroke="#6366f1"
                            fill="#6366f1"
                            fillOpacity={0.35}
                            dot={{ r: 4, fill: "#6366f1", stroke: "#ffffff", strokeWidth: 1.5 }}
                          />
                          <Tooltip
                            contentStyle={{
                              background: "var(--surface-solid)",
                              border: "1px solid var(--border)",
                              borderRadius: "12px",
                              color: "var(--heading)",
                              fontSize: "12px",
                              boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1)"
                            }}
                          />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Dimension Progress Bars */}
                    <div className="md:col-span-6 space-y-3.5">
                      {[
                        { label: "Grammar & Structure", val: latestSolo.grammar_score, color: "bg-indigo-600", text: "text-indigo-600 dark:text-indigo-400" },
                        { label: "Fluency & Tempo", val: latestSolo.fluency_score, color: "bg-purple-600", text: "text-purple-600 dark:text-purple-400" },
                        { label: "Pronunciation & Accent", val: latestSolo.accent_score, color: "bg-cyan-600", text: "text-cyan-600 dark:text-cyan-400" },
                        { label: "Confidence & Delivery", val: latestSolo.delivery_score, color: "bg-emerald-600", text: "text-emerald-600 dark:text-emerald-400" },
                      ].map((item) => (
                        <div key={item.label} className="space-y-1.5">
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">{item.label}</span>
                            <span className={`font-bold font-mono ${item.text}`}>
                              {item.val != null ? `${Number(item.val).toFixed(0)}/100` : "N/A"}
                            </span>
                          </div>
                          <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                            <div
                              className={`${item.color} h-2 rounded-full transition-all duration-700`}
                              style={{ width: `${item.val || 0}%` }}
                            />
                          </div>
                        </div>
                      ))}

                      {latestSolo.topic && (
                        <div className="mt-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 text-xs">
                          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">Latest Evaluated Topic</span>
                          <span className="font-bold text-slate-900 dark:text-white line-clamp-1 mt-0.5">{latestSolo.topic}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  /* BEAUTIFULLY DESIGNED BASELINE PREVIEW FOR NEW STUDENTS */
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                      {/* Target Competency Radar Preview */}
                      <div className="md:col-span-6 h-64 relative flex items-center justify-center">
                        <ResponsiveContainer width="100%" height="100%">
                          <RadarChart
                            data={[
                              { metric: "Grammar", value: 85 },
                              { metric: "Fluency", value: 82 },
                              { metric: "Pronunciation", value: 84 },
                              { metric: "Confidence", value: 80 },
                              { metric: "Topic Intel", value: 86 },
                              { metric: "Reasoning", value: 82 },
                            ]}
                          >
                            <PolarGrid stroke="var(--border)" strokeDasharray="3 3" />
                            <PolarAngleAxis
                              dataKey="metric"
                              tick={{ fontSize: 10, fill: "var(--heading)", fontWeight: 700 }}
                            />
                            <Radar
                              name="Target Standard"
                              dataKey="value"
                              stroke="#6366f1"
                              fill="#6366f1"
                              fillOpacity={0.25}
                              strokeWidth={2}
                              strokeDasharray="4 4"
                            />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>

                      {/* Institutional Benchmark Targets */}
                      <div className="md:col-span-6 space-y-3">
                        <div className="flex items-center justify-between pb-1 border-b border-slate-100 dark:border-slate-800">
                          <span className="text-xs font-bold text-slate-900 dark:text-white">Institutional Competency Target</span>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                            Calibrating
                          </span>
                        </div>

                        {[
                          { label: "Grammar & Structure", target: 85, color: "bg-indigo-600" },
                          { label: "Fluency & Tempo", target: 82, color: "bg-purple-600" },
                          { label: "Pronunciation & Clarity", target: 84, color: "bg-cyan-600" },
                          { label: "Confidence & Delivery", target: 80, color: "bg-emerald-600" },
                        ].map((b) => (
                          <div key={b.label} className="space-y-1">
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-slate-700 dark:text-slate-300 font-medium">{b.label}</span>
                              <span className="font-bold text-slate-500 dark:text-slate-400 font-mono text-[11px]">Benchmark: {b.target}%</span>
                            </div>
                            <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                              <div className={`${b.color} h-2 rounded-full opacity-60`} style={{ width: `${b.target}%` }} />
                            </div>
                          </div>
                        ))}

                        <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1 leading-relaxed">
                          Complete 1 solo practice drill or join a live discussion round to unlock your live personal voiceprint!
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 rounded-2xl bg-gradient-to-r from-indigo-50/90 via-purple-50/50 to-white dark:from-slate-950/60 dark:via-indigo-950/30 dark:to-slate-950/60 border border-indigo-200/80 dark:border-indigo-500/30">
                      <div className="flex items-center gap-2.5">
                        <Sparkles className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                        <div>
                          <p className="text-xs font-bold text-slate-900 dark:text-white">Ready to calibrate your radar?</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">Takes only 2 minutes with automated speech critique.</p>
                        </div>
                      </div>
                      <Button
                        onClick={startSoloPractice}
                        className="h-9 px-4 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20 border-0 shrink-0 flex items-center gap-1.5"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Start First Solo Drill</span>
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT 2: GD MATCHES HISTORY */}
            {activeTab === "sessions" && (
              <div className="space-y-3">
                {completedSessions.length === 0 ? (
                  <div className="py-10 text-center rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 p-6 space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto shadow-sm">
                      <Users className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">No Live GD Matches Attended Yet</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-1">
                        Ask your instructor or room host for a 4-digit session code, or enter any active room from the top console.
                      </p>
                    </div>
                    {activeSessions.length > 0 && (
                      <Button
                        onClick={() => setGdLiveCode(activeSessions[0].session_code)}
                        className="h-9 text-xs font-bold px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm border-0"
                      >
                        Join Active Room #{activeSessions[0].session_code}
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                    {completedSessions.map((s: any) => (
                      <div
                        key={s.session_code || s.id}
                        className="p-4 rounded-2xl bg-slate-50/70 dark:bg-slate-950/40 border border-slate-200/80 dark:border-slate-800 hover:border-indigo-500/40 transition-all duration-200 flex items-center justify-between gap-4"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <code className="text-xs font-mono font-black text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">
                              #{s.session_code}
                            </code>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 uppercase tracking-wider">
                              Attended
                            </span>
                          </div>
                          <p className="text-xs font-bold text-slate-900 dark:text-white mt-1.5">
                            {s.topic || "Interactive GD Round"}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
                            <Clock className="w-3 h-3" />
                            {new Date(s.created_at || Date.now()).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit"
                            })}
                          </p>
                        </div>

                        <div className="shrink-0 text-right">
                          <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                            {s.total_participants || s.joined_count || 2} Speakers
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT 3: SOLO DRILLS */}
            {activeTab === "solo" && (
              <div className="space-y-3">
                {soloHistory.length === 0 ? (
                  <div className="py-10 text-center rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 p-6 space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-cyan-50 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-400 flex items-center justify-center mx-auto shadow-sm">
                      <Target className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">No Solo Practice History Found</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-1">
                        Solo drills let you practice impromptu speech delivery with real-time AI critique on grammar, pauses, and speech pace.
                      </p>
                    </div>
                    <Button onClick={startSoloPractice} className="h-9 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm border-0">
                      Start Solo Drill Now
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                    {soloHistory.map((s: any) => (
                      <div
                        key={s.id || s.session_number}
                        className="p-4 rounded-2xl bg-slate-50/70 dark:bg-slate-950/40 border border-slate-200/80 dark:border-slate-800 hover:border-indigo-500/40 transition-all duration-200 space-y-2"
                      >
                        <div className="flex justify-between items-start gap-2">
                          <div className="flex-1">
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
                              Session #{s.session_number || "—"}
                            </span>
                            <h4 className="text-xs font-bold text-slate-900 dark:text-white mt-0.5 line-clamp-1">
                              {s.topic}
                            </h4>
                          </div>
                          <div className="px-2.5 py-1 rounded-xl bg-amber-100 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-xs font-black shrink-0 font-mono">
                            {(s.overall_score != null ? Number(s.overall_score) : 0).toFixed(1)} / 100
                          </div>
                        </div>

                        {s.weaknesses && (
                          <p className="text-[11px] text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200/70 dark:border-slate-800 line-clamp-2">
                            <span className="font-bold text-indigo-600 dark:text-indigo-400">Feedback:</span> {s.weaknesses.split(";")[0]}
                          </p>
                        )}

                        <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200/50 dark:border-slate-800">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(s.created_at || Date.now()).toLocaleDateString()}
                          </span>
                          <span className="font-mono">Grammar: {s.grammar_score || 0}% · Fluency: {s.fluency_score || 0}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* RECOMMENDED GD TOPICS FOR PRACTICE */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white/80 dark:bg-slate-900/70 p-6 backdrop-blur-xl shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Compass className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              Recommended GD Topics for Practice
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Current cohort debating prompts curated for technical and campus recruitment rounds
            </p>
          </div>
          <Button
            onClick={startSoloPractice}
            variant="ghost"
            className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 p-0 h-auto self-start sm:self-auto flex items-center gap-1"
          >
            <span>Explore All Topics</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {trendingTopics.map((topic, idx) => (
            <div
              key={idx}
              className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-950/50 hover:border-indigo-400 dark:hover:border-indigo-500/50 hover:shadow-md transition-all duration-200 flex flex-col justify-between group"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800">
                    {topic.category}
                  </span>
                  <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {topic.duration}
                  </span>
                </div>
                <h4 className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors leading-snug">
                  {topic.title}
                </h4>
              </div>

              <div className="pt-3.5 mt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                  {topic.difficulty}
                </span>
                <button
                  onClick={startSoloPractice}
                  className="text-xs font-bold text-indigo-600 dark:text-indigo-400 group-hover:translate-x-0.5 transition-transform flex items-center gap-1"
                >
                  <span>Practice Now</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
