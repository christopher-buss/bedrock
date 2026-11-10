import { safeStringify } from "../core/error-chain.ts";
import type { DeployError } from "../shell/deploy.ts";
import {
	configErrorMessage,
	type ConfigFailure,
	isConfigFailure,
} from "./config-error-messages.ts";

type PreflightFailure =
	| ConfigFailure
	| Extract<DeployError, { kind: "liveCheckFailed" | "outOfBandEdits" }>;

/**
 * Classify errors reported before any operation.
 * @param err - Deployment failure.
 * @returns Whether the preflight renderer handles the failure.
 */
export function isPreflightFailure(err: DeployError): err is PreflightFailure {
	return isConfigFailure(err) || err.kind === "liveCheckFailed" || err.kind === "outOfBandEdits";
}

/**
 * Describe a preflight refusal, including every audited field and value.
 * @param err - The failure to describe.
 * @returns A diagnostic line.
 */
export function preflightErrorMessage(err: PreflightFailure): string {
	if (err.kind === "liveCheckFailed") {
		return `live check failed for ${err.resourceKind}: ${err.cause.message}`;
	}

	if (err.kind === "outOfBandEdits") {
		return `out-of-band edits detected; refusing before any operation: ${err.edits
			.map((edit) => {
				return `${edit.kind}:${edit.key} (${edit.fields
					.map(({ current, field, live }) => {
						return `${field}: ${safeStringify(current)} -> ${safeStringify(live)}`;
					})
					.join(", ")})`;
			})
			.join("; ")}`;
	}

	return configErrorMessage(err);
}
