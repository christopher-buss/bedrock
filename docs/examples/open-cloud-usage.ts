/**
 * Example: Using @bedrock/open-cloud SDK.
 *
 * This example demonstrates the complete usage of the Open Cloud SDK, including
 * rate limiting, retries, error handling, and multi-key scenarios.
 */

import {
	ApiError,
	type OpenCloudClientOptions,
	RateLimitError,
	type Result,
} from "@bedrock/open-cloud";
import { GameIconsClient } from "@bedrock/open-cloud/game-icons";
import { GamePassesClient } from "@bedrock/open-cloud/game-passes";
import { UniversesClient } from "@bedrock/open-cloud/universes";

// =============================================================================
// Configuration
// =============================================================================

const config: OpenCloudClientOptions = {
	apiKey: process.env.ROBLOX_API_KEY!,
	maxRetries: 3,

	onRateLimit: (waitMs) => {
		console.log(`[RATE LIMIT] Waiting ${waitMs}ms...`);
	},

	/**
	 * Observability hooks (optional).
	 *
	 * @param request
	 */
	onRequest: (request) => {
		console.log(`[REQUEST] ${request.method} ${request.url}`);
	},

	onRetry: (attempt, error) => {
		console.log(`[RETRY ${attempt}] ${error.message}`);
	},
};

// Note: Rate limits are built into each client based on Roblox's API limits.
// Users don't configure them - the SDK knows the correct limits per API.

// Separate API key for asset uploads (moderation safety)
const assetUploadKey = process.env.ROBLOX_ASSET_UPLOAD_KEY!;

// =============================================================================
// Example 1: Basic Usage with Error Handling
// =============================================================================

interface DeploymentPlan {
	assets: { icon?: Uint8Array; thumbnail?: Uint8Array };
	gamePasses: Array<{ name: string; priceInRobux: number }>;
	gameSettings: { displayName: string; maxPlayerCount: number };
}

// =============================================================================
// Example 2: Multiple Requests (SDK Queues Internally)
// =============================================================================

async function createGamePass() {
	const client = new GamePassesClient(config);

	const result = await client.create({
		name: "VIP Pass",
		description: "Access to VIP area",
		priceInRobux: 100,
		universeId: "123456",
	});

	// Handle Result type
	if (!result.success) {
		if (result.error instanceof RateLimitError) {
			console.error(`Rate limited! Retry after ${result.error.retryAfterSeconds}s`);
		} else if (result.error instanceof ApiError) {
			console.error(`API error ${result.error.statusCode}: ${result.error.message}`);
		} else {
			console.error(`Unknown error: ${result.error.message}`);
		}

		return;
	}

	console.log(`Created game pass: ${result.data.id}`);
	console.log(`Price: ${result.data.priceInRobux} Robux`);

	return result.data;
}

// =============================================================================
// Example 3: Per-Request Override (Multi-Key for Asset Uploads)
// =============================================================================

async function createGamePassOrThrow() {
	const client = new GamePassesClient(config);

	// If you prefer exceptions over Result handling
	const gamePass = unwrapResult(
		await client.create({
			name: "VIP Pass",
			priceInRobux: 100,
			universeId: "123456",
		}),
	);

	console.log(`Created: ${gamePass.id}`);

	return gamePass;
}

// =============================================================================
// Example 4: Updating Universe Settings
// =============================================================================

async function createGamePassWithIcon(imageData: Uint8Array) {
	const client = new GamePassesClient(config);

	// Use different API key for asset upload (moderation safety)
	const result = await client.create(
		{
			name: "VIP Pass",
			description: "Access to VIP area",
			iconFile: imageData, // Triggers multipart upload
			priceInRobux: 100,
			universeId: "123456",
		},
		{
			apiKey: assetUploadKey, // Override: different account
			timeout: 60_000, // Override: longer timeout for upload
		},
	);

	if (!result.success) {
		console.error(`Failed to create game pass with icon: ${result.error.message}`);
		return;
	}

	console.log(`Created game pass with icon: ${result.data.id}`);

	return result.data;
}

// =============================================================================
// Example 5: Asset Upload Workflow
// =============================================================================

async function createMultipleGamePasses() {
	const client = new GamePassesClient(config);

	const gamePasses = [
		{ name: "VIP Pass", priceInRobux: 100, universeId: "123456" },
		{ name: "Premium Pass", priceInRobux: 250, universeId: "123456" },
		{ name: "Elite Pass", priceInRobux: 500, universeId: "123456" },
		{ name: "Legendary Pass", priceInRobux: 1000, universeId: "123456" },
		{ name: "Ultimate Pass", priceInRobux: 2500, universeId: "123456" },
	];

	// Fire all requests at once - SDK queues and rate-limits internally
	const results = await Promise.all(gamePasses.map((parameters) => client.create(parameters)));

	// Process results
	const succeeded: Array<string> = [];
	const failed: Array<string> = [];

	for (const result of results) {
		if (result.success) {
			succeeded.push(result.data.id);
		} else {
			failed.push(result.error.message);
		}
	}

	console.log(`Created ${succeeded.length} game passes`);
	console.log(`Failed: ${failed.length}`);

	return { failed, succeeded };
}

// =============================================================================
// Example 6: Pagination
// =============================================================================

async function deployGame(universeId: string, plan: DeploymentPlan) {
	console.log("Starting deployment...");

	const gamePassClient = new GamePassesClient(config);
	const universeClient = new UniversesClient(config);
	const iconClient = new GameIconsClient({
		...config,
		apiKey: assetUploadKey,
	});

	const results = {
		assets: null as unknown,
		gamePasses: [] as Array<string>,
		settings: null as unknown,
	};

	// Step 1: Create all game passes (fire all at once, SDK queues)
	console.log("Creating game passes...");
	const gamePassResults = await Promise.all(
		plan.gamePasses.map((parameters) => gamePassClient.create({ ...parameters, universeId })),
	);

	for (const result of gamePassResults) {
		if (result.success) {
			results.gamePasses.push(result.data.id);
		} else {
			console.error(`Game pass failed: ${result.error.message}`);
			// Bedrock decides: continue? rollback? record partial state?
		}
	}

	// Step 2: Update game settings
	console.log("Updating game settings...");
	const settingsResult = await universeClient.update({
		universeId,
		...plan.gameSettings,
	});

	if (!settingsResult.success) {
		console.error(`Settings update failed: ${settingsResult.error.message}`);
		// Bedrock handles partial failure
	} else {
		results.settings = settingsResult.data;
	}

	// Step 3: Upload assets (if provided)
	if (plan.assets.icon) {
		console.log("Uploading game icon...");
		const iconResult = await iconClient.upload({
			gameId: universeId,
			iconFile: plan.assets.icon,
			languageCode: "en-us",
		});

		if (!iconResult.success) {
			console.error(`Icon upload failed: ${iconResult.error.message}`);
		} else {
			results.assets = iconResult.data;
		}
	}

	console.log("Deployment complete!");
	console.log(`Created ${results.gamePasses.length} game passes`);

	return results;
}

// =============================================================================
// Example 7: Bedrock IaC Deployment Workflow
// =============================================================================

async function listAllGamePasses(universeId: string) {
	const client = new GamePassesClient(config);
	const allGamePasses = [];
	let nextPageToken: string | undefined;

	do {
		const result = await client.list({
			maxPageSize: 50,
			pageToken: nextPageToken,
			universeId,
		});

		if (!result.success) {
			console.error(`Failed to list game passes: ${result.error.message}`);
			break;
		}

		allGamePasses.push(...result.data.items);
		nextPageToken = result.data.nextPageToken;

		console.log(`Fetched ${result.data.items.length} game passes`);
	} while (nextPageToken);

	console.log(`Total game passes: ${allGamePasses.length}`);

	return allGamePasses;
}

async function main() {
	try {
		// Example 1: Basic usage
		await createGamePass();

		// Example 2: Multiple requests
		await createMultipleGamePasses();

		// Example 6: Pagination
		await listAllGamePasses("123456");
	} catch (err) {
		console.error("Fatal error:", err);
		process.exit(1);
	}
}

// =============================================================================
// Example 8: Helper for Result Unwrapping
// =============================================================================

function unwrapResult<T>(result: Result<T, Error>): T {
	if (!result.success) {
		throw result.error;
	}

	return result.data;
}

async function updateGameSettings() {
	const client = new UniversesClient(config);

	const result = await client.update({
		consoleEnabled: false,
		description: "An incredible Roblox experience",
		desktopEnabled: true,
		displayName: "My Awesome Game",
		maxPlayerCount: 50,
		mobileEnabled: true,
		tabletEnabled: true,
		universeId: "123456",
		vrEnabled: false,
	});

	if (!result.success) {
		console.error(`Failed to update universe: ${result.error.message}`);
		return;
	}

	console.log(`Updated universe: ${result.data.id}`);

	return result.data;
}

// =============================================================================
// Run Examples
// =============================================================================

async function uploadGameAssets(iconData: Uint8Array, thumbnailData: Uint8Array) {
	const iconClient = new GameIconsClient({
		...config,
		apiKey: assetUploadKey, // Use asset upload key for all icon operations
	});

	const gameId = "123456";
	const languageCode = "en-us";

	// Upload game icon
	const iconResult = await iconClient.upload({
		gameId,
		iconFile: iconData,
		languageCode,
	});

	if (!iconResult.success) {
		console.error(`Icon upload failed: ${iconResult.error.message}`);
		return { icon: null, thumbnail: null };
	}

	console.log("Icon uploaded successfully");

	// Note: Game thumbnails would use a separate client
	// const thumbnailClient = new GameThumbnailsClient({...config, apiKey:
	// assetUploadKey});

	return {
		icon: iconResult.data,
		thumbnail: null, // Would be populated by thumbnail client
	};
}

// Uncomment to run examples
// main();
