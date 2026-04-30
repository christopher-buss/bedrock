FROM debian:bookworm-slim

# System deps for mise + git workflows + Claude Code installer
RUN apt-get update && apt-get install -y \
  ca-certificates \
  curl \
  git \
  jq \
  unzip \
  xz-utils \
  build-essential \
  && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y gh \
  && rm -rf /var/lib/apt/lists/*

# Create the agent user with a predictable UID. Sandcastle on macOS starts the
# container with --user $hostUid:$hostGid (e.g. 501:20), which does NOT match
# this UID; the chmod near the end of this file makes /home/agent writable for
# whatever UID the container actually runs as.
RUN useradd --create-home --uid 1000 --shell /bin/bash agent

USER agent
WORKDIR /home/agent

# Install mise (single-user install under /home/agent/.local).
RUN curl https://mise.run | sh

ENV MISE_DATA_DIR="/home/agent/.local/share/mise"
ENV PATH="/home/agent/.local/bin:/home/agent/.local/share/mise/shims:$PATH"

# Suppress corepack's "about to download" interactive prompt; sandcastle exec
# has no TTY, so the prompt would hang then fail.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# Pre-install the toolchain pinned by the repo's mise.toml so the sandbox boots
# with parity to the host dev environment. The build context must be the repo
# root for this COPY to resolve mise.toml:
#
#   docker build -t sandcastle:bedrock -f .sandcastle/Dockerfile .
#
# CI=1 short-circuits the `hk` postinstall (`hk install --mise`), which writes
# git hooks into a repo's .git/. There is no git repo at build time; the
# sandbox's onSandboxReady hook runs `hk install --mise` later, once the
# bind-mounted worktree is in place.
COPY --chown=agent:agent mise.toml /home/agent/mise.toml
RUN mise trust /home/agent/mise.toml \
  && CI=1 mise install --yes \
  && mise reshim

# Pre-fetch the pnpm version pinned by package.json's "packageManager" field
# so the sandbox does not need network on first `pnpm install`. corepack reads
# the packageManager field from the cwd; we run from /home/agent so the mise
# shim resolves node via the mise.toml we copied above.
COPY --chown=agent:agent package.json /home/agent/.pm-pin-package.json
RUN cp /home/agent/.pm-pin-package.json /home/agent/package.json \
  && corepack prepare --activate \
  && rm /home/agent/package.json /home/agent/.pm-pin-package.json

# Bake a sandbox-only .npmrc so pnpm uses a shared store mounted at
# /home/agent/.pnpm-store (see main.ts mounts) and copies into node_modules
# instead of hardlinking. The bind-mounted workspace and the bind-mounted
# store land on different mount points inside the container, so cross-mount
# hardlinks would fail with EXDEV; copy mode side-steps that and keeps the
# content-addressed store reusable across every sandbox spawn.
RUN printf 'store-dir=/home/agent/.pnpm-store\npackage-import-method=copy\n' \
  > /home/agent/.npmrc

# Install Claude Code CLI (resolves `node` via mise shims on PATH).
RUN curl -fsSL https://claude.ai/install.sh | bash

# Make /home/agent writable for any UID Docker maps the container user to,
# so git config, mise state, and Claude Code state can persist when sandcastle
# runs the container as the host UID (501 on macOS, 1000 on most Linux hosts).
#
# Also relax /etc/passwd & /etc/group permissions so a runtime hook can
# register that host UID as a real user. Without an entry, libc's
# getpwuid() returns NULL and tools that resolve "user.home" via getpwuid
# (notably pkl, when invoked transitively by `hk install --mise`) fall back
# to a literal `?` path and create a `?/.pkl/cache` directory in cwd.
USER root
RUN chmod -R a+rwX /home/agent \
  && chmod a+rw /etc/passwd /etc/group
USER agent

# In worktree sandbox mode, sandcastle bind-mounts the git worktree at
# /home/agent/workspace and overrides the working directory at container
# start.
ENTRYPOINT ["sleep", "infinity"]
