import { describe, it } from "vitest";

import {
	CREATE_OPERATION_LIMIT,
	GET_ASSET_LIMIT,
	GET_ASSET_OPERATION_LIMIT,
	UPDATE_OPERATION_LIMIT,
} from "#src/domains/assets/assets/operations";
import { perMinuteAllowance } from "./_helpers.ts";

const SECONDS_PER_MINUTE = 60;

const PINS = [
	["Assets_CreateAsset", CREATE_OPERATION_LIMIT],
	["Assets_GetAsset", GET_ASSET_LIMIT],
	["Assets_GetOperation", GET_ASSET_OPERATION_LIMIT],
	["Assets_UpdateAsset", UPDATE_OPERATION_LIMIT],
] as const;

describe("assets operations are paced by their own operation's declared rate", () => {
	it.for(PINS)(
		"should pace %s at the rate that operation declares",
		([operationId, limit], { expect }) => {
			expect.assertions(1);

			expect(limit.maxPerSecond).toBe(perMinuteAllowance(operationId) / SECONDS_PER_MINUTE);
		},
	);
});
