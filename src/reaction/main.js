import fs from "node:fs";
import * as core from "@actions/core";
import { reactionEndpoint } from "./endpoint.js";

async function run() {
  const token = core.getInput("github-token", { required: true });
  const content = core.getInput("reaction") || "eyes";
  const repository = process.env.GITHUB_REPOSITORY || "";
  const eventName = process.env.GITHUB_EVENT_NAME || "";

  let payload = {};
  try {
    payload = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  } catch (error) {
    core.warning(`Could not read the event payload: ${error.message}`);
  }

  const endpoint = reactionEndpoint(eventName, payload, repository);
  if (!endpoint) {
    core.info(`Nothing to react to on a ${eventName} event.`);
    core.setOutput("reacted", "false");
    return;
  }

  const response = await fetch(`${process.env.GITHUB_API_URL || "https://api.github.com"}/${endpoint}`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    // A reaction is a courtesy. Failing the job over one would be worse than
    // going without.
    core.warning(`Could not add the ${content} reaction: ${response.status} ${response.statusText}`);
    core.setOutput("reacted", "false");
    return;
  }

  const { id } = await response.json();
  // Handed to the post step, which is where the removal happens.
  core.saveState("endpoint", endpoint);
  core.saveState("id", String(id));
  core.setOutput("reacted", "true");
  core.info(`Added the ${content} reaction; it will be removed when the job ends.`);
}

run().catch((error) => {
  core.warning(`claude-code-solve/reaction: ${error.message}`);
  core.setOutput("reacted", "false");
});
