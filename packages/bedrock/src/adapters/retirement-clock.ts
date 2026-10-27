/**
 * Create a clock that never repeats a timestamp. Sibling resources retire in
 * parallel through one driver; each reservation happens before any await so
 * equal or backwards clock samples cannot collide on Roblox's names.
 *
 * @returns A function returning a strictly increasing retirement time.
 */
export function createRetirementClock(): () => Date {
	let last = -Infinity;
	return () => {
		last = Math.max(Date.now(), last + 1);
		return new Date(last);
	};
}
