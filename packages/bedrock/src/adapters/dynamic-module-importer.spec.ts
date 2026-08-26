import { describe, expect, it } from "vitest";

import { importPluginModuleAsync } from "./dynamic-module-importer.ts";

describe(importPluginModuleAsync, () => {
	it("should resolve a specifier to the module it names", async () => {
		expect.assertions(1);

		const module = await importPluginModuleAsync("node:path");

		expect(module).toHaveProperty("join");
	});

	it("should reject with the module-not-found code when the specifier resolves to nothing", async () => {
		expect.assertions(1);

		const rejection = await importPluginModuleAsync("@bedrock-rbx/not-a-real-plugin").catch(
			(err: unknown) => err,
		);

		expect(rejection).toHaveProperty("code", "ERR_MODULE_NOT_FOUND");
	});
});
