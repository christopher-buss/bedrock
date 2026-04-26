import { describe, expect, it, vi } from "vitest";

import type { ProgDeps } from "../index.ts";
import type { ClackPort } from "../render.ts";
import { deployCommand } from "./deploy.ts";

function fakeClackPort(): ClackPort {
	return {
		cancel: vi.fn<ClackPort["cancel"]>(),
		intro: vi.fn<ClackPort["intro"]>(),
		logError: vi.fn<ClackPort["logError"]>(),
		logMessage: vi.fn<ClackPort["logMessage"]>(),
		logSuccess: vi.fn<ClackPort["logSuccess"]>(),
		outro: vi.fn<ClackPort["outro"]>(),
	};
}

function makeDeps(overrides: Partial<ProgDeps> = {}): ProgDeps {
	return {
		clack: fakeClackPort(),
		exit: vi.fn<(code: number) => never>(),
		...overrides,
	};
}

describe(deployCommand, () => {
	it.for<{ label: string; rawOptions: Record<string, unknown> }>([
		{ label: "missingRequired", rawOptions: {} },
		{ label: "unknownFlag", rawOptions: { env: "production", verbose: true } },
		{ label: "invalidValue", rawOptions: { env: false } },
	])("should surface a $label parse error and exit with code 1", async ({ rawOptions }) => {
		expect.assertions(4);

		const deps = makeDeps();

		await deployCommand(deps)(rawOptions);

		expect(deps.clack?.intro).toHaveBeenCalledExactlyOnceWith("bedrock deploy");
		expect(deps.clack?.logError).toHaveBeenCalledOnce();
		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("deploy failed");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});
});
