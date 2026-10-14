#!/bin/bash
# Reads the agent's request to re-run the failed jobs. The agent never holds a token that can re-run anything: it writes a reason to $REQUEST_FILE, and this decides whether the workflow should act on it.
#
# A request counts only when the agent left the working tree unchanged. A change gets pushed, and the push starts CI again on its own, so a re-run on top of it would only test the old commit.
set -euo pipefail

if [[ ! -s "$REQUEST_FILE" ]]; then
  echo "rerun-requested=false" >> "$GITHUB_OUTPUT"
  exit 0
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "The agent asked for a re-run but also changed the tree; the push will start CI instead."
  echo "rerun-requested=false" >> "$GITHUB_OUTPUT"
  exit 0
fi

echo "The agent asked for a re-run of the failed jobs:"
head -c 2000 "$REQUEST_FILE"
echo
echo "rerun-requested=true" >> "$GITHUB_OUTPUT"
