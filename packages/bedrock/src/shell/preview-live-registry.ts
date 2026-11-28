import type { Credential, Result } from "@bedrock-rbx/ocale";

import process from "node:process";

import { collectImports } from "../core/import-current.ts";
import type { ResolvedConfig } from "../core/schema.ts";
import { contestedStartPlaceFields } from "../core/start-place-yield.ts";
import type { BedrockState, StateError } from "../core/state.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import { buildDefaultRegistry, type RegistryConfigError } from "./build-default-registry.ts";
import type { MissingCredentialError } from "./build-state-port.ts";

/** Inputs for resolving live readers after reading the saved State. */
export interface PreviewLiveRegistryInputs {
	/** Effective Environment config. */
	readonly config: ResolvedConfig;
	/** Explicit Open Cloud authentication. */
	readonly credential?: Credential | undefined;
	/** Environment variable reader. */
	readonly getEnv: (name: string) => string | undefined;
	/** Disable default reader construction for an offline preview. */
	readonly live?: boolean | undefined;
	/** File reader used by default Drivers. */
	readonly readFile: (path: string) => Promise<Uint8Array>;
	/** Caller-supplied authenticated Drivers. */
	readonly registry?: Partial<DriverRegistry> | undefined;
	/** Persistence the saved baseline is read from. */
	readonly statePort: StatePort;
}

/** The saved State a preview compares, paired with its live readers. */
export interface PreviewBaseline {
	/** Live readers, absent when the preview reads nothing live. */
	readonly registry: Partial<DriverRegistry> | undefined;
	/** Saved State of the Environment, absent before its first Deploy. */
	readonly state: BedrockState | undefined;
}

/**
 * Read the preview baseline before constructing readers it may not need.
 * @param environment - Environment whose saved State is compared.
 * @param inputs - State port and live-reader dependencies.
 * @returns Saved State paired with its readers, or the read/configuration error.
 */
export async function readPreviewLiveRegistryAsync(
	environment: string,
	inputs: PreviewLiveRegistryInputs,
): Promise<
	Result<
		PreviewBaseline,
		| MissingCredentialError
		| RegistryConfigError
		| { readonly cause: StateError; readonly kind: "stateReadFailed" }
	>
> {
	const prior = await inputs.statePort.read(environment);
	if (!prior.success) {
		return { err: { cause: prior.err, kind: "stateReadFailed" }, success: false };
	}

	const registry = previewLiveRegistry(
		inputs,
		(prior.data.state?.resources.length ?? 0) > 0 ||
			collectImports(inputs.config, environment).length > 0,
	);
	if (!registry.success) {
		return registry;
	}

	return { data: { registry: registry.data, state: prior.data.state }, success: true };
}

/**
 * Pick an injected environment reader or the process environment.
 * @param options - Caller environment reader override.
 * @returns The reader used to resolve default backend and Open Cloud credentials.
 * @since 0.5.0
 */
export function getEnvironmentOf(options: {
	/** Optional injected environment reader. */
	readonly getEnv?: (name: string) => string | undefined;
}): (name: string) => string | undefined {
	return options.getEnv ?? readProcessEnvironment;
}

function apiKeyCredential(
	getEnvironment: (name: string) => string | undefined,
): Credential | undefined {
	const apiKey = getEnvironment("BEDROCK_API_KEY");
	return apiKey === undefined ? undefined : { apiKey, kind: "apiKey" };
}

/**
 * Resolve live readers, skipping when no Open Cloud credential is available.
 * With nothing tracked, only a universe reader is built, and only when the
 * universe and a place both declare a start place field.
 * @param inputs - Driver overrides, credentials, config, and file reader.
 * @param hasTrackedResources - Whether saved State or an import needs a live read.
 * @returns Authenticated readers, an explicit skip, or a missing config failure.
 * @since 0.5.0
 */
function previewLiveRegistry(
	inputs: PreviewLiveRegistryInputs,
	hasTrackedResources: boolean,
): Result<Partial<DriverRegistry> | undefined, MissingCredentialError | RegistryConfigError> {
	if (inputs.live === false) {
		return { data: undefined, success: true };
	}

	if (inputs.registry !== undefined) {
		return { data: inputs.registry, success: true };
	}

	const credential = inputs.credential ?? apiKeyCredential(inputs.getEnv);
	if (credential === undefined || credential.kind === "none") {
		return { data: undefined, success: true };
	}

	if (!hasTrackedResources && contestedStartPlaceFields(inputs.config).length === 0) {
		return { data: {}, success: true };
	}

	// With nothing tracked, only the universe is read: it names the start
	// place that yields the fields the universe also declares.
	const built = buildDefaultRegistry({ ...inputs, credential });
	return hasTrackedResources || !built.success
		? built
		: { data: { universe: built.data.universe }, success: true };
}

function readProcessEnvironment(name: string): string | undefined {
	return process.env[name];
}
