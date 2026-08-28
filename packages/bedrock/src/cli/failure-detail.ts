import { ApiError, NetworkError, type OpenCloudError, PermissionError } from "@bedrock-rbx/ocale";

import { boundDiagnostic } from "../core/bound-diagnostic.ts";
import { safeStringify } from "../core/error-chain.ts";
import { findTransportCode } from "../core/transport-code.ts";
import type { ApplyError } from "../shell/apply-ops.ts";

const CREDENTIALS_URL = "https://create.roblox.com/credentials";

/**
 * Describes the {@link OpenCloudError} behind a driver failure for one
 * diagnostic line. A {@link NetworkError} otherwise collapses every transport
 * failure into the same static `"Network request failed"`; this expands it with
 * the node-style transport `code` (or the underlying cause's message) and the
 * failing `METHOD url`, so an intermittent connection reset reads differently
 * from a DNS failure without inspecting the cause by hand. An {@link ApiError}
 * gains the same `on METHOD url after Ns` request context when the transport
 * captured it: an HTML load-balancer error page is summarized (never dumped
 * whole), a bare status whose body carried no extractable `message` still
 * appends the bounded body, and any captured escalation headers are rendered
 * compactly. Every other error surfaces its own `message` unchanged.
 *
 * @param err - The Open Cloud error carried on the failing apply op.
 * @returns A single-line, human-readable failure detail.
 */
export function describeDriverCause(err: OpenCloudError): string {
	if (err instanceof NetworkError) {
		return describeNetworkError(err);
	}

	if (err instanceof ApiError) {
		return describeApiError(err);
	}

	return err.message;
}

/**
 * Describes one failing apply op for a single diagnostic line. Shared by the
 * terminal summary (`renderDeployError`) and the live per-op progress line so
 * both surfaces show identical detail: permission failures carry the
 * grant-scope guidance, driver failures surface the transport/API detail
 * (including the response body), and unexpected throws print their cause
 * chain.
 *
 * @param cause - The apply error carried on the failing op.
 * @returns A single-line, human-readable failure detail.
 */
export function applyCauseDetail(cause: ApplyError): string {
	switch (cause.kind) {
		case "driverFailure": {
			if (cause.cause instanceof PermissionError) {
				return permissionDetail(cause.cause);
			}

			return describeDriverCause(cause.cause);
		}
		case "unexpectedThrow": {
			return `unexpected error: ${safeStringify(cause.cause)}`;
		}
		case "updateUnsupported": {
			return "update not supported";
		}
	}
}

function renderResponseBody(details: JSONValue): string {
	return boundDiagnostic(typeof details === "string" ? details : JSON.stringify(details));
}

function hasFoldedApiMessage(message: string): boolean {
	// The transport folds an extracted API message into `HTTP <status>: <msg>`;
	// when it did, the body is redundant and is not re-dumped. A bare `HTTP 400`,
	// an `HTTP 418 (code X)`, or a non-status message (e.g. a parse failure) has
	// no colon after the status and still surfaces its body. This mirrors ocale's
	// format; the two packages version together, so it stays in sync.
	return message.startsWith("HTTP ") && message.includes(": ");
}

function apiErrorHead(err: ApiError): string {
	if (err.gatewaySummary !== undefined) {
		return `${err.message} from gateway ("${boundDiagnostic(err.gatewaySummary)}")`;
	}

	if (err.details !== undefined && !hasFoldedApiMessage(err.message)) {
		return `${err.message} (body: ${renderResponseBody(err.details)})`;
	}

	return err.message;
}

function gatewayTrailer(err: ApiError): string {
	return err.gatewaySummary === undefined ? "" : " — request rejected before reaching Open Cloud";
}

function elapsedPhrase(elapsedMs: number | undefined): string | undefined {
	return elapsedMs === undefined ? undefined : `after ${(elapsedMs / 1000).toFixed(1)}s`;
}

function formatElapsed(elapsedMs: number | undefined): string {
	const phrase = elapsedPhrase(elapsedMs);
	return phrase === undefined ? "" : ` ${phrase}`;
}

function headerPhrase(headers: Readonly<Record<string, string>> | undefined): string | undefined {
	const pairs = Object.entries(headers ?? {}).map(([name, value]) => `${name}=${value}`);
	return pairs.length === 0 ? undefined : boundDiagnostic(pairs.join(", "));
}

function formatHeaderSummary(headers: Readonly<Record<string, string>> | undefined): string {
	const phrase = headerPhrase(headers);
	return phrase === undefined ? "" : ` (${phrase})`;
}

function callTarget(method: string | undefined, url: string | undefined): string | undefined {
	return method !== undefined && url !== undefined ? `${method} ${url}` : undefined;
}

function formatCallTarget(method: string | undefined, url: string | undefined): string {
	const target = callTarget(method, url);
	return target === undefined ? "" : ` on ${target}`;
}

function describeApiError(err: ApiError): string {
	return `${apiErrorHead(err)}${formatCallTarget(err.method, err.url)}${formatElapsed(err.elapsedMs)}${gatewayTrailer(err)}${formatHeaderSummary(err.responseHeaders)}`;
}

function describeNetworkError(err: NetworkError): string {
	const reason =
		findTransportCode(err) ?? (err.cause instanceof Error ? err.cause.message : undefined);
	const because = reason === undefined ? "" : ` (${reason})`;
	return `${err.message}${because}${formatCallTarget(err.method, err.url)}`;
}

function callPhrase(err: ApiError): string | undefined {
	const parts = [callTarget(err.method, err.url), elapsedPhrase(err.elapsedMs)].filter(
		(part) => part !== undefined,
	);
	return parts.length === 0 ? undefined : parts.join(" ");
}

function formatCallContext(err: ApiError): string {
	const parts = [callPhrase(err), headerPhrase(err.responseHeaders)].filter(
		(part) => part !== undefined,
	);
	return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}

function permissionDetail(err: PermissionError): string {
	const isPlural = err.requiredScopes.length > 1;
	const label = isPlural ? "scopes" : "scope";
	const scopeList = err.requiredScopes.map((scope) => `'${scope}'`).join(", ");
	const head = `${apiErrorHead(err)} on ${err.operationKey}${formatCallContext(err)}: `;

	// Only a 403 pins the failure on a missing scope; a 401 is ambiguous.
	if (err.statusCode !== 403) {
		return `${head}the API key was rejected. Check that it is enabled, has not expired, and grants ${label} ${scopeList} for this experience at ${CREDENTIALS_URL}`;
	}

	const pronoun = isPlural ? "them" : "it";
	return `${head}missing required ${label} ${scopeList}. Grant ${pronoun} on the API key at ${CREDENTIALS_URL}`;
}
