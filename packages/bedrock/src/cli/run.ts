#!/usr/bin/env node
import process from "node:process";

import { createProg } from "./index.ts";

createProg().parse(process.argv);
