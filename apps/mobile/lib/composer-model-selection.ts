export interface ApprovedComposerModel {
  id: string;
  modelId: string;
  displayName: string;
  provider: string;
}

export function shouldRenderModelPicker(
  models: readonly ApprovedComposerModel[] | null | undefined,
) {
  return Boolean(models && models.length > 0);
}

export function selectedModelForId(
  models: readonly ApprovedComposerModel[] | null | undefined,
  modelId: string | null | undefined,
) {
  if (!models || !modelId) return null;
  return models.find((model) => model.modelId === modelId) ?? null;
}

export function formatComposerModelProvider(provider: string) {
  return provider
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}
