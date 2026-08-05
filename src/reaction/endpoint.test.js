import assert from "node:assert/strict";
import { test } from "node:test";
import { reactionEndpoint } from "./endpoint.js";

const REPO = "acme/widgets";

test("a comment on an issue reacts on the comment", () => {
  assert.equal(
    reactionEndpoint("issue_comment", { comment: { id: 7 } }, REPO),
    "repos/acme/widgets/issues/comments/7/reactions",
  );
});

test("an inline review comment reacts on the pull comment, not the issue comment", () => {
  // Different endpoint family for the same-looking payload. Reacting on
  // /issues/comments/<id> with a pull comment id hits an unrelated comment.
  assert.equal(
    reactionEndpoint("pull_request_review_comment", { comment: { id: 7 } }, REPO),
    "repos/acme/widgets/pulls/comments/7/reactions",
  );
});

test("a review reacts on the pull request, having no endpoint of its own", () => {
  assert.equal(
    reactionEndpoint("pull_request_review", { pull_request: { number: 12 } }, REPO),
    "repos/acme/widgets/issues/12/reactions",
  );
});

test("an issue event reacts on the issue", () => {
  assert.equal(
    reactionEndpoint("issues", { issue: { number: 4 } }, REPO),
    "repos/acme/widgets/issues/4/reactions",
  );
});

test("a machine trigger reacts on nothing", () => {
  // workflow_run has no user-facing target; reacting on an arbitrary issue would
  // be worse than staying quiet.
  assert.equal(reactionEndpoint("workflow_run", { workflow_run: { id: 1 } }, REPO), null);
  assert.equal(reactionEndpoint("schedule", {}, REPO), null);
});

test("a payload missing the id it would need yields nothing", () => {
  for (const [event, payload] of [
    ["issue_comment", {}],
    ["pull_request_review_comment", { comment: {} }],
    ["pull_request_review", {}],
    ["issues", { issue: {} }],
  ]) {
    assert.equal(reactionEndpoint(event, payload, REPO), null, event);
  }
});
