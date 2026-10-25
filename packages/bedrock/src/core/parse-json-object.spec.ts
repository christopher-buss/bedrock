import { describe, it } from "vitest";

import { parseJsonObject } from "./parse-json-object.ts";

describe(parseJsonObject, () => {
	it("should return the object a JSON text holds", ({ expect }) => {
		expect.assertions(1);

		expect(parseJsonObject('{"a":1}')).toStrictEqual({ data: { a: 1 }, success: true });
	});

	it.for([
		{ content: "{", message: "it is not valid JSON" },
		{ content: "[]", message: "its root is not a JSON object" },
	])("should say why $content is not a JSON object", ({ content, message }, { expect }) => {
		expect.assertions(1);

		expect(parseJsonObject(content)).toStrictEqual({ err: message, success: false });
	});
});
