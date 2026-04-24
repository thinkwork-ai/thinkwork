import { threads_query } from "./threads.query.js";
import { threadsPaged_query } from "./threadsPaged.query.js";
import { thread } from "./thread.query.js";
import { threadByNumber } from "./threadByNumber.query.js";
import { threadLabels_query } from "./threadLabels.query.js";
import { unreadThreadCount } from "./unreadThreadCount.query.js";

import { createThread } from "./createThread.mutation.js";
import { updateThread } from "./updateThread.mutation.js";
import { deleteThread } from "./deleteThread.mutation.js";
import { checkoutThread } from "./checkoutThread.mutation.js";
import { releaseThread } from "./releaseThread.mutation.js";
import { createThreadLabel } from "./createThreadLabel.mutation.js";
import { updateThreadLabel } from "./updateThreadLabel.mutation.js";
import { deleteThreadLabel } from "./deleteThreadLabel.mutation.js";
import { assignThreadLabel } from "./assignThreadLabel.mutation.js";
import { removeThreadLabel } from "./removeThreadLabel.mutation.js";
import { addThreadDependency } from "./addThreadDependency.mutation.js";
import { removeThreadDependency } from "./removeThreadDependency.mutation.js";
import { escalateThread } from "./escalateThread.mutation.js";
import { delegateThread } from "./delegateThread.mutation.js";

export const threadQueries = {
	threads: threads_query,
	threadsPaged: threadsPaged_query,
	thread,
	threadByNumber,
	threadLabels: threadLabels_query,
	unreadThreadCount,
};

export const threadMutations = {
	createThread,
	updateThread,
	deleteThread,
	checkoutThread,
	releaseThread,
	createThreadLabel,
	updateThreadLabel,
	deleteThreadLabel,
	assignThreadLabel,
	removeThreadLabel,
	addThreadDependency,
	removeThreadDependency,
	escalateThread,
	delegateThread,
};
