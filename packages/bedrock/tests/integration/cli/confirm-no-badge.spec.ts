import type { deploy } from "@bedrock-rbx/core";

import { describe, it, vi } from "vitest";

import { deployCommand } from "#src/cli/commands/deploy";
import { createProg } from "#src/cli/index";
import type { SpawnInvocation } from "#src/cli/spawner";
import { fakeLoad, makeDeps } from "#tests/helpers/reconcile-command";
import { captureStreams } from "#tests/helpers/streams";

type DeployFunc = typeof deploy;

function confirmingDeps() {
	const run = vi.fn<DeployFunc>(async ({ environment }) => {
		return { data: { environment, resources: [], version: 1 }, success: true };
	});
	return {
		deps: makeDeps({ deploy: run, discoverOverride: () => {}, loadProject: fakeLoad() }),
		run,
	};
}

describe("cLI confirmation that no badge exists", () => {
	it("should explain --confirm-no-badge in deploy help", ({ expect }) => {
		expect.hasAssertions();

		const { stdout } = captureStreams({ console: true });
		createProg().parse(["node", "bedrock", "deploy", "--help"]);

		expect(stdout.join("")).toContain(
			"Confirm that a failed paid create made no badge for this badge key (repeat for multiple)",
		);
	});

	it("should not offer --confirm-no-badge outside deploy", ({ expect }) => {
		expect.hasAssertions();

		const { stdout } = captureStreams({ console: true });
		createProg().parse(["node", "bedrock", "provision", "--help"]);

		expect(stdout.join("")).not.toContain("--confirm-no-badge");
	});

	it.for([
		{ confirmNoBadge: ["a-badge"], flags: { "confirm-no-badge": "a-badge" } },
		{
			confirmNoBadge: ["a-badge", "b-badge"],
			flags: { confirmNoBadge: ["a-badge", "b-badge"] },
		},
	])(
		"should pass the confirmed badge keys $confirmNoBadge to the deploy",
		async ({ confirmNoBadge, flags }, { expect }) => {
			expect.hasAssertions();

			const { deps, run } = confirmingDeps();
			await deployCommand(deps)({ env: ["production"], ...flags });

			expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
			expect(run).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({ confirmNoBadge }),
			);
		},
	);

	it("should confirm no badge key when the flag is absent", async ({ expect }) => {
		expect.hasAssertions();

		const { deps, run } = confirmingDeps();
		await deployCommand(deps)({ env: ["production"] });

		expect(run.mock.calls[0]![0]).not.toHaveProperty("confirmNoBadge");
	});

	it.for([{ value: true }, { value: "" }, { value: ["a-badge", 7] }])(
		"should reject --confirm-no-badge given $value",
		async ({ value }, { expect }) => {
			expect.hasAssertions();

			const { deps, run } = confirmingDeps();
			await deployCommand(deps)({ "confirm-no-badge": value, "env": ["production"] });

			expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
			expect(run).not.toHaveBeenCalled();
			expect(deps.clack!.logError).toHaveBeenCalledWith(
				"invalid value for flag '--confirm-no-badge' (expected a string)",
			);
		},
	);

	it.for([
		{ invalid: "a badge", value: "a badge" },
		{ invalid: "badge.b", value: ["a-badge", "badge.b"] },
	])(
		"should reject the badge key $invalid in --confirm-no-badge",
		async ({ invalid, value }, { expect }) => {
			expect.hasAssertions();

			const { deps, run } = confirmingDeps();
			await deployCommand(deps)({ "confirm-no-badge": value, "env": ["production"] });

			expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
			expect(run).not.toHaveBeenCalled();
			expect(deps.clack!.logError).toHaveBeenCalledWith(
				`invalid badge key '${invalid}' for flag '--confirm-no-badge' (expected only letters, digits, '_' and '-')`,
			);
		},
	);

	it.for([
		{
			args: ["--confirm-no-badge", "a-badge", "--confirm-no-badge", "b-badge"],
			flags: { "confirm-no-badge": ["a-badge", "b-badge"] },
		},
		{ args: [], flags: {} },
	])(
		"should forward the confirmed badge keys $args to a project override",
		async ({ args, flags }, { expect }) => {
			expect.hasAssertions();

			const { deps, run } = confirmingDeps();
			const sent: Array<SpawnInvocation> = [];
			await deployCommand({
				...deps,
				discoverOverride: () => "D:/project/.bedrock/deploy.ts",
				spawner: {
					spawn: async (input) => {
						sent.push(input);
						return { data: 0, success: true };
					},
				},
			})({ env: ["production"], ...flags });

			expect(sent[0]!.args).toStrictEqual([
				"D:/project/.bedrock/deploy.ts",
				"--env",
				"production",
				...args,
			]);
			expect(run).not.toHaveBeenCalled();
		},
	);
});
