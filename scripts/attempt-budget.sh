#!/usr/bin/env bash
# How many times the CI-failure agent has already tried this pull request, and
# whether it may try again. Writes `attempts` and `attempted` to $GITHUB_OUTPUT.
#
# The count has to come from the pull request's OWN commits. `git log <branch>`
# walks the whole ancestry, so every attempt ever merged into the base branch is
# charged to every branch cut after it — three anywhere in the history and the
# agent is stillborn on every pull request in the repository, permanently.
#
# It also has to come from somewhere a re-run cannot clear, which the commits
# are and a run's own state is not.
set -euo pipefail

: "${REPO:?}" "${PR_NUMBER:?}" "${BRANCH:?}" "${MAX_ATTEMPTS:?}" "${COMMIT_PREFIX:?}"
: "${GITHUB_OUTPUT:?}"

SUBJECTS=$(gh pr view "$PR_NUMBER" --repo "$REPO" \
  --json commits --jq '.commits[].messageHeadline')

# Matched with `case`, not `grep`: the prefix is a literal string, and the
# default `fix(ci):` is a regex in disguise.
ATTEMPTS=0
while IFS= read -r SUBJECT; do
  case "$SUBJECT" in
    "${COMMIT_PREFIX}"*) ATTEMPTS=$((ATTEMPTS + 1)) ;;
  esac
done <<< "$SUBJECTS"

echo "attempts=$ATTEMPTS" >> "$GITHUB_OUTPUT"
if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
  echo "attempted=false" >> "$GITHUB_OUTPUT"
  echo "::warning::$ATTEMPTS attempts already made on $BRANCH; leaving this one for a human."
else
  echo "attempted=true" >> "$GITHUB_OUTPUT"
  echo "Attempt $((ATTEMPTS + 1)) of $MAX_ATTEMPTS on $BRANCH."
fi
