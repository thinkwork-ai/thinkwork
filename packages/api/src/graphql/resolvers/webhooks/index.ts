import { webhooks_ as webhooksList } from "./webhooks.query.js";
import { webhook } from "./webhook.query.js";
import { createWebhook } from "./createWebhook.mutation.js";
import { updateWebhook } from "./updateWebhook.mutation.js";
import { deleteWebhook } from "./deleteWebhook.mutation.js";
import { regenerateWebhookToken } from "./regenerateWebhookToken.mutation.js";

export const webhookQueries = { webhooks: webhooksList, webhook };
export const webhookMutations = { createWebhook, updateWebhook, deleteWebhook, regenerateWebhookToken };
