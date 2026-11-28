// Captures how the Luau Execution API submits and reads session tasks at the
// head place version, for fixtures and for request-field checks.
//
// Endpoints, all on apis.roblox.com:
//
// - GET /cloud/v2/universes/{u} (start place, when no place id is given)
// - POST /cloud/v2/universes/{u}/places/{p}/luau-execution-session-tasks
// - GET /cloud/v2/{task path}
//
// Phases (first argument):
//
// - submit [timeout]: submit `return 1`, with the `timeout` string when one is
//   given, then poll the task until it reaches a terminal state. Every body is
//   printed, so the submit and terminal GET can be saved as fixtures.
// - timeouts [values...]: submit `return 1` once per `timeout` string (a
//   default set when none is given) and read each accepted task back once.
//   The summary names, per value, the submit status and the `timeout` the
//   submit and GET bodies return, or the error message of a refusal.
//
// Environment: ROBLOX_API_KEY (scopes universe.place.luau-execution-session
// :write and :read), ROBLOX_TEST_UNIVERSE_ID, and optional
// ROBLOX_TEST_PLACE_ID (defaults to the universe's start place). Submits are
// paced from the live `x-ratelimit-*` headers.
//
// Run with credentials in the environment (the repo-root .env works with bun):
// bun --conditions source
// packages/open-cloud/scripts/probe-luau-execution-tasks.ts timeouts
//
// The script never prints the API key and never writes to the repo. Pipe
// stdout to a file to keep the capture. Rate-limit headers are printed with
// every response.

import process from "node:process";

const apiKey = process.env["ROBLOX_API_KEY"] ?? "";
const universeId = process.env["ROBLOX_TEST_UNIVERSE_ID"] ?? "";
if (apiKey === "" || universeId === "") {
	throw new Error("ROBLOX_API_KEY and ROBLOX_TEST_UNIVERSE_ID are required");
}

const CLOUD = "https://apis.roblox.com/cloud/v2";
const DEFAULT_TIMEOUTS = ["5s", "5.5s", "0.5s", "300s", "301s", "PT5S", "5", "1m"];
/** Hold on a 429 that carries neither a reset nor a retry-after header. */
const FULL_WINDOW_MS = 60_000;
const INTEGER = /^\d+$/;
const MS_PER_SECOND = 1000;
const POLL_ATTEMPTS = 30;
const RATE_LIMIT_HEADER = /ratelimit|retry-after/i;
const SCRIPT = "return 1";
const TERMINAL_STATES = new Set(["CANCELLED", "COMPLETE", "FAILED"]);
const TOO_MANY_REQUESTS = 429;

interface Capture {
	readonly body: string;
	readonly headers: Headers;
	readonly status: number;
}

interface Request {
	readonly heading: string;
	readonly init?: RequestInit;
	readonly url: string;
}

interface TimeoutResult {
	readonly getTimeout: string | undefined;
	readonly refusal: string | undefined;
	readonly sent: string;
	readonly status: number;
	readonly submitTimeout: string | undefined;
}

async function sleep(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function call({ heading, init = {}, url }: Request): Promise<Capture> {
	const headers = new Headers(init.headers);
	headers.set("x-api-key", apiKey);
	const response = await fetch(url, { ...init, headers });
	const body = await response.text();
	const limits = [...response.headers].filter(([name]) => RATE_LIMIT_HEADER.test(name));
	console.log(`\n=== ${heading}`);
	console.log(`${init.method ?? "GET"} ${url}`);
	const now = new Date();
	console.log(`at ${now.toISOString()}  status ${response.status}`);
	console.log(`rate limits: ${JSON.stringify(Object.fromEntries(limits))}`);
	console.log(`body: ${body.slice(0, 50_000)}`);
	return { body, headers: response.headers, status: response.status };
}

function field(capture: Capture, name: string): unknown {
	let parsed: JSONValue;
	try {
		parsed = JSON.parse(capture.body);
	} catch {
		return undefined;
	}

	return typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, name) : undefined;
}

function textField(capture: Capture, name: string): string | undefined {
	const value = field(capture, name);
	return typeof value === "string" ? value : undefined;
}

/**
 * Reads the leading integer of a rate-limit header. `fetch` joins Roblox's
 * per-operation and global values under one name, and the per-operation
 * value comes first.
 *
 * @param value - Raw header value.
 * @returns The leading integer, or undefined when absent or unreadable.
 */
function leadingInteger(value: null | string): number | undefined {
	const token = value?.split(",", 1)[0]?.trim() ?? "";
	return INTEGER.test(token) ? Number(token) : undefined;
}

/**
 * Milliseconds to hold before the next submit, from the previous reply.
 * `x-ratelimit-reset` names the true window edge, so it wins; a 429 without
 * it falls back to `retry-after`, then to a full window.
 *
 * @param capture - The previous submit reply.
 * @returns The hold, or 0 while budget remains.
 */
function holdMs(capture: Capture): number {
	const reset = leadingInteger(capture.headers.get("x-ratelimit-reset"));
	if (reset !== undefined) {
		const remaining = leadingInteger(capture.headers.get("x-ratelimit-remaining"));
		const isSpent = capture.status === TOO_MANY_REQUESTS || remaining === 0;
		return isSpent ? (reset + 1) * MS_PER_SECOND : 0;
	}

	if (capture.status !== TOO_MANY_REQUESTS) {
		return 0;
	}

	const retryAfter = leadingInteger(capture.headers.get("retry-after"));
	return retryAfter === undefined ? FULL_WINDOW_MS : retryAfter * MS_PER_SECOND;
}

async function resolvePlaceId(): Promise<string> {
	const configured = process.env["ROBLOX_TEST_PLACE_ID"] ?? "";
	if (configured !== "") {
		return configured;
	}

	const universe = await call({
		heading: "read universe",
		url: `${CLOUD}/universes/${universeId}`,
	});
	const placeId = textField(universe, "rootPlace")?.split("/").pop();
	if (placeId === undefined) {
		throw new Error("the universe read named no start place");
	}

	return placeId;
}

async function submit(placeId: string, timeout: string | undefined): Promise<Capture> {
	const body = timeout === undefined ? { script: SCRIPT } : { script: SCRIPT, timeout };
	for (;;) {
		const capture = await call({
			heading: `submit, timeout ${JSON.stringify(timeout)}`,
			init: {
				body: JSON.stringify(body),
				headers: { "content-type": "application/json" },
				method: "POST",
			},
			url: `${CLOUD}/universes/${universeId}/places/${placeId}/luau-execution-session-tasks`,
		});
		const wait = holdMs(capture);
		if (wait > 0) {
			console.log(`holding ${wait} ms for the submit window`);
			await sleep(wait);
		}

		if (capture.status !== TOO_MANY_REQUESTS) {
			return capture;
		}
	}
}

async function readTask(path: string): Promise<Capture> {
	return call({ heading: `read task ${path}`, url: `${CLOUD}/${path}` });
}

async function submitAndPoll(timeout: string | undefined): Promise<void> {
	const placeId = await resolvePlaceId();
	const submitted = await submit(placeId, timeout);
	const path = textField(submitted, "path");
	if (path === undefined || submitted.status !== 200) {
		return;
	}

	for (let attempt = 0, wait = 1000; attempt < POLL_ATTEMPTS; attempt++) {
		await sleep(wait);
		const polled = await readTask(path);
		if (TERMINAL_STATES.has(textField(polled, "state") ?? "")) {
			return;
		}

		wait = Math.min(wait * 1.5, 4000);
	}

	throw new Error(`task ${path} not terminal after ${POLL_ATTEMPTS} polls`);
}

async function probeTimeouts(values: ReadonlyArray<string>): Promise<void> {
	const placeId = await resolvePlaceId();
	const results: Array<TimeoutResult> = [];
	for (const sent of values) {
		const submitted = await submit(placeId, sent);
		const path = textField(submitted, "path");
		const read = path === undefined ? undefined : await readTask(path);
		const error = field(submitted, "message") ?? field(submitted, "error");
		results.push({
			getTimeout: read === undefined ? undefined : textField(read, "timeout"),
			refusal: submitted.status === 200 ? undefined : JSON.stringify(error),
			sent,
			status: submitted.status,
			submitTimeout: textField(submitted, "timeout"),
		});
	}

	console.log("\n=== summary");
	console.table(results);
}

const [phase, ...rest] = process.argv.slice(2);
if (phase === "submit") {
	await submitAndPoll(rest[0]);
} else if (phase === "timeouts") {
	await probeTimeouts(rest.length > 0 ? rest : DEFAULT_TIMEOUTS);
} else {
	throw new Error("usage: submit [timeout] | timeouts [values...]");
}
