import { assert, describe, it } from "vitest";

import type { ConfigError } from "./config-error.ts";
import { withNullAsUndefined } from "./normalize-config-nulls.ts";
import { type ConfigValidator, validateConfig } from "./schema.ts";

function parsed(json: string): JSONValue {
	return JSON.parse(json);
}

const ROOT_PRODUCT =
	'"products": { "gem-pack": { "name": "Gem", "description": "d", "price": 100 } }';

describe(withNullAsUndefined, () => {
	it("should turn a null overlay field into a present undefined field", ({ expect }) => {
		expect.assertions(2);

		const input = parsed(
			`{ "environments": { "staging": { "products": { "gem-pack": { "price": null } } } }, ${ROOT_PRODUCT} }`,
		);

		const result = withNullAsUndefined(validateConfig)(input, "bedrock.config.json");

		assert(result.success);

		const overlay = result.data.environments["staging"]!.products!["gem-pack"]!;

		expect(overlay).toStrictEqual({ price: undefined });
		expect(result.data.products!["gem-pack"]!.price).toBe(100);
	});

	it("should normalize a null inside an array element", ({ expect }) => {
		expect.assertions(1);

		const input = parsed('{ "environments": { "production": {} }, "plugins": [null] }');

		const result = withNullAsUndefined(validateConfig)(input, "bedrock.config.json");

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues).toStrictEqual([
			{ message: "plugins[0] must be a string (was null)", path: ["plugins", "0"] },
		]);
	});

	it("should fail a null on a required field and name null as the received value", ({
		expect,
	}) => {
		expect.assertions(1);

		const input = parsed(
			'{ "environments": { "production": {} }, "products": { "gem-pack": { "name": null, "description": "d" } } }',
		);

		const result = withNullAsUndefined(validateConfig)(input, "bedrock.config.yaml");

		assert(!result.success);

		expect(result.err).toStrictEqual({
			issues: [
				{
					message: 'products["gem-pack"].name must be a string (was null)',
					path: ["products", "gem-pack", "name"],
				},
			],
			kind: "validationFailed",
			sourceFile: "bedrock.config.yaml",
		});
	});

	it("should leave an issue at a field the config set to undefined untouched", ({ expect }) => {
		expect.assertions(1);

		const input = {
			environments: { production: {} },
			products: { "gem-pack": { name: undefined, description: "d" } },
		};

		const result = withNullAsUndefined(validateConfig)(input, "bedrock.config.ts");

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues[0]!.message).toBe(
			'products["gem-pack"].name must be a string (was undefined)',
		);
	});

	it("should keep an issue message at a null field that does not report undefined", ({
		expect,
	}) => {
		expect.assertions(1);

		const issue = { message: "price must be at least 0", path: ["price"] };
		function validate(_input: unknown, sourceFile: string): ReturnType<ConfigValidator> {
			return {
				err: { issues: [issue], kind: "validationFailed", sourceFile },
				success: false,
			};
		}

		const result = withNullAsUndefined(validate)(parsed('{ "price": null }'), "c.json");

		assert(!result.success);
		assert(result.err.kind === "validationFailed");

		expect(result.err.issues).toStrictEqual([issue]);
	});

	it("should return a failure other than validationFailed unchanged", ({ expect }) => {
		expect.assertions(1);

		const err: ConfigError = { kind: "fileNotFound", searchedFrom: "/project" };
		function validate(): ReturnType<ConfigValidator> {
			return { err, success: false };
		}

		const result = withNullAsUndefined(validate)(parsed('{ "price": null }'), "c.json");

		assert(!result.success);

		expect(result.err).toBe(err);
	});

	it("should pass a config with no nulls straight to the validator", ({ expect }) => {
		expect.assertions(1);

		const input = parsed(`{ "environments": { "production": {} }, ${ROOT_PRODUCT} }`);

		const result = withNullAsUndefined(validateConfig)(input, "bedrock.config.json");

		assert(result.success);

		expect(result.data.products!["gem-pack"]!.price).toBe(100);
	});
});
