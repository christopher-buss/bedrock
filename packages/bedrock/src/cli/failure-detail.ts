import { ApiError, NetworkError, type OpenCloudError, PermissionError } from "@bedrock-rbx/ocale";

import { boundDiagnostic } from "../core/bound-diagnostic.ts";
import { safeStringify } from "../core/error-chain.ts";
import { findTransportCode } from "../core/transport-code.ts";
import type { ApplyError } from "../shell/apply-ops.ts";

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

function apiErrorHead(err: ApiError): string {
	if (err.gatewaySummary !== undefined) {
		return `${err.message} from gateway ("${err.gatewaySummary}")`;
	}

	// Dump the body only when the status line carries no human message (a bare
	// `HTTP 400`); when the message was folded into `err.message` the body is
	// redundant.
	if (err.details !== undefined && !err.message.includes(": ")) {
		return `${err.message} (body: ${renderResponseBody(err.details)})`;
	}

	return err.message;
}

function gatewayTrailer(err: ApiError): string {
	return err.gatewaySummary === undefined ? "" : " — request rejected before reaching Open Cloud";
}

function formatElapsed(elapsedMs: number | undefined): string {
	return elapsedMs === undefined ? "" : ` after ${(elapsedMs / 1000).toFixed(1)}s`;
}

function formatHeaderSummary(headers: Record<string, string> | undefined): string {
	if (headers === undefined) {
		return "";
	}

	const pairs = Object.entries(headers).map(([name, value]) => `${name}=${value}`);
	if (pairs.length === 0) {
		return "";
	}

	return ` (${pairs.join(", ")})`;
}

function formatCallTarget(method: string | undefined, url: string | undefined): string {
	return method !== undefined && url !== undefined ? ` on ${method} ${url}` : "";
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

function permissionDetail(err: PermissionError): string {
	const isPlural = err.requiredScopes.length > 1;
	const label = isPlural ? "scopes" : "scope";
	const pronoun = isPlural ? "them" : "it";
	const scopeList = err.requiredScopes.map((scope) => `'${scope}'`).join(", ");
	return `${err.message} on ${err.operationKey}: missing required ${label} ${scopeList}. Grant ${pronoun} on the API key at https://create.roblox.com/credentials`;
}
