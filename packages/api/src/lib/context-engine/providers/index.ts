import type { ContextProviderDescriptor } from "../types.js";
import { createBedrockKnowledgeBaseContextProvider } from "./bedrock-knowledge-base.js";
import { createMemoryContextProvider } from "./memory.js";
import { createWorkspaceFilesContextProvider } from "./workspace-files.js";
import { createWikiContextProvider } from "./wiki.js";

export function createCoreContextProviders(): ContextProviderDescriptor[] {
	return [
		createMemoryContextProvider(),
		createWikiContextProvider(),
		createWorkspaceFilesContextProvider(),
		createBedrockKnowledgeBaseContextProvider(),
	];
}

export { createBedrockKnowledgeBaseContextProvider } from "./bedrock-knowledge-base.js";
export { createMemoryContextProvider } from "./memory.js";
export { createMcpToolContextProvider } from "./mcp-tool.js";
export { createWorkspaceFilesContextProvider } from "./workspace-files.js";
export { createWikiContextProvider } from "./wiki.js";
