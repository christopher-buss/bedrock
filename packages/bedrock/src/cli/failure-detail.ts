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
 * carrying a response body appends it (bounded) so a status whose body had no
 * extractable `message` (the bare `HTTP 400` case) stays diagnosable from
 * the log alone. Every other error surfaces its own `message` unchanged.
 *
 * @param err - The Open Cloud error carried on the failing apply op.
 * @returns A single-line, human-readable failure detail.
 */
export function describeDriverCause(err: OpenCloudError): string {
	if (err instanceof NetworkError) {
		return describeNetworkError(err);
	}

	if (err instanceof ApiError && err.details !== undefined) {
		return `${err.message} (body: ${renderResponseBody(err.details)})`;
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

function describeNetworkError(err: NetworkError): string {
	const reason =
		findTransportCode(err) ?? (err.cause instanceof Error ? err.cause.message : undefined);
	const because = reason === undefined ? "" : ` (${reason})`;
	const target =
		err.method !== undefined && err.url !== undefined ? ` on ${err.method} ${err.url}` : "";
	return `${err.message}${because}${target}`;
}

function renderResponseBody(details: JSONValue): string {
	return boundDiagnostic(typeof details === "string" ? details : JSON.stringify(details));
}

function permissionDetail(err: PermissionError): string {
	const isPlural = err.requiredScopes.length > 1;
	const label = isPlural ? "scopes" : "scope";
	const pronoun = isPlural ? "them" : "it";
	const scopeList = err.requiredScopes.map((scope) => `'${scope}'`).join(", ");
	return `${err.message} on ${err.operationKey}: missing required ${label} ${scopeList}. Grant ${pronoun} on the API key at https://create.roblox.com/credentials`;
}
