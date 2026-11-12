import { describe, it } from "vitest";

import { readGateScope, readGateSelection } from "./gate-local.ts";

describe("local gate reader", () => {
	it("should exclude the workspace root and ignored packages from pnpm scope", ({ expect }) => {
		expect.hasAssertions();

		const files: Record<string, string> = {
			"/repo/package.json": '{"name":"root","version":"0.0.0"}',
			"/repo/packages/core/package.json": '{"name":"core","version":"0.1.0"}',
			"/repo/packages/tool/package.json": '{"name":"tool","version":"0.0.0"}',
			"pnpm-workspace.yaml": "versioning:\n  ignore: [tool]\n",
		};
		const calls: Array<{ args: Array<string>; binary: string }> = [];
		const scope = readGateScope({
			command: (binary, args) => {
				calls.push({ args, binary });
				return JSON.stringify([
					{ path: "/repo" },
					{ path: "/repo/packages/core" },
					{ path: "/repo/packages/tool" },
				]);
			},
			read: (path) => String(files[path.replaceAll("\\", "/")]),
			root: "/repo",
		});

		expect(scope).toStrictEqual(["core"]);
		expect(calls).toStrictEqual([
			{ args: ["list", "-r", "--depth", "-1", "--json"], binary: "pnpm" },
		]);
	});

	it("should select only versioned consumers using the verified base", ({ expect }) => {
		expect.hasAssertions();

		const calls: Array<{ args: Array<string>; binary: string }> = [];
		const port = {
			command: (binary: string, args: Array<string>) => {
				calls.push({ args, binary });
				return '[{"name":"core"},{"name":"ignored"}]';
			},
			read: () => "",
			root: "/repo",
		};

		expect(readGateSelection(port, { base: "abc123", scope: ["core"] })).toStrictEqual([
			"core",
		]);
		expect(calls).toStrictEqual([
			{
				args: ["list", "-r", "--depth", "-1", "--json", "--filter", "[abc123]"],
				binary: "pnpm",
			},
		]);
	});
});
