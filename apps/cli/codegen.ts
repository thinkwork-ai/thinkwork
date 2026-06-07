import type { CodegenConfig } from "@graphql-codegen/cli";

// Mirrors the web app codegen shape — same schema, same client preset. Keeping
// the configs parallel means operation shapes copy/paste cleanly between the
// web UI and the CLI during Phase 1+ implementations.
const config: CodegenConfig = {
  schema: [
    "../../packages/database-pg/graphql/schema.graphql",
    "../../packages/database-pg/graphql/types/*.graphql",
  ],
  documents: "src/**/*.{ts,tsx}",
  generates: {
    "src/gql/": {
      preset: "client",
    },
  },
  ignoreNoDocuments: true,
};

export default config;
