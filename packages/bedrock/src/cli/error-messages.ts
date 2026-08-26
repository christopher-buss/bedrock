import type { ConfigError } from "../core/config-error.ts";
import type { MigrateError } from "../core/migrate/migration-report.ts";
import type { StateError } from "../core/state.ts";
import type { BuildDesiredError } from "../shell/build-desired.ts";
import type { MissingCredentialError, UnsupportedBackendError } from "../shell/build-state-port.ts";
import type { DeployError } from "../shell/deploy.ts";
import type { CodegenError } from "../shell/run-codegen.ts";
import type { SpawnOverrideError } from "./dispatch-override.ts";
import type { ParseMigrateError } from "./parse-migrate-options.ts";
import type { ParseOptionsError } from "./parse-options.ts";

/** Inputs describing one environment's failed override spawn. */
export interface OverrideErrorRender {
	/** Environment whose override spawn produced the error. */
	readonly environment: string;
	/** The spawn-override error returned by `dispatchOverride`. */
	readonly err: SpawnOverrideError;
}

/**
 * Render a non-aggregate {@link DeployError} as a single CLI line.
 *
 * @param err - The deploy error to describe.
 * @returns The message to print.
 */
export function deployErrorMessage(err: Exclude<DeployError, { kind: "applyFailed" }>): string {
	switch (err.kind) {
		case "buildDesiredFailed":
		case "buildFailed":
		case "codegenFailed":
		case "configLoadFailed":
		case "missingBuildStep": {
			return pipelineErrorMessage(err);
		}
		case "incompletePassEntry":
		case "incompletePlaceEntry":
		case "incompleteProductEntry":
		case "incompleteUniverseEntry": {
			return incompleteEntryMessage(err);
		}
		case "missingCredential":
		case "registryConfigMissing":
		case "unknownEnvironment": {
			return configErrorMessage(err);
		}
		case "stateNotConfigured":
		case "stateReadFailed":
		case "stateWriteFailed":
		case "unsupportedBackend": {
			return stateErrorMessage(err);
		}
	}
}

function buildDesiredDetail(cause: BuildDesiredError): string {
	switch (cause.kind) {
		case "fileReadFailed": {
			return `for '${cause.key}' (${cause.filePath}): ${cause.reason}`;
		}
		case "iconRemovalRejected": {
			return `for '${cause.key}': ${cause.message}`;
		}
		case "redactedNameCollision": {
			const [first, second] = cause.keys;
			return `for '${first}' and '${second}': ${cause.message}`;
		}
	}
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
		case "pluginLoadFailed": {
			return `plugin '${err.specifier}' failed to load (${err.reason}): ${err.message}`;
		}
		case "stateBackendConflict": {
			const [first, second] = err.specifiers;
			return `state backend '${err.backend}' is claimed by both '${first}' and '${second}'`;
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

function codegenErrorDetail(cause: CodegenError): string {
	switch (cause.kind) {
		case "codegenEmitThrew": {
			return `because the emitter threw: ${cause.reason}`;
		}
		case "codegenStateReadFailed": {
			return `reading environment '${cause.environment}' ${stateErrorDetail(cause.cause)}`;
		}
		case "codegenWriteFailed": {
			return `writing '${cause.cause.path}': ${cause.cause.reason}`;
		}
	}
}

/** Kind-specific noun each incomplete-entry error names in its message. */
const INCOMPLETE_ENTRY_LABELS = {
	incompletePassEntry: "pass",
	incompletePlaceEntry: "place",
	incompleteProductEntry: "product",
} as const;

/**
 * Render a CLI option-parsing failure as a single line.
 *
 * @param err - The parse failure to describe.
 * @returns The message to print.
 */
export function parseErrorMessage(err: ParseOptionsError): string {
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

/**
 * Render a failed `.bedrock` override spawn as a single line.
 *
 * @param root0 - The environment and spawn error to describe.
 * @returns The message to print.
 */
export function overrideErrorMessage({ environment, err }: OverrideErrorRender): string {
	if (err.kind === "launchFailed") {
		return `${environment}: failed to launch override - ${err.cause.message}`;
	}

	return `${environment}: override exited with code ${String(err.exitCode)}`;
}

/**
 * Render a `migrate` option-parsing failure as a single line.
 *
 * @param err - The parse failure to describe.
 * @returns The message to print.
 */
export function migrateParseErrorMessage(err: ParseMigrateError): string {
	if (err.kind === "unknownSource") {
		return `unknown migration source '${err.received}' (supported: ${err.supported.join(", ")})`;
	}

	return parseErrorMessage(err);
}

/**
 * Render a migration failure as a single line.
 *
 * @param err - The migration error to describe.
 * @returns The message to print.
 */
export function migrateErrorMessage(err: MigrateError): string {
	switch (err.kind) {
		case "internalError": {
			return `migrate internal error: ${err.reason} (${configErrorDetail(err.cause)})`;
		}
		case "primaryEnvironmentNotFound": {
			return `primary environment '${err.primary}' not found (available: ${err.available.join(", ")})`;
		}
		case "primaryEnvironmentRequired": {
			return `primary environment required (available: ${err.available.join(", ")})`;
		}
		case "stateFileNotFound": {
			return `Mantle state file not found at '${err.path}'`;
		}
		case "stateParseFailed": {
			return `Mantle state file at '${err.path}' could not be parsed: ${err.reason}`;
		}
		case "unsupportedMantleStateVersion": {
			return `unsupported Mantle state version '${err.found}' (supported: ${err.supported.join(", ")})`;
		}
	}
}

/**
 * Render a state-port construction failure as a single line.
 *
 * @param err - The construction error to describe.
 * @returns The message to print.
 */
export function buildStatePortErrorMessage(
	err: MissingCredentialError | UnsupportedBackendError,
): string {
	switch (err.kind) {
		case "missingCredential": {
			return `missing credential: environment variable ${err.variable} is not set`;
		}
		case "unsupportedBackend": {
			return `unsupported state backend '${err.backend}' (${err.hint})`;
		}
	}
}

function configErrorMessage(
	err: Extract<
		DeployError,
		{ kind: "missingCredential" | "registryConfigMissing" | "unknownEnvironment" }
	>,
): string {
	switch (err.kind) {
		case "missingCredential": {
			return `missing credential: environment variable ${err.variable} is not set`;
		}
		case "registryConfigMissing": {
			return `registry config missing '${err.missing}' (${err.hint})`;
		}
		case "unknownEnvironment": {
			return `unknown environment '${err.environment}' (declared: ${err.declared.join(", ")})`;
		}
	}
}

function incompleteEntryMessage(
	err: Extract<DeployError, { kind: `incomplete${string}` }>,
): string {
	if (err.kind === "incompleteUniverseEntry") {
		return `universe is missing '${err.missingField}' under environment '${err.environment}'`;
	}

	const label = INCOMPLETE_ENTRY_LABELS[err.kind];
	return `${label} '${err.key}' is missing '${err.missingField}' under environment '${err.environment}'`;
}

function pipelineErrorMessage(
	err: Extract<
		DeployError,
		{
			kind:
				| "buildDesiredFailed"
				| "buildFailed"
				| "codegenFailed"
				| "configLoadFailed"
				| "missingBuildStep";
		}
	>,
): string {
	switch (err.kind) {
		case "buildDesiredFailed": {
			return `build desired state failed ${buildDesiredDetail(err.cause)}`;
		}
		case "buildFailed": {
			return `the build step failed: ${err.reason}`;
		}
		case "codegenFailed": {
			return `codegen failed ${codegenErrorDetail(err.cause)}`;
		}
		case "configLoadFailed": {
			return `config load failed: ${configErrorDetail(err.cause)}`;
		}
		case "missingBuildStep": {
			return "codegen is enabled but no build step is available: add a .bedrock/build.ts override that writes each place's built artifact to its configured file path, or disable codegen";
		}
	}
}

function stateErrorMessage(
	err: Extract<
		DeployError,
		{
			kind:
				| "stateNotConfigured"
				| "stateReadFailed"
				| "stateWriteFailed"
				| "unsupportedBackend";
		}
	>,
): string {
	switch (err.kind) {
		case "stateNotConfigured": {
			return `state not configured for environment '${err.environment}'`;
		}
		case "stateReadFailed": {
			return `state read failed ${stateErrorDetail(err.cause)}`;
		}
		case "stateWriteFailed": {
			return `state write failed ${stateErrorDetail(err.cause)}`;
		}
		case "unsupportedBackend": {
			return `unsupported state backend '${err.backend}' (${err.hint})`;
		}
	}
}
