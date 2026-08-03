# Claude Code Solve Actions

Two actions for the middle of an issue-solving workflow: **triage** an issue and report a disposition, then **implement** the fix it planned. Everything specific to your repository — the toolchain, the verification gates, the prompts, the commit identity — stays in your workflow.

| Action | What it does |
|--------|--------------|
| `CVector-Energy/claude-code-solve` | Restores the repo's Claude memory, resumes the issue's session, renders the triage prompt, runs the agent, reports `fixable` / `needs-clarification` / `no-action`, and comments on the issue for the latter two |
| `CVector-Energy/claude-code-solve/implement` | Branches, renders the implement prompt, and runs an agent that continues the triage conversation |

They are separate because what goes between them is yours: the toolchain install and any credentials the fix agent needs, which are worth skipping entirely when triage says there is nothing to fix.

## Usage

```yaml
jobs:
  solve:
    runs-on: ubuntu-24.04
    permissions:
      contents: write
      pull-requests: write
      issues: write
    env:
      TRIAGE_ARGS: |
        --model claude-opus-5
        --allowedTools "Read,Glob,Grep,WebFetch"
        --json-schema '{"type":"object","properties":{"disposition":{"type":"string","enum":["no-action","needs-clarification","fixable"]},"summary":{"type":"string"}},"required":["disposition","summary"]}'
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ steps.app.outputs.token }}

      - name: Triage
        id: triage
        uses: CVector-Energy/claude-code-solve@v0.2.0
        with:
          issue-number: ${{ github.event.issue.number }}
          github-token: ${{ steps.app.outputs.token }}
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          claude-args: ${{ env.TRIAGE_ARGS }}

      # Your toolchain, and only when there is something to fix.
      - if: steps.triage.outputs.disposition == 'fixable'
        run: npm ci

      - name: Implement
        id: implement
        if: steps.triage.outputs.disposition == 'fixable'
        uses: CVector-Energy/claude-code-solve/implement@v0.2.0
        with:
          issue-number: ${{ github.event.issue.number }}
          github-token: ${{ steps.app.outputs.token }}
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          resume-session-id: ${{ steps.triage.outputs.session-id }}
          claude-args: '--dangerously-skip-permissions --model claude-opus-5'
          git-user-name: my-bot[bot]
          git-user-email: 12345+my-bot[bot]@users.noreply.github.com
```

## Triage inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `issue-number` | The issue to triage | Yes | |
| `github-token` | Token for `gh`; needs `issues:write` to comment | Yes | |
| `anthropic-api-key` | Anthropic API key | Yes | |
| `claude-args` | CLI arguments; the `--json-schema` must produce `disposition` and `summary` | Yes | |
| `allowed-bots` | Bot logins whose comments may reach the agent | No | `''` |
| `show-full-output` | Log the full JSON output, tool results included | No | `false` |
| `prompt-template` | Template to render | No | `.github/prompts/issue-triage.md` |
| `clarification-fallback` | Posted when triage asks for clarification without saying what it needs | No | a generic question |

Outputs: `disposition`, `session-id`, `structured-output`, `execution-file`.

`disposition` is always one of the three values. Output that cannot be parsed reports `no-action` rather than nothing, because an empty disposition makes every downstream `if:` false and the job succeeds having neither fixed anything nor said why.

## Implement inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `issue-number` | The issue being fixed | Yes | |
| `github-token` | The agent opens the PR itself, so `contents:write` and `pull-requests:write` | Yes | |
| `anthropic-api-key` | Anthropic API key | Yes | |
| `git-user-name` / `git-user-email` | Identity the fix branch's commits are authored under | Yes | |
| `resume-session-id` | Triage's session, so the agent implements the plan it already made | No | `''` |
| `claude-args` | CLI arguments, excluding the resume this action adds | No | `--dangerously-skip-permissions` |
| `allowed-bots` | Bot logins whose comments may reach the agent | No | `''` |
| `branch-prefix` | Prefix for the fix branch; the issue number is appended | No | `claude/issue-` |
| `prompt-template` | Template to render | No | `.github/prompts/issue-implement.md` |

Outputs: `branch`, `session-id`, `execution-file`.

## Prompts Stay Yours

Both actions render a template from your workspace rather than shipping one. The instructions that matter — which test runner, which conventions, what a good pull request body looks like — are repository-specific, and two real consumers of these actions share under a third of their prompt text.

Triage substitutes `$REPO`, `$ISSUE_NUMBER` and `$ISSUE_BODY`; implement substitutes only `$ISSUE_NUMBER`, because the issue text is already in the conversation being resumed.

## Memory And Sessions

Both are restored for you; neither needs a step of your own.

**Memory** — the repo-wide store from [claude-code-memory](https://github.com/CVector-Energy/claude-code-memory) — is restored by the triage action and saved by its post step at the end of your job. It is deliberately *not* restored again by `implement`: that action runs later in the same job, and extracting the cache a second time would overwrite memories the triage agent had just written. Using `implement` without `triage` therefore runs without memory.

**The session** is scoped to `issue-<number>`, so a later run on the same issue continues the same conversation. `implement` continues triage's session rather than starting its own, via `resume-session-id`.

## What Stays In Your Workflow

Deliberately not absorbed:

- **Triggers, permissions and concurrency** — an action cannot declare them.
- **The App token**, if you use one. A composite action cannot read your `secrets`, so it would be a wrapper with nothing to wrap.
- **Toolchain setup and verification gates** — the parts that differ most between repositories.
- **Cleanup: trace uploads, reactions, labels.** A failing step aborts the rest of a composite action, so anything that must run when the agent fails belongs in the caller with `if: always()`. Both actions expose `execution-file` for exactly this.

## Pinning

Pin by full commit sha. These actions carry an API key and a write-scoped token, so a ref that can be repointed under you is the wrong thing to depend on, and there is deliberately no floating `v1` tag.

## Development

```sh
npm install
npm test    # node --test over src/*.test.js — action wiring, no runtime
```

## License

MIT
