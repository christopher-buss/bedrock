import { ApiError, NetworkError, type OpenCloudError, PermissionError } from "@bedrock-rbx/ocale";

import type { ApplyError } from "../shell/apply-ops.ts";

// Walks an error's `cause` chain for the first node-style string `code` (for
// example `"ECONNRESET"`). A fetch transport reset surfaces as
// `NetworkError → TypeError("fetch failed") → OS Error{code}`, so the code sits
// several links down. Capped to avoid looping on a self-referential chain.
// ocale computes this internally but does not export it; the bounded walk is
// reproduced here so the renderer can name the transport failure.
const MAX_CAUSE_DEPTH = 5;

// Bounds the response body appended to a failure line so a large JSON payload
// or HTML gateway page does not swamp the diagnostic. Mirrors the transport's
// own 500-character cap on bodies it could not parse.
const MAX_RENDERED_BODY_LENGTH = 500;

/**
 * Describes the {@link OpenCloudError} behind a driver failure for one
 * diagnostic line. A {@link NetworkError} otherwise collapses every transport
 * failure into the same static `"Network request failed"`; this expands it with
 * the node-style transport `code` (or the underlying cause's message) and the
 * failing `METHOD url`, so an intermittent connection reset reads differently
 * from a DNS failure without inspecting the cause by hand. An {@link ApiError}
 * carrying a response body appends it (bounded) so a status whose body had no
 * extractable `message` — the bare `HTTP 400` case — stays diagnosable from
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
 * Coerces an arbitrary thrown value to a one-line string without ever
 * throwing itself. Errors render as their message followed by the messages of
 * their `cause` chain (bounded), so a wrapped throw keeps its underlying
 * reason on the diagnostic line.
 *
 * @param value - The thrown value to describe.
 * @returns A single-line rendering of the value.
 */
export function safeStringify(value: unknown): string {
	if (value instanceof Error) {
		return describeErrorChain(value);
	}

	// `String(value)` can throw on null-prototype objects or values whose
	// `toString` / `Symbol.toPrimitive` rejects coercion; fall back so the
	// renderer never crashes mid-diagnostic.
	try {
		return String(value);
	} catch {
		return "<unprintable cause>";
	}
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

function findTransportCode(error: unknown): string | undefined {
	let current: unknown = error;
	for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth += 1) {
		const code = Reflect.get(current, "code");
		if (typeof code === "string") {
			return code;
		}

		current = current.cause;
	}

	return undefined;
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
	const rendered = typeof details === "string" ? details : JSON.stringify(details);
	if (rendered.length > MAX_RENDERED_BODY_LENGTH) {
		return `${rendered.slice(0, MAX_RENDERED_BODY_LENGTH)}…`;
	}

	return rendered;
}

function describeErrorChain(error: Error): string {
	const parts = [error.message];
	let current: unknown = error.cause;
	while (parts.length < MAX_CAUSE_DEPTH && current instanceof Error) {
		parts.push(current.message);
		current = current.cause;
	}

	return parts.join("; caused by: ");
}

function permissionDetail(err: PermissionError): string {
	const isPlural = err.requiredScopes.length > 1;
	const label = isPlural ? "scopes" : "scope";
	const pronoun = isPlural ? "them" : "it";
	const scopeList = err.requiredScopes.map((scope) => `'${scope}'`).join(", ");
	return `${err.message} on ${err.operationKey}: missing required ${label} ${scopeList}. Grant ${pronoun} on the API key at https://create.roblox.com/credentials`;
}
