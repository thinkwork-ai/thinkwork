import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: [
    "../../packages/database-pg/graphql/schema.graphql",
    "../../packages/database-pg/graphql/types/*.graphql",
  ],
  documents: [
    "src/**/*.{ts,tsx}",
    "!src/extensions/configured-external-extension.tsx",
  ],
  generates: {
    "src/gql/": {
      preset: "client",
    },
  },
  ignoreNoDocuments: true,
};

export default config;
