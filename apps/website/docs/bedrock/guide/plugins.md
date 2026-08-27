# Plugins

A plugin extends bedrock from your config file. Today a plugin contributes state
**backends**: the store bedrock persists its state to. Name the plugin package
under `plugins` and its backend becomes selectable in `state.backend`, with its
own configuration keys validated like any other config.

```ts
import { defineConfig } from "@bedrock-rbx/core/config";

export default defineConfig({
	environments: { production: {} },
	plugins: ["@example/state-s3"],
	state: { backend: "s3", bucket: "my-bucket", region: "eu-west-2" },
});
```

Without the `plugins` entry, `bucket` and `region` are keys bedrock does not
know, and the config fails validation before `s3` is ever looked up.

For the S3 backend bedrock publishes, see
[S3 state backend](/bedrock/guide/state-s3). The rest of this page is about
using any plugin, and about writing your own.

## Using a plugin

Install the package, then list its module specifier under `plugins`. Relative
specifiers resolve from the directory holding your config file, so
`plugins: ["./tools/state-s3.ts"]` means what it would mean written inside that
file.

Every listed specifier is imported while the config loads, before the rest of
the config is validated. A specifier that does not resolve, throws while
loading, or exports no plugin fails the load:

```text
plugin '@example/state-s3' failed to load (notInstalled): Cannot find package '@example/state-s3'
```

The `reason` in parentheses separates a package that is not installed
(`notInstalled`) from one that threw while evaluating (`importThrew`) and from
one that is not a bedrock plugin (`invalidExport`). Loading fails here rather
than at the first state write, so a broken install never surfaces after an apply
has already changed things on Roblox.

Each backend name resolves to exactly one plugin. Two plugins claiming one name,
or a plugin claiming a name bedrock ships, fails the load and names both
claimants. There is no override and no last-one-wins.

### Trust

A `plugins` entry runs the named module's code at the same trust level as the
config file itself, which is already executable in the TypeScript and Luau
formats. Bedrock does not sandbox or restrict what a plugin can do. Treat adding
one the way you treat adding any dependency your build executes.

### Migrating onto a plugin backend

`bedrock migrate` offers every backend a loaded plugin declared alongside its
own, and asks for that backend's coordinates using the fields the plugin
declared. It reads the plugins from a `bedrock.config` already in the project,
so add the `plugins` entry before migrating. The emitted config records both the
`state` block you answered and the plugin that has to be loaded for it to
resolve.

A plugin can also supply the state you are migrating _from_, which is what lets
you migrate when the previous tool's state has only ever lived in a bucket.
Bedrock still parses the foreign format; the plugin only supplies its bytes.

## Writing a plugin

A plugin is a module whose default export is a
[`BedrockPlugin`](/bedrock/api/interfaces/BedrockPlugin). Every field is
optional: contribute only what you implement.

```ts
import type { BedrockPlugin, StateBackendDeclaration } from "@bedrock-rbx/core";

import { type } from "arktype";

const schema = type({
	"bucket": "string > 0",
	"prefix?": "string",
	"region?": "string",
});

const s3: StateBackendDeclaration<typeof schema.infer> = {
	name: "s3",
	createPort({ fetch, getEnv, stateConfig }) {
		const key = getEnv("AWS_ACCESS_KEY_ID");
		if (key === undefined) {
			return {
				err: {
					detail: { variable: "AWS_ACCESS_KEY_ID" },
					reason: "no credentials",
				},
				success: false,
			};
		}

		return {
			data: openBucket({ key, bucket: stateConfig.bucket, fetch }),
			success: true,
		};
	},
	schema,
};

export default { stateBackends: [s3] } satisfies BedrockPlugin;
```

### Declare your config keys

`schema` is an [arktype](https://arktype.io) schema over the `state` keys your
backend adds. Declare only your own keys: `backend` is bedrock's and is merged
in for you. The `state` block rejects undeclared keys, so this fragment is what
makes `bucket` a key a user may write, and what turns a typo into a config-load
failure instead of a state-write failure.

Typing the declaration with `typeof schema.infer` is what gives `createPort` its
`stateConfig` type, so the builder reads its own keys without re-parsing them.

### Build the adapter

`createPort` returns a `Result`, so a missing credential or an unusable
coordinate stays typed rather than thrown. Its `reason` is what bedrock renders
and its `detail` is yours, passed through untouched:

```text
state backend from plugin '@example/state-s3' failed to build: no credentials
```

Route HTTP through the `fetch` in the context rather than reaching for
`globalThis.fetch`, falling back to the global when it is absent. That seam is
how bedrock's own adapters are tested, and it is how yours can be driven against
a fake transport instead of a mocked client.

### Report failures your users can read

The `StatePort` you return reports failures as
[`StateError`](/bedrock/api/type-aliases/StateError). Three of its arms are
backend-neutral, so the same condition reads the same whichever backend produced
it:

| Arm                 | Use it for                                       |
| ------------------- | ------------------------------------------------ |
| `stateNotFound`     | the store itself does not exist                  |
| `stateAccessDenied` | the credential reached the store and was refused |
| `stateConflict`     | the state changed underneath the operation       |

`stateError` is the fourth arm and is not one of those conditions: it says state
exists but cannot be trusted, which is corrupt JSON, a schema failure, or a
version bedrock does not know.

Reach for `pluginStateBackend` only when the failure is one nobody but you can
describe. It carries your `specifier` and an opaque `detail`, and bedrock
neither reads nor enumerates what is inside.

An environment that has simply never been deployed is `Ok(undefined)` from
`read`, not `stateNotFound`. Returning a not-found there would make the next
apply re-create every resource.

### Declare your migrate prompts

`bedrock migrate` renders the fields you declare; you never write prompt code
and never see the prompt port. Fields are asked in declaration order, each
answer is recorded under its `key`, and `condition` is evaluated against the
answers already given:

```ts
const s3: StateBackendDeclaration<typeof schema.infer> = {
	// ...
	migratePrompts: [
		{ key: "bucket", label: "Bucket name?", placeholder: "my-bucket" },
		{
			key: "region",
			label: "Region?",
			validationMessage: "A region is required",
		},
		{
			key: "endpoint",
			condition: (answers) => answers.region === "custom",
			label: "Endpoint override?",
		},
	],
};
```

A field with a `validationMessage` is required, and the message is what an empty
answer is rejected with. A field without one can be skipped, and a skipped field
records no answer, so an optional key stays out of the `state` block rather than
reaching your schema as an empty string. An answer holding nothing but
whitespace counts as skipped. Omitting `migratePrompts` leaves your backend out
of the migrate picker while keeping it usable in config.

To supply the state a user is migrating _from_, declare `migrateSource`. Its
`prompts` ask for the coordinates, and `readBytes` returns the bytes at them:

```ts
const s3: StateBackendDeclaration<typeof schema.infer> = {
	// ...
	migrateSource: {
		prompts: [
			{ key: "bucket", label: "Bucket the Mantle state lives in?" },
			{ key: "objectKey", label: "Object key of the Mantle state?" },
		],
		readBytes: async ({ coordinates, getEnv }) => {
			return fetchObject(coordinates, getEnv);
		},
		toStateConfig: ({ bucket }) => ({ bucket, prefix: "bedrock/" }),
	},
};
```

The split is bytes versus format. You never learn what the other tool's state
means; bedrock parses it.

`toStateConfig` translates those coordinates - the other tool's state-location
config - into the `state` keys bedrock records, and bedrock writes `backend`
alongside them. A user who fetched through your backend and then migrates onto
it gets that block, and none of your `migratePrompts` are asked, so return every
key your schema requires. Omit `toStateConfig` when the place the foreign state
lived says nothing about where bedrock's belongs, and your `migratePrompts` are
asked as usual. If a translation fully describes your backend, declare
`migratePrompts: []` so it still appears in the migrate picker.

### Version against core

A third-party plugin declares `@bedrock-rbx/core` as a peer dependency and
expresses compatibility as a range. Bedrock does not check versions at runtime.
