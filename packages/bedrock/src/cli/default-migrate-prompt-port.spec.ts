import { describe, expect, it, vi } from "vitest";

import {
	createDefaultMigratePromptPort,
	type MigratePromptClackHelpers,
} from "./default-migrate-prompt-port.ts";

const CANCEL_SENTINEL = Symbol("clack-cancel");

function fakeIsCancel(value: unknown): value is symbol {
	return value === CANCEL_SENTINEL;
}

function makeHelpers(
	overrides: Partial<MigratePromptClackHelpers> = {},
): MigratePromptClackHelpers {
	return {
		isCancel: fakeIsCancel,
		path: vi.fn<MigratePromptClackHelpers["path"]>(),
		select: vi.fn<MigratePromptClackHelpers["select"]>(),
		text: vi.fn<MigratePromptClackHelpers["text"]>(),
		...overrides,
	};
}

describe(createDefaultMigratePromptPort, () => {
	it("should resolve promptConfigFormat with the picked format", async () => {
		expect.assertions(2);

		const select = vi.fn<MigratePromptClackHelpers["select"]>(async () => "yaml");
		const port = createDefaultMigratePromptPort(makeHelpers({ select }));

		const result = await port.promptConfigFormat();

		expect(result).toStrictEqual({ data: "yaml", success: true });
		expect(select).toHaveBeenCalledExactlyOnceWith({
			initialValue: "typescript",
			message: "Output config format?",
			options: [
				{ hint: "recommended", label: "TypeScript", value: "typescript" },
				{ label: "YAML", value: "yaml" },
			],
		});
	});

	it("should resolve promptMigrationSource with the picked source and preselect the first option", async () => {
		expect.assertions(2);

		const select = vi.fn<MigratePromptClackHelpers["select"]>(async () => "mantle");
		const port = createDefaultMigratePromptPort(makeHelpers({ select }));

		const result = await port.promptMigrationSource(["mantle"]);

		expect(result).toStrictEqual({ data: "mantle", success: true });
		expect(select).toHaveBeenCalledExactlyOnceWith({
			initialValue: "mantle",
			message: "Migrate from?",
			options: [{ label: "Mantle", value: "mantle" }],
		});
	});

	it("should map a clack cancel into Err({ kind: 'cancelled' }) on promptMigrationSource", async () => {
		expect.assertions(1);

		const select = vi.fn<MigratePromptClackHelpers["select"]>(async () => CANCEL_SENTINEL);
		const port = createDefaultMigratePromptPort(makeHelpers({ select }));

		const result = await port.promptMigrationSource(["mantle"]);

		expect(result).toStrictEqual({ err: { kind: "cancelled" }, success: false });
	});

	it("should resolve promptStateBackend with the picked backend and forward the prompt shape", async () => {
		expect.assertions(2);

		const select = vi.fn<MigratePromptClackHelpers["select"]>(async () => "gist");
		const port = createDefaultMigratePromptPort(makeHelpers({ select }));

		const result = await port.promptStateBackend();

		expect(result).toStrictEqual({ data: "gist", success: true });
		expect(select).toHaveBeenCalledExactlyOnceWith({
			initialValue: "gist",
			message: "State backend?",
			options: [
				{ label: "GitHub Gist", value: "gist" },
				{
					hint: "writes .bedrock/state/<env>.json next to bedrock.config",
					label: "Local files",
					value: "local",
				},
			],
		});
	});

	it("should resolve promptPrimaryEnvironment with the picked env and forward the env list", async () => {
		expect.assertions(4);

		const select = vi.fn<MigratePromptClackHelpers["select"]>(async () => "production");
		const port = createDefaultMigratePromptPort(makeHelpers({ select }));

		const result = await port.promptPrimaryEnvironment(["production", "staging"]);

		expect(result).toStrictEqual({ data: "production", success: true });
		expect(select).toHaveBeenCalledExactlyOnceWith({
			message:
				"Which environment should be the primary?\nThe migrator uses it as the baseline for the generated config.",
			options: [
				{ label: "production", value: "production" },
				{ label: "staging", value: "staging" },
			],
		});

		const passedOptions = vi.mocked(select).mock.calls[0]?.[0];

		expect(Object.hasOwn(passedOptions ?? {}, "initialValue")).toBeFalse();
		expect(Object.hasOwn(passedOptions?.options[0] ?? {}, "hint")).toBeFalse();
	});

	it("should resolve promptStateFilePath via the path prompt with filesystem completion", async () => {
		expect.assertions(4);

		const path = vi.fn<MigratePromptClackHelpers["path"]>(async () => "./.mantle-state.yml");
		const port = createDefaultMigratePromptPort(makeHelpers({ path }));

		const result = await port.promptStateFilePath();

		expect(result).toStrictEqual({ data: "./.mantle-state.yml", success: true });

		const firstCall = vi.mocked(path).mock.calls[0];

		expect(firstCall?.[0]?.message).toBe("Path to the Mantle state file?");
		expect(firstCall?.[0]?.initialValue).toBe(".mantle-state.yml");
		expect(firstCall?.[0]?.validate).toBeFunction();
	});

	it("should resolve promptGistId with the typed id and forward the prompt shape", async () => {
		expect.assertions(4);

		const text = vi.fn<MigratePromptClackHelpers["text"]>(async () => "abc123");
		const port = createDefaultMigratePromptPort(makeHelpers({ text }));

		const result = await port.promptGistId();

		expect(result).toStrictEqual({ data: "abc123", success: true });

		const firstCall = vi.mocked(text).mock.calls[0];

		expect(firstCall?.[0]?.message).toBe("Gist ID for state storage?");
		expect(firstCall?.[0]?.placeholder).toBe("abc123");
		expect(firstCall?.[0]?.validate).toBeFunction();
	});

	it("should reject empty input on prompts that require a value via the validator", async () => {
		expect.assertions(4);

		const path = vi.fn<MigratePromptClackHelpers["path"]>(async () => "x");
		const port = createDefaultMigratePromptPort(makeHelpers({ path }));

		await port.promptStateFilePath();

		const firstCall = vi.mocked(path).mock.calls[0];
		const validate = firstCall?.[0]?.validate;

		expect(validate?.("")).toBe("Required");
		expect(validate?.("   ")).toBe("Required");
		expect(validate?.(undefined)).toBe("Required");
		expect(validate?.("path")).toBeUndefined();
	});

	it.for<{ method: "promptConfigFormat" | "promptGistId" | "promptStateBackend" }>([
		{ method: "promptConfigFormat" },
		{ method: "promptGistId" },
		{ method: "promptStateBackend" },
	])(
		"should map a clack cancel into Err({ kind: 'cancelled' }) on $method",
		async ({ method }) => {
			expect.assertions(1);

			const helpers = makeHelpers({
				select: vi.fn<MigratePromptClackHelpers["select"]>(async () => CANCEL_SENTINEL),
				text: vi.fn<MigratePromptClackHelpers["text"]>(async () => CANCEL_SENTINEL),
			});
			const port = createDefaultMigratePromptPort(helpers);

			const result = await port[method]();

			expect(result).toStrictEqual({ err: { kind: "cancelled" }, success: false });
		},
	);

	it("should map a clack cancel into Err({ kind: 'cancelled' }) on promptPrimaryEnvironment", async () => {
		expect.assertions(1);

		const select = vi.fn<MigratePromptClackHelpers["select"]>(async () => CANCEL_SENTINEL);
		const port = createDefaultMigratePromptPort(makeHelpers({ select }));

		const result = await port.promptPrimaryEnvironment(["production"]);

		expect(result).toStrictEqual({ err: { kind: "cancelled" }, success: false });
	});

	it("should map a clack cancel into Err({ kind: 'cancelled' }) on promptStateFilePath", async () => {
		expect.assertions(1);

		const path = vi.fn<MigratePromptClackHelpers["path"]>(async () => CANCEL_SENTINEL);
		const port = createDefaultMigratePromptPort(makeHelpers({ path }));

		const result = await port.promptStateFilePath();

		expect(result).toStrictEqual({ err: { kind: "cancelled" }, success: false });
	});

	it("should default to real clack helpers when none are injected", () => {
		expect.assertions(1);

		const port = createDefaultMigratePromptPort();

		expect(port.promptConfigFormat).toBeFunction();
	});
});
