// Captures the live wire behaviour of the free-badge quota and how badge
// creation reacts when that quota runs out.
//
//   - GET  badges.roblox.com/v1/universes/{id}/free-badges-quota
//   - GET  badges.roblox.com/v1/badges/metadata
//   - POST apis.roblox.com/legacy-badges/v1/universes/{id}/badges
//
// Questions the capture answers:
//
//   1. Does the quota endpoint need auth? Does an API key change the answer?
//   2. Which headers come back (rate limit, cache, reset hints)?
//   3. How many quota reads fit before a 429, and how does it recover?
//   4. What does the metadata body hold (badgeCreationPrice etc.)?
//   5. Does each free create decrement the quota by one?
//   6. What does a create with expectedCost=0 return once the quota is 0?
//
// Safety: every create sends expectedCost=0 and paymentSourceType=1
// (user). The script stops on 403 code 17 or any hint of a charge.
// Badges are permanent: point it at a test universe.
//
// Run with:
// ROBLOX_API_KEY=<key with legacy-universe.badge:write> \
// ROBLOX_TEST_UNIVERSE_ID=<universe id> \
// bun packages/open-cloud/scripts/probe-badge-free-quota.ts
//
// The script never writes to the repo. Pipe stdout to a file to keep the
// capture (`... | tee probe.log`).

import process from "node:process";

// A minimal valid PNG, copied from the core redacted-icon placeholder so the
// script stays inside this package.
const ICON_BYTES = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x40, 0x08, 0x00, 0x00, 0x00, 0x00, 0x8f, 0x02, 0x2e,
	0x02, 0x00, 0x00, 0x00, 0x89, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0xed, 0x56, 0xd1, 0x0e, 0x80,
	0x20, 0x08, 0xf4, 0x53, 0xfc, 0x94, 0xfe, 0xff, 0xa7, 0xae, 0x25, 0x62, 0x82, 0xbd, 0x14, 0x6e,
	0x39, 0x77, 0x6c, 0x1a, 0xc2, 0xbc, 0x40, 0x0f, 0x2a, 0xe5, 0xa0, 0xa4, 0x0d, 0x00, 0x8e, 0xa0,
	0x2c, 0x90, 0x02, 0x01, 0xc8, 0x03, 0xf2, 0x60, 0x52, 0x2d, 0xb0, 0x1f, 0xb0, 0xa1, 0xf4, 0x3c,
	0x00, 0x00, 0x99, 0x51, 0xf5, 0xeb, 0xa1, 0x8e, 0xdb, 0xde, 0xbc, 0xfe, 0xbb, 0x80, 0x32, 0xe0,
	0x74, 0xb5, 0xa8, 0xcd, 0x6a, 0x86, 0xca, 0x71, 0x00, 0x00, 0x6d, 0x96, 0xad, 0x65, 0x61, 0x00,
	0x3a, 0xef, 0x43, 0x04, 0xfe, 0x1d, 0xef, 0x53, 0xa8, 0xe8, 0xb1, 0x33, 0x90, 0xb0, 0xfb, 0x50,
	0x65, 0xd1, 0x52, 0x50, 0xef, 0x00, 0xf0, 0x55, 0xd8, 0x0f, 0xd8, 0x0f, 0xc8, 0x83, 0x59, 0xc5,
	0xb4, 0x01, 0x00, 0xff, 0x0f, 0x56, 0xb8, 0x05, 0x02, 0xe4, 0xff, 0xcf, 0xe0, 0x04, 0xe9, 0xf3,
	0xa6, 0xdb, 0xea, 0x95, 0x15, 0x74, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
	0x60, 0x82,
]);

const BADGES_BASE = "https://badges.roblox.com";
const CREATE_BASE = "https://apis.roblox.com/legacy-badges";
const RATE_LIMIT_CALLS = 60;
const RATE_LIMIT_INTERVAL_MS = 250;
const MAX_CREATES = 5;

const CHARGE_CODE_PATTERN = /"code"\s*:\s*17/;
const CHARGE_WORD_PATTERN = /robux|charge|funds|cost/i;
const STAMP_PATTERN = /[:.]/g;
const RATE_HEADER_PATTERN = /ratelimit|retry-after|rate/i;

interface Credentials {
	readonly apiKey: string;
	readonly universeId: string;
}

interface Capture {
	readonly body: string;
	readonly status: number;
}

interface CallOptions {
	readonly heading: string;
	readonly init?: RequestInit;
	readonly url: string;
}

interface CreateOptions {
	readonly attempt: number;
	readonly credentials: Credentials;
	readonly heading: string;
}

function requireEnvironment(): Credentials {
	const apiKey = process.env["ROBLOX_API_KEY"];
	const universeId = process.env["ROBLOX_TEST_UNIVERSE_ID"];
	if (apiKey === undefined || apiKey === "" || universeId === undefined || universeId === "") {
		throw new Error("ROBLOX_API_KEY and ROBLOX_TEST_UNIVERSE_ID are required");
	}

	return { apiKey, universeId };
}

async function sleep(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(() => {
			resolve();
		}, ms);
	});
}

async function call({
	heading,
	init = {},
	url,
}: CallOptions): Promise<Capture & { headers: Headers }> {
	const started = new Date();
	const t0 = performance.now();
	const response = await fetch(url, init);
	const body = await response.text();
	const latency = Math.round(performance.now() - t0);
	console.log(`\n=== ${heading}`);
	console.log(`${init.method ?? "GET"} ${url}`);
	console.log(`at ${started.toISOString()}  status ${response.status}  ${latency}ms`);
	for (const [name, value] of response.headers) {
		console.log(`  ${name}: ${value}`);
	}

	console.log(`body: ${body}`);
	return { body, headers: response.headers, status: response.status };
}

function quotaUrl(universeId: string): string {
	return `${BADGES_BASE}/v1/universes/${universeId}/free-badges-quota`;
}

async function readQuota(heading: string, universeId: string): Promise<number | undefined> {
	let result = await call({ heading, url: quotaUrl(universeId) });
	for (let attempt = 0; result.status === 429 && attempt < 3; attempt++) {
		const reset = Number(result.headers.get("x-ratelimit-reset"));
		const waitMs = (Number.isFinite(reset) && reset > 0 ? reset + 1 : 60) * 1000;
		console.log(`429 on quota read; waiting ${waitMs}ms`);
		await sleep(waitMs);
		result = await call({ heading: `${heading} (retry)`, url: quotaUrl(universeId) });
	}

	const parsed = Number(result.body);
	return result.status === 200 && Number.isFinite(parsed) ? parsed : undefined;
}

function looksLikeCharge(capture: Capture): boolean {
	if (capture.status === 403 && CHARGE_CODE_PATTERN.test(capture.body)) {
		return true;
	}

	return CHARGE_WORD_PATTERN.test(capture.body) && capture.status < 300;
}

async function create({ attempt, credentials, heading }: CreateOptions): Promise<Capture> {
	const { apiKey, universeId } = credentials;
	const now = new Date();
	const stamp = now.toISOString().replaceAll(STAMP_PATTERN, "-");
	const form = new FormData();
	form.append("name", `bedrock-probe-quota-${stamp}-${attempt}`);
	form.append("description", "bedrock free-quota probe");
	form.append("paymentSourceType", "1");
	form.append("expectedCost", "0");
	form.append("isActive", "false");
	const icon = new Blob([ICON_BYTES], { type: "image/png" });
	form.append("files", icon, "icon.png");
	return call({
		heading,
		init: { body: form, headers: { "x-api-key": apiKey }, method: "POST" },
		url: `${CREATE_BASE}/v1/universes/${universeId}/badges`,
	});
}

async function discoverRateLimit(universeId: string): Promise<void> {
	console.log("\n=== A4 rate limit discovery");
	for (let index = 1; index <= RATE_LIMIT_CALLS; index++) {
		const now = new Date();
		const at = now.toISOString();
		const response = await fetch(quotaUrl(universeId));
		const body = await response.text();
		const rl = [...response.headers]
			.filter(([name]) => RATE_HEADER_PATTERN.test(name))
			.map(([name, value]) => `${name}=${value}`)
			.join(" ");
		console.log(`#${index} ${at} ${response.status} body=${body} ${rl}`);
		if (response.status === 429) {
			for (const [name, value] of response.headers) {
				console.log(`  ${name}: ${value}`);
			}

			const retry = Number(response.headers.get("retry-after"));
			const waitMs = Number.isFinite(retry) && retry > 0 ? retry * 1000 : 60_000;
			console.log(`429 after ${index} calls; waiting ${waitMs}ms`);
			if (index < RATE_LIMIT_CALLS) {
				await sleep(waitMs);
				await call({ heading: "A4 recovery", url: quotaUrl(universeId) });
			}

			break;
		}

		await sleep(RATE_LIMIT_INTERVAL_MS);
	}
}

async function phaseA({ apiKey, universeId }: Credentials): Promise<void> {
	console.log(`universe ${universeId}`);
	await call({ heading: "A1 quota, no auth", url: quotaUrl(universeId) });
	await call({
		heading: "A2 quota, x-api-key",
		init: { headers: { "x-api-key": apiKey } },
		url: quotaUrl(universeId),
	});
	await call({ heading: "A3 metadata, no auth", url: `${BADGES_BASE}/v1/badges/metadata` });
	await discoverRateLimit(universeId);
	await call({ heading: "A5 invalid universe", url: quotaUrl("1") });
}

/**
 * Creates free badges until the quota reaches zero or the cap is hit.
 *
 * @param credentials - Key and universe to create in.
 * @param initialQuota - Quota read before the first create.
 * @returns The number of creates made, or undefined when the run must stop.
 */
async function createWhileFree(
	credentials: Credentials,
	initialQuota: number,
): Promise<number | undefined> {
	let quota: number | undefined = initialQuota;
	let attempt = 0;
	while (quota > 0 && attempt < MAX_CREATES) {
		attempt++;
		const result = await create({ attempt, credentials, heading: `B2 create #${attempt}` });
		if (looksLikeCharge(result) || result.status === 403) {
			console.log("STOP: unexpected 403 or charge hint");
			return undefined;
		}

		quota = await readQuota(`B2 quota after create #${attempt}`, credentials.universeId);
		if (quota === undefined) {
			console.log("STOP: quota unreadable");
			return undefined;
		}
	}

	return attempt;
}

async function phaseB(credentials: Credentials): Promise<void> {
	const quota = await readQuota("B1 initial quota", credentials.universeId);
	console.log(`initial quota: ${quota}`);
	if (quota === undefined) {
		console.log("STOP: quota unreadable");
		return;
	}

	let attempt = await createWhileFree(credentials, quota);
	if (attempt === undefined) {
		return;
	}

	attempt++;
	const over = await create({
		attempt,
		credentials,
		heading: `B3 over-quota create #${attempt}`,
	});
	if (looksLikeCharge(over)) {
		console.log("STOP: charge hint on over-quota create");
	}

	await readQuota("B3 final quota", credentials.universeId);
}

const credentials = requireEnvironment();
// `PROBE_PHASE=B` skips phase A, so phase B starts with a full read budget.
if (process.env["PROBE_PHASE"] !== "B") {
	await phaseA(credentials);
}

await phaseB(credentials);
