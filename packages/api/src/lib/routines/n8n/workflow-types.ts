export interface N8nWorkflow {
  id?: string;
  name: string;
  active?: boolean;
  nodes: N8nWorkflowNode[];
  connections: Record<string, N8nNodeConnections>;
  settings?: Record<string, unknown>;
}

export interface N8nWorkflowNode {
  id: string;
  name: string;
  type: string;
  typeVersion?: number;
  position?: number[];
  parameters?: Record<string, unknown>;
  credentials?: Record<string, N8nCredentialReference>;
}

export interface N8nCredentialReference {
  id?: string;
  name?: string;
}

export interface N8nNodeConnections {
  main?: N8nConnection[][];
}

export interface N8nConnection {
  node: string;
  type?: string;
  index?: number;
}
