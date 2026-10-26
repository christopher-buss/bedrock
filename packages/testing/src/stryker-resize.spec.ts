import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { describe, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const PROVIDER_URL = pathToFileURL(
	join(
		dirname(require.resolve("@stryker-mutator/core/package.json")),
		"dist/src/concurrent/concurrency-token-provider.js",
	),
).href;

interface ProviderModule {
	ADAPTIVE_CAPACITY_ENV: string;
	ConcurrencyTokenProvider: new (
		options: { checkers: Array<string>; concurrency: number },
		log: Record<string, () => void>,
	) => {
		dispose: () => void;
		testRunnerToken$: { subscribe: (next: (token: number) => void) => void };
	};
}

function isProviderModule(value: unknown): value is ProviderModule {
	return typeof value === "object" && value !== null && "ConcurrencyTokenProvider" in value;
}

async function importProviderAsync(): Promise<ProviderModule> {
	const module: unknown = await import(PROVIDER_URL);
	if (!isProviderModule(module)) {
		throw new Error("unexpected provider module shape");
	}

	return module;
}

const SILENT_LOG = { debug: () => {}, info: () => {} };

async function runResizeChildAsync(runtime: string): Promise<Array<number>> {
	const scratch = mkdtempSync(join(tmpdir(), "stryker resize "));
	const childPath = join(scratch, "child.mjs");
	writeFileSync(
		childPath,
		`
		const { ConcurrencyTokenProvider } = await import(${JSON.stringify(PROVIDER_URL)});
		const provider = new ConcurrencyTokenProvider(
			{ checkers: [], concurrency: 1 },
			{ debug() {}, info() {} },
		);
		provider.testRunnerToken$.capacity.subscribe((capacity) => process.send({ capacity }));
		const keepAlive = setInterval(() => {}, 1000);
		process.once("disconnect", () => {
			clearInterval(keepAlive);
			provider.dispose();
		});
		`,
	);

	return new Promise((resolve, reject) => {
		const seen: Array<number> = [];
		const child = spawn(runtime, [childPath], {
			env: { ...process.env, STRYKER_ADAPTIVE_INITIAL_CAPACITY: "2" },
			stdio: ["ignore", "inherit", "inherit", "ipc"],
		});
		const resizes = [4, 1];
		child.on("message", (message: { capacity: number }) => {
			seen.push(message.capacity);
			const next = resizes.shift();
			if (next === undefined) {
				child.disconnect();
			} else {
				child.send({ capacity: next, type: "stryker:set-capacity" });
			}
		});
		child.on("error", reject);
		child.on("exit", () => {
			rmSync(scratch, { force: true, recursive: true });
			resolve(seen);
		});
	});
}

describe("stryker concurrency resize", () => {
	it("should keep the configured concurrency without the env var or an ipc channel", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(3);

		const module = await importProviderAsync();
		// A mutation run of this package hands its workers the variable.
		vi.stubEnv(module.ADAPTIVE_CAPACITY_ENV, undefined);
		onTestFinished(() => {
			vi.unstubAllEnvs();
		});
		const listeners = process.listenerCount("message");
		const provider = new module.ConcurrencyTokenProvider(
			{ checkers: [], concurrency: 3 },
			SILENT_LOG,
		);
		const tokens: Array<number> = [];
		provider.testRunnerToken$.subscribe((token) => {
			tokens.push(token);
		});
		provider.dispose();

		expect(module.ADAPTIVE_CAPACITY_ENV).toBe("STRYKER_ADAPTIVE_INITIAL_CAPACITY");
		expect(tokens).toStrictEqual([0, 1, 2]);
		expect(process.listenerCount("message")).toBe(listeners);
	});

	it.for(["node", "bun"])(
		"should grow and shrink capacity on resize messages under %s",
		async (runtime, { expect }) => {
			expect.assertions(1);

			await expect(runResizeChildAsync(runtime)).resolves.toStrictEqual([2, 4, 1]);
		},
	);
});
