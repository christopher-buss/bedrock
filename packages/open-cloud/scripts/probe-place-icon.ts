// cspell:ignore IHDR IDAT IEND

// Captures how the Assets API sets, reads and removes a place's
// source-language icon, the icon players see for the place (and, on the
// start place, for the experience).
//
// Endpoints, all on apis.roblox.com:
//
// - GET /cloud/v2/universes/{u} (owner and start place)
// - POST /assets/v1/assets (create an OpenUse image)
// - GET /assets/v1/operations/{operationId}
// - GET /assets/v1/assets/{assetId}, with and without readMask
// - PATCH /assets/v1/assets/{placeId}?updateMask=icon
//
// Phases (first argument):
//
// - read: read the universe and its start place asset with no readMask,
//   readMask=icon and a wider readMask. Run this first and note the current
//   icon so you can put it back.
// - upload: create a square 512x512 OpenUse PNG owned by the universe owner,
//   then poll the operation until it is done.
// - set <placeId> <imageAssetId>: set the place icon, poll the operation, then
//   read the icon back.
// - remove <placeId>: send an empty icon, poll, then read the icon back.
// - moderation <imageAssetId>: read the image's moderation state.
//
// Safety: point it at a test universe. Images are permanent (the Assets API
// has no delete; archive hides one). `set` and `remove` change a live place
// icon: use `read` first and restore the old value with `set` or `remove`.
//
// Run with credentials in the environment (the repo-root .env works with bun):
// bun --conditions source packages/open-cloud/scripts/probe-place-icon.ts read
//
// The script never prints the API key and never writes to the repo. Pipe
// stdout to a file to keep the capture. Rate-limit headers are printed with
// every response.

import process from "node:process";
import { deflateSync } from "node:zlib";

const apiKey = process.env["ROBLOX_API_KEY"] ?? "";
const universeId = process.env["ROBLOX_TEST_UNIVERSE_ID"] ?? "";
if (apiKey === "" || universeId === "") {
	throw new Error("ROBLOX_API_KEY and ROBLOX_TEST_UNIVERSE_ID are required");
}

const APIS = "https://apis.roblox.com";
const ASSETS = `${APIS}/assets/v1`;
const ICON_SIZE = 512;
const POLL_ATTEMPTS = 30;
const RATE_LIMIT_HEADER = /ratelimit|retry-after/i;
const encoder = new TextEncoder();

interface Capture {
	readonly body: string;
	readonly status: number;
}

interface Request {
	readonly heading: string;
	readonly init?: RequestInit;
	readonly url: string;
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
	const now = new Date();
	console.log(`\n=== ${heading}`);
	console.log(`${init.method ?? "GET"} ${url}`);
	console.log(`at ${now.toISOString()}  status ${response.status}`);
	console.log(`rate limits: ${JSON.stringify(Object.fromEntries(limits))}`);
	console.log(`body: ${body.slice(0, 50_000)}`);
	return { body, status: response.status };
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

function crc32(bytes: Uint8Array): number {
	let crc = ~0;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) {
			crc = (crc >>> 1) ^ (0xed_b8_83_20 & -(crc & 1));
		}
	}

	return ~crc >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	out.set(encoder.encode(type), 4);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

/**
 * Builds a solid square RGB PNG. Roblox rejects a non-square place icon and
 * recommends at least 512x512.
 *
 * @param size - Width and height in pixels.
 * @returns The encoded PNG bytes.
 */
function squarePng(size: number): Uint8Array<ArrayBuffer> {
	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, size);
	view.setUint32(4, size);
	header.set([8, 2, 0, 0, 0], 8);
	const stride = 1 + size * 3;
	const pixels = new Uint8Array(size * stride);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			pixels.set([30, 120, 200], y * stride + 1 + x * 3);
		}
	}

	const parts = [
		new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", header),
		pngChunk("IDAT", new Uint8Array(deflateSync(pixels))),
		pngChunk("IEND", new Uint8Array()),
	];
	const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}

	return out;
}

async function pollOperation(capture: Capture, heading: string): Promise<void> {
	const operationId = textField(capture, "operationId");
	if (operationId === undefined || capture.status !== 200 || field(capture, "done") !== false) {
		return;
	}

	for (let attempt = 0, wait = 1000; attempt < POLL_ATTEMPTS; attempt++) {
		await sleep(wait);
		const polled = await call({
			heading: `${heading} operation poll`,
			url: `${ASSETS}/operations/${operationId}`,
		});
		if (field(polled, "done") === true) {
			return;
		}

		wait = Math.min(wait * 1.5, 4000);
	}
}

async function readIcon(placeId: string): Promise<void> {
	await call({
		heading: `read place ${placeId} icon`,
		url: `${ASSETS}/assets/${placeId}?readMask=icon`,
	});
}

async function patchIcon(placeId: string, icon: string): Promise<void> {
	const form = new FormData();
	form.append(
		"request",
		new Blob([JSON.stringify({ assetId: placeId, icon })], { type: "application/json" }),
	);
	const heading = icon === "" ? "remove place icon" : "set place icon";
	const patched = await call({
		heading,
		init: { body: form, method: "PATCH" },
		url: `${ASSETS}/assets/${placeId}?updateMask=icon`,
	});
	await pollOperation(patched, heading);
	await readIcon(placeId);
}

async function readUniverse(): Promise<Capture> {
	return call({ heading: "read universe", url: `${APIS}/cloud/v2/universes/${universeId}` });
}

async function read(): Promise<void> {
	const universe = await readUniverse();
	const placeId = textField(universe, "rootPlace")?.split("/").pop();
	if (placeId === undefined) {
		return;
	}

	await call({ heading: "read start place asset", url: `${ASSETS}/assets/${placeId}` });
	await readIcon(placeId);
	await call({
		heading: "read start place asset, wider readMask",
		url: `${ASSETS}/assets/${placeId}?readMask=icon,previews,description,displayName`,
	});
}

async function upload(): Promise<void> {
	const universe = await readUniverse();
	const user = textField(universe, "user");
	const owner = user ?? textField(universe, "group");
	const ownerId = owner?.split("/").pop();
	if (ownerId === undefined) {
		throw new Error("the universe read named no owner");
	}

	const creator = user === undefined ? { groupId: ownerId } : { userId: ownerId };
	const form = new FormData();
	form.append(
		"request",
		JSON.stringify({
			assetType: "Image",
			creationContext: { assetPrivacy: "OpenUse", creator },
			description: "",
			displayName: "bedrock place icon probe",
		}),
	);
	form.append("fileContent", new Blob([squarePng(ICON_SIZE)], { type: "image/png" }), "icon.png");
	const created = await call({
		heading: "create image",
		init: { body: form, method: "POST" },
		url: `${ASSETS}/assets`,
	});
	await pollOperation(created, "create image");
}

const [phase, first, second] = process.argv.slice(2);
if (phase === "read") {
	await read();
} else if (phase === "upload") {
	await upload();
} else if (phase === "set" && first !== undefined && second !== undefined) {
	await patchIcon(first, `assets/${second}`);
} else if (phase === "remove" && first !== undefined) {
	await patchIcon(first, "");
} else if (phase === "moderation" && first !== undefined) {
	await call({
		heading: `read image ${first} moderation`,
		url: `${ASSETS}/assets/${first}?readMask=moderationResult`,
	});
} else {
	throw new Error(
		"usage: read | upload | set <placeId> <imageAssetId> | remove <placeId> | moderation <imageAssetId>",
	);
}
