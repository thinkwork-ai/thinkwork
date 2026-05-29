import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: [
    "../../packages/database-pg/graphql/schema.graphql",
    "../../packages/database-pg/graphql/types/*.graphql",
  ],
  // Scope codegen to typed `graphql()` operations only. The legacy
  // `graphql-queries.ts` uses untyped `@urql/core` `gql` tags (some stale
  // against the current schema) and is being migrated incrementally — exclude
  // it so codegen validates only the new typed operations.
  documents: ["src/**/*.{ts,tsx}", "!src/lib/graphql-queries.ts"],
  generates: {
    "src/gql/": {
      preset: "client",
    },
  },
  ignoreNoDocuments: true,
};

export default config;
