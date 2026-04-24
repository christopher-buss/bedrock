import type { Result } from "@bedrock/ocale";

import type { ResourceDesiredInput } from "../core/flatten.ts";
import { sha256Hex } from "../core/kinds/hash.ts";
import type { BuildDesiredError } from "../core/kinds/module.ts";
import { readBytes } from "../core/kinds/read-bytes.ts";
import { copyDeclaredSocialLinks, type ResourceDesiredState } from "../core/resources.ts";
import { asSha256Hex } from "../types/ids.ts";

export type { BuildDesiredError } from "../core/kinds/module.ts";

/**
 * Layer file I/O onto a flat tagged list of resource inputs to produce
 * `ResourceDesiredState`.
 *
 * For each input, reads the file bytes via the injected `readFile`, computes
 * the SHA-256 hex digest, and assembles the branded desired-state record
 * that `diff` consumes. Entries are processed sequentially so the first
 * failure's attribution is deterministic.
 *
 * @param inputs - Flat tagged resource inputs from `flattenConfig`.
 * @param readFile - Reads file bytes for a given path; rejection becomes a
 * `fileReadFailed` Err.
 * @returns `Ok` with the desired-state array (same length and order as
 * `inputs`), or `Err` with the first I/O failure.
 * @example
 *
 * ```ts
 * import { asResourceKey, buildDesired } from "@bedrock/core";
 *
 * async function readFile(): Promise<Uint8Array> {
 *     return new Uint8Array([1, 2, 3]);
 * }
 *
 * return buildDesired(
 *     [
 *         {
 *             description: "Grants VIP perks.",
 *             iconFilePath: "assets/vip-icon.png",
 *             key: asResourceKey("vip-pass"),
 *             kind: "gamePass",
 *             name: "VIP Pass",
 *             price: 500,
 *         },
 *     ],
 *     readFile,
 * ).then((result) => {
 *     expect(result.success).toBeTrue();
 *     if (result.success) {
 *         expect(result.data).toHaveLength(1);
 *         expect(result.data[0]!.kind).toBe("gamePass");
 *     }
 * });
 * ```
 */
export async function buildDesired(
	inputs: ReadonlyArray<ResourceDesiredInput>,
	readFile: (path: string) => Promise<Uint8Array>,
): Promise<Result<ReadonlyArray<ResourceDesiredState>, BuildDesiredError>> {
	const desired: Array<ResourceDesiredState> = [];
	for (const input of inputs) {
		const normalized = await normalizeInput(input, readFile);
		if (!normalized.success) {
			return normalized;
		}

		desired.push(normalized.data);
	}

	return { data: desired, success: true };
}

async function normalizeGamePass(
	input: Extract<ResourceDesiredInput, { kind: "gamePass" }>,
	readFile: (path: string) => Promise<Uint8Array>,
): Promise<Result<ResourceDesiredState, BuildDesiredError>> {
	const read = await readBytes({ key: input.key, filePath: input.iconFilePath }, { readFile });
	if (!read.success) {
		return read;
	}

	return {
		data: {
			key: input.key,
			name: input.name,
			description: input.description,
			iconFileHash: asSha256Hex(await sha256Hex(read.data)),
			iconFilePath: input.iconFilePath,
			kind: "gamePass",
			price: input.price,
		},
		success: true,
	};
}

async function normalizePlace(
	input: Extract<ResourceDesiredInput, { kind: "place" }>,
	readFile: (path: string) => Promise<Uint8Array>,
): Promise<Result<ResourceDesiredState, BuildDesiredError>> {
	const read = await readBytes({ key: input.key, filePath: input.filePath }, { readFile });
	if (!read.success) {
		return read;
	}

	return {
		data: {
			key: input.key,
			fileHash: asSha256Hex(await sha256Hex(read.data)),
			filePath: input.filePath,
			kind: "place",
			placeId: input.placeId,
		},
		success: true,
	};
}

function normalizeUniverse(
	input: Extract<ResourceDesiredInput, { kind: "universe" }>,
): Result<ResourceDesiredState, BuildDesiredError> {
	const base: ResourceDesiredState = {
		key: input.key,
		consoleEnabled: input.consoleEnabled,
		desktopEnabled: input.desktopEnabled,
		displayName: input.displayName,
		kind: "universe",
		mobileEnabled: input.mobileEnabled,
		tabletEnabled: input.tabletEnabled,
		universeId: input.universeId,
		visibility: input.visibility,
		voiceChatEnabled: input.voiceChatEnabled,
		vrEnabled: input.vrEnabled,
		...copyDeclaredSocialLinks(input),
	};

	return {
		data:
			"privateServerPriceRobux" in input
				? { ...base, privateServerPriceRobux: input.privateServerPriceRobux }
				: base,
		success: true,
	};
}

async function normalizeInput(
	input: ResourceDesiredInput,
	readFile: (path: string) => Promise<Uint8Array>,
): Promise<Result<ResourceDesiredState, BuildDesiredError>> {
	switch (input.kind) {
		case "gamePass": {
			return normalizeGamePass(input, readFile);
		}
		case "place": {
			return normalizePlace(input, readFile);
		}
		case "universe": {
			return normalizeUniverse(input);
		}
	}
}
