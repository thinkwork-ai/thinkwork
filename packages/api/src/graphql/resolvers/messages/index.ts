import { messages_ as messages } from "./messages.query.js";
import { sendMessage } from "./sendMessage.mutation.js";
import { deleteMessage } from "./deleteMessage.mutation.js";
import { refreshGenUI } from "./refreshGenUI.mutation.js";

export const messageQueries = { messages };
export const messageMutations = { sendMessage, deleteMessage, refreshGenUI };
