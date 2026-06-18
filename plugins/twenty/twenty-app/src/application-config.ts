import { defineApplication } from "twenty-sdk/define";

import {
  APP_DESCRIPTION,
  APP_DISPLAY_NAME,
  APPLICATION_UNIVERSAL_IDENTIFIER,
  THINKWORK_TRIGGER_STAGE_VARIABLE_UNIVERSAL_IDENTIFIER,
  THINKWORK_SETTINGS_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  THINKWORK_WEBHOOK_URL_VARIABLE_UNIVERSAL_IDENTIFIER,
} from "src/constants/universal-identifiers";

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: APP_DISPLAY_NAME,
  description: APP_DESCRIPTION,
  author: "ThinkWork",
  category: "Automation",
  settingsCustomTabFrontComponentUniversalIdentifier:
    THINKWORK_SETTINGS_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  applicationVariables: {
    THINKWORK_WEBHOOK_URL: {
      universalIdentifier: THINKWORK_WEBHOOK_URL_VARIABLE_UNIVERSAL_IDENTIFIER,
      description:
        "Secret full ThinkWork generic webhook URL from Settings > Webhooks. Example: https://app.thinkwork.ai/webhooks/<token>.",
      isSecret: true,
    },
    THINKWORK_TRIGGER_STAGE: {
      universalIdentifier:
        THINKWORK_TRIGGER_STAGE_VARIABLE_UNIVERSAL_IDENTIFIER,
      description:
        'Twenty Opportunity stage label that triggers the ThinkWork webhook. Defaults to "Customer".',
      value: "Customer",
      isSecret: false,
    },
  },
});
