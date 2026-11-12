import { readGateScope, readGateSelection } from "./gate-local.ts";
import type { GateLocalPort } from "./gate-local.ts";
import { validateGateSnapshot } from "./gate-snapshot.ts";
import type { GithubConfig } from "./github-config.ts";
import { planIntents } from "./index.ts";
import { reconcileAsync } from "./reconcile.ts";
import type { ReconcilePort } from "./reconcile.ts";

type Environment = Record<string, string | undefined>;
type Factory = (config: GithubConfig) => ReconcilePort;
/**
 * Run the writer with validated environment and an injected GitHub port.
 * @param environment - Explicit process environment.
 * @param factory - GitHub transport factory.
 * @returns Serialized reconciliation result.
 */
export async function runWriterAsync(environment: Environment, factory: Factory): Promise<string> {
	required(environment, "WRITER_LOGIN");
	return JSON.stringify(await reconcileAsync(factory(config(environment)), true));
}
/**
 * Run the unprivileged gate, returning output and the process exit decision.
 * @param options - Gate inputs and read-only operations.
 * @returns Output and enforcement exit status.
 */
export async function runGateAsync(options: {
	args: Array<string>;
	env: Environment;
	factory: Factory;
	local: GateLocalPort;
}): Promise<{ code: number; output: string }> {
	if (options.args.includes("--scope")) {
		return { code: 0, output: readGateScope(options.local).join("\n") };
	}

	const state = await options.factory(config(options.env)).read();
	const base = required(options.env, "CHECKOUT_BASE");
	const selected = readGateSelection(options.local, {
		base,
		scope: readGateScope(options.local),
	});
	const diagnostics = validateGateSnapshot(state, {
		base,
		head: required(options.env, "CHECKOUT_HEAD"),
		selected,
	});
	const enforce =
		options.env["INTENTS_MODE"] === "enforce" || options.env["INTENTS_MODE"] === "write";
	return {
		code: enforce && diagnostics.length > 0 ? 1 : 0,
		output: JSON.stringify({ diagnostics, plan: planIntents(state.input) }, undefined, 2),
	};
}

function required(environment: Environment, name: string): string {
	const value = environment[name];
	if (value === undefined || value === "") {
		throw new Error(`Missing ${name}`);
	}

	return value;
}

function config(environment: Environment): GithubConfig {
	const number = Number(required(environment, "PR_NUMBER"));
	if (!Number.isSafeInteger(number) || number < 1) {
		throw new Error("Invalid PR_NUMBER");
	}

	return {
		number,
		repository: required(environment, "GITHUB_REPOSITORY"),
		token: required(environment, "GH_TOKEN"),
		writerLogin: environment["WRITER_LOGIN"] ?? "",
	};
}
