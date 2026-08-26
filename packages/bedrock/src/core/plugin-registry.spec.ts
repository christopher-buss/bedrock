import { type } from "arktype";
import { assert, describe, expect, it } from "vitest";

import { buildPluginRegistry } from "./plugin-registry.ts";

describe(buildPluginRegistry, () => {
	it("should expose a plugin-declared backend under the name the plugin claimed", () => {
		expect.assertions(1);

		const schema = type({ bucket: "string > 0" });
		const registry = buildPluginRegistry([
			{ plugin: { stateBackends: [{ name: "s3", schema }] }, specifier: "@example/state-s3" },
		]);

		assert(registry.success);

		expect(registry.data.stateBackends.get("s3")).toBe(schema);
	});

	it("should register every backend across every loaded plugin", () => {
		expect.assertions(1);

		const registry = buildPluginRegistry([
			{
				plugin: { stateBackends: [{ name: "s3", schema: type({ bucket: "string" }) }] },
				specifier: "@example/state-s3",
			},
			{
				plugin: { stateBackends: [{ name: "gcs", schema: type({ bucket: "string" }) }] },
				specifier: "@example/state-gcs",
			},
		]);

		assert(registry.success);

		expect([...registry.data.stateBackends.keys()]).toStrictEqual(["s3", "gcs"]);
	});

	it("should register nothing for a plugin that declares no backends", () => {
		expect.assertions(1);

		const registry = buildPluginRegistry([{ plugin: {}, specifier: "@example/noop" }]);

		assert(registry.success);

		expect(registry.data.stateBackends.size).toBe(0);
	});

	it("should reject two plugins claiming one backend name, naming both specifiers", () => {
		expect.assertions(2);

		const registry = buildPluginRegistry([
			{
				plugin: { stateBackends: [{ name: "s3", schema: type({ bucket: "string" }) }] },
				specifier: "@example/state-s3",
			},
			{
				plugin: { stateBackends: [{ name: "s3", schema: type({ path: "string" }) }] },
				specifier: "@other/state-s3",
			},
		]);

		assert(!registry.success);

		expect(registry.err.backend).toBe("s3");
		expect(registry.err.specifiers).toStrictEqual(["@example/state-s3", "@other/state-s3"]);
	});

	it("should reject a plugin claiming a builtin backend name, naming core as the other claimant", () => {
		expect.assertions(2);

		const registry = buildPluginRegistry([
			{
				plugin: { stateBackends: [{ name: "gist", schema: type({ gistId: "string" }) }] },
				specifier: "@example/state-gist",
			},
		]);

		assert(!registry.success);

		expect(registry.err.backend).toBe("gist");
		expect(registry.err.specifiers).toStrictEqual(["@bedrock-rbx/core", "@example/state-gist"]);
	});

	it("should reject one plugin claiming the same backend name twice", () => {
		expect.assertions(1);

		const registry = buildPluginRegistry([
			{
				plugin: {
					stateBackends: [
						{ name: "s3", schema: type({ bucket: "string" }) },
						{ name: "s3", schema: type({ path: "string" }) },
					],
				},
				specifier: "@example/state-s3",
			},
		]);

		assert(!registry.success);

		expect(registry.err.specifiers).toStrictEqual(["@example/state-s3", "@example/state-s3"]);
	});
});
