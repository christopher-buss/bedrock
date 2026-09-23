// Captures the live Open Cloud wire shape of the four server-restart
// operations tracked by christopher-buss/bedrock#235, before any client
// code is written against them:
//
//   - `Cloud_RestartUniverseServers`
//     POST /cloud/v2/universes/{id}:restartServers (STABLE)
//   - `Restarts_LaunchRestart`
//     POST /server-management/v1/universes/{id}/restarts (BETA)
//   - `Restarts_ListRestartStatuses`
//     GET  /server-management/v1/universes/{id}/restarts (BETA)
//   - `Restarts_ForecastRestart`
//     GET  /server-management/v1/universes/{id}/restarts:forecast (BETA)
//
// Questions the capture answers:
//
//   1. Does the key's scope set reach each operation (401/403 shape)?
//   2. What does each success body really look like (empty `{}`? int64
//      as string or number? which nullable fields arrive as `null`)?
//   3. Which error envelope does each family use: Cloud v2
//      `{ code, message }` or ASP.NET `ProblemDetails`?
//   4. Which body constraints does the server enforce (bleed-off range,
//      `PlaceFilter` mutual exclusion, `attributes` size, unknown keys)?
//   5. Does a `:restartServers` call show up in the server-management
//      restart list, i.e. are the two launch paths one mechanism?
//   6. Which rate-limit headers come back, and do they match the schema?
//
// Safety: the read-only phase runs first. Mutating probes are skipped
// when the forecast fails or shows any live player in the universe,
// unless `PROBE_ALLOW_LIVE_PLAYERS=1` is set. Point it at a test universe.
//
// `PROBE_MODE=live` runs a separate phase instead, for a universe with a
// player in a live server: it captures real restart ids, forecast and
// status shapes, and every `RestartState`. It ends with a real restart,
// which moves the player to a new server. `PROBE_LIVE_VIA=cloud-v2`
// issues that final restart through `:restartServers` instead, to see
// whether the list reports it.
//
// Run with:
// ROBLOX_API_KEY=<key with universe:write + universe:read> \
// ROBLOX_TEST_UNIVERSE_ID=<universe id> \
// [ROBLOX_TEST_PLACE_ID=<place id>] \
// bun packages/open-cloud/scripts/probe-restart-servers.ts
//
// The script never writes to the repo. Pipe stdout to a file to keep the
// capture (`... | tee probe.log`).

import process from "node:process";

const API_BASE = "https://apis.roblox.com";

const ECHOED_HEADERS = [
	"content-type",
	"retry-after",
	"x-ratelimit-limit",
	"x-ratelimit-remaining",
	"x-ratelimit-reset",
] as const;

const INVALID_KEY = "bedrock-probe-invalid-key";

const OVERSIZED_ATTRIBUTE_LENGTH = 600;

const LIVE_POLL_INTERVAL_MS = 3000;

const LIVE_POLL_LIMIT = 60;

type Target = "forecast" | "restarts" | "restartServers";

interface Credentials {
	readonly apiKey: string;
	readonly placeId: string;
	readonly universeId: string;
}

interface Step {
	readonly apiKey?: string;
	readonly body?: JSONValue;
	readonly heading: string;
	readonly method?: "GET" | "POST";
	readonly target: Target;
	readonly universeId?: string;
}

interface ProbeResult {
	readonly body: unknown;
	readonly status: number;
}

function pathFor(target: Target, universeId: string): string {
	switch (target) {
		case "forecast": {
			return `/server-management/v1/universes/${universeId}/restarts:forecast`;
		}
		case "restarts": {
			return `/server-management/v1/universes/${universeId}/restarts`;
		}
		case "restartServers": {
			return `/cloud/v2/universes/${universeId}:restartServers`;
		}
	}
}

function parseOrUndefined(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/**
 * Issues one step and prints the request, echoed headers, and body.
 *
 * @param credentials - Key and universe the step defaults to.
 * @param step - The request to issue; `method` defaults to POST.
 * @returns The status and parsed body.
 */
async function call(credentials: Credentials, step: Step): Promise<ProbeResult> {
	const method = step.method ?? "POST";
	const body = step.body === undefined ? undefined : JSON.stringify(step.body);
	const json = body === undefined ? {} : { "content-type": "application/json" };
	const headers = { "x-api-key": step.apiKey ?? credentials.apiKey, ...json };
	const init: RequestInit = { headers, method, ...(body === undefined ? {} : { body }) };

	const path = pathFor(step.target, step.universeId ?? credentials.universeId);
	console.log(`\n=== ${step.heading} ===\n>>> ${method} ${path}`);
	if (body !== undefined) {
		console.log(`>>> body: ${body}`);
	}

	const response = await fetch(`${API_BASE}${path}`, init);
	const text = await response.text();
	console.log(`<<< status: ${response.status.toString()}`);
	for (const name of ECHOED_HEADERS) {
		const value = response.headers.get(name);
		if (value !== null) {
			console.log(`<<< ${name}: ${value}`);
		}
	}

	console.log(`<<< body: ${text.length === 0 ? "(empty)" : text}`);
	return { body: parseOrUndefined(text), status: response.status };
}

async function get(credentials: Credentials, step: Step): Promise<ProbeResult> {
	return call(credentials, { ...step, method: "GET" });
}

function requireEnvironment(name: string): string {
	const value = process.env[name];
	if (value === undefined || value.length === 0) {
		console.error(`missing ${name}`);
		process.exit(1);
	}

	return value;
}

async function discoverRootPlaceId(apiKey: string, universeId: string): Promise<string> {
	const response = await fetch(`${API_BASE}/cloud/v2/universes/${universeId}`, {
		headers: { "x-api-key": apiKey },
	});
	const parsed: unknown = await response.json();
	const rootPlace: unknown = Reflect.get(Object(parsed), "rootPlace");
	const placeId = typeof rootPlace === "string" ? rootPlace.split("/").at(-1) : undefined;
	if (placeId === undefined || placeId.length === 0) {
		console.error("could not discover root place id; set ROBLOX_TEST_PLACE_ID");
		process.exit(1);
	}

	return placeId;
}

function placeSummaries(forecast: unknown): ReadonlyArray<unknown> | undefined {
	const placeForecasts: unknown = Reflect.get(Object(forecast), "placeForecasts");
	if (placeForecasts === null || typeof placeForecasts !== "object") {
		return undefined;
	}

	return Object.values(placeForecasts);
}

/**
 * Sums `totalPlayers` across a forecast's places.
 *
 * @param forecast - The parsed forecast body.
 * @returns The player total, or `NaN` when the body is malformed, so a
 *   malformed forecast never reads as an empty universe.
 */
function countLivePlayers(forecast: unknown): number {
	const summaries = placeSummaries(forecast) ?? [NaN];
	return summaries.reduce<number>((total, summary) => {
		const players: unknown = Reflect.get(Object(summary), "totalPlayers");
		return typeof players === "number" && Number.isFinite(players) ? total + players : NaN;
	}, 0);
}

/**
 * Whether every live server runs its place's latest version, which makes
 * an old-versions-only restart select nothing.
 *
 * @param forecast - The parsed forecast body.
 * @returns `true` when no server runs an older version.
 */
function isEveryServerOnLatest(forecast: unknown): boolean {
	return (placeSummaries(forecast) ?? []).every((summary: unknown) => {
		const latest: unknown = Reflect.get(Object(summary), "latestPlaceVersion");
		const versions = Object.keys(Object(Reflect.get(Object(summary), "instancesPerVersion")));
		return versions.every((version) => version === latest);
	});
}

function restartIds(list: unknown): ReadonlySet<string> {
	return new Set(Object.keys(Object(Reflect.get(Object(list), "restartStatuses"))));
}

function hasNewRestartSucceeded(list: unknown, knownIds: ReadonlySet<string>): boolean {
	const statuses: unknown = Reflect.get(Object(list), "restartStatuses");
	const places = Object.entries(Object(statuses))
		.filter(([id]) => !knownIds.has(id))
		.flatMap(([, status]: [string, unknown]) => {
			return Object.values(Object(Reflect.get(Object(status), "placeRestartStatuses")));
		});
	return (
		places.length > 0 &&
		places.every((place: unknown) => Reflect.get(Object(place), "state") === "SUCCEEDED")
	);
}

const READ_ONLY_STEPS: ReadonlyArray<Step> = [
	{ heading: "R2 list restart statuses (shape before any launch)", target: "restarts" },
	{
		heading: "R3 forecast with non-numeric universe id (server-management 400 shape)",
		target: "forecast",
		universeId: "not-a-number",
	},
	{
		apiKey: INVALID_KEY,
		heading: "R4 forecast with invalid key (server-management 401 shape)",
		target: "forecast",
	},
];

const CLOUD_V2_VALIDATION_STEPS: ReadonlyArray<Step> = [
	{
		body: { bleedOffDurationMinutes: 0, bleedOffServers: true },
		heading: "V1 restartServers bleedOffDurationMinutes=0 (schema: 1-60)",
		target: "restartServers",
	},
	{
		body: { bleedOffDurationMinutes: 61, bleedOffServers: true },
		heading: "V2 restartServers bleedOffDurationMinutes=61 (schema: 1-60)",
		target: "restartServers",
	},
	{
		body: { placeIds: ["not-a-number"] },
		heading: "V3 restartServers non-numeric placeIds entry",
		target: "restartServers",
	},
	{
		body: { placeIds: ["1"] },
		heading: "V4 restartServers placeId outside the universe",
		target: "restartServers",
	},
];

const LAUNCH_VALIDATION_STEPS: ReadonlyArray<Step> = [
	{
		body: { bleedOffDurationMinutes: 0 },
		heading: "V5 launchRestart bleedOffDurationMinutes=0 (schema: 1-240)",
		target: "restarts",
	},
	{
		body: { bleedOffDurationMinutes: 241 },
		heading: "V6 launchRestart bleedOffDurationMinutes=241 (schema: 1-240)",
		target: "restarts",
	},
	{
		body: { attributes: ["not", "an", "object"] },
		heading: "V8 launchRestart attributes is an array (schema: JSON object)",
		target: "restarts",
	},
	{
		body: { attributes: { padding: "x".repeat(OVERSIZED_ATTRIBUTE_LENGTH) } },
		heading: "V9 launchRestart attributes over 500 bytes",
		target: "restarts",
	},
	{
		body: { bogusField: true },
		heading: "V10 launchRestart unknown key (schema: additionalProperties false)",
		target: "restarts",
	},
	{
		body: { places: { 1: {} } },
		heading: "V11 launchRestart place outside the universe",
		target: "restarts",
	},
];

function exclusiveFilterStep(placeId: string): Step {
	return {
		body: { places: { [placeId]: { excludeCurrentVersion: true, versions: [1] } } },
		heading: "V7 launchRestart versions + excludeCurrentVersion (mutually exclusive)",
		target: "restarts",
	};
}

function restartServersSteps(placeId: string): ReadonlyArray<Step> {
	return [
		{ body: {}, heading: "M1 restartServers empty body (defaults)", target: "restartServers" },
		{
			body: {
				bleedOffDurationMinutes: 1,
				bleedOffServers: true,
				closeAllVersions: true,
				placeIds: [Number(placeId)],
			},
			heading: "M2 restartServers every field set, placeIds as JSON numbers",
			target: "restartServers",
		},
		{
			body: { placeIds: [placeId] },
			heading: "M3 restartServers old versions only, placeIds as strings (500 when empty)",
			target: "restartServers",
		},
	];
}

function launchSteps(placeId: string): ReadonlyArray<Step> {
	return [
		{ body: {}, heading: "M5 launchRestart empty body", target: "restarts" },
		{
			body: {
				attributes: { reason: "bedrock-probe" },
				bleedOffDurationMinutes: 1,
				places: { [placeId]: { excludeCurrentVersion: true } },
			},
			heading: "M6 launchRestart every field set (excludeCurrentVersion: 500 when empty)",
			target: "restarts",
		},
		{
			body: { places: { [placeId]: { versions: [1] } } },
			heading: "M7 launchRestart PlaceFilter with explicit versions",
			target: "restarts",
		},
	];
}

function liveNoOpSteps(placeId: string): ReadonlyArray<Step> {
	return [
		{
			body: { placeIds: [Number(placeId)] },
			heading: "L1 restartServers old versions only, explicit place (500 on an empty place)",
			target: "restartServers",
		},
		{
			body: { places: { [placeId]: { excludeCurrentVersion: true } } },
			heading: "L2 launchRestart excludeCurrentVersion (500 on an empty place)",
			target: "restarts",
		},
		{
			body: { places: { [placeId]: { versions: [1] } } },
			heading: "L3 launchRestart version 1 only (selects nothing on a live head server)",
			target: "restarts",
		},
	];
}

const LIVE_RESTART_VIA_CLOUD_V2: Step = {
	body: { bleedOffDurationMinutes: 1, bleedOffServers: true, closeAllVersions: true },
	heading: "L4 restartServers every version, one-minute bleed-off",
	target: "restartServers",
};

const LIVE_RESTART_VIA_LAUNCH: Step = {
	body: { attributes: { reason: "bedrock-probe" }, bleedOffDurationMinutes: 1 },
	heading: "L4 launchRestart every server, one-minute bleed-off",
	target: "restarts",
};

async function runSteps(credentials: Credentials, steps: ReadonlyArray<Step>): Promise<void> {
	for (const step of steps) {
		await call(credentials, step);
	}
}

async function pollUntilSucceeded(
	credentials: Credentials,
	knownIds: ReadonlySet<string>,
): Promise<void> {
	for (let poll = 1; poll <= LIVE_POLL_LIMIT; poll++) {
		const heading = `L4-L${poll.toString()} poll restart status`;
		const result = await get(credentials, { heading, target: "restarts" });
		if (hasNewRestartSucceeded(result.body, knownIds)) {
			return;
		}

		await new Promise((resolve) => {
			setTimeout(resolve, LIVE_POLL_INTERVAL_MS);
		});
	}

	console.log("\n!!! poll expired before the new restart succeeded");
}

/**
 * Needs a player in a live server of the universe. Old-version-only
 * probes run first, and only when every live server runs the latest
 * version, so they select nothing. The final restart moves the player to
 * a new server after a one-minute bleed-off, and the list is polled until
 * that restart, and no earlier one, succeeds.
 *
 * @param credentials - Key, universe, and place to probe.
 * @param forecast - The forecast body read before any mutation.
 */
async function runLive(credentials: Credentials, forecast: unknown): Promise<void> {
	if (isEveryServerOnLatest(forecast)) {
		await runSteps(credentials, liveNoOpSteps(credentials.placeId));
	} else {
		console.log("\n!!! a live server runs an old version; skipping the no-op probes");
	}

	const before = await get(credentials, { heading: "L3-L list before L4", target: "restarts" });
	const viaCloudV2 = process.env["PROBE_LIVE_VIA"] === "cloud-v2";
	await call(credentials, viaCloudV2 ? LIVE_RESTART_VIA_CLOUD_V2 : LIVE_RESTART_VIA_LAUNCH);
	await get(credentials, { heading: "L4-F forecast during bleed-off", target: "forecast" });
	await pollUntilSucceeded(credentials, restartIds(before.body));
}

async function isStillEmpty(credentials: Credentials): Promise<boolean> {
	const forecast = await get(credentials, { heading: "recheck forecast", target: "forecast" });
	const isEmpty = forecast.status === 200 && countLivePlayers(forecast.body) === 0;
	if (!isEmpty && process.env["PROBE_ALLOW_LIVE_PLAYERS"] !== "1") {
		console.log("\n!!! a player joined or the forecast failed; stopping");
		return false;
	}

	return true;
}

async function runOffline(credentials: Credentials): Promise<void> {
	await runSteps(credentials, CLOUD_V2_VALIDATION_STEPS);
	await runSteps(credentials, LAUNCH_VALIDATION_STEPS);
	await call(credentials, exclusiveFilterStep(credentials.placeId));
	if (!(await isStillEmpty(credentials))) {
		return;
	}

	await runSteps(credentials, restartServersSteps(credentials.placeId));
	if (!(await isStillEmpty(credentials))) {
		return;
	}

	await runSteps(credentials, launchSteps(credentials.placeId));
	await get(credentials, { heading: "M-L list after all launches", target: "restarts" });
}

function explainLiveMode(): void {
	console.log("\n!!! live mode needs a player in a live server; join the experience first");
}

async function main(): Promise<void> {
	const apiKey = requireEnvironment("ROBLOX_API_KEY");
	const universeId = requireEnvironment("ROBLOX_TEST_UNIVERSE_ID");
	const placeId =
		process.env["ROBLOX_TEST_PLACE_ID"] ?? (await discoverRootPlaceId(apiKey, universeId));
	const credentials: Credentials = { apiKey, placeId, universeId };
	console.log(`universe=${universeId} place=${placeId}`);

	const forecast = await get(credentials, { heading: "R1 forecast", target: "forecast" });
	for (const step of READ_ONLY_STEPS) {
		await get(credentials, step);
	}

	const livePlayers = forecast.status === 200 ? countLivePlayers(forecast.body) : NaN;
	if (process.env["PROBE_MODE"] === "live") {
		if (livePlayers === 0 || Number.isNaN(livePlayers)) {
			explainLiveMode();
			return;
		}

		await runLive(credentials, forecast.body);
		return;
	}

	if (livePlayers === 0 || process.env["PROBE_ALLOW_LIVE_PLAYERS"] === "1") {
		await runOffline(credentials);
		return;
	}

	console.log("\n!!! forecast failed or shows live players; skipping mutating probes");
}

await main();
