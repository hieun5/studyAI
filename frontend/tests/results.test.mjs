import assert from "node:assert/strict";
import { test } from "node:test";
import {
  summarize,
  recordPractice,
  cachedSummary,
  loadResults,
  saveResults,
  clearStoredResults,
  RESULTS_KEY,
  MAX_STORAGE_CHARS,
  MAX_ATTEMPTS,
} from "../.ui-test-build/entries.js";
import { feedback, practice, question, MemoryStorage } from "./fixtures.mjs";
const attempt = (id = "session", questions = [question()], now = 100) =>
  recordPractice([], id, practice(questions), now)[0];

test("Topic grouping normalizes case and whitespace but preserves technical punctuation", () => {
  const summary = summarize([
    attempt("one", [
      question("a", "Cellular Energy"),
      question("b", "  cellular   energy  ", 1),
      question("c", "C++"),
      question("d", "C#"),
    ]),
  ]);
  assert.equal(summary.topics.length, 3);
  const energy = summary.topics.find(
    (topic) => topic.key === "cellular energy",
  );
  assert.equal(energy.answered, 2);
  assert.equal(energy.correct, 1);
  assert.equal(energy.incorrect, 1);
  assert.equal(energy.scorePercent, 50);
});

test("Overall score uses all answers rather than averaging topic percentages", () => {
  const summary = summarize([
    attempt("one", [
      question("a", "Topic A"),
      question("b", "Topic A"),
      question("c", "Topic B", 1),
    ]),
  ]);
  assert.equal(summary.answered, 3);
  assert.equal(summary.correct, 2);
  assert.equal(summary.scorePercent, 66.7);
});

test("Scores are independent of LLM assessments and cached correct flags", () => {
  const stored = attempt("one", [
    question("a", "Energy", 1, feedback("supported")),
    question(
      "b",
      "Energy",
      0,
      feedback("unsupported", "Possible uncertainty", "ATP"),
    ),
  ]);
  stored.questions[0].correct = true;
  stored.questions[1].correct = false;
  const summary = summarize([stored]);
  assert.equal(summary.correct, 1);
  assert.equal(summary.scorePercent, 50);
  stored.questions.forEach((question) => {
    question.feedback.reasoning_assessment = "supported";
  });
  assert.equal(summarize([stored]).scorePercent, 50);
});

test("Incorrect answers recommend their topic even without AI feedback", () => {
  const summary = summarize([
    attempt("one", [question("a", "Cellular energy", 1, null)]),
  ]);
  assert.equal(summary.recommendations.length, 1);
  assert.equal(summary.recommendations[0].reviewTopic, "Cellular energy");
  assert.match(summary.recommendations[0].reason, /1 of 1/);
  assert.deepEqual(summary.recommendations[0].sessionIds, ["one"]);
});

test("Recurring feedback adds a qualitative review signal without lowering correct scores", () => {
  const concern = feedback(
    "partially_supported",
    "Uncertain role of ATP",
    "Cellular respiration",
  );
  const summary = summarize([
    attempt("one", [
      question("a", "Energy", 0, concern),
      question("b", "Energy", 0, concern),
    ]),
  ]);
  assert.equal(summary.scorePercent, 100);
  assert.equal(summary.recommendations.length, 1);
  assert.ok(
    summary.recommendations[0].patterns.every((pattern) => pattern.count === 2),
  );
  assert.equal(summary.recommendations[0].reviewTopic, "Cellular respiration");
  assert.match(
    summary.recommendations[0].reason,
    /numerical score is unchanged/,
  );
  assert.equal(
    summarize([attempt("one", [question("a", "Energy", 0, concern)])])
      .recommendations.length,
    0,
  );
});

test("Supported reasoning without a suggested gap does not create review signals", () => {
  const summary = summarize([attempt("one", [question("a"), question("b")])]);
  assert.equal(summary.recommendations.length, 0);
});

test("Capture saves only locked submissions and feedback updates do not double count", () => {
  const pending = question("later");
  pending.submission = null;
  const initial = practice([question("first", "Energy", 1, null), pending]);
  let attempts = recordPractice([], "one", initial, 100);
  assert.equal(attempts[0].questions.length, 1);
  assert.equal(summarize(attempts).completedAttempts, 0);
  assert.equal(recordPractice(attempts, "one", initial, 200), attempts);
  initial.questions[0].submission.feedback = feedback(
    "unsupported",
    "ATP confusion",
  );
  initial.questions[0].submission.feedback_status = "available";
  initial.questions[0].submission.feedback_error = null;
  attempts = recordPractice(attempts, "one", initial, 200);
  assert.equal(summarize(attempts).answered, 1);
  assert.equal(summarize(attempts).scorePercent, 0);
  assert.equal(attempts[0].questions[0].answeredAt, 100);
  assert.equal(
    attempts[0].questions[0].feedback.reasoning_assessment,
    "unsupported",
  );
});

test("Repeated snapshots cannot change an already-recorded locked answer", () => {
  const first = recordPractice([], "one", practice([question("q")]), 100);
  assert.throws(
    () =>
      recordPractice(
        first,
        "one",
        practice([question("q", "Cellular energy", 1)]),
        200,
      ),
    /locked answer/,
  );
});

test("Cleared answers can be excluded while future submissions are saved", () => {
  const records = recordPractice(
    [],
    "one",
    practice([question("old"), question("new")]),
    100,
    new Set(["one/old"]),
  );
  assert.deepEqual(
    records[0].questions.map((question) => question.questionId),
    ["new"],
  );
});

test("Results and derived summaries persist and reload in localStorage format", () => {
  const storage = new MemoryStorage();
  const attempts = [
    attempt("one", [question("a"), question("b", "Energy", 1)]),
  ];
  const saved = saveResults(attempts, storage);
  assert.equal(saved.persisted, true);
  const payload = JSON.parse(storage.getItem(RESULTS_KEY));
  assert.equal(payload.version, 1);
  assert.deepEqual(payload.summary, cachedSummary(attempts));
  assert.deepEqual(loadResults(storage).attempts, attempts);
  payload.summary.scorePercent = 999;
  storage.setItem(RESULTS_KEY, JSON.stringify(payload));
  const reloaded = loadResults(storage);
  assert.equal(summarize(reloaded.attempts).scorePercent, 50);
  assert.match(reloaded.notice, /Rebuilt/);
});

test("Optional explanations persist without inventing feedback or review signals", () => {
  const blank = question("blank");
  blank.submission.student_explanation = "";
  blank.submission.feedback = null;
  blank.submission.feedback_status = "skipped";
  blank.submission.feedback_error = null;
  const short = question("short");
  short.submission.student_explanation = "ATP";
  const attempts = [attempt("optional", [blank, short])];
  const storage = new MemoryStorage();
  assert.equal(saveResults(attempts, storage).persisted, true);
  const loaded = loadResults(storage);
  assert.equal(loaded.notice, "");
  assert.equal(loaded.writeBlocked, false);
  assert.deepEqual(loaded.attempts, attempts);
  assert.equal(loaded.attempts[0].questions[0].studentExplanation, "");
  assert.equal(loaded.attempts[0].questions[0].feedbackStatus, "skipped");
  assert.equal(summarize(loaded.attempts).scorePercent, 100);
  assert.equal(summarize(loaded.attempts).recommendations.length, 0);
  assert.equal(summarize(loaded.attempts).topics[0].feedbackCount, 1);
  const invalid = JSON.parse(storage.getItem(RESULTS_KEY));
  invalid.attempts[0].questions[0].studentExplanation = "Contradictory skipped feedback";
  storage.setItem(RESULTS_KEY, JSON.stringify(invalid));
  assert.equal(loadResults(storage).writeBlocked, true);
});

test("Invalid saved data is rejected and preserved until explicit reset", () => {
  const storage = new MemoryStorage();
  saveResults([attempt()], storage);
  const valid = storage.getItem(RESULTS_KEY);
  const mutations = [
    () => "{broken",
    (value) => {
      value.version = 999;
      return JSON.stringify(value);
    },
    (value) => {
      value.attempts[0].questions[0].correctIndex = 7;
      return JSON.stringify(value);
    },
    (value) => {
      value.attempts[0].questions[0].pdfFile = "not allowed";
      return JSON.stringify(value);
    },
    (value) => {
      value.attempts[0].questions[0].selectedAnswer = "tampered";
      return JSON.stringify(value);
    },
    () => "x".repeat(MAX_STORAGE_CHARS + 1),
  ];
  for (const mutate of mutations) {
    const invalid = mutate(JSON.parse(valid));
    storage.setItem(RESULTS_KEY, invalid);
    const loaded = loadResults(storage);
    assert.deepEqual(loaded.attempts, []);
    assert.equal(loaded.writeBlocked, true);
    assert.match(loaded.notice, /invalid/);
    assert.equal(storage.getItem(RESULTS_KEY), invalid);
  }
});

test("Capture whitelists result fields, clips excerpts, and never saves PDF blobs or full notes", () => {
  const value = practice([question()]);
  value.pdfFile = "ORIGINAL_PDF_BYTES";
  value.lectureNotes = "ENTIRE_LECTURE";
  value.questions[0].submission.pdfFile = "ORIGINAL_PDF_BYTES";
  value.questions[0].submission.answer_sources = [
    {
      chunk_id: "chunk-1",
      text: "a".repeat(2000),
      source_type: "pdf",
      filename: "lecture.pdf",
      page_number: 1,
      score: 1,
    },
  ];
  const storage = new MemoryStorage();
  saveResults(recordPractice([], "one", value, 100), storage);
  const raw = storage.getItem(RESULTS_KEY);
  assert.doesNotMatch(
    raw,
    /ORIGINAL_PDF_BYTES|ENTIRE_LECTURE|pdfFile|lectureNotes/,
  );
  assert.equal(
    loadResults(storage).attempts[0].questions[0].answerSources[0].text.length,
    1500,
  );
});

test("History count limits keep newest attempts and disclose retention", () => {
  const storage = new MemoryStorage();
  const attempts = Array.from({ length: MAX_ATTEMPTS + 1 }, (_, index) =>
    attempt("session-" + index, [question()], 100 + index),
  );
  const saved = saveResults(attempts, storage);
  assert.equal(saved.attempts.length, MAX_ATTEMPTS);
  assert.equal(saved.attempts[0].sessionId, "session-1");
  assert.match(saved.notice, /removed 1 oldest/);
});

test("Quota errors prune older attempts only when a smaller write succeeds", () => {
  const storage = new MemoryStorage();
  saveResults([attempt("first")], storage);
  storage.limit = storage.getItem(RESULTS_KEY).length + 20;
  const saved = saveResults(
    [attempt("first"), attempt("newest", [question()], 200)],
    storage,
  );
  assert.equal(saved.persisted, true);
  assert.deepEqual(
    saved.attempts.map((item) => item.sessionId),
    ["newest"],
  );
  assert.match(saved.notice, /Storage limits/);
  assert.equal(loadResults(storage).attempts[0].sessionId, "newest");
});

test("Blocked storage preserves in-memory results and explains refresh risk", () => {
  const storage = new MemoryStorage();
  storage.blocked = true;
  const saved = saveResults([attempt()], storage);
  assert.equal(saved.persisted, false);
  assert.equal(saved.attempts.length, 1);
  assert.match(saved.notice, /lost on refresh/);
  assert.equal(clearStoredResults(storage), false);
});

test("Clear removes only the results key and empty summaries have no invented score", () => {
  const storage = new MemoryStorage();
  storage.setItem("studyai-theme", "dark");
  saveResults([attempt()], storage);
  assert.equal(clearStoredResults(storage), true);
  assert.equal(storage.getItem(RESULTS_KEY), null);
  assert.equal(storage.getItem("studyai-theme"), "dark");
  const empty = summarize(loadResults(storage).attempts);
  assert.equal(empty.answered, 0);
  assert.equal(empty.scorePercent, null);
  assert.deepEqual(empty.recommendations, []);
});

test("Character budget prunes whole old attempts and keeps the stored summary consistent", () => {
  const storage = new MemoryStorage();
  const sources = Array.from({ length: 4 }, (_, index) => ({
    chunk_id: "chunk-" + index,
    text: "x".repeat(1500),
    source_type: "pdf",
    filename: "lecture.pdf",
    page_number: index + 1,
    score: 0.7,
  }));
  const attempts = Array.from({ length: 12 }, (_, index) => {
    const questions = Array.from({ length: 10 }, (_, item) => {
      const q = question("q-" + item);
      q.submission.answer_sources = sources;
      q.submission.feedback.source_passages_used = sources;
      return q;
    });
    const quiz = { ...practice(questions), requested_count: 10 };
    return recordPractice([], "large-session-" + index, quiz, 100 + index)[0];
  });
  const saved = saveResults(attempts, storage);
  assert.equal(saved.persisted, true);
  assert.ok(saved.attempts.length < attempts.length);
  assert.ok(storage.getItem(RESULTS_KEY).length <= MAX_STORAGE_CHARS);
  const payload = JSON.parse(storage.getItem(RESULTS_KEY));
  assert.deepEqual(payload.summary, cachedSummary(saved.attempts));
  assert.equal(saved.attempts.at(-1).sessionId, "large-session-11");
});

test("Unicode technical terms use character limits and excerpts do not split surrogate pairs", () => {
  const q = question("unicode", "𝛼".repeat(80));
  q.options[0] = "𝛼".repeat(200);
  q.submission.answer_sources = [
    {
      chunk_id: "chunk-1",
      text: "𝛼".repeat(1600),
      source_type: "notes",
      filename: null,
      page_number: null,
      score: 1,
    },
  ];
  const storage = new MemoryStorage();
  const saved = saveResults(
    recordPractice([], "unicode-session", practice([q]), 100),
    storage,
  );
  assert.equal(saved.persisted, true);
  const reloaded = loadResults(storage);
  assert.equal(reloaded.writeBlocked, false);
  assert.equal(reloaded.attempts[0].questions[0].correctAnswer, q.options[0]);
  const excerpt = reloaded.attempts[0].questions[0].answerSources[0].text;
  assert.equal(Array.from(excerpt).length, 1500);
  assert.equal(excerpt, "𝛼".repeat(1500));
});
