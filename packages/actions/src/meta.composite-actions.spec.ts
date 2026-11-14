import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { assert, describe, it } from "vitest";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const DEPLOY_ACTION = readFileSync(path.join(PACKAGE_ROOT, "deploy", "action.yaml"), "utf8");
const ACTIONS = [readFileSync(path.join(PACKAGE_ROOT, "action.yaml"), "utf8"), DEPLOY_ACTION];

const RUN_KEY = /^(?<indent>\s*)(?:- )?run:\s*(?<value>.*)$/u;
const BLOCK_SCALAR = /^[|>]/u;
const LINE_BREAK = /\r?\n/u;
const DEPLOY_COMMAND_DEFAULT = /^\s{2}deploy-command:\r?\n\s+default:\s*(?<value>.+?)\s*$/mu;
const ALLOW_SPEND_DEFAULT = /^\s{2}allow-spend:\r?\n\s+default:\s*(?<value>.+?)\s*$/mu;

function indentOf(line: string): number {
	return line.length - line.trimStart().length;
}

/**
 * Read the body of a block scalar: the lines after the key, up to the first
 * non-blank line indented no deeper than the key.
 *
 * @param following - The manifest lines after the `run:` key.
 * @param keyIndent - Indent of the `run:` key.
 * @returns The trimmed body lines joined by newlines.
 */
function blockBody(following: ReadonlyArray<string>, keyIndent: number): string {
	const end = following.findIndex((line) => line.trim() !== "" && indentOf(line) <= keyIndent);
	const body = end === -1 ? following : following.slice(0, end);
	return body.map((line) => line.trim()).join("\n");
}

/**
 * Collect every `run:` script in an action manifest: the inline value, or the
 * lines of a block scalar indented deeper than the key.
 *
 * @param manifest - Raw action.yaml text.
 * @returns One string per `run:` step.
 */
function runScripts(manifest: string): ReadonlyArray<string> {
	const lines = manifest.split(LINE_BREAK);
	return lines.flatMap((line, index) => {
		const match = RUN_KEY.exec(line)?.groups;
		if (match === undefined) {
			return [];
		}

		const value = match["value"] ?? "";
		const keyIndent = (match["indent"] ?? "").length;
		return [BLOCK_SCALAR.test(value) ? blockBody(lines.slice(index + 1), keyIndent) : value];
	});
}

function deployScript(): string {
	const [script] = runScripts(DEPLOY_ACTION);
	assert(script !== undefined, "deploy/action.yaml has no run step");
	return script;
}

function deployCommandDefault(): string | undefined {
	return DEPLOY_COMMAND_DEFAULT.exec(DEPLOY_ACTION)?.groups?.["value"];
}

function allowSpendDefault(): string | undefined {
	return ALLOW_SPEND_DEFAULT.exec(DEPLOY_ACTION)?.groups?.["value"];
}

function runDeployScript(allowSpend: string | undefined): string {
	const { DEPLOY_ALLOW_SPEND: _inherited, ...inherited } = process.env;
	return execFileSync("bash", ["-c", deployScript()], {
		encoding: "utf8",
		env: {
			...inherited,
			...(allowSpend === undefined ? {} : { DEPLOY_ALLOW_SPEND: allowSpend }),
			DEPLOY_COMMAND: "printf [%s]",
			DEPLOY_ENVIRONMENT: "production",
		},
	});
}

describe("@bedrock-rbx/actions composite manifests", () => {
	it("should read inline and block-scalar run scripts", ({ expect }) => {
		expect.assertions(1);

		const manifest = [
			"steps:",
			"  - run: echo one",
			"  - name: two",
			"    run: |",
			"      echo two",
			"      echo three",
			"    shell: bash",
		].join("\n");

		expect(runScripts(manifest)).toStrictEqual(["echo one", "echo two\necho three"]);
	});

	it("should keep workflow expressions out of every run script", ({ expect }) => {
		expect.assertions(2);

		const scripts = ACTIONS.flatMap(runScripts);

		expect(scripts.length).toBeGreaterThanOrEqual(1);
		expect(scripts.filter((script) => script.includes("${{"))).toStrictEqual([]);
	});

	it("should default deploy-command to a binary npx never downloads", ({ expect }) => {
		expect.assertions(1);

		expect(deployCommandDefault()).toBe("npx --no-install bedrock");
	});

	it("should pass the environment to the deploy command as one literal argument", ({
		expect,
	}) => {
		expect.assertions(1);

		const output = execFileSync("bash", ["-c", deployScript()], {
			encoding: "utf8",
			env: {
				...process.env,
				DEPLOY_COMMAND: "printf [%s]",
				DEPLOY_ENVIRONMENT: "$(echo injected); x",
			},
		});

		expect(output).toBe("[deploy][--env][$(echo injected); x]");
	});

	it("should default allow-spend to false", ({ expect }) => {
		expect.assertions(1);

		expect(allowSpendDefault()).toBe('"false"');
	});

	it("should pass --allow-spend when allow-spend is true", ({ expect }) => {
		expect.assertions(1);

		expect(runDeployScript("true")).toBe("[deploy][--env][production][--allow-spend]");
	});

	it("should pass no spend flag when allow-spend is false or absent", ({ expect }) => {
		expect.assertions(2);

		expect(runDeployScript("false")).toBe("[deploy][--env][production]");
		expect(runDeployScript(undefined)).toBe("[deploy][--env][production]");
	});

	it("should fail when deploy-command is empty", ({ expect }) => {
		expect.assertions(2);

		const result = spawnSync("bash", ["-c", deployScript()], {
			encoding: "utf8",
			env: { ...process.env, DEPLOY_COMMAND: "  ", DEPLOY_ENVIRONMENT: "production" },
		});

		expect(result.status).toBe(1);
		expect(result.stdout).toBe("::error::deploy-command is empty\n");
	});
});
