import { join } from "node:path";
import { describe, it, vi } from "vitest";

import { fakeLoad, makeDeps, okState } from "#tests/helpers/reconcile-command";
import { fakeSignalSource } from "#tests/helpers/signals";
import type { ProgDeps } from "../index.ts";
import type { InterruptSignal } from "../interrupt-signals.ts";
import type { Spawner } from "../spawner.ts";
import { deployCommand } from "./deploy.ts";
import { publishCommand } from "./publish.ts";

type DeployFunc = NonNullable<ProgDeps["deploy"]>;

const RECOVERY_FILE = join("/project", ".bedrock", "recovery", "production.json");

describe("reconcile command on an Interrupt", () => {
	it.for<[InterruptSignal, number]>([
		["SIGINT", 130],
		["SIGTERM", 143],
	])(
		"should exit %s with code %i when the State write succeeds",
		async ([name, code], { expect }) => {
			expect.assertions(4);

			const signals = fakeSignalSource();
			const deploy = vi.fn<DeployFunc>(async (options) => {
				signals.send(name);

				expect(options.signal!.aborted).toBeTrue();

				return { data: okState(), success: true };
			});
			const deps = makeDeps({ deploy, loadProject: fakeLoad(), signals });

			await deployCommand(deps)({ env: "production" });

			expect(deps.exit).toHaveBeenCalledExactlyOnceWith(code);
			expect(deps.clack!.cancel).toHaveBeenCalledExactlyOnceWith("deploy interrupted");
			expect(signals.count()).toBe(0);
		},
	);

	it("should not exit on a second signal and still finish the run", async ({ expect }) => {
		expect.assertions(2);

		const signals = fakeSignalSource();
		const exit = vi.fn<NonNullable<ProgDeps["exit"]>>();
		const deploy = vi.fn<DeployFunc>(async () => {
			signals.send("SIGINT");
			signals.send("SIGTERM");
			signals.send("SIGINT");

			expect(exit).not.toHaveBeenCalled();

			return { data: okState(), success: true };
		});

		await deployCommand(makeDeps({ deploy, exit, loadProject: fakeLoad(), signals }))({
			env: "production",
		});

		expect(exit).toHaveBeenCalledExactlyOnceWith(130);
	});

	it("should run no further environment after an Interrupt", async ({ expect }) => {
		expect.assertions(2);

		const signals = fakeSignalSource();
		const publish = vi.fn<NonNullable<ProgDeps["publish"]>>(async () => {
			signals.send("SIGINT");
			return { data: okState(), success: true };
		});
		const deps = makeDeps({ loadProject: fakeLoad(), publish, signals });

		await publishCommand(deps)({ env: ["production", "staging"] });

		expect(publish).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ environment: "production" }),
		);
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(130);
	});

	it("should dump the unsaved State and print the push command when the write after an Interrupt fails", async ({
		expect,
	}) => {
		expect.assertions(3);

		const signals = fakeSignalSource();
		const deploy = vi.fn<DeployFunc>(async () => {
			signals.send("SIGTERM");
			return {
				err: {
					cause: { file: "gist:abc123", kind: "stateError", reason: "403 Forbidden" },
					kind: "stateWriteFailed",
					unrecorded: [],
					unsavedState: okState(),
				},
				success: false,
			};
		});
		const writeFile = vi.fn<NonNullable<ProgDeps["writeFile"]>>();
		const deps = makeDeps({
			deploy,
			loadProject: fakeLoad(),
			mkdir: vi.fn<NonNullable<ProgDeps["mkdir"]>>(),
			projectRoot: "/project",
			signals,
			writeFile,
		});

		await deployCommand(deps)({ env: "production" });

		expect(writeFile).toHaveBeenCalledExactlyOnceWith(RECOVERY_FILE, expect.any(String));
		expect(deps.clack!.logMessage).toHaveBeenCalledExactlyOnceWith(
			`unsaved state written to ${RECOVERY_FILE}; push it with: bedrock state push --env production`,
		);
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(143);
	});

	it.for<[number, number]>([
		[0, 0],
		[130, 1],
	])(
		"should send each signal on to an override child that exits %i and exit %i",
		async ([childCode, code], { expect }) => {
			expect.assertions(3);

			const signals = fakeSignalSource();
			const received: Array<InterruptSignal> = [];
			const spawner: Spawner = {
				async spawn(invocation) {
					for (const name of ["SIGINT", "SIGTERM"] as const) {
						invocation.signals!.on(name, () => {
							received.push(name);
						});
					}

					signals.send("SIGINT");
					signals.send("SIGTERM");
					signals.send("SIGINT");
					return { data: childCode, success: true };
				},
			};
			const deps = makeDeps({
				discoverOverride: () => "/abs/.bedrock/deploy.ts",
				loadProject: fakeLoad(),
				signals,
				spawner,
			});

			await deployCommand(deps)({ env: "production" });

			expect(received).toStrictEqual(["SIGINT", "SIGTERM", "SIGINT"]);
			expect(deps.exit).toHaveBeenCalledExactlyOnceWith(code);
			expect(deps.clack!.cancel).not.toHaveBeenCalledWith("deploy interrupted");
		},
	);
});
