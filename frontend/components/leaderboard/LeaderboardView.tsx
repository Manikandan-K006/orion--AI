"use client";

import React, { useState } from "react";
import {
  Trophy,
  Award,
  Users,
  TrendingUp,
  MessageSquare,
  RefreshCw,
  ArrowLeft,
  Search,
  Sparkles,
  Crown,
  Medal,
  Clock,
  Shield,
  Zap,
  BarChart2,
  ChevronUp,
  ChevronDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ComprehensiveLeaderboard, PageView, User } from "@/lib/api";

interface LeaderboardViewProps {
  lbData: ComprehensiveLeaderboard | null;
  lbDepartment: string;
  lbYear: string;
  lbTimeframe: string;
  lbLastUpdated: string;
  loadLeaderboard: (dept?: string, year?: string, timeframe?: string, forceRefresh?: boolean) => void;
  setView: (view: PageView) => void;
  user: User;
}

export default function LeaderboardView({
  lbData,
  lbDepartment,
  lbYear,
  lbTimeframe,
  lbLastUpdated,
  loadLeaderboard,
  setView,
  user
}: LeaderboardViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadLeaderboard(lbDepartment, lbYear, lbTimeframe, true);
    setTimeout(() => setRefreshing(false), 500);
  };

  const rankings = lbData?.rankings || [];
  const filteredRankings = rankings.filter((r) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.name?.toLowerCase().includes(q) ||
      r.department?.toLowerCase().includes(q) ||
      r.year?.toLowerCase().includes(q)
    );
  });

  const top1 = rankings[0] || null;
  const top2 = rankings[1] || null;
  const top3 = rankings[2] || null;

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-16 animate-fade-up">
      {/* ──────────────────────────────────────────────────────────── */}
      {/* MODERN LEADERBOARD HERO & REAL-TIME CONTROLS */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-indigo-500/20 bg-gradient-to-br from-white/95 via-amber-50/30 to-purple-50/30 dark:from-slate-900/90 dark:via-indigo-950/40 dark:to-slate-900/90 p-6 md:p-8 backdrop-blur-2xl shadow-xl shadow-slate-200/40 dark:shadow-none">
        {/* Soft Ambient Gold/Purple Mesh */}
        <div className="absolute top-0 right-1/4 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none -z-10" />
        <div className="absolute bottom-0 right-0 w-72 h-72 bg-purple-500/10 rounded-full blur-3xl pointer-events-none -z-10" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/25 shadow-sm">
                <Trophy className="w-3.5 h-3.5 text-amber-500" />
                Orator Standings
              </span>
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20 shadow-sm">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                LIVE REAL-TIME {lbLastUpdated ? `• ${lbLastUpdated}` : ""}
              </span>
            </div>

            <div>
              <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                College Speech Leaderboard
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-300 font-medium max-w-xl mt-1">
                Official speaking performance and communication rankings across engineering departments at Mount Zion.
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2.5 shrink-0">
            <Button
              onClick={handleRefresh}
              variant="secondary"
              disabled={refreshing}
              className="h-10 px-4 text-xs font-bold rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-white shadow-sm flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin text-indigo-600" : ""}`} />
              <span>Refresh</span>
            </Button>

            <Button
              onClick={() => setView("dashboard")}
              className="h-10 px-4 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20 border-0 flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Dashboard</span>
            </Button>
          </div>
        </div>

        {/* ──────────────────────────────────────────────────────────── */}
        {/* MODERN FILTER MATRIX PILLS */}
        {/* ──────────────────────────────────────────────────────────── */}
        <div className="mt-6 pt-5 border-t border-slate-200/70 dark:border-slate-800 space-y-3.5">
          {/* Department Filter */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 w-24 shrink-0">Department:</span>
            <div className="flex flex-wrap gap-1.5 flex-1">
              {(lbData?.departments || ["ALL"]).map((d) => {
                const isSelected = lbDepartment === d;
                return (
                  <button
                    key={d}
                    onClick={() => loadLeaderboard(d, lbYear, lbTimeframe)}
                    className={`text-xs px-3.5 py-1 rounded-xl font-bold transition-all duration-200 ${
                      isSelected
                        ? "bg-amber-500 text-slate-950 shadow-sm shadow-amber-500/20 scale-105"
                        : "bg-white/60 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                    }`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Year Filter */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 w-24 shrink-0">Year:</span>
            <div className="flex flex-wrap gap-1.5 flex-1">
              {(lbData?.years || ["ALL"]).map((y) => {
                const isSelected = lbYear === y;
                return (
                  <button
                    key={y}
                    onClick={() => loadLeaderboard(lbDepartment, y, lbTimeframe)}
                    className={`text-xs px-3.5 py-1 rounded-xl font-bold transition-all duration-200 ${
                      isSelected
                        ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/20 scale-105"
                        : "bg-white/60 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                    }`}
                  >
                    {y}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Timeframe Filter */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400 w-24 shrink-0">Timeframe:</span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { v: "all", l: "All Time" },
                  { v: "this_month", l: "This Month" },
                  { v: "past_month", l: "Past Month" }
                ].map((t) => {
                  const isSelected = lbTimeframe === t.v;
                  return (
                    <button
                      key={t.v}
                      onClick={() => loadLeaderboard(lbDepartment, lbYear, t.v)}
                      className={`text-xs px-3.5 py-1 rounded-xl font-bold transition-all duration-200 ${
                        isSelected
                          ? "bg-purple-600 text-white shadow-sm shadow-purple-600/20 scale-105"
                          : "bg-white/60 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                    >
                      {t.l}
                    </button>
                  );
                })}
              </div>
            </div>

            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              Scored by Discussion Credits & Evaluations
            </span>
          </div>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 4 MODERN KPI STATS CARDS */}
      {/* ──────────────────────────────────────────────────────────── */}
      {lbData && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 backdrop-blur-xl shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Top Score
              </span>
              <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                <Trophy className="w-4 h-4" />
              </div>
            </div>
            <p className="text-3xl font-black text-amber-600 dark:text-amber-400 mt-3">
              {typeof lbData.stats.top_score === "number" ? Number(lbData.stats.top_score).toFixed(1) : lbData.stats.top_score}
            </p>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 block">Highest rank recorded</span>
          </div>

          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 backdrop-blur-xl shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Active Speakers
              </span>
              <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Users className="w-4 h-4" />
              </div>
            </div>
            <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400 mt-3">
              {lbData.stats.active_participants}
            </p>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 block">Participating debaters</span>
          </div>

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
              {typeof lbData.stats.average_score === "number" ? Number(lbData.stats.average_score).toFixed(1) : lbData.stats.average_score}
            </p>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 block">Cohort mean evaluation</span>
          </div>

          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 backdrop-blur-xl shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                GD Interviews
              </span>
              <div className="w-8 h-8 rounded-xl bg-cyan-100 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-400 flex items-center justify-center">
                <MessageSquare className="w-4 h-4" />
              </div>
            </div>
            <p className="text-3xl font-black text-cyan-600 dark:text-cyan-400 mt-3">
              {lbData.stats.total_interviews}
            </p>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 block">Discussion rounds completed</span>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────── */}
      {/* TOP ORATOR PODIUM SHOWCASE (1st, 2nd, 3rd) */}
      {/* ──────────────────────────────────────────────────────────── */}
      {rankings.length > 0 && (
        <div className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 p-6 md:p-8 backdrop-blur-xl shadow-sm">
          <div className="text-center mb-6">
            <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/25">
              Honor Roll
            </span>
            <h3 className="text-xl font-extrabold text-slate-900 dark:text-white mt-1">
              Top Orator Podium
            </h3>
          </div>

          <div className="flex items-end justify-center gap-4 sm:gap-6 max-w-2xl mx-auto pt-4 select-none">
            {/* 2nd Place (Silver) */}
            {top2 ? (
              <div className="flex flex-col items-center flex-1 max-w-[170px]">
                <div className="relative group">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-slate-300 to-slate-400 dark:from-slate-600 dark:to-slate-700 p-0.5 shadow-lg flex items-center justify-center">
                    <div className="w-full h-full rounded-[14px] bg-white dark:bg-slate-950 flex items-center justify-center font-black text-xl text-slate-800 dark:text-white">
                      {top2.name ? top2.name[0].toUpperCase() : "2"}
                    </div>
                  </div>
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-slate-500 text-white text-[10px] px-2 py-0.5 rounded-full font-black uppercase shadow-sm">
                    2nd
                  </span>
                </div>

                <p className="text-xs font-bold text-slate-900 dark:text-white mt-3 text-center truncate max-w-full">
                  {top2.name}
                </p>
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  {top2.department} · {top2.total_credits} pts
                </p>

                {/* Pedestal Bar */}
                <div className="w-full h-24 rounded-t-2xl bg-gradient-to-t from-slate-200 to-slate-100 dark:from-slate-800 dark:to-slate-800/40 border-t-2 border-slate-300 dark:border-slate-600 mt-3 flex items-center justify-center font-black text-slate-400 dark:text-slate-600 text-3xl">
                  II
                </div>
              </div>
            ) : null}

            {/* 1st Place (Gold Champion) */}
            {top1 ? (
              <div className="flex flex-col items-center flex-1 max-w-[190px]">
                <div className="relative group">
                  <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-amber-300 via-amber-400 to-yellow-500 p-1 shadow-xl shadow-amber-500/25 flex items-center justify-center">
                    <div className="w-full h-full rounded-[20px] bg-white dark:bg-slate-950 flex items-center justify-center font-black text-2xl text-slate-900 dark:text-white">
                      {top1.name ? top1.name[0].toUpperCase() : "1"}
                    </div>
                  </div>
                  <Crown className="absolute -top-6 text-amber-500 w-7 h-7 drop-shadow-md animate-bounce" />
                  <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-amber-500 text-slate-950 text-[10px] px-2.5 py-0.5 rounded-full font-black uppercase shadow-sm">
                    Champion
                  </span>
                </div>

                <p className="text-sm font-extrabold text-slate-900 dark:text-white mt-4 text-center truncate max-w-full">
                  {top1.name}
                </p>
                <p className="text-xs font-bold text-amber-600 dark:text-amber-400">
                  {top1.department} · {top1.total_credits} pts
                </p>

                {/* Pedestal Bar */}
                <div className="w-full h-36 rounded-t-2xl bg-gradient-to-t from-amber-200 to-amber-100/60 dark:from-amber-950/40 dark:to-amber-900/20 border-t-2 border-amber-400 mt-3 flex items-center justify-center font-black text-amber-500/50 text-4xl">
                  I
                </div>
              </div>
            ) : null}

            {/* 3rd Place (Bronze) */}
            {top3 ? (
              <div className="flex flex-col items-center flex-1 max-w-[170px]">
                <div className="relative group">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-600 to-orange-600 p-0.5 shadow-lg flex items-center justify-center">
                    <div className="w-full h-full rounded-[14px] bg-white dark:bg-slate-950 flex items-center justify-center font-black text-xl text-slate-800 dark:text-white">
                      {top3.name ? top3.name[0].toUpperCase() : "3"}
                    </div>
                  </div>
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-orange-500 text-white text-[10px] px-2 py-0.5 rounded-full font-black uppercase shadow-sm">
                    3rd
                  </span>
                </div>

                <p className="text-xs font-bold text-slate-900 dark:text-white mt-3 text-center truncate max-w-full">
                  {top3.name}
                </p>
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  {top3.department} · {top3.total_credits} pts
                </p>

                {/* Pedestal Bar */}
                <div className="w-full h-20 rounded-t-2xl bg-gradient-to-t from-orange-100 to-orange-50 dark:from-orange-950/30 dark:to-orange-900/10 border-t-2 border-orange-400 mt-3 flex items-center justify-center font-black text-orange-400/50 text-2xl">
                  III
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────── */}
      {/* MODERN RANKINGS TABLE CARD */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 p-6 md:p-8 backdrop-blur-xl shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Award className="w-5 h-5 text-amber-500" />
              Full Cohort Rankings
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Showing {filteredRankings.length} registered students evaluated
            </p>
          </div>

          {/* Quick Search */}
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              type="text"
              placeholder="Search by student or dept..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-3 h-10 text-xs rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400"
            />
          </div>
        </div>

        {filteredRankings.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-3">Rank</th>
                  <th className="py-3 px-3">Student Name</th>
                  <th className="py-3 px-3">Department</th>
                  <th className="py-3 px-3 hidden md:table-cell">Year</th>
                  <th className="py-3 px-3 text-right">Credits</th>
                  <th className="py-3 px-3 text-right">Grammar</th>
                  <th className="py-3 px-3 text-right">Fluency</th>
                  <th className="py-3 px-3 text-right hidden sm:table-cell">Confidence</th>
                  <th className="py-3 px-3 text-right hidden sm:table-cell">Rounds</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs font-semibold">
                {filteredRankings.map((r) => {
                  const isTop1 = r.rank === 1;
                  const isTop2 = r.rank === 2;
                  const isTop3 = r.rank === 3;
                  const isCurrentStudent = user && r.name && user.name && r.name.toLowerCase() === user.name.toLowerCase();

                  return (
                    <tr
                      key={r.id || r.rank}
                      className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors ${
                        isCurrentStudent ? "bg-indigo-50/50 dark:bg-indigo-950/30" : ""
                      }`}
                    >
                      {/* Rank Badge */}
                      <td className="py-3.5 px-3">
                        <span
                          className={`inline-flex items-center justify-center w-7 h-7 rounded-xl text-xs font-black shadow-sm ${
                            isTop1
                              ? "bg-amber-400 text-slate-950"
                              : isTop2
                              ? "bg-slate-300 dark:bg-slate-600 text-slate-950 dark:text-white"
                              : isTop3
                              ? "bg-orange-400 text-slate-950"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                          }`}
                        >
                          {r.rank}
                        </span>
                      </td>

                      {/* Name */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {r.name ? r.name[0].toUpperCase() : "U"}
                          </div>
                          <div>
                            <p className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                              <span>{r.name}</span>
                              {isCurrentStudent && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                                  You
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Department */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {r.department}
                        </span>
                      </td>

                      {/* Year */}
                      <td className="py-3.5 px-3 whitespace-nowrap hidden md:table-cell text-slate-500 dark:text-slate-400">
                        {r.year}
                      </td>

                      {/* Score / Credits */}
                      <td className="py-3.5 px-3 whitespace-nowrap text-right font-black text-amber-600 dark:text-amber-400">
                        {r.total_credits} <span className="text-[10px] font-normal text-slate-400">pts</span>
                      </td>

                      {/* Grammar */}
                      <td className="py-3.5 px-3 whitespace-nowrap text-right font-bold text-indigo-600 dark:text-indigo-400">
                        {(r.grammar != null ? Number(r.grammar) : 0).toFixed(1)}
                      </td>

                      {/* Fluency */}
                      <td className="py-3.5 px-3 whitespace-nowrap text-right font-bold text-purple-600 dark:text-purple-400">
                        {(r.fluency != null ? Number(r.fluency) : 0).toFixed(1)}
                      </td>

                      {/* Confidence */}
                      <td className="py-3.5 px-3 whitespace-nowrap text-right hidden sm:table-cell font-bold text-cyan-600 dark:text-cyan-400">
                        {(r.relevance != null ? Number(r.relevance) : 0).toFixed(1)}
                      </td>

                      {/* Completed Rounds */}
                      <td className="py-3.5 px-3 whitespace-nowrap text-right hidden sm:table-cell text-slate-500 dark:text-slate-400">
                        {r.sessions_completed} rounds
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-12 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20">
            <Trophy className="w-10 h-10 text-slate-400 mx-auto mb-2" />
            <p className="text-sm font-bold text-slate-900 dark:text-white">No Rankings Found</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              No evaluated records match your selected filters or search query.
            </p>
          </div>
        )}
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* ALL TIME ACHIEVERS SHOWCASE BENTO */}
      {/* ──────────────────────────────────────────────────────────── */}
      {lbData && lbData.all_time_achievers && lbData.all_time_achievers.length > 0 && (
        <div className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-6 md:p-8 backdrop-blur-xl shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Medal className="w-5 h-5 text-amber-500" />
              All-Time Oratory Achievers
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold">
              Top speech legends
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {lbData.all_time_achievers.map((a) => (
              <div
                key={a.id || a.rank}
                className="p-4 rounded-2xl bg-white/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 hover:border-amber-500/40 transition-all duration-200 flex items-center justify-between gap-3 shadow-sm"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs shrink-0 shadow-sm ${
                      a.rank === 1
                        ? "bg-amber-400 text-slate-950"
                        : a.rank === 2
                        ? "bg-slate-300 dark:bg-slate-600 text-slate-950 dark:text-white"
                        : a.rank === 3
                        ? "bg-orange-400 text-slate-950"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    #{a.rank}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{a.name}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                      {a.department} · {a.year}
                    </p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <p className="text-xs font-black text-amber-600 dark:text-amber-400">{a.total_credits} pts</p>
                  <p className="text-[9px] text-slate-400 font-medium">{a.sessions_completed} sessions</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
