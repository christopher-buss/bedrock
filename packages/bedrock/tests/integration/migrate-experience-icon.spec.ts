import { createUniverseDriver, deploy, migrateMantleState } from "@bedrock-rbx/core";
import { AssetsClient } from "@bedrock-rbx/ocale/assets";
import { PlacesClient } from "@bedrock-rbx/ocale/places";
import { createFakeHttpClient, validUniverseBody } from "@bedrock-rbx/ocale/testing";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";

import { normalize } from "node:path";
import { assert, describe, it } from "vitest";

import type { DriverRegistry } from "#src/ports/resource-driver";
import { BADGE_TRAP } from "#tests/helpers/drivers";
import { environmentFrom } from "#tests/helpers/environment";
import { fakeStateStore } from "#tests/helpers/state-store";

const UNIVERSE_ID = "6031475575";
const START_PLACE_ID = "17613681043";
const ICON_PATH = "assets/marketing/icon.png";
const ICON_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const encoder = new TextEncoder();

const MANTLE_STATE = `
version: "6"
environments:
  production:
    - id: experience_singleton
      inputs:
        experience:
          groupId: ~
      outputs:
        experience:
          assetId: ${UNIVERSE_ID}
          startPlaceId: ${START_PLACE_ID}
      dependencies: []
    - id: experienceIcon_singleton
      inputs:
        experienceIcon:
          filePath: ${ICON_PATH}
          fileHash: 86890ed405cabad0fcdabf52225d528981790fa551e915c070348761c28373c1
      outputs:
        experienceIcon:
          assetId: 707633946677216
      dependencies:
        - experience_singleton
`;

const unused = {
	create() {
		throw new Error("Unexpected create");
	},
	retire() {
		throw new Error("Unexpected retire");
	},
};

async function readFile(path: string): Promise<Uint8Array> {
	assert(normalize(path) === normalize(ICON_PATH), `unexpected read of ${path}`);
	return ICON_BYTES;
}

describe("migrated experience icon", () => {
	it("should neither upload nor set the icon on the first deploy after migration", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const migrated = await migrateMantleState({
			configFormat: "typescript",
			readFile,
			stateFileBytes: encoder.encode(MANTLE_STATE),
			stateFilePath: ".mantle-state.yml",
		});
		assert(migrated.success);

		const http = createFakeHttpClient().mockResponse({
			body: validUniverseBody({
				path: `universes/${UNIVERSE_ID}`,
				rootPlace: `universes/${UNIVERSE_ID}/places/${START_PLACE_ID}`,
				user: "users/7777",
			}),
			status: 200,
		});
		const assetsHttp = createFakeHttpClient();
		const clientOptions = {
			credential: { apiKey: "fake", kind: "apiKey" } as const,
			sleep: async () => {},
		};
		const registry = {
			badge: BADGE_TRAP,
			developerProduct: unused,
			gamePass: unused,
			place: unused,
			universe: createUniverseDriver({
				icon: {
					assets: new AssetsClient({ ...clientOptions, httpClient: assetsHttp }),
					readFile,
				},
				places: new PlacesClient({ ...clientOptions, httpClient: http }),
				universes: new UniversesClient({ ...clientOptions, httpClient: http }),
			}),
		} satisfies DriverRegistry;
		const store = fakeStateStore({ initial: migrated.data.statesByEnvironment });

		const result = await deploy({
			config: migrated.data.config,
			environment: "production",
			getEnv: environmentFrom({}),
			progress: { emit: () => {} },
			readFile,
			registry,
			statePort: store.port,
		});

		expect(result.success).toBeTrue();
		expect(assetsHttp.requests).toBeEmpty();
	});
});
