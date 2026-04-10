import { hives_ as teams } from "./hives.query.js";
import { hive } from "./hive.query.js";
import { createHive } from "./createHive.mutation.js";
import { updateHive } from "./updateHive.mutation.js";
import { deleteHive } from "./deleteHive.mutation.js";
import { addHiveAgent } from "./addHiveAgent.mutation.js";
import { removeHiveAgent } from "./removeHiveAgent.mutation.js";
import { addHiveUser } from "./addHiveUser.mutation.js";
import { removeHiveUser } from "./removeHiveUser.mutation.js";

export const teamQueries = { teams, hive };
export const teamMutations = { createHive, updateHive, deleteHive, addHiveAgent, removeHiveAgent, addHiveUser, removeHiveUser };
