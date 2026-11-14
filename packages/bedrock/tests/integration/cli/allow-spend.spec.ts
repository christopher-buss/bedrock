import type { deploy } from "@bedrock-rbx/core";

import { describe, it, vi } from "vitest";

import { deployCommand } from "#src/cli/commands/deploy";
import { createProg } from "#src/cli/index";
import type { SpawnInvocation } from "#src/cli/spawner";
import { fakeLoad, makeDeps } from "#tests/helpers/reconcile-command";
import { captureStreams } from "#tests/helpers/streams";

type DeployFunc = typeof deploy;

function spendingDeps() {
	const run = vi.fn<DeployFunc>(async ({ environment }) => {
		return { data: { environment, resources: [], version: 1 }, success: true };
	});
	return {
		deps: makeDeps({ deploy: run, discoverOverride: () => {}, loadProject: fakeLoad() }),
		run,
	};
}

describe("cLI spend approval", () => {
	it("should explain --allow-spend in deploy help", ({ expect }) => {
		expect.hasAssertions();

		const { stdout } = captureStreams({ console: true });
		createProg().parse(["node", "bedrock", "deploy", "--help"]);

		expect(stdout.join("")).toContain(
			"Let badge creates beyond the free quota be paid for, up to the environment's spendLimit",
		);
	});

	it("should not offer --allow-spend outside deploy", ({ expect }) => {
		expect.hasAssertions();

		const { stdout } = captureStreams({ console: true });
		createProg().parse(["node", "bedrock", "provision", "--help"]);

		expect(stdout.join("")).not.toContain("--allow-spend");
	});

	it.for([
		{ allowSpend: true, flags: { "allow-spend": true } },
		{ allowSpend: true, flags: { allowSpend: true } },
		{ allowSpend: false, flags: {} },
	])(
		"should give the deploy spend approval $allowSpend for $flags",
		async ({ allowSpend, flags }, { expect }) => {
			expect.hasAssertions();

			const { deps, run } = spendingDeps();
			await deployCommand(deps)({ env: ["production"], ...flags });

			expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
			expect(run).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ allowSpend }));
		},
	);

	it("should reject a value supplied to --allow-spend", async ({ expect }) => {
		expect.hasAssertions();

		const { deps, run } = spendingDeps();
		await deployCommand(deps)({ "allow-spend": "yes", "env": ["production"] });

		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
		expect(run).not.toHaveBeenCalled();
		expect(deps.clack!.logError).toHaveBeenCalledWith(
			"flag '--allow-spend' takes no value; pass '--allow-spend' on its own",
		);
	});

	it.for([
		{ args: ["--allow-spend"], flags: { "allow-spend": true } },
		{ args: [], flags: {} },
	])(
		"should forward spend approval $args to a project override",
		async ({ args, flags }, { expect }) => {
			expect.hasAssertions();

			const { deps, run } = spendingDeps();
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
