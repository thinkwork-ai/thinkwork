/**
 * memorySystemConfig — reports which memory backends are wired up at
 * runtime. Read from Lambda environment variables so the admin UI can
 * gate views (e.g. hide the Knowledge Graph toggle when Hindsight is not
 * deployed).
 *
 * - managedMemoryEnabled: true when AGENTCORE_MEMORY_ID is populated
 *   (always true in a standard Thinkwork deploy — the thinkwork Terraform
 *   module auto-provisions one).
 * - hindsightEnabled: true when HINDSIGHT_ENDPOINT points somewhere. This
 *   mirrors the same env var check used in memorySearch.query.ts.
 */

export const memorySystemConfig = async () => {
	return {
		managedMemoryEnabled: !!process.env.AGENTCORE_MEMORY_ID,
		hindsightEnabled: !!process.env.HINDSIGHT_ENDPOINT,
	};
};
