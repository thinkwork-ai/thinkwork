import { publishSkillDraft } from "./publishSkillDraft.mutation.js";
import { createSkillDraft } from "./createSkillDraft.mutation.js";
import { rejectSkillDraft } from "./rejectSkillDraft.mutation.js";
import { skillDraft } from "./skillDraft.query.js";
import { skillDraftsQuery } from "./skillDrafts.query.js";
import { submitSkillDraft } from "./submitSkillDraft.mutation.js";
import { updateSkillDraft } from "./updateSkillDraft.mutation.js";

export const skillCreatorQueries = {
  skillDraft,
  skillDrafts: skillDraftsQuery,
};

export const skillCreatorMutations = {
  createSkillDraft,
  updateSkillDraft,
  submitSkillDraft,
  rejectSkillDraft,
  publishSkillDraft,
};
