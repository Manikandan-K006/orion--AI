"use client";

import {
  Activity, AudioLines, BarChart3, CheckCircle2, ClipboardList,
  Download, FileText, Loader2, LogIn, Trophy, Upload, UserPlus
} from "lucide-react";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Analysis, Progress, Question, User, apiRequest, downloadReport, uploadAudio } from "@/lib/api";

export default function Home() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedQuestion, setSelectedQuestion] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [transcript, setTranscript] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUploading, setAudioUploading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    department: "",
    year: ""
  });

  useEffect(() => {
    const savedToken = localStorage.getItem("speaksense_token");
    if (savedToken) {
      setToken(savedToken);
      loadProfile(savedToken);
    }
  }, []);

  async function loadProfile(authToken: string) {
    try {
      const profile = await apiRequest<User>("/profile", {}, authToken);
      setUser(profile);
      const loadedQuestions = await apiRequest<Question[]>("/questions", {}, authToken);
      setQuestions(loadedQuestions);
      setSelectedQuestion(loadedQuestions[0]?.id ?? null);
      const prog = await apiRequest<Progress>("/progress", {}, authToken);
      setProgress(prog);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load profile");
    }
  }

  async function handleAuth() {
    setLoading(true);
    setMessage("");
    setSuccess("");
    try {
      if (mode === "register") {
        await apiRequest<User>("/register", {
          method: "POST",
          body: JSON.stringify({
            name: form.name,
            email: form.email,
            password: form.password,
            department: form.department,
            year: form.year,
            role: "student"
          })
        });
      }
      const login = await apiRequest<{ access_token: string }>("/login", {
        method: "POST",
        body: JSON.stringify({ email: form.email, password: form.password })
      });
      localStorage.setItem("speaksense_token", login.access_token);
      setToken(login.access_token);
      await loadProfile(login.access_token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  async function startSession() {
    setLoading(true);
    setMessage("");
    setSuccess("");
    try {
      const session = await apiRequest<{ id: number }>("/interviews/sessions", {
        method: "POST",
        body: JSON.stringify({ title: "Communication Practice Interview" })
      }, token);
      setSessionId(session.id);
      setSuccess(`Session #${session.id} started`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to start session");
    } finally {
      setLoading(false);
    }
  }

  async function analyzeTranscript() {
    if (!sessionId || !selectedQuestion) {
      setMessage("Start a session and select a question first");
      return;
    }
    setLoading(true);
    setMessage("");
    setSuccess("");
    try {
      const result = await apiRequest<{ analysis: Analysis }>("/interviews/analyze-text", {
        method: "POST",
        body: JSON.stringify({
          session_id: sessionId,
          question_id: selectedQuestion,
          transcript
        })
      }, token);
      setAnalysis(result.analysis);
      const prog = await apiRequest<Progress>("/progress", {}, token);
      setProgress(prog);
      setSuccess("Analysis complete");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateReport() {
    if (!sessionId) { setMessage("Complete an analysis first"); return; }
    setReportBusy(true);
    setMessage("");
    setSuccess("");
    try {
      await apiRequest(`/reports/${sessionId}`, { method: "POST" }, token);
      setSuccess("Report generated. Use download button to save.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Report generation failed");
    } finally {
      setReportBusy(false);
    }
  }

  async function handleDownloadReport() {
    if (!sessionId) { setMessage("Generate a report first"); return; }
    try {
      await downloadReport(sessionId, token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Download failed");
    }
  }

  async function handleAudioUpload() {
    if (!audioFile) { setMessage("Select an audio file first"); return; }
    setAudioUploading(true);
    setMessage("");
    setSuccess("");
    try {
      const result = await uploadAudio(audioFile, token);
      if (result.transcript) {
        setTranscript(result.transcript);
      }
      setSuccess(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setAudioUploading(false);
    }
  }

  const chartData = analysis
    ? [
        { name: "Grammar", score: analysis.grammar_score },
        { name: "Pronunciation", score: analysis.pronunciation_score },
        { name: "Fluency", score: analysis.fluency_score },
        { name: "Confidence", score: analysis.confidence_score },
        { name: "Vocabulary", score: analysis.vocabulary_score }
      ]
    : [];

  const progressChartData = progress && progress.interviews_completed > 0
    ? [
        { name: "Avg Score", value: progress.average_score },
        { name: "Completed", value: progress.interviews_completed * 10 }
      ]
    : [];

  if (!user) {
    return (
      <main className="mx-auto grid min-h-screen max-w-6xl gap-8 px-4 py-8 lg:grid-cols-[1fr_420px]">
        <section className="flex flex-col justify-center gap-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-accent">SpeakSense AI</p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight text-ink">Interview communication assessment</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
              Practice answers, receive structured communication scores, and generate reports from your college server setup.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {["Speech", "Fluency", "Reports"].map((item) => (
              <div key={item} className="rounded-md border border-border bg-white p-4">
                <CheckCircle2 className="mb-3 h-5 w-5 text-accent" />
                <p className="text-sm font-medium">{item}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="self-center rounded-md border border-border bg-white p-5 shadow-sm">
          <div className="mb-4 flex rounded-md border border-border p-1">
            <Button className="flex-1" variant={mode === "login" ? "primary" : "ghost"} onClick={() => setMode("login")}>
              <LogIn className="h-4 w-4" /> Login
            </Button>
            <Button className="flex-1" variant={mode === "register" ? "primary" : "ghost"} onClick={() => setMode("register")}>
              <UserPlus className="h-4 w-4" /> Register
            </Button>
          </div>
          <div className="space-y-3">
            {mode === "register" && (
              <>
                <Input placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <Input placeholder="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
                <Input placeholder="Year" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
              </>
            )}
            <Input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <Input placeholder="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <Button className="w-full" onClick={handleAuth} disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Continue
            </Button>
            {message && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{message}</p>}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-surface">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div>
            <p className="text-sm text-muted">SpeakSense AI</p>
            <h1 className="text-xl font-semibold">Interview Workspace</h1>
          </div>
          <div className="flex items-center gap-3">
            {user.role === "admin" && (
              <span className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-white">Admin</span>
            )}
            <Button
              variant="secondary"
              onClick={() => {
                localStorage.removeItem("speaksense_token");
                setUser(null);
                setToken("");
              }}
            >
              Logout
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 lg:grid-cols-[320px_1fr_360px]">
        <aside className="space-y-4">
          <div className="rounded-md border border-border bg-white p-4">
            <div className="mb-4 flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-accent" />
              <h2 className="font-semibold">Questions</h2>
            </div>
            <div className="space-y-2">
              {questions.length === 0 && <p className="text-sm text-muted">No questions found.</p>}
              {questions.map((question) => (
                <button
                  key={question.id}
                  className={`w-full rounded-md border p-3 text-left text-sm ${selectedQuestion === question.id ? "border-accent bg-[#eef8f6]" : "border-border bg-white"}`}
                  onClick={() => setSelectedQuestion(question.id)}
                >
                  <span className="block font-medium">{question.question_text}</span>
                  <span className="mt-1 block text-xs text-muted">{question.category} &middot; {question.difficulty}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-md border border-border bg-white p-4">
            <div className="mb-4 flex items-center gap-2">
              <Trophy className="h-5 w-5 text-accent" />
              <h2 className="font-semibold">Progress</h2>
            </div>
            {progress && progress.interviews_completed > 0 ? (
              <>
                <div className="mb-3 space-y-2 text-sm">
                  <p className="flex justify-between"><span className="text-muted">Interviews</span><span className="font-medium">{progress.interviews_completed}</span></p>
                  <p className="flex justify-between"><span className="text-muted">Avg Score</span><span className="font-medium">{progress.average_score}</span></p>
                </div>
                {progressChartData.length > 0 && (
                  <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={progressChartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                        <YAxis hide domain={[0, 100]} />
                        <Tooltip />
                        <Bar dataKey="value" fill="#0f766e" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted">No interviews completed yet.</p>
            )}
          </div>
        </aside>
        <section className="space-y-4">
          <div className="rounded-md border border-border bg-white p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-muted">Student</p>
                <h2 className="font-semibold">{user.name}</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={startSession} disabled={loading}>
                  <Activity className="h-4 w-4" />
                  {sessionId ? `Session #${sessionId}` : "Start Session"}
                </Button>
                {sessionId && (
                  <>
                    <Button variant="secondary" onClick={handleGenerateReport} disabled={reportBusy || loading}>
                      {reportBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                      Generate Report
                    </Button>
                    <Button variant="secondary" onClick={handleDownloadReport}>
                      <Download className="h-4 w-4" />
                      Download PDF
                    </Button>
                  </>
                )}
              </div>
            </div>
            <Textarea
              placeholder="Type or paste the interview answer transcript here after speech-to-text."
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-sm text-muted">{transcript.trim().split(/\s+/).filter(Boolean).length} words</p>
              <Button onClick={analyzeTranscript} disabled={loading || !transcript.trim()}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Analyze
              </Button>
            </div>
          </div>
          <div className="rounded-md border border-border bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <AudioLines className="h-5 w-5 text-accent" />
              <h2 className="font-semibold">Audio Upload</h2>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="file"
                accept=".wav,.mp3,.m4a,.webm"
                className="block w-full max-w-60 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-[#0b5f59]"
                onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
              />
              <Button onClick={handleAudioUpload} disabled={audioUploading || !audioFile}>
                {audioUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Transcribe
              </Button>
            </div>
          </div>
          {(success || message) && (
            <p className={`rounded-md p-3 text-sm ${success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
              {success || message}
            </p>
          )}
          {analysis && (
            <div className="rounded-md border border-border bg-white p-4">
              <p className="text-sm text-muted">Feedback</p>
              <p className="mt-1 text-sm leading-6">{analysis.feedback}</p>
            </div>
          )}
        </section>
        <aside className="space-y-4">
          <div className="rounded-md border border-border bg-white p-4">
            <div className="mb-4 flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-accent" />
              <h2 className="font-semibold">Scores</h2>
            </div>
            {!analysis && <p className="text-sm text-muted">Complete an analysis to view score breakdown.</p>}
            {analysis && (
              <>
                <div className="mb-4 rounded-md border border-border p-4">
                  <p className="text-sm text-muted">Overall</p>
                  <p className="text-3xl font-semibold">{analysis.overall_score}</p>
                  <p className="text-sm text-muted">Emotion: {analysis.emotion}</p>
                </div>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} />
                      <Tooltip />
                      <Bar dataKey="score" fill="#0f766e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
