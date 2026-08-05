// Which thing the agent is reacting to. Pure, so the five event shapes can be
// checked without a runner.

/**
 * The reactions endpoint for the event that started this run, or `null` when the
 * event has nothing to react to.
 *
 * A review has no reactions endpoint of its own, so a `pull_request_review`
 * reacts on the pull request. `workflow_run` has no user-facing target at all —
 * it is a machine reacting to a machine — so it gets nothing rather than a
 * reaction on some arbitrary issue.
 */
export function reactionEndpoint(eventName, payload, repository) {
  const commentId = payload?.comment?.id;
  switch (eventName) {
    case "issue_comment":
      return commentId ? `repos/${repository}/issues/comments/${commentId}/reactions` : null;
    case "pull_request_review_comment":
      return commentId ? `repos/${repository}/pulls/comments/${commentId}/reactions` : null;
    case "pull_request_review":
      return payload?.pull_request?.number
        ? `repos/${repository}/issues/${payload.pull_request.number}/reactions`
        : null;
    case "issues":
      return payload?.issue?.number
        ? `repos/${repository}/issues/${payload.issue.number}/reactions`
        : null;
    case "pull_request":
      return payload?.pull_request?.number
        ? `repos/${repository}/issues/${payload.pull_request.number}/reactions`
        : null;
    default:
      return null;
  }
}
