import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: [
    "../../packages/database-pg/graphql/schema.graphql",
    "../../packages/database-pg/graphql/types/*.graphql",
  ],
  documents: [
    "lib/**/*.ts",
    "app/**/*.{ts,tsx}",
    "hooks/**/*.ts",
    "components/**/*.tsx",
  ],
  generates: {
    "lib/gql/": {
      preset: "client",
    },
  },
  ignoreNoDocuments: true,
};

export default config;
