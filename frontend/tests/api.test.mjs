import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { api, deleteSession } from "../.ui-test-build/entries.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("API network failure explains how to start the local backend", async () => {
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  await assert.rejects(api("/health"), /Cannot reach the local backend.*Start FastAPI/);
});

test("API preserves friendly backend upload validation details", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: "Scanned PDFs need OCR; this MVP does not support OCR." }), { status: 422 });
  await assert.rejects(api("/sessions"), /Scanned PDFs need OCR/);
});

test("Malformed successful backend JSON has a friendly error", async () => {
  globalThis.fetch = async () => new Response("{broken");
  await assert.rejects(api("/health"), /unreadable response/);
});

test("Ordinary API requests time out and release their timer", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  const request = assert.rejects(api("/health"), /backend request timed out/);
  context.mock.timers.tick(15000);
  await request;
});

test("Caller-controlled aborts preserve cancellation for long AI operations", async () => {
  const controller = new AbortController();
  controller.abort();
  globalThis.fetch = async () => { throw new DOMException("Cancelled", "AbortError"); };
  await assert.rejects(api("/sessions/test/questions", { signal: controller.signal }), { name: "AbortError" });
});

test("Deleting an already-expired session succeeds", async () => {
  globalThis.fetch = async () => new Response(null, { status: 404 });
  await deleteSession("expired");
});

test("Session deletion is bounded and explains automatic expiry on failure", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  const request = assert.rejects(deleteSession("offline"), /session will expire automatically/);
  context.mock.timers.tick(5000);
  await request;
});
