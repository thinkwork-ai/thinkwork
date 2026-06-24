import { createWorkItem } from "./createWorkItem.mutation.js";
import { deleteWorkItemView } from "./deleteWorkItemView.mutation.js";
import { saveWorkItemStatuses } from "./saveWorkItemStatuses.mutation.js";
import { saveWorkItemView } from "./saveWorkItemView.mutation.js";
import { threadWorkItems } from "./threadWorkItems.query.js";
import { updateWorkItem } from "./updateWorkItem.mutation.js";
import { updateWorkItemStatus } from "./updateWorkItemStatus.mutation.js";
import { workItem } from "./workItem.query.js";
import { workItemSavedViews } from "./workItemSavedViews.query.js";
import { workItemStatuses } from "./workItemStatuses.query.js";
import { workItems } from "./workItems.query.js";
import {
  workItemSavedViewTypeResolvers,
  workItemStatusTypeResolvers,
  workItemTypeResolvers,
} from "./shared.js";

export const workItemQueries = {
  workItems,
  workItem,
  threadWorkItems,
  workItemStatuses,
  workItemSavedViews,
};

export const workItemMutations = {
  createWorkItem,
  updateWorkItem,
  updateWorkItemStatus,
  saveWorkItemStatuses,
  saveWorkItemView,
  deleteWorkItemView,
};

export {
  workItemSavedViewTypeResolvers,
  workItemStatusTypeResolvers,
  workItemTypeResolvers,
};
