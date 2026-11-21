// Nothing goes missing: every test ID in the plan must have a test, and every test must be in the plan.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, "backend", "test", "TEST_PLAN.json"), "utf8")).ids;
const DIRS = ["contracts/test", "backend/test/unit", "backend/test/integration", "backend/test/ai", "e2e/tests"];

function testTitles() {
  const found = new Map();
  for (const d of DIRS) {
    const dir = path.join(ROOT, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => /\.(test|spec)\.(js|ts)$/.test(x))) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      for (const m of src.matchAll(/\b(?:it|test)\(\s*[`"']([A-Z]+-\d{2})[a-z]? /g)) {
        if (!found.has(m[1])) found.set(m[1], []);
        found.get(m[1]).push(`${d}/${f}`);
      }
    }
  }
  return found;
}

test("every required test ID in the plan has at least one test", () => {
  const found = testTitles();
  const missing = plan.filter((p) => p.status === "required" && !found.has(p.id)).map((p) => `${p.id} (${p.suite})`);
  assert.deepEqual(missing, [], `missing tests: ${missing.join(", ")}`);
});

test("every test ID used in a test file is listed in the plan", () => {
  const known = new Set(plan.map((p) => p.id));
  const unknown = [...testTitles().keys()].filter((id) => !known.has(id));
  assert.deepEqual(unknown, [], `tests not in TEST_PLAN.json: ${unknown.join(", ")}`);
});

test("pending IDs are only the frontend UI tests, and are reported", (t) => {
  const pending = plan.filter((p) => p.status !== "required");
  assert.ok(pending.every((p) => p.id.startsWith("UI-")));
  const done = testTitles();
  const still = pending.filter((p) => !done.has(p.id)).map((p) => p.id);
  t.diagnostic(`pending until the frontend is built: ${still.join(", ") || "none"}`);
});
