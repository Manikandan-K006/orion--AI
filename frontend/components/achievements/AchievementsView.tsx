"use client";

import React, { useState } from "react";
import {
  Trophy,
  Award,
  Sparkles,
  Zap,
  CheckCircle2,
  Users,
  Target,
  Shield,
  Flame,
  Crown,
  Medal,
  ArrowRight,
  Lock,
  Check,
  Loader2,
  Building,
  GraduationCap,
  Star,
  FileText,
  Download,
  Clock,
  ChevronRight,
  TrendingUp,
  AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { User, Progress, PageView } from "@/lib/api";

interface AchievementsViewProps {
  user: User;
  progress: Progress | null;
  gdLiveSessions: any[];
  soloHistory: any[];
  cert1Downloading: boolean;
  setCert1Downloading: (b: boolean) => void;
  cert2Downloading: boolean;
  setCert2Downloading: (b: boolean) => void;
  setSuccess: (msg: string) => void;
  setView: (view: PageView) => void;
  startSoloPractice: () => void;
}

export default function AchievementsView({
  user,
  progress,
  gdLiveSessions,
  soloHistory,
  cert1Downloading,
  setCert1Downloading,
  cert2Downloading,
  setCert2Downloading,
  setSuccess,
  setView,
  startSoloPractice
}: AchievementsViewProps) {
  const [badgeFilter, setBadgeFilter] = useState<"all" | "unlocked" | "locked">("all");

  // Oratory Tier Calculation
  const creditPoints = progress && typeof progress.total_credits === "number" ? Math.round(progress.total_credits) : 0;
  const xpPoints = creditPoints * 1000;
  let levelTitle = "Novice Speaker";
  let levelNum = 1;
  let nextLevelPoints = 100000;
  let prevLevelPoints = 0;
  let nextUnlockPerk = "Unlocks Communicator Pro Certification & Tier 2 Badge";
  let tierGradient = "from-slate-500 to-slate-700";
  let tierBadge = "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700";

  if (xpPoints >= 500000) {
    levelTitle = "Grandmaster Orator";
    levelNum = 4;
    nextLevelPoints = 1000000;
    prevLevelPoints = 500000;
    nextUnlockPerk = "Peak Orator Tier Achieved - Permanent Hall of Fame Status";
    tierGradient = "from-amber-400 via-rose-500 to-purple-600";
    tierBadge = "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30";
  } else if (xpPoints >= 250000) {
    levelTitle = "Eloquent Orator";
    levelNum = 3;
    nextLevelPoints = 500000;
    prevLevelPoints = 250000;
    nextUnlockPerk = "Unlocks Grandmaster GD Arena & Advanced Moderator Tools";
    tierGradient = "from-purple-500 to-indigo-600";
    tierBadge = "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30";
  } else if (xpPoints >= 100000) {
    levelTitle = "Confident Communicator";
    levelNum = 2;
    nextLevelPoints = 250000;
    prevLevelPoints = 100000;
    nextUnlockPerk = "Unlocks Advanced Group Discussion Credential";
    tierGradient = "from-cyan-500 to-blue-600";
    tierBadge = "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30";
  }

  const levelProgress = Math.min(100, Math.max(0, ((xpPoints - prevLevelPoints) / (nextLevelPoints - prevLevelPoints)) * 100));

  const completedGdCount = (gdLiveSessions || []).filter((s: any) => s.status === "completed").length;
  const avgScore = progress && progress.average_score != null ? Number(progress.average_score) : 0;

  // Comprehensive Badges Collection with Live Progress
  const allBadges = [
    {
      id: "first_gd",
      title: "First GD Attended",
      desc: "Complete your first live group discussion",
      unlocked: completedGdCount >= 1,
      currentProgress: `${Math.min(1, completedGdCount)} / 1 session`,
      percent: Math.min(100, (completedGdCount / 1) * 100),
      icon: <Users className="w-5 h-5" />,
      color: "from-purple-500 to-indigo-600",
      bgLight: "bg-purple-100 text-purple-600 border-purple-200 dark:bg-purple-950/60 dark:text-purple-400 dark:border-purple-800"
    },
    {
      id: "communicator_pro",
      title: "Communicator Pro",
      desc: "Maintain average speaking score above 80%",
      unlocked: avgScore >= 80,
      currentProgress: `${avgScore.toFixed(1)}% / 80%`,
      percent: Math.min(100, (avgScore / 80) * 100),
      icon: <Trophy className="w-5 h-5" />,
      color: "from-amber-400 to-orange-500",
      bgLight: "bg-amber-100 text-amber-600 border-amber-200 dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-800"
    },
    {
      id: "streak_master",
      title: "Solo Drill Master",
      desc: "Complete 5 individual solo AI practice sessions",
      unlocked: soloHistory.length >= 5,
      currentProgress: `${Math.min(5, soloHistory.length)} / 5 drills`,
      percent: Math.min(100, (soloHistory.length / 5) * 100),
      icon: <Sparkles className="w-5 h-5" />,
      color: "from-emerald-400 to-teal-500",
      bgLight: "bg-emerald-100 text-emerald-600 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800"
    },
    {
      id: "grandmaster",
      title: "GD Grandmaster",
      desc: "Accumulate 500 total discussion credit points",
      unlocked: creditPoints >= 500,
      currentProgress: `${creditPoints} / 500 pts`,
      percent: Math.min(100, (creditPoints / 500) * 100),
      icon: <Zap className="w-5 h-5" />,
      color: "from-cyan-400 to-blue-500",
      bgLight: "bg-cyan-100 text-cyan-600 border-cyan-200 dark:bg-cyan-950/60 dark:text-cyan-400 dark:border-cyan-800"
    },
    {
      id: "high_articulator",
      title: "Active Articulator",
      desc: "Participate in 3 or more group discussions",
      unlocked: completedGdCount >= 3,
      currentProgress: `${Math.min(3, completedGdCount)} / 3 sessions`,
      percent: Math.min(100, (completedGdCount / 3) * 100),
      icon: <Medal className="w-5 h-5" />,
      color: "from-rose-400 to-pink-500",
      bgLight: "bg-rose-100 text-rose-600 border-rose-200 dark:bg-rose-950/60 dark:text-rose-400 dark:border-rose-800"
    },
    {
      id: "clarity_ace",
      title: "Vocal Clarity Ace",
      desc: "Score 85% or higher in Solo Pronunciation",
      unlocked: soloHistory.some((s: any) => (s.accent_score || 0) >= 85),
      currentProgress: soloHistory.length > 0 ? `Best: ${Math.max(...soloHistory.map((s: any) => s.accent_score || 0))}% / 85%` : "0% / 85%",
      percent: soloHistory.length > 0 ? Math.min(100, (Math.max(...soloHistory.map((s: any) => s.accent_score || 0)) / 85) * 100) : 0,
      icon: <Target className="w-5 h-5" />,
      color: "from-indigo-400 to-violet-500",
      bgLight: "bg-indigo-100 text-indigo-600 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-400 dark:border-indigo-800"
    }
  ];

  const filteredBadges = allBadges.filter((b) => {
    if (badgeFilter === "unlocked") return b.unlocked;
    if (badgeFilter === "locked") return !b.unlocked;
    return true;
  });

  const unlockedCount = allBadges.filter((b) => b.unlocked).length;

  // Certifications
  const certs = [
    {
      title: "Speech Competency Certificate",
      type: "AI Speech Clarity & Articulation",
      minScore: 75,
      minCredits: 20,
      completed: avgScore >= 75 && creditPoints >= 20,
      scoreMet: avgScore >= 75,
      creditsMet: creditPoints >= 20,
      downloading: cert1Downloading,
      setDownloading: setCert1Downloading
    },
    {
      title: "Advanced Group Discussion Certificate",
      type: "Live Collaborative GD Mastery",
      minScore: 85,
      minCredits: 30,
      completed: avgScore >= 85 && creditPoints >= 30,
      scoreMet: avgScore >= 85,
      creditsMet: creditPoints >= 30,
      downloading: cert2Downloading,
      setDownloading: setCert2Downloading
    }
  ];

  const handleCertDownload = (cert: (typeof certs)[0]) => {
    cert.setDownloading(true);
    setTimeout(() => {
      cert.setDownloading(false);
      setSuccess(`Official Certificate "${cert.title}" generated and downloaded successfully!`);
    }, 1500);
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-16 animate-fade-up">
      {/* ──────────────────────────────────────────────────────────── */}
      {/* MODERN ACHIEVEMENTS HERO & LEVEL PROGRESSION BANNER */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-indigo-500/20 bg-gradient-to-br from-white/95 via-indigo-50/40 to-purple-50/40 dark:from-slate-900/90 dark:via-indigo-950/40 dark:to-slate-900/90 p-6 md:p-8 backdrop-blur-2xl shadow-xl shadow-slate-200/40 dark:shadow-none">
        {/* Soft Ambient Mesh Accents */}
        <div className="absolute top-0 right-1/4 w-80 h-80 bg-indigo-500/10 dark:bg-indigo-500/15 rounded-full blur-3xl pointer-events-none -z-10" />
        <div className="absolute bottom-0 right-0 w-72 h-72 bg-purple-500/10 dark:bg-purple-500/15 rounded-full blur-3xl pointer-events-none -z-10" />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* Left Column: Orator Level Badge & Identity */}
          <div className="lg:col-span-6 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/25 shadow-sm">
                <Trophy className="w-3.5 h-3.5 text-amber-500" />
                Orator Milestones
              </span>
              <span className={`px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border ${tierBadge}`}>
                Tier {levelNum} of 4
              </span>
            </div>

            <div>
              <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                Speech Achievements & Credentials
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-300 font-medium mt-1">
                Unlock gamified badges, level up your orator tier, and earn verified institutional speaking certificates.
              </p>
            </div>

            {/* Quick Stat Indicators */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <div className="flex items-center gap-2 bg-white/80 dark:bg-slate-950/60 px-3.5 py-1.5 rounded-xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">Badges Unlocked:</span>
                <span className="font-bold text-xs text-indigo-600 dark:text-indigo-400">{unlockedCount} / {allBadges.length}</span>
              </div>
              <div className="flex items-center gap-2 bg-white/80 dark:bg-slate-950/60 px-3.5 py-1.5 rounded-xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">Certifications:</span>
                <span className="font-bold text-xs text-emerald-600 dark:text-emerald-400">
                  {certs.filter((c) => c.completed).length} / 2 Verified
                </span>
              </div>
            </div>
          </div>

          {/* Right Column: Dynamic XP Progress Card */}
          <div className="lg:col-span-6">
            <div className="p-6 rounded-2xl bg-white/90 dark:bg-slate-950/80 border border-indigo-200/80 dark:border-indigo-500/30 backdrop-blur-xl shadow-lg space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-2xl bg-gradient-to-tr ${tierGradient} flex items-center justify-center text-white shadow-md shadow-indigo-500/20`}>
                    <Flame className="w-6 h-6 animate-pulse" />
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 dark:text-slate-400">Current Rank</span>
                    <h3 className="text-base font-extrabold text-slate-900 dark:text-white">{levelTitle}</h3>
                  </div>
                </div>

                <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-1 rounded-lg border border-indigo-200 dark:border-indigo-800">
                  {xpPoints.toLocaleString()} XP
                </span>
              </div>

              {/* Progress Bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600 dark:text-slate-400 font-semibold">Tier Next Level</span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {xpPoints.toLocaleString()} / {nextLevelPoints.toLocaleString()} XP
                  </span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 h-2.5 rounded-full transition-all duration-700"
                    style={{ width: `${levelProgress}%` }}
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1.5 font-medium">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  {nextUnlockPerk}
                </span>
                <span className="font-bold text-indigo-600 dark:text-indigo-400">{Math.round(levelProgress)}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* SPEAKING BADGES SECTION WITH FILTER BAR */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 p-6 md:p-8 backdrop-blur-xl shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Award className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              Unlocked Speaking Badges & Honors
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium">
              Track your milestones across live collaborative rounds and AI drills
            </p>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1 p-1 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-950/70 shrink-0">
            <button
              onClick={() => setBadgeFilter("all")}
              className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                badgeFilter === "all"
                  ? "bg-white dark:bg-indigo-600 text-slate-900 dark:text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              All ({allBadges.length})
            </button>
            <button
              onClick={() => setBadgeFilter("unlocked")}
              className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                badgeFilter === "unlocked"
                  ? "bg-white dark:bg-indigo-600 text-slate-900 dark:text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              Unlocked ({unlockedCount})
            </button>
            <button
              onClick={() => setBadgeFilter("locked")}
              className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                badgeFilter === "locked"
                  ? "bg-white dark:bg-indigo-600 text-slate-900 dark:text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              Locked ({allBadges.length - unlockedCount})
            </button>
          </div>
        </div>

        {/* Badges Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredBadges.map((badge) => (
            <div
              key={badge.id}
              className={`p-5 rounded-2xl border transition-all duration-200 flex flex-col justify-between relative overflow-hidden ${
                badge.unlocked
                  ? "border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-950/60 shadow-sm hover:shadow-md hover:-translate-y-0.5"
                  : "border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30 opacity-75"
              }`}
            >
              <div>
                <div className="flex items-start justify-between mb-3">
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold shadow-sm ${
                      badge.unlocked
                        ? `bg-gradient-to-tr ${badge.color} text-white shadow-indigo-500/20`
                        : "bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500"
                    }`}
                  >
                    {badge.icon}
                  </div>

                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                      badge.unlocked
                        ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700"
                    }`}
                  >
                    {badge.unlocked ? "Unlocked" : "Locked"}
                  </span>
                </div>

                <h4 className="text-sm font-bold text-slate-900 dark:text-white">{badge.title}</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-snug">{badge.desc}</p>
              </div>

              {/* Progress Toward Unlock */}
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                <div className="flex justify-between items-center text-[10px]">
                  <span className="font-semibold text-slate-500 dark:text-slate-400">Criteria Progress</span>
                  <span className={`font-bold ${badge.unlocked ? "text-emerald-600 dark:text-emerald-400" : "text-slate-700 dark:text-slate-300"}`}>
                    {badge.currentProgress}
                  </span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-500 ${
                      badge.unlocked
                        ? "bg-emerald-500"
                        : "bg-indigo-500/60"
                    }`}
                    style={{ width: `${badge.percent}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* INSTITUTIONAL AI CERTIFICATIONS & CREDENTIALS CENTER */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 p-6 md:p-8 backdrop-blur-xl shadow-sm space-y-6">
        <div className="pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              Official Institutional AI Certifications
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
            Earn verified digital credentials backed by Mount Zion College of Engineering and Technology AI speaking telemetry.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {certs.map((cert) => (
            <div
              key={cert.title}
              className={`rounded-2xl border p-6 flex flex-col justify-between relative overflow-hidden transition-all duration-200 ${
                cert.completed
                  ? "border-emerald-500/30 bg-gradient-to-br from-emerald-50/50 via-white to-indigo-50/30 dark:from-emerald-950/20 dark:via-slate-900 dark:to-indigo-950/20 shadow-md"
                  : "border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-950/60 shadow-sm"
              }`}
            >
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="text-[10px] uppercase font-black tracking-widest text-indigo-600 dark:text-indigo-400 block">
                      {cert.type}
                    </span>
                    <h4 className="text-base font-extrabold text-slate-900 dark:text-white mt-1">
                      {cert.title}
                    </h4>
                  </div>

                  <span
                    className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider shrink-0 border ${
                      cert.completed
                        ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 shadow-sm"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700"
                    }`}
                  >
                    {cert.completed ? "Verified Credential" : "Requirements Pending"}
                  </span>
                </div>

                {/* Criteria Checklist */}
                <div className="p-3.5 rounded-xl bg-slate-50/80 dark:bg-slate-900/80 border border-slate-200/70 dark:border-slate-800 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 font-medium">
                      {cert.scoreMet ? (
                        <Check className="w-4 h-4 text-emerald-500 stroke-[3]" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-amber-500" />
                      )}
                      Min. {cert.minScore}% Average Score
                    </span>
                    <span className={`font-bold ${cert.scoreMet ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                      {avgScore.toFixed(1)}%
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 font-medium">
                      {cert.creditsMet ? (
                        <Check className="w-4 h-4 text-emerald-500 stroke-[3]" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-amber-500" />
                      )}
                      Min. {cert.minCredits} Discussion Credits
                    </span>
                    <span className={`font-bold ${cert.creditsMet ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                      {creditPoints} PTS
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <Building className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Mount Zion College of Engineering and Technology</span>
                </div>
              </div>

              {/* Action Button */}
              <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
                {cert.completed ? (
                  <Button
                    onClick={() => handleCertDownload(cert)}
                    disabled={cert.downloading}
                    className="w-full h-11 text-xs font-bold rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-600/25 border-0 flex items-center justify-center gap-2 transition-all"
                  >
                    {cert.downloading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Generating Digital Certificate...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        <span>Download Official Certificate (PDF)</span>
                      </>
                    )}
                  </Button>
                ) : (
                  <Button
                    onClick={() => setView("dashboard")}
                    variant="secondary"
                    className="w-full h-11 text-xs font-bold rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-2"
                  >
                    <span>Complete More Discussions to Unlock</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
