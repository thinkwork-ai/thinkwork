/**
 * graphql-yoga server setup.
 *
 * Loads the .graphql schema files, defines custom AppSync-compatible scalars,
 * and builds the executable schema with resolver maps.
 */

import { createYoga } from "graphql-yoga";
import { useDepthLimit } from "@envelop/depth-limit";
import { useDisableIntrospection } from "@graphql-yoga/plugin-disable-introspection";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { GraphQLScalarType, Kind } from "graphql";
import { createContext, type GraphQLContext } from "./context.js";
import { queryResolvers, mutationResolvers, typeResolvers } from "./resolvers/index.js";

// ---------------------------------------------------------------------------
// Schema loading — reuse the same .graphql files as AppSync and codegen
// ---------------------------------------------------------------------------

// AppSync uses @aws_subscribe in the subscription schema. Declare it so
// graphql-js validation passes — it has no runtime effect in graphql-yoga.
const APPSYNC_DIRECTIVE_DEFS = `
directive @aws_subscribe(mutations: [String!]!) on FIELD_DEFINITION
`;

function loadSchemaFiles(): string {
	const graphqlDir = join(process.cwd(), "packages", "database-pg", "graphql");
	const typesDir = join(graphqlDir, "types");

	const baseSchema = readFileSync(join(graphqlDir, "schema.graphql"), "utf-8");
	const typeFileContents = readdirSync(typesDir)
		.filter((f) => f.endsWith(".graphql"))
		.sort()
		.map((f) => readFileSync(join(typesDir, f), "utf-8"));

	return [APPSYNC_DIRECTIVE_DEFS, baseSchema, ...typeFileContents].join("\n\n");
}

// ---------------------------------------------------------------------------
// Custom scalars — AppSync uses AWSDateTime, AWSJSON, AWSURL
// ---------------------------------------------------------------------------

const AWSDateTime = new GraphQLScalarType({
	name: "AWSDateTime",
	description: "ISO 8601 date-time string (e.g. 2026-03-21T10:00:00.000Z)",
	serialize: (value) => (value instanceof Date ? value.toISOString() : value),
	parseValue: (value) => (typeof value === "string" ? value : String(value)),
	parseLiteral: (ast) => (ast.kind === Kind.STRING ? ast.value : null),
});

const AWSJSON = new GraphQLScalarType({
	name: "AWSJSON",
	description: "Arbitrary JSON value",
	serialize: (value) => {
		if (typeof value === "string") {
			try { return JSON.parse(value); } catch { return value; }
		}
		return value;
	},
	parseValue: (value) => value,
	parseLiteral: (ast) => {
		if (ast.kind === Kind.STRING) {
			try { return JSON.parse(ast.value); } catch { return ast.value; }
		}
		return null;
	},
});

const AWSURL = new GraphQLScalarType({
	name: "AWSURL",
	description: "URL string",
	serialize: (value) => value,
	parseValue: (value) => value,
	parseLiteral: (ast) => (ast.kind === Kind.STRING ? ast.value : null),
});

// ---------------------------------------------------------------------------
// Build executable schema
// ---------------------------------------------------------------------------

const typeDefs = loadSchemaFiles();

const resolvers = {
	// Custom scalars
	AWSDateTime,
	AWSJSON,
	AWSURL,
	// Root resolvers
	Query: queryResolvers,
	Mutation: mutationResolvers,
	// Type resolvers (Ticket sub-fields, etc.)
	...typeResolvers,
};

export const schema = makeExecutableSchema({ typeDefs, resolvers });

// ---------------------------------------------------------------------------
// Yoga instance
// ---------------------------------------------------------------------------

const IS_PROD = process.env.STAGE === "main";

export const yoga = createYoga<GraphQLContext>({
	schema,
	context: createContext,
	plugins: [
		// Reject queries deeper than 7 levels
		useDepthLimit({ maxDepth: 7 }),
		// Disable introspection in production (prevents schema discovery)
		...(IS_PROD ? [useDisableIntrospection()] : []),
	],
	// GraphiQL explorer in dev, disabled in prod
	graphiql: !IS_PROD,
	// Mask internal error details in production
	maskedErrors: IS_PROD,
	// Disable landing page in production
	landingPage: !IS_PROD,
});
