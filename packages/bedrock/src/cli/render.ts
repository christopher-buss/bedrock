import { cancel, intro, log, outro } from "@clack/prompts";

import type { ConfigError } from "../core/config-error.ts";
import type { StateError } from "../core/state.ts";
import type { ApplyError } from "../shell/apply-ops.ts";
import type { BuildDesiredError } from "../shell/build-desired.ts";
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
 * `stateWriteFailed`) surface the inner cause's actionable detail (file path,
 * resource key, parser message, HTTP failure, validator issue) so the reader
 * does not have to inspect the full cause to act.
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

function applyCauseDetail(cause: ApplyError): string {
	if (cause.kind === "updateUnsupported") {
		return "update not supported";
	}

	return cause.cause.message;
}

function buildDesiredDetail(cause: BuildDesiredError): string {
	return `(${cause.filePath}): ${cause.reason}`;
}

function configErrorDetail(err: ConfigError): string {
	switch (err.kind) {
		case "configFunctionFailed": {
			return `${err.sourceFile}: config function threw: ${err.message}`;
		}
		case "fileNotFound": {
			return `no bedrock config under ${err.searchedFrom}`;
		}
		case "luauRuntimeMissing": {
			return `${err.sourceFile}: ${err.hint}`;
		}
		case "parseFailed": {
			return `${err.sourceFile}: ${err.message}`;
		}
		case "validationFailed": {
			const first = err.issues[0];
			return first === undefined
				? `${err.sourceFile}: invalid`
				: `${err.sourceFile}: ${first.path.join(".")} ${first.message}`;
		}
	}
}

function stateErrorDetail(cause: StateError): string {
	return `(${cause.file}): ${cause.reason}`;
}

/* eslint-disable-next-line max-lines-per-function -- single exhaustive switch over every DeployError variant is clearer than splitting into a wrapped-vs-unwrapped predicate plus a parallel prefix table. */
function deployErrorMessage(err: DeployError): string {
	switch (err.kind) {
		case "applyFailed": {
			return `apply failed for '${err.cause.key}': ${applyCauseDetail(err.cause)}`;
		}
		case "buildDesiredFailed": {
			return `build desired state failed for '${err.cause.key}' ${buildDesiredDetail(err.cause)}`;
		}
		case "configLoadFailed": {
			return `config load failed: ${configErrorDetail(err.cause)}`;
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
			return `state read failed ${stateErrorDetail(err.cause)}`;
		}
		case "stateWriteFailed": {
			return `state write failed ${stateErrorDetail(err.cause)}`;
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
