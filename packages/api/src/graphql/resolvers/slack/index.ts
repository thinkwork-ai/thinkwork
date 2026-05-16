import { slackWorkspaces } from "./slackWorkspaces.query.js";
import { startSlackWorkspaceInstall } from "./installSlackWorkspace.mutation.js";
import { uninstallSlackWorkspace } from "./uninstallSlackWorkspace.mutation.js";

export const slackQueries = {
  slackWorkspaces,
};

export const slackMutations = {
  startSlackWorkspaceInstall,
  uninstallSlackWorkspace,
};
