import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const SCRIPT = path.resolve("scripts/attempt-budget.sh");

/**
 * Run the budget script with `gh pr view` stubbed to return `subjects` as the pull request's commit headlines. Returns the step outputs it wrote.
 */
function budget(subjects, { maxAttempts = 3, prefix = "fix(ci):" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "budget-"));
  try {
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    // The stub answers any argv; what the script does with the lines is the behaviour under test.
    fs.writeFileSync(
      path.join(bin, "gh"),
      `#!/bin/bash\nprintf '%s\\n' "$*" >> "$STUB_ARGV"\nprintf '%s' "$STUB_SUBJECTS"\n`,
    );
    fs.chmodSync(path.join(bin, "gh"), 0o755);

    const outFile = path.join(dir, "output");
    fs.writeFileSync(outFile, "");
    const argvFile = path.join(dir, "argv");
    fs.writeFileSync(argvFile, "");
    const run = spawnSync("bash", [SCRIPT], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        STUB_SUBJECTS: subjects.join("\n"),
        GH_TOKEN: "stub",
        REPO: "owner/repo",
        PR_NUMBER: "1",
        BRANCH: "claude/issue-1",
        MAX_ATTEMPTS: String(maxAttempts),
        COMMIT_PREFIX: prefix,
        GITHUB_OUTPUT: outFile,
        STUB_ARGV: argvFile,
      },
    });
    assert.equal(run.status, 0, run.stderr);
    const outputs = Object.fromEntries(
      fs
        .readFileSync(outFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("=")),
    );
    return { ...outputs, stdout: run.stdout, gh: fs.readFileSync(argvFile, "utf8").trim() };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("a pull request that has never been fixed gets the whole budget", () => {
  const out = budget(["Implement the thing", "Address review"]);
  assert.equal(out.attempts, "0");
  assert.equal(out.attempted, "true");
});

test("a pull request with no commits at all still runs", () => {
  const out = budget([]);
  assert.equal(out.attempts, "0");
  assert.equal(out.attempted, "true");
});

test("each of the agent's own commits spends one attempt", () => {
  const out = budget(["fix(ci): address CI failure in run 1", "Implement the thing"]);
  assert.equal(out.attempts, "1");
  assert.equal(out.attempted, "true");
});

test("the ceiling stops the agent once it is reached", () => {
  const out = budget([
    "fix(ci): address CI failure in run 1",
    "fix(ci): address CI failure in run 2",
    "fix(ci): address CI failure in run 3",
  ]);
  assert.equal(out.attempts, "3");
  assert.equal(out.attempted, "false");
  assert.match(out.stdout, /::warning::/);
});

test("the attempts counted are the pull request's own, not the branch's ancestry", () => {
  // The regression this script exists for. The count came from `git log origin/<branch>`, which walks the whole ancestry — so three `fix(ci):` commits merged into the base branch from anywhere disabled the agent on every pull request in the repository, permanently, before it had tried once. Asking the pull request for its own commit list is what makes the budget per-pull-request, so that is the part worth pinning.
  const out = budget(["Implement the thing"]);
  assert.match(out.gh, /^pr view 1 --repo owner\/repo --json commits /);
  assert.equal(out.attempts, "0");
  assert.equal(out.attempted, "true");
});

test("the prefix is matched literally, not as a regular expression", () => {
  // `fix(ci):` is a valid regex that matches something else entirely, and a prefix with `.` or `*` in it would match more still.
  const out = budget(["fixXciY: not an attempt", "fix(ci)X not an attempt either"]);
  assert.equal(out.attempts, "0");
});

test("a prefix appearing later in the subject is not an attempt", () => {
  const out = budget(["Revert fix(ci): address CI failure in run 1"]);
  assert.equal(out.attempts, "0");
});

test("the ceiling is the caller's to set", () => {
  const one = budget(["fix(ci): address CI failure in run 1"], { maxAttempts: 1 });
  assert.equal(one.attempted, "false");
  const five = budget(["fix(ci): address CI failure in run 1"], { maxAttempts: 5 });
  assert.equal(five.attempted, "true");
});

test("a caller's own commit prefix is what gets counted", () => {
  const out = budget(["ci: retry", "feat: real work"], { prefix: "ci: " });
  assert.equal(out.attempts, "1");
});
