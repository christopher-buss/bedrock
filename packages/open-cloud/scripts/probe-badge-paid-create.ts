// Captures who pays for a badge create once the free quota is spent, and how
// the create reacts to each expectedCost.
//
//   - GET  badges.roblox.com/v1/badges/metadata
//   - GET  badges.roblox.com/v1/universes/{id}/free-badges-quota
//   - GET  apis.roblox.com/cloud/v2/universes/{id}
//   - POST apis.roblox.com/legacy-badges/v1/universes/{id}/badges
//
// Questions the capture answers:
//
//   1. With a User payment source, whose Robux pays: the API key owner or the
//      universe owner? (Check each owner's Robux transactions after the run.)
//   2. On a group-owned universe, can a User payment source pay at all, or
//      does Roblox refuse it (code 16)?
//   3. Once the quota is 0, does expectedCost=0 still give code 18 and no
//      charge?
//   4. With `PROBE_PAYMENT_SOURCE=2`, does a Group payment source pay from
//      group funds when the API key is owned by a user?
//
// Steps: read price, quota and universe owner; spend the remaining free quota
// with expectedCost=0 creates; send one create with expectedCost=0 (expects
// code 18); then send one create with expectedCost=<price>. Every create uses
// isActive=false and paymentSourceType=1 (user), or 2 (group) when
// `PROBE_PAYMENT_SOURCE=2`.
//
// Safety: the paid create runs only when `--confirm-spend <n>` equals the live
// badgeCreationPrice. The script stops on any unexpected status. Badges are
// permanent: point it at a test universe.
//
// Run with:
// ROBLOX_API_KEY=<key with legacy-universe.badge:manage-and-spend-robux> \
// ROBLOX_PROBE_UNIVERSE_ID=<universe id> \
// bun packages/open-cloud/scripts/probe-badge-paid-create.ts --confirm-spend 100
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
const CLOUD_BASE = "https://apis.roblox.com/cloud/v2";
const MAX_FREE_CREATES = 5;

const COST_MISMATCH_PATTERN = /"code"\s*:\s*18\b/;
const STAMP_PATTERN = /[:.]/g;
const PRICE_PATTERN = /"badgeCreationPrice"\s*:\s*(\d+)/;
const OWNER_PATTERN = /"((?:users|groups)\/\d+)"/;

interface Credentials {
	readonly apiKey: string;
	/**
	 * Wire value of `paymentSourceType`: `"1"` user funds, `"2"` group funds.
	 */
	readonly paymentSource: "1" | "2";
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
	readonly credentials: Credentials;
	readonly expectedCost: number;
	readonly heading: string;
	readonly label: string;
}

function requireEnvironment(): Credentials {
	const apiKey = process.env["ROBLOX_API_KEY"];
	const universeId = process.env["ROBLOX_PROBE_UNIVERSE_ID"];
	if (apiKey === undefined || apiKey === "" || universeId === undefined || universeId === "") {
		throw new Error("ROBLOX_API_KEY and ROBLOX_PROBE_UNIVERSE_ID are required");
	}

	const source = process.env["PROBE_PAYMENT_SOURCE"];
	if (source !== undefined && source !== "1" && source !== "2") {
		throw new Error(`PROBE_PAYMENT_SOURCE must be "1" or "2", got ${JSON.stringify(source)}`);
	}

	return { apiKey, paymentSource: source ?? "1", universeId };
}

function readConfirmedSpend(): number | undefined {
	const index = process.argv.indexOf("--confirm-spend");
	if (index === -1) {
		return undefined;
	}

	const operand = process.argv[index + 1];
	const value = Number(operand);
	if (operand === undefined || !Number.isInteger(value) || value <= 0) {
		throw new Error(`--confirm-spend needs a positive integer, got ${JSON.stringify(operand)}`);
	}

	return value;
}

async function call({ heading, init = {}, url }: CallOptions): Promise<Capture> {
	const started = new Date();
	const response = await fetch(url, init);
	const body = await response.text();
	console.log(`\n=== ${heading}`);
	console.log(`${init.method ?? "GET"} ${url}`);
	console.log(`at ${started.toISOString()}  status ${response.status}`);
	console.log(`body: ${body}`);
	return { body, status: response.status };
}

async function readPrice(): Promise<number | undefined> {
	const result = await call({ heading: "1 metadata", url: `${BADGES_BASE}/v1/badges/metadata` });
	if (result.status !== 200) {
		return undefined;
	}

	const match = PRICE_PATTERN.exec(result.body);
	return match?.[1] === undefined ? undefined : Number(match[1]);
}

async function readQuota(heading: string, universeId: string): Promise<number | undefined> {
	const result = await call({
		heading,
		url: `${BADGES_BASE}/v1/universes/${universeId}/free-badges-quota`,
	});
	const parsed = Number(result.body);
	return result.status === 200 && Number.isFinite(parsed) ? parsed : undefined;
}

async function readOwner({ apiKey, universeId }: Credentials): Promise<void> {
	const result = await call({
		heading: "3 universe owner",
		init: { headers: { "x-api-key": apiKey } },
		url: `${CLOUD_BASE}/universes/${universeId}`,
	});
	const owner = OWNER_PATTERN.exec(result.body)?.[1];
	console.log(`owner: ${owner ?? "unknown"}`);
}

async function create({
	credentials,
	expectedCost,
	heading,
	label,
}: CreateOptions): Promise<Capture> {
	const { apiKey, paymentSource, universeId } = credentials;
	const now = new Date();
	const stamp = now.toISOString().replaceAll(STAMP_PATTERN, "-");
	const form = new FormData();
	form.append("name", `bedrock-probe-${label}-${stamp}`);
	form.append("description", "bedrock paid-create probe");
	form.append("paymentSourceType", paymentSource);
	form.append("expectedCost", String(expectedCost));
	form.append("isActive", "false");
	form.append("files", new Blob([ICON_BYTES], { type: "image/png" }), "icon.png");
	return call({
		heading,
		init: { body: form, headers: { "x-api-key": apiKey }, method: "POST" },
		url: `${CREATE_BASE}/v1/universes/${universeId}/badges`,
	});
}

/**
 * Sends one zero-cost create and reads the quota after it.
 *
 * @param credentials - Key and universe to create in.
 * @param attempt - One-based create number, for the log.
 * @returns The quota after the create, or undefined when the run must stop.
 */
async function freeCreate(credentials: Credentials, attempt: number): Promise<number | undefined> {
	const result = await create({
		credentials,
		expectedCost: 0,
		heading: `4 free create #${attempt}`,
		label: `free-${attempt}`,
	});
	if (result.status !== 200) {
		console.log("STOP: free create failed");
		return undefined;
	}

	const next = await readQuota(`4 quota after free create #${attempt}`, credentials.universeId);
	if (next === undefined) {
		console.log("STOP: quota unreadable");
	}

	return next;
}

/**
 * Spends the remaining free quota with zero-cost creates.
 *
 * @param credentials - Key and universe to create in.
 * @param initialQuota - Quota read before the first create.
 * @returns True when the quota reached zero, false when the run must stop.
 */
async function spendFreeQuota(credentials: Credentials, initialQuota: number): Promise<boolean> {
	let quota: number | undefined = initialQuota;
	let attempt = 0;
	while (quota !== undefined && quota > 0) {
		attempt++;
		if (attempt > MAX_FREE_CREATES) {
			console.log("STOP: quota did not reach zero within the free create cap");
			return false;
		}

		quota = await freeCreate(credentials, attempt);
	}

	return quota === 0;
}

/**
 * Reads the price, quota and owner, then spends the remaining free quota.
 *
 * @param credentials - Key and universe to create in.
 * @returns The live badge price once the quota is zero, or undefined when the
 *   run must stop.
 */
async function prepare(credentials: Credentials): Promise<number | undefined> {
	const price = await readPrice();
	if (price === undefined) {
		console.log("STOP: price unreadable");
		return undefined;
	}

	const quota = await readQuota("2 initial quota", credentials.universeId);
	if (quota === undefined) {
		console.log("STOP: quota unreadable");
		return undefined;
	}

	await readOwner(credentials);
	return (await spendFreeQuota(credentials, quota)) ? price : undefined;
}

async function refusesZeroCost(credentials: Credentials): Promise<boolean> {
	const zero = await create({
		credentials,
		expectedCost: 0,
		heading: "5 zero-cost create with quota 0 (expect code 18)",
		label: "zero",
	});
	if (zero.status === 200 || !COST_MISMATCH_PATTERN.test(zero.body)) {
		console.log("STOP: zero-cost create did not give code 18");
		return false;
	}

	return true;
}

async function main(): Promise<void> {
	const credentials = requireEnvironment();
	const confirmed = readConfirmedSpend();
	console.log(`universe ${credentials.universeId}`);

	const price = await prepare(credentials);
	if (price === undefined) {
		return;
	}

	if (!(await refusesZeroCost(credentials))) {
		return;
	}

	if (confirmed !== price) {
		console.log(`STOP: paid create needs --confirm-spend ${price}`);
		return;
	}

	await create({
		credentials,
		expectedCost: price,
		heading: `6 paid create, expectedCost ${price}`,
		label: "paid",
	});
	await readQuota("7 final quota", credentials.universeId);
	console.log("\nCheck the Robux transactions of the key owner and the universe owner.");
}

await main();
