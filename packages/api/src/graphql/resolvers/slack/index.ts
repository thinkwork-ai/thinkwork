import { slackWorkspaces } from "./slackWorkspaces.query.js";
import { mySlackLinks } from "./mySlackLinks.query.js";
import { startSlackWorkspaceInstall } from "./installSlackWorkspace.mutation.js";
import { uninstallSlackWorkspace } from "./uninstallSlackWorkspace.mutation.js";
import { unlinkSlackIdentity } from "./unlinkSlackIdentity.mutation.js";

export const slackQueries = {
  slackWorkspaces,
  mySlackLinks,
};

export const slackMutations = {
  startSlackWorkspaceInstall,
  uninstallSlackWorkspace,
  unlinkSlackIdentity,
};
