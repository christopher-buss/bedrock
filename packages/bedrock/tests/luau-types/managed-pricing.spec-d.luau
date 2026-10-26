--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("Managed pricing", function()
	t.it("should accept booleans on pass and product entries and overlays", function()
		local config = bedrock.defineConfig({
			passes = {
				vip = {
					name = "VIP", description = "Perks", icon = { ["en-us"] = "vip.png" },
					price = 100, isManagedPricingEnabled = true,
				},
			},
			products = {
				gems = { name = "Gems", description = "A gem pack", isManagedPricingEnabled = false },
			},
			environments = {
				production = {},
				staging = {
					passes = { vip = { isManagedPricingEnabled = false } },
					products = { gems = { isManagedPricingEnabled = true, price = 100 } },
				},
			},
		})

		t.expectTypeOf(config.passes.vip.isManagedPricingEnabled):toEqualType<<boolean>>()
		t.expectTypeOf(config.products.gems.isManagedPricingEnabled):toEqualType<<boolean>>()
		t.expectTypeOf(config.environments.staging.passes.vip.isManagedPricingEnabled):toEqualType<<boolean>>()
		t.expectTypeOf(config.environments.staging.products.gems.isManagedPricingEnabled):toEqualType<<boolean>>()
	end)

	t.it("should reject none as a managed-pricing pass value", function()
		-- @expect-error
		local pass: bedrock.GamePassEntry = {
			name = "VIP", description = "Perks", icon = { ["en-us"] = "vip.png" },
			isManagedPricingEnabled = bedrock.none,
		}
	end)

	t.it("should reject none as a managed-pricing product value", function()
		-- @expect-error
		local product: bedrock.DeveloperProductEntry = {
			name = "Gems", description = "A gem pack", isManagedPricingEnabled = bedrock.none,
		}
	end)

	t.it("should reject none as a managed-pricing pass overlay value", function()
		-- @expect-error
		local overlay: bedrock.GamePassOverlay = { isManagedPricingEnabled = bedrock.none }
	end)

	t.it("should reject none as a managed-pricing product overlay value", function()
		-- @expect-error
		local overlay: bedrock.DeveloperProductOverlay = { isManagedPricingEnabled = bedrock.none }
	end)
end)
