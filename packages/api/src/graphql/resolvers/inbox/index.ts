import { inboxItems_ as inboxItems } from "./inboxItems.query.js";
import { inboxItem } from "./inboxItem.query.js";
import { activityLog_ as activityLog } from "./activityLog.query.js";
import { createInboxItem } from "./createInboxItem.mutation.js";
import { decideInboxItem } from "./decideInboxItem.mutation.js";
import { approveInboxItem } from "./approveInboxItem.mutation.js";
import { rejectInboxItem } from "./rejectInboxItem.mutation.js";
import { requestRevision } from "./requestRevision.mutation.js";
import { resubmitInboxItem } from "./resubmitInboxItem.mutation.js";
import { cancelInboxItem } from "./cancelInboxItem.mutation.js";
import { addInboxItemComment } from "./addInboxItemComment.mutation.js";
import { addInboxItemLink } from "./addInboxItemLink.mutation.js";
import { removeInboxItemLink } from "./removeInboxItemLink.mutation.js";

export const inboxQueries = { inboxItems, inboxItem, activityLog };
export const inboxMutations = { createInboxItem, decideInboxItem, approveInboxItem, rejectInboxItem, requestRevision, resubmitInboxItem, cancelInboxItem, addInboxItemComment, addInboxItemLink, removeInboxItemLink };
