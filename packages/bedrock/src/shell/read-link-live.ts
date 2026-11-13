import type { Credential, Result } from "@bedrock-rbx/ocale";

import { readFile as nodeReadFile } from "node:fs/promises";

import type { LiveSnapshot } from "../core/live-state.ts";
import type { Config } from "../core/schema.ts";
import { selectEnvironment, type SelectEnvironmentError } from "../core/select-environment.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import { buildDefaultRegistry, type RegistryConfigError } from "./build-default-registry.ts";
import type { MissingCredentialError } from "./build-state-port.ts";
import { readLiveAsync } from "./read-import-live.ts";
import type { LiveCheckError } from "./read-live-state.ts";

/** What building an Environment's Drivers and reading its lists need. */
export interface ImportRegistryOptions {
	/** The project config, as authored. */
	readonly config: Config;
	/** Open Cloud authentication; `BEDROCK_API_KEY` when absent. */
	readonly credential?: Credential | undefined;
	/** Reads an environment variable. */
	readonly getEnv: (name: string) => string | undefined;
	/**
	 * Reads a file for the default Drivers; `node:fs/promises.readFile` when
	 * absent.
	 */
	readonly readFile?: ((path: string) => Promise<Uint8Array>) | undefined;
}

/** Why an Environment's Drivers could not be built. */
export type ImportRegistryError =
	| MissingCredentialError
	| RegistryConfigError
	| SelectEnvironmentError;

/**
 * The read-capable Drivers of one Environment: the given ones, or the
 * default Drivers built for that Environment's universe.
 *
 * @param options - Config, credential and file reader.
 * @param target - The Environment, and Drivers to use instead of building.
 * @returns The Drivers, or why they could not be built.
 */
export function importRegistry(
	options: ImportRegistryOptions,
	{
		environment,
		registry,
	}: { readonly environment: string; readonly registry: DriverRegistry | undefined },
): Result<DriverRegistry, ImportRegistryError> {
	const resolved = selectEnvironment(options.config, environment);
	if (!resolved.success) {
		return resolved;
	}

	return registry === undefined
		? buildDefaultRegistry({
				...options,
				config: resolved.data,
				readFile: options.readFile ?? nodeReadFile,
			})
		: { data: registry, success: true };
}

/**
 * Read every live list of each Environment other than the source, for
 * linking imported Keys there. A Kind whose Driver has no list is left out,
 * so it counts as not checked.
 *
 * @param options - Config, credential, file reader and source Environment.
 * @param registries - Drivers per Environment to use instead of building.
 * @returns The live lists by Environment name, or why one failed.
 */
export async function readLinkLiveAsync(
	options: ImportRegistryOptions & { readonly environment: string },
	registries: Readonly<Record<string, DriverRegistry>> | undefined,
): Promise<Result<Readonly<Record<string, LiveSnapshot>>, ImportRegistryError | LiveCheckError>> {
	const snapshots: Record<string, LiveSnapshot> = {};
	const others = Object.keys(options.config.environments).filter((environment) => {
		return environment !== options.environment;
	});
	for (const environment of others) {
		const registry = importRegistry(options, {
			environment,
			registry: registries?.[environment],
		});
		if (!registry.success) {
			return registry;
		}

		const live = await readLiveAsync(registry.data, { listAll: true, selections: [] });
		if (!live.success) {
			return live;
		}

		const { badge, developerProduct, gamePass } = registry.data;
		snapshots[environment] = {
			...(badge.list === undefined ? {} : { badge: live.data.badge }),
			...(developerProduct.list === undefined
				? {}
				: { developerProduct: live.data.developerProduct }),
			...(gamePass.list === undefined ? {} : { gamePass: live.data.gamePass }),
		};
	}

	return { data: snapshots, success: true };
}
