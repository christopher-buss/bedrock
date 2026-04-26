import { cancel, intro, log, outro } from "@clack/prompts";

import type { DeployError } from "../shell/deploy.ts";
import type { ParseOptionsError } from "./parse-options.ts";

/**
 * Output port the CLI renders through. Mirrors the subset of `@clack/prompts`
 * the bedrock CLI uses today; tests inject a fake to assert what was rendered.
 */
export interface ClackPort {
	/** End an interactive flow with a cancellation marker. */
	cancel(message: string): void;
	/** Open a framed section with a title (used for command intros). */
	intro(message: string): void;
	/** Render a single error line inside an open frame. */
	logError(message: string): void;
	/** Render a single neutral line inside an open frame. */
	logMessage(message: string): void;
	/** Render a single success line inside an open frame. */
	logSuccess(message: string): void;
	/** Close the current framed section with a final message. */
	outro(message: string): void;
}

/**
 * Render a `DeployError` to the supplied `ClackPort` as a single error line.
 * Each variant produces a distinct, terse diagnostic; wrapped variants
 * (`applyFailed`, `buildDesiredFailed`, `configLoadFailed`, `stateReadFailed`,
 * `stateWriteFailed`) include the inner cause's `kind` so the reader can
 * distinguish the failing stage without inspecting the full cause.
 * @param err - The deploy error to describe.
 * @param port - The output port the diagnostic is written to.
 */
export function renderDeployError(err: DeployError, port: ClackPort): void {
	port.logError(deployErrorMessage(err));
}

/**
 * Render a `ParseOptionsError` to the supplied `ClackPort` as a single
 * error line. Each variant names the offending flag so the diagnostic
 * pinpoints what the caller needs to change.
 * @param err - The parse error to describe.
 * @param port - The output port the diagnostic is written to.
 */
export function renderParseError(err: ParseOptionsError, port: ClackPort): void {
	port.logError(parseErrorMessage(err));
}

/**
 * Construct a `ClackPort` whose methods delegate to `@clack/prompts`. The
 * resulting port writes to `process.stdout` via clack's defaults.
 * @returns A port whose six methods each invoke the matching clack helper.
 */
export function createClackPort(): ClackPort {
	return {
		cancel: (message) => {
			cancel(message);
		},
		intro: (message) => {
			intro(message);
		},
		logError: (message) => {
			log.error(message);
		},
		logMessage: (message) => {
			log.message(message);
		},
		logSuccess: (message) => {
			log.success(message);
		},
		outro: (message) => {
			outro(message);
		},
	};
}

/* eslint-disable-next-line max-lines-per-function -- single exhaustive switch over every DeployError variant is clearer than splitting into a wrapped-vs-unwrapped predicate plus a parallel prefix table. */
function deployErrorMessage(err: DeployError): string {
	switch (err.kind) {
		case "applyFailed": {
			return `apply failed (${err.cause.kind})`;
		}
		case "buildDesiredFailed": {
			return `build desired state failed (${err.cause.kind})`;
		}
		case "configLoadFailed": {
			return `config load failed (${err.cause.kind})`;
		}
		case "incompletePlaceEntry": {
			return `place '${err.key}' is missing '${err.missingField}' under environment '${err.environment}'`;
		}
		case "missingCredential": {
			return `missing credential: environment variable ${err.variable} is not set`;
		}
		case "registryConfigMissing": {
			return `registry config missing '${err.missing}' (${err.hint})`;
		}
		case "stateNotConfigured": {
			return `state not configured for environment '${err.environment}'`;
		}
		case "stateReadFailed": {
			return `state read failed (${err.cause.kind})`;
		}
		case "stateWriteFailed": {
			return `state write failed (${err.cause.kind})`;
		}
		case "unknownEnvironment": {
			return `unknown environment '${err.environment}' (declared: ${err.declared.join(", ")})`;
		}
		case "unsupportedBackend": {
			return `unsupported state backend '${err.backend}' (${err.hint})`;
		}
	}
}

function parseErrorMessage(err: ParseOptionsError): string {
	switch (err.kind) {
		case "invalidValue": {
			return `invalid value for flag '--${err.flag}' (expected a string)`;
		}
		case "missingRequired": {
			return `missing required flag --${err.flag}`;
		}
		case "unknownFlag": {
			return `unknown flag '--${err.flag}'`;
		}
	}
}
