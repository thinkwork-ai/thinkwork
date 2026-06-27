import { workItem } from "./workItem.query.js";
import { workItems } from "./workItems.query.js";
import { threadWorkItems } from "./threadWorkItems.query.js";
import { openEngineEligibleWorkItems } from "./openEngineEligibleWorkItems.query.js";
import { workItemStatuses } from "./workItemStatuses.query.js";
import { workItemSavedViews } from "./workItemSavedViews.query.js";
import { createWorkItem } from "./createWorkItem.mutation.js";
import { updateWorkItem } from "./updateWorkItem.mutation.js";
import { updateWorkItemStatus } from "./updateWorkItemStatus.mutation.js";
import { claimNextOpenEngineWorkItem } from "./claimNextOpenEngineWorkItem.mutation.js";
import { recordOpenEngineWorkItemReceipt } from "./recordOpenEngineWorkItemReceipt.mutation.js";
import { saveWorkItemStatuses } from "./saveWorkItemStatuses.mutation.js";
import { saveWorkItemView } from "./saveWorkItemView.mutation.js";
import { deleteWorkItemView } from "./deleteWorkItemView.mutation.js";

export const workItemQueries = {
  workItems,
  workItem,
  threadWorkItems,
  openEngineEligibleWorkItems,
  workItemStatuses,
  workItemSavedViews,
};

export const workItemMutations = {
  createWorkItem,
  updateWorkItem,
  updateWorkItemStatus,
  claimNextOpenEngineWorkItem,
  recordOpenEngineWorkItemReceipt,
  saveWorkItemStatuses,
  saveWorkItemView,
  deleteWorkItemView,
};

export { workItemTypeResolvers } from "./types.js";
