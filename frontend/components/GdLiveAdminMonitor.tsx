"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, Users, CheckCircle2, Loader2, BarChart3, Zap, MessageSquare, Eye, Timer, StopCircle } from "lucide-react";
import { useGdLiveWs, GDLiveWsMessage } from "@/lib/useGdLiveWs";
import { Button } from "@/components/ui/button";

interface MonitorMember {
  user_id: number;
  name: string | null;
  label: string | null;
  status: "recording" | "finished";
  terminated?: boolean;
}

interface MonitorTeam {
  team_number: number;
  topic: string;
  members: MonitorMember[];
  finished_count: number;
  total_count: number;
  all_finished: boolean;
  timer_seconds: number;
  transcripts: { user_id: number; text: string }[];
  evaluations: Record<number, any>;
}

const COLORS = [
  "from-blue-500 to-blue-600", "from-emerald-500 to-emerald-600", "from-amber-500 to-amber-600",
  "from-purple-500 to-purple-600", "from-rose-500 to-rose-600", "from-cyan-500 to-cyan-600",
  "from-orange-500 to-orange-600", "from-pink-500 to-pink-600",
];

function formatTime(s: number) {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

export default function GdLiveAdminMonitor({
  sessionCode,
  token,
  onBack,
  onEnd,
  showHostControls,
}: {
  sessionCode: string;
  token: string;
  onBack: () => void;
  onEnd?: (code: string) => void;
  showHostControls?: boolean;
}) {
  const { connected, subscribe } = useGdLiveWs(sessionCode, token);
  const [teams, setTeams] = useState<Map<number, MonitorTeam>>(new Map());
  const [activity, setActivity] = useState<{ id: number; text: string; ts: number }[]>([]);
  const idRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);

  const push = (text: string) => {
    setActivity((p) => [...p.slice(-100), { id: idRef.current++, text, ts: Date.now() }]);
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activity]);

  useEffect(() => {
    const unsub = subscribe((msg: GDLiveWsMessage) => {
      switch (msg.event) {
        case "STATE_SYNC":
        case "SESSION_STARTED": {
          const st = msg.payload?.state || msg.payload;
          const rawTeams = st?.teams || {};
          const newTeams = new Map<number, MonitorTeam>();
          for (const tnStr of Object.keys(rawTeams)) {
            const ts = rawTeams[tnStr];
            const tn = ts.team_number ?? parseInt(tnStr);
            const members: MonitorMember[] = (ts.members || []).map((m: any) => ({
              user_id: m.user_id,
              name: m.name,
              label: m.label,
              status: m.status || "recording",
              terminated: m.terminated || false,
            }));
            const finishedIds = new Set(ts.finished_user_ids || []);
            newTeams.set(tn, {
              team_number: tn,
              topic: ts.topic || "",
              members,
              finished_count: finishedIds.size,
              total_count: members.length,
              all_finished: ts.all_finished || false,
              timer_seconds: ts.timer_seconds || 0,
              transcripts: [],
              evaluations: {},
            });
          }
          setTeams(newTeams);
          push(`Session started — ${newTeams.size} team(s)`);
          break;
        }
        case "TEAM_STATE_UPDATED": {
          const ts = msg.payload;
          const tn = ts.team_number;
          setTeams((prev) => {
            const next = new Map(prev);
            const existing = next.get(tn);
            if (existing) {
              const finishedIds = new Set(ts.finished_user_ids || []);
              const members: MonitorMember[] = (ts.members || []).map((m: any) => ({
                user_id: m.user_id,
                name: m.name,
                label: m.label,
                status: m.status || "recording",
                terminated: m.terminated || false,
              }));
              next.set(tn, {
                ...existing,
                members,
                finished_count: finishedIds.size,
                all_finished: ts.all_finished || false,
                timer_seconds: ts.timer_seconds ?? existing.timer_seconds,
              });
            }
            return next;
          });
          push(`Team ${tn} state updated`);
          break;
        }
        case "TRANSCRIPT": {
          const tn = [...teams.keys()].find((k) =>
            teams.get(k)?.members.some((m) => m.user_id === msg.payload?.user_id)
          );
          if (tn) {
            setTeams((prev) => {
              const next = new Map(prev);
              const t = next.get(tn);
              if (t) {
                next.set(tn, {
                  ...t,
                  transcripts: [...t.transcripts, { user_id: msg.payload?.user_id, text: msg.payload?.text || "" }],
                });
              }
              return next;
            });
          }
          break;
        }
        case "AI_EVALUATION": {
          const uid = msg.payload?.user_id;
          for (const [, t] of teams) {
            if (t.members.some((m) => m.user_id === uid)) {
              setTeams((prev) => {
                const next = new Map(prev);
                const team = next.get(t.team_number);
                if (team) {
                  next.set(t.team_number, {
                    ...team,
                    evaluations: { ...team.evaluations, [uid]: msg.payload },
                  });
                }
                return next;
              });
              push(`Team ${t.team_number}: AI evaluation received for member ${uid}`);
              break;
            }
          }
          break;
        }
        case "ALL_FINISHED": {
          const tn = msg.payload?.team_number;
          setTeams((prev) => {
            const next = new Map(prev);
            const t = next.get(tn);
            if (t) next.set(tn, { ...t, all_finished: true });
            return next;
          });
          push(`Team ${tn}: All members finished`);
          break;
        }
        case "SESSION_RESULTS": {
          const tn = msg.payload?.team_number;
          push(`Team ${tn}: Results generated`);
          break;
        }
        case "PARTICIPANT_LEFT": {
          const uid = msg.payload?.user_id;
          for (const [, t] of teams) {
            if (t.members.some((m) => m.user_id === uid)) {
              push(`${msg.payload?.name || "Member"} left Team ${t.team_number}`);
              break;
            }
          }
          break;
        }
      }
    });
    return unsub;
  }, [subscribe, teams]);

  const sortedTeams = [...teams.values()].sort((a, b) => a.team_number - b.team_number);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-b border-slate-200/50 dark:border-slate-800/50 shrink-0">
        <div className="flex items-center gap-3">
          <Eye className="w-5 h-5 text-indigo-500 animate-pulse" />
          <span className="text-lg font-bold text-heading">Observer Dashboard</span>
          <span className="text-xs text-muted-soft bg-indigo-500/10 px-2 py-0.5 rounded-md font-mono">Code: {sessionCode}</span>
          {showHostControls && connected && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-red-500 ml-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> LIVE
            </span>
          )}
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`} />
        </div>
        <div className="flex items-center gap-3">
          {showHostControls && onEnd && (
            <Button onClick={() => onEnd(sessionCode)} variant="secondary" className="h-9 text-xs px-3 text-red-600 dark:text-red-400 hover:bg-red-500/10">
              <StopCircle className="w-4 h-4 mr-1.5" /> End Session
            </Button>
          )}
          <Button onClick={onBack} variant="secondary" className="h-9 text-xs px-3">Back</Button>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_320px] overflow-hidden">
        {/* Main: Team Cards */}
        <div className="p-6 overflow-y-auto space-y-6">
          {sortedTeams.length === 0 && (
            <div className="text-center py-20 card flex flex-col items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-3" />
              <p className="text-muted-soft text-xs font-medium">Waiting for session groups to connect...</p>
            </div>
          )}

          {sortedTeams.map((team, idx) => {
            const completed = team.finished_count;
            const total = team.total_count;
            const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

            return (
              <div key={team.team_number} className={`card overflow-hidden transition-all duration-300 relative ${team.all_finished ? "border-emerald-500/35 shadow-sm" : "border-slate-200/50 dark:border-slate-800/50"}`}>
                <div className="p-4 flex items-center justify-between bg-slate-500/5 border-b border-slate-200/50 dark:border-slate-800/50">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-sm font-bold text-heading">Team Group {team.team_number}</span>
                    <span className="text-xs text-muted-soft truncate max-w-[300px]">{team.topic}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {team.timer_seconds > 0 && !team.all_finished && (
                      <span className="flex items-center gap-1 text-xs font-mono font-bold text-heading">
                        <Timer className="w-3.5 h-3.5 text-indigo-500" /> {formatTime(team.timer_seconds)}
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-xs text-muted-soft">
                      <Users className="w-3.5 h-3.5" /> {total} Members
                    </span>
                    {team.all_finished ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        Completed
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 animate-pulse">
                        Speaking
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-1 bg-slate-200 dark:bg-slate-800">
                  <div className={`h-full transition-all duration-500 ${team.all_finished ? "bg-emerald-500" : "bg-indigo-500"}`} style={{ width: `${pct}%` }} />
                </div>

                {/* Members Grid */}
                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {team.members.map((m) => {
                      const isFinished = m.status === "finished";
                      const evalData = team.evaluations[m.user_id];
                      return (
                        <div key={m.user_id} className={`p-4 rounded-2xl text-center border transition-all duration-300 relative overflow-hidden ${isFinished ? "border-emerald-500/25 bg-emerald-500/5 opacity-80" : m.terminated ? "border-red-500/25 bg-red-500/5" : "border-slate-200/40 dark:border-slate-800/40 bg-white/40 dark:bg-slate-900/40"}`}>
                          <div className={`w-9 h-9 rounded-xl bg-gradient-to-tr ${COLORS[idx % COLORS.length]} flex items-center justify-center text-white font-bold text-xs mx-auto mb-2.5 shadow-sm`}>
                            {(m.label || m.name || "?")[0].toUpperCase()}
                          </div>
                          <p className="text-xs font-bold text-heading truncate">{m.label || m.name}</p>
                          <p className={`text-[10px] font-semibold mt-1 ${m.terminated ? "text-red-500" : isFinished ? "text-emerald-500" : "text-indigo-500 animate-pulse"}`}>
                            {m.terminated ? "Terminated" : isFinished ? "Finished" : "Speaking"}
                          </p>
                          {evalData && (
                            <div className="mt-2 bg-indigo-500/10 border border-indigo-500/20 rounded px-1.5 py-0.5 inline-block">
                              <p className="text-[10px] text-indigo-500 font-bold">{evalData.overall_score ?? evalData.overall}% Score</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Transcript peek */}
                  {team.transcripts.length > 0 && (
                    <details className="group mt-3 border border-slate-200/40 dark:border-slate-800/40 rounded-xl overflow-hidden">
                      <summary className="text-xs font-bold text-heading cursor-pointer hover:bg-slate-500/5 p-3 flex items-center justify-between">
                        <span className="flex items-center gap-2"><MessageSquare className="w-4 h-4 text-indigo-400" /> Speech Transcript Logs</span>
                        <span className="text-[10px] text-muted-soft bg-slate-100 dark:bg-slate-950 px-2 py-0.5 rounded-full">{team.transcripts.length} entry</span>
                      </summary>
                      <div className="p-4 max-h-48 overflow-y-auto space-y-2.5 border-t border-slate-200/40 dark:border-slate-800/40 bg-slate-50/50 dark:bg-slate-950/30 text-xs text-body leading-relaxed font-mono">
                        {team.transcripts.map((t, i) => {
                          const member = team.members.find((m) => m.user_id === t.user_id);
                          return (
                            <p key={i}>
                              <span className="text-indigo-500 font-bold">{member?.label || member?.name || "Participant"}:</span> {t.text}
                            </p>
                          );
                        })}
                      </div>
                    </details>
                  )}

                  {/* Evaluations */}
                  {Object.keys(team.evaluations).length > 0 && (
                    <details className="group mt-2 border border-slate-200/40 dark:border-slate-800/40 rounded-xl overflow-hidden">
                      <summary className="text-xs font-bold text-heading cursor-pointer hover:bg-slate-500/5 p-3 flex items-center justify-between">
                        <span className="flex items-center gap-2"><BarChart3 className="w-4 h-4 text-indigo-400" /> Real-time Speech Analytics</span>
                        <span className="text-[10px] text-muted-soft bg-slate-100 dark:bg-slate-950 px-2 py-0.5 rounded-full">{Object.keys(team.evaluations).length} student</span>
                      </summary>
                      <div className="p-4 space-y-3.5 border-t border-slate-200/40 dark:border-slate-800/40 bg-slate-50/50 dark:bg-slate-950/30">
                        {team.members.filter((m) => team.evaluations[m.user_id]).map((m) => {
                          const e = team.evaluations[m.user_id];
                          return (
                            <div key={m.user_id} className="p-3 rounded-2xl bg-white/50 dark:bg-slate-900/50 border border-slate-200/40 dark:border-slate-800/40">
                              <p className="text-xs font-bold text-heading mb-2">{m.label || m.name}</p>
                              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-[10px] text-muted-soft font-mono">
                                <span>G: {e.grammar ?? e.grammar_score}%</span>
                                <span>F: {e.fluency ?? e.fluency_score}%</span>
                                <span>C: {e.confidence ?? e.confidence_score}%</span>
                                <span>V: {e.vocabulary ?? e.vocabulary_score}%</span>
                                <span>P: {e.pronunciation ?? e.pronunciation_score}%</span>
                                <span className="text-indigo-500 font-bold">O: {e.overall_score ?? e.overall}%</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Right panel: Activity log + Stats */}
        <aside className="bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border-l border-slate-200/50 dark:border-slate-800/50 overflow-hidden flex flex-col shrink-0">
          <div className="p-4 border-b border-slate-200/50 dark:border-slate-800/50">
            <h3 className="text-xs uppercase tracking-wider font-bold text-heading flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-indigo-500" /> Live Event Feed
            </h3>
          </div>
          
          <div ref={scrollRef} className="flex-1 p-4 overflow-y-auto space-y-2.5 font-mono text-[10px]">
            {activity.length === 0 && (
              <p className="text-muted-soft italic text-center py-4">Awaiting live telemetry events...</p>
            )}
            {activity.map((a) => (
              <div key={a.id} className="text-muted-soft border-b border-slate-200/20 dark:border-slate-800/20 pb-1.5">
                <span className="text-indigo-500 opacity-60 mr-1.5">{new Date(a.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                {a.text}
              </div>
            ))}
          </div>

          {/* Summary stats */}
          <div className="p-4 border-t border-slate-200/50 dark:border-slate-800/50 grid grid-cols-2 gap-2 bg-slate-500/5">
            <div className="card p-2.5 text-center">
              <p className="text-lg font-bold text-heading">{sortedTeams.length}</p>
              <p className="text-[9px] text-muted-soft font-medium uppercase tracking-wider">Active Teams</p>
            </div>
            <div className="card p-2.5 text-center">
              <p className="text-lg font-bold text-heading">{sortedTeams.reduce((a, t) => a + t.members.length, 0)}</p>
              <p className="text-[9px] text-muted-soft font-medium uppercase tracking-wider">Participants</p>
            </div>
            <div className="card p-2.5 text-center">
              <p className="text-lg font-bold text-indigo-500">{sortedTeams.reduce((a, t) => a + t.finished_count, 0)}</p>
              <p className="text-[9px] text-muted-soft font-medium uppercase tracking-wider">Finished</p>
            </div>
            <div className="card p-2.5 text-center">
              <p className="text-lg font-bold text-emerald-500">{sortedTeams.filter((t) => t.all_finished).length}</p>
              <p className="text-[9px] text-muted-soft font-medium uppercase tracking-wider">Complete</p>
            </div>
          </div>

          {showHostControls && onEnd && (
            <div className="p-4 border-t border-slate-200/50 dark:border-slate-800/50" style={{ borderColor: "var(--border)" }}>
              <Button onClick={() => onEnd(sessionCode)} variant="secondary" className="w-full h-11 text-xs text-red-500 hover:bg-red-500/10">
                <StopCircle className="w-4 h-4 mr-1.5" /> End Session
              </Button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
