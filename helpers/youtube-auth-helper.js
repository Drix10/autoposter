/**
 * YouTube OAuth Token Generator
 * Run this script to get your access and refresh tokens
 */

const { google } = require("googleapis");
const http = require("http");
const url = require("url");
const { exec } = require("child_process");
const envUpdater = require("./env-updater");
require("dotenv").config();

// Load OAuth credentials from .env file
const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const REDIRECT_URI = process.env.YOUTUBE_REDIRECT_URI;

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
  console.error("\n❌ ERROR: Missing YouTube OAuth credentials in .env file!");
  console.log("\nPlease add the following to your .env file:");
  console.log("YOUTUBE_CLIENT_ID=your_client_id");
  console.log("YOUTUBE_CLIENT_SECRET=your_client_secret");
  console.log("YOUTUBE_REDIRECT_URI=http://localhost:3000/oauth2callback\n");
  process.exit(1);
}

// Create OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

// Scopes required for YouTube upload
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
];

console.log("\n=================================================");
console.log("YouTube OAuth Token Generator");
console.log("=================================================\n");

console.log("Starting local server on http://localhost:3000");
console.log("Your browser will open automatically...\n");

// Create local server to receive the OAuth callback
let serverClosed = false;
const server = http.createServer(async (req, res) => {
  try {
    if (req.url.indexOf("/oauth2callback") > -1) {
      const qs = new url.URL(req.url, "http://localhost:3000").searchParams;
      const code = qs.get("code");

      console.log("\n✅ Authorization code received!");

      res.end(
        "Authentication successful! You can close this window and return to the terminal."
      );

      // Exchange code for tokens
      const { tokens } = await oauth2Client.getToken(code);

      console.log("\n=================================================");
      console.log("✅ SUCCESS! Your tokens:");
      console.log("=================================================\n");

      console.log("Access Token Length:");
      console.log(`${tokens.access_token.length} characters`);
      console.log("\n");

      console.log("Refresh Token Length:");
      console.log(`${tokens.refresh_token.length} characters`);
      console.log("\n");

      console.log("Expires At:");
      console.log(new Date(tokens.expiry_date).toLocaleString());
      console.log("\n");

      // Parse existing YouTube accounts
      let existingAccounts = [];
      try {
        existingAccounts = JSON.parse(process.env.YOUTUBE_ACCOUNTS || "[]");
      } catch (e) {
        existingAccounts = [];
      }

      // Find next available channel number
      let channelNumber = 1;
      const existingNumbers = existingAccounts
        .map((acc) => {
          const match = acc.name.match(/^My Channel (\d+)$/);
          return match ? parseInt(match[1]) : null;
        })
        .filter((num) => num !== null);

      if (existingNumbers.length > 0) {
        channelNumber = Math.max(...existingNumbers) + 1;
      }

      // Auto-update .env file safely
      const newAccount = {
        name: `My Channel ${channelNumber}`,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      };

      // Add new account
      existingAccounts.push(newAccount);

      const result = await envUpdater.updateEnvFile(
        "YOUTUBE_ACCOUNTS",
        existingAccounts
      );

      if (result.success) {
        console.log("=================================================");
        console.log("✅ .ENV FILE UPDATED AUTOMATICALLY");
        console.log("=================================================\n");
        console.log("Your .env file has been updated with the new tokens!");
        console.log("No need to copy/paste - you're all set! 🎉\n");
        console.log(
          '💡 Tip: Change "My Channel" to your actual channel name in .env\n'
        );
      } else {
        console.log("=================================================");
        console.log("⚠️  COULD NOT AUTO-UPDATE .ENV FILE");
        console.log("=================================================\n");
        console.log(`Error: ${result.error}`);
        console.log("\nPlease manually add to your .env file:\n");
        console.log("YOUTUBE_ACCOUNTS=[{");
        console.log('  "name": "My Channel",');
        console.log('  "accessToken": "[HIDDEN]",');
        console.log('  "refreshToken": "[HIDDEN]"');
        console.log("}]");
        console.log("\n");
      }

      console.log("=================================================");
      console.log("⚠️  IMPORTANT NOTES:");
      console.log("=================================================");
      console.log("1. The access token expires in 1 hour");
      console.log("2. The refresh token is used to get new access tokens");
      console.log("3. Keep these tokens SECRET - never share them!");
      console.log("4. The bot will automatically refresh tokens as needed");
      console.log("\n");

      if (!serverClosed) {
        serverClosed = true;
        server.close(() => {
          process.exit(0);
        });
        // Force exit after 2 seconds if server doesn't close
        setTimeout(() => process.exit(0), 2000);
      }
    }
  } catch (error) {
    console.error("\n❌ Error getting tokens:", error.message);
    console.log("\nTroubleshooting:");
    console.log("1. Make sure you authorized the correct Google account");
    console.log("2. Check that CLIENT_ID and CLIENT_SECRET are correct");
    console.log("3. Try running the script again");
    res.end("Error during authentication. Check the terminal for details.");

    if (!serverClosed) {
      serverClosed = true;
      server.close(() => {
        process.exit(1);
      });
      // Force exit after 2 seconds if server doesn't close
      setTimeout(() => process.exit(1), 2000);
    }
  }
});

// Handle server errors
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error("\n❌ Port 3000 is already in use!");
    console.log(
      "Please close any application using port 3000 and try again.\n"
    );
  } else {
    console.error(`\n❌ Server error: ${error.message}\n`);
  }
  process.exit(1);
});

server.listen(3000, () => {
  // Generate auth URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log("If browser doesn't open, manually visit:\n");
  console.log(authUrl);
  console.log("\n");

  // Open browser automatically (Windows)
  exec(`start "" "${authUrl}"`, (error) => {
    if (error) {
      console.log("Could not open browser automatically.");
      console.log("Please open the URL above manually.");
    }
  });
});
