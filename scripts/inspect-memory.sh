#!/usr/bin/env bash
# Diagnostic: where does Claude Code actually keep this workspace's auto-memory?
#
# The `claude-code-memory` action, which triage, respond and fix-ci each restore from, derives the store path from $HOME and $GITHUB_WORKSPACE and caches `~/.claude/projects/*/memory`. Its post step has been observed failing with "Path Validation Error: Path(s) specified in the action for caching do(es) not exist", meaning the store was never saved and every run started with zero memories. The two candidate explanations are that the action caches a path the CLI does not write, or that the directory it pre-creates does not survive the agent run.
#
# The actions call this twice when their `inspect-memory` input is on, once before the agent step and once after. The "before" listing shows every config root on the runner next to the path the action chose, which settles the first explanation. Comparing "before" with "after" settles the second.
#
# Read-only, and deliberately incapable of failing the job: a diagnostic that breaks the workflow it is diagnosing is worse than no diagnostic. Delete this script, the `inspect-memory` inputs and the steps that call it once the store persists across runs.

LABEL=${1:-unlabelled}

echo "::group::Claude memory store — ${LABEL}"

echo "HOME=${HOME:-<unset>}"
echo "GITHUB_WORKSPACE=${GITHUB_WORKSPACE:-<unset>}"
echo "PWD=$(pwd)"
# The action slugifies $GITHUB_WORKSPACE, but the CLI keys auto-memory off the resolved repository root: in a linked git worktree the store lands under the *main* worktree's slug, not the checkout's. A symlinked or worktree-based workspace therefore gives the CLI a different slug than the action computed. Both are printed so the two can be compared.
echo "workspace realpath=$(realpath "${GITHUB_WORKSPACE:-.}" 2>/dev/null || echo '<none>')"
echo "git common dir=$(git rev-parse --git-common-dir 2>/dev/null || echo '<none>')"
echo "git main worktree=$(git worktree list 2>/dev/null | head -1 || echo '<none>')"
echo "whoami=$(whoami 2>/dev/null || echo '<unknown>')"

# A config dir override would move the whole store somewhere the action never looks. Values for the two that matter, names only for anything else, so a secret that happens to mention Claude is not echoed into the log.
echo "CLAUDE_CONFIG_DIR=${CLAUDE_CONFIG_DIR:-<unset>}"
echo "XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-<unset>}"
echo "other CLAUDE_* variables set: $(env | grep -oE '^[A-Za-z_]*CLAUDE[A-Za-z_]*' | sort -u | tr '\n' ' ')"

# The path the action told the agent to use, and the parent it should sit in. The parent matters on its own: a run where the parent exists but the `memory` child does not is the signature of the CLI creating the project directory while the action's pre-created directory went elsewhere.
echo "--- the path the action chose ---"
echo "action MEMORY_PATH=${MEMORY_PATH:-<unset>}"
if [ -n "${MEMORY_PATH:-}" ]; then
  if [ -d "$MEMORY_PATH" ]; then
    echo "exists; contents:"
    ls -la "$MEMORY_PATH" 2>&1 | sed 's/^/  /'
  else
    echo "does NOT exist as a directory"
  fi
  echo "parent $(dirname "$MEMORY_PATH"):"
  ls -la "$(dirname "$MEMORY_PATH")" 2>&1 | sed 's/^/  /'
fi

# Every plausible config root, not just $HOME/.claude — if the CLI writes under a different HOME (a temp one, or root's), this is what shows it. Bounded at depth 4 so it stays a fast scan; the per-root listings below are what actually locate the memories.
ROOTS=$(
  {
    find / -maxdepth 4 -type d -name .claude 2>/dev/null
    # Named explicitly in case one of them sits deeper than the scan reaches.
    for CANDIDATE in "${HOME:-}/.claude" /root/.claude "${RUNNER_TEMP:-}/.claude" "${GITHUB_WORKSPACE:-}/.claude"; do
      [ -d "$CANDIDATE" ] && echo "$CANDIDATE"
    done
  } | sort -u
)

# The single line that answers the question: every store on the box, whatever slug it landed under, with how much is in it.
echo "--- every memory directory on the runner ---"
echo "$ROOTS" | while IFS= read -r ROOT; do
  [ -n "$ROOT" ] || continue
  find "$ROOT" -maxdepth 3 -type d -name memory 2>/dev/null
done | sort -u | while IFS= read -r STORE; do
  [ -n "$STORE" ] || continue
  echo "  $STORE ($(find "$STORE" -type f 2>/dev/null | wc -l | tr -d ' ') files)"
done

echo "--- .claude roots in detail ---"
echo "$ROOTS" | while IFS= read -r ROOT; do
  [ -n "$ROOT" ] || continue
  echo "root: $ROOT"
  ls -ld "$ROOT" 2>&1 | sed 's/^/  /'
  ls -la "$ROOT" 2>&1 | sed 's/^/  /'
  if [ -d "$ROOT/projects" ]; then
    echo "  projects tree (memory directories and transcripts):"
    find "$ROOT/projects" -maxdepth 3 2>/dev/null | sort | sed 's/^/    /'
  fi
  echo "  MEMORY.md indexes under this root:"
  find "$ROOT" -maxdepth 4 -name MEMORY.md 2>/dev/null | sort | sed 's/^/    /'
done

echo "::endgroup::"

# Never fail the caller, whatever any of the above returned.
exit 0
