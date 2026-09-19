import { assert, describe, expect, it } from "vitest";

import { parseListLogsResponse } from "#src/domains/cloud-v2/luau-execution-task-logs/parsers";
import { parseLuauExecutionTaskResponse } from "#src/domains/cloud-v2/luau-execution-tasks/parsers";
import { parseUniverseResponse } from "#src/domains/cloud-v2/universes/parsers";
import type { ApiError } from "#src/errors/api-error";
import type { Result } from "#src/types";
import { validUniverseBody } from "#tests/helpers/universes";
import { schemaEnum } from "./_helpers.ts";

/**
 * One row per hand-written enum guard in a `cloud/v2` parser. Guards
 * are literal disjunctions mirroring an enum the vendored OpenAPI
 * document declares, so they drift silently when Roblox adds a member:
 * the guard rejects the new value and the whole response is reported
 * malformed (issues #621 and #632, twice over).
 *
 * `readPublicValue` asserts the parse succeeded and returns the value
 * the caller actually sees. Reading the *public* value matters for
 * parsers that map the wire enum rather than pass it through: a new
 * member needs a map entry as well as a guard arm, and a half-done
 * widening yields `undefined` on a public field instead of a loud
 * parse error.
 */
interface DeclaredEnumPin {
	/** Label for the guard under pin, used in test titles. */
	readonly name: string;
	/** Builds a body whose pinned property carries `member`. */
	readonly buildBody: (member: string) => Record<string, unknown>;
	/** Property on `schemaName` carrying the enum. */
	readonly property: string;
	/** Parses a body and returns the public value the caller reads. */
	readonly readPublicValue: (body: unknown) => unknown;
	/** Name under `#/components/schemas/` declaring the enum. */
	readonly schemaName: string;
}

/**
 * Builds a pin row, erasing the parser's data type so rows for
 * different resources share one registry.
 *
 * @param pin - The guard under pin, its schema coordinates, and the
 *   parse/read pair that turns a body into a public value.
 * @returns The row, ready for {@link PINS}.
 * @template T - The public shape the parser produces.
 */
function definePin<T>({
	name,
	buildBody,
	parse,
	property,
	read,
	schemaName,
}: {
	buildBody: (member: string) => Record<string, unknown>;
	name: string;
	parse: (body: unknown) => Result<T, ApiError>;
	property: string;
	read: (data: T) => unknown;
	schemaName: string;
}): DeclaredEnumPin {
	return {
		name,
		buildBody,
		property,
		readPublicValue: (body) => {
			const result = parse(body);
			assert(result.success, `${name} rejected a schema-declared member`);
			return read(result.data);
		},
		schemaName,
	};
}

const TASK_PATH = "universes/123/places/456/luau-execution-session-tasks/task-1";

const PINS: ReadonlyArray<DeclaredEnumPin> = [
	definePin({
		name: "LuauExecutionTask.state",
		buildBody: (state) => {
			return {
				error: { code: "SCRIPT_ERROR", message: "oops" },
				output: { results: [] },
				path: TASK_PATH,
				state,
				user: "user-1",
			};
		},
		parse: (body) => parseLuauExecutionTaskResponse({ body, headers: {}, status: 200 }),
		property: "state",
		read: (task) => task.state,
		schemaName: "LuauExecutionSessionTask",
	}),
	definePin({
		name: "LuauExecutionTask.error.code",
		buildBody: (code) => {
			return {
				error: { code, message: "oops" },
				path: TASK_PATH,
				state: "FAILED",
				user: "user-1",
			};
		},
		parse: (body) => parseLuauExecutionTaskResponse({ body, headers: {}, status: 200 }),
		property: "code",
		read: (task) => {
			assert(task.state === "FAILED");
			return task.error.code;
		},
		schemaName: "LuauExecutionSessionTask_Error",
	}),
	definePin({
		name: "LogMessage.messageType",
		buildBody: (messageType) => {
			return {
				luauExecutionSessionTaskLogs: [
					{
						structuredMessages: [
							{ createTime: "2026-01-01T00:00:00Z", message: "hello", messageType },
						],
					},
				],
			};
		},
		parse: (body) => parseListLogsResponse({ body, headers: {}, status: 200 }),
		property: "messageType",
		read: (page) => page.messages[0]!.messageType,
		schemaName: "LuauExecutionSessionTaskLog_LogMessage",
	}),
	definePin({
		name: "Universe.visibility",
		buildBody: (visibility) => ({ ...validUniverseBody(), visibility }),
		parse: (body) => parseUniverseResponse({ body, headers: {}, status: 200 }),
		property: "visibility",
		read: (universe) => universe.visibility,
		schemaName: "Universe",
	}),
	definePin({
		name: "Universe.ageRating",
		buildBody: (ageRating) => ({ ...validUniverseBody(), ageRating }),
		parse: (body) => parseUniverseResponse({ body, headers: {}, status: 200 }),
		property: "ageRating",
		read: (universe) => universe.ageRating,
		schemaName: "Universe",
	}),
];

const MEMBER_ROWS = PINS.flatMap((pin) => {
	return schemaEnum(pin.schemaName, pin.property).map((member) => {
		return { member, pin, pinName: pin.name };
	});
});

describe("declared enum conformance", () => {
	it.for(MEMBER_ROWS)(
		"should surface a public value for $pinName carrying $member",
		({ member, pin }) => {
			expect.assertions(1);

			expect(pin.readPublicValue(pin.buildBody(member))).toBeDefined();
		},
	);
});
