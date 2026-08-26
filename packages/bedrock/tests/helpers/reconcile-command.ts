import { vi } from "vitest";

import type { ProgDeps } from "#src/cli/index";
import { EMPTY_PLUGIN_REGISTRY } from "#src/core/plugin-registry";
import type { Config } from "#src/core/schema";
import type { BedrockState } from "#src/core/state";
import { fakeClackPort } from "#tests/helpers/clack";

/** Type of the `discoverOverride` dep slot, for stubbing override discovery. */
export type DiscoverOverrideFunc = NonNullable<ProgDeps["discoverOverride"]>;

type ExitFunc = NonNullable<ProgDeps["exit"]>;

type LoadProjectFunc = NonNullable<ProgDeps["loadProject"]>;

/** Minimal config every reconcile-command spec loads through `fakeLoad`. */
export const sampleConfig: Config = { environments: { production: {} } };

/**
 * Build a `ProgDeps` wired for a reconcile-command action: a spy clack port and
 * a spy `exit`, with any slot overridable. Shared by the `deploy`/`provision`/
 * `publish` command specs so the fixture cannot drift between them.
 *
 * @param overrides - Dep slots to replace on the returned object.
 * @returns A `ProgDeps` whose `clack` and `exit` are fresh spies.
 */
export function makeDeps(overrides: Partial<ProgDeps> = {}): ProgDeps {
	return { clack: fakeClackPort(), exit: vi.fn<ExitFunc>(), ...overrides };
}

/**
 * A `loadProject` spy resolving to {@link sampleConfig} with no plugins.
 *
 * @returns A `vi.fn()` that resolves to an `Ok` wrapping {@link sampleConfig}.
 */
export function fakeLoad(): LoadProjectFunc {
	return vi.fn<LoadProjectFunc>(async () => {
		// Resolve on a later microtask, as a real config load does.
		await Promise.resolve();
		return {
			data: { config: sampleConfig, plugins: EMPTY_PLUGIN_REGISTRY },
			success: true,
		};
	});
}

/**
 * A trivial successful `BedrockState` for a command that reconciled nothing.
 *
 * @returns A `BedrockState` for `production` with no resources.
 */
export function okState(): BedrockState {
	return { environment: "production", resources: [], version: 1 };
}
