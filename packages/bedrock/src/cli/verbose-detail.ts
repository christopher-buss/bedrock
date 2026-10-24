import { OpenCloudError } from "@bedrock-rbx/ocale";

import { safeStringify } from "../core/error-chain.ts";
import { describeDriverCause } from "./failure-detail.ts";

// Bounds the `cause` walk so a self-referential chain still terminates.
const MAX_CAUSE_DEPTH = 5;

const UNPRINTABLE = "<unprintable cause>";

const UNREADABLE = Symbol("unreadable cause");

/**
 * Lists the diagnostics `--verbose` prints after a failure's normal line:
 * the earlier retry attempts of every {@link OpenCloudError} on the `cause`
 * chain, then each `Error`'s stack, walking `cause` through plain failure
 * records (a `DeployError`, an `ApplyError`) as well as `Error`s. A value with
 * no `Error` on its chain yields nothing. Never throws, however hostile the
 * value.
 *
 * @param value - The failure, as rendered by the normal output.
 * @returns One diagnostic block per entry, possibly spanning several lines.
 */
export function verboseDetail(value: unknown): ReadonlyArray<string> {
	return causeChain(value).flatMap((node, index) => describeNode(node, index));
}

function readCause(value: unknown): unknown {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}

	return Reflect.get(value, "cause");
}

function readCauseSafely(value: unknown): unknown {
	try {
		return readCause(value);
	} catch {
		return UNREADABLE;
	}
}

function causeChain(value: unknown, remaining = MAX_CAUSE_DEPTH): ReadonlyArray<unknown> {
	if (value === undefined || remaining === 0) {
		return [];
	}

	const cause = readCauseSafely(value);
	return cause === UNREADABLE
		? [value, UNPRINTABLE]
		: [value, ...causeChain(cause, remaining - 1)];
}

function attemptLines(error: Error): ReadonlyArray<string> {
	if (!(error instanceof OpenCloudError)) {
		return [];
	}

	const attempts = error.previousAttempts;
	return attempts.map((attempt, index) => {
		return `attempt ${String(index + 1)} of ${String(attempts.length + 1)} failed: ${describeDriverCause(attempt)}`;
	});
}

function errorStack(error: Error): string {
	return typeof error.stack === "string" ? error.stack : `${error.name}: ${error.message}`;
}

function describeError(error: Error, label: string): ReadonlyArray<string> {
	try {
		return [...attemptLines(error), `${label}${errorStack(error)}`];
	} catch {
		return [`caused by: ${UNPRINTABLE}`];
	}
}

function describeNode(node: unknown, index: number): ReadonlyArray<string> {
	const isRoot = index === 0;
	if (node instanceof Error) {
		return describeError(node, isRoot ? "" : "caused by: ");
	}

	// The root already printed on the failure line, and plain failure records
	// are walked through for their `cause`, so only a primitive cause prints.
	const isPrimitiveCause = !isRoot && typeof node !== "object";
	return isPrimitiveCause ? [`caused by: ${safeStringify(node)}`] : [];
}
