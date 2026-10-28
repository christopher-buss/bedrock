/**
 * Raw A/B/B/A comparison of game-internationalization response counters.
 * The caller supplies requests using existing test resources and unchanged
 * values. This probe never discovers, creates, or restores resources.
 * Run only with an isolated credential, with no concurrent traffic.
 * ROBLOX_API_KEY=<key> PROBE_REQUESTS_FILE=<capture-or-request-array.json>
 * bun packages/open-cloud/scripts/probe-game-internationalization-buckets.ts.
 */

import { readFile } from "node:fs/promises";
import process from "node:process";

/** One family request, prepared against an existing test resource. */
export interface ProbeRequest {
	/** Unchanged values or intentionally rejected test input. */
	readonly body?: Readonly<Record<string, JSONValue>> | undefined;
	/** Existing SDK operation key under investigation. */
	readonly family: string;
	/** HTTP verb used by the operation. */
	readonly method: "GET" | "PATCH" | "POST";
	/** Relative Open Cloud route, including test resource identifiers. */
	readonly path: string;
}

/** Credentials never appear in the returned capture. */
export interface ProbeConfig {
	/** Credential sent only to Open Cloud. */
	readonly apiKey: string;
	/** Prepared operation requests to compare pairwise. */
	readonly requests: ReadonlyArray<ProbeRequest>;
}

/** Transport and wall-clock boundaries used by the live probe. */
export interface ProbeDeps {
	/** Raw transport without SDK admission or retries. */
	readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
	/** Current Unix time in milliseconds. */
	readonly now: () => number;
}

/** Safe raw response evidence; request headers and bodies are omitted. */
export interface Sample {
	/** Response observation time in Unix milliseconds. */
	readonly at: number;
	/** Operation key of the sampled request. */
	readonly family: string;
	/** Raw joined limit header. */
	readonly limit: null | string;
	/** Raw joined remaining header. */
	readonly remaining: null | string;
	/** Raw joined reset header. */
	readonly reset: null | string;
	/** HTTP status, retained even for rejected requests. */
	readonly status: number;
}

/** One pair's observed counter relation, valid only for isolated traffic. */
export interface PairResult {
	/** Whether all four requests succeeded downstream. */
	readonly allRequestsAccepted: boolean;
	/** Operation keys A and B. */
	readonly families: ReadonlyArray<string>;
	/** Raw evidence in A/B/B/A order. */
	readonly samples: ReadonlyArray<Sample>;
	/** Relation between the reported leading counters only. */
	readonly verdict: "inconclusive" | "separate" | "shared";
}

const INTEGER_PATTERN = /^\d+$/;

interface Reading {
	readonly at: number;
	readonly limit: number;
	readonly remaining: number;
	readonly reset: number;
}

/**
 * Reads prepared requests from an array or a previous capture's `requests`.
 *
 * @param raw - JSON containing only public request descriptions.
 * @returns At least two prepared requests, with no credential fields copied.
 */
export function parseRequests(raw: string): ReadonlyArray<ProbeRequest> {
	const parsed = JSON.parse(raw);
	const requests =
		typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? parsed["requests"]
			: parsed;
	if (!Array.isArray(requests) || requests.length < 2 || !requests.every(isRequest)) {
		throw new Error("expected at least two game-internationalization requests");
	}

	return requests.map(({ body, family, method, path }) => {
		return { body, family, method, path };
	});
}

/**
 * Issues A/B/B/A for each supplied family pair without SDK pacing or retries.
 *
 * @param config - One isolated API key and prepared requests.
 * @param deps - Raw HTTP transport and observation clock.
 * @returns Safe evidence for every pair; no key or request body is retained.
 */
export async function runProbeAsync(
	config: ProbeConfig,
	deps: ProbeDeps,
): Promise<ReadonlyArray<PairResult>> {
	const results: Array<PairResult> = [];
	const context = { config, deps };
	for (const [index, first] of config.requests.entries()) {
		const others = config.requests.slice(index + 1);
		for (const second of others) {
			const before = await sampleAsync(first, context);
			const otherBefore = await sampleAsync(second, context);
			const otherAfter = await sampleAsync(second, context);
			const after = await sampleAsync(first, context);
			const samples = [before, otherBefore, otherAfter, after] as const;
			results.push({
				allRequestsAccepted: samples.every(
					(sample) => sample.status >= 200 && sample.status < 300,
				),
				families: [first.family, second.family],
				samples,
				verdict: classify(samples),
			});
		}
	}

	return results;
}

function isRequest(value: JSONValue): value is JSONObject & ProbeRequest {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}

	const { body, family, method, path } = value;
	return (
		typeof family === "string" &&
		(method === "GET" || method === "PATCH" || method === "POST") &&
		typeof path === "string" &&
		path.startsWith("/legacy-game-internationalization/v1/") &&
		(body === undefined || (typeof body === "object" && body !== null && !Array.isArray(body)))
	);
}

function leadingInteger(raw: null | string): number | undefined {
	const token = raw?.split(",", 1)[0]?.trim();
	if (token === undefined || !INTEGER_PATTERN.test(token)) {
		return undefined;
	}

	const value = Number(token);
	return Number.isSafeInteger(value) ? value : undefined;
}

function reading(sample: Sample): Reading | undefined {
	const limit = leadingInteger(sample.limit);
	const remaining = leadingInteger(sample.remaining);
	const reset = leadingInteger(sample.reset);
	if (
		limit === undefined ||
		limit === 0 ||
		remaining === undefined ||
		reset === undefined ||
		reset === 0 ||
		remaining > limit
	) {
		return undefined;
	}

	return { at: sample.at, limit, remaining, reset };
}

function sameWindow(readings: ReadonlyArray<Reading>): boolean {
	const expiries = readings.map((value) => value.at + value.reset * 1000);
	const lastAt = Math.max(...readings.map((value) => value.at));
	return (
		Math.max(...expiries) - Math.min(...expiries) <= 1000 &&
		Math.min(...expiries) > lastAt + 1000
	);
}

function classifyReadings(
	readings: readonly [Reading, Reading, Reading, Reading],
): PairResult["verdict"] {
	const [before, otherBefore, otherAfter, after] = readings;
	if (
		!sameWindow(readings) ||
		before.limit !== after.limit ||
		otherBefore.limit !== otherAfter.limit
	) {
		return "inconclusive";
	}

	const otherDrop = otherBefore.remaining - otherAfter.remaining;
	if (otherDrop !== 1) {
		return "inconclusive";
	}

	const drop = before.remaining - after.remaining;
	if (drop === 1) {
		return "separate";
	}

	return drop === 3 &&
		before.limit === otherBefore.limit &&
		before.remaining - otherBefore.remaining === 1 &&
		otherAfter.remaining - after.remaining === 1
		? "shared"
		: "inconclusive";
}

function classify(samples: readonly [Sample, Sample, Sample, Sample]): PairResult["verdict"] {
	if (
		samples.some(
			(sample) => sample.status < 200 || sample.status >= 500 || sample.status === 429,
		)
	) {
		return "inconclusive";
	}

	const [before, otherBefore, otherAfter, after] = samples.map(reading);
	if (
		before === undefined ||
		otherBefore === undefined ||
		otherAfter === undefined ||
		after === undefined
	) {
		return "inconclusive";
	}

	return classifyReadings([before, otherBefore, otherAfter, after]);
}

async function sampleAsync(
	request: ProbeRequest,
	{ config, deps }: { readonly config: ProbeConfig; readonly deps: ProbeDeps },
): Promise<Sample> {
	const response = await deps.fetch(`https://apis.roblox.com${request.path}`, {
		...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
		headers: { "content-type": "application/json", "x-api-key": config.apiKey },
		method: request.method,
	});
	await response.text();
	return {
		at: deps.now(),
		family: request.family,
		limit: response.headers.get("x-ratelimit-limit"),
		remaining: response.headers.get("x-ratelimit-remaining"),
		reset: response.headers.get("x-ratelimit-reset"),
		status: response.status,
	};
}

if (import.meta.main) {
	const apiKey = process.env["ROBLOX_API_KEY"];
	const requestFile = process.env["PROBE_REQUESTS_FILE"];
	if (apiKey === undefined || requestFile === undefined) {
		throw new Error("ROBLOX_API_KEY and PROBE_REQUESTS_FILE must be set");
	}

	const requests = parseRequests(await readFile(requestFile, "utf8"));
	const results = await runProbeAsync({ apiKey, requests }, { fetch, now: Date.now });
	console.log(JSON.stringify({ requests, results }, undefined, 2));
}
