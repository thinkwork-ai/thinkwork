export const ComposerCapabilities = [
  "attach",
  "agentToggle",
  "goalMode",
  "spaceSelector",
  "modelPicker",
  "voice",
  "mentions",
] as const;

export type ComposerCapability = (typeof ComposerCapabilities)[number];
