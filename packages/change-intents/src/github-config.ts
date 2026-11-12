/** Credentials and repository identity for immutable GitHub reads. */
export interface GithubConfig {
	/** Pull request number. */
	number: number;
	/** Expected repository owner/name. */
	repository: string;
	/** Injected HTTP transport. */
	request?: (input: string, init: RequestInit) => Promise<Response>;
	/** Token scoped to this repository. */
	token: string;
	/** Verified writer bot login. */
	writerLogin: string;
}

/** A GitHub GraphQL mutation failure. */
export interface GithubFailure {
	/** Human-readable service diagnostic. */
	message: string;
	/** GraphQL mutation path identifying the rejected operation. */
	path?: Array<string>;
	/** GitHub's machine-readable error classification. */
	type?: string;
}
