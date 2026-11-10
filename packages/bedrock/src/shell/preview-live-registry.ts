import type { Credential, Result } from "@bedrock-rbx/ocale";

import process from "node:process";

import type { ResolvedConfig } from "../core/schema.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import { buildDefaultRegistry, type RegistryConfigError } from "./build-default-registry.ts";
import type { MissingCredentialError } from "./build-state-port.ts";

/**
 * Resolve live readers, skipping when no Open Cloud credential is available.
 * @param inputs - Driver overrides, credentials, config, and file reader.
 * @returns Authenticated readers, an explicit skip, or a missing config failure.
 * @since unreleased
 */
export function previewLiveRegistry(inputs: {
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
}): Result<Partial<DriverRegistry> | undefined, MissingCredentialError | RegistryConfigError> {
	if (inputs.registry !== undefined) {
		return { data: inputs.registry, success: true };
	}

	const credential = inputs.credential ?? apiKeyCredential(inputs.getEnv);
	if (credential === undefined || credential.kind === "none") {
		return { data: undefined, success: true };
	}

	return buildDefaultRegistry({ ...inputs, credential });
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

function readProcessEnvironment(name: string): string | undefined {
	return process.env[name];
}
