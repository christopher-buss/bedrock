---
layout: introduction
description: Bedrock turns the Roblox commerce surface into a single typed file in your repo.
---

<div class="intro-kicker">
  Introduction
  <span class="v">v0.1 · alpha</span>
</div>

# What is<br/>as _Bedrock?_

<p class="lede">
Bedrock is an open-source CLI and programmatic tool for managing your game's resources, such as game passes, developer products, and places. It turns Roblox's commerce surface into a single file in your repo. Manage infrastructure and configuration with a unified workflow, alongside your code.
</p>

## <span class="num">§ 01</span>How it works

<p class="dropcap">You can think of Bedrock as a single source of truth for your game's metadata. Rather than manually updating your game's description, passes, and other resources in the Creator Hub, you declare what you want in a config file. Then, when you run `bedrock deploy`, that declaration is automatically applied to your game on Roblox. This means that your game's metadata is version-controlled, reviewable, and deployable through your existing CI/CD pipelines, just like the rest of your code.
</p>

## <span class="num">§ 02</span>Supported resources

<ul class="resource-list">
  <li>
    <span class="kind"><code>gamePass</code></span>
    <span class="desc">Name, price, description, icon</span>
  </li>
  <li>
    <span class="kind"><code>developerProduct</code></span>
    <span class="desc">Name, price, description, icon, regional pricing</span>
  </li>
  <li>
    <span class="kind"><code>place</code></span>
    <span class="desc">Place file (<code>.rbxl</code> / <code>.rbxlx</code>), display name, description</span>
  </li>
  <li>
    <span class="kind"><code>universe</code></span>
    <span class="desc">Display name, social links, platform flags, voice chat</span>
  </li>
  <li>
    <span class="kind soon">assets</span>
    <span class="desc">Textures, audio, models <span class="badge">coming soon</span></span>
  </li>
</ul>

## <span class="num">§ 03</span>The deploy pipeline

The model becomes most useful when used as part of your CI/CD pipeline. 
Assets and code are already in source control, so why not your game metadata? 

Consider a seasonal event. A week before launch you commit the new game
description and two new game passes to your config. The change goes through a
normal pull request. On release day, all you have to do is merge a PR into your
main branch, and bedrock will update any changed resources, as well as your
place file. Never forget to manually update a description again, or accidentally
leave a pass hidden because you forgot to flip it live.

<blockquote class="pull-quote">
Declare what should exist. Let CI make it true.
<cite>Core idea</cite>
</blockquote>

This workflow allows you to keep your game's metadata in sync with your code and
assets, and ensures that all changes are tracked and reviewable. It also makes
it easier to roll back changes if something goes wrong, since you can simply
revert the commit that introduced the change.

## <span class="num">§ 04</span>What it works with

Bedrock works best alongside a fully-managed [Rojo](https://rojo.space) project,
where scripts, assets, and configuration all live on the filesystem. When you
run `bedrock deploy`, Bedrock handles publishing your place file and reconciling
your config in a single step - your game and its metadata always ship together.

You can also use Bedrock without managing a place at all. Version-controlled
game passes and products are useful on their own, and the reconcile loop works
the same either way. This still gives you the benefits of a review process and
version history for your metadata, even if you prefer to manage your place
directly through Roblox.

> **Coming soon:** a system for turning your state file into usable Luau
> constants so that asset IDs, image IDs, and product IDs declared in config can
> be referenced directly in your game code without hardcoding.

## <span class="num">§ 05</span>Where to next

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
