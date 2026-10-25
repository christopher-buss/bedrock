import type { Result } from "@bedrock-rbx/ocale";

import { isRecord } from "./is-record.ts";

/**
 * Parse text whose root must be a JSON object.
 *
 * @param content - The JSON text.
 * @returns The root object, or what is wrong with the content, phrased to
 *   follow "because".
 */
export function parseJsonObject(content: string): Result<Record<string, unknown>, string> {
	let root: JSONValue;
	try {
		root = JSON.parse(content);
	} catch {
		return { err: "it is not valid JSON", success: false };
	}

	if (!isRecord(root)) {
		return { err: "its root is not a JSON object", success: false };
	}

	return { data: root, success: true };
}
