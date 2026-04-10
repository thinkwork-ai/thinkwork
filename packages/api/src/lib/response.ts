import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

export function json(
	body: unknown,
	statusCode = 200,
): APIGatewayProxyStructuredResultV2 {
	return {
		statusCode,
		headers: { "Content-Type": "application/json" },
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
