import type { UnconfirmedPaidCreate } from "../core/state.ts";

/**
 * Describe the **Unconfirmed paid creates** that stop a create, and how the
 * user clears each one.
 *
 * @param creates - The Unconfirmed paid creates, in Key order.
 * @returns What each create may have done, then the remedy.
 */
export function unconfirmedCreatesDetail(creates: ReadonlyArray<UnconfirmedPaidCreate>): string {
	const sent = creates.map(({ key, name, sentAt }) => {
		return `a paid create sent for badge.${key} at ${sentAt} got a server error, so Roblox may have made the badge "${name}" and charged for it`;
	});
	const flags = creates.map(({ key }) => `--confirm-no-badge ${key}`).join(" ");
	return `${sent.join("; ")}. If the badge exists, import it; if it does not, deploy again with ${flags}`;
}
