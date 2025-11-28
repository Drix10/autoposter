/**
 * YouTube OAuth Token Generator
 * Run this script to get your access and refresh tokens
 */

const { google } = require("googleapis");
const http = require("http");
const url = require("url");
const { exec } = require("child_process");
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

      console.log("Access Token:");
      console.log(tokens.access_token);
      console.log("\n");

      console.log("Refresh Token:");
      console.log(tokens.refresh_token);
      console.log("\n");

      console.log("Expires At:");
      console.log(new Date(tokens.expiry_date).toLocaleString());
      console.log("\n");

      console.log("=================================================");
      console.log("Add these to your .env file:");
      console.log("=================================================\n");

      console.log("YOUTUBE_CLIENT_ID=" + CLIENT_ID);
      console.log("YOUTUBE_CLIENT_SECRET=" + CLIENT_SECRET);
      console.log("YOUTUBE_REDIRECT_URI=" + REDIRECT_URI);
      console.log("\n");

      console.log("YOUTUBE_ACCOUNTS=[{");
      console.log('  "name": "My Channel",');
      console.log('  "accessToken": "' + tokens.access_token + '",');
      console.log('  "refreshToken": "' + tokens.refresh_token + '"');
      console.log("}]");
      console.log("\n");

      console.log("=================================================");
      console.log("⚠️  IMPORTANT NOTES:");
      console.log("=================================================");
      console.log("1. The access token expires in 1 hour");
      console.log("2. The refresh token is used to get new access tokens");
      console.log("3. Keep these tokens SECRET - never share them!");
      console.log("4. The bot will automatically refresh tokens as needed");
      console.log("\n");

      server.close();
      process.exit(0);
    }
  } catch (error) {
    console.error("\n❌ Error getting tokens:", error.message);
    console.log("\nTroubleshooting:");
    console.log("1. Make sure you authorized the correct Google account");
    console.log("2. Check that CLIENT_ID and CLIENT_SECRET are correct");
    console.log("3. Try running the script again");
    res.end("Error during authentication. Check the terminal for details.");
    server.close();
    process.exit(1);
  }
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
