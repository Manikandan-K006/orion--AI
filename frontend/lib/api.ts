const API_URL = process.env.NEXT_PUBLIC_API_URL || (typeof window !== "undefined" ? `${window.location.protocol}//${window.location.hostname}:8000` : "http://localhost:8000");

export type User = {
  id: number;
  name: string;
  email: string;
  role: string;
  register_number?: string;
  department?: string;
  year?: string | number;
};

export type Question = {
  id: number;
  question_text: string;
  category: string;
  difficulty: string;
};

export type Progress = {
  student_id: number;
  average_score: number;
  interviews_completed: number;
  total_credits?: number;
  updated_at?: string;
};

export type Analysis = {
  grammar_score: number;
  pronunciation_score: number;
  fluency_score: number;
  confidence_score: number;
  vocabulary_score: number;
  emotion: string;
  overall_score: number;
  feedback: string;
};

export type GDTopic = {
  id: number;
  topic: string;
  category: string;
};

export type GDSession = {
  session_code: string;
  topic_id: number;
  topic: string;
  status: string;
  team_size: number;
  member_count: number;
  members?: GDMember[];
  created_at: string;
};

export type GDMember = {
  id: number;
  name: string;
  register_number: string;
  joined_at: string;
};

export type SoloQuote = {
  id: number;
  quote: string;
  author: string;
};

export type SoloStartResponse = {
  session_id: number;
  topic: string;
  session_number: number;
  preparation_minutes: number;
  speaking_minutes: number;
  quote: SoloQuote;
  last_session: SoloSessionResult | null;
  is_new_user: boolean;
};

export type SoloSessionResult = {
  id?: number;
  overall_score: number;
  fluency_score: number;
  grammar_score: number;
  accent_score: number;
  delivery_score: number;
  weaknesses?: string;
  improvement_tips?: string;
  topic?: string;
  created_at?: string;
};

export type SoloSubmitResponse = {
  message: string;
  overall_score: number;
  fluency_score: number;
  grammar_score: number;
  accent_score: number;
  delivery_score: number;
  weaknesses: string[];
  improvement_tips: string[];
  last_session: SoloSessionResult | null;
};

export type SoloStats = {
  total_sessions: number;
  is_new: boolean;
  seen_quote_ids?: string;
};

export type GDLeaderboardEntry = {
  id: number;
  user_id: number;
  session_code: string;
  rank_position: number;
  overall_score: number;
  credential_points: number;
  name: string;
  register_number: string;
};

export type LeaderboardRanking = {
  rank: number;
  id: number;
  name: string;
  register_number: string;
  department: string;
  year: string;
  overall_score: number;
  grammar: number;
  fluency: number;
  accent: number;
  relevance: number;
  content_quality: number;
  total_credits: number;
  sessions_completed: number;
};

export type LeaderboardStats = {
  top_score: number;
  active_participants: number;
  average_score: number;
  total_interviews: number;
};

export type AllTimeAchiever = {
  rank: number;
  id: number;
  name: string;
  register_number: string;
  department: string;
  year: string;
  total_credits: number;
  sessions_completed: number;
};

export type ComprehensiveLeaderboard = {
  departments: string[];
  years: string[];
  stats: LeaderboardStats;
  rankings: LeaderboardRanking[];
  all_time_achievers: AllTimeAchiever[];
};

export type GDInvitation = {
  id: number;
  session_code: string;
  status: string;
  created_at: string;
  from_user_id: number;
  from_name: string;
  from_register: string;
  topic: string;
  session_status: string;
};

export type GDLiveSession = {
  id: number;
  session_code: string;
  status: string;
  total_participants: number;
  created_by: number;
  created_at: string;
  participant_count: number;
  team_count: number;
};

export type GDLiveParticipant = {
  id: number;
  session_code: string;
  user_id: number;
  team_number: number | null;
  anonymous_label: string | null;
  transcript: string | null;
  status: string;
  created_at: string;
  name: string;
  register_number: string;
  department: string | null;
  year: string | null;
};

export type GDLiveMyTeam = {
  team_number: number;
  topic: string;
  team_status: string;
  members: string[];
};

export type GDLiveTeamStatus = {
  team_number: number | null;
  my_status: string;
  members_total: number;
  members_done: number;
  all_completed: boolean;
};

export type GDLiveEvaluation = {
  id: number;
  session_code: string;
  user_id: number;
  team_number: number;
  transcript: string;
  overall_score: number;
  fluency_score: number;
  grammar_score: number;
  accent_score: number;
  relevance_score: number;
  content_quality: number;
  credential_points: number;
  weaknesses: string;
  improvement_tips: string;
  evaluated_at: string;
  session_status?: string;
};

export type GDLiveLeaderboardEntry = {
  id: number;
  session_code: string;
  user_id: number;
  team_number: number;
  overall_score: number;
  fluency_score: number;
  grammar_score: number;
  accent_score: number;
  relevance_score: number;
  content_quality: number;
  credential_points: number;
  name: string;
  register_number: string;
  anonymous_label: string | null;
  transcript?: string;
};

export type GDLiveRoomMember = {
  user_id: number;
  name: string | null;
  label: string | null;
  department: string | null;
  year: string | null;
  status: string;
};

export type GDLiveRoomState = {
  session_code: string;
  status: string;
  topic: string | null;
  members: GDLiveRoomMember[];
  teams?: any[];
};

export async function hostGdLiveMeeting(sessionCode: string, token: string) {
  return apiRequest<{ message: string; session_code: string; topic: string | null; members: GDLiveRoomMember[] }>(
    `/gd-live/sessions/${sessionCode}/host-meeting`,
    { method: "POST" },
    token,
  );
}

export async function endGdLiveMeeting(sessionCode: string, token: string) {
  return apiRequest<{ message: string }>(
    `/gd-live/sessions/${sessionCode}/end-live`,
    { method: "POST" },
    token,
  );
}

export async function getGdLiveState(sessionCode: string, token: string) {
  return apiRequest<GDLiveRoomState>(
    `/gd-live/sessions/${sessionCode}/live-state`,
    { method: "GET" },
    token,
  );
}

export async function apiRequest<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10-second max timeout

  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
      }
    });

    clearTimeout(timeoutId);

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || "Request failed");
      if (response.status === 401 && detail === "Invalid or expired authentication token") {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("auth-expired"));
        }
      }
      throw new Error(detail);
    }
    return data as T;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error("Request timed out (Backend is unreachable). Please try again.");
    }
    throw err;
  }
}

export async function uploadAudio(file: File, token: string) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${API_URL}/interviews/upload-audio`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "Upload failed");
  return data as { audio_path: string; transcript: string; message: string };
}

export async function downloadReport(sessionId: number, token: string) {
  const response = await fetch(`${API_URL}/reports/${sessionId}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "Download failed");
  }
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `interview_report_${sessionId}.pdf`;
  a.click();
  window.URL.revokeObjectURL(url);
}

export async function changePassword(payload: { current_password: string; new_password: string }, token: string) {
  return apiRequest<{ message: string }>(
    `/change-password`,
    { method: "POST", body: JSON.stringify(payload) },
    token
  );
}
