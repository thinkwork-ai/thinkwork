export type CogneeClusterIdentity = {
  clusterArn: string | null;
  clusterName: string | null;
  clusterRef: string | null;
};

type ResolveCogneeClusterIdentityInput = {
  enabled: boolean;
  stage: string;
  region: string;
  accountId: string | null;
  clusterArnOverride?: string | null;
};

export function cogneeBrainClusterName(stage: string): string {
  return `thinkwork-${stage}-brain-cluster`;
}

export function ecsClusterNameFromArnOrName(value: string): string {
  const trimmed = value.trim();
  const slashIndex = trimmed.lastIndexOf("/");
  return slashIndex >= 0 ? trimmed.slice(slashIndex + 1) : trimmed;
}

export function resolveCogneeClusterIdentity({
  enabled,
  stage,
  region,
  accountId,
  clusterArnOverride = process.env.COGNEE_CLUSTER_ARN,
}: ResolveCogneeClusterIdentityInput): CogneeClusterIdentity {
  const override = clusterArnOverride?.trim() || null;
  const fallbackClusterName = cogneeBrainClusterName(stage);
  const clusterName = override
    ? ecsClusterNameFromArnOrName(override)
    : enabled
      ? fallbackClusterName
      : null;

  return {
    clusterArn:
      override ||
      (enabled && accountId
        ? `arn:aws:ecs:${region}:${accountId}:cluster/${fallbackClusterName}`
        : null),
    clusterName,
    clusterRef: override || (enabled ? fallbackClusterName : null),
  };
}
