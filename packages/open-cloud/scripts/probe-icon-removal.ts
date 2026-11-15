// Captures whether Open Cloud can remove or reset the icon of a badge, a
// game pass or a developer product, and what icon id a developer product
// created without an icon carries.
//
// Endpoints, all on apis.roblox.com unless named:
//
// - GET badges.roblox.com/v1/universes/{u}/badges and /v1/badges/{id}
// - PATCH /legacy-badges/v1/badges/{id}
// - POST /legacy-publish/v1/badges/{id}/icon
// - GET and PATCH /game-passes/v1/universes/{u}/game-passes/...
// - GET, POST and PATCH /developer-products/v2/universes/{u}/...
// - GET /legacy-game-internationalization/v1/{kind}/{id}/icons
// - DELETE the same path plus /language-codes/{lang}
//
// Phases (first argument):
//
// - list: list badges, passes and products with icon ids.
// - product-create: create one developer product with no icon, off sale, then
//   read it (get + list) for about 60 s.
// - remove <kind> <id>: try every removal path on one item that has a custom
//   icon; kind is badge, game-pass or product.
// - add-icon <productId>: upload an icon to a product that has none.
//
// Safety: items are permanent; point it at a test universe. Badges are never
// created here. Passes and products are kept off sale. Every update sends
// isForSale=false where the endpoint takes it.
//
// Run with credentials in the environment (the repo-root .env works with bun):
// bun --conditions source packages/open-cloud/scripts/probe-icon-removal.ts list
//
// The script never prints the API key and never writes to the repo. Pipe
// stdout to a file to keep the capture.

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

const apiKey = process.env["ROBLOX_API_KEY"] ?? "";
const universeId = process.env["ROBLOX_TEST_UNIVERSE_ID"] ?? "";
if (apiKey === "" || universeId === "") {
	throw new Error("ROBLOX_API_KEY and ROBLOX_TEST_UNIVERSE_ID are required");
}

const APIS = "https://apis.roblox.com";
const BADGES = "https://badges.roblox.com";
const GI = `${APIS}/legacy-game-internationalization/v1`;
const STAMP_PATTERN = /[:.]/g;
const PRODUCT_ID_PATTERN = /"productId":\s*(\d+)/;

const SEGMENTS: Readonly<Record<string, string>> = {
	"badge": "badges",
	"game-pass": "game-passes",
	"product": "developer-products",
};

interface Capture {
	readonly body: string;
	readonly status: number;
}

interface Request {
	readonly heading: string;
	readonly init?: RequestInit;
	readonly url: string;
}

interface Patch {
	readonly id: string;
	readonly body: FormData | string;
	readonly heading: string;
	readonly kind: string;
}

async function sleep(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function call({ heading, init = {}, url }: Request): Promise<Capture> {
	const headers = new Headers(init.headers);
	headers.set("x-api-key", apiKey);
	for (let attempt = 0; ; attempt++) {
		const response = await fetch(url, { ...init, headers });
		const body = await response.text();
		const now = new Date();
		console.log(`\n=== ${heading}`);
		console.log(`${init.method ?? "GET"} ${url}`);
		console.log(`at ${now.toISOString()}  status ${response.status}`);
		console.log(`body: ${body.slice(0, 50_000)}`);
		if (response.status !== 429 || attempt >= 3) {
			return { body, status: response.status };
		}

		const retry = Number(
			response.headers.get("retry-after") ?? response.headers.get("x-ratelimit-reset"),
		);
		const waitMs = (Number.isFinite(retry) && retry > 0 ? retry + 1 : 30) * 1000;
		console.log(`429; waiting ${waitMs}ms`);
		await sleep(waitMs);
	}
}

function form(
	fields: Record<string, string>,
	image?: { bytes: Uint8Array<ArrayBuffer>; field: string },
): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) {
		data.append(key, value);
	}

	if (image !== undefined) {
		data.append(image.field, new Blob([image.bytes], { type: "image/png" }), "icon.png");
	}

	return data;
}

function passUrl(id: string): string {
	return `${APIS}/game-passes/v1/universes/${universeId}/game-passes/${id}`;
}

function productUrl(id: string): string {
	return `${APIS}/developer-products/v2/universes/${universeId}/developer-products/${id}`;
}

function itemUrl(kind: string, id: string): string {
	if (kind === "badge") {
		return `${APIS}/legacy-badges/v1/badges/${id}`;
	}

	return kind === "game-pass" ? passUrl(id) : productUrl(id);
}

async function readIcon(kind: string, id: string): Promise<void> {
	if (kind === "badge") {
		await call({ heading: `read badge ${id}`, url: `${BADGES}/v1/badges/${id}` });
	} else {
		const url = kind === "game-pass" ? passUrl(id) : productUrl(id);
		await call({ heading: `read ${kind} ${id}`, url: `${url}/creator` });
	}

	await call({
		heading: `read ${kind} ${id} localized icons`,
		url: `${GI}/${SEGMENTS[kind]}/${id}/icons`,
	});
}

async function list(): Promise<void> {
	await call({ heading: "source language", url: `${GI}/source-language/games/${universeId}` });
	await call({
		heading: "list badges",
		url: `${BADGES}/v1/universes/${universeId}/badges?limit=100`,
	});
	await call({
		heading: "list game passes",
		url: `${APIS}/game-passes/v1/universes/${universeId}/game-passes/creator?pageSize=100`,
	});
	await call({
		heading: "list developer products",
		url: `${APIS}/developer-products/v2/universes/${universeId}/developer-products/creator?pageSize=100`,
	});
}

async function productCreate(): Promise<void> {
	const now = new Date();
	const stamp = now.toISOString().replaceAll(STAMP_PATTERN, "-");
	const created = await call({
		heading: "Q1 create product without icon",
		init: {
			body: form({
				name: `zzz_probe_icon_${stamp}`,
				description: "bedrock icon probe",
				isForSale: "false",
			}),
			method: "POST",
		},
		url: `${APIS}/developer-products/v2/universes/${universeId}/developer-products`,
	});
	const productId = PRODUCT_ID_PATTERN.exec(created.body)?.[1];
	if (productId === undefined || created.status !== 200) {
		return;
	}

	for (const delay of [0, 15_000, 45_000]) {
		await sleep(delay);
		await readIcon("product", productId);
		await call({
			heading: "Q1 list products",
			url: `${APIS}/developer-products/v2/universes/${universeId}/developer-products/creator?pageSize=100`,
		});
	}
}

async function patchItem({ id, body, heading, kind }: Patch): Promise<void> {
	const json = typeof body === "string";
	await call({
		heading,
		init: {
			body,
			headers: json ? { "content-type": "application/json" } : {},
			method: "PATCH",
		},
		url: itemUrl(kind, id),
	});
	await readIcon(kind, id);
}

async function removeBadgeIcon(id: string): Promise<void> {
	const url = `${APIS}/legacy-publish/v1/badges/${id}/icon`;
	await patchItem({
		id,
		body: JSON.stringify({ description: "bedrock icon probe" }),
		heading: "Q2 badge PATCH without icon",
		kind: "badge",
	});
	await call({
		heading: "Q2 badge publish icon, zero-byte file",
		init: { body: form({}, { bytes: new Uint8Array(0), field: "Files" }), method: "POST" },
		url,
	});
	await readIcon("badge", id);
	await call({
		heading: "Q2 badge publish icon, no file",
		init: { body: form({}), method: "POST" },
		url,
	});
	await readIcon("badge", id);
}

async function removeFormIcon(kind: string, id: string): Promise<void> {
	const field = "imageFile";
	await patchItem({
		id,
		body: form({ isForSale: "false" }),
		heading: `Q2 ${kind} PATCH without image`,
		kind,
	});
	await patchItem({
		id,
		body: form({ isForSale: "false" }, { bytes: new Uint8Array(0), field }),
		heading: `Q2 ${kind} PATCH zero-byte image`,
		kind,
	});
	await patchItem({
		id,
		body: form({ imageFile: "", isForSale: "false" }),
		heading: `Q2 ${kind} PATCH empty imageFile string`,
		kind,
	});
}

async function remove(kind: string, id: string): Promise<void> {
	await readIcon(kind, id);
	await (kind === "badge" ? removeBadgeIcon(id) : removeFormIcon(kind, id));

	for (const lang of ["en", "es"]) {
		await call({
			heading: `Q2 ${kind} localized icon DELETE ${lang}`,
			init: { method: "DELETE" },
			url: `${GI}/${SEGMENTS[kind]}/${id}/icons/language-codes/${lang}`,
		});
		await readIcon(kind, id);
	}
}

async function addIcon(id: string): Promise<void> {
	await patchItem({
		id,
		body: form({ isForSale: "false" }, { bytes: ICON_BYTES, field: "imageFile" }),
		heading: "Q3 product PATCH with image",
		kind: "product",
	});
	await sleep(15_000);
	await readIcon("product", id);
}

const [phase, a, b] = process.argv.slice(2);
if (phase === "list") {
	await list();
} else if (phase === "product-create") {
	await productCreate();
} else if (phase === "remove" && a !== undefined && b !== undefined) {
	await remove(a, b);
} else if (phase === "add-icon" && a !== undefined) {
	await addIcon(a);
} else {
	throw new Error("usage: list | product-create | remove <kind> <id> | add-icon <productId>");
}
