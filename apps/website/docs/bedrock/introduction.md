---
layout: introduction
description: Bedrock turns the Roblox commerce surface into a single typed file in your repo.
---

<div class="intro-kicker">
  Introduction
  <span class="v">v0.1 · alpha</span>
</div>

# Your catalog,<br/>as _code_.

<p class="lede">
Bedrock turns the Roblox commerce surface (game passes, products, places, subscriptions) into a single typed file in your repo. Edit it, open a pull request, and let CI reconcile through Open Cloud. The next price change is a one-line diff, not a tab in Creator Hub.
</p>

## <span class="num">§ 01</span>The status quo

<p class="dropcap">Today, the canonical place to manage a Roblox catalog is Creator Hub: click into the dashboard, edit a price, save, hope you remember to update the team. There's no diff, no review, no rollback. Pricing experiments mean three people coordinating in Slack; multi-place experiences mean five browser tabs open just to verify a launch.</p>

This works fine for a solo developer with two passes. It does not survive contact with a team shipping live ops.

<blockquote class="pull-quote">
Your game's commerce surface should live in your repo, reviewed, diffed, deployed, not in a browser tab.
<cite>Design goal</cite>
</blockquote>

## <span class="num">§ 02</span>What changes

Bedrock turns the catalog into data. You write one TypeScript file that lists what you want to exist. Bedrock reads it, reads what's actually live on Roblox, and figures out the Open Cloud calls needed to make reality match. Change the file, run `apply`, and the changes ship. Roll back by reverting the commit.

There is nothing Bedrock can do that you couldn't do by hand. The point is that doing it by hand doesn't compose with the rest of your engineering practice. This does.

## <span class="num">§ 03</span>A 30-second taste

Here is the whole interface, end to end. One file declares a single game pass; one CLI command reconciles it.

```ts
import { asResourceKey, defineConfig } from "@bedrock-rbx/core";

export default defineConfig({
	resources: [
		{
			key: asResourceKey("vip-pass"),
			name: "VIP Pass",
			kind: "gamePass",
			price: 500,
		},
	],
	state: { backend: "gist" },
	universeId: "5182930447",
});
```

```bash
$ npx bedrock apply
  ✓ created gamePass.vip-pass (id 184219204)
```

Resources are typed. Keys are branded so duplicates fail at compile time. Everything else is a thin layer over Open Cloud.

## <span class="num">§ 04</span>What Bedrock is _not_

<ul class="not-list">
  <li>
    <span class="x">not a plugin</span>
    <span class="why"><b>It never touches your <code>.rbxl</code> file.</b> Bedrock manages metadata around your experience, not the experience itself.</span>
  </li>
  <li>
    <span class="x">not a runtime SDK</span>
    <span class="why"><b>It does not ship to your game server.</b> Bedrock runs in CI; your players never see it.</span>
  </li>
  <li>
    <span class="x">not a billing platform</span>
    <span class="why"><b>Roblox still owns the transaction.</b> Bedrock declares what you sell, Roblox handles the money.</span>
  </li>
  <li>
    <span class="x">not a Luau library</span>
    <span class="why"><b>Your config is TypeScript, in your tooling repo,</b> alongside CI scripts, lint rules, and the rest of your build chain.</span>
  </li>
</ul>

## <span class="num">§ 05</span>Where to next

Three doors, depending on what you want to do in the next ten minutes:

<div class="next-steps">
  <a class="next-step" href="/bedrock/guide/getting-started">
    <div class="kicker"><span class="num">01</span>install</div>
    <h4>Get the CLI</h4>
    <p>One <code>npm install</code>, then <code>bedrock --version</code>. Five lines, no config.</p>
    <span class="arrow">Installation →</span>
  </a>
  <a class="next-step" href="/bedrock/guide/getting-started">
    <div class="kicker"><span class="num">02</span>do</div>
    <h4>Ship a game pass</h4>
    <p>A five-step recipe from zero to a live pass. Roughly four minutes if you've got a universe ID.</p>
    <span class="arrow">Quickstart →</span>
  </a>
  <a class="next-step" href="/bedrock/api/">
    <div class="kicker"><span class="num">03</span>understand</div>
    <h4>Read the loop</h4>
    <p>How <code>apply</code> reconciles desired, actual, and last-known state without erasing your colleague's hotfix.</p>
    <span class="arrow">Concepts →</span>
  </a>
</div>

<div class="doc-foot">
  <a class="prev" href="#" style="opacity:0.45;pointer-events:none">
    <div class="dir">— Start</div>
    <div class="label">You are here</div>
  </a>
  <a class="next" href="/bedrock/guide/getting-started">
    <div class="dir">Next →</div>
    <div class="label">Getting Started</div>
  </a>
</div>
