import { knowledgeBases_ as knowledgeBases } from "./knowledgeBases.query.js";
import { knowledgeBase } from "./knowledgeBase.query.js";
import { createKnowledgeBase } from "./createKnowledgeBase.mutation.js";
import { updateKnowledgeBase } from "./updateKnowledgeBase.mutation.js";
import { deleteKnowledgeBase } from "./deleteKnowledgeBase.mutation.js";
import { syncKnowledgeBase } from "./syncKnowledgeBase.mutation.js";
import { setAgentKnowledgeBases } from "./setAgentKnowledgeBases.mutation.js";

export const knowledgeQueries = { knowledgeBases, knowledgeBase };
export const knowledgeMutations = { createKnowledgeBase, updateKnowledgeBase, deleteKnowledgeBase, syncKnowledgeBase, setAgentKnowledgeBases };
