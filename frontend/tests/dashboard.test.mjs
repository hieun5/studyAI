import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { JSDOM } from "jsdom";
import { feedback, question, practice, submission } from "./fixtures.mjs";

const dom = new JSDOM(
  '<!doctype html><html><body><div id="test-root"></div></body></html>',
  { url: "http://localhost:5173" },
);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
window.matchMedia = () => ({
  matches: false,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
});
class TestResizeObserver {
  observe(element) {
    this.callback([
      { target: element, contentRect: { width: 900, height: 320 } },
    ]);
  }
  unobserve() {}
  disconnect() {}
  constructor(callback) {
    this.callback = callback;
  }
}
globalThis.ResizeObserver = TestResizeObserver;
window.ResizeObserver = TestResizeObserver;
window.HTMLElement.prototype.getBoundingClientRect = function () {
  return {
    width: 900,
    height: 320,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 900,
    bottom: 320,
    toJSON() {},
  };
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const {
  Dashboard,
  App,
  useQuizResults,
  recordPractice,
  RESULTS_KEY,
  summarize,
} = await import("../.ui-test-build/entries.js");
const host = document.getElementById("test-root");
let root;
const response = (body, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const button = (text) =>
  [...host.querySelectorAll("button")].find((item) =>
    item.textContent.includes(text),
  );
async function click(text) {
  const target = button(text);
  assert.ok(target, "Button exists: " + text);
  await act(async () => target.click());
}
async function render(element) {
  root = createRoot(host);
  await act(async () => root.render(element));
  for (
    let index = 0;
    host.querySelector(".chart-loading") && index < 100;
    index++
  ) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}
async function unmount() {
  if (root) await act(async () => root.unmount());
  root = null;
  host.replaceChildren();
}
async function setInput(selector, value) {
  const input = host.querySelector(selector);
  assert.ok(input);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    ).set.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}
afterEach(async () => {
  await unmount();
  window.localStorage.clear();
});

const sample = () =>
  recordPractice(
    [],
    "session",
    practice([
      question("a", "Cellular energy"),
      question("b", "Cellular energy", 1),
      question("c", "Signals"),
    ]),
    100,
  );
const dashboard = (attempts, extra = {}) =>
  createElement(Dashboard, {
    attempts,
    notice: "",
    onClear() {},
    onStart() {},
    activeSessionId: null,
    ...extra,
  });

test("Empty dashboard offers studying and does not invent a score or render a chart", async () => {
  let starts = 0;
  await render(dashboard([], { onStart: () => starts++ }));
  assert.match(host.textContent, /No submitted quiz results yet/);
  assert.doesNotMatch(host.textContent, /0%/);
  assert.equal(host.querySelector("svg"), null);
  await click("Start Studying");
  assert.equal(starts, 1);
});

test("Real Recharts SVG bars render with correct topic counts and transparent scores", async () => {
  await render(dashboard(sample()));
  assert.ok(
    host.querySelector("svg.recharts-surface"),
    "Recharts SVG is rendered",
  );
  const bars = host.querySelectorAll(".recharts-bar-rectangle");
  assert.equal(bars.length, 2);
  assert.ok(
    [...bars].every((bar) => bar.querySelector("path")),
    "Actual bar paths are rendered",
  );
  const rows = host.querySelectorAll(".topic-table tbody tr");
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /Cellular energy/);
  assert.match(rows[0].textContent, /50%/);
  assert.match(rows[1].textContent, /Signals/);
  assert.match(rows[1].textContent, /100%/);
  assert.match(host.textContent, /66.7%/);
  assert.match(
    host.textContent,
    /AI reasoning assessments never change these bars/,
  );
});

test("Correct scores remain unchanged while qualitative concerns are shown separately", async () => {
  const ai = feedback("unsupported", "Possible ATP confusion", "Respiration");
  const attempts = recordPractice(
    [],
    "session",
    practice([question("a", "Energy", 0, ai), question("b", "Energy", 0, ai)]),
    100,
  );
  await render(dashboard(attempts));
  assert.match(host.querySelector(".dashboard-stats").textContent, /100%/);
  assert.match(host.textContent, /numerical score is unchanged/);
  assert.match(host.textContent, /qualitative estimate/);
  assert.ok(host.querySelector(".question-feedback summary"));
  await act(async () =>
    host.querySelector(".question-feedback summary").click(),
  );
  assert.equal(host.querySelector(".question-feedback").open, true);
  assert.match(
    host.querySelector(".question-feedback-body").textContent,
    /Your written explanation/,
  );
  assert.match(
    host.querySelector(".question-feedback-body").textContent,
    /Possible ATP confusion/,
  );
});

test("Recommendations retrieve passages through the existing notes API", async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return response({
      passages: [
        {
          chunk_id: "chunk-1",
          text: "ATP stores energy for cells.",
          source_type: "pdf",
          filename: "lecture.pdf",
          page_number: 2,
          score: 0.7,
        },
      ],
    });
  };
  await render(dashboard(sample()));
  await click("Find passages in my notes");
  assert.equal(calls[0].url, "http://127.0.0.1:8000/sessions/session/retrieve");
  assert.match(calls[0].body.query, /Cellular respiration/);
  assert.match(host.textContent, /lecture.pdf · Page 2/);
  assert.match(host.textContent, /ATP stores energy for cells/);
});

test("Expired source sessions leave saved results available with reprocessing instructions", async () => {
  globalThis.fetch = async () =>
    response({ detail: "Session not found or expired." }, 404);
  await render(dashboard(sample()));
  await click("Find passages in my notes");
  assert.match(
    host.textContent,
    /lecture-note index is unavailable or expired/,
  );
  assert.match(host.textContent, /saved results remain available/);
  assert.match(host.querySelector(".dashboard-stats").textContent, /66.7%/);
});

test("Full app records a submission, restores it after remount, and clears only saved results", async () => {
  const locked = submission(1, 0, feedback("supported"));
  const quiz = practice([{ ...question(), submission: null }]);
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith("/health")) return response({ status: "ok" });
    if (url.endsWith("/limits"))
      return response({
        max_pdf_bytes: 20971520,
        max_pdf_pages: 100,
        max_notes_chars: 100000,
        session_ttl_seconds: 1800,
        llm_request_timeout_seconds: 390,
      });
    if (url.endsWith("/health/ollama"))
      return response({
        available: true,
        service_available: true,
        model_available: true,
        model: "mock-model:latest",
        message: "Ready",
      });
    if (url.endsWith("/sessions") && options.method === "POST")
      return response(
        {
          session_id: "session",
          chunk_count: 1,
          page_count: 0,
          skipped_pages: [],
          expires_at: Date.now() / 1000 + 1800,
        },
        201,
      );
    if (url.endsWith("/questions")) return response(quiz);
    if (url.endsWith("/submit")) return response(locked);
    if (options.method === "DELETE") return response(null, 204);
    throw new Error("Unexpected request: " + url);
  };
  window.localStorage.setItem("studyai-theme", "dark");
  await render(createElement(App));
  await act(async () => host.querySelectorAll(".nav-item")[2].click());
  await setInput(
    "#notes",
    "Mitochondria generate ATP. ATP stores energy for cells.",
  );
  await click("Process Material");
  await click("Generate Questions");
  await act(async () =>
    host.querySelectorAll(".answer-options input")[1].click(),
  );
  await setInput("#reasoning", locked.student_explanation);
  await click("Submit answer");
  assert.ok(
    window.localStorage.getItem(RESULTS_KEY),
    "Submitted result was persisted",
  );
  const payload = JSON.parse(window.localStorage.getItem(RESULTS_KEY));
  assert.equal(payload.summary.answered, 1);
  assert.equal(payload.summary.correct, 0);
  assert.equal(
    payload.attempts[0].questions[0].feedback.reasoning_assessment,
    "supported",
  );
  await act(async () => host.querySelectorAll(".nav-item")[0].click());
  assert.match(host.querySelector(".dashboard-stats").textContent, /0%/);
  await unmount();
  await render(createElement(App));
  assert.match(host.querySelector(".dashboard-stats").textContent, /0%/);
  assert.match(
    host.querySelector(".feedback-history").textContent,
    /Cellular energy/,
  );
  await click("Clear saved results");
  assert.equal(window.localStorage.getItem(RESULTS_KEY), null);
  assert.equal(window.localStorage.getItem("studyai-theme"), "dark");
  assert.match(host.textContent, /No submitted quiz results yet/);
});

test("Invalid saved data does not crash dashboard or get silently overwritten", async () => {
  const invalid = "{invalid data";
  window.localStorage.setItem(RESULTS_KEY, invalid);
  function Harness() {
    const results = useQuizResults();
    return createElement(Dashboard, {
      attempts: results.attempts,
      notice: results.notice,
      onClear: results.clearResults,
      onStart() {},
      activeSessionId: null,
    });
  }
  await render(createElement(Harness));
  assert.match(host.textContent, /Saved results are invalid/);
  assert.equal(window.localStorage.getItem(RESULTS_KEY), invalid);
  await click("Clear saved results");
  assert.equal(window.localStorage.getItem(RESULTS_KEY), null);
  assert.match(host.textContent, /Saved results cleared/);
});

test("Clear suppresses old answers when a live practice later reports new submissions", async () => {
  const first = practice([
    question("old"),
    { ...question("new"), submission: null },
  ]);
  const updated = practice([question("old"), question("new", "Energy", 1)]);
  function Harness() {
    const results = useQuizResults();
    return createElement(
      "section",
      {},
      createElement(
        "button",
        { onClick: () => results.onPracticeUpdate("session", first) },
        "Save first",
      ),
      createElement("button", { onClick: results.clearResults }, "Clear all"),
      createElement(
        "button",
        { onClick: () => results.onPracticeUpdate("session", updated) },
        "Save next",
      ),
      createElement("output", {}, summarize(results.attempts).answered),
    );
  }
  await render(createElement(Harness));
  await click("Save first");
  await click("Clear all");
  await click("Save next");
  assert.equal(host.querySelector("output").textContent, "1");
  const payload = JSON.parse(window.localStorage.getItem(RESULTS_KEY));
  assert.deepEqual(
    payload.attempts[0].questions.map((question) => question.questionId),
    ["new"],
  );
});
