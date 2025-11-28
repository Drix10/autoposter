# Instagram Auto-Poster Bot

A Discord bot that automatically downloads Instagram reels, processes them with custom overlays, and reposts them to multiple Instagram accounts and YouTube channels.

## Features

- 🎬 Download Instagram reels via Discord commands
- 🎨 Add Netflix-style text overlays with fade effects
- 📤 Upload to multiple Instagram accounts simultaneously
- 📺 Upload to YouTube channels (optional)
- 🔄 Automatic retry logic with exponential backoff
- 🧹 Smart file cleanup and memory management
- 📊 Real-time progress tracking in Discord
- 🔒 Secure credential management with environment variables

## Prerequisites

- Node.js 16+
- FFmpeg installed on your system
- Discord Bot Token
- Instagram Graph API tokens
- GitHub account (for video storage)
- YouTube API credentials (optional)

## Installation

1. Clone the repository:

```bash
git clone <your-repo-url>
cd autoposter
```

2. Install dependencies:

```bash
npm install
```

3. Create `.env` file from the example:

```bash
cp .env.example .env
```

4. Fill in your credentials in `.env`:
   - Discord bot token and channel ID
   - Instagram account credentials (JSON array)
   - GitHub token and repo details
   - YouTube credentials (optional)

## Configuration

### Instagram Accounts

Add your Instagram accounts in JSON format:

```json
[
  {
    "name": "account_name",
    "id": "instagram_user_id",
    "token": "instagram_access_token"
  }
]
```

### YouTube Accounts (Optional)

Add YouTube channels in JSON format:

```json
[
  {
    "name": "Channel Name",
    "apiKey": "your_api_key",
    "accessToken": "your_access_token",
    "refreshToken": "your_refresh_token"
  }
]
```

## Usage

1. Start the bot:

```bash
npm start
```

2. In your Discord channel, post an Instagram reel URL with optional parameters:

**Basic usage:**

```
https://instagram.com/reel/xyz
```

**With author:**

```
https://instagram.com/reel/xyz author: username_123
```

**With custom caption:**

```
https://instagram.com/reel/xyz caption: Amazing content! #viral #trending
```

**Repost mode (keeps original caption):**

```
https://instagram.com/reel/xyz repost author: username_123
```

## Features in Detail

### Video Processing

- Strips metadata for privacy
- Adjusts aspect ratio to 9:16 (Instagram Reels format)
- Applies quality enhancements (contrast, saturation, sharpness)
- Adds custom text overlay with fade effects

### Text Overlay

- Netflix-style appearance
- Red attention bar on the left
- Customizable text, position, and timing
- Smooth fade in/out effects

### Upload Strategy

- Uploads to GitHub for reliable hosting
- Posts to all configured Instagram accounts
- Optional YouTube upload
- Automatic retry on failures
- Rate limiting protection

### Error Handling

- Comprehensive error logging
- Automatic retry with exponential backoff
- Graceful degradation (continues with other accounts if one fails)
- Memory leak prevention
- Proper resource cleanup

## Security

- ✅ All credentials stored in `.env` file
- ✅ `.env` excluded from git via `.gitignore`
- ✅ No hardcoded secrets in source code
- ⚠️ **Important**: Never commit your `.env` file to git

## Troubleshooting

### FFmpeg not found

Install FFmpeg:

- **Windows**: Download from [ffmpeg.org](https://ffmpeg.org/download.html)
- **Linux**: `sudo apt install ffmpeg`
- **macOS**: `brew install ffmpeg`

### Font not found

The bot looks for fonts in these locations:

- Windows: `C:\Windows\Fonts\arial.ttf`
- Linux: `/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf`
- macOS: `/System/Library/Fonts/Helvetica.ttc`

### Memory issues

If you encounter memory issues with large videos:

- Reduce `MAX_CONCURRENT_SESSIONS` in bot.js
- Increase Node.js memory: `node --max-old-space-size=4096 bot.js`

### Rate limiting

Instagram has rate limits. The bot includes:

- 30-second delays between Instagram uploads
- 10-second delays between YouTube uploads
- Automatic retry with backoff

## Performance

- Concurrent session limit: 3 (configurable)
- Max video size: 75MB (GitHub API limit)
- Caption limit: 2200 characters (Instagram limit)
- Automatic cleanup of temporary files

## Code Quality

This project includes:

- ✅ Memory leak prevention
- ✅ Proper stream handling
- ✅ FFmpeg process management
- ✅ Comprehensive error handling
- ✅ Resource cleanup
- ✅ Cross-platform font support

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - feel free to use this project for personal or commercial purposes.

## Disclaimer

This bot is for educational purposes. Make sure you:

- Have permission to repost content
- Comply with Instagram's Terms of Service
- Respect copyright and intellectual property
- Give credit to original creators

## Support

For issues or questions:

1. Check the troubleshooting section
2. Review the code documentation
3. Open an issue on GitHub

---

**Note**: This bot requires valid API credentials and proper configuration. Ensure all credentials are kept secure and never shared publicly.
