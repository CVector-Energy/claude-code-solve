import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const SCRIPT = path.resolve("scripts/rerun-request.sh");

/**
 * Run the script in a fresh git repository. `request` is what the agent wrote to the request file, or undefined for no file; `dirty` leaves an uncommitted change in the tree. Returns the step outputs it wrote.
 */
function decide({ request, dirty = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rerun-"));
  try {
    const repo = path.join(dir, "repo");
    fs.mkdirSync(repo);
    const git = (...args) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    git("init", "-q");
    fs.writeFileSync(path.join(repo, "file"), "committed\n");
    git("add", "file");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
    if (dirty) fs.writeFileSync(path.join(repo, "file"), "changed\n");

    const requestFile = path.join(dir, "request");
    if (request !== undefined) fs.writeFileSync(requestFile, request);
    const outFile = path.join(dir, "output");
    fs.writeFileSync(outFile, "");
    const run = spawnSync("bash", [SCRIPT], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, REQUEST_FILE: requestFile, GITHUB_OUTPUT: outFile },
    });
    assert.equal(run.status, 0, run.stderr);
    const outputs = Object.fromEntries(
      fs
        .readFileSync(outFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("=")),
    );
    return { ...outputs, stdout: run.stdout };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("no request file means no re-run", () => {
  assert.equal(decide()["rerun-requested"], "false");
});

test("an empty request is not a request", () => {
  assert.equal(decide({ request: "" })["rerun-requested"], "false");
});

test("a reason with an unchanged tree asks for a re-run and logs why", () => {
  const out = decide({ request: "ECR Public rate limit" });
  assert.equal(out["rerun-requested"], "true");
  assert.match(out.stdout, /ECR Public rate limit/);
});

test("a change in the tree wins over a request, because its push starts CI anyway", () => {
  assert.equal(decide({ request: "flaky", dirty: true })["rerun-requested"], "false");
});
