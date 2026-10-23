import type { HttpRequest, HttpResponse } from "../client/types.ts";
import type { OpenCloudError } from "../errors/base.ts";
import { UnexpectedResponseError } from "../errors/unexpected-response.ts";
import { pickDiagnosticHeaders } from "./http/diagnostics.ts";

const TRAILING_SLASH = /\/$/;

/** The request a parser's input answered, and the response it parsed. */
export interface ParsedExchange {
	/** Base URL the request path was sent against. */
	readonly baseUrl: string;
	/** The request that was sent. */
	readonly request: HttpRequest;
	/** The successful response the parser rejected. */
	readonly response: HttpResponse;
}

/**
 * Rebuilds a parser's {@link UnexpectedResponseError} with the request it
 * answered. A parser sees only the response, so the call site adds the method,
 * the full URL, and the allowlisted response headers. Any other error is
 * returned unchanged.
 *
 * @param err - The parser's error.
 * @param exchange - The base URL, the request sent, and the response parsed.
 * @returns `err`, carrying the request context when it is an unexpected
 *   response.
 */
export function withRequestContext(
	err: OpenCloudError,
	{ baseUrl, request, response }: ParsedExchange,
): OpenCloudError {
	if (!(err instanceof UnexpectedResponseError)) {
		return err;
	}

	return new UnexpectedResponseError(err.message, {
		cause: err.cause,
		code: err.code,
		details: err.details,
		method: request.method,
		responseHeaders: pickDiagnosticHeaders({ ...response.headers }),
		statusCode: err.statusCode,
		url: `${baseUrl.replace(TRAILING_SLASH, "")}${request.url}`,
	});
}
