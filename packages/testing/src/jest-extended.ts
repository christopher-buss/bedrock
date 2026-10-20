/// <reference path="./vitest-jest-extended.d.ts" />
import * as matchers from "jest-extended";
import { expect } from "vitest";

expect.extend(Object.fromEntries(Object.entries(matchers)));
