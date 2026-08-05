import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

// Actions that run an agent, and so share a shape worth checking in a loop.
const PATHS = {
  triage: "triage/action.yml",
  implement: "implement/action.yml",
  respond: "respond/action.yml",
};
/** Every composite action here, agent or not. */
const ALL_PATHS = { ...PATHS, "resolve-pr": "resolve-pr/action.yml" };
const load = (which) => parse(fs.readFileSync(PATHS[which], "utf8"));
const ACTIONS = Object.fromEntries(Object.keys(PATHS).map((k) => [k, load(k)]));
const ALL = Object.fromEntries(
  Object.keys(ALL_PATHS).map((k) => [k, parse(fs.readFileSync(ALL_PATHS[k], "utf8"))]),
);
const stepById = (action, id) => action.runs.steps.find((step) => step.id === id);

for (const [which, action] of Object.entries(ACTIONS)) {
  test(`${which}: it is a composite action`, () => {
    assert.equal(action.runs.using, "composite");
  });

  test(`${which}: nothing about one organisation is baked in`, () => {
    // A pinned dependency names the repository an action lives in, so `uses:`
    // lines are exempt. Everything else — the commit identity, the bots, the
    // templates — is the caller's to supply.
    const text = fs
      .readFileSync(PATHS[which], "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("uses:"))
      .join("\n");
    for (const leaked of ["cvector", "CVector", "users.noreply.github.com"]) {
      assert.ok(!text.includes(leaked), `${PATHS[which]} mentions ${leaked}`);
    }
    assert.equal(action.inputs["allowed-bots"].default, "");
  });

  test(`${which}: caller text reaches the shell as an environment variable`, () => {
    // Interpolating an input into a run block would let a value carrying shell
    // syntax execute in a job holding a write-scoped token.
    for (const step of action.runs.steps.filter((s) => s.run)) {
      assert.ok(
        !/\$\{\{\s*inputs\./.test(step.run),
        `${step.name} interpolates an input into its script`,
      );
    }
  });

  test(`${which}: every third-party action is pinned to a commit`, () => {
    for (const step of action.runs.steps.filter((s) => s.uses)) {
      assert.match(step.uses.split("@")[1], /^[0-9a-f]{40}$/, step.uses);
    }
  });

  test(`${which}: the agent runs once and its failure stops the action`, () => {
    const agents = action.runs.steps.filter((s) =>
      (s.uses ?? "").includes("claude-code-action"),
    );
    assert.equal(agents.length, 1);
    assert.equal(agents[0]["continue-on-error"], undefined);
  });

  test(`${which}: the prompt is rendered into one output with a fresh delimiter`, () => {
    const step = stepById(action, "prompt");
    assert.ok(step.run.includes("envsubst"));
    assert.equal(step.run.split('>> "$GITHUB_OUTPUT"').length - 1, 1);
    assert.ok(step.run.includes('DELIM="EOF_$(openssl rand -hex 16)"'));
    assert.ok(!/<<[A-Z_]+EOF/.test(step.run), "fixed heredoc delimiter");
  });
}

test("triage always reports a disposition a caller can gate on", () => {
  // An empty disposition makes every downstream `if` false, so the job succeeds
  // having neither fixed anything nor said why.
  const run = stepById(ACTIONS.triage, "parse").run;
  assert.ok(run.includes("jq -er"));
  assert.ok(run.includes("no-action|needs-clarification|fixable"));
  assert.ok(run.includes("DISPOSITION=no-action"));
});

test("triage tells the issue author what happened either way", () => {
  const names = ACTIONS.triage.runs.steps.map((step) => step.name);
  assert.ok(names.includes("Post clarification comment"));
  assert.ok(names.includes("Post no-action comment"));
  for (const [name, disposition] of [
    ["Post clarification comment", "needs-clarification"],
    ["Post no-action comment", "no-action"],
  ]) {
    const step = ACTIONS.triage.runs.steps.find((s) => s.name === name);
    assert.equal(step.if, `steps.parse.outputs.disposition == '${disposition}'`);
  }
});

test("triage resumes the session scoped to this issue", () => {
  assert.match(
    stepById(ACTIONS.triage, "session").with.scope,
    /^issue-\$\{\{ inputs\.issue-number \}\}$/,
  );
});

test("implement continues the conversation triage had", () => {
  // Re-reading the issue from scratch discards the plan triage just made.
  const args = stepById(ACTIONS.implement, "implement").with.claude_args;
  assert.ok(args.includes("inputs.resume-session-id"));
  assert.ok(args.includes("--resume"));
});

test("implement branches before the agent can commit anything", () => {
  const steps = ACTIONS.implement.runs.steps.map((step) => step.id);
  assert.ok(steps.indexOf("branch") < steps.indexOf("implement"));
});

test("neither action cleans up after the caller's job", () => {
  // A failing step aborts the rest of a composite action, so a trace upload or
  // a reaction removal in here would be skipped exactly when it is needed.
  for (const [which, action] of Object.entries(ACTIONS)) {
    const body = JSON.stringify(action.runs.steps);
    assert.ok(!body.includes("upload-artifact"), which);
    assert.ok(!/reaction/i.test(body), which);
    assert.ok(action.outputs["execution-file"], `${which} hides the trace path`);
  }
});

test("triage restores the repo-wide memory store before the agent reads it", () => {
  const steps = ACTIONS.triage.runs.steps;
  const memory = steps.findIndex((s) =>
    (s.uses ?? "").startsWith("CVector-Energy/claude-code-memory@"),
  );
  const agent = steps.findIndex((s) =>
    (s.uses ?? "").includes("claude-code-action"),
  );
  assert.ok(memory >= 0, "triage does not restore memory");
  assert.ok(memory < agent, "memory is restored after the agent has run");
});

test("implement does not restore memory a second time", () => {
  // It runs later in the same job as triage, which already restored the store.
  // Extracting the cache again would overwrite memories the triage agent just
  // wrote, and would register a second post-save racing the first for one key.
  const again = ACTIONS.implement.runs.steps.some((s) =>
    (s.uses ?? "").startsWith("CVector-Energy/claude-code-memory@"),
  );
  assert.equal(again, false);
});

for (const [which, role] of [["triage", "triage"], ["implement", "implement"]]) {
  test(`${which}: the execution log is copied aside even when the agent failed`, () => {
    // Every agent in a job writes the same $RUNNER_TEMP filename, so the next one
    // destroys this log before the caller can upload it.
    const steps = ACTIONS[which].runs.steps;
    const trace = steps.find((s) => s.id === "trace");
    assert.ok(trace, `${which} does not preserve its log`);
    assert.equal(trace.if, "always()");
    assert.ok(trace.run.includes(`claude-trace-${role}.json`));
    assert.ok(
      steps.indexOf(trace) >
        steps.findIndex((s) => (s.uses ?? "").includes("claude-code-action")),
    );
    assert.equal(
      ACTIONS[which].outputs["execution-file"].value.trim(),
      "${{ steps.trace.outputs.path }}",
    );
  });
}


// Ported from the retired claude-code-respond repository.
const RESPOND = ACTIONS.respond.runs.steps;
const respondStep = (id) => RESPOND.find((s) => s.id === id);
const respondNamed = (fragment) =>
  RESPOND.find((s) => (s.name ?? "").toLowerCase().includes(fragment));

test("the agent resumes the session restored for this pull request", () => {
  assert.match(respondStep("session").with.scope, /^pr-\$\{\{ inputs\.pr-number \}\}$/);
  assert.ok(respondStep("respond").with.claude_args.includes("steps.session.outputs.resume-args"));
});

test("the prompt is rendered where its text is fetched", () => {
  // Two steps would mean the review text becomes a step output on the way past,
  // and a fixed heredoc delimiter there is terminable by the text it carries.
  const step = respondStep("prompt");
  assert.ok(step.run.includes("gh pr view"));
  assert.ok(step.run.includes("envsubst"));
  assert.equal(step.run.split('>> "$GITHUB_OUTPUT"').length - 1, 1);
  assert.ok(step.run.includes('DELIM="EOF_$(openssl rand -hex 16)"'));
  assert.ok(!/<<[A-Z_]+EOF/.test(step.run), "fixed heredoc delimiter");
});

test("a push cannot clobber a branch that moved under it", () => {
  const step = respondNamed("commit and push");
  assert.ok(step.run.includes("--force-with-lease="));
  assert.ok(step.run.includes("git ls-remote"), "the lease needs the remote sha");
});

test("replies are only posted when the agent produced them", () => {
  assert.equal(respondNamed("post comments").if, "steps.respond.outputs.structured_output");
});



// ─── resolve-pr ──────────────────────────────────────────────────────────────

const RESOLVE = () => ALL["resolve-pr"];
const resolveStep = () => RESOLVE().runs.steps[0];

for (const [which, action] of Object.entries(ALL)) {
  test(`${which}: hygiene shared by every action here`, () => {
    assert.equal(action.runs.using, "composite");
    const text = fs
      .readFileSync(ALL_PATHS[which], "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("uses:"))
      .join("\n");
    for (const leaked of ["cvector", "CVector", "users.noreply.github.com"]) {
      assert.ok(!text.includes(leaked), `${ALL_PATHS[which]} mentions ${leaked}`);
    }
    for (const step of action.runs.steps.filter((s) => s.run)) {
      assert.ok(
        !/\$\{\{\s*inputs\./.test(step.run),
        `${step.name} interpolates an input into its script`,
      );
    }
  });
}

test("resolve-pr owns the branch prefix the workflows had to agree about", () => {
  // It named the fix branch in the issue workflow, decided eligibility in the
  // review workflow, and defaulted inside implement. Three places that had to
  // match, and nothing made them.
  assert.equal(RESOLVE().inputs["branch-prefix"].default, "claude/issue-");
  assert.ok(RESOLVE().outputs.branch, "callers need the branch it derived");
});

test("resolve-pr reports whether the work item already has a pull request", () => {
  // The issue workflow stops on this: the implement agent runs
  // --dangerously-skip-permissions, and a force-push would discard the commits
  // an existing pull request is carrying.
  assert.ok(RESOLVE().outputs.exists);
  assert.ok(resolveStep().run.includes("gh pr list"));
});

test("resolve-pr reports whether the branch is one of ours", () => {
  // The review workflow acts only on branches the agent created.
  assert.ok(RESOLVE().outputs.managed);
});

test("resolve-pr stops on a failed lookup rather than reporting no pull request", () => {
  assert.ok(resolveStep().run.includes("set -euo pipefail"));
});

test("resolve-pr reads the event rather than taking a mode", () => {
  // Both callers' `if:` conditions already fix which kind of event this is; a
  // mode input would be a second place for that to be stated, and to be wrong.
  const env = resolveStep().env;
  assert.match(String(env.EVENT_NAME), /github\.event_name/);
  assert.ok(
    Object.values(env).some((v) => String(v).includes("issue.pull_request")),
    "an issue_comment has to be told apart from a pull request comment",
  );
});

test("resolve-pr does not carry the author nobody read", () => {
  // The step it replaces published `author`, and no workflow referenced it.
  assert.equal(RESOLVE().outputs.author, undefined);
});

test("implement takes the branch rather than spelling the prefix again", () => {
  // The prefix decided three things that had to agree: the branch a fix goes on,
  // whether the review workflow owns a pull request, and this default. resolve-pr
  // owns it now, and the name flows from there.
  assert.equal(ACTIONS.implement.inputs["branch-prefix"], undefined);
  assert.equal(ACTIONS.implement.inputs.branch.required, true);
  assert.ok(
    !JSON.stringify(ACTIONS.implement).includes("claude/issue-"),
    "implement still hardcodes a branch name",
  );
});
