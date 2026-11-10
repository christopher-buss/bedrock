import type { Credential, Result } from "@bedrock-rbx/ocale";

import process from "node:process";

import type { ResolvedConfig } from "../core/schema.ts";
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
	/** File reader used by default Drivers. */
	readonly readFile: (path: string) => Promise<Uint8Array>;
	/** Caller-supplied authenticated Drivers. */
	readonly registry?: Partial<DriverRegistry> | undefined;
	/** Persistence the saved baseline is read from. */
	readonly statePort: StatePort;
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
		{
			readonly registry: Partial<DriverRegistry> | undefined;
			readonly state: BedrockState | undefined;
		},
		| MissingCredentialError
		| RegistryConfigError
		| { readonly cause: StateError; readonly kind: "stateReadFailed" }
	>
> {
	const prior = await inputs.statePort.read(environment);
	if (!prior.success) {
		return { err: { cause: prior.err, kind: "stateReadFailed" }, success: false };
	}

	const registry = previewLiveRegistry(inputs, (prior.data.state?.resources.length ?? 0) > 0);
	if (!registry.success) {
		return registry;
	}

	return { data: { registry: registry.data, state: prior.data.state }, success: true };
}

/**
 * Pick an injected environment reader or the process environment.
 * @param options - Caller environment reader override.
 * @returns The reader used to resolve default backend and Open Cloud credentials.
 * @since unreleased
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
 * @param inputs - Driver overrides, credentials, config, and file reader.
 * @param hasTrackedResources - Whether saved State needs a live comparison.
 * @returns Authenticated readers, an explicit skip, or a missing config failure.
 * @since unreleased
 */
function previewLiveRegistry(
	inputs: PreviewLiveRegistryInputs,
	hasTrackedResources: boolean,
): Result<Partial<DriverRegistry> | undefined, MissingCredentialError | RegistryConfigError> {
	if (inputs.registry !== undefined) {
		return { data: inputs.registry, success: true };
	}

	const credential = inputs.credential ?? apiKeyCredential(inputs.getEnv);
	if (credential === undefined || credential.kind === "none") {
		return { data: undefined, success: true };
	}

	if (!hasTrackedResources) {
		return { data: {}, success: true };
	}

	return buildDefaultRegistry({ ...inputs, credential });
}

function readProcessEnvironment(name: string): string | undefined {
	return process.env[name];
}
