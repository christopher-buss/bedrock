import {
	type BedrockState,
	type Config,
	moveStateAsync,
	type PluginRegistry,
	serializeStateFile,
	type StateBackendFetch,
	type StateConfig,
} from "@bedrock-rbx/core";

import { assert, describe, expect, it } from "vitest";

import { s3StateBackend } from "#src/plugin";
import { type FakeS3, fakeS3 } from "#tests/helpers/fake-s3";

const SPECIFIER = "@bedrock-rbx/state-s3";

const GIST_ID = "abc123def456";

const STATE_OBJECT = "/production.json";

const PRODUCTION: BedrockState = { environment: "production", resources: [], version: 1 };

const ENVIRONMENT: Readonly<Record<string, string>> = {
	AWS_ACCESS_KEY_ID: "move-access-key",
	AWS_SECRET_ACCESS_KEY: "move-secret",
	BEDROCK_GITHUB_TOKEN: "ghp_example",
};

const PLUGINS: PluginRegistry = {
	stateBackends: new Map([["s3", { declaration: s3StateBackend, specifier: SPECIFIER }]]),
};

const ONTO_S3 = { backend: "s3", bucket: "bedrock-state", region: "eu-west-2" } as const;

const ONTO_GIST = { backend: "gist", gistId: GIST_ID } as const;

/** One gist holding one file per **Environment**, as the API serves it. */
interface FakeGist {
	/** Transport the gist adapter routes its requests through. */
	readonly fetchFunc: StateBackendFetch;
	/** The files the gist holds, keyed as the API names them. */
	readonly files: Map<string, string>;
}

function readFiles(body: unknown): Readonly<Record<string, string>> {
	const files = Reflect.get(Object(body), "files");
	return Object.fromEntries(
		Object.entries(Object(files)).map(([name, file]) => [
			name,
			String(Reflect.get(Object(file), "content")),
		]),
	);
}

/**
 * Build a gist the real adapter can talk to.
 *
 * @param files - Files the gist already holds, keyed by file name.
 * @returns The transport plus the files it serves.
 */
function fakeGist(files: Readonly<Record<string, string>> = {}): FakeGist {
	const held = new Map(Object.entries(files));

	return {
		fetchFunc: async (_input, init) => {
			await Promise.resolve();
			if (init?.method === "PATCH") {
				const patched = readFiles(
					JSON.parse(typeof init.body === "string" ? init.body : ""),
				);
				for (const entry of Object.entries(patched)) {
					held.set(entry[0], entry[1]);
				}

				return new Response("{}", { status: 200 });
			}

			const served = Object.fromEntries(
				Array.from(held, ([name, content]) => [name, { content }]),
			);
			return new Response(JSON.stringify({ files: served }), { status: 200 });
		},
		files: held,
	};
}

/**
 * Route each request to the store it addresses, so one move reaches both
 * **Backend**s through the seam core injects once.
 *
 * @param gist - The gist store.
 * @param store - The bucket store.
 * @returns The transport to hand the move.
 */
function routed(gist: FakeGist, store: FakeS3): StateBackendFetch {
	return async (input, init) => {
		const url = input instanceof Request ? input.url : String(input);
		return url.startsWith("https://api.github.com/")
			? gist.fetchFunc(input, init)
			: store.fetchFunc(input, init);
	};
}

function configWith(state: StateConfig): Config {
	return { environments: { production: {} }, state };
}

describe("moving state through the s3 plugin", () => {
	it("should put a gist's state in the bucket, leaving the gist holding it", async () => {
		expect.assertions(3);

		const gist = fakeGist({ "state.production.json": serializeStateFile(PRODUCTION) });
		const store = fakeS3({});

		const moved = await moveStateAsync(
			{ fetch: routed(gist, store), getEnv: (name) => ENVIRONMENT[name], plugins: PLUGINS },
			{
				config: configWith(ONTO_GIST),
				destination: ONTO_S3,
				dryRun: false,
				environments: ["production"],
				force: false,
			},
		);

		assert(moved.success);

		expect(moved.data.moved).toStrictEqual(["production"]);
		expect(store.objects.get(STATE_OBJECT)).toContain('"environment": "production"');
		expect(gist.files.has("state.production.json")).toBeTrue();
	});

	it("should put a bucket's state in a gist, leaving the bucket holding it", async () => {
		expect.assertions(3);

		const gist = fakeGist();
		const store = fakeS3({ [STATE_OBJECT]: serializeStateFile(PRODUCTION) });

		const moved = await moveStateAsync(
			{ fetch: routed(gist, store), getEnv: (name) => ENVIRONMENT[name], plugins: PLUGINS },
			{
				config: configWith(ONTO_S3),
				destination: ONTO_GIST,
				dryRun: false,
				environments: ["production"],
				force: false,
			},
		);

		assert(moved.success);

		expect(moved.data.moved).toStrictEqual(["production"]);
		expect(gist.files.get("state.production.json")).toContain('"environment": "production"');
		expect(store.objects.has(STATE_OBJECT)).toBeTrue();
	});

	it("should refuse to overwrite state the bucket already holds", async () => {
		expect.assertions(1);

		const gist = fakeGist({ "state.production.json": serializeStateFile(PRODUCTION) });
		const store = fakeS3({ [STATE_OBJECT]: serializeStateFile(PRODUCTION) });

		const moved = await moveStateAsync(
			{ fetch: routed(gist, store), getEnv: (name) => ENVIRONMENT[name], plugins: PLUGINS },
			{
				config: configWith(ONTO_GIST),
				destination: ONTO_S3,
				dryRun: false,
				environments: ["production"],
				force: false,
			},
		);

		assert(!moved.success);

		expect(moved.err.kind).toBe("moveBlocked");
	});

	it("should hold the bucket's environment while its state is read", async () => {
		expect.assertions(1);

		const gist = fakeGist();
		const store = fakeS3({ [STATE_OBJECT]: serializeStateFile(PRODUCTION) });

		await moveStateAsync(
			{ fetch: routed(gist, store), getEnv: (name) => ENVIRONMENT[name], plugins: PLUGINS },
			{
				config: configWith(ONTO_S3),
				destination: ONTO_GIST,
				dryRun: false,
				environments: ["production"],
				force: false,
			},
		);

		expect(store.calls.some((call) => call.url.includes("/locks/production.json"))).toBeTrue();
	});
});
