import type { DeployError } from "../shell/deploy.ts";

/** A {@link DeployError} the run's inputs caused before any write. */
export type ConfigFailure = Extract<DeployError, Record<"kind", ConfigFailureKind>>;

const CONFIG_FAILURE_KIND_LIST = [
	"credentialNotSupported",
	"missingCredential",
	"registryConfigMissing",
	"unknownEnvironment",
] as const satisfies ReadonlyArray<DeployError["kind"]>;

type ConfigFailureKind = (typeof CONFIG_FAILURE_KIND_LIST)[number];

const CONFIG_FAILURE_KINDS: ReadonlySet<DeployError["kind"]> = new Set(CONFIG_FAILURE_KIND_LIST);

/**
 * Whether a deploy failure came from the run's inputs (credential, registry
 * config, environment name).
 *
 * @param err - The deploy error to classify.
 * @returns `true` when {@link configErrorMessage} describes it.
 */
export function isConfigFailure(err: DeployError): err is ConfigFailure {
	return CONFIG_FAILURE_KINDS.has(err.kind);
}

/**
 * Render a {@link ConfigFailure} as a single CLI line.
 *
 * @param err - The config failure to describe.
 * @returns The message to print.
 */
export function configErrorMessage(err: ConfigFailure): string {
	switch (err.kind) {
		case "credentialNotSupported": {
			const places = err.places.map((key) => `'${key}'`).join(", ");
			return `credential not supported: publishing places ${places} needs an API key`;
		}
		case "missingCredential": {
			return `missing credential: environment variable ${err.variable} is not set`;
		}
		case "registryConfigMissing": {
			return `registry config missing '${err.missing}' (${err.hint})`;
		}
		case "unknownEnvironment": {
			return `unknown environment '${err.environment}' (declared: ${err.declared.join(", ")})`;
		}
	}
}
