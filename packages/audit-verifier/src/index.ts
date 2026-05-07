/**
 * @thinkwork/audit-verifier — programmatic API entry point.
 *
 * Independent re-implementation of the RFC 6962 Merkle algorithm the
 * compliance-anchor Lambda writes to S3. Re-derives every claim from
 * scratch — does NOT import the writer. A SOC2 auditor (or anyone with
 * read access to the bucket) can `npm install -g @thinkwork/audit-verifier`
 * and verify our audit evidence without trusting the auditee's monorepo.
 *
 * See README.md for the threat model + invocation examples.
 */

export {
	EMPTY_TREE_ROOT,
	buildMerkleTree,
	computeLeafHash,
	verifyProofPath,
	type ProofStep,
} from "./merkle";

export {
	AnchorSchemaV1,
	SliceSchemaV1,
	SchemaVersionUnsupportedError,
	parseAnchor,
	parseSlice,
	type AnchorV1,
	type SliceV1,
} from "./schema";

export {
	verifyBucket,
	type VerifyOptions,
	type VerificationReport,
	type MerkleMismatch,
	type ParseFailure,
	type SchemaDrift,
} from "./verify";

export type { RetentionFailure } from "./retention";
export type { ChainFailure } from "./chain";
