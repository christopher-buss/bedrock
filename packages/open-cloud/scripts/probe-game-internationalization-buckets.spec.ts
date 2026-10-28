import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

import {
	parseRequests,
	type ProbeRequest,
	runProbeAsync,
} from "./probe-game-internationalization-buckets.ts";

const REQUESTS: ReadonlyArray<ProbeRequest> = [
	{
		body: { name: "Existing name" },
		family: "badge-localization",
		method: "PATCH",
		path: "/legacy-game-internationalization/v1/badges/123/name-description/language-codes/en",
	},
	{
		body: { description: "Existing description" },
		family: "game-pass-localization",
		method: "PATCH",
		path: "/legacy-game-internationalization/v1/game-passes/456/name-description/language-codes/en",
	},
];

describe(parseRequests, () => {
	it("should accept prepared requests without reading or retaining credentials", ({ expect }) => {
		expect.assertions(1);
		expect(parseRequests(JSON.stringify(REQUESTS))).toStrictEqual(REQUESTS);
	});

	it.for([
		"{}",
		"[]",
		JSON.stringify([...REQUESTS, { family: "x", method: "GET", path: "https://example.com" }]),
		JSON.stringify([
			...REQUESTS,
			{ family: "x", method: "DELETE", path: "/legacy-game-internationalization/v1/x" },
		]),
	])("should reject invalid probe request configuration (%s)", (value, { expect }) => {
		expect.assertions(1);
		expect(() => parseRequests(value)).toThrow(
			"expected at least two game-internationalization requests",
		);
	});
});

function response(
	remaining: number,
	{
		headers = {},
		status = 200,
	}: { readonly headers?: Record<string, string>; readonly status?: number } = {},
): Response {
	return new Response("{}", {
		headers: {
			"x-ratelimit-limit": "100, 500;w=60, 100;w=60",
			"x-ratelimit-remaining": remaining.toString(),
			"x-ratelimit-reset": "60",
			...headers,
		},
		status,
	});
}

async function probeAsync(responses: Array<Response>) {
	return runProbeAsync(
		{ apiKey: "private-key", requests: REQUESTS },
		{
			fetch: async () => {
				const next = responses.shift();
				if (next === undefined) {
					throw new Error("unexpected request");
				}

				return next;
			},
			now: () => 0,
		},
	);
}

describe(runProbeAsync, () => {
	it("should compare all ten pairs from the saved five-family capture without exposing the credential", async ({
		expect,
	}) => {
		expect.assertions(4);

		const capture = readFileSync(
			new URL(
				"../../../docs/spikes/game-internationalization-rate-limits/capture.json",
				import.meta.url,
			),
			"utf8",
		);
		const requests = parseRequests(capture);
		const counters = new Map(
			requests.map((request) => [`https://apis.roblox.com${request.path}`, 100]),
		);
		const result = await runProbeAsync(
			{ apiKey: "private-key", requests },
			{
				fetch: async (url) => {
					const remaining = counters.get(url)! - 1;
					counters.set(url, remaining);
					return response(remaining);
				},
				now: () => 0,
			},
		);

		expect(result).toHaveLength(10);

		const pairs = new Set(result.map((pair) => pair.families.join("/")));

		expect(pairs.size).toBe(10);
		expect(result.map((pair) => [pair.verdict, pair.allRequestsAccepted])).toStrictEqual(
			Array.from({ length: 10 }, () => ["separate", true]),
		);
		expect(JSON.stringify(result)).not.toContain("private-key");
	});

	it("should identify a shared reported bucket from both families spending the same counter", async ({
		expect,
	}) => {
		expect.assertions(1);

		const result = await probeAsync([response(99), response(98), response(97), response(96)]);

		expect(result[0]!.verdict).toBe("shared");
	});

	it("should identify separate reported buckets when each family spends only its own counter", async ({
		expect,
	}) => {
		expect.assertions(1);

		const result = await probeAsync([response(99), response(75), response(74), response(98)]);

		expect(result[0]!.verdict).toBe("separate");
	});

	it.for([
		{ remaining: [99, 99, 99, 98] },
		{ remaining: [99, 98, 98, 96] },
		{ remaining: [99, 80, 79, 96] },
	])(
		"should remain inconclusive when the counters do not prove the expected spending ($remaining)",
		async ({ remaining }, { expect }) => {
			expect.assertions(1);

			const result = await probeAsync(remaining.map((value) => response(value)));

			expect(result[0]!.verdict).toBe("inconclusive");
		},
	);

	it.for([
		{ "x-ratelimit-limit": "" },
		{ "x-ratelimit-limit": "100oops" },
		{ "x-ratelimit-limit": "0" },
		{ "x-ratelimit-remaining": "98oops" },
		{ "x-ratelimit-remaining": "101" },
		{ "x-ratelimit-remaining": "-1" },
		{ "x-ratelimit-reset": "0" },
		{ "x-ratelimit-reset": "" },
	])("should reject absent or invalid quota headers (%j)", async (headers, { expect }) => {
		expect.assertions(1);

		const result = await probeAsync([
			response(99),
			response(99),
			response(98),
			response(98, { headers }),
		]);

		expect(result[0]!.verdict).toBe("inconclusive");
	});

	it.for([429, 500])(
		"should remain inconclusive for a throttled or failed response (%i)",
		async (status, { expect }) => {
			expect.assertions(1);

			const result = await probeAsync([
				response(99),
				response(99),
				response(98, { status }),
				response(98),
			]);

			expect(result[0]!.verdict).toBe("inconclusive");
		},
	);

	it("should retain rejected statuses when reporting independent counters without claiming downstream success", async ({
		expect,
	}) => {
		expect.assertions(2);

		const result = await probeAsync([
			response(99, { status: 403 }),
			response(99, { status: 400 }),
			response(98, { status: 400 }),
			response(98, { status: 403 }),
		]);

		expect(result[0]!.verdict).toBe("separate");
		expect(result[0]!.allRequestsAccepted).toBe(false);
	});

	it.for([{ "x-ratelimit-reset": "10" }, { "x-ratelimit-limit": "200" }])(
		"should remain inconclusive when a quota window or ceiling changes (%j)",
		async (headers, { expect }) => {
			expect.assertions(1);

			const result = await probeAsync([
				response(99),
				response(99),
				response(98),
				response(98, { headers }),
			]);

			expect(result[0]!.verdict).toBe("inconclusive");
		},
	);
});
