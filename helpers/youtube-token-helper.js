/**
 * YouTube Token Validator & Refresher
 * Run this to check if your YouTube tokens are valid and refresh them if needed
 */

const { google } = require("googleapis");
const envUpdater = require("./env-updater");
require("dotenv").config();

async function validateAndRefreshTokens() {
  console.log("\n=================================================");
  console.log("YouTube Token Validator & Refresher");
  console.log("=================================================\n");

  // Check if credentials exist
  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) {
    console.error("❌ Missing YouTube OAuth credentials in .env file!");
    console.log("\nPlease add:");
    console.log("YOUTUBE_CLIENT_ID=your_client_id");
    console.log("YOUTUBE_CLIENT_SECRET=your_client_secret");
    console.log("YOUTUBE_REDIRECT_URI=http://localhost:3000/oauth2callback\n");
    process.exit(1);
  }

  // Parse YouTube accounts
  let accounts;
  try {
    accounts = JSON.parse(process.env.YOUTUBE_ACCOUNTS || "[]");
  } catch (error) {
    console.error("❌ Invalid YOUTUBE_ACCOUNTS JSON in .env file!");
    process.exit(1);
  }

  if (accounts.length === 0) {
    console.log("⚠️  No YouTube accounts configured in .env file");
    console.log("\nTo add accounts, run: node youtube-service.js\n");
    process.exit(0);
  }

  console.log(`Found ${accounts.length} YouTube account(s) to validate\n`);

  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI || "http://localhost:3000/oauth2callback"
  );

  const results = [];

  for (const account of accounts) {
    console.log(`\n📺 Checking: ${account.name}`);
    console.log("─".repeat(50));

    if (!account.accessToken || !account.refreshToken) {
      console.log("❌ Missing tokens!");
      results.push({
        name: account.name,
        status: "missing_tokens",
        message: "Missing access or refresh token",
      });
      continue;
    }

    try {
      // Set credentials
      oauth2Client.setCredentials({
        access_token: account.accessToken,
        refresh_token: account.refreshToken,
      });

      // Try to get a fresh access token
      console.log("🔄 Attempting to refresh access token...");
      const { credentials } = await oauth2Client.refreshAccessToken();

      console.log("✅ Token refresh successful!");
      console.log(
        `   Access token length: ${credentials.access_token.length} characters`
      );

      if (credentials.refresh_token) {
        console.log(
          `   Refresh token length: ${credentials.refresh_token.length} characters`
        );
      }

      // Test the token by making a simple API call
      const youtube = google.youtube({ version: "v3", auth: oauth2Client });

      console.log("🔍 Testing token with YouTube API...");
      const channelResponse = await youtube.channels.list({
        part: ["snippet"],
        mine: true,
      });

      if (channelResponse.data.items && channelResponse.data.items.length > 0) {
        const channelName = channelResponse.data.items[0].snippet.title;
        console.log(`✅ Token is valid! Connected to: ${channelName}`);

        results.push({
          name: account.name,
          status: "valid",
          channelName: channelName,
          newAccessToken: credentials.access_token,
          newRefreshToken: credentials.refresh_token || account.refreshToken,
        });
      } else {
        console.log("⚠️  Token works but no channel found");
        results.push({
          name: account.name,
          status: "no_channel",
          message: "Token valid but no YouTube channel found",
        });
      }
    } catch (error) {
      console.log(`❌ Token validation failed: ${error.message}`);

      if (error.message.includes("invalid_grant")) {
        console.log("   → Refresh token is invalid or revoked");
        console.log(
          "   → You need to regenerate tokens using youtube-service.js"
        );
      } else if (error.message.includes("invalid_client")) {
        console.log("   → Client ID or Client Secret is incorrect");
      }

      results.push({
        name: account.name,
        status: "invalid",
        error: error.message,
      });
    }
  }

  // Print summary
  console.log("\n\n=================================================");
  console.log("VALIDATION SUMMARY");
  console.log("=================================================\n");

  const validAccounts = results.filter((r) => r.status === "valid");
  const invalidAccounts = results.filter((r) => r.status === "invalid");
  const missingAccounts = results.filter((r) => r.status === "missing_tokens");

  console.log(`✅ Valid: ${validAccounts.length}`);
  console.log(`❌ Invalid: ${invalidAccounts.length}`);
  console.log(`⚠️  Missing tokens: ${missingAccounts.length}`);

  if (validAccounts.length > 0) {
    const updatedAccounts = accounts.map((account) => {
      const result = results.find((r) => r.name === account.name);
      if (result && result.status === "valid") {
        return {
          name: account.name,
          accessToken: result.newAccessToken,
          refreshToken: result.newRefreshToken,
        };
      }
      return account;
    });

    // Auto-update .env file safely
    const result = await envUpdater.updateEnvFile(
      "YOUTUBE_ACCOUNTS",
      updatedAccounts
    );

    if (result.success) {
      console.log("\n=================================================");
      console.log("✅ .ENV FILE UPDATED AUTOMATICALLY");
      console.log("=================================================\n");
      console.log("Your .env file has been updated with the new tokens!");
      console.log("No need to copy/paste - you're all set! 🎉\n");
    } else {
      console.log("\n=================================================");
      console.log("⚠️  COULD NOT AUTO-UPDATE .ENV FILE");
      console.log("=================================================\n");
      console.log(`Error: ${result.error}`);
      console.log("\nPlease manually update your .env file with:\n");
      console.log("YOUTUBE_ACCOUNTS=" + JSON.stringify(updatedAccounts));
      console.log("\n");
    }
  }

  if (invalidAccounts.length > 0 || missingAccounts.length > 0) {
    console.log("\n=================================================");
    console.log("ACTION REQUIRED");
    console.log("=================================================\n");

    if (invalidAccounts.length > 0) {
      console.log("❌ Invalid accounts:");
      invalidAccounts.forEach((acc) => {
        console.log(`   - ${acc.name}: ${acc.error}`);
      });
      console.log(
        "\n💡 Fix: Run 'node youtube-service.js' to regenerate tokens\n"
      );
    }

    if (missingAccounts.length > 0) {
      console.log("⚠️  Accounts missing tokens:");
      missingAccounts.forEach((acc) => {
        console.log(`   - ${acc.name}`);
      });
      console.log(
        "\n💡 Fix: Run 'node youtube-service.js' to generate tokens\n"
      );
    }
  }

  console.log("=================================================\n");
}

validateAndRefreshTokens().catch((error) => {
  console.error("\n❌ Unexpected error:", error);
  process.exit(1);
});
