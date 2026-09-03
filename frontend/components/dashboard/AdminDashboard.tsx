"use client";

import React, { useState } from "react";
import {
  Shield,
  Users,
  Radio,
  CheckCircle2,
  Sparkles,
  Trophy,
  ArrowRight,
  Copy,
  Check,
  Plus,
  BarChart3,
  FileText,
  Settings,
  Clock,
  Loader2,
  Calendar,
  AlertTriangle,
  Play,
  Monitor,
  ExternalLink,
  ChevronRight,
  ArrowUpRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { User, PageView } from "@/lib/api";

interface AdminDashboardProps {
  user: User;
  gdLiveSessions: any[];
  loading: boolean;
  createGdLiveSession: () => void;
  setGdLiveAdminViewCode: (code: string) => void;
  loadGdLiveParticipants: (code: string) => void;
  loadGdLiveLeaderboard: (code: string) => void;
  loadLeaderboard: (dept?: string, year?: string, timeframe?: string) => void;
  setView: (view: PageView) => void;
  gdLiveCreatedCode: string | null;
}

export default function AdminDashboard({
  user,
  gdLiveSessions,
  loading,
  createGdLiveSession,
  setGdLiveAdminViewCode,
  loadGdLiveParticipants,
  loadGdLiveLeaderboard,
  loadLeaderboard,
  setView,
  gdLiveCreatedCode,
}: AdminDashboardProps) {
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const activeSessions = (gdLiveSessions || []).filter((s: any) => s.status !== "completed");
  const completedSessions = (gdLiveSessions || []).filter((s: any) => s.status === "completed");

  const displayedSessions = (gdLiveSessions || []).filter((s: any) => {
    if (filter === "active") return s.status !== "completed";
    if (filter === "completed") return s.status === "completed";
    return true;
  });

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <div className="space-y-6 animate-fade-up">
      {/* ──────────────────────────────────────────────────────────── */}
      {/* MISSION CONTROL HERO BANNER (LIGHT & DARK CONTRAST TUNED) */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-indigo-500/20 bg-gradient-to-br from-white/90 via-indigo-50/40 to-purple-50/40 dark:from-slate-900/90 dark:via-indigo-950/40 dark:to-slate-900/90 p-6 md:p-8 backdrop-blur-2xl shadow-xl shadow-slate-200/40 dark:shadow-none">
        <div className="absolute top-0 right-1/4 w-80 h-80 bg-indigo-500/10 dark:bg-indigo-500/15 rounded-full blur-3xl pointer-events-none -z-10" />
        <div className="absolute bottom-0 right-0 w-72 h-72 bg-purple-500/10 dark:bg-purple-500/15 rounded-full blur-3xl pointer-events-none -z-10" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 border border-indigo-500/25 shadow-sm">
                <Shield className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                Administrator Mission Control
              </span>
              <span className="px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Live Command Ready
              </span>
            </div>

            <div>
              <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                Welcome, Commander{" "}
                <span className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 dark:from-indigo-300 dark:via-purple-300 dark:to-pink-300 bg-clip-text text-transparent">
                  {user.name}
                </span>
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-300 mt-1.5 max-w-xl font-medium">
                Host live Group Discussions, monitor active speaker rooms in real time, and oversee college-wide communication rankings.
              </p>
            </div>
          </div>

          {/* Quick Studio Triggers */}
          <div className="shrink-0 flex flex-col sm:flex-row gap-3">
            <Button
              onClick={createGdLiveSession}
              disabled={loading}
              className="h-12 px-6 text-sm font-bold rounded-2xl bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-xl shadow-indigo-600/30 border-0 flex items-center gap-2 transition-all duration-200"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Plus className="w-5 h-5" />
                  <span>Launch Live GD Session</span>
                </>
              )}
            </Button>

            <Button
              variant="secondary"
              onClick={() => setView("gd-live-admin")}
              className="h-12 px-5 text-sm font-semibold rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-white shadow-sm"
            >
              <Monitor className="w-4 h-4 mr-2 text-indigo-600 dark:text-indigo-400" />
              <span>Full Control Room</span>
            </Button>
          </div>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 4 CORE KPI STATS STRIP */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 backdrop-blur-xl shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Total GD Sessions
            </span>
            <div className="w-8 h-8 rounded-xl bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-black text-slate-900 dark:text-white mt-3">
            {gdLiveSessions.length}
          </p>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 block">Created all time</span>
        </div>

        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 backdrop-blur-xl shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Active / Waiting Rooms
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Radio className="w-4 h-4 animate-pulse" />
            </div>
          </div>
          <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400 mt-3">
            {activeSessions.length}
          </p>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 block">Ready or in progress</span>
        </div>

        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 backdrop-blur-xl shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Completed Discussions
            </span>
            <div className="w-8 h-8 rounded-xl bg-cyan-100 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-400 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-black text-cyan-600 dark:text-cyan-400 mt-3">
            {completedSessions.length}
          </p>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 block">Concluded sessions</span>
        </div>

        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 backdrop-blur-xl shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Global Standings
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Trophy className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-black text-amber-600 dark:text-amber-400 mt-3">
            All Depts
          </p>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 block">Evaluations synchronized</span>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* MAIN WORKSPACE: LIVE ROOM GRID & ADMIN ACTION BENTO */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (8 Cols): Interactive Session Matrix */}
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Radio className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                Live & Recent GD Discussion Rooms
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Real-time overview of active waiting rooms, ongoing debates, and past archives.
              </p>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1 bg-slate-100/70 dark:bg-slate-950/70 p-1 rounded-xl border border-slate-200/80 dark:border-slate-800">
              <button
                onClick={() => setFilter("all")}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  filter === "all"
                    ? "bg-white dark:bg-indigo-600 text-slate-900 dark:text-white shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                All ({gdLiveSessions.length})
              </button>
              <button
                onClick={() => setFilter("active")}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  filter === "active"
                    ? "bg-white dark:bg-indigo-600 text-slate-900 dark:text-white shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                Active ({activeSessions.length})
              </button>
              <button
                onClick={() => setFilter("completed")}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  filter === "completed"
                    ? "bg-white dark:bg-indigo-600 text-slate-900 dark:text-white shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                Completed ({completedSessions.length})
              </button>
            </div>
          </div>

          {displayedSessions.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/40 p-12 text-center backdrop-blur-xl shadow-sm">
              <Users className="w-12 h-12 text-slate-400 mx-auto mb-3" />
              <h4 className="text-base font-bold text-slate-900 dark:text-white">No GD Sessions in this View</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-1">
                Launch a live group discussion session to start onboarding students into the stage.
              </p>
              <Button
                onClick={createGdLiveSession}
                className="mt-4 h-10 px-5 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm"
              >
                <Plus className="w-4 h-4 mr-1.5" /> Launch Session
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {displayedSessions.slice(0, 10).map((s: any) => {
                const isActive = s.status !== "completed";
                return (
                  <div
                    key={s.session_code}
                    className="p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 backdrop-blur-xl hover:border-indigo-500/40 transition-all duration-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2.5">
                        <div className="flex items-center gap-1.5">
                          <code className="text-sm font-mono font-black text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-950/60 px-2.5 py-1 rounded-lg border border-indigo-200 dark:border-indigo-800">
                            {s.session_code}
                          </code>
                          <button
                            onClick={() => handleCopy(s.session_code)}
                            className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                            title="Copy Code"
                          >
                            {copiedCode === s.session_code ? (
                              <Check className="w-3.5 h-3.5 text-emerald-500" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>

                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                            isActive
                              ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700"
                          }`}
                        >
                          {s.status}
                        </span>

                        <span className="text-xs text-slate-600 dark:text-slate-400 font-semibold">
                          {s.participant_count || s.total_participants || 0} Speakers
                        </span>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs text-slate-600 dark:text-slate-400 font-semibold">
                          {s.team_count || 0} Teams
                        </span>
                      </div>

                      <p className="text-xs text-slate-900 dark:text-white font-bold">
                        {s.topic || "Standard Group Discussion"}
                      </p>

                      <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                        <Clock className="w-3 h-3" />
                        {new Date(s.created_at || Date.now()).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isActive ? (
                        <Button
                          onClick={() => {
                            setGdLiveAdminViewCode(s.session_code);
                            setView("gd-live-admin-view");
                            loadGdLiveParticipants(s.session_code);
                          }}
                          className="h-9 px-4 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm"
                        >
                          <Play className="w-3.5 h-3.5 mr-1.5 fill-current" />
                          Host & Manage
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          onClick={() => loadGdLiveLeaderboard(s.session_code)}
                          className="h-9 px-4 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 hover:border-indigo-500"
                        >
                          <Trophy className="w-3.5 h-3.5 mr-1.5 text-amber-500" />
                          Session Standings
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column (4 Cols): Admin Quick Command Bento */}
        <div className="lg:col-span-4 space-y-4">
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Admin Quick Command Center
          </h3>

          <div className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 backdrop-blur-xl shadow-sm space-y-3">
            <button
              onClick={() => loadLeaderboard()}
              className="w-full p-4 rounded-2xl border border-amber-200/80 dark:border-amber-500/20 bg-amber-50/60 dark:bg-amber-950/20 hover:border-amber-400 hover:bg-amber-100/50 transition-all duration-200 text-left flex items-center justify-between group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
                  <Trophy className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                    Global Leaderboard
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Filter ranks by department & year</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
            </button>

            <button
              onClick={() => setView("gd-live-admin")}
              className="w-full p-4 rounded-2xl border border-indigo-200/80 dark:border-indigo-500/20 bg-indigo-50/60 dark:bg-indigo-950/20 hover:border-indigo-400 hover:bg-indigo-100/50 transition-all duration-200 text-left flex items-center justify-between group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                    Live Session Studio
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Configure rooms & team division</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
            </button>

            <button
              onClick={() => setView("reports")}
              className="w-full p-4 rounded-2xl border border-cyan-200/80 dark:border-cyan-500/20 bg-cyan-50/60 dark:bg-cyan-950/20 hover:border-cyan-400 hover:bg-cyan-100/50 transition-all duration-200 text-left flex items-center justify-between group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-100 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-400 flex items-center justify-center font-bold">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors">
                    Export Attendance & Reports
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Download PDF and Excel summaries</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
            </button>

            <button
              onClick={() => setView("settings")}
              className="w-full p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 hover:border-slate-400 transition-all duration-200 text-left flex items-center justify-between group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center font-bold">
                  <Settings className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">System Preferences</h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Audio levels, API, network guard</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
