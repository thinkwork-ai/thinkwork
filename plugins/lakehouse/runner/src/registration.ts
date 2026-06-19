export interface RunnerRegistration {
  runnerId: string;
  integrationKey: string;
  outboundOnly: true;
  version: string;
  heartbeatAt: string;
}

export function buildRunnerRegistration(input: {
  runnerId: string;
  integrationKey: string;
  version: string;
  heartbeatAt: string;
}): RunnerRegistration {
  return {
    ...input,
    outboundOnly: true,
  };
}
