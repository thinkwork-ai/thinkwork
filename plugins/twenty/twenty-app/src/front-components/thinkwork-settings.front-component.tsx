import { useState } from "react";
import { defineFrontComponent } from "twenty-sdk/define";
import {
  enqueueSnackbar,
  getApplicationVariable,
  useFrontComponentId,
} from "twenty-sdk/front-component";

import { THINKWORK_SETTINGS_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from "src/constants/universal-identifiers";

const WEBHOOK_URL_KEY = "THINKWORK_WEBHOOK_URL";
const TRIGGER_STAGE_KEY = "THINKWORK_TRIGGER_STAGE";
const DEFAULT_TRIGGER_STAGE = "Customer";

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type FrontComponentQuery = {
  frontComponent?: {
    applicationId?: string;
  } | null;
};

type UpdateApplicationVariableMutation = {
  updateOneApplicationVariable?: boolean;
};

async function metadataGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const token =
    await globalThis.frontComponentHostCommunicationApi.requestAccessTokenRefresh?.();

  const response = await fetch("/metadata", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });

  const result = (await response.json()) as GraphQLResponse<T>;
  if (!response.ok || result.errors?.length) {
    throw new Error(
      result.errors
        ?.map((error) => error.message)
        .filter(Boolean)
        .join("; ") || `Twenty metadata API returned HTTP ${response.status}`,
    );
  }

  if (!result.data) {
    throw new Error("Twenty metadata API returned no data.");
  }

  return result.data;
}

async function getApplicationId(frontComponentId: string): Promise<string> {
  const data = await metadataGraphQL<FrontComponentQuery>(
    `query ThinkWorkSettingsFrontComponent($frontComponentId: UUID!) {
      frontComponent(id: $frontComponentId) {
        applicationId
      }
    }`,
    { frontComponentId },
  );

  const applicationId = data.frontComponent?.applicationId;
  if (!applicationId) {
    throw new Error("Unable to resolve the installed ThinkWork application.");
  }
  return applicationId;
}

async function updateApplicationVariable(
  applicationId: string,
  key: string,
  value: string,
): Promise<void> {
  const data = await metadataGraphQL<UpdateApplicationVariableMutation>(
    `mutation UpdateThinkWorkApplicationVariable(
      $applicationId: UUID!
      $key: String!
      $value: String!
    ) {
      updateOneApplicationVariable(
        applicationId: $applicationId
        key: $key
        value: $value
      )
    }`,
    { applicationId, key, value },
  );

  if (!data.updateOneApplicationVariable) {
    throw new Error(`Twenty did not update ${key}.`);
  }
}

function fieldStyle(multiline = false) {
  return {
    border: "1px solid #d0d5dd",
    borderRadius: "6px",
    boxSizing: "border-box" as const,
    font: "inherit",
    minHeight: multiline ? "88px" : "40px",
    padding: "8px 10px",
    width: "100%",
  };
}

function ThinkWorkSettings() {
  const frontComponentId = useFrontComponentId();
  const savedStage =
    getApplicationVariable(TRIGGER_STAGE_KEY) || DEFAULT_TRIGGER_STAGE;
  const [webhookUrl, setWebhookUrl] = useState("");
  const [triggerStage, setTriggerStage] = useState(savedStage);
  const [isSaving, setIsSaving] = useState(false);

  async function saveSettings() {
    const normalizedWebhookUrl = webhookUrl.trim();
    const normalizedTriggerStage = triggerStage.trim() || DEFAULT_TRIGGER_STAGE;

    if (!normalizedWebhookUrl) {
      await enqueueSnackbar({
        variant: "error",
        message: "Webhook URL is required.",
      });
      return;
    }

    if (!/^https:\/\/.+/i.test(normalizedWebhookUrl)) {
      await enqueueSnackbar({
        variant: "error",
        message: "Webhook URL must start with https://.",
      });
      return;
    }

    setIsSaving(true);
    try {
      const applicationId = await getApplicationId(frontComponentId);
      await updateApplicationVariable(
        applicationId,
        WEBHOOK_URL_KEY,
        normalizedWebhookUrl,
      );
      await updateApplicationVariable(
        applicationId,
        TRIGGER_STAGE_KEY,
        normalizedTriggerStage,
      );
      setWebhookUrl("");
      setTriggerStage(normalizedTriggerStage);
      await enqueueSnackbar({
        variant: "success",
        message: "ThinkWork webhook settings saved.",
      });
    } catch (error) {
      await enqueueSnackbar({
        variant: "error",
        message: "Could not save ThinkWork webhook settings.",
        detailedMessage: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main
      style={{
        color: "#101828",
        display: "grid",
        gap: "20px",
        maxWidth: "720px",
        padding: "24px 0",
      }}
    >
      <section style={{ display: "grid", gap: "8px" }}>
        <h2 style={{ fontSize: "18px", fontWeight: 600, margin: 0 }}>
          ThinkWork Webhook
        </h2>
        <p style={{ color: "#667085", lineHeight: 1.5, margin: 0 }}>
          Configure the ThinkWork webhook called by the Twenty workflow action
          when an Opportunity reaches the configured stage.
        </p>
      </section>

      <label style={{ display: "grid", gap: "6px" }}>
        <span style={{ fontSize: "13px", fontWeight: 600 }}>
          ThinkWork webhook URL
        </span>
        <textarea
          onChange={(event) => setWebhookUrl(event.currentTarget.value)}
          placeholder="https://app.thinkwork.ai/webhooks/..."
          style={fieldStyle(true)}
          value={webhookUrl}
        />
        <span style={{ color: "#667085", fontSize: "12px" }}>
          Secret values are not displayed after saving. Paste a new URL to
          rotate the webhook.
        </span>
      </label>

      <label style={{ display: "grid", gap: "6px" }}>
        <span style={{ fontSize: "13px", fontWeight: 600 }}>Trigger stage</span>
        <input
          onChange={(event) => setTriggerStage(event.currentTarget.value)}
          placeholder={DEFAULT_TRIGGER_STAGE}
          style={fieldStyle()}
          value={triggerStage}
        />
        <span style={{ color: "#667085", fontSize: "12px" }}>
          The target Twenty Opportunity stage. For this workspace, use Customer.
        </span>
      </label>

      <button
        disabled={isSaving}
        onClick={() => {
          void saveSettings();
        }}
        style={{
          alignItems: "center",
          background: isSaving ? "#98a2b3" : "#1570ef",
          border: 0,
          borderRadius: "6px",
          color: "#ffffff",
          cursor: isSaving ? "default" : "pointer",
          display: "inline-flex",
          font: "inherit",
          fontWeight: 600,
          justifyContent: "center",
          minHeight: "40px",
          padding: "0 14px",
          width: "fit-content",
        }}
        type="button"
      >
        {isSaving ? "Saving..." : "Save settings"}
      </button>
    </main>
  );
}

export default defineFrontComponent({
  universalIdentifier: THINKWORK_SETTINGS_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: "thinkwork-settings",
  description:
    "Configures the ThinkWork webhook URL and Opportunity stage for workflow actions.",
  component: ThinkWorkSettings,
});
