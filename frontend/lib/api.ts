const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type User = {
  id: number;
  name: string;
  email: string;
  role: string;
  register_number?: string;
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

export async function apiRequest<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || "Request failed");
    throw new Error(detail);
  }
  return data as T;
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
