import { describe, expect, it, onTestFinished, vi } from "vitest";

import { pruneStateGist, selectFilesToDelete } from "./prune-state-gist.ts";

interface FakeFetch {
	readonly calls: Array<{ readonly init: RequestInit | undefined; readonly url: string }>;
	readonly fetchFn: (input: string, init?: RequestInit) => Promise<Response>;
}

interface FakeSleep {
	readonly calls: Array<number>;
	readonly sleep: (ms: number) => Promise<void>;
}

function fakeFetchSequence(responses: ReadonlyArray<Response>): FakeFetch {
	const calls: Array<{ init: RequestInit | undefined; url: string }> = [];
	let index = 0;
	async function fetchFunc(input: string, init?: RequestInit): Promise<Response> {
		calls.push({ init, url: input });
		const response = responses[index];
		if (response === undefined) {
			throw new Error(`fakeFetchSequence: no response queued for call ${String(index + 1)}`);
		}

		index += 1;
		return response;
	}

	return { calls, fetchFn: fetchFunc };
}

function fakeSleep(): FakeSleep {
	const calls: Array<number> = [];
	async function sleep(ms: number): Promise<void> {
		calls.push(ms);
	}

	return { calls, sleep };
}

const TOKEN = "ghp_x";
const GIST_ID = "abc123";

describe(selectFilesToDelete, () => {
	it.for<[label: string, input: ReadonlyArray<string>]>([
		["empty list", []],
		["only non-matching files", ["other.json", "state.cli-smoke-1.json"]],
		["fewer matches than keep", ["state.smoke-1.json", "state.smoke-2.json"]],
		[
			"exactly keep matches",
			["state.smoke-1.json", "state.smoke-2.json", "state.smoke-3.json"],
		],
	])("should return no deletions when prefix matches do not exceed keep: %s", ([, input]) => {
		expect.assertions(1);

		expect(selectFilesToDelete(input, "state.smoke-", 3)).toStrictEqual([]);
	});

	it("should return the oldest excess matches, sorting unordered input by filename", () => {
		expect.assertions(1);

		const filenames = [
			"state.smoke-1737900000003.json",
			"state.smoke-1737900000001.json",
			"state.smoke-1737900000005.json",
			"state.smoke-1737900000002.json",
			"state.smoke-1737900000004.json",
		];

		expect(selectFilesToDelete(filenames, "state.smoke-", 3)).toStrictEqual([
			"state.smoke-1737900000001.json",
			"state.smoke-1737900000002.json",
		]);
	});

	it("should consider only prefix-matching files when computing the prune set", () => {
		expect.assertions(1);

		const filenames = [
			"state.cli-smoke-1737900000010.json",
			"state.smoke-1737900000001.json",
			"state.smoke-1737900000002.json",
			"state.smoke-1737900000003.json",
			"state.smoke-1737900000004.json",
			"state.other.json",
		];

		expect(selectFilesToDelete(filenames, "state.smoke-", 3)).toStrictEqual([
			"state.smoke-1737900000001.json",
		]);
	});
});

describe(pruneStateGist, () => {
	it("should retry the list GET on 409 and succeed on the second attempt", async () => {
		expect.assertions(2);

		const { calls, fetchFn } = fakeFetchSequence([
			new Response("", { status: 409 }),
			new Response(
				JSON.stringify({
					files: { "state.smoke-1.json": {}, "state.smoke-2.json": {} },
				}),
				{ status: 200 },
			),
		]);
		const sleepFake = fakeSleep();

		await pruneStateGist({
			fetch: fetchFn,
			filenamePrefix: "state.smoke-",
			gistId: GIST_ID,
			keep: 3,
			sleep: sleepFake.sleep,
			token: TOKEN,
		});

		expect(calls).toHaveLength(2);
		expect(sleepFake.calls).toStrictEqual([1000]);
	});

	it("should warn once after exhausting the list retry budget on persistent 409", async () => {
		expect.assertions(3);

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		onTestFinished(() => {
			warnSpy.mockRestore();
		});

		const { calls, fetchFn } = fakeFetchSequence([
			new Response("", { status: 409 }),
			new Response("", { status: 409 }),
			new Response("", { status: 409 }),
			new Response("", { status: 409 }),
		]);
		const sleepFake = fakeSleep();

		await pruneStateGist({
			fetch: fetchFn,
			filenamePrefix: "state.smoke-",
			gistId: GIST_ID,
			keep: 3,
			sleep: sleepFake.sleep,
			token: TOKEN,
		});

		expect(calls).toHaveLength(4);
		expect(sleepFake.calls).toStrictEqual([1000, 2000, 4000]);
		expect(warnSpy).toHaveBeenCalledExactlyOnceWith(
			"pruneStateGist: list failed with status 409",
		);
	});

	it("should retry the prune PATCH on 409 and succeed on the second attempt", async () => {
		expect.assertions(3);

		const filesNeedingPrune = {
			"state.smoke-1.json": {},
			"state.smoke-2.json": {},
			"state.smoke-3.json": {},
			"state.smoke-4.json": {},
		};
		const { calls, fetchFn } = fakeFetchSequence([
			new Response(JSON.stringify({ files: filesNeedingPrune }), { status: 200 }),
			new Response("", { status: 409 }),
			new Response("", { status: 200 }),
		]);
		const sleepFake = fakeSleep();

		await pruneStateGist({
			fetch: fetchFn,
			filenamePrefix: "state.smoke-",
			gistId: GIST_ID,
			keep: 3,
			sleep: sleepFake.sleep,
			token: TOKEN,
		});

		expect(calls).toHaveLength(3);
		expect(calls[1]?.init?.method).toBe("PATCH");
		expect(sleepFake.calls).toStrictEqual([1000]);
	});

	it("should warn once after exhausting the prune retry budget on persistent 409", async () => {
		expect.assertions(3);

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		onTestFinished(() => {
			warnSpy.mockRestore();
		});

		const filesNeedingPrune = {
			"state.smoke-1.json": {},
			"state.smoke-2.json": {},
			"state.smoke-3.json": {},
			"state.smoke-4.json": {},
		};
		const { calls, fetchFn } = fakeFetchSequence([
			new Response(JSON.stringify({ files: filesNeedingPrune }), { status: 200 }),
			new Response("", { status: 409 }),
			new Response("", { status: 409 }),
			new Response("", { status: 409 }),
			new Response("", { status: 409 }),
		]);
		const sleepFake = fakeSleep();

		await pruneStateGist({
			fetch: fetchFn,
			filenamePrefix: "state.smoke-",
			gistId: GIST_ID,
			keep: 3,
			sleep: sleepFake.sleep,
			token: TOKEN,
		});

		expect(calls).toHaveLength(5);
		expect(sleepFake.calls).toStrictEqual([1000, 2000, 4000]);
		expect(warnSpy).toHaveBeenCalledWith("pruneStateGist: prune failed with status 409");
	});

	it.for<[number]>([[401], [403], [404], [422]])(
		"should not retry the list GET on %i and surface the warn in a single attempt",
		async ([status]) => {
			expect.assertions(2);

			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			onTestFinished(() => {
				warnSpy.mockRestore();
			});

			const { calls, fetchFn } = fakeFetchSequence([new Response("", { status })]);
			const sleepFake = fakeSleep();

			await pruneStateGist({
				fetch: fetchFn,
				filenamePrefix: "state.smoke-",
				gistId: GIST_ID,
				keep: 3,
				sleep: sleepFake.sleep,
				token: TOKEN,
			});

			expect(calls).toHaveLength(1);
			expect(sleepFake.calls).toBeEmpty();
		},
	);
});
