import { boundDiagnostic } from "../core/bound-diagnostic.ts";
import type { StateError } from "../core/state.ts";
import { findTransportCode } from "../core/transport-code.ts";

/** Inputs for {@link mapHttpErrorAsync}. */
export interface HttpFailure {
	/**
	 * File label (`gist:<id>/state.<env>.json`) the failure is attributed to.
	 */
	readonly file: string;
	/** Gist id, echoed into the not-found reason. */
	readonly gistId: string;
	/** The non-ok response to map. */
	readonly response: Response;
}

/**
 * Read a failed response's body for the failure reason, bounded and formatted
 * as ` (body: …)`. GitHub's error bodies carry the actionable cause (a
 * validation message, a secret-scanning block) that the status code alone
 * hides. An empty or unreadable body yields an empty string so the reason
 * keeps its bare status form.
 *
 * @param response - The non-ok `Response` whose body is read.
 * @returns The formatted suffix, or `""` when no body is available.
 */
export async function errorBodyDetailAsync(response: Response): Promise<string> {
	let text: string;
	try {
		text = await response.text();
	} catch {
		return "";
	}

	const trimmed = text.trim();
	if (trimmed === "") {
		return "";
	}

	return ` (body: ${boundDiagnostic(trimmed)})`;
}

/**
 * Whether a response's headers say GitHub throttled the request: either it
 * named a wait, or it reported the budget spent.
 *
 * @param headers - Headers of the response to inspect.
 * @returns `true` when the response is a throttle rather than a refusal.
 */
export function isRateLimited(headers: Headers): boolean {
	return headers.has("retry-after") || headers.get("x-ratelimit-remaining") === "0";
}

/**
 * Map a non-ok GitHub response onto a `StateError` with an actionable reason:
 * a named cause for 404 (bad gist id), rate limiting, and auth failures, and
 * the (bounded) error body GitHub returned for everything the status code
 * alone does not explain.
 *
 * A missing gist and a refused credential are conditions any **Backend**
 * has, so they take the backend-neutral `stateNotFound` and
 * `stateAccessDenied` arms and read the same as any other backend's.
 *
 * @param failure - The failing file label, gist id, and raw `Response`.
 * @returns The mapped `StateError`.
 */
export async function mapHttpErrorAsync({
	file,
	gistId,
	response,
}: HttpFailure): Promise<StateError> {
	const { headers, status } = response;
	if (status === 404) {
		return { file, kind: "stateNotFound", reason: `gist ${gistId} not found: check gistId` };
	}

	if (status === 403 && isRateLimited(headers)) {
		return { file, kind: "stateError", reason: rateLimitReason(status, headers) };
	}

	if (status === 401 || status === 403) {
		return {
			file,
			kind: "stateAccessDenied",
			reason: `auth failed (${status}): check token scopes${await errorBodyDetailAsync(response)}`,
		};
	}

	return {
		file,
		kind: "stateError",
		reason: `github returned ${status}${await errorBodyDetailAsync(response)}`,
	};
}

/**
 * Map a thrown fetch error onto a `StateError`, naming the node-style
 * transport code (for example `ECONNRESET`) from the error's `cause` chain so
 * a connection reset reads differently from a DNS failure.
 *
 * @param error - The value the fetch call threw.
 * @param file - The file label the failure is attributed to.
 * @returns The mapped `StateError`.
 */
export function networkError(error: unknown, file: string): StateError {
	const message = error instanceof Error ? error.message : String(error);
	const code = findTransportCode(error);
	const suffix = code === undefined ? "" : ` (${code})`;
	return { file, kind: "stateError", reason: `network error: ${message}${suffix}` };
}

function rateLimitReason(status: number, headers: Headers): string {
	const retryAfter = headers.get("retry-after");
	if (retryAfter !== null) {
		return `rate limited (${status}): retry after ${retryAfter}s`;
	}

	return `rate limited (${status})`;
}
