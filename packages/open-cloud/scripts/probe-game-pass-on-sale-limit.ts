// Read-only capture for the game pass on-sale limit. Bedrock rejects a
// game pass create or update at Apply time when Open Cloud answers `400`
// "Game pass on-sale limit has already been reached". This probe checks
// whether a pre-Apply check is possible with GET requests only:
//
//   - `GamePasses_ListGamePassConfigsByUniverse`
//     GET /game-passes/v1/universes/{id}/game-passes/creator (BETA)
//   - `DeveloperProducts_ListDeveloperProductConfigsByUniverseV2`
//     GET /developer-products/v2/universes/{id}/developer-products/creator
//   - the no-auth public lists the Roblox website uses
//
// Questions the capture answers:
//
//   1. Which fields carry on-sale state (`isForSale`, price)?
//   2. How does pagination behave (default and maximum `pageSize`)?
//   3. Which response headers come back, including rate-limit headers?
//   4. Does any response carry the limit or a remaining count?
//   5. How many passes are on sale in the universe now?
//
// Safety: every request is a GET. The script never creates or updates a
// game pass or developer product, and never prints the API key.
//
// Run with:
// ROBLOX_API_KEY=<key with game-pass:read + developer-product:read> \
// ROBLOX_TEST_UNIVERSE_ID=<universe id> \
// bun packages/open-cloud/scripts/probe-game-pass-on-sale-limit.ts
//
// The script never writes to the repo. Pipe stdout to a file to keep the
// capture (`... | tee probe.log`).

import process from "node:process";

const API_BASE = "https://apis.roblox.com";

const GAMES_BASE = "https://games.roblox.com";

const HIDDEN_HEADERS = new Set(["set-cookie"]);

const BODY_PREVIEW_LENGTH = 1500;

const PAGE_LIMIT = 50;

const INVALID_KEY = "bedrock-probe-invalid-key";

interface Step {
	readonly apiKey?: string | undefined;
	readonly heading: string;
	readonly url: string;
}

interface ProbeResult {
	readonly body: unknown;
	readonly status: number;
}

interface CollectOptions {
	readonly apiKey: string;
	readonly base: string;
	readonly itemsField: string;
	readonly pageSize: number;
}

function parseOrUndefined(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/**
 * Issues one GET and prints the URL, every response header except
 * cookies, and a body preview. The key is sent as a header and never
 * printed.
 *
 * @param step - The request to issue.
 * @returns The status and parsed body.
 */
async function get(step: Step): Promise<ProbeResult> {
	const headers: Record<string, string> =
		step.apiKey === undefined ? {} : { "x-api-key": step.apiKey };
	console.log(`\n=== ${step.heading} ===\n>>> GET ${step.url}`);
	console.log(`>>> auth: ${step.apiKey === undefined ? "none" : "x-api-key (hidden)"}`);

	const response = await fetch(step.url, { headers });
	const text = await response.text();
	console.log(`<<< status: ${response.status.toString()}`);
	for (const [name, value] of response.headers) {
		if (!HIDDEN_HEADERS.has(name)) {
			console.log(`<<< ${name}: ${value}`);
		}
	}

	const preview =
		text.length > BODY_PREVIEW_LENGTH ? `${text.slice(0, BODY_PREVIEW_LENGTH)}...` : text;
	console.log(
		`<<< body (${text.length.toString()} chars): ${preview.length === 0 ? "(empty)" : preview}`,
	);
	return { body: parseOrUndefined(text), status: response.status };
}

function requireEnvironment(name: string): string {
	const value = process.env[name];
	if (value === undefined || value.length === 0) {
		console.error(`missing ${name}`);
		process.exit(1);
	}

	return value;
}

function arrayField(body: unknown, field: string): ReadonlyArray<unknown> {
	const value: unknown = Reflect.get(Object(body), field);
	return Array.isArray(value) ? value : [];
}

function stringField(body: unknown, field: string): string | undefined {
	const value: unknown = Reflect.get(Object(body), field);
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Walks every page of a cursor-paginated creator list.
 *
 * @param options - Key, list URL without query, items field, and page size.
 * @returns Every item across all pages and the page count.
 */
async function collectAll({
	apiKey,
	base,
	itemsField,
	pageSize,
}: CollectOptions): Promise<{ items: ReadonlyArray<unknown>; pages: number }> {
	const items: Array<unknown> = [];
	let pageToken: string | undefined;
	let pages = 0;
	do {
		const query = new URLSearchParams({ pageSize: pageSize.toString() });
		if (pageToken !== undefined) {
			query.append("pageToken", pageToken);
		}

		pages += 1;
		const heading = `${itemsField} page ${pages.toString()} (pageSize=${pageSize.toString()})`;
		const result = await get({ apiKey, heading, url: `${base}?${query.toString()}` });
		if (result.status !== 200) {
			break;
		}

		items.push(...arrayField(result.body, itemsField));
		pageToken = stringField(result.body, "nextPageToken");
	} while (pageToken !== undefined && pages < PAGE_LIMIT);

	return { items, pages };
}

function summarizePasses(passes: ReadonlyArray<unknown>): void {
	const onSale = passes.filter((pass) => Reflect.get(Object(pass), "isForSale") === true);
	const managed = passes.filter(
		(pass) => Reflect.get(Object(pass), "isManagedPricingEnabled") === true,
	);
	const keys = new Set(passes.flatMap((pass) => Object.keys(Object(pass))));
	console.log(
		`\n--- game passes: total=${passes.length.toString()} onSale=${onSale.length.toString()}`,
	);
	console.log(`--- managed pricing on: ${managed.length.toString()}`);
	console.log(`--- item fields: ${[...keys].sort().join(", ")}`);
}

function summarizeProducts(products: ReadonlyArray<unknown>): void {
	const onSale = products.filter((item) => Reflect.get(Object(item), "isForSale") === true);
	console.log(
		`\n--- developer products: total=${products.length.toString()} onSale=${onSale.length.toString()}`,
	);
}

async function probePasses(apiKey: string, universeId: string): Promise<void> {
	const passBase = `${API_BASE}/game-passes/v1/universes/${universeId}/game-passes/creator`;
	await get({ apiKey, heading: "P1 creator list, no query (default pageSize)", url: passBase });
	await get({
		apiKey,
		heading: "P2 creator list pageSize=1000 (max probe)",
		url: `${passBase}?pageSize=1000`,
	});
	await get({ apiKey: INVALID_KEY, heading: "P3 creator list, invalid key", url: passBase });

	const passes = await collectAll({
		apiKey,
		base: passBase,
		itemsField: "gamePasses",
		pageSize: 100,
	});
	console.log(`\n--- game pass pages walked: ${passes.pages.toString()}`);
	summarizePasses(passes.items);
}

async function probePublicLists(universeId: string): Promise<void> {
	await get({
		heading: "N1 public games list (no auth)",
		url: `${GAMES_BASE}/v1/games/${universeId}/game-passes?limit=100&sortOrder=Asc`,
	});
	await get({
		heading: "N2 public apis list (no auth)",
		url: `${API_BASE}/game-passes/v1/universes/${universeId}/game-passes?passView=Full&pageSize=100`,
	});
}

async function probeProducts(apiKey: string, universeId: string): Promise<void> {
	const productBase = `${API_BASE}/developer-products/v2/universes/${universeId}/developer-products/creator`;
	const products = await collectAll({
		apiKey,
		base: productBase,
		itemsField: "developerProducts",
		pageSize: 100,
	});
	console.log(`\n--- developer product pages walked: ${products.pages.toString()}`);
	summarizeProducts(products.items);
}

async function main(): Promise<void> {
	const apiKey = requireEnvironment("ROBLOX_API_KEY");
	const universeId = requireEnvironment("ROBLOX_TEST_UNIVERSE_ID");
	console.log(`universe=${universeId}`);
	await probePasses(apiKey, universeId);
	await probePublicLists(universeId);
	await probeProducts(apiKey, universeId);
}

await main();
