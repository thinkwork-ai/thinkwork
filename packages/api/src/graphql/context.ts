/**
 * GraphQL request context — created fresh per request.
 *
 * Provides auth info, database connection, DataLoaders, and request headers
 * to all resolver functions.
 */

import type { YogaInitialContext } from "graphql-yoga";
import { authenticate, type AuthResult } from "../lib/cognito-auth.js";
import { db } from "./utils.js";
import { createLoaders, type DataLoaders } from "./dataloaders.js";

export interface GraphQLContext {
	auth: AuthResult;
	db: typeof db;
	loaders: DataLoaders;
	headers: Record<string, string>;
}

export async function createContext(
	yogaCtx: YogaInitialContext,
): Promise<GraphQLContext> {
	const headers: Record<string, string> = {};
	yogaCtx.request.headers.forEach((value, key) => {
		headers[key] = value;
	});

	const auth = await authenticate(headers);
	if (!auth) {
		throw new Error("Unauthorized");
	}

	return { auth, db, loaders: createLoaders(), headers };
}
