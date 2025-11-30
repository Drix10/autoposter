/**
 * Instagram Token Refresher
 * Automatically refresh Instagram long-lived access tokens (extends by 60 days)
 * Run this before your tokens expire to avoid manual regeneration
 */

const axios = require("axios");
const envUpdater = require("./env-updater");
require("dotenv").config();

// Instagram token refresh endpoint
const REFRESH_ENDPOINT = "https://graph.instagram.com/refresh_access_token";

async function refreshInstagramTokens() {
  console.log("\n=================================================");
  console.log("Instagram Token Refresher");
  console.log("=================================================\n");

  // Parse Instagram accounts
  let accounts;
  try {
    accounts = JSON.parse(process.env.INSTAGRAM_ACCOUNTS || "[]");
  } catch (error) {
    console.error("❌ Invalid INSTAGRAM_ACCOUNTS JSON in .env file!");
    process.exit(1);
  }

  if (accounts.length === 0) {
    console.log("⚠️  No Instagram accounts configured in .env file");
    console.log("\nAdd your accounts to .env:");
    console.log(
      'INSTAGRAM_ACCOUNTS=[{"name":"account1","id":"instagram_id","token":"instagram_token"}]\n'
    );
    process.exit(0);
  }

  console.log(`Found ${accounts.length} Instagram account(s) to refresh\n`);

  const results = [];

  for (const account of accounts) {
    console.log(`\n📸 Refreshing: ${account.name}`);
    console.log("─".repeat(50));

    if (!account.token) {
      console.log("❌ Missing access token!");
      results.push({
        name: account.name,
        status: "missing_token",
        message: "No access token found",
      });
      continue;
    }

    try {
      // Refresh the token
      console.log("🔄 Refreshing access token...");

      const refreshResponse = await axios.get(REFRESH_ENDPOINT, {
        params: {
          grant_type: "ig_refresh_token",
          access_token: account.token,
        },
        timeout: 15000,
      });

      if (refreshResponse.data && refreshResponse.data.access_token) {
        const newToken = refreshResponse.data.access_token;
        const expiresIn = refreshResponse.data.expires_in;
        const daysValid = Math.floor(expiresIn / 86400);

        console.log("✅ Token refreshed successfully!");
        console.log(`   Token length: ${newToken.length} characters`);
        console.log(`   Valid for: ${daysValid} days`);
        console.log(
          `   Expires on: ${new Date(
            Date.now() + expiresIn * 1000
          ).toLocaleDateString()}`
        );

        results.push({
          name: account.name,
          status: "success",
          newToken: newToken,
          expiresIn: expiresIn,
          daysValid: daysValid,
          expiryDate: new Date(Date.now() + expiresIn * 1000),
        });
      } else {
        console.log("⚠️  Unexpected response format");
        results.push({
          name: account.name,
          status: "unexpected_response",
          message: "Token refresh returned unexpected format",
        });
      }
    } catch (error) {
      console.log(`❌ Token refresh failed: ${error.message}`);

      let errorDetails = "";
      if (error.response?.data?.error) {
        const errData = error.response.data.error;
        errorDetails =
          errData.message || errData.error_user_msg || "Unknown error";

        if (errData.code === 190) {
          console.log("   → Token is invalid or expired");
          console.log("   → You need to generate a new token manually");
        } else if (errData.code === 100) {
          console.log("   → Invalid parameters or app configuration");
        }
      }

      results.push({
        name: account.name,
        status: "failed",
        error: error.message,
        errorDetails: errorDetails,
      });
    }
  }

  // Print summary
  console.log("\n\n=================================================");
  console.log("REFRESH SUMMARY");
  console.log("=================================================\n");

  const successAccounts = results.filter((r) => r.status === "success");
  const failedAccounts = results.filter((r) => r.status === "failed");
  const missingAccounts = results.filter((r) => r.status === "missing_token");

  console.log(`✅ Refreshed: ${successAccounts.length}`);
  console.log(`❌ Failed: ${failedAccounts.length}`);
  console.log(`⚠️  Missing tokens: ${missingAccounts.length}`);

  if (successAccounts.length > 0) {
    const updatedAccounts = accounts.map((account) => {
      const result = results.find((r) => r.name === account.name);
      if (result && result.status === "success") {
        return {
          name: account.name,
          id: account.id,
          token: result.newToken,
        };
      }
      return account;
    });

    // Auto-update .env file safely
    const result = await envUpdater.updateEnvFile(
      "INSTAGRAM_ACCOUNTS",
      updatedAccounts
    );

    if (result.success) {
      console.log("\n=================================================");
      console.log("✅ .ENV FILE UPDATED AUTOMATICALLY");
      console.log("=================================================\n");
      console.log("Your .env file has been updated with the new tokens!");
      console.log("No need to copy/paste - you're all set! 🎉\n");

      // Show expiry dates
      console.log("📅 Token Expiry Dates:");
      successAccounts.forEach((acc) => {
        console.log(
          `   ${acc.name}: ${acc.expiryDate.toLocaleDateString()} (${
            acc.daysValid
          } days)`
        );
      });
      console.log("\n");
    } else {
      console.log("\n=================================================");
      console.log("⚠️  COULD NOT AUTO-UPDATE .ENV FILE");
      console.log("=================================================\n");
      console.log(`Error: ${result.error}`);
      console.log("\nPlease manually update your .env file with:\n");
      console.log("INSTAGRAM_ACCOUNTS=" + JSON.stringify(updatedAccounts));
      console.log("\n");
    }
  }

  if (failedAccounts.length > 0 || missingAccounts.length > 0) {
    console.log("\n=================================================");
    console.log("ACTION REQUIRED");
    console.log("=================================================\n");

    if (failedAccounts.length > 0) {
      console.log("❌ Failed to refresh:");
      failedAccounts.forEach((acc) => {
        console.log(`   - ${acc.name}: ${acc.errorDetails || acc.error}`);
      });
      console.log("\n💡 These tokens need to be regenerated manually:");
      console.log("   1. Go to https://developers.facebook.com/tools/explorer");
      console.log("   2. Select your app");
      console.log("   3. Generate new User Access Token");
      console.log("   4. Exchange for long-lived token (see SETUP_GUIDE.md)");
      console.log("\n");
    }

    if (missingAccounts.length > 0) {
      console.log("⚠️  Accounts missing tokens:");
      missingAccounts.forEach((acc) => {
        console.log(`   - ${acc.name}`);
      });
      console.log("\n");
    }
  }

  console.log("=================================================");
  console.log("💡 TIPS");
  console.log("=================================================\n");
  console.log("• Refresh tokens every 30 days to avoid expiration");
  console.log("• Set a calendar reminder for token refresh");
  console.log("• Tokens can be refreshed multiple times before expiry");
  console.log("• Each refresh extends validity by 60 days from refresh time");
  console.log("• Run this script weekly to stay ahead of expiration\n");

  console.log("=================================================\n");
}

refreshInstagramTokens().catch((error) => {
  console.error("\n❌ Unexpected error:", error);
  process.exit(1);
});
