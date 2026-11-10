import { asSha256Hex, deploy, type DeployOptions } from "@bedrock-rbx/core";

import { createHash } from "node:crypto";
import { assert, describe, it } from "vitest";

import { REDACTED_ICON_BYTES, REDACTED_ICON_PATH } from "#src/core/redacted-icon";
import {
	ICON_CASES,
	iconConfig,
	type IconCurrent,
	iconCurrent,
	iconId,
	type IconKind,
	iconPage,
	iconUpdate,
	liveIconFixture,
} from "#tests/helpers/live-icon";

const OVERRIDE_BYTES = new Uint8Array([1, 2, 3]);
const CASES = ICON_CASES.flatMap((row) => [
	{ ...row, mode: "embedded" as const },
	{ ...row, mode: "override" as const },
]);

function redactedFixture(kind: IconKind, mode: "embedded" | "override") {
	const root = iconCurrent(kind);
	const bytes = mode === "embedded" ? new Uint8Array(REDACTED_ICON_BYTES) : OVERRIDE_BYTES;
	const path = mode === "embedded" ? REDACTED_ICON_PATH : "assets/public-preview.png";
	let current: IconCurrent = {
		...root,
		name: "Preview",
		description: "Hidden",
		icon: { "en-us": path },
		iconFileHashes: { "en-us": asSha256Hex(createHash("sha256").update(bytes).digest("hex")) },
	};
	if (current.kind !== "badge") {
		current = { ...current, price: 7 };
	}

	const fixture = liveIconFixture(kind, {
		current,
		readFile: async (file) => {
			await Promise.resolve();
			if (file !== "assets/public-preview.png") {
				throw new Error("The private root icon must never be read");
			}

			return OVERRIDE_BYTES;
		},
	});
	const config: NonNullable<DeployOptions["config"]> = {
		...iconConfig(root),
		environments: {
			production: {
				redacted: {
					name: "Preview",
					description: "Hidden",
					price: 7,
					...(mode === "override"
						? { icon: { "en-us": "assets/public-preview.png" } }
						: {}),
				},
			},
		},
	};
	return { ...fixture, bytes, options: { ...fixture.options, config } };
}

describe("redacted icon restoration", () => {
	it.for(CASES)(
		"should restore the $mode $kind icon bytes once and settle without accepting the private root icon",
		async ({ field, kind, methods, mode, uploadIndex }, { expect }) => {
			expect.hasAssertions();

			const fixture = redactedFixture(kind, mode);
			iconUpdate(
				fixture.httpClient.mockResponse({
					body: iconPage(fixture.current, { id: 99 }),
					status: 200,
				}),
				{ current: fixture.current },
			).mockResponse({ body: iconPage(fixture.current, { id: 777 }), status: 200 });
			const first = await deploy(fixture.options);
			assert(first.success, JSON.stringify(first));
			const second = await deploy(fixture.options);
			assert(second.success, JSON.stringify(second));
			const { body } = fixture.httpClient.requests[uploadIndex]!.request;
			assert(body instanceof FormData);
			const file = body.get(field);
			assert(file instanceof Blob);

			expect(new Uint8Array(await file.arrayBuffer())).toStrictEqual(fixture.bytes);
			expect(fixture.httpClient.requests.map(({ request }) => request.method)).toStrictEqual(
				methods,
			);
			expect(first.data.resources).toMatchObject([
				{ icon: fixture.current.icon, iconFileHashes: fixture.current.iconFileHashes },
			]);
			expect(second.data.resources).toStrictEqual(first.data.resources);
			expect(fixture.events.filter((event) => event.kind === "applySummary")).toMatchObject([
				{ reverted: 1, updated: 1 },
				{ noop: 1, updated: 0 },
			]);
		},
	);

	it.for(CASES)(
		"should leave an unchanged $mode $kind placeholder icon alone",
		async ({ kind, mode }, { expect }) => {
			expect.hasAssertions();

			const fixture = redactedFixture(kind, mode);
			fixture.httpClient.mockResponse({
				body: iconPage(fixture.current, { id: Number(iconId(fixture.current)) }),
				status: 200,
			});
			const result = await deploy(fixture.options);
			assert(result.success);

			expect(fixture.httpClient.requests.map(({ request }) => request.method)).toStrictEqual([
				"GET",
			]);
			expect(fixture.events.filter((event) => event.kind === "liveCheck")).toMatchObject([
				{ check: { edits: [] } },
			]);
			expect(result.data.resources).toStrictEqual([fixture.current]);
		},
	);
});
