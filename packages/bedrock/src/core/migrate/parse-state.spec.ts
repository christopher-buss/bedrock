import { assert, describe, expect, it } from "vitest";

import { parseState } from "./parse-state.ts";

const VALID_V6_YAML = `
version: "6"
environments:
  production:
    - id: experience_singleton
      inputs:
        experience:
          groupId: ~
      outputs:
        experience:
          assetId: 6031475575
          startPlaceId: 17613681043
      dependencies: []
`;

describe(parseState, () => {
	it("should parse a v6 envelope and surface the version literal", () => {
		expect.assertions(1);

		const result = parseState(VALID_V6_YAML, ".mantle-state.yml");

		assert(result.success);

		expect(result.data.version).toBe("6");
	});

	it("should split an experience_singleton resource id into kind and key", () => {
		expect.assertions(2);

		const result = parseState(VALID_V6_YAML, ".mantle-state.yml");

		assert(result.success);

		const [resource] = result.data.environments["production"] ?? [];
		assert(resource !== undefined);

		expect(resource.kind).toBe("experience");
		expect(resource.key).toBe("singleton");
	});

	it("should normalize YAML null (~) on inputs to undefined", () => {
		expect.assertions(1);

		const result = parseState(VALID_V6_YAML, ".mantle-state.yml");

		assert(result.success);

		const [resource] = result.data.environments["production"] ?? [];
		assert(resource !== undefined);

		expect(resource.inputs).toStrictEqual({ groupId: undefined });
	});

	it("should expose the experience outputs payload as a plain object", () => {
		expect.assertions(1);

		const result = parseState(VALID_V6_YAML, ".mantle-state.yml");

		assert(result.success);

		const [resource] = result.data.environments["production"] ?? [];
		assert(resource !== undefined);

		expect(resource.outputs).toStrictEqual({
			assetId: 6031475575,
			startPlaceId: 17613681043,
		});
	});

	it("should preserve the resource dependencies array", () => {
		expect.assertions(1);

		const result = parseState(VALID_V6_YAML, ".mantle-state.yml");

		assert(result.success);

		const [resource] = result.data.environments["production"] ?? [];
		assert(resource !== undefined);

		expect(resource.dependencies).toStrictEqual([]);
	});
});

describe("parseState - version gate", () => {
	it("should reject a state file with version other than 6", () => {
		expect.assertions(3);

		const yaml = 'version: "5"\nenvironments:\n  production: []\n';
		const result = parseState(yaml, ".mantle-state.yml");

		assert(!result.success);
		assert(result.err.kind === "unsupportedMantleStateVersion");

		expect(result.err.found).toBe("5");
		expect(result.err.supported).toStrictEqual(["6"]);
		expect(result.err.kind).toBe("unsupportedMantleStateVersion");
	});

	it("should report a missing version field with its decoded form", () => {
		expect.assertions(2);

		const yaml = "environments:\n  production: []\n";
		const result = parseState(yaml, ".mantle-state.yml");

		assert(!result.success);
		assert(result.err.kind === "unsupportedMantleStateVersion");

		expect(result.err.found).toBe("undefined");
		expect(result.err.kind).toBe("unsupportedMantleStateVersion");
	});
});

describe("parseState - malformed input", () => {
	it("should return stateParseFailed when the YAML cannot be parsed", () => {
		expect.assertions(3);

		const result = parseState(":\n  this is not: : valid yaml: ::", ".mantle-state.yml");

		assert(!result.success);
		assert(result.err.kind === "stateParseFailed");

		expect(result.err.kind).toBe("stateParseFailed");
		expect(result.err.path).toBe(".mantle-state.yml");
		expect(result.err.reason.length).toBeGreaterThan(0);
	});

	it("should report 'got array' when the top-level value is a YAML sequence", () => {
		expect.assertions(2);

		const result = parseState("- 1\n- 2\n", ".mantle-state.yml");

		assert(!result.success);
		assert(result.err.kind === "stateParseFailed");

		expect(result.err.kind).toBe("stateParseFailed");
		expect(result.err.reason).toBe("expected object, got array");
	});

	it("should report 'got string' when environments is a string scalar", () => {
		expect.assertions(2);

		const yaml = 'version: "6"\nenvironments: "not an object"\n';
		const result = parseState(yaml, ".mantle-state.yml");

		assert(!result.success);
		assert(result.err.kind === "stateParseFailed");

		expect(result.err.kind).toBe("stateParseFailed");
		expect(result.err.reason).toBe("expected object, got string");
	});

	it("should report 'expected array, got string' when an environment value is a string", () => {
		expect.assertions(2);

		const yaml = 'version: "6"\nenvironments:\n  production: "not an array"\n';
		const result = parseState(yaml, ".mantle-state.yml");

		assert(!result.success);
		assert(result.err.kind === "stateParseFailed");

		expect(result.err.kind).toBe("stateParseFailed");
		expect(result.err.reason).toBe("expected array, got string");
	});

	it("should report 'got null' when environments is YAML null", () => {
		expect.assertions(1);

		const result = parseState('version: "6"\nenvironments: ~\n', ".mantle-state.yml");

		assert(!result.success);
		assert(result.err.kind === "stateParseFailed");

		expect(result.err.reason).toBe("expected object, got null");
	});

	it("should return stateParseFailed when a resource id has no underscore", () => {
		expect.assertions(2);

		const yaml = `
version: "6"
environments:
  production:
    - id: malformed
      inputs: {}
      outputs: ~
      dependencies: []
`;
		const result = parseState(yaml, ".mantle-state.yml");

		assert(!result.success);
		assert(result.err.kind === "stateParseFailed");

		expect(result.err.kind).toBe("stateParseFailed");
		expect(result.err.reason).toMatch(/<kind>_<key>/);
	});

	it("should return stateParseFailed when a resource id is not a string", () => {
		expect.assertions(2);

		const yaml = `
version: "6"
environments:
  production:
    - id: 123
      inputs: {}
      outputs: ~
      dependencies: []
`;
		const result = parseState(yaml, ".mantle-state.yml");

		assert(!result.success);
		assert(result.err.kind === "stateParseFailed");

		expect(result.err.kind).toBe("stateParseFailed");
		expect(result.err.reason).toMatch(/expected id to be a string/);
	});

	it("should reject ids that begin with an underscore (empty kind)", () => {
		expect.assertions(1);

		const yaml = `
version: "6"
environments:
  production:
    - id: _singleton
      inputs: {}
      outputs: ~
      dependencies: []
`;
		const result = parseState(yaml, ".mantle-state.yml");

		assert(!result.success);

		expect(result.err.kind).toBe("stateParseFailed");
	});

	it("should reject ids that end with an underscore (empty key)", () => {
		expect.assertions(1);

		const yaml = `
version: "6"
environments:
  production:
    - id: experience_
      inputs: {}
      outputs: ~
      dependencies: []
`;
		const result = parseState(yaml, ".mantle-state.yml");

		assert(!result.success);

		expect(result.err.kind).toBe("stateParseFailed");
	});

	it("should reject a dependencies array with a non-string entry", () => {
		expect.assertions(2);

		const yaml = `
version: "6"
environments:
  production:
    - id: experience_singleton
      inputs:
        experience: {}
      outputs:
        experience: {}
      dependencies:
        - 123
`;
		const result = parseState(yaml, ".mantle-state.yml");

		assert(!result.success);
		assert(result.err.kind === "stateParseFailed");

		expect(result.err.kind).toBe("stateParseFailed");
		expect(result.err.reason).toMatch(/expected dependency to be a string/);
	});
});

describe("parseState - null normalization across nested values", () => {
	it("should recursively strip nulls from arrays and nested objects in inputs", () => {
		expect.assertions(1);

		const yaml = `
version: "6"
environments:
  production:
    - id: experience_singleton
      inputs:
        experience:
          tags:
            - alpha
            - ~
            - nested:
                inner: ~
                kept: 1
      outputs:
        experience:
          assetId: 1
          startPlaceId: 2
      dependencies: []
`;

		const result = parseState(yaml, ".mantle-state.yml");

		assert(result.success);

		const [resource] = result.data.environments["production"] ?? [];
		assert(resource !== undefined);

		expect(resource.inputs).toStrictEqual({
			tags: ["alpha", undefined, { nested: { inner: undefined, kept: 1 } }],
		});
	});
});
