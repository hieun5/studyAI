export const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export interface Limits {
  max_pdf_bytes: number;
  max_pdf_pages: number;
  max_notes_chars: number;
  session_ttl_seconds: number;
  llm_request_timeout_seconds: number;
}
export interface MaterialSession {
  session_id: string;
  chunk_count: number;
  page_count: number;
  skipped_pages: number[];
  expires_at: number;
}
export interface Passage {
  chunk_id: string;
  text: string;
  source_type: "notes" | "pdf";
  filename: string | null;
  page_number: number | null;
  score: number;
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  // Long-running AI callers supply their own timeout; ordinary calls are bounded.
  const controller = options?.signal ? null : new AbortController();
  const timeout = controller ? setTimeout(() => controller.abort(), 15000) : null;
  try {
    let response: Response;
    try {
      response = await fetch(API_BASE + path, {
        ...options,
        signal: options?.signal ?? controller?.signal,
      });
    } catch (error) {
      if (controller?.signal.aborted)
        throw new Error("The local backend request timed out. Check FastAPI and try again.");
      if (options?.signal?.aborted) throw error;
      throw new Error("Cannot reach the local backend. Start FastAPI and try again.");
    }
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const detail = body && typeof body === "object" && "detail" in body ? body.detail : null;
      throw new Error(
        typeof detail === "string" ? detail :
          "Request failed (" + response.status + "). Check your input and try again.",
      );
    }
    if (response.status === 204) return undefined as T;
    try {
      return await response.json();
    } catch {
      throw new Error("The local backend returned an unreadable response. Check the server and try again.");
    }
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}

export async function deleteSession(id: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(API_BASE + "/sessions/" + encodeURIComponent(id), {
      method: "DELETE", keepalive: true, signal: controller.signal,
    });
    if (!response.ok && response.status !== 404) throw new Error("Delete failed");
  } catch {
    throw new Error("Could not clear the server session. Check FastAPI and try again; the session will expire automatically.");
  } finally {
    clearTimeout(timeout);
  }
}

export interface OllamaHealth {
  available: boolean;
  service_available: boolean;
  model_available: boolean;
  model: string;
  message: string;
}
export interface ReasoningFeedback {
  reasoning_assessment:
    "supported" | "partially_supported" | "unsupported" | "unclear";
  explanation: string;
  possible_knowledge_gap: string | null;
  recommended_topic_to_review: string;
  source_passages_used: Passage[];
  assessment_note: string;
}
export interface Submission {
  locked: boolean;
  selected_index: number;
  student_explanation: string;
  correct: boolean;
  correct_index: number;
  answer_explanation: string;
  answer_sources: Passage[];
  feedback: ReasoningFeedback | null;
  feedback_status: "pending" | "available" | "unavailable";
  feedback_error: string | null;
}
export interface PracticeQuestion {
  question_id: string;
  question: string;
  options: string[];
  topic: string;
  submission: Submission | null;
}
export interface PracticeSet {
  questions: PracticeQuestion[];
  requested_count: number;
  returned_count: number;
  notice: string | null;
  model: string;
}
