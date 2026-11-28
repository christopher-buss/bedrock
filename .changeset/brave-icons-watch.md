---
"@bedrock-rbx/core": patch
---

The live check reads the **Experience icon** off the universe's start place and each **Place icon** off its place. An icon changed or removed outside bedrock shows as an out-of-band `icon` edit in the diff preview, and the next deploy sets the recorded image again without an upload or a place publish. An icon the credential cannot read is left unchecked, and the deploy goes on.

When no icon image is recorded yet, a deploy downloads the live icon and keeps it, without an upload, when its bytes match the declared file. A different live icon, or one that cannot be read or downloaded (such as with an OAuth token that lacks `legacy-asset:manage`), is replaced by an upload of the declared file.

A place that stops declaring `icon`, including a place that becomes the start place of a universe that declares one, stops recording its icon, so the live check no longer reports or restores it. The deploy makes no Open Cloud call and no place publish for it.
