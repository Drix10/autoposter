# Instagram Auto-Poster Bot - Complete Setup Guide

This guide will walk you through setting up the Instagram Auto-Poster bot with YouTube integration.

---

## 📋 Prerequisites

- Node.js (v16 or higher)
- FFmpeg installed on your system
- Discord account and server
- Instagram Business/Creator accounts
- Google Cloud account (for YouTube)
- GitHub account (for video storage)

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

---

## 🔧 Detailed Setup Instructions

### Discord Bot Setup

#### Step 1: Create Discord Application

1. Go to https://discord.com/developers/applications
2. Click "New Application" (top right)
3. Enter a name for your bot (e.g., "Instagram Auto-Poster")
4. Click "Create"

#### Step 2: Create Bot User

1. In the left sidebar, click "Bot"
2. Click "Add Bot" button
3. Click "Yes, do it!" to confirm
4. Under "TOKEN" section, click "Reset Token"
5. Click "Yes, do it!" and copy the token immediately
6. **Save this token** - you won't be able to see it again!

#### Step 3: Configure Bot Permissions

1. Scroll down to "Privileged Gateway Intents"
2. Enable the following intents:
   - ✅ MESSAGE CONTENT INTENT (required to read messages)
   - ✅ SERVER MEMBERS INTENT (optional)
   - ✅ PRESENCE INTENT (optional)
3. Click "Save Changes"

#### Step 4: Invite Bot to Your Server

1. In the left sidebar, click "OAuth2" → "URL Generator"
2. Under "SCOPES", select:
   - ✅ `bot`
   - ✅ `applications.commands`
3. Under "BOT PERMISSIONS", select:
   - ✅ Read Messages/View Channels
   - ✅ Send Messages
   - ✅ Embed Links
   - ✅ Attach Files
   - ✅ Read Message History
4. Copy the generated URL at the bottom
5. Open the URL in your browser
6. Select your server from the dropdown
7. Click "Authorize"
8. Complete the CAPTCHA

#### Step 5: Get Channel ID

1. Open Discord
2. Go to User Settings → Advanced
3. Enable "Developer Mode"
4. Go to your server
5. Right-click the channel where you want the bot to listen
6. Click "Copy Channel ID"

#### Step 6: Add to .env

```env
DISCORD_TOKEN=your_bot_token_from_step_2
CHANNEL_ID=your_channel_id_from_step_5
```

**Example:**

```env
DISCORD_TOKEN=OTcwOTg4MzE0ODQyNzkxOTg3.GJk16m.EXAMPLE_TOKEN_HERE
CHANNEL_ID=1234567890123456789
```

---

### Instagram Setup

#### Prerequisites

- Instagram Business or Creator account
- Facebook Page linked to your Instagram account
- Meta Developer account

#### Step 1: Create Meta App

1. Go to https://developers.facebook.com/apps
2. Click "Create App"
3. Select "Business" type
4. Fill in app details and create

#### Step 2: Add Instagram Basic Display

1. In your app dashboard, go to "Add Products"
2. Find "Instagram Basic Display" and click "Set Up"
3. Click "Create New App" in Instagram Basic Display settings

#### Step 3: Configure Instagram Graph API

1. In your Meta app dashboard, click "Add Product"
2. Find "Instagram" and click "Set Up"
3. Go to "Instagram Graph API" → "Tools"
4. Click "User Token Generator"

#### Step 4: Get Access Token (Detailed Method)

**Option A: Using Graph API Explorer (Easiest)**

1. Go to https://developers.facebook.com/tools/explorer
2. In the top right, select your app from the dropdown
3. Click "Generate Access Token"
4. A popup will appear - click "Continue as [Your Name]"
5. Select the Facebook Page connected to your Instagram account
6. Grant permissions when asked
7. You'll see a short-lived token in the "Access Token" field
8. **Copy this token** - we'll exchange it for a long-lived token

**Option B: Manual OAuth Flow**

1. Get User Access Token:

   ```
   https://www.facebook.com/v18.0/dialog/oauth?client_id={app-id}&redirect_uri={redirect-uri}&scope=instagram_basic,instagram_content_publish,pages_read_engagement
   ```

   Replace `{app-id}` with your App ID and `{redirect-uri}` with your redirect URI

2. After authorization, you'll get a code in the URL
3. Exchange code for token:
   ```
   https://graph.facebook.com/v18.0/oauth/access_token?client_id={app-id}&redirect_uri={redirect-uri}&client_secret={app-secret}&code={code-from-step-2}
   ```

#### Step 5: Exchange for Long-Lived Token

Short-lived tokens expire in 1 hour. Exchange for a 60-day token:

```bash
curl -X GET "https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=YOUR_APP_ID&client_secret=YOUR_APP_SECRET&fb_exchange_token=YOUR_SHORT_LIVED_TOKEN"
```

**Or use this URL in your browser:**

```
https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=YOUR_APP_ID&client_secret=YOUR_APP_SECRET&fb_exchange_token=YOUR_SHORT_LIVED_TOKEN
```

Response will look like:

```json
{
  "access_token": "EAABsbCS1iHgBO7ZCZCvqn...",
  "token_type": "bearer",
  "expires_in": 5183944
}
```

**Copy the `access_token` value** - this is your long-lived token!

#### Step 6: Get Instagram Business Account ID

1. Get your Facebook Page ID:

   ```
   https://graph.facebook.com/v18.0/me/accounts?access_token=YOUR_LONG_LIVED_TOKEN
   ```

   Response:

   ```json
   {
     "data": [
       {
         "id": "123456789", // This is your Page ID
         "name": "Your Page Name"
       }
     ]
   }
   ```

2. Get Instagram Business Account ID:

   ```
   https://graph.facebook.com/v18.0/123456789?fields=instagram_business_account&access_token=YOUR_LONG_LIVED_TOKEN
   ```

   Response:

   ```json
   {
     "instagram_business_account": {
       "id": "17841472678183501" // This is your Instagram Business Account ID
     },
     "id": "123456789"
   }
   ```

3. Verify the Instagram account:

   ```
   https://graph.facebook.com/v18.0/17841472678183501?fields=username,name&access_token=YOUR_LONG_LIVED_TOKEN
   ```

   Response:

   ```json
   {
     "username": "your_instagram_username",
     "name": "Your Instagram Name",
     "id": "17841472678183501"
   }
   ```

#### Step 7: Add to .env

Now you have:

- ✅ Instagram username (from Step 6.3)
- ✅ Instagram Business Account ID (from Step 6.2)
- ✅ Long-lived access token (from Step 5)

Add them to your .env file:

```env
INSTAGRAM_ACCOUNTS=[{"name":"your_username","id":"17841472678183501","token":"EAABsbCS1iHgBO7ZCZCvqn..."}]
```

**Multiple Accounts Example:**

Repeat Steps 4-6 for each Instagram account, then add all to .env:

```env
INSTAGRAM_ACCOUNTS=[{"name":"account1","id":"17841472678183501","token":"EAABsbCS1iHg..."},{"name":"account2","id":"17841473190704862","token":"IGAAImZAO6jJ3t..."}]
```

**Real Example from .env:**

```env
INSTAGRAM_ACCOUNTS=[{"name":"kcore.editss","id":"17841472678183501","token":"IGAANeMsUNbAVBZAFQxX0ZAMVV95WV9xM2dFYUlGaDlOeDNWVHN3bkQwSjFMVjhFQUk2TDc5ZAHhJanhja3pCVnhaNVZA3Rm4wTTQ5aVQ0eUU4S3h6NnVUZAk9PamtmZAFBwaWliQlg5SDRUSkYtcFZAid3BGaVRiUE1jaWMzM3Q5X3FLZAwZDZD"},{"name":"kdrama.editzzz","id":"17841473190704862","token":"IGAAImZAO6jJ3tBZAFNUZAUlINTU1Mmh3QUhFc0J4M3hhUHlKcWZAKSC14VXBZAd0lFVlIyZAU44SmdvbThTc3piNTBsamJFMWp2TTg0aThNd1BIMVE5S1dwWDlUejN1NzhCeEpzdHpQdEs3YkV2dFh2UDRTTGVnTWJZAZAkVFSjVmaExKSQZDZD"}]
```

#### Token Expiration & Refresh

- **Short-lived tokens:** 1 hour (must be exchanged immediately)
- **Long-lived tokens:** 60 days
- **Refresh before expiration:** Set a reminder for day 50

**To refresh a long-lived token (before it expires):**

```
https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=YOUR_APP_ID&client_secret=YOUR_APP_SECRET&fb_exchange_token=YOUR_CURRENT_LONG_LIVED_TOKEN
```

This gives you a new 60-day token. Update your .env file with the new token.

#### Testing Your Instagram Token

Verify your token works:

```bash
curl "https://graph.facebook.com/v18.0/17841472678183501?fields=username,name&access_token=YOUR_TOKEN"
```

Should return:

```json
{
  "username": "your_instagram_username",
  "name": "Your Name",
  "id": "17841472678183501"
}
```

If you get an error, the token is invalid or expired.

---

### GitHub Setup (Video Storage)

1. **Create Personal Access Token**

   - Go to https://github.com/settings/tokens
   - Click "Generate new token (classic)"
   - Select scopes: `repo` (full control)
   - Generate and copy token

2. **Create Repository**

   - Create a new repository for video storage
   - Can be public or private

3. **Add to .env**
   ```env
   GITHUB_TOKEN=your_github_token
   GITHUB_OWNER=your_github_username
   GITHUB_REPO=your_repo_name
   ```

---

### Gemini AI Setup (AI-Powered Captions)

The bot uses Google's Gemini AI to generate unique, engaging captions for every post. This ensures your content never feels repetitive!

#### Step 1: Get Gemini API Key

1. Go to https://aistudio.google.com/app/apikey
2. Click "Create API Key"
3. Select "Create API key in new project" (or use existing project)
4. Copy the API key

#### Step 2: Add to .env

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

**Example:**

```env
GEMINI_API_KEY=AIzaSyBxXxXxXxXxXxXxXxXxXxXxXxXxXxX
```

#### Features

**Instagram Captions:**

- Unique caption for every post
- Trendy, Gen-Z language
- Strategic emoji usage
- Natural promotion of idolchat.app
- Credits original creator
- Relevant hashtags

**YouTube Metadata:**

- SEO-optimized titles
- Engaging descriptions
- Keyword-rich content
- Professional tone
- Credits original creator

#### Rate Limits

- **Free Tier:** 15 requests per minute
- **Bot Usage:** ~2 requests per video (Instagram + YouTube)
- **Daily Limit:** 1,500 requests per day (free tier)
- Can process ~750 videos per day

#### Fallback System

If Gemini API fails or rate limit is hit:

- Bot automatically uses fallback captions
- No interruption to posting
- Logs error for debugging

---

### YouTube Setup

#### Step 1: Create Google Cloud Project

1. Go to https://console.cloud.google.com
2. Create a new project or select existing
3. Enable YouTube Data API v3:
   - Go to "APIs & Services" → "Library"
   - Search for "YouTube Data API v3"
   - Click "Enable"

#### Step 2: Create OAuth 2.0 Credentials

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth client ID"
3. Configure OAuth consent screen (if first time):
   - User Type: External
   - Fill in app name and support email
   - Add your email as test user
   - Save and continue
4. Create OAuth Client ID:
   - Application type: **Web application**
   - Name: "Instagram Autoposter Bot"
   - Authorized redirect URIs: `http://localhost:3000/oauth2callback`
   - Click "Create"
5. Copy Client ID and Client Secret

#### Step 3: Add OAuth Credentials to .env

```env
YOUTUBE_CLIENT_ID=your_client_id.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=your_client_secret
YOUTUBE_REDIRECT_URI=http://localhost:3000/oauth2callback
```

#### Step 4: Get Access & Refresh Tokens

**Important:** Make sure you've added your OAuth credentials to .env first (from Step 3)!

Run the helper script:

```bash
node youtube-auth-helper.js
```

**What happens:**

1. ✅ Script validates your .env credentials
2. ✅ Starts a local server on port 3000
3. ✅ Opens your browser automatically to Google OAuth page
4. ✅ You sign in with your YouTube channel's Google account
5. ✅ Click "Allow" to grant permissions
6. ✅ Browser redirects to localhost (script captures the code)
7. ✅ Script exchanges code for tokens
8. ✅ Tokens are displayed in terminal

**Expected Output:**

```
=================================================
YouTube OAuth Token Generator
=================================================

Starting local server on http://localhost:3000
Your browser will open automatically...

If browser doesn't open, manually visit:
https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&scope=...

✅ Authorization code received!

=================================================
✅ SUCCESS! Your tokens:
=================================================

Access Token:
ya29.a0ATi6K2t...EXAMPLE_ACCESS_TOKEN_HERE

Refresh Token:
1//0gmTL1D6w...EXAMPLE_REFRESH_TOKEN_HERE

Expires At:
28/11/2025, 7:40:29 pm

=================================================
Add these to your .env file:
=================================================

YOUTUBE_ACCOUNTS=[{"name":"My Channel","accessToken":"ya29.a0ATi6K2t...EXAMPLE","refreshToken":"1//0gmTL1D6w...EXAMPLE"}]
```

#### Step 5: Add Tokens to .env

Copy the `YOUTUBE_ACCOUNTS` line from the terminal output and paste it into your .env file:

```env
YOUTUBE_ACCOUNTS=[{"name":"My Channel","accessToken":"ya29.a0ATi6K2t...EXAMPLE","refreshToken":"1//0gmTL1D6w...EXAMPLE"}]
```

**Multiple YouTube Channels:**

To add multiple channels, run the helper script for each channel (sign in with different Google accounts):

```env
YOUTUBE_ACCOUNTS=[{"name":"Channel1","accessToken":"ya29...","refreshToken":"1//0g..."},{"name":"Channel2","accessToken":"ya29...","refreshToken":"1//0h..."}]
```

**Real Example:**

```env
YOUTUBE_ACCOUNTS=[{"name":"My Channel","accessToken":"ya29.a0ATi6K2t...EXAMPLE_ACCESS_TOKEN","refreshToken":"1//0gmTL1D6w...EXAMPLE_REFRESH_TOKEN"}]
```

#### Token Management

- **Access tokens:** Expire in 1 hour
- **Refresh tokens:** Long-lived (until revoked)
- **Auto-refresh:** Bot automatically refreshes access tokens using refresh tokens
- **No manual intervention needed** after initial setup

#### Troubleshooting YouTube Auth

**Error: "Missing YouTube OAuth credentials in .env file"**

- Make sure you added `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, and `YOUTUBE_REDIRECT_URI` to .env

**Error: "invalid_request" or "redirect_uri_mismatch"**

- Verify redirect URI in Google Cloud Console matches exactly: `http://localhost:3000/oauth2callback`
- No trailing slash, must be exact match

**Error: "Access denied"**

- Add your email as a test user in OAuth consent screen
- Go to: https://console.cloud.google.com/apis/credentials/consent
- Scroll to "Test users" and add your email

**Browser doesn't open automatically**

- Copy the URL from terminal and paste in browser manually
- Make sure port 3000 is not in use by another application

**Error: "This app isn't verified"**

- Click "Advanced" → "Go to [App Name] (unsafe)"
- This is normal for apps in testing mode with your own credentials

---

## 🎬 Video Processing Features

The bot automatically:

- Downloads Instagram reels
- Strips metadata for privacy
- Enhances video quality
- Adjusts aspect ratio to 9:16
- Adds Netflix-style text overlay with red attention bar
- Uploads to GitHub for backup
- Posts to all configured Instagram accounts
- Uploads to all configured YouTube accounts

### Customizing Video Overlay

Edit `bot.js` to customize the text overlay:

```javascript
finalPath = await addPromoToVideo(editedPath, sessionId, {
  text: "your-text-here", // Main text
  subtitle: "your-subtitle-here", // Subtitle text
  appearAt: 0.5, // When to show (seconds)
  visibleFor: 5.0, // How long to display (seconds)
  x: 60, // X position from left
  y: 150, // Y position from top
  fontSize: 64, // Main text size
  subtitleSize: 38, // Subtitle text size
  barWidth: 8, // Red bar width
});
```

---

## 🏃 Running the Bot

### Start the Bot

```bash
npm start
```

or

```bash
node bot.js
```

### How to Use

1. Bot listens to your Discord channel
2. Send an Instagram reel URL in the channel
3. Bot automatically:
   - Downloads the video
   - Processes it with overlay
   - Uploads to GitHub
   - Posts to all Instagram accounts
   - Uploads to all YouTube accounts
4. Receive status updates in Discord

---

## 🔒 Security Best Practices

1. **Never commit .env file**

   - Already in `.gitignore`
   - Contains sensitive credentials

2. **Rotate tokens regularly**

   - Instagram: Every 60 days
   - GitHub: Annually or when compromised
   - YouTube: Refresh tokens are long-lived

3. **Use environment variables**

   - Never hardcode credentials in code
   - Use `.env` file for local development
   - Use platform secrets for production

4. **Limit token permissions**
   - Only grant necessary scopes
   - Use separate tokens for different services

---

## 🐛 Troubleshooting

### Instagram Issues

**"Invalid access token"**

- Token expired (60 days for long-lived)
- Regenerate token using Graph API Explorer

**"Permission denied"**

- Ensure account is Business/Creator
- Check token has correct permissions

### YouTube Issues

**"Invalid credentials"**

- Check CLIENT_ID and CLIENT_SECRET in .env
- Ensure redirect URI matches exactly

**"Access denied"**

- Add your email as test user in OAuth consent screen
- Ensure YouTube Data API v3 is enabled

**"Quota exceeded"**

- YouTube API has daily quota limits
- Default: 10,000 units/day
- One upload ≈ 1,600 units
- Request quota increase if needed

### Discord Issues

**"Bot not responding"**

- Check bot token is correct
- Ensure bot has permissions in channel
- Verify channel ID is correct

### FFmpeg Issues

**"FFmpeg not found"**

- Install FFmpeg: https://ffmpeg.org/download.html
- Add to system PATH
- Restart terminal/IDE

---

## 📊 API Quotas & Limits

### Instagram

- 200 API calls per hour per user
- 25 posts per day per account

### YouTube

- 10,000 units per day (default)
- Upload = ~1,600 units
- Can upload ~6 videos per day

### GitHub

- 5,000 requests per hour (authenticated)
- File size limit: 100 MB

---

## 🆘 Support

If you encounter issues:

1. Check this guide thoroughly
2. Verify all credentials in .env
3. Check console logs for error messages
4. Ensure all APIs are enabled in respective platforms
5. Verify token permissions and expiration

---

## 📝 Notes

- Keep your .env file secure and never share it
- Tokens in this guide are examples - use your own
- Bot requires stable internet connection
- Processing time depends on video size
- All tokens auto-refresh when possible

---

## ✅ Checklist

Before running the bot, ensure:

- [ ] Node.js and npm installed
- [ ] FFmpeg installed and in PATH
- [ ] Discord bot created and token added
- [ ] Instagram accounts configured with tokens
- [ ] GitHub token and repository set up
- [ ] Gemini API key added (for AI captions)
- [ ] YouTube OAuth credentials configured (optional)
- [ ] YouTube tokens generated via helper script (optional)
- [ ] All credentials added to .env file
- [ ] Dependencies installed (`npm install`)

---

## 🤖 AI Caption Examples

### Instagram Caption Examples

**Example 1:**

```
✨ This hit different! Check out idolchat.app - way better than c.ai for chatting with your fave characters 💫

🎬 via @original_creator

#kpop #kdrama #idolchat #viral #trending
```

**Example 2:**

```
🔥 Can't stop watching this! Try idolchat.app to chat, collect & trade AI characters - it's like c.ai but actually fun 🎮

🎬 via @original_creator

#trending #kpop #kdrama #idolchat
```

### YouTube Metadata Examples

**Title:**

```
This K-drama Scene Hit Different 😭 | idolchat.app
```

**Description:**

```
Check out idolchat.app - the ultimate AI character chat platform! Better than c.ai and chai, you can chat, collect, style, and trade characters in a multiplayer experience.

Credit: @original_creator

#kpop #kdrama #idolchat #viral #trending
```

---

**Ready to go! Run `npm start` and send an Instagram reel URL to your Discord channel!** 🚀
