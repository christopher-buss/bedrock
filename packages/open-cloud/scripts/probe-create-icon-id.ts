// Captures the icon id that badge and game pass creates return, with and
// without an icon, and how that id changes in the reads that follow.
//
//   - POST apis.roblox.com/legacy-badges/v1/universes/{id}/badges
//   - GET  badges.roblox.com/v1/badges/{id}
//   - POST apis.roblox.com/game-passes/v1/universes/{id}/game-passes
//   - GET  apis.roblox.com/game-passes/v1/universes/{id}/game-passes/{id}/creator
//
// Questions the capture answers:
//
//   1. A badge created without `files`: does it get a default icon, and
//      is `iconImageId` 0 in the create response or in later reads?
//   2. A game pass created without `imageFile`: same questions for
//      `iconAssetId`.
//   3. A create with an icon: is the icon id ever 0 right after the
//      create, for example while the image is processed?
//
// Safety: every badge create sends expectedCost=0 and paymentSourceType=1
// (user). The script reads the free quota first and skips the badge creates
// when fewer than two free creates are left. Game passes are created off
// sale. Badges and game passes are permanent: point it at a test universe.
//
// Run with:
// ROBLOX_API_KEY=<key with legacy-universe.badge:write, game-pass:read+write> \
// ROBLOX_TEST_UNIVERSE_ID=<universe id> \
// bun packages/open-cloud/scripts/probe-create-icon-id.ts
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

const API_BASE = "https://apis.roblox.com";
const BADGES_BASE = "https://badges.roblox.com";

// Seconds after the create at which each read runs.
const READ_SCHEDULE_S = [0, 5, 15, 30, 60, 120] as const;

const STAMP_PATTERN = /[:.]/g;

interface Credentials {
	readonly apiKey: string;
	readonly universeId: string;
}

interface Capture {
	readonly body: string;
	readonly status: number;
}

interface Created {
	readonly id: string;
	readonly createdAt: number;
	readonly iconField: string;
	readonly label: string;
	readonly read: () => Promise<Capture>;
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
}: {
	readonly heading: string;
	readonly init?: RequestInit;
	readonly url: string;
}): Promise<Capture> {
	const started = new Date();
	const response = await fetch(url, init);
	const body = await response.text();
	console.log(`\n=== ${heading}`);
	console.log(`${init.method ?? "GET"} ${url}`);
	console.log(`at ${started.toISOString()}  status ${response.status}`);
	console.log(`body: ${body}`);
	return { body, status: response.status };
}

function field(body: string, name: string): JSONValue | undefined {
	try {
		const parsed = JSON.parse(body);
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			return parsed[name];
		}
	} catch {
		// Not JSON; the raw body is already logged.
	}

	return undefined;
}

function idField(body: string, name: string): string | undefined {
	const value = field(body, name);
	return typeof value === "number" || typeof value === "string" ? String(value) : undefined;
}

function stamp(): string {
	const now = new Date();
	return now.toISOString().slice(11, 19).replaceAll(STAMP_PATTERN, "");
}

function iconBlob(): Blob {
	return new Blob([ICON_BYTES], { type: "image/png" });
}

async function readFreeQuota(universeId: string): Promise<number | undefined> {
	const capture = await call({
		heading: "free badge quota",
		url: `${BADGES_BASE}/v1/universes/${universeId}/free-badges-quota`,
	});
	const parsed = Number(capture.body);
	return capture.status === 200 && Number.isFinite(parsed) ? parsed : undefined;
}

function badgeForm({
	label,
	withIcon,
}: {
	readonly label: string;
	readonly withIcon: boolean;
}): FormData {
	const form = new FormData();
	form.append("name", `bedrock-icon-${label}-${stamp()}`);
	form.append("description", "bedrock create-icon-id probe");
	form.append("paymentSourceType", "1");
	form.append("expectedCost", "0");
	form.append("isActive", "false");
	if (withIcon) {
		form.append("files", iconBlob(), "icon.png");
	}

	return form;
}

async function createBadge(
	credentials: Credentials,
	{ label, withIcon }: { readonly label: string; readonly withIcon: boolean },
): Promise<Created | undefined> {
	const form = badgeForm({ label, withIcon });
	const capture = await call({
		heading: `create badge (${label})`,
		init: { body: form, headers: { "x-api-key": credentials.apiKey }, method: "POST" },
		url: `${API_BASE}/legacy-badges/v1/universes/${credentials.universeId}/badges`,
	});
	const id = idField(capture.body, "id");
	console.log(
		`>> create response iconImageId = ${JSON.stringify(field(capture.body, "iconImageId"))}`,
	);
	if (id === undefined || capture.status >= 300) {
		return undefined;
	}

	return {
		id,
		createdAt: Date.now(),
		iconField: "iconImageId",
		label: `badge (${label})`,
		read: async () => {
			return call({
				heading: `read badge (${label})`,
				url: `${BADGES_BASE}/v1/badges/${id}`,
			});
		},
	};
}

function gamePassForm({
	label,
	withIcon,
}: {
	readonly label: string;
	readonly withIcon: boolean;
}): FormData {
	const form = new FormData();
	form.append("name", `bedrock-icon-${label}-${stamp()}`);
	form.append("description", "bedrock create-icon-id probe");
	form.append("isForSale", "false");
	if (withIcon) {
		form.append("imageFile", iconBlob(), "icon.png");
	}

	return form;
}

async function createGamePass(
	credentials: Credentials,
	{ label, withIcon }: { readonly label: string; readonly withIcon: boolean },
): Promise<Created | undefined> {
	const base = `${API_BASE}/game-passes/v1/universes/${credentials.universeId}/game-passes`;
	const headers = { "x-api-key": credentials.apiKey };
	const capture = await call({
		heading: `create game pass (${label})`,
		init: { body: gamePassForm({ label, withIcon }), headers, method: "POST" },
		url: base,
	});
	const id = idField(capture.body, "gamePassId");
	console.log(
		`>> create response iconAssetId = ${JSON.stringify(field(capture.body, "iconAssetId"))}`,
	);
	if (id === undefined || capture.status >= 300) {
		return undefined;
	}

	return {
		id,
		createdAt: Date.now(),
		iconField: "iconAssetId",
		label: `game pass (${label})`,
		read: async () => {
			return call({
				heading: `read game pass (${label})`,
				init: { headers },
				url: `${base}/${id}/creator`,
			});
		},
	};
}

async function readOnSchedule(items: ReadonlyArray<Created>): Promise<void> {
	for (const offset of READ_SCHEDULE_S) {
		for (const item of items) {
			const wait = item.createdAt + offset * 1000 - Date.now();
			if (wait > 0) {
				await sleep(wait);
			}

			const capture = await item.read();
			console.log(
				`>> ${item.label} id ${item.id} at +${offset}s: ${item.iconField} = ${JSON.stringify(field(capture.body, item.iconField))}`,
			);
		}
	}
}

async function main(): Promise<void> {
	const credentials = requireEnvironment();
	const created: Array<Created> = [];

	const quota = await readFreeQuota(credentials.universeId);
	console.log(`>> free badge quota = ${String(quota)}`);
	if (quota !== undefined && quota >= 2) {
		for (const [label, withIcon] of [
			["no-icon", false],
			["with-icon", true],
		] as const) {
			const item = await createBadge(credentials, { label, withIcon });
			if (item !== undefined) {
				created.push(item);
			}
		}
	} else {
		console.log(">> skipping badge creates: fewer than two free creates left");
	}

	for (const [label, withIcon] of [
		["no-icon", false],
		["with-icon", true],
	] as const) {
		const item = await createGamePass(credentials, { label, withIcon });
		if (item !== undefined) {
			created.push(item);
		}
	}

	await readOnSchedule(created);
}

await main();
