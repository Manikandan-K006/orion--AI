"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, Users, CheckCircle2, Loader2, BarChart3, Zap, Eye, Timer, StopCircle, Mic, MicOff, Video, VideoOff } from "lucide-react";
import { useGdLiveWs, GDLiveWsMessage } from "@/lib/useGdLiveWs";
import { Button } from "@/components/ui/button";

interface Participant {
  user_id: number;
  name: string | null;
  label: string | null;
  camera_on: boolean;
  mic_on: boolean;
  speaking_order_index: number | null;
  has_completed_turn: boolean;
}

interface TurnScore {
  turn_number: number;
  user_id: number;
  scores: {
    grammar: number;
    fluency: number;
    pronunciation: number;
    confidence: number;
    vocabulary: number;
    overall: number;
  };
  transcript: string;
  timestamp: number;
}

interface TurnState {
  current_speaker_id: number | null;
  current_turn_number: number;
  countdown_seconds: number;
  max_turn_time: number;
  speaking_order: { user_id: number; name: string | null; label: string | null; order: number }[];
  participants: Participant[];
  turn_scores: TurnScore[];
  all_turns_completed: boolean;
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
  const { connected, error, retryCount, subscribe } = useGdLiveWs(sessionCode, token);
  const [turnState, setTurnState] = useState<TurnState>({
    current_speaker_id: null,
    current_turn_number: 0,
    countdown_seconds: 0,
    max_turn_time: 60,
    speaking_order: [],
    participants: [],
    turn_scores: [],
    all_turns_completed: false,
  });
  const [activity, setActivity] = useState<{ id: number; text: string; ts: number }[]>([]);
  const [activeTab, setActiveTab] = useState<"live" | "analytics">("live");
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
          const participants: Participant[] = (st?.participants || []).map((p: any, idx: number) => ({
            user_id: p.user_id,
            name: p.name,
            label: p.label,
            camera_on: p.camera_on ?? true,
            mic_on: p.mic_on ?? true,
            speaking_order_index: p.speaking_order_index ?? idx,
            has_completed_turn: p.has_completed_turn ?? false,
          }));
          const speaking_order = (st?.speaking_order || participants).map((s: any, idx: number) => ({
            user_id: s.user_id,
            name: s.name,
            label: s.label,
            order: s.order ?? idx + 1,
          }));
          setTurnState({
            current_speaker_id: st?.current_speaker_id ?? null,
            current_turn_number: st?.current_turn_number ?? 0,
            countdown_seconds: st?.countdown_seconds ?? 0,
            max_turn_time: st?.max_turn_time ?? 60,
            speaking_order,
            participants,
            turn_scores: st?.turn_scores || [],
            all_turns_completed: st?.all_turns_completed ?? false,
          });
          push(`Session started — ${participants.length} participants`);
          break;
        }
        case "SPEAKER_CHANGED": {
          const { speaker_id, turn_number, countdown } = msg.payload || {};
          setTurnState((prev) => ({
            ...prev,
            current_speaker_id: speaker_id ?? prev.current_speaker_id,
            current_turn_number: turn_number ?? prev.current_turn_number,
            countdown_seconds: countdown ?? prev.max_turn_time,
          }));
          const speaker = turnState.participants.find((p) => p.user_id === speaker_id);
          push(`Turn ${turn_number}: ${speaker?.label || speaker?.name || `Participant ${speaker_id}`} is now speaking`);
          break;
        }
        case "TEAM_STATE_UPDATED":
        case "TURN_EVALUATED": {
          const st = msg.payload;
          if (msg.event === "TURN_EVALUATED") {
            const newScore: TurnScore = {
              turn_number: st.turn_number,
              user_id: st.user_id,
              scores: {
                grammar: st.grammar ?? 0,
                fluency: st.fluency ?? 0,
                pronunciation: st.pronunciation ?? 0,
                confidence: st.confidence ?? 0,
                vocabulary: st.vocabulary ?? 0,
                overall: st.overall ?? 0,
              },
              transcript: st.transcript || "",
              timestamp: st.timestamp || Date.now(),
            };
            setTurnState((prev) => ({
              ...prev,
              turn_scores: [...prev.turn_scores, newScore],
            }));
            const participant = turnState.participants.find((p) => p.user_id === st.user_id);
            push(`Turn ${st.turn_number} score: ${participant?.label || participant?.name || st.user_id} — ${st.overall ?? 0}%`);
          }
          if (st.participants) {
            setTurnState((prev) => ({
              ...prev,
              participants: st.participants.map((p: any) => ({
                user_id: p.user_id,
                name: p.name,
                label: p.label,
                camera_on: p.camera_on ?? true,
                mic_on: p.mic_on ?? true,
                speaking_order_index: p.speaking_order_index ?? null,
                has_completed_turn: p.has_completed_turn ?? false,
              })),
              all_turns_completed: st.all_turns_completed ?? prev.all_turns_completed,
            }));
          }
          if (st.speaking_order) {
            setTurnState((prev) => ({
              ...prev,
              speaking_order: st.speaking_order.map((s: any, idx: number) => ({
                user_id: s.user_id,
                name: s.name,
                label: s.label,
                order: s.order ?? idx + 1,
              })),
            }));
          }
          push(`Turn state updated`);
          break;
        }
        case "CAMERA_STATUS": {
          const { user_id, camera_on } = msg.payload || {};
          setTurnState((prev) => ({
            ...prev,
            participants: prev.participants.map((p) =>
              p.user_id === user_id ? { ...p, camera_on } : p
            ),
          }));
          break;
        }
        case "MIC_STATUS": {
          const { user_id, mic_on } = msg.payload || {};
          setTurnState((prev) => ({
            ...prev,
            participants: prev.participants.map((p) =>
              p.user_id === user_id ? { ...p, mic_on } : p
            ),
          }));
          break;
        }
        case "SESSION_RESULTS": {
          push(`Session results generated`);
          break;
        }
        case "PARTICIPANT_LEFT": {
          const { user_id, name } = msg.payload || {};
          setTurnState((prev) => ({
            ...prev,
            participants: prev.participants.filter((p) => p.user_id !== user_id),
          }));
          push(`${name || "Participant"} left the session`);
          break;
        }
      }
    });
    return unsub;
  }, [subscribe, turnState.participants]);

  const currentSpeaker = turnState.participants.find((p) => p.user_id === turnState.current_speaker_id);
  const sortedSpeakingOrder = [...turnState.speaking_order].sort((a, b) => a.order - b.order);

  const avgSpeakingTime = turnState.participants.length > 0
    ? Math.round(turnState.max_turn_time * (turnState.turn_scores.length / turnState.participants.length))
    : 0;

  const scoreByCategory = {
    grammar: turnState.turn_scores.reduce((sum, s) => sum + s.scores.grammar, 0) / (turnState.turn_scores.length || 1),
    fluency: turnState.turn_scores.reduce((sum, s) => sum + s.scores.fluency, 0) / (turnState.turn_scores.length || 1),
    pronunciation: turnState.turn_scores.reduce((sum, s) => sum + s.scores.pronunciation, 0) / (turnState.turn_scores.length || 1),
    confidence: turnState.turn_scores.reduce((sum, s) => sum + s.scores.confidence, 0) / (turnState.turn_scores.length || 1),
    vocabulary: turnState.turn_scores.reduce((sum, s) => sum + s.scores.vocabulary, 0) / (turnState.turn_scores.length || 1),
  };

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
        {/* Main: Turn-based monitor */}
        <div className="p-6 overflow-y-auto space-y-6">
          {turnState.participants.length === 0 && (
            <div className="text-center py-20 card flex flex-col items-center justify-center">
              {error && !connected && (
                <div className="mb-4 max-w-sm w-full p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-500 text-center">
                  {error}
                </div>
              )}
              {!connected ? (
                <>
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-3" />
                  <p className="text-muted-soft text-xs font-medium">Establishing connection to session...</p>
                  {retryCount > 0 && (
                    <p className="text-muted-soft text-[10px] mt-2">Retry attempt {retryCount}...</p>
                  )}
                </>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center mb-3 shadow-lg animate-pulse">
                    <Users className="w-6 h-6 text-white" />
                  </div>
                  <p className="text-muted-soft text-sm font-medium">Waiting for participants to connect...</p>
                  <p className="text-muted-soft text-[11px] mt-1">Participants will appear here once they join the GD session</p>
                </>
              )}
            </div>
          )}

          {turnState.participants.length > 0 && (
            <>
              {/* Tab switcher */}
              <div className="flex gap-1 bg-slate-100 dark:bg-slate-900 rounded-xl p-1">
                <button
                  onClick={() => setActiveTab("live")}
                  className={`flex-1 py-2 px-4 rounded-lg text-xs font-bold transition-all ${activeTab === "live" ? "bg-white dark:bg-slate-800 text-heading shadow-sm" : "text-muted-soft hover:text-heading"}`}
                >
                  <Eye className="w-3.5 h-3.5 inline mr-1.5" /> Live Monitor
                </button>
                <button
                  onClick={() => setActiveTab("analytics")}
                  className={`flex-1 py-2 px-4 rounded-lg text-xs font-bold transition-all ${activeTab === "analytics" ? "bg-white dark:bg-slate-800 text-heading shadow-sm" : "text-muted-soft hover:text-heading"}`}
                >
                  <BarChart3 className="w-3.5 h-3.5 inline mr-1.5" /> Analytics
                </button>
              </div>

              {activeTab === "live" && (
                <>
                  {/* Current Speaker Card */}
                  <div className={`card overflow-hidden transition-all duration-300 ${turnState.all_turns_completed ? "border-emerald-500/35" : "border-indigo-500/30 shadow-lg shadow-indigo-500/10"}`}>
                    <div className="p-4 flex items-center justify-between bg-slate-500/5 border-b border-slate-200/50 dark:border-slate-800/50">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-heading">Turn {turnState.current_turn_number} of {turnState.speaking_order.length}</span>
                        {currentSpeaker && (
                          <span className="text-xs text-muted-soft">
                            — {currentSpeaker.label || currentSpeaker.name}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        {turnState.countdown_seconds > 0 && !turnState.all_turns_completed && (
                          <span className={`flex items-center gap-1 text-sm font-mono font-bold ${turnState.countdown_seconds <= 10 ? "text-red-500 animate-pulse" : "text-heading"}`}>
                            <Timer className="w-4 h-4" /> {formatTime(turnState.countdown_seconds)}
                          </span>
                        )}
                        {turnState.all_turns_completed ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            All Turns Complete
                          </span>
                        ) : currentSpeaker ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 animate-pulse">
                            Speaking
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20">
                            Waiting
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="h-1 bg-slate-200 dark:bg-slate-800">
                      <div
                        className={`h-full transition-all duration-500 ${turnState.all_turns_completed ? "bg-emerald-500" : "bg-indigo-500"}`}
                        style={{ width: `${turnState.speaking_order.length > 0 ? (turnState.current_turn_number / turnState.speaking_order.length) * 100 : 0}%` }}
                      />
                    </div>

                    {/* Participant video grid */}
                    <div className="p-5">
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                        {turnState.participants.map((p, idx) => {
                          const isSpeaking = p.user_id === turnState.current_speaker_id;
                          const score = turnState.turn_scores.find((s) => s.user_id === p.user_id);
                          return (
                            <div
                              key={p.user_id}
                              className={`relative rounded-2xl overflow-hidden border transition-all duration-300 ${isSpeaking ? "border-indigo-500 ring-2 ring-indigo-500/30 shadow-lg shadow-indigo-500/20" : p.has_completed_turn ? "border-emerald-500/25" : "border-slate-200/40 dark:border-slate-800/40"}`}
                            >
                              {/* Video thumbnail placeholder */}
                              <div className={`aspect-video ${isSpeaking ? "bg-gradient-to-br from-indigo-500/20 to-purple-500/20" : "bg-slate-200 dark:bg-slate-800"} flex items-center justify-center`}>
                                <div className={`w-10 h-10 rounded-xl bg-gradient-to-tr ${COLORS[idx % COLORS.length]} flex items-center justify-center text-white font-bold text-sm shadow-sm`}>
                                  {(p.label || p.name || "?")[0].toUpperCase()}
                                </div>
                              </div>
                              {/* Info overlay */}
                              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2.5">
                                <p className="text-[10px] font-bold text-white truncate">{p.label || p.name}</p>
                                <div className="flex items-center gap-1.5 mt-1">
                                  {p.mic_on ? (
                                    <Mic className="w-2.5 h-2.5 text-emerald-400" />
                                  ) : (
                                    <MicOff className="w-2.5 h-2.5 text-red-400" />
                                  )}
                                  {p.camera_on ? (
                                    <Video className="w-2.5 h-2.5 text-emerald-400" />
                                  ) : (
                                    <VideoOff className="w-2.5 h-2.5 text-red-400" />
                                  )}
                                  {isSpeaking && (
                                    <span className="text-[8px] font-bold text-indigo-300 animate-pulse ml-auto">SPEAKING</span>
                                  )}
                                  {p.has_completed_turn && !isSpeaking && (
                                    <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400 ml-auto" />
                                  )}
                                </div>
                              </div>
                              {/* Score badge */}
                              {score && (
                                <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm rounded px-1.5 py-0.5">
                                  <p className="text-[9px] font-bold text-indigo-300">{score.scores.overall}%</p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Speaking Order */}
                  <div className="card overflow-hidden">
                    <div className="p-4 bg-slate-500/5 border-b border-slate-200/50 dark:border-slate-800/50">
                      <h3 className="text-xs font-bold text-heading flex items-center gap-2">
                        <Users className="w-4 h-4 text-indigo-500" /> Speaking Order
                      </h3>
                    </div>
                    <div className="p-4 space-y-2">
                      {sortedSpeakingOrder.map((s) => {
                        const participant = turnState.participants.find((p) => p.user_id === s.user_id);
                        const isCurrent = s.user_id === turnState.current_speaker_id;
                        const isCompleted = participant?.has_completed_turn;
                        const score = turnState.turn_scores.find((sc) => sc.user_id === s.user_id);
                        return (
                          <div
                            key={s.user_id}
                            className={`flex items-center gap-3 p-2.5 rounded-xl transition-all ${isCurrent ? "bg-indigo-500/10 border border-indigo-500/20" : isCompleted ? "bg-emerald-500/5 border border-emerald-500/15" : "bg-slate-50 dark:bg-slate-900 border border-transparent"}`}
                          >
                            <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold ${isCurrent ? "bg-indigo-500 text-white" : isCompleted ? "bg-emerald-500 text-white" : "bg-slate-200 dark:bg-slate-800 text-muted-soft"}`}>
                              {s.order}
                            </span>
                            <span className="text-xs font-bold text-heading flex-1">{s.label || s.name}</span>
                            {score && (
                              <span className="text-[10px] font-mono font-bold text-indigo-500">{score.scores.overall}%</span>
                            )}
                            {isCompleted && !isCurrent && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            )}
                            {isCurrent && (
                              <span className="text-[9px] font-bold text-indigo-500 animate-pulse">NOW</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Per-turn scores */}
                  {turnState.turn_scores.length > 0 && (
                    <div className="card overflow-hidden">
                      <div className="p-4 bg-slate-500/5 border-b border-slate-200/50 dark:border-slate-800/50">
                        <h3 className="text-xs font-bold text-heading flex items-center gap-2">
                          <BarChart3 className="w-4 h-4 text-indigo-500" /> Turn Scores
                        </h3>
                      </div>
                      <div className="p-4 space-y-3">
                        {turnState.turn_scores.map((ts, i) => {
                          const participant = turnState.participants.find((p) => p.user_id === ts.user_id);
                          return (
                            <div key={i} className="p-3 rounded-2xl bg-white/50 dark:bg-slate-900/50 border border-slate-200/40 dark:border-slate-800/40">
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-xs font-bold text-heading">Turn {ts.turn_number}: {participant?.label || participant?.name}</p>
                                <span className="text-[10px] font-mono text-muted-soft">{new Date(ts.timestamp).toLocaleTimeString()}</span>
                              </div>
                              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-[10px] text-muted-soft font-mono">
                                <span>G: {ts.scores.grammar}%</span>
                                <span>F: {ts.scores.fluency}%</span>
                                <span>C: {ts.scores.confidence}%</span>
                                <span>V: {ts.scores.vocabulary}%</span>
                                <span>P: {ts.scores.pronunciation}%</span>
                                <span className="text-indigo-500 font-bold">O: {ts.scores.overall}%</span>
                              </div>
                              {ts.transcript && (
                                <p className="text-[10px] text-muted-soft mt-2 line-clamp-2 italic">{ts.transcript}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              {activeTab === "analytics" && (
                <div className="space-y-6">
                  {/* Average scores by category */}
                  <div className="card overflow-hidden">
                    <div className="p-4 bg-slate-500/5 border-b border-slate-200/50 dark:border-slate-800/50">
                      <h3 className="text-xs font-bold text-heading flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-indigo-500" /> Average Scores by Category
                      </h3>
                    </div>
                    <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                      {Object.entries(scoreByCategory).map(([cat, val]) => (
                        <div key={cat} className="card p-3 text-center">
                          <p className="text-lg font-bold text-heading">{Math.round(val)}%</p>
                          <p className="text-[9px] text-muted-soft font-medium uppercase tracking-wider mt-0.5">{cat}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Per-participant analytics */}
                  <div className="card overflow-hidden">
                    <div className="p-4 bg-slate-500/5 border-b border-slate-200/50 dark:border-slate-800/50">
                      <h3 className="text-xs font-bold text-heading flex items-center gap-2">
                        <Users className="w-4 h-4 text-indigo-500" /> Participant Analytics
                      </h3>
                    </div>
                    <div className="p-4 space-y-3">
                      {turnState.participants.map((p, idx) => {
                        const scores = turnState.turn_scores.filter((s) => s.user_id === p.user_id);
                        const avgScore = scores.length > 0
                          ? Math.round(scores.reduce((sum, s) => sum + s.scores.overall, 0) / scores.length)
                          : 0;
                        return (
                          <div key={p.user_id} className="p-3 rounded-2xl bg-white/50 dark:bg-slate-900/50 border border-slate-200/40 dark:border-slate-800/40">
                            <div className="flex items-center gap-3 mb-2">
                              <div className={`w-8 h-8 rounded-xl bg-gradient-to-tr ${COLORS[idx % COLORS.length]} flex items-center justify-center text-white font-bold text-xs shadow-sm`}>
                                {(p.label || p.name || "?")[0].toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-heading truncate">{p.label || p.name}</p>
                                <p className="text-[10px] text-muted-soft">{scores.length} turn{scores.length !== 1 ? "s" : ""} completed</p>
                              </div>
                              <span className="text-sm font-bold text-indigo-500">{avgScore}%</span>
                            </div>
                            {scores.length > 0 && (
                              <div className="grid grid-cols-5 gap-1.5 text-[9px] text-muted-soft font-mono">
                                <span>G: {Math.round(scores.reduce((s, sc) => s + sc.scores.grammar, 0) / scores.length)}%</span>
                                <span>F: {Math.round(scores.reduce((s, sc) => s + sc.scores.fluency, 0) / scores.length)}%</span>
                                <span>C: {Math.round(scores.reduce((s, sc) => s + sc.scores.confidence, 0) / scores.length)}%</span>
                                <span>V: {Math.round(scores.reduce((s, sc) => s + sc.scores.vocabulary, 0) / scores.length)}%</span>
                                <span>P: {Math.round(scores.reduce((s, sc) => s + sc.scores.pronunciation, 0) / scores.length)}%</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Speaking order history */}
                  <div className="card overflow-hidden">
                    <div className="p-4 bg-slate-500/5 border-b border-slate-200/50 dark:border-slate-800/50">
                      <h3 className="text-xs font-bold text-heading flex items-center gap-2">
                        <Clock className="w-4 h-4 text-indigo-500" /> Speaking Order History
                      </h3>
                    </div>
                    <div className="p-4 space-y-2">
                      {sortedSpeakingOrder.map((s) => {
                        const participant = turnState.participants.find((p) => p.user_id === s.user_id);
                        const scores = turnState.turn_scores.filter((sc) => sc.user_id === s.user_id);
                        const turnScore = scores.find((sc) => sc.turn_number === s.order);
                        return (
                          <div key={s.user_id} className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900">
                            <span className="w-6 h-6 rounded-lg bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-[10px] font-bold text-muted-soft">
                              {s.order}
                            </span>
                            <span className="text-xs font-bold text-heading flex-1">{s.label || s.name}</span>
                            {turnScore ? (
                              <span className="text-[10px] font-mono font-bold text-emerald-500">{turnScore.scores.overall}%</span>
                            ) : participant?.has_completed_turn ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            ) : (
                              <span className="text-[9px] text-muted-soft">Pending</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Turn completion status */}
                  <div className="card overflow-hidden">
                    <div className="p-4 bg-slate-500/5 border-b border-slate-200/50 dark:border-slate-800/50">
                      <h3 className="text-xs font-bold text-heading flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Turn Completion Status
                      </h3>
                    </div>
                    <div className="p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="flex-1 h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 transition-all duration-500"
                            style={{ width: `${turnState.participants.length > 0 ? (turnState.participants.filter((p) => p.has_completed_turn).length / turnState.participants.length) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-heading">
                          {turnState.participants.filter((p) => p.has_completed_turn).length}/{turnState.participants.length}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {turnState.participants.map((p) => (
                          <div key={p.user_id} className={`p-2 rounded-lg text-center text-[10px] font-bold ${p.has_completed_turn ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "bg-slate-100 dark:bg-slate-800 text-muted-soft border border-transparent"}`}>
                            {p.label || p.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
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
              <p className="text-lg font-bold text-heading">{turnState.participants.length}</p>
              <p className="text-[9px] text-muted-soft font-medium uppercase tracking-wider">Participants</p>
            </div>
            <div className="card p-2.5 text-center">
              <p className="text-lg font-bold text-heading">{turnState.current_turn_number}</p>
              <p className="text-[9px] text-muted-soft font-medium uppercase tracking-wider">Current Turn</p>
            </div>
            <div className="card p-2.5 text-center">
              <p className="text-lg font-bold text-indigo-500">{turnState.turn_scores.length}</p>
              <p className="text-[9px] text-muted-soft font-medium uppercase tracking-wider">Turns Scored</p>
            </div>
            <div className="card p-2.5 text-center">
              <p className="text-lg font-bold text-emerald-500">{turnState.participants.filter((p) => p.has_completed_turn).length}</p>
              <p className="text-[9px] text-muted-soft font-medium uppercase tracking-wider">Completed</p>
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
