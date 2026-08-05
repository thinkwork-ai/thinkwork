export const ComposerCapabilities = [
  "attach",
  "agentToggle",
  "spaceSelector",
  "modelPicker",
  "voice",
  "mentions",
] as const;

export type ComposerCapability = (typeof ComposerCapabilities)[number];
