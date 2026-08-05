import * as core from "@actions/core";

async function run() {
  const endpoint = core.getState("endpoint");
  const id = core.getState("id");
  if (!endpoint || !id) {
    // Nothing was added — an event with no target, or the add failed.
    return;
  }

  // Inputs are still in the environment for a post step, so the token does not
  // have to be stashed in state.
  const token = core.getInput("github-token");
  const response = await fetch(
    `${process.env.GITHUB_API_URL || "https://api.github.com"}/${endpoint}/${id}`,
    {
      method: "DELETE",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
      },
    },
  );

  if (response.ok || response.status === 404) {
    core.info("Removed the reaction.");
    return;
  }
  core.warning(`Could not remove the reaction: ${response.status} ${response.statusText}`);
}

run().catch((error) => {
  core.warning(`claude-code-solve/reaction: ${error.message}`);
});
