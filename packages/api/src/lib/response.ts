import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
	"Access-Control-Allow-Headers": "Content-Type, Authorization, x-tenant-id, x-api-key",
	"Access-Control-Max-Age": "3600",
};

/** Returns true + sends 204 if this is an OPTIONS preflight. Use at top of handler. */
export function handleCors(event: APIGatewayProxyEventV2): APIGatewayProxyStructuredResultV2 | null {
	if (event.requestContext.http.method === "OPTIONS") {
		return cors();
	}
	return null;
}

export function cors(): APIGatewayProxyStructuredResultV2 {
	return {
		statusCode: 204,
		headers: CORS_HEADERS,
		body: "",
	};
}

export function json(
	body: unknown,
	statusCode = 200,
): APIGatewayProxyStructuredResultV2 {
	return {
		statusCode,
		headers: { "Content-Type": "application/json", ...CORS_HEADERS },
		body: JSON.stringify(body),
	};
}

export function error(
	message: string,
	statusCode = 400,
): APIGatewayProxyStructuredResultV2 {
	return json({ error: message }, statusCode);
}

export function notFound(
	message = "Not found",
): APIGatewayProxyStructuredResultV2 {
	return error(message, 404);
}

export function unauthorized(
	message = "Unauthorized",
): APIGatewayProxyStructuredResultV2 {
	return error(message, 401);
}

export function forbidden(
	message = "Forbidden",
): APIGatewayProxyStructuredResultV2 {
	return error(message, 403);
}

export function paginated<T>(
	items: T[],
	cursor: string | null,
	hasMore: boolean,
): APIGatewayProxyStructuredResultV2 {
	return json({ items, cursor, hasMore });
}
