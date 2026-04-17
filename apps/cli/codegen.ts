import type { CodegenConfig } from "@graphql-codegen/cli";

// Mirrors apps/admin/codegen.ts — same schema, same client preset. Keeping the
// two configs parallel means operation shapes copy/paste cleanly between the
// admin UI and the CLI during Phase 1+ implementations.
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
