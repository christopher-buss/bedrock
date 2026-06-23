import * as core from "@actions/core";

import process from "node:process";

import { executeCommitBackAction } from "./commit-back-action.ts";
import { createGitExec } from "./git-exec.ts";

// Composition root only — all logic lives in executeCommitBackAction.
void executeCommitBackAction(core, process.env, createGitExec());
