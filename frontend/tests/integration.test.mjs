import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, exec } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { JSDOM } from "jsdom";

test("Real frontend → FastAPI → sklearn → mocked Ollama HTTP → persisted dashboard", { timeout: 60000 }, async () => {
  const project = fileURLToPath(new URL("../../", import.meta.url));
  const frontend = fileURLToPath(new URL("../", import.meta.url));
  const backend = fileURLToPath(new URL("../../backend/", import.meta.url));
  const portable = fileURLToPath(new URL("../../.runtime/python/python.exe", import.meta.url));
  const venv = fileURLToPath(new URL(process.platform === "win32"
    ? "../../backend/.venv/Scripts/python.exe" : "../../backend/.venv/bin/python", import.meta.url));
  const python = process.env.STUDYAI_TEST_PYTHON || (existsSync(portable) ? portable : existsSync(venv) ? venv : "python");
  const server = spawn(python, ["tests/serve_integration.py"], { cwd: backend, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let stderr = "";
  server.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => {
    server.once("exit", (code) => resolve(code));
    server.once("error", () => resolve(-1));
  });
  const lines = createInterface({ input: server.stdout });
  let root;
  let dom;
  let finished = false;
  try {
    const config = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Backend startup timed out. " + stderr)), 10000);
      lines.once("line", (line) => {
        clearTimeout(timeout);
        try { resolve(JSON.parse(line)); } catch (error) { reject(error); }
      });
      server.once("error", (error) => { clearTimeout(timeout); reject(error); });
      server.once("exit", () => { clearTimeout(timeout); reject(new Error("Backend failed. " + stderr)); });
    });
    await new Promise((resolve, reject) => {
      exec((process.platform === "win32" ? "npm.cmd" : "npm") + " exec vite -- build --configLoader runner --ssr tests/entries.ts --outDir .integration-test-build",
        { cwd: frontend, env: { ...process.env, VITE_API_BASE_URL: config.base }, timeout: 15000, windowsHide: true },
        (error, stdout, err) => error ? reject(new Error(stdout + err)) : resolve());
    });
    // Node's native fetch, File, Blob and FormData send actual HTTP requests.
    dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost:5173" });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.localStorage = window.localStorage;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.Element = window.Element;
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    globalThis.cancelAnimationFrame = clearTimeout;
    class Observer { observe(el) { this.cb([{ target: el, contentRect: { width: 900, height: 320 } }]); } disconnect() {} unobserve() {} constructor(cb) { this.cb = cb; } }
    globalThis.ResizeObserver = window.ResizeObserver = Observer;
    window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 900, height: 320, x: 0, y: 0, top: 0, left: 0, right: 900, bottom: 320 });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const { act, createElement } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { App, RESULTS_KEY } = await import("../.integration-test-build/entries.js");
    const host = document.getElementById("root");
    const waitFor = async (predicate) => {
      for (let i = 0; i < 200 && !predicate(); i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      assert.ok(predicate(), "Expected UI state. " + host.textContent.slice(-1800) + stderr);
    };
    const click = async (text) => {
      const button = [...host.querySelectorAll("button")].find((item) => item.textContent.includes(text));
      assert.ok(button && !button.disabled, "Enabled button: " + text);
      await act(async () => button.click());
    };
    const setInput = async (selector, value) => {
      const element = host.querySelector(selector);
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(element, value);
        element.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
    };
    const upload = async (file) => {
      const element = host.querySelector("#pdf");
      Object.defineProperty(element, "files", { configurable: true, value: [file] });
      await act(async () => element.dispatchEvent(new window.Event("change", { bubbles: true })));
    };
    root = createRoot(host);
    await act(async () => root.render(createElement(App)));
    await waitFor(() => host.textContent.includes("Backend online") && !host.textContent.includes("Checking Ollama"));
    await act(async () => host.querySelectorAll(".nav-item")[2].click());
    await click("Process Material");
    assert.match(host.querySelector(".form-error").textContent, /Paste lecture notes or select/);
    await upload(new File(["unsupported"], "notes.txt", { type: "text/plain" }));
    assert.match(host.querySelector(".form-error").textContent, /Choose a non-empty PDF/);
    await upload(new File(["%PDF-broken"], "broken.pdf", { type: "application/pdf" }));
    await click("Process Material");
    await waitFor(() => !!host.querySelector(".form-error"));
    assert.match(host.querySelector(".form-error").textContent, /PDF|malformed|read/i);
    // Valid multi-page PDF with an empty browser MIME type exercises the upload fix.
    await upload(new File([Buffer.from(config.pdf, "base64")], "demo.pdf"));
    await click("Process Material");
    await waitFor(() => host.textContent.includes("from 2 PDF pages"));
    await click("Clear session");
    await waitFor(() => host.textContent.includes("Temporary server session cleared"));
    await click("Load sample notes");
    assert.match(host.querySelector("#notes").value, /DEMO LECTURE NOTES/);
    await click("Process Material");
    await waitFor(() => host.textContent.includes("Material processed successfully"));
    await waitFor(() => [...host.querySelectorAll("button")].some((b) => b.textContent.includes("Generate Questions") && !b.disabled));
    await click("Generate Questions");
    await waitFor(() => host.querySelectorAll(".answer-options input").length === 4);
    const payloadBefore = window.localStorage.getItem(RESULTS_KEY);
    assert.equal(payloadBefore, null, "Unsubmitted keys are not persisted");
    for (let i = 0; i < 5; i++) {
      await act(async () => host.querySelectorAll(".answer-options input")[i === 0 ? 0 : 1].click());
      await setInput("#reasoning", "Term frequency counts terms; IDF reduces the influence of terms shared across passages.");
      await click("Submit answer");
      await waitFor(() => host.textContent.includes("TEST MOCK") && [...host.querySelectorAll(".answer-options input")].every((input) => input.matches(":disabled")));
      if (i < 4) await click("Next question");
    }
    const saved = JSON.parse(window.localStorage.getItem(RESULTS_KEY));
    assert.equal(saved.summary.answered, 5);
    assert.equal(saved.summary.correct, 1);
    assert.ok(saved.attempts[0].questions.every((q) => q.feedback.source_passages_used.length > 0));
    assert.ok(!window.localStorage.getItem(RESULTS_KEY).includes(JSON.stringify(host.querySelector("#notes").value)), "Full pasted notes are not persisted; bounded source excerpts are allowed");
    await act(async () => host.querySelectorAll(".nav-item")[0].click());
    await waitFor(() => !!host.querySelector(".recharts-bar-rectangle"));
    assert.match(host.querySelector(".dashboard-stats").textContent, /20%/);
    await click("Find passages in my notes");
    await waitFor(() => !!host.querySelector(".review-passages .passage"));
    assert.match(host.querySelector(".review-passages").textContent, /Term frequency|frequency|cosine/i);
    const session = saved.attempts[0].sessionId;
    const snapshotResponse = await fetch(config.base + "/sessions/" + session + "/practice");
    assert.equal(snapshotResponse.status, 200);
    const snapshot = await snapshotResponse.json();
    const rejected = await fetch(config.base + "/sessions/" + session + "/questions/" + snapshot.questions[0].question_id + "/submit", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selected_index: 3, explanation: "An attempted answer change after locking." }),
    });
    assert.equal(rejected.status, 409);
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(createElement(App)));
    await waitFor(() => !!host.querySelector(".dashboard-stats"));
    assert.match(host.querySelector(".dashboard-stats").textContent, /20%/);
    await click("Clear saved results");
    assert.equal(window.localStorage.getItem(RESULTS_KEY), null);
    assert.match(host.textContent, /No submitted quiz results yet/);
    finished = true;
  } finally {
    if (root) {
      const { act } = await import("react");
      await act(async () => root.unmount());
    }
    dom?.window.close();
    lines.close();
    if (finished) {
      server.stdin.end("\n");
      let stopTimer;
      const code = await Promise.race([exited, new Promise((resolve) => { stopTimer = setTimeout(() => resolve(-2), 8000); })]);
      clearTimeout(stopTimer);
      if (code === -2) server.kill();
      assert.equal(code, 0, stderr);
    } else {
      server.kill();
      await exited;
    }
  }
});
