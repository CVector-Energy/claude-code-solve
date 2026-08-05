# Claude Code Solve Actions

Two actions for the middle of an issue-solving workflow: **triage** an issue and report a disposition, then **implement** the fix it planned. Everything specific to your repository — the toolchain, the verification gates, the prompts, the commit identity — stays in your workflow.

| Action | What it does |
|--------|--------------|
| `…/claude-code-solve/resolve-pr` | Works out which pull request the run concerns, whether one exists yet, and whether its branch is the agent's — and owns the branch prefix that answers all three |
| `…/claude-code-solve/reaction` | Reacts to whatever triggered the run, and takes the reaction back when the job ends — no cleanup step of your own |
| `…/claude-code-solve/triage` | Restores the repo's Claude memory, resumes the issue's session, renders the triage prompt, runs the agent, reports `fixable` / `needs-clarification` / `no-action`, and comments on the issue for the latter two |
| `…/claude-code-solve/implement` | Branches, renders the implement prompt, and runs an agent that continues the triage conversation |
| `…/claude-code-solve/respond` | Answers a pull request review: resumes the PR's session, runs the agent, pushes its edits and posts its replies |

Every action is a subdirectory; there is no action at the root.

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

      # One step. The reaction is removed by this action's post step when the job
      # ends, pass or fail.
      - uses: CVector-Energy/claude-code-solve/reaction@<sha>
        with:
          github-token: ${{ steps.app.outputs.token }}

      # Owns the branch prefix: it names the fix branch, and it is what tells the
      # review workflow which pull requests are the agent's. Stop here when one is
      # already open — the implement agent force-pushes.
      - id: pr
        uses: CVector-Energy/claude-code-solve/resolve-pr@<sha>
        with:
          github-token: ${{ steps.app.outputs.token }}

      - name: Triage
        id: triage
        uses: CVector-Energy/claude-code-solve/triage@<sha>
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
        uses: CVector-Energy/claude-code-solve/implement@<sha>
        with:
          issue-number: ${{ github.event.issue.number }}
          github-token: ${{ steps.app.outputs.token }}
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          resume-session-id: ${{ steps.triage.outputs.session-id }}
          claude-args: '--dangerously-skip-permissions --model claude-opus-5'
          branch: ${{ steps.pr.outputs.branch }}
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
| `branch` | The fix branch to create; take it from `resolve-pr` so the name has one home | Yes | |
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

Pin by full commit sha; there are no version tags. These actions carry an API key and a write-scoped token, so a ref that can be repointed under you is the wrong thing to depend on, and there is deliberately no floating `v1` tag.

## Development

```sh
npm install
npm run build   # bundle the reaction action into reaction/dist
npm test        # node --test — action wiring, the reaction endpoint, the resolve script
```

## License

MIT
