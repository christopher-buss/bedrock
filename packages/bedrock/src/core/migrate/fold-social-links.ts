import type { SocialLinkField } from "../resources.ts";
import {
	blockedWarning,
	EMPTY_FRAGMENT,
	type FoldFragment,
	interpretiveWarning,
	isObjectPayload,
	mergeFragment,
} from "./fold-universe-shared.ts";
import type { MantleResource } from "./types.ts";

const SOCIAL_LINK_KIND = "socialLink";

const SOCIAL_LINK_DOMAIN_TO_FIELD: Readonly<Record<string, SocialLinkField>> = {
	"discord.gg": "discordSocialLink",
	"facebook.com": "facebookSocialLink",
	"guilded.gg": "guildedSocialLink",
	"roblox.com": "robloxGroupSocialLink",
	"twitch.tv": "twitchSocialLink",
	"twitter.com": "twitterSocialLink",
	"www.roblox.com": "robloxGroupSocialLink",
	"youtube.com": "youtubeSocialLink",
};

interface KnownSocialLink {
	readonly field: SocialLinkField;
	readonly mantlePath: string;
	readonly title: string;
	readonly url: string;
}

/**
 * Fold every `socialLink_<domain>` Mantle resource into the matching
 * `universe.<field>SocialLink` entry. Unknown domains emit a `blocked`
 * warning and are dropped from the output. Malformed payloads (non-string
 * `title` or `url`) drop silently per the established convention.
 *
 * @param resources - Mantle resource list for one environment.
 * @returns The folded social-link entries plus per-rule diagnostics.
 */
export function foldSocialLinks(resources: ReadonlyArray<MantleResource>): FoldFragment {
	return resources
		.filter((resource) => resource.kind === SOCIAL_LINK_KIND)
		.reduce<FoldFragment>(
			(accumulator, resource) => mergeFragment(accumulator, mapSocialLink(resource)),
			EMPTY_FRAGMENT,
		);
}

function knownFragment(known: KnownSocialLink): FoldFragment {
	return {
		entryFragment: { [known.field]: { title: known.title, uri: known.url } },
		warnings: [
			interpretiveWarning({
				bedrockPath: `universe.${known.field}`,
				mantlePath: known.mantlePath,
				rule: "domain-to-field",
			}),
		],
	};
}

function mapSocialLink(resource: MantleResource): FoldFragment {
	const mantlePath = `${SOCIAL_LINK_KIND}_${resource.key}`;
	const field = SOCIAL_LINK_DOMAIN_TO_FIELD[resource.key];
	if (field === undefined) {
		return {
			entryFragment: {},
			warnings: [blockedWarning(mantlePath, `Unknown socialLink domain: ${resource.key}`)],
		};
	}

	if (!isObjectPayload(resource.inputs)) {
		return EMPTY_FRAGMENT;
	}

	const { title, url } = resource.inputs;
	if (typeof title !== "string" || typeof url !== "string") {
		return EMPTY_FRAGMENT;
	}

	return knownFragment({ field, mantlePath, title, url });
}
