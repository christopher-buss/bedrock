/**
 * Example: Using @bedrock/open-cloud SDK
 *
 * This example demonstrates the complete usage of the Open Cloud SDK,
 * including rate limiting, retries, error handling, and multi-key scenarios.
 */

import {
	ApiError,
	type OpenCloudClientOptions,
	RateLimitError,
	type Result,
} from "@bedrock/open-cloud";
import { GamePassesClient } from "@bedrock/open-cloud/game-passes";
import { UniversesClient } from "@bedrock/open-cloud/universes";
import { GameIconsClient } from "@bedrock/open-cloud/game-icons";

// =============================================================================
// Configuration
// =============================================================================

const config: OpenCloudClientOptions = {
	apiKey: process.env.ROBLOX_API_KEY!,
	maxRetries: 3,

	// Rate limiting - SDK manages queue internally
	rateLimit: {
		requestsPerSecond: 5, // Roblox limit
		requestsPerMinute: 100,
	},

	// Observability hooks
	onRequest: (request) => {
		console.log(`[REQUEST] ${request.method} ${request.url}`);
	},

	onRetry: (attempt, error) => {
		console.log(`[RETRY ${attempt}] ${error.message}`);
	},

	onRateLimit: (waitMs) => {
		console.log(`[RATE LIMIT] Waiting ${waitMs}ms...`);
	},
};

// Separate API key for asset uploads (moderation safety)
const assetUploadKey = process.env.ROBLOX_ASSET_UPLOAD_KEY!;

// =============================================================================
// Example 1: Basic Usage with Error Handling
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
// Example 2: Multiple Requests (SDK Queues Internally)
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
	const results = await Promise.all(
		gamePasses.map((parameters) => client.create(parameters)),
	);

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

	return { succeeded, failed };
}

// =============================================================================
// Example 3: Per-Request Override (Multi-Key for Asset Uploads)
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
// Example 4: Updating Universe Settings
// =============================================================================

async function updateGameSettings() {
	const client = new UniversesClient(config);

	const result = await client.update({
		universeId: "123456",
		displayName: "My Awesome Game",
		description: "An incredible Roblox experience",
		maxPlayerCount: 50,
		desktopEnabled: true,
		mobileEnabled: true,
		tabletEnabled: true,
		consoleEnabled: false,
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
// Example 5: Asset Upload Workflow
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

	console.log(`Icon uploaded successfully`);

	// Note: Game thumbnails would use a separate client
	// const thumbnailClient = new GameThumbnailsClient({...config, apiKey: assetUploadKey});

	return {
		icon: iconResult.data,
		thumbnail: null, // Would be populated by thumbnail client
	};
}

// =============================================================================
// Example 6: Pagination
// =============================================================================

async function listAllGamePasses(universeId: string) {
	const client = new GamePassesClient(config);
	const allGamePasses = [];
	let nextPageToken: string | undefined;

	do {
		const result = await client.list({
			universeId,
			maxPageSize: 50,
			pageToken: nextPageToken,
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

// =============================================================================
// Example 7: Bedrock IaC Deployment Workflow
// =============================================================================

interface DeploymentPlan {
	gamePasses: Array<{ name: string; priceInRobux: number }>;
	gameSettings: { displayName: string; maxPlayerCount: number };
	assets: { icon?: Uint8Array; thumbnail?: Uint8Array };
}

async function deployGame(universeId: string, plan: DeploymentPlan) {
	console.log("Starting deployment...");

	const gamePassClient = new GamePassesClient(config);
	const universeClient = new UniversesClient(config);
	const iconClient = new GameIconsClient({
		...config,
		apiKey: assetUploadKey,
	});

	const results = {
		gamePasses: [] as Array<string>,
		settings: null as unknown,
		assets: null as unknown,
	};

	// Step 1: Create all game passes (fire all at once, SDK queues)
	console.log("Creating game passes...");
	const gamePassResults = await Promise.all(
		plan.gamePasses.map((parameters) =>
			gamePassClient.create({ ...parameters, universeId }),
		),
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
// Example 8: Helper for Result Unwrapping
// =============================================================================

function unwrapResult<T>(result: Result<T, Error>): T {
	if (!result.success) {
		throw result.error;
	}

	return result.data;
}

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
// Run Examples
// =============================================================================

async function main() {
	try {
		// Example 1: Basic usage
		await createGamePass();

		// Example 2: Multiple requests
		await createMultipleGamePasses();

		// Example 6: Pagination
		await listAllGamePasses("123456");
	} catch (error) {
		console.error("Fatal error:", error);
		process.exit(1);
	}
}

// Uncomment to run examples
// main();
