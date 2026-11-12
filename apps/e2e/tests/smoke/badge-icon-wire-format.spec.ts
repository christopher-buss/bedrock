import { BadgesClient } from "@bedrock-rbx/ocale/badges";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { assert, describe, it } from "vitest";

import { assertOk } from "../helpers/assert-ok.ts";

const API_KEY = process.env["BEDROCK_API_KEY"];
const UNIVERSE_ID = process.env["ROBLOX_TEST_UNIVERSE_ID"];

const HAS_SECRETS = API_KEY !== undefined && UNIVERSE_ID !== undefined;

const ICON_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"game-pass",
	"icon.png",
);

// Badges have no delete endpoint and a small free daily quota, so every run
// reuses one enabled badge, found by name on the public list.
const BADGE_NAME = "bedrock-badge-icon-smoke";

const POLL_ATTEMPTS = 6;
const POLL_BASE_DELAY_MS = 2_000;

// Length of the final PNG chunk: 4-byte length, 4-byte type, 4-byte CRC.
const PNG_END_CHUNK_LENGTH = 12;
const PNG_TEXT_CHUNK_TYPE = "tEXt";

// The live icon check compares the ID that a badge icon upload returns with
// the `iconImageId` that a badge read returns. If the two differ, every
// deploy uploads the icon again.
describe("badge icon wire format on real Roblox", () => {
	it.skipIf(!HAS_SECRETS)(
		"should read back the uploaded icon asset ID as the badge iconImageId",
		async ({ expect }) => {
			expect.assertions(1);

			assert(API_KEY !== undefined, "BEDROCK_API_KEY must be set");
			assert(UNIVERSE_ID !== undefined, "ROBLOX_TEST_UNIVERSE_ID must be set");

			const credential = { apiKey: API_KEY, kind: "apiKey" } as const;
			const badges = new BadgesClient({ credential });
			const icon = await readFile(ICON_PATH);

			const badgeId = await findOrCreateBadgeAsync({
				badges,
				icon,
				universeId: UNIVERSE_ID,
				universes: new UniversesClient({ credential }),
			});

			const before = await badges.get({ badgeId });
			assertOk(before, "badge read before upload");

			const uploaded = await badges.uploadIcon({ badgeId, icon: withNonce(icon) });
			assertOk(uploaded, "badge icon upload");

			const after = await readIconIdUntilChangedAsync({
				badgeId,
				badges,
				previous: before.data.iconImageId,
			});

			expect(after).toBe(uploaded.data.iconImageId);
		},
	);
});

async function findOrCreateBadgeAsync({
	badges,
	icon,
	universeId,
	universes,
}: {
	readonly badges: BadgesClient;
	readonly icon: Uint8Array;
	readonly universeId: string;
	readonly universes: UniversesClient;
}): Promise<string> {
	const page = await badges.list({ pageSize: 100, universeId });
	assertOk(page, "badge list");
	const existing = page.data.items.find((badge) => badge.name === BADGE_NAME);
	if (existing !== undefined) {
		return existing.id;
	}

	const universe = await universes.get({ universeId });
	assertOk(universe, "universe read");
	const created = await badges.create({
		name: BADGE_NAME,
		description: "Bedrock smoke test: badge icon asset ID round trip",
		expectedCost: 0,
		icon,
		isActive: true,
		paymentSource: universe.data.owner.kind === "group" ? "Group" : "User",
		universeId,
	});
	assertOk(created, "badge create");
	return created.data.id;
}

async function readIconIdUntilChangedAsync({
	badgeId,
	badges,
	previous,
}: {
	readonly badgeId: string;
	readonly badges: BadgesClient;
	readonly previous: string | undefined;
}): Promise<string | undefined> {
	let current = previous;
	for (let attempt = 0; current === previous && attempt < POLL_ATTEMPTS; attempt += 1) {
		await new Promise<void>((resolve) => {
			setTimeout(resolve, POLL_BASE_DELAY_MS * 2 ** attempt);
		});
		const read = await badges.get({ badgeId });
		assertOk(read, "badge read after upload");
		current = read.data.iconImageId;
	}

	return current;
}

/**
 * Inserts a text chunk with a random value before the final PNG chunk, so
 * each run uploads bytes that Roblox has not seen before.
 *
 * @param png - A valid PNG that ends with its end chunk.
 * @returns The same image with a unique text chunk.
 */
function withNonce(png: Uint8Array): Uint8Array {
	const data = Buffer.from(`Comment\0${randomUUID()}`, "latin1");
	const typeAndData = Buffer.concat([Buffer.from(PNG_TEXT_CHUNK_TYPE, "latin1"), data]);
	const chunk = Buffer.alloc(typeAndData.length + 8);
	chunk.writeUInt32BE(data.length, 0);
	typeAndData.copy(chunk, 4);
	chunk.writeUInt32BE(crc32(typeAndData), typeAndData.length + 4);
	const end = png.length - PNG_END_CHUNK_LENGTH;
	return Buffer.concat([png.subarray(0, end), chunk, png.subarray(end)]);
}
