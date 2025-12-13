/**
 * Adds two numbers together.
 *
 * @example
 *
 * ```ts
 * import { add } from "./example";
 *
 * const result = add(2, 3);
 * expect(result).toBe(5);
 * ```
 *
 * @example
 *
 * ```ts
 * import { add } from "./example";
 *
 * const result = add(-1, 1);
 * expect(result).toBe(0);
 * ```
 *
 * @param a - The first number.
 * @param b - The second number.
 * @returns The sum of a and b.
 */
export function add(a: number, b: number): number {
	return a + b;
}

/**
 * Multiplies two numbers together.
 *
 * @example
 *
 * ```ts
 * import { multiply } from "./example";
 *
 * const result = multiply(2, 3);
 * expect(result).toBe(6);
 * ```
 *
 * @example
 *
 * ```ts
 * import { multiply } from "./example";
 *
 * const result = multiply(0, 5);
 * expect(result).toBe(0);
 * ```
 *
 * @param a - The first number.
 * @param b - The second number.
 * @returns The product of a and b.
 */
export function multiply(a: number, b: number): number {
	return a * b;
}
