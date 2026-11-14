import type { EnvironmentEntry } from "../core/schema.ts";
import type { ResourceDriver } from "../ports/resource-driver.ts";

type BadgeDriver = ResourceDriver<"badge">;

/**
 * Wrap a badge Driver so its creates carry the Environment's payment source.
 * With `paymentSource: "user"` the API key owner pays; otherwise the Driver
 * is returned as is and the universe owner pays.
 *
 * @param driver - The badge Driver to wrap.
 * @param entry - The Environment being reconciled, if declared.
 * @returns A Driver whose creates name the payment source the Environment
 *   chose.
 */
export function withPaymentSource(
	driver: BadgeDriver,
	entry: Pick<EnvironmentEntry, "paymentSource"> | undefined,
): BadgeDriver {
	if (entry?.paymentSource !== "user") {
		return driver;
	}

	return {
		...driver,
		create: async (desired, context) => {
			return driver.create(desired, { ...context, paymentSource: "User" });
		},
	};
}
