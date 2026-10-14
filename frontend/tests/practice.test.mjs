import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM(
  '<!doctype html><html><body><div id="test-root"></div></body></html>',
  { url: "http://localhost:5173" },
);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { PracticePanel } = await import("../.ui-test-build/entries.js");
let root;
const host = document.getElementById("test-root");
const ready = {
  available: true,
  service_available: true,
  model_available: true,
  model: "mock-model:latest",
  message: "Ollama and the configured model are available.",
};
const questions = [
  {
    question_id: "q1",
    question: "Which molecule stores cellular energy?",
    options: ["ATP", "Soil", "Light", "Frequency"],
    topic: "Cellular energy",
    submission: null,
  },
  {
    question_id: "q2",
    question: "Which process generates ATP for cells?",
    options: ["Respiration", "Gardening", "Reflection", "Signal filtering"],
    topic: "Respiration",
    submission: null,
  },
];
const practice = {
  questions,
  requested_count: 5,
  returned_count: 2,
  notice: "Generated 2 of 5 supported questions after limited attempts.",
  model: "mock-model:latest",
};
const submission = {
  locked: true,
  selected_index: 0,
  student_explanation: "ATP stores cellular energy in the notes.",
  correct: true,
  correct_index: 0,
  answer_explanation: "ATP stores energy for cells.",
  answer_sources: [],
  feedback_status: "available",
  feedback_error: null,
  feedback: {
    reasoning_assessment: "partially_supported",
    explanation:
      "Your explanation mentions ATP but could connect it to respiration.",
    possible_knowledge_gap: "Possible confusion about cellular respiration.",
    recommended_topic_to_review: "Cellular respiration",
    source_passages_used: [],
    assessment_note:
      "AI reasoning feedback is an estimate, not a definitive measure of your knowledge.",
  },
};
const response = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const button = (text) =>
  [...host.querySelectorAll("button")].find((node) =>
    node.textContent.includes(text),
  );
async function click(text) {
  const target = button(text);
  assert.ok(target, "Button exists: " + text);
  await act(async () => target.click());
}
async function render(fetcher) {
  globalThis.fetch = fetcher;
  root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(PracticePanel, { sessionId: "session", timeoutSeconds: 5 }),
    ),
  );
}
async function chooseAndExplain() {
  await act(async () => host.querySelector(".answer-options input").click());
  const textarea = host.querySelector("#reasoning");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    ).set.call(textarea, submission.student_explanation);
    textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}
function defaultFetch(url) {
  if (url.endsWith("/health/ollama")) return Promise.resolve(response(ready));
  if (url.endsWith("/questions")) return Promise.resolve(response(practice));
  if (url.endsWith("/submit")) return Promise.resolve(response(submission));
  throw new Error("Unexpected request: " + url);
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  host.replaceChildren();
});

test("Unavailable Ollama shows startup instructions and disables generation", async () => {
  await render(() =>
    Promise.resolve(
      response({
        ...ready,
        available: false,
        service_available: false,
        model_available: false,
        message: "Cannot reach local Ollama. Start with ollama serve.",
      }),
    ),
  );
  assert.match(host.textContent, /Local AI is not ready/);
  assert.match(host.textContent, /ollama serve/);
  assert.match(host.textContent, /ollama pull mock-model:latest/);
  assert.equal(button("Generate Questions").disabled, true);
  assert.ok(host.querySelector('[role="alert"]'));
});

test("One question at a time, required reasoning, locked submission, and separate AI estimate", async () => {
  await render(defaultFetch);
  await click("Generate Questions");
  assert.match(host.textContent, /Which molecule stores cellular energy/);
  assert.doesNotMatch(host.textContent, /Which process generates ATP/);
  assert.doesNotMatch(host.textContent, /Correct option:/);
  assert.equal(button("Submit answer").disabled, true);
  assert.match(host.textContent, /Generated 2 of 5/);
  await chooseAndExplain();
  assert.equal(button("Submit answer").disabled, false);
  await click("Submit answer");
  assert.match(host.textContent, /Multiple-choice result: Correct/);
  assert.match(host.textContent, /AI reasoning feedback · estimate/);
  assert.match(host.textContent, /partially supported/);
  assert.match(host.textContent, /separate from multiple-choice scoring/);
  assert.equal(host.querySelector("#reasoning").disabled, true);
  assert.ok(
    [...host.querySelectorAll(".answer-options input")].every((input) =>
      input.matches(":disabled"),
    ),
  );
  await click("Next question");
  assert.match(host.textContent, /Which process generates ATP/);
  assert.doesNotMatch(host.textContent, /Correct option:/);
  assert.equal(host.querySelector("#reasoning").value, "");
});

test("Generation errors are friendly and leave processing/retrieval independent", async () => {
  await render((url) =>
    url.endsWith("/health/ollama")
      ? Promise.resolve(response(ready))
      : Promise.resolve(
          response(
            {
              detail:
                "Cannot reach your local Ollama service. Start Ollama with ollama serve.",
            },
            503,
          ),
        ),
  );
  await click("Generate Questions");
  assert.match(
    host.querySelector(".form-error").textContent,
    /Cannot reach your local Ollama/,
  );
  assert.match(host.textContent, /ollama serve/);
  assert.ok(button("Recover current practice"));
});

test("Lost submission response stays locked until recovery confirms backend state", async () => {
  await render((url) => {
    if (url.endsWith("/submit"))
      return Promise.reject(new TypeError("lost response"));
    if (url.endsWith("/practice"))
      return Promise.resolve(
        response({
          ...practice,
          questions: [{ ...questions[0], submission }, questions[1]],
        }),
      );
    return defaultFetch(url);
  });
  await click("Generate Questions");
  await chooseAndExplain();
  await click("Submit answer");
  assert.match(host.textContent, /submission outcome is uncertain/);
  assert.equal(host.querySelector("#reasoning").disabled, true);
  assert.ok(host.querySelector(".answer-options input").matches(":disabled"));
  await click("Recover submitted answer");
  assert.match(host.textContent, /Multiple-choice result: Correct/);
  assert.equal(host.querySelector("#reasoning").disabled, true);
});

test("Feedback timeout keeps MC scoring visible and permits feedback-only retry", async () => {
  const unavailable = {
    ...submission,
    feedback: null,
    feedback_status: "unavailable",
    feedback_error: "Ollama timed out. Your answer remains locked.",
  };
  let retryCount = 0;
  await render((url) => {
    if (url.endsWith("/submit")) return Promise.resolve(response(unavailable));
    if (url.endsWith("/feedback")) {
      retryCount++;
      return Promise.resolve(response(submission));
    }
    return defaultFetch(url);
  });
  await click("Generate Questions");
  await chooseAndExplain();
  await click("Submit answer");
  assert.match(host.textContent, /Multiple-choice result: Correct/);
  assert.match(host.textContent, /Ollama timed out/);
  assert.equal(host.querySelector("#reasoning").disabled, true);
  await click("Retry AI feedback");
  assert.equal(retryCount, 1);
  assert.match(host.textContent, /partially supported/);
  assert.equal(host.querySelector("#reasoning").disabled, true);
});
