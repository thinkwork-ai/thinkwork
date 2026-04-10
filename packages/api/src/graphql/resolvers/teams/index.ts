import { teams_ as teams } from "./teams.query.js";
import { team } from "./team.query.js";
import { createTeam } from "./createTeam.mutation.js";
import { updateTeam } from "./updateTeam.mutation.js";
import { deleteTeam } from "./deleteTeam.mutation.js";
import { addTeamAgent } from "./addTeamAgent.mutation.js";
import { removeTeamAgent } from "./removeTeamAgent.mutation.js";
import { addTeamUser } from "./addTeamUser.mutation.js";
import { removeTeamUser } from "./removeTeamUser.mutation.js";

export const teamQueries = { teams, team };
export const teamMutations = { createTeam, updateTeam, deleteTeam, addTeamAgent, removeTeamAgent, addTeamUser, removeTeamUser };
