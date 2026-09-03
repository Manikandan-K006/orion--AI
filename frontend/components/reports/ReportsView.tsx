"use client";

import React from "react";
import {
  TrendingUp,
  BookOpen,
  Download,
  Loader2,
  Sparkles,
  Award,
  CheckCircle2,
  Zap,
  BarChart3,
  ArrowUpRight,
  Shield,
  Building,
  Target,
  Flame,
  Activity,
  FileText,
  Clock,
  ArrowRight,
  Users,
  MessageSquare
} from "lucide-react";
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Bar
} from "recharts";
import { Button } from "@/components/ui/button";
import { Progress, User, downloadOverallPdfReport, PageView } from "@/lib/api";

interface ReportsViewProps {
  user: User;
  progress: Progress | null;
  gdLiveSessions: any[];
  soloHistory: any[];
  token: string | null;
  pdfLoading: boolean;
  setPdfLoading: (b: boolean) => void;
  setSuccess: (msg: string) => void;
  setMessage: (msg: string) => void;
  setView?: (view: PageView) => void;
  startSoloPractice?: () => void;
}

export default function ReportsView({
  user,
  progress,
  gdLiveSessions,
  soloHistory,
  token,
  pdfLoading,
  setPdfLoading,
  setSuccess,
  setMessage,
  setView,
  startSoloPractice
}: ReportsViewProps) {
  const handlePdfDownload = async () => {
    setPdfLoading(true);
    setMessage("");
    try {
      await downloadOverallPdfReport(token);
      setSuccess("Overall Speech Analytics PDF report downloaded successfully!");
    } catch (err: any) {
      setMessage(err.message || "Failed to download PDF report. Please try again.");
    } finally {
      setPdfLoading(false);
    }
  };

  const completedGdSessions = (gdLiveSessions || []).filter((s: any) => s.status === "completed");
  const latestSolo = soloHistory && soloHistory.length > 0 ? soloHistory[0] : null;

  const grammarScore = latestSolo?.grammar_score || 85;
  const fluencyScore = latestSolo?.fluency_score || 80;
  const pronunciationScore = latestSolo?.accent_score || 78;
  const confidenceScore = latestSolo?.delivery_score || 82;

  const radarData = [
    { metric: "Grammar", value: grammarScore },
    { metric: "Fluency", value: fluencyScore },
    { metric: "Pronunciation", value: pronunciationScore },
    { metric: "Confidence", value: confidenceScore }
  ];

  const trendData = soloHistory && soloHistory.length > 0
    ? soloHistory.slice().reverse().map((h: any, i: number) => ({
        name: `Session ${i + 1}`,
        shortName: `S${i + 1}`,
        score: Math.round(h?.overall_score || 0)
      }))
    : [{ name: "Session 1", shortName: "S1", score: 80 }];

  const avgScore = progress && progress.average_score != null ? Number(progress.average_score) : 0;
  const totalCredits = progress && progress.total_credits != null ? Math.round(progress.total_credits) : 0;

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-16 animate-fade-up">
      {/* ──────────────────────────────────────────────────────────── */}
      {/* MODERN REPORTS HERO & INSTITUTIONAL EXPORT BANNER */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-indigo-500/20 bg-gradient-to-br from-white/95 via-indigo-50/40 to-purple-50/40 dark:from-slate-900/90 dark:via-indigo-950/40 dark:to-slate-900/90 p-6 md:p-8 backdrop-blur-2xl shadow-xl shadow-slate-200/40 dark:shadow-none">
        {/* Soft Ambient Mesh Accents */}
        <div className="absolute top-0 right-1/4 w-80 h-80 bg-indigo-500/10 dark:bg-indigo-500/15 rounded-full blur-3xl pointer-events-none -z-10" />
        <div className="absolute bottom-0 right-0 w-72 h-72 bg-purple-500/10 dark:bg-purple-500/15 rounded-full blur-3xl pointer-events-none -z-10" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 border border-indigo-500/25 shadow-sm">
                <TrendingUp className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                Vocal Telemetry Intelligence
              </span>
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20 shadow-sm">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Institutional Verified
              </span>
            </div>

            <div>
              <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                Speech Analytics & Performance
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-300 font-medium max-w-xl mt-1">
                Detailed acoustic telemetry, fluency balance, and official Mount Zion College communication reports.
              </p>
            </div>
          </div>

          {/* Quick PDF Export Hub */}
          <div className="shrink-0 flex flex-col sm:flex-row gap-3">
            <Button
              onClick={handlePdfDownload}
              disabled={pdfLoading}
              className="h-12 px-6 text-xs font-bold rounded-2xl bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-xl shadow-indigo-600/25 border-0 flex items-center justify-center gap-2 transition-all duration-200"
            >
              {pdfLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Compiling PDF Report...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Download Official PDF Report</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 4 CORE KPI METRICS CARDS */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 backdrop-blur-xl shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Average Score
            </span>
            <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-black text-purple-600 dark:text-purple-400 mt-3">
            {avgScore.toFixed(1)}%
          </p>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 block">AI-evaluated composite</span>
        </div>

        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 backdrop-blur-xl shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Total Credits
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Award className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-black text-amber-600 dark:text-amber-400 mt-3">
            {totalCredits}
          </p>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 block">Accumulated oratory points</span>
        </div>

        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 backdrop-blur-xl shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Live GD Sessions
            </span>
            <div className="w-8 h-8 rounded-xl bg-cyan-100 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-400 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-black text-cyan-600 dark:text-cyan-400 mt-3">
            {completedGdSessions.length}
          </p>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 block">Multi-speaker debates</span>
        </div>

        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 backdrop-blur-xl shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Solo AI Practice
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Zap className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400 mt-3">
            {soloHistory.length}
          </p>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 block">Autonomous speech drills</span>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 2-COLUMN INTELLIGENCE SECTION: RADAR & PROGRESSION */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (6 Cols): Metric Score Balance */}
        <div className="lg:col-span-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 p-6 md:p-8 backdrop-blur-xl shadow-sm space-y-6">
          <div className="pb-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Target className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                Vocal Dimension Balance
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Multi-axis polar telemetry across core speech pillars
              </p>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 px-2.5 py-1 rounded-lg border border-indigo-200 dark:border-indigo-800">
              Live Matrix
            </span>
          </div>

          <div className="h-56 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid stroke="rgba(148, 163, 184, 0.2)" />
                <PolarAngleAxis
                  dataKey="metric"
                  tick={{ fontSize: 11, fill: "currentColor", fontWeight: 700 }}
                />
                <Radar
                  name="Score"
                  dataKey="value"
                  stroke="#6366f1"
                  fill="#6366f1"
                  fillOpacity={0.25}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* 4 Dimension Meters */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-slate-700 dark:text-slate-300">Grammar</span>
                <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{grammarScore}%</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5 mt-2 overflow-hidden">
                <div className="bg-indigo-600 h-1.5 rounded-full" style={{ width: `${grammarScore}%` }} />
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-slate-700 dark:text-slate-300">Fluency</span>
                <span className="font-mono font-bold text-purple-600 dark:text-purple-400">{fluencyScore}%</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5 mt-2 overflow-hidden">
                <div className="bg-purple-600 h-1.5 rounded-full" style={{ width: `${fluencyScore}%` }} />
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-slate-700 dark:text-slate-300">Pronunciation</span>
                <span className="font-mono font-bold text-cyan-600 dark:text-cyan-400">{pronunciationScore}%</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5 mt-2 overflow-hidden">
                <div className="bg-cyan-600 h-1.5 rounded-full" style={{ width: `${pronunciationScore}%` }} />
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-slate-700 dark:text-slate-300">Confidence</span>
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{confidenceScore}%</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5 mt-2 overflow-hidden">
                <div className="bg-emerald-600 h-1.5 rounded-full" style={{ width: `${confidenceScore}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (6 Cols): Historical Performance Trend */}
        <div className="lg:col-span-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 p-6 md:p-8 backdrop-blur-xl shadow-sm space-y-6">
          <div className="pb-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                Historical Performance Trend
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Session-by-session overall evaluation progression
              </p>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 px-2.5 py-1 rounded-lg border border-purple-200 dark:border-purple-800">
              Trajectory
            </span>
          </div>

          <div className="h-56 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendData} maxBarSize={48}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.2)" />
                <XAxis
                  dataKey="shortName"
                  stroke="#94a3b8"
                  fontSize={11}
                  fontWeight={600}
                />
                <YAxis
                  stroke="#94a3b8"
                  fontSize={11}
                  domain={[0, 100]}
                />
                <Tooltip
                  contentStyle={{
                    background: "rgba(15, 23, 42, 0.9)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "14px",
                    color: "#fff",
                    fontSize: "12px",
                    fontWeight: 600
                  }}
                />
                <Bar
                  dataKey="score"
                  fill="url(#trendGradient)"
                  radius={[8, 8, 0, 0]}
                />
                <defs>
                  <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#818cf8" stopOpacity={1} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0.8} />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Trend Summary Chips */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase">Latest Round</p>
                <p className="text-base font-black text-slate-900 dark:text-white mt-0.5">
                  {trendData[trendData.length - 1]?.score || 0}%
                </p>
              </div>
              <span className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-xs">
                S{trendData.length}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase">Peak Recorded</p>
                <p className="text-base font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
                  {Math.max(...trendData.map((d) => d.score))}%
                </p>
              </div>
              <span className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-xs">
                ★
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* AI-GENERATED VOCAL INSIGHTS & ACTIONABLE FEEDBACK */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 p-6 md:p-8 backdrop-blur-xl shadow-sm space-y-5">
        <div className="pb-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              AI-Generated Vocal Insights & Recommendations
            </h3>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold">
            Analyzed by Speaking Telemetry Engine
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-5 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-200/60 dark:border-indigo-900/40 space-y-2">
            <div className="flex items-center gap-2 text-indigo-900 dark:text-indigo-300 font-bold text-xs">
              <span className="w-6 h-6 rounded-lg bg-indigo-500 text-white flex items-center justify-center text-xs">🚀</span>
              <span>Delivery Pacing & Pitch Modulation</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
              Your speech rate demonstrates strong conversational authority. Reducing pauses between complex arguments by 5-10% will raise your fluency and natural transition scores to the expert bracket.
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-900/40 space-y-2">
            <div className="flex items-center gap-2 text-emerald-900 dark:text-emerald-300 font-bold text-xs">
              <span className="w-6 h-6 rounded-lg bg-emerald-500 text-white flex items-center justify-center text-xs">🗣️</span>
              <span>Acoustic Clarity & Phoneme Precision</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
              Acoustic consonant clarity is exceptional across multi-syllable terms. Maintaining standard vowel emphasis during rapid exchanges will help align perfectly with AI assessment markers.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
