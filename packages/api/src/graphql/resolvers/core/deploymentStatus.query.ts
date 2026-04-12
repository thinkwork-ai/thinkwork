/**
 * deploymentStatus — reports deployment infrastructure details from Lambda
 * environment variables. No DB access, no live AWS API calls.
 */

export const deploymentStatus = async () => {
	return {
		stage: process.env.STAGE || "unknown",
		source: "AWS",
		region: process.env.AWS_REGION || "us-east-1",
		accountId: process.env.AWS_ACCOUNT_ID || null,
		bucketName: process.env.BUCKET_NAME || null,
		databaseEndpoint: process.env.DATABASE_HOST || null,
		ecrUrl: process.env.ECR_REPOSITORY_URL || null,
		adminUrl: process.env.ADMIN_URL || null,
		docsUrl: process.env.DOCS_URL || null,
		apiEndpoint: process.env.API_ENDPOINT || null,
		appsyncUrl: process.env.APPSYNC_ENDPOINT || null,
		appsyncRealtimeUrl: process.env.APPSYNC_REALTIME_URL || null,
		hindsightEndpoint: process.env.HINDSIGHT_ENDPOINT || null,
		agentcoreStatus: process.env.AGENTCORE_FUNCTION_NAME ? "managed (always on)" : "not deployed",
		hindsightEnabled: !!process.env.HINDSIGHT_ENDPOINT,
		managedMemoryEnabled: !!process.env.AGENTCORE_MEMORY_ID,
	};
};
