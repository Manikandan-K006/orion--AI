"use client";

import React, { useState } from "react";
import {
  User as UserIcon,
  Mail,
  Award,
  Shield,
  Lock,
  Eye,
  EyeOff,
  Copy,
  Check,
  Sparkles,
  CheckCircle2,
  Calendar,
  KeyRound,
  ShieldCheck,
  AlertCircle,
  Loader2,
  Trophy,
  Flame,
  Building,
  GraduationCap,
  Hash,
  ArrowRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { User, Progress, changePassword } from "@/lib/api";

interface ProfileViewProps {
  user: User;
  token: string | null;
  progress: Progress | null;
  setSuccess: (msg: string) => void;
  setMessage: (msg: string) => void;
}

export default function ProfileView({
  user,
  token,
  progress,
  setSuccess,
  setMessage
}: ProfileViewProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Password strength calculation
  const getPasswordStrength = (pwd: string) => {
    if (!pwd) return { score: 0, label: "None", color: "bg-slate-200 dark:bg-slate-800" };
    let score = 0;
    if (pwd.length >= 8) score += 1;
    if (pwd.length >= 12) score += 1;
    if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score += 1;
    if (/\d/.test(pwd)) score += 1;
    if (/[^A-Za-z0-9]/.test(pwd)) score += 1;

    if (score <= 1) return { score: 25, label: "Weak", color: "bg-rose-500", text: "text-rose-500" };
    if (score === 2) return { score: 50, label: "Fair", color: "bg-amber-500", text: "text-amber-500" };
    if (score === 3 || score === 4) return { score: 75, label: "Good", color: "bg-indigo-500", text: "text-indigo-500" };
    return { score: 100, label: "Strong", color: "bg-emerald-500", text: "text-emerald-500" };
  };

  const strength = getPasswordStrength(newPassword);
  const passwordsMatch = newPassword && confirmPassword && newPassword === confirmPassword;

  // Gamification stats
  const creditPoints = progress && typeof progress.total_credits === "number" ? Math.round(progress.total_credits) : 0;
  const xpPoints = creditPoints * 1000;
  let levelTitle = "Novice Speaker";
  let levelNum = 1;
  let nextLevelPoints = 100000;
  let prevLevelPoints = 0;

  if (xpPoints >= 500000) {
    levelTitle = "Grandmaster Orator";
    levelNum = 4;
    nextLevelPoints = 1000000;
    prevLevelPoints = 500000;
  } else if (xpPoints >= 250000) {
    levelTitle = "Eloquent Orator";
    levelNum = 3;
    nextLevelPoints = 500000;
    prevLevelPoints = 250000;
  } else if (xpPoints >= 100000) {
    levelTitle = "Confident Communicator";
    levelNum = 2;
    nextLevelPoints = 250000;
    prevLevelPoints = 100000;
  }

  const levelProgress = Math.min(100, Math.max(0, ((xpPoints - prevLevelPoints) / (nextLevelPoints - prevLevelPoints)) * 100));

  const initials = user.name
    ? user.name
        .split(/\s+/)
        .filter(Boolean)
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "US";

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setMessage("New password must be at least 8 characters long");
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage("New passwords do not match");
      return;
    }
    if (!token) {
      setMessage("Authentication session expired. Please sign in again.");
      return;
    }

    try {
      setLoading(true);
      const res = await changePassword({ current_password: currentPassword, new_password: newPassword }, token);
      setSuccess(res.message || "Password updated successfully!");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setMessage(err.message || "Failed to update password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12 animate-fade-up">
      {/* ──────────────────────────────────────────────────────────── */}
      {/* MODERN PROFILE COVER & IDENTITY HEADER CARD */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-indigo-500/20 bg-gradient-to-br from-white/95 via-indigo-50/40 to-purple-50/40 dark:from-slate-900/90 dark:via-indigo-950/40 dark:to-slate-900/90 p-6 md:p-8 backdrop-blur-2xl shadow-xl shadow-slate-200/40 dark:shadow-none">
        {/* Soft Background Mesh Accents */}
        <div className="absolute top-0 right-1/4 w-80 h-80 bg-indigo-500/10 dark:bg-indigo-500/15 rounded-full blur-3xl pointer-events-none -z-10" />
        <div className="absolute bottom-0 right-0 w-72 h-72 bg-purple-500/10 dark:bg-purple-500/15 rounded-full blur-3xl pointer-events-none -z-10" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 text-center sm:text-left">
            {/* Modern Avatar with Active Glow Ring */}
            <div className="relative group shrink-0">
              <div className="w-24 h-24 rounded-3xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 p-1 shadow-xl shadow-indigo-500/25 group-hover:scale-105 transition-transform duration-300">
                <div className="w-full h-full rounded-[22px] bg-white dark:bg-slate-950 flex items-center justify-center font-black text-3xl text-slate-900 dark:text-white tracking-tight">
                  {initials}
                </div>
              </div>
              <span className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-950 shadow-sm" />
            </div>

            {/* Profile Info */}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider border ${
                  user.role === "admin"
                    ? "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30"
                    : "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 border-indigo-500/30"
                }`}>
                  {user.role === "admin" ? "Administrator" : "Student"}
                </span>

                {user.department && (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/20">
                    {user.department} {user.year ? `· ${user.year}` : ""}
                  </span>
                )}

                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Active / Verified
                </span>
              </div>

              <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                {user.name}
              </h1>

              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium flex items-center justify-center sm:justify-start gap-2">
                <Building className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                <span>Mount Zion College of Engineering and Technology</span>
              </p>
            </div>
          </div>

          {/* KPI Stat Chips on Right */}
          <div className="flex items-center justify-center sm:justify-end gap-3 shrink-0">
            <div className="px-4 py-2.5 rounded-2xl bg-white/80 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800 shadow-sm text-center">
              <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block">Credits</span>
              <span className="text-lg font-black text-amber-600 dark:text-amber-400">{creditPoints}</span>
            </div>
            <div className="px-4 py-2.5 rounded-2xl bg-white/80 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800 shadow-sm text-center">
              <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block">Avg Score</span>
              <span className="text-lg font-black text-purple-600 dark:text-purple-400">
                {progress && progress.average_score != null ? `${Number(progress.average_score).toFixed(1)}%` : "0%"}
              </span>
            </div>
            <div className="px-4 py-2.5 rounded-2xl bg-white/80 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800 shadow-sm text-center">
              <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block">Tier</span>
              <span className="text-lg font-black text-indigo-600 dark:text-indigo-400">Lvl {levelNum}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* 2-COLUMN BENTO GRID: DETAILS & SECURITY */}
      {/* ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (5 Cols): Identity & Academic Dossier */}
        <div className="lg:col-span-5 space-y-6">
          {/* Detailed Info Card */}
          <div className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-6 backdrop-blur-xl shadow-sm space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
              <UserIcon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              Academic & Account Details
            </h3>

            <div className="space-y-3">
              {/* Full Email with Copy Button */}
              <div className="p-3.5 rounded-2xl bg-slate-50/70 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                    <Mail className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Email Address</p>
                    <p className="text-xs font-semibold text-slate-900 dark:text-white truncate" title={user.email}>
                      {user.email}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleCopy(user.email, "email")}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors"
                  title="Copy Email"
                >
                  {copiedField === "email" ? (
                    <Check className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>

              {/* Register Number */}
              {user.register_number && (
                <div className="p-3.5 rounded-2xl bg-slate-50/70 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                      <Hash className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Register / Roll Number</p>
                      <p className="text-xs font-mono font-bold text-slate-900 dark:text-white">
                        {user.register_number}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleCopy(user.register_number || "", "reg")}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors"
                    title="Copy Register Number"
                  >
                    {copiedField === "reg" ? (
                      <Check className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              )}

              {/* Department & Year */}
              <div className="p-3.5 rounded-2xl bg-slate-50/70 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <GraduationCap className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Department & Academic Year</p>
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">
                    {user.department || "General Engineering"} · {user.year || "3rd Year"} {user.section ? `(Sec ${user.section})` : ""}
                  </p>
                </div>
              </div>

              {/* Account Status */}
              <div className="p-3.5 rounded-2xl bg-slate-50/70 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Security State</p>
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">Active & Authenticated</p>
                </div>
              </div>
            </div>
          </div>

          {/* Gamified Speaker Tier Overview Card */}
          <div className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-6 backdrop-blur-xl shadow-sm relative overflow-hidden">
            <div className="flex items-center gap-3.5 mb-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-400 to-orange-500 text-white flex items-center justify-center shadow-md shrink-0">
                <Flame className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Oratory Rank</p>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">{levelTitle}</h4>
              </div>
            </div>

            <div className="space-y-1.5 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500 dark:text-slate-400 font-semibold">Rank Progress</span>
                <span className="font-bold text-slate-900 dark:text-white">{xpPoints.toLocaleString()} / {nextLevelPoints.toLocaleString()} XP</span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-amber-500 to-indigo-600 h-2 rounded-full transition-all duration-700"
                  style={{ width: `${levelProgress}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (7 Cols): Modern Password & Security Center */}
        <div className="lg:col-span-7">
          <div className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 p-6 md:p-8 backdrop-blur-xl shadow-sm space-y-6">
            <div className="pb-4 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                Security & Password Management
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
                Change your account password to protect your speaking evaluations and session history.
              </p>
            </div>

            <form onSubmit={handlePasswordSubmit} className="space-y-5">
              {/* Current Password */}
              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 block">
                  Current Password
                </label>
                <div className="relative flex items-center">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-4 pointer-events-none" />
                  <Input
                    type={showCurrent ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    placeholder="Enter current password"
                    className="w-full pl-11 pr-11 bg-slate-50/70 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 focus:border-indigo-600 dark:focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 rounded-xl h-12 text-sm text-slate-900 dark:text-white shadow-inner"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent(!showCurrent)}
                    className="absolute right-4 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors focus:outline-none"
                  >
                    {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* New Password */}
              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 block">
                  New Password
                </label>
                <div className="relative flex items-center">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-4 pointer-events-none" />
                  <Input
                    type={showNew ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={8}
                    placeholder="Enter new password (min. 8 chars)"
                    className="w-full pl-11 pr-11 bg-slate-50/70 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 focus:border-indigo-600 dark:focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 rounded-xl h-12 text-sm text-slate-900 dark:text-white shadow-inner"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(!showNew)}
                    className="absolute right-4 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors focus:outline-none"
                  >
                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Real-time Password Strength Meter */}
                {newPassword && (
                  <div className="mt-2.5 space-y-1.5">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-500 dark:text-slate-400 font-medium">Password Strength</span>
                      <span className={`font-bold ${strength.text}`}>{strength.label}</span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`${strength.color} h-1.5 rounded-full transition-all duration-300`}
                        style={{ width: `${strength.score}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Confirm New Password */}
              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 block">
                  Confirm New Password
                </label>
                <div className="relative flex items-center">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-4 pointer-events-none" />
                  <Input
                    type={showConfirm ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={8}
                    placeholder="Confirm new password"
                    className="w-full pl-11 pr-11 bg-slate-50/70 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 focus:border-indigo-600 dark:focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 rounded-xl h-12 text-sm text-slate-900 dark:text-white shadow-inner"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-4 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors focus:outline-none"
                  >
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Match Indicator */}
                {confirmPassword && (
                  <p className="text-[11px] mt-1.5 flex items-center gap-1">
                    {passwordsMatch ? (
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                        <Check className="w-3.5 h-3.5 stroke-[3]" /> Passwords match perfectly
                      </span>
                    ) : (
                      <span className="text-rose-500 font-bold flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" /> Passwords do not match yet
                      </span>
                    )}
                  </p>
                )}
              </div>

              {/* Security Policy Advisory Box */}
              <div className="p-4 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-200/60 dark:border-indigo-900/40 text-xs space-y-1.5">
                <p className="font-bold text-indigo-900 dark:text-indigo-300 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  Password Requirements
                </p>
                <ul className="text-[11px] text-slate-600 dark:text-slate-300 space-y-1 pl-5 list-disc">
                  <li>At least 8 characters in length</li>
                  <li>Include letters and numbers for higher cryptographic security</li>
                  <li>Never share your student register number credentials with others</li>
                </ul>
              </div>

              {/* Submit Button */}
              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/25 border-0 flex items-center justify-center gap-2 transition-all duration-200"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock className="w-4 h-4" />}
                <span>Save New Password</span>
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
