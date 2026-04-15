import { threads_query } from "./threads.query.js";
import { threadsPaged_query } from "./threadsPaged.query.js";
import { thread } from "./thread.query.js";
import { threadByNumber } from "./threadByNumber.query.js";
import { threadLabels_query } from "./threadLabels.query.js";

import { createThread } from "./createThread.mutation.js";
import { updateThread } from "./updateThread.mutation.js";
import { deleteThread } from "./deleteThread.mutation.js";
import { checkoutThread } from "./checkoutThread.mutation.js";
import { releaseThread } from "./releaseThread.mutation.js";
import { addThreadComment } from "./addThreadComment.mutation.js";
import { updateThreadComment } from "./updateThreadComment.mutation.js";
import { deleteThreadComment } from "./deleteThreadComment.mutation.js";
import { createThreadLabel } from "./createThreadLabel.mutation.js";
import { updateThreadLabel } from "./updateThreadLabel.mutation.js";
import { deleteThreadLabel } from "./deleteThreadLabel.mutation.js";
import { assignThreadLabel } from "./assignThreadLabel.mutation.js";
import { removeThreadLabel } from "./removeThreadLabel.mutation.js";
import { addThreadDependency } from "./addThreadDependency.mutation.js";
import { removeThreadDependency } from "./removeThreadDependency.mutation.js";
import { escalateThread } from "./escalateThread.mutation.js";
import { delegateThread } from "./delegateThread.mutation.js";
import { retryTaskSync } from "./retryTaskSync.mutation.js";

export const threadQueries = {
	threads: threads_query,
	threadsPaged: threadsPaged_query,
	thread,
	threadByNumber,
	threadLabels: threadLabels_query,
};

export const threadMutations = {
	createThread,
	updateThread,
	deleteThread,
	checkoutThread,
	releaseThread,
	addThreadComment,
	updateThreadComment,
	deleteThreadComment,
	createThreadLabel,
	updateThreadLabel,
	deleteThreadLabel,
	assignThreadLabel,
	removeThreadLabel,
	addThreadDependency,
	removeThreadDependency,
	escalateThread,
	delegateThread,
	retryTaskSync,
};
