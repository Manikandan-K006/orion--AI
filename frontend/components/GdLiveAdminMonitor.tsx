"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, Users, Radio, CheckCircle2, Loader2, BarChart3, Zap, Volume2, Mic, MessageSquare, Eye } from "lucide-react";
import { useGdLiveWs, GDLiveWsMessage } from "@/lib/useGdLiveWs";

interface MonitorMember {
  user_id: number;
  name: string | null;
  label: string | null;
  status: "recording" | "finished";
}

interface MonitorTeam {
  team_number: number;
  topic: string;
  members: MonitorMember[];
  finished_count: number;
  total_count: number;
  all_finished: boolean;
  transcripts: { user_id: number; text: string }[];
  evaluations: Record<number, any>;
}

const COLORS = [
  "from-blue-500 to-blue-600", "from-emerald-500 to-emerald-600", "from-amber-500 to-amber-600",
  "from-purple-500 to-purple-600", "from-rose-500 to-rose-600", "from-cyan-500 to-cyan-600",
  "from-orange-500 to-orange-600", "from-pink-500 to-pink-600",
];

export default function GdLiveAdminMonitor({
  sessionCode,
  token,
  onBack,
}: {
  sessionCode: string;
  token: string;
  onBack: () => void;
}) {
  const { connected, subscribe } = useGdLiveWs(sessionCode, token);
  const [teams, setTeams] = useState<Map<number, MonitorTeam>>(new Map());
  const [selectedTeam, setSelectedTeam] = useState<number | null>(null);
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
            }));
            const finishedIds = new Set(ts.finished_user_ids || []);
            newTeams.set(tn, {
              team_number: tn,
              topic: ts.topic || "",
              members,
              finished_count: finishedIds.size,
              total_count: members.length,
              all_finished: ts.all_finished || false,
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
              }));
              next.set(tn, {
                ...existing, members,
                finished_count: finishedIds.size,
                all_finished: ts.all_finished || false,
              });
            }
            return next;
          });
          push(`Team ${tn} state updated`);
          break;
        }
        case "TEAM_PROGRESS": {
          const tn = msg.payload?.team_number;
          const finished = msg.payload?.finished_user_ids?.length || 0;
          setTeams((prev) => {
            const next = new Map(prev);
            const t = next.get(tn);
            if (t) {
              next.set(tn, { ...t, finished_count: finished, all_finished: msg.payload?.all_finished || false });
            }
            return next;
          });
          push(`Team ${tn}: ${finished}/${teams.get(tn)?.total_count || "?"} finished`);
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
      <header className="flex items-center justify-between px-4 md:px-6 py-3 surface border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-3">
          <Eye className="w-5 h-5 text-amber-400" />
          <span className="text-lg font-bold text-heading">Admin Monitor</span>
          <span className="text-sm text-muted-soft">Session <code className="font-mono text-amber-300">{sessionCode}</code></span>
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`} />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-soft">{sortedTeams.length} team(s) · {sortedTeams.reduce((a, t) => a + t.members.length, 0)} participant(s)</span>
          <button onClick={onBack} className="btn-secondary text-xs h-9 px-3">Back</button>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_320px] overflow-hidden">
        {/* Main: Team Cards */}
        <div className="p-4 md:p-6 overflow-y-auto space-y-4">
          {sortedTeams.length === 0 && (
            <div className="text-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-amber-400 mx-auto mb-3" />
              <p className="text-muted-soft text-sm">Waiting for session data...</p>
            </div>
          )}

          {sortedTeams.map((team, idx) => {
            const completed = team.finished_count;
            const total = team.total_count;
            const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

            return (
              <div key={team.team_number} className={`card overflow-hidden transition-all duration-300 ${team.all_finished ? "ring-1 ring-emerald-500/40" : "ring-1 ring-amber-500/20"}`}>
                <div className="p-4 flex items-center justify-between" style={{ background: "var(--surface-2)" }}>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold font-mono text-amber-300">Team {team.team_number}</span>
                    <span className="text-xs text-muted-soft truncate max-w-[200px]">{team.topic}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1 text-xs text-muted-soft">
                      <Users className="w-3.5 h-3.5" /> {total}
                    </span>
                    {team.all_finished ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Complete
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">In Progress</span>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-1 bg-gray-700">
                  <div className={`h-full transition-all duration-500 ${team.all_finished ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
                </div>

                {/* Members */}
                <div className="p-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {team.members.map((m) => {
                      const isFinished = m.status === "finished";
                      const evalData = team.evaluations[m.user_id];
                      return (
                        <div key={m.user_id} className={`p-3 rounded-xl text-center transition-all duration-300 ${isFinished ? "ring-1 ring-blue-500/30 opacity-75" : "surface-2 ring-1 ring-emerald-500/10"}`}>
                          <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${COLORS[idx % COLORS.length]} flex items-center justify-center text-white font-bold text-sm mx-auto mb-1.5`}>
                            {(m.label || m.name || "?")[0].toUpperCase()}
                          </div>
                          <p className="text-xs font-semibold text-heading truncate">{m.label || m.name}</p>
                          <p className={`text-[10px] ${isFinished ? "text-blue-400" : "text-emerald-400"}`}>
                            {isFinished ? "Finished" : "Recording"}
                          </p>
                          {evalData && (
                            <div className="mt-1.5 space-y-0.5">
                              <p className="text-[10px] text-amber-300 font-semibold">{evalData.overall_score ?? evalData.overall}%</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Transcript peek */}
                  {team.transcripts.length > 0 && (
                    <details className="mt-3">
                      <summary className="text-xs text-muted-soft cursor-pointer hover:text-heading flex items-center gap-1">
                        <MessageSquare className="w-3 h-3" /> Transcript ({team.transcripts.length})
                      </summary>
                      <div className="mt-2 max-h-32 overflow-y-auto space-y-1 p-2 rounded-lg surface-2 text-xs text-body">
                        {team.transcripts.map((t, i) => {
                          const member = team.members.find((m) => m.user_id === t.user_id);
                          return (
                            <p key={i}>
                              <span className="text-amber-300 font-semibold">{member?.label || member?.name}:</span> {t.text}
                            </p>
                          );
                        })}
                      </div>
                    </details>
                  )}

                  {/* Evaluations */}
                  {Object.keys(team.evaluations).length > 0 && (
                    <details className="mt-2">
                      <summary className="text-xs text-muted-soft cursor-pointer hover:text-heading flex items-center gap-1">
                        <BarChart3 className="w-3 h-3" /> AI Scores ({Object.keys(team.evaluations).length})
                      </summary>
                      <div className="mt-2 space-y-2">
                        {team.members.filter((m) => team.evaluations[m.user_id]).map((m) => {
                          const e = team.evaluations[m.user_id];
                          return (
                            <div key={m.user_id} className="p-2 rounded-lg surface-2">
                              <p className="text-xs font-semibold text-heading mb-1">{m.label || m.name}</p>
                              <div className="grid grid-cols-3 gap-1 text-[10px] text-muted-soft">
                                <span>G: {e.grammar ?? e.grammar_score}%</span>
                                <span>F: {e.fluency ?? e.fluency_score}%</span>
                                <span>C: {e.confidence ?? e.confidence_score}%</span>
                                <span>V: {e.vocabulary ?? e.vocabulary_score}%</span>
                                <span>P: {e.pronunciation ?? e.pronunciation_score}%</span>
                                <span className="text-amber-300 font-semibold">O: {e.overall_score ?? e.overall}%</span>
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

        {/* Right panel: Activity log */}
        <aside className="surface border-l overflow-hidden flex flex-col" style={{ borderColor: "var(--border)" }}>
          <div className="p-4 border-b" style={{ borderColor: "var(--border)" }}>
            <h3 className="text-xs uppercase tracking-wide text-muted-soft flex items-center gap-1">
              <Zap className="w-3.5 h-3.5 text-amber-400" /> Live Activity
            </h3>
          </div>
          <div ref={scrollRef} className="flex-1 p-4 overflow-y-auto space-y-1.5">
            {activity.length === 0 && (
              <p className="text-xs text-muted-soft italic">Waiting for activity...</p>
            )}
            {activity.map((a) => (
              <div key={a.id} className="text-xs text-muted-soft border-b border-[#ffffff08] pb-1">
                <span className="opacity-50 mr-1">{new Date(a.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                {a.text}
              </div>
            ))}
          </div>

          {/* Summary stats */}
          <div className="p-4 border-t grid grid-cols-2 gap-2" style={{ borderColor: "var(--border)" }}>
            <div className="card p-2 text-center">
              <p className="text-lg font-bold text-heading">{sortedTeams.length}</p>
              <p className="text-[10px] text-muted-soft">Teams</p>
            </div>
            <div className="card p-2 text-center">
              <p className="text-lg font-bold text-heading">{sortedTeams.reduce((a, t) => a + t.members.length, 0)}</p>
              <p className="text-[10px] text-muted-soft">Participants</p>
            </div>
            <div className="card p-2 text-center">
              <p className="text-lg font-bold text-amber-300">{sortedTeams.reduce((a, t) => a + t.finished_count, 0)}</p>
              <p className="text-[10px] text-muted-soft">Finished</p>
            </div>
            <div className="card p-2 text-center">
              <p className="text-lg font-bold text-emerald-300">{sortedTeams.filter((t) => t.all_finished).length}</p>
              <p className="text-[10px] text-muted-soft">Complete</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
