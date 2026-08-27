import { type } from "arktype";
import { describe, expect, it } from "vitest";

import { fakeStateBackendPlugins } from "#tests/helpers/plugins";
import type { PluginRegistry } from "./plugin-registry.ts";
import type { StateConfig } from "./schema.ts";
import { type StateLockingCapability, stateLockingCapabilityOf } from "./state-locking.ts";

const GIST_CONFIG: StateConfig = { backend: "gist", gistId: "abc123" };
const S3_CONFIG: StateConfig = { backend: "s3", bucket: "my-bucket" };

const S3_SCHEMA = type({ bucket: "string > 0" });

function refusingPort(): { err: { reason: string }; success: false } {
	return { err: { reason: "unused by capability reporting" }, success: false };
}

function pluginsDeclaring({
	name = "s3",
	locking,
}: {
	readonly locking: boolean;
	readonly name?: string;
}): PluginRegistry {
	return fakeStateBackendPlugins({
		name,
		createPort: refusingPort,
		schema: S3_SCHEMA,
		specifier: "@example/state-s3",
		...(locking ? { createLockPort: refusingPort } : {}),
	});
}

describe(stateLockingCapabilityOf, () => {
	it.for([
		{
			expected: "none",
			label: "the gist backend, which offers no exclusion",
			plugins: undefined,
			stateConfig: GIST_CONFIG,
		},
		{
			expected: "exclusive",
			label: "a plugin backend that supplies a lock builder",
			plugins: pluginsDeclaring({ locking: true }),
			stateConfig: S3_CONFIG,
		},
		{
			expected: "none",
			label: "a plugin backend that supplies no lock builder",
			plugins: pluginsDeclaring({ locking: false }),
			stateConfig: S3_CONFIG,
		},
		{
			expected: "disabled",
			label: "a locking backend the config turned locking off for",
			plugins: pluginsDeclaring({ locking: true }),
			stateConfig: { ...S3_CONFIG, locking: false },
		},
		{
			expected: "exclusive",
			label: "a locking backend the config turned locking on for",
			plugins: pluginsDeclaring({ locking: true }),
			stateConfig: { ...S3_CONFIG, locking: true },
		},
		{
			expected: "none",
			label: "a backend that offers no exclusion to turn off",
			plugins: pluginsDeclaring({ locking: false }),
			stateConfig: { ...S3_CONFIG, locking: false },
		},
		{
			expected: "none",
			label: "a backend no loaded plugin claims",
			plugins: undefined,
			stateConfig: S3_CONFIG,
		},
		{
			expected: "none",
			label: "the gist backend even when a plugin claims that name with a lock builder",
			plugins: pluginsDeclaring({ name: "gist", locking: true }),
			stateConfig: GIST_CONFIG,
		},
	] satisfies ReadonlyArray<{
		expected: StateLockingCapability;
		label: string;
		plugins: PluginRegistry | undefined;
		stateConfig: StateConfig;
	}>)("should report $expected exclusion for $label", ({ expected, plugins, stateConfig }) => {
		expect.assertions(1);

		expect(stateLockingCapabilityOf({ plugins, stateConfig })).toBe(expected);
	});
});
