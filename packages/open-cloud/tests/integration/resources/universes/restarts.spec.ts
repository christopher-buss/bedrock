import { assert, describe, expect, it } from "vitest";

import { ApiError } from "#src/errors/api-error";
import { ValidationError } from "#src/errors/validation";
import { UniversesClient } from "#src/resources/universes/client";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client-validated";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import {
	placeForecastWire,
	placeRestartStatusWire,
	restartStatusWire,
} from "#tests/helpers/restarts";

function createClient(httpClient: ReturnType<typeof createFakeHttpClient>): UniversesClient {
	return new UniversesClient({ apiKey: "test-key", httpClient, sleep: createFakeSleep() });
}

describe(UniversesClient, () => {
	describe("restartServers", () => {
		it("should POST an empty body to the universe's restartServers method", async () => {
			expect.assertions(4);

			const httpClient = createFakeHttpClient().mockResponse({ body: {}, status: 200 });

			const result = await createClient(httpClient).restartServers({ universeId: "42" });

			assert(result.success);

			expect(result.data).toBeUndefined();

			const captured = httpClient.requests[0];
			assert(captured !== undefined);

			expect(captured.request.method).toBe("POST");
			expect(captured.request.url).toBe("/cloud/v2/universes/42:restartServers");
			expect(captured.request.body).toStrictEqual({});
		});

		it("should turn a bleed-off duration on and forward place and version selection", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({ body: {}, status: 200 });

			await createClient(httpClient).restartServers({
				bleedOffDurationMinutes: 10,
				closeAllVersions: true,
				placeIds: ["15098004467"],
				universeId: "42",
			});

			expect(httpClient.requests[0]!.request.body).toStrictEqual({
				bleedOffDurationMinutes: 10,
				bleedOffServers: true,
				closeAllVersions: true,
				placeIds: [15_098_004_467],
			});
		});

		it.for(["abc", "0", "12.5", "99999999999999999999"])(
			"should reject place id %j before sending any request",
			async (placeId) => {
				expect.assertions(3);

				const httpClient = createFakeHttpClient();

				const result = await createClient(httpClient).restartServers({
					placeIds: [placeId],
					universeId: "42",
				});

				assert(!result.success);

				expect(result.err).toBeInstanceOf(ValidationError);
				expect(result.err.code).toBe("invalid_place_id");
				expect(httpClient.requests).toHaveLength(0);
			},
		);
	});

	describe("restarts.forecast", () => {
		it("should GET the forecast and return one entry per place", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockResponse({
				body: { placeForecasts: { 15098004467: placeForecastWire() } },
				status: 200,
			});

			const result = await createClient(httpClient).restarts.forecast({ universeId: "42" });

			assert(result.success);

			expect(result.data).toStrictEqual([
				{
					instancesImpacted: 0,
					instancesPerVersion: { 6: 1 },
					isNotInUniverse: false,
					latestPlaceVersion: "6",
					placeId: "15098004467",
					playersImpacted: 0,
					playersPerVersion: { 6: 1 },
					publishedAt: new Date("2026-04-24T02:36:28.673Z"),
					totalInstances: 1,
					totalPlayers: 1,
				},
			]);

			const captured = httpClient.requests[0];
			assert(captured !== undefined);

			expect(captured.request.method).toBe("GET");
			expect(captured.request.url).toBe(
				"/server-management/v1/universes/42/restarts:forecast",
			);
		});

		it.for([{ placeForecasts: {} }, { placeForecasts: JSON.parse("null") }, {}])(
			"should return no entries for a universe without live servers (%j)",
			async (body) => {
				expect.assertions(1);

				const httpClient = createFakeHttpClient().mockResponse({ body, status: 200 });

				const result = await createClient(httpClient).restarts.forecast({
					universeId: "42",
				});

				assert(result.success);

				expect(result.data).toStrictEqual([]);
			},
		);

		it("should read null per-version maps and latest version as empty and absent", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({
				body: {
					placeForecasts: {
						1: placeForecastWire({
							instancesPerVersion: JSON.parse("null"),
							latestPlaceVersion: JSON.parse("null"),
							playersPerVersion: JSON.parse("null"),
						}),
					},
				},
				status: 200,
			});

			const result = await createClient(httpClient).restarts.forecast({ universeId: "42" });

			assert(result.success);

			expect(result.data[0]).toMatchObject({
				instancesPerVersion: {},
				latestPlaceVersion: undefined,
				playersPerVersion: {},
			});
		});

		it.for([
			["a non-object body", "nope"],
			["a non-object placeForecasts", { placeForecasts: [] }],
			["a non-object place entry", { placeForecasts: { 1: 5 } }],
			...[
				"instancesImpacted",
				"isNotInUniverse",
				"playersImpacted",
				"publishTime",
				"totalInstances",
				"totalPlayers",
			].map((field) => {
				return [
					`a missing ${field}`,
					{ placeForecasts: { 1: placeForecastWire({ [field]: undefined }) } },
				];
			}),
			[
				"a non-date publishTime",
				{ placeForecasts: { 1: placeForecastWire({ publishTime: "soon" }) } },
			],
			[
				"a numeric latestPlaceVersion",
				{ placeForecasts: { 1: placeForecastWire({ latestPlaceVersion: 6 }) } },
			],
			[
				"a non-object playersPerVersion",
				{ placeForecasts: { 1: placeForecastWire({ playersPerVersion: 1 }) } },
			],
			[
				"a string player count",
				{ placeForecasts: { 1: placeForecastWire({ playersPerVersion: { 6: "1" } }) } },
			],
			[
				"a string instance count",
				{ placeForecasts: { 1: placeForecastWire({ instancesPerVersion: { 6: "1" } }) } },
			],
		] as const)("should reject %s as a malformed forecast", async ([, body]) => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
				body,
				status: 200,
			});

			const result = await createClient(httpClient).restarts.forecast({ universeId: "42" });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err.message).toBe("Malformed restart forecast response");
		});
	});

	describe("restarts.launch", () => {
		it("should POST an empty body and return the restart id and impact", async () => {
			expect.assertions(4);

			const httpClient = createFakeHttpClient().mockResponse({
				body: {
					id: "89310e32-489a-4a8f-bf28-083b7d7718bd",
					instancesImpacted: 1,
					playersImpacted: 1,
				},
				status: 200,
			});

			const result = await createClient(httpClient).restarts.launch({ universeId: "42" });

			assert(result.success);

			expect(result.data).toStrictEqual({
				id: "89310e32-489a-4a8f-bf28-083b7d7718bd",
				instancesImpacted: 1,
				playersImpacted: 1,
			});

			const captured = httpClient.requests[0];
			assert(captured !== undefined);

			expect(captured.request.method).toBe("POST");
			expect(captured.request.url).toBe("/server-management/v1/universes/42/restarts");
			expect(captured.request.body).toStrictEqual({});
		});

		it("should forward bleed-off, per-place filters, and attributes as given", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({
				body: {
					id: "89310e32-489a-4a8f-bf28-083b7d7718bd",
					instancesImpacted: 3,
					playersImpacted: 9,
				},
				status: 200,
			});

			await createClient(httpClient).restarts.launch({
				attributes: { reason: "hotfix" },
				bleedOffDurationMinutes: 15,
				places: {
					1: {},
					2: { versions: [4, 5] },
					3: { excludeCurrentVersion: true },
				},
				universeId: "42",
			});

			const captured = httpClient.requests[0];
			assert(captured !== undefined);

			expect(captured.request.body).toStrictEqual({
				attributes: { reason: "hotfix" },
				bleedOffDurationMinutes: 15,
				places: {
					1: {},
					2: { versions: [4, 5] },
					3: { excludeCurrentVersion: true },
				},
			});
		});

		it.for([
			["the nil UUID", "00000000-0000-0000-0000-000000000000"],
			["null", JSON.parse("null")],
		] as const)(
			"should report no restart id when Roblox answers %s because no server matched",
			async ([, id]) => {
				expect.assertions(1);

				const httpClient = createFakeHttpClient().mockResponse({
					body: { id, instancesImpacted: 0, playersImpacted: 0 },
					status: 200,
				});

				const result = await createClient(httpClient).restarts.launch({ universeId: "42" });

				assert(result.success);

				expect(result.data).toStrictEqual({
					id: undefined,
					instancesImpacted: 0,
					playersImpacted: 0,
				});
			},
		);

		it("should not retry a 500, since the restart may already be accepted", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient()
				.mockApiError({ statusCode: 500 })
				.mockResponse({
					body: { id: "x", instancesImpacted: 1, playersImpacted: 1 },
					status: 200,
				});

			const result = await createClient(httpClient).restarts.launch({ universeId: "42" });

			assert(!result.success);

			expect(result.err).toHaveProperty("statusCode", 500);
			expect(httpClient.requests).toHaveLength(1);
		});

		it.for([
			["a non-object body", "nope"],
			["a numeric id", { id: 1, instancesImpacted: 0, playersImpacted: 0 }],
			["a missing instancesImpacted", { id: "x", playersImpacted: 0 }],
			["a missing playersImpacted", { id: "x", instancesImpacted: 0 }],
		] as const)("should reject %s as a malformed launch", async ([, body]) => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
				body,
				status: 200,
			});

			const result = await createClient(httpClient).restarts.launch({ universeId: "42" });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err.message).toBe("Malformed restart launch response");
		});
	});

	describe("restarts.list", () => {
		it("should GET the restarts and return each with its place statuses", async () => {
			expect.assertions(3);

			const httpClient = createFakeHttpClient().mockResponse({
				body: {
					restartStatuses: {
						"e959da49-68c0-440a-ba43-0326468d314e": restartStatusWire({
							15098004467: placeRestartStatusWire({
								endTime: "2026-09-23T17:22:44.1824656Z",
								remainingInstances: 0,
								remainingPlayers: 0,
								state: "SUCCEEDED",
							}),
						}),
					},
				},
				status: 200,
			});

			const result = await createClient(httpClient).restarts.list({ universeId: "42" });

			assert(result.success);

			expect(result.data).toStrictEqual([
				{
					id: "e959da49-68c0-440a-ba43-0326468d314e",
					places: [
						{
							endedAt: new Date("2026-09-23T17:22:44.1824656Z"),
							filter: { versions: [6] },
							latestVersion: "6",
							placeId: "15098004467",
							remainingInstances: 0,
							remainingPlayers: 0,
							startedAt: new Date("2026-09-23T17:21:39.2972534Z"),
							state: "SUCCEEDED",
							totalInstances: 1,
							totalPlayers: 1,
						},
					],
					scheduledAt: new Date("2026-09-23T17:21:39.2972534Z"),
					startsAt: new Date("2026-09-23T17:22:39.2972534Z"),
				},
			]);

			const captured = httpClient.requests[0];
			assert(captured !== undefined);

			expect(captured.request.method).toBe("GET");
			expect(captured.request.url).toBe("/server-management/v1/universes/42/restarts");
		});

		it.for([{ restartStatuses: {} }, { restartStatuses: JSON.parse("null") }, {}])(
			"should return no restarts for a universe that has none (%j)",
			async (body) => {
				expect.assertions(1);

				const httpClient = createFakeHttpClient().mockResponse({ body, status: 200 });

				const result = await createClient(httpClient).restarts.list({ universeId: "42" });

				assert(result.success);

				expect(result.data).toStrictEqual([]);
			},
		);

		it("should return a restart with no place statuses as having no places", async () => {
			expect.assertions(1);

			const httpClient = createFakeHttpClient().mockResponse({
				body: { restartStatuses: { r: restartStatusWire(JSON.parse("null")) } },
				status: 200,
			});

			const result = await createClient(httpClient).restarts.list({ universeId: "42" });

			assert(result.success);

			expect(result.data[0]!.places).toStrictEqual([]);
		});

		it.for([
			[
				"versions",
				{ excludeCurrentVersion: JSON.parse("null"), versions: [6] },
				{ versions: [6] },
			],
			[
				"exclude",
				{ excludeCurrentVersion: true, versions: JSON.parse("null") },
				{ excludeCurrentVersion: true },
			],
			[
				"empty",
				{ excludeCurrentVersion: JSON.parse("null"), versions: JSON.parse("null") },
				{},
			],
			["null", JSON.parse("null"), undefined],
		] as const)(
			"should read the %s filter a place restart applied",
			async ([, filter, expected]) => {
				expect.assertions(1);

				const httpClient = createFakeHttpClient().mockResponse({
					body: {
						restartStatuses: {
							r: restartStatusWire({ 1: placeRestartStatusWire({ filter }) }),
						},
					},
					status: 200,
				});

				const result = await createClient(httpClient).restarts.list({ universeId: "42" });

				assert(result.success);

				expect(result.data[0]!.places[0]!.filter).toStrictEqual(expected);
			},
		);

		it("should read a running place restart's missing end time and latest version as absent", async () => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient().mockResponse({
				body: {
					restartStatuses: {
						r: restartStatusWire({
							1: placeRestartStatusWire({ latestVersion: JSON.parse("null") }),
						}),
					},
				},
				status: 200,
			});

			const result = await createClient(httpClient).restarts.list({ universeId: "42" });

			assert(result.success);

			const place = result.data[0]!.places[0];

			expect(place!.endedAt).toBeUndefined();
			expect(place!.latestVersion).toBeUndefined();
		});

		function listBody(place: Readonly<Record<string, unknown>>): unknown {
			return {
				restartStatuses: { r: restartStatusWire({ 1: placeRestartStatusWire(place) }) },
			};
		}

		it.for([
			["a non-object body", "nope"],
			["a non-object restartStatuses", { restartStatuses: [] }],
			["a non-object restart", { restartStatuses: { r: 1 } }],
			[
				"a missing scheduledTime",
				{ restartStatuses: { r: { ...restartStatusWire({}), scheduledTime: undefined } } },
			],
			[
				"a missing restart startTime",
				{ restartStatuses: { r: { ...restartStatusWire({}), startTime: undefined } } },
			],
			[
				"a non-object placeRestartStatuses",
				{ restartStatuses: { r: restartStatusWire([]) } },
			],
			[
				"a non-object place status",
				{ restartStatuses: { r: restartStatusWire({ 1: "x" }) } },
			],
			["an undeclared state", listBody({ state: "PAUSED" })],
			["a missing place startTime", listBody({ startTime: undefined })],
			["a non-date endTime", listBody({ endTime: "later" })],
			...["totalPlayers", "totalInstances", "remainingPlayers", "remainingInstances"].map(
				(field) => [`a missing ${field}`, listBody({ [field]: undefined })],
			),
			["a non-object filter", listBody({ filter: 6 })],
			[
				"a string excludeCurrentVersion",
				listBody({ filter: { excludeCurrentVersion: "yes" } }),
			],
			["a non-array versions", listBody({ filter: { versions: 6 } })],
			["a string version", listBody({ filter: { versions: ["6"] } })],
			["a numeric latestVersion", listBody({ latestVersion: 6 })],
		] as const)("should reject %s as a malformed restart list", async ([, body]) => {
			expect.assertions(2);

			const httpClient = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
				body,
				status: 200,
			});

			const result = await createClient(httpClient).restarts.list({ universeId: "42" });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err.message).toBe("Malformed restart list response");
		});
	});
});
