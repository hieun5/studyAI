import type { Passage, ReasoningFeedback } from "../api";
import {
  cachedSummary,
  type CompletedQuestion,
  type QuizAttempt,
} from "./model";

export const RESULTS_KEY = "studyai-results-v1";
export const MAX_ATTEMPTS = 20;
export const MAX_STORAGE_CHARS = 750000; // UTF-16 code units: at most ~1.5 MiB.
export interface ResultStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface LoadedResults {
  attempts: QuizAttempt[];
  notice: string;
  writeBlocked: boolean;
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object");
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error("Unexpected saved field");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, min = 1): string {
  if (
    typeof value !== "string" ||
    value.length > max * 2 ||
    Array.from(value).length > max ||
    Array.from(value.trim()).length < min
  )
    throw new Error("Invalid text field");
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < min ||
    (value as number) > max
  )
    throw new Error("Invalid number field");
  return value as number;
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error("Invalid list field");
  return value;
}
function source(value: unknown): Passage {
  const item = object(value, [
    "chunk_id",
    "text",
    "source_type",
    "filename",
    "page_number",
    "score",
  ]);
  if (item.source_type !== "notes" && item.source_type !== "pdf")
    throw new Error("Invalid source type");
  if (
    typeof item.score !== "number" ||
    !Number.isFinite(item.score) ||
    item.score < 0 ||
    item.score > 1
  )
    throw new Error("Invalid similarity score");
  return {
    chunk_id: text(item.chunk_id, 128),
    text: text(item.text, 1500),
    source_type: item.source_type,
    filename: item.filename === null ? null : text(item.filename, 255),
    page_number:
      item.page_number === null ? null : integer(item.page_number, 1, 1000000),
    score: item.score,
  };
}
function feedback(value: unknown): ReasoningFeedback | null {
  if (value === null) return null;
  const item = object(value, [
    "reasoning_assessment",
    "explanation",
    "possible_knowledge_gap",
    "recommended_topic_to_review",
    "source_passages_used",
    "assessment_note",
  ]);
  const assessments = [
    "supported",
    "partially_supported",
    "unsupported",
    "unclear",
  ] as const;
  if (
    !assessments.includes(
      item.reasoning_assessment as (typeof assessments)[number],
    )
  )
    throw new Error("Invalid reasoning assessment");
  return {
    reasoning_assessment:
      item.reasoning_assessment as (typeof assessments)[number],
    explanation: text(item.explanation, 2000),
    possible_knowledge_gap:
      item.possible_knowledge_gap === null
        ? null
        : text(item.possible_knowledge_gap, 500),
    recommended_topic_to_review: text(item.recommended_topic_to_review, 200),
    source_passages_used: list(item.source_passages_used, 4).map(source),
    assessment_note: text(item.assessment_note, 500),
  };
}
function question(value: unknown): CompletedQuestion {
  const item = object(value, [
    "questionId",
    "question",
    "topic",
    "options",
    "selectedIndex",
    "correctIndex",
    "selectedAnswer",
    "correctAnswer",
    "correct",
    "studentExplanation",
    "answerExplanation",
    "answerSources",
    "feedback",
    "feedbackStatus",
    "feedbackError",
    "answeredAt",
  ]);
  const options = list(item.options, 4).map((option) => text(option, 300));
  if (
    options.length !== 4 ||
    new Set(options.map((option) => option.trim().toLowerCase())).size !== 4
  )
    throw new Error("Invalid answer options");
  const selectedIndex = integer(item.selectedIndex, 0, 3);
  const correctIndex = integer(item.correctIndex, 0, 3);
  if (
    item.selectedAnswer !== options[selectedIndex] ||
    item.correctAnswer !== options[correctIndex] ||
    item.correct !== (selectedIndex === correctIndex)
  )
    throw new Error("Inconsistent answer record");
  if (
    !["pending", "available", "unavailable", "skipped"].includes(
      item.feedbackStatus as string,
    )
  )
    throw new Error("Invalid feedback status");
  const savedFeedback = feedback(item.feedback);
  if ((item.feedbackStatus === "available") !== (savedFeedback !== null))
    throw new Error("Inconsistent feedback record");
  const studentExplanation = text(item.studentExplanation, 2000, 0);
  if (
    item.feedbackStatus === "skipped" &&
    (studentExplanation.trim() !== "" || item.feedbackError !== null)
  )
    throw new Error("Inconsistent skipped feedback record");
  return {
    questionId: text(item.questionId, 128),
    question: text(item.question, 600, 8),
    topic: text(item.topic, 100),
    options,
    selectedIndex,
    correctIndex,
    selectedAnswer: options[selectedIndex],
    correctAnswer: options[correctIndex],
    correct: selectedIndex === correctIndex,
    studentExplanation,
    answerExplanation: text(item.answerExplanation, 1000),
    answerSources: list(item.answerSources, 4).map(source),
    feedback: savedFeedback,
    feedbackStatus: item.feedbackStatus as CompletedQuestion["feedbackStatus"],
    feedbackError:
      item.feedbackError === null ? null : text(item.feedbackError, 2000),
    answeredAt: integer(item.answeredAt, 0, Number.MAX_SAFE_INTEGER),
  };
}

export function validateAttempts(
  value: unknown,
  max = MAX_ATTEMPTS,
): QuizAttempt[] {
  const attempts = list(value, max).map((raw) => {
    const item = object(raw, [
      "sessionId",
      "model",
      "requestedCount",
      "generatedCount",
      "startedAt",
      "updatedAt",
      "questions",
    ]);
    if (item.requestedCount !== 5 && item.requestedCount !== 10)
      throw new Error("Invalid requested count");
    const generatedCount = integer(item.generatedCount, 1, item.requestedCount);
    const questions = list(item.questions, generatedCount).map(question);
    if (
      !questions.length ||
      new Set(questions.map((item) => item.questionId)).size !==
        questions.length
    )
      throw new Error("Empty/duplicate answer records");
    const startedAt = integer(item.startedAt, 0, Number.MAX_SAFE_INTEGER);
    const updatedAt = integer(
      item.updatedAt,
      startedAt,
      Number.MAX_SAFE_INTEGER,
    );
    if (
      questions.some(
        (question) =>
          question.answeredAt < startedAt || question.answeredAt > updatedAt,
      )
    )
      throw new Error("Invalid answer timestamp");
    return {
      sessionId: text(item.sessionId, 128),
      model: text(item.model, 128),
      requestedCount: item.requestedCount,
      generatedCount,
      startedAt,
      updatedAt,
      questions,
    } as QuizAttempt;
  });
  if (new Set(attempts.map((item) => item.sessionId)).size !== attempts.length)
    throw new Error("Duplicate quiz attempts");
  return attempts.sort((a, b) => a.updatedAt - b.updatedAt);
}

function browserStorage(): ResultStorage {
  return window.localStorage;
}
export function loadResults(storage?: ResultStorage): LoadedResults {
  let raw: string | null;
  try {
    raw = (storage ?? browserStorage()).getItem(RESULTS_KEY);
  } catch {
    return {
      attempts: [],
      notice:
        "Browser storage is unavailable. New results will stay in memory for this visit.",
      writeBlocked: false,
    };
  }
  if (raw === null) return { attempts: [], notice: "", writeBlocked: false };
  try {
    if (raw.length > MAX_STORAGE_CHARS)
      throw new Error("Saved data is oversized");
    const value = object(JSON.parse(raw), ["version", "attempts", "summary"]);
    if (value.version !== 1) throw new Error("Unsupported saved-data version");
    const attempts = validateAttempts(value.attempts);
    const rebuilt = cachedSummary(attempts);
    const notice =
      JSON.stringify(value.summary) === JSON.stringify(rebuilt)
        ? ""
        : "Rebuilt the saved summary from answer records; cached scores are never trusted.";
    return { attempts, notice, writeBlocked: false };
  } catch {
    return {
      attempts: [],
      notice:
        "Saved results are invalid or use an unsupported format. Clear saved results to reset storage. New results can still be viewed in memory.",
      writeBlocked: true,
    };
  }
}

export function saveResults(
  input: QuizAttempt[],
  storage?: ResultStorage,
): { attempts: QuizAttempt[]; notice: string; persisted: boolean } {
  const bounded = validateAttempts(
    [...input].sort((a, b) => a.updatedAt - b.updatedAt).slice(-MAX_ATTEMPTS),
  );
  let kept = [...bounded];
  function encode() {
    return JSON.stringify({
      version: 1,
      attempts: kept,
      summary: cachedSummary(kept),
    });
  }
  let payload = encode();
  while (payload.length > MAX_STORAGE_CHARS && kept.length > 1) {
    kept.shift();
    payload = encode();
  }
  if (payload.length > MAX_STORAGE_CHARS)
    return {
      attempts: bounded,
      notice:
        "This quiz result exceeds the browser storage budget. Results remain in memory for this visit.",
      persisted: false,
    };
  while (true) {
    try {
      (storage ?? browserStorage()).setItem(RESULTS_KEY, payload);
      const removed = input.length - kept.length;
      return {
        attempts: kept,
        persisted: true,
        notice: removed
          ? "Storage limits removed " +
            removed +
            " oldest saved attempt(s). The dashboard reflects the retained results."
          : "",
      };
    } catch (error) {
      const quota =
        error !== null &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "QuotaExceededError";
      if (quota && kept.length > 1) {
        kept.shift();
        payload = encode();
        continue;
      }
      return {
        attempts: bounded,
        notice:
          "Could not save results to browser storage. They remain available in this visit; new changes may be lost on refresh.",
        persisted: false,
      };
    }
  }
}

export function clearStoredResults(storage?: ResultStorage): boolean {
  try {
    (storage ?? browserStorage()).removeItem(RESULTS_KEY);
    return true;
  } catch {
    return false;
  }
}
