import { OpenCloudError } from "./base.ts";

/**
 * Thrown when a network-level failure prevents the request from reaching
 * the Roblox Open Cloud API (e.g., DNS resolution failure, connection timeout).
 */
export class NetworkError extends OpenCloudError {
	public override readonly name: string = "NetworkError";
}
