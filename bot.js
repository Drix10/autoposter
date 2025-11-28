const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");

const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const delay = require("delay");
const geminiService = require("./gemini-service");

function logToDiscord(channel, message, type = "info") {
  const icons = {
    info: "ℹ️",
    success: "✅",
    warning: "⚠️",
    error: "❌",
    process: "⚙️",
  };

  return channel.send(`${icons[type]} ${message}`);
}

// Load environment variables
require("dotenv").config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

// Parse Instagram accounts from environment
const ACCOUNTS = JSON.parse(process.env.INSTAGRAM_ACCOUNTS || "[]");

const GITHUB_CONFIG = {
  token: process.env.GITHUB_TOKEN,
  owner: process.env.GITHUB_OWNER,
  repo: process.env.GITHUB_REPO,
};

// Parse YouTube accounts from environment
const YOUTUBE_ACCOUNTS = JSON.parse(process.env.YOUTUBE_ACCOUNTS || "[]");

// Validate required environment variables
if (!DISCORD_TOKEN || !CHANNEL_ID) {
  console.error(
    "❌ Missing required environment variables: DISCORD_TOKEN, CHANNEL_ID"
  );
  process.exit(1);
}

if (ACCOUNTS.length === 0) {
  console.warn("⚠️ No Instagram accounts configured");
}

if (!GITHUB_CONFIG.token || !GITHUB_CONFIG.owner || !GITHUB_CONFIG.repo) {
  console.warn("⚠️ GitHub configuration incomplete - uploads will fail");
}

if (!process.env.GEMINI_API_KEY) {
  console.warn("⚠️ GEMINI_API_KEY not set - AI captions will be disabled");
  console.warn("   Add GEMINI_API_KEY to .env to enable AI-powered captions");
  console.warn(
    "   Get your free API key from: https://aistudio.google.com/app/apikey"
  );
}

const BASE_CAPTION =
  "@idolchat.app is better than c.ai / chai\n\nNot only can you chat with your AI characters but you can collect other's characters, style them, trade them as a card game through a multiplayer experience.\n\nIdol Chat turns these characters into unique collectibles that you can earn, customize, upgrade, trade, and more!\n\n─── ⋆⋅☆⋅⋆ ──✨── ⋆⋅☆⋅⋆ ───\n\n🎬 Yoinked from: @%author% (DM for removal)\n💭 Original Caption:\n\n%originalCaption%";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const activeSessions = new Set();
const MAX_CONCURRENT_SESSIONS = 3;

const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 15000,
  maxDelay: 120000,
  backoffMultiplier: 2,
};

// Timing constants to avoid magic numbers
const DELAYS = {
  BETWEEN_ACCOUNTS: 30000, // 30 seconds between Instagram account uploads
  BETWEEN_YOUTUBE: 10000, // 10 seconds between YouTube uploads
  RANDOM_MIN: 2000, // Minimum random delay
  RANDOM_MAX: 5000, // Maximum random delay
  RANDOM_LARGE_MIN: 5000, // Larger random delay min
  RANDOM_LARGE_MAX: 8000, // Larger random delay max
  COMMENT_DELAY_MIN: 5000, // Min delay before posting comment
  COMMENT_DELAY_MAX: 8000, // Max delay before posting comment
  RATE_LIMIT_WAIT: 60000, // 1 minute wait for rate limits
  CONTAINER_CHECK: 5000, // Base delay for checking container status
  CONTAINER_CHECK_RANDOM: 8000, // Random addition to container check
  PUBLISH_DELAY_MIN: 5000, // Min delay before publishing
  PUBLISH_DELAY_MAX: 10000, // Max delay before publishing
  DOWNLOAD_RETRY: 5000, // Delay between download retries
  API_RETRY: 10000, // Delay between API retries
  BACKOFF_BASE: 30000, // Base backoff delay (30s)
};

// Timeout constants
const TIMEOUTS = {
  AXIOS_DEFAULT: 30000, // 30 seconds
  AXIOS_DOWNLOAD: 60000, // 60 seconds for video downloads
  DOWNLOAD_TOTAL: 120000, // 2 minutes total download timeout
  CAPTION_EXTRACTION: 20000, // 20 seconds for caption extraction
  OEMBED_API: 8000, // 8 seconds for oEmbed API
  ALT_API: 8000, // 8 seconds for alternative API
  SCRAPING: 10000, // 10 seconds for web scraping
  GITHUB_UPLOAD: 120000, // 2 minutes for GitHub upload
  YOUTUBE_API: 15000, // 15 seconds for YouTube API calls
  YOUTUBE_UPLOAD: 30000, // 30 seconds for YouTube upload
  INSTAGRAM_API: 30000, // 30 seconds for Instagram API
  INSTAGRAM_STATUS: 15000, // 15 seconds for status checks
};

// File size limits
const FILE_LIMITS = {
  MIN_VIDEO_SIZE: 1024, // 1KB minimum
  GITHUB_MAX_MB: 70, // 70MB for GitHub (accounting for base64 overhead)
  YOUTUBE_MAX_GB: 128, // 128GB for YouTube (unverified accounts)
  INSTAGRAM_CAPTION_MAX: 2200, // Instagram caption character limit
};

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

async function retryUpload(uploadFunction, account, ...args) {
  let lastError = null;

  for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      console.log(
        `Upload attempt ${attempt}/${RETRY_CONFIG.maxRetries} for ${account.name}`
      );
      const result = await uploadFunction(account, ...args);

      if (attempt > 1) {
        await logToDiscord(
          args[args.length - 1],
          `✅ Upload succeeded on attempt ${attempt} for ${account.name}`,
          "success"
        );
      }

      return result;
    } catch (error) {
      lastError = error;
      console.log(
        `Upload attempt ${attempt} failed for ${account.name}: ${error.message}`
      );

      if (attempt < RETRY_CONFIG.maxRetries) {
        const delay = Math.min(
          RETRY_CONFIG.baseDelay *
            Math.pow(RETRY_CONFIG.backoffMultiplier, attempt - 1),
          RETRY_CONFIG.maxDelay
        );

        await logToDiscord(
          args[args.length - 1],
          `⚠️ Upload attempt ${attempt} failed for ${
            account.name
          }. Retrying in ${Math.round(delay / 1000)}s...`,
          "warning"
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // All retries failed
  throw lastError;
}

client.on("messageCreate", async (message) => {
  if (
    message.channel.id !== CHANNEL_ID ||
    !message.content.includes("instagram.com") ||
    message.author.bot
  )
    return;

  // Match Instagram URLs including both direct and username-based formats
  const reelUrlMatch = message.content.match(
    /https?:\/\/(www\.)?instagram\.com\/(?:([^\/]+)\/)?(reels?|p)\/[\w-]+[^\s]*/
  );
  if (!reelUrlMatch) return;

  const isRepost = message.content.toLowerCase().includes("repost");

  let reelUrl = reelUrlMatch[0];

  if (reelUrl.includes("/reels/")) {
    reelUrl = reelUrl.replace("/reels/", "/reel/");
    console.log(`🔄 Normalized URL from /reels/ to /reel/: ${reelUrl}`);
  }

  console.log(`🔗 Processing Instagram URL: ${reelUrl}`);

  // Usage examples (supports both /reel/ and /reels/ URLs):
  // Basic: https://instagram.com/reel/xyz author: username_123
  // With /reels/: https://instagram.com/reels/xyz author: username_123
  // With manual caption: https://instagram.com/reel/xyz author: username_123 caption: Amazing K-pop dance! #kpop #trending #viral
  // Multi-line caption: https://instagram.com/reel/xyz author: username_123 caption: Amazing dance!
  //                     #kpop #trending #viral
  // Caption only: https://instagram.com/reels/xyz caption: Best K-drama scene ever! #kdrama #emotional #crying
  // Repost with original caption: https://instagram.com/reel/xyz repost author: username_123

  let author = "Original Creator";

  const authorMatch = message.content.match(/author:?\s*([^\s,\n\r]+)/i);
  if (authorMatch && authorMatch[1]) {
    author = authorMatch[1].trim();
    console.log(`👤 Using provided author: ${author}`);
  } else {
    try {
      const apiResponse = await axios.get(
        `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(
          reelUrl
        )}`
      );
      if (apiResponse.data && apiResponse.data.author_name) {
        author = apiResponse.data.author_name;
        console.log(`👤 Author fetched from API: ${author}`);
      } else {
        console.log(`ℹ️ No author found, using default: Original Creator`);
      }
    } catch (error) {
      console.log(`⚠️ Could not fetch author, using default: ${error.message}`);
    }
  }

  let manualCaption = "";

  if (!isRepost) {
    // Try to find caption after removing the URL and author parts
    let textAfterUrl = message.content
      .replace(/https?:\/\/[^\s]+/gi, "")
      .trim();
    if (author !== "Original Creator") {
      textAfterUrl = textAfterUrl
        .replace(
          new RegExp(
            `author:?\\s*${author.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
            "gi"
          ),
          ""
        )
        .trim();
    }

    const captionMatch = textAfterUrl.match(/caption:?\s*([\s\S]+)/i);
    if (captionMatch && captionMatch[1]) {
      manualCaption = captionMatch[1].trim();
      console.log(
        `📝 Manual caption provided: "${manualCaption.substring(0, 80)}${
          manualCaption.length > 80 ? "..." : ""
        }"`
      );
      console.log(`📝 Full caption length: ${manualCaption.length} characters`);
    }
  } else {
    console.log(`🔄 Repost mode: Will use original caption from the post`);
  }

  if (activeSessions.size >= MAX_CONCURRENT_SESSIONS) {
    await message.reply(
      `⚠️ Server is currently processing ${activeSessions.size} reels. Please wait a moment and try again.`
    );
    return;
  }

  const sessionId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  activeSessions.add(sessionId);
  console.log(
    `Starting new session: ${sessionId} (Active: ${activeSessions.size}/${MAX_CONCURRENT_SESSIONS})`
  );

  try {
    const videosDir = path.join(__dirname, "videos");
    if (!fs.existsSync(videosDir)) {
      fs.mkdirSync(videosDir, { recursive: true });
    }

    const memUsage = process.memoryUsage();
    if (memUsage.heapUsed > 500 * 1024 * 1024) {
      console.log(
        `High memory usage detected: ${Math.round(
          memUsage.heapUsed / 1024 / 1024
        )}MB`
      );
    }

    const stats = fs.statSync(videosDir);
    console.log(`Session ${sessionId}: System checks passed`);
  } catch (diskError) {
    activeSessions.delete(sessionId);
    await message.reply(
      "❌ System resources unavailable. Please try again later."
    );
    return;
  }

  try {
    let statusMsg;

    async function updateStatus(title, description, fields, color = 0x3498db) {
      const embed = {
        title,
        description,
        fields,
        color,
        timestamp: new Date(),
      };

      if (!statusMsg) {
        statusMsg = await message.channel.send({ embeds: [embed] });
      } else {
        await statusMsg.edit({ embeds: [embed] }).catch(console.error);
      }
    }

    await updateStatus(
      "🎬 Reel Processing Status",
      "Starting to process your Instagram reel…",
      [
        { name: "URL", value: reelUrl, inline: true },
        { name: "Author", value: author, inline: true },
        { name: "Session ID", value: sessionId, inline: true },
        { name: "Status", value: "⏳ Initializing…", inline: false },
      ]
    );

    await updateStatus(
      "🎬 Reel Processing Status",
      "Downloading reel from Instagram…",
      [
        { name: "URL", value: reelUrl, inline: true },
        { name: "Author", value: author, inline: true },
        { name: "Status", value: "⏳ Downloading…", inline: false },
      ]
    );
    const downloadResult = await downloadReel(
      reelUrl,
      sessionId,
      manualCaption,
      isRepost
    );
    const videoPath = downloadResult.videoPath;
    const originalHashtags = downloadResult.originalHashtags;
    const originalCaption = downloadResult.originalCaption;

    await updateStatus("🎬 Reel Processing Status", "Processing video...", [
      { name: "URL", value: reelUrl, inline: true },
      { name: "Author", value: author, inline: true },
      {
        name: "Mode",
        value: isRepost ? "🔄 Repost" : "🆕 Standard",
        inline: true,
      },
      {
        name: "Caption Source",
        value: isRepost ? "Original" : manualCaption ? "Manual" : "Auto",
        inline: true,
      },
      {
        name: "Hashtags Found",
        value: originalHashtags.length.toString(),
        inline: true,
      },
      { name: "Status", value: "⏳ Processing...", inline: false },
    ]);
    let cleanedPath = videoPath;
    let editedPath = videoPath;
    let finalPath = videoPath;

    try {
      cleanedPath = await stripAllMetadata(videoPath, sessionId);
      editedPath = await processVideo(cleanedPath, sessionId);
      finalPath = await addPromoToVideo(editedPath, sessionId, {
        text: "idolchat.app",
        subtitle: "Better than c.ai",
        x: 70,
        y: 150,
        appearAt: 0.5,
        visibleFor: 5.0,
        fadeInDuration: 0.3,
        fadeOutDuration: 0.3,
        fontSize: 64,
        subtitleSize: 38,
        barWidth: 8,
        barColor: "red",
        textColor: "white",
      });
    } catch (processingError) {
      console.error(
        `Processing error for session ${sessionId}:`,
        processingError.message
      );
      finalPath = videoPath;
    }

    await updateStatus("🎬 Reel Processing Status", "Uploading to Discord...", [
      { name: "URL", value: reelUrl, inline: true },
      { name: "Author", value: author, inline: true },
      { name: "Status", value: "⏳ Uploading...", inline: false },
    ]);
    const githubVideoUrl = await uploadToGitHub(message.channel, finalPath);
    const githubStoryUrl = githubVideoUrl; // Use same video for story

    // Generate AI captions ONCE for all accounts - OPTIMIZED!
    // Upload video once and reuse for both Instagram and YouTube
    let aiGeneratedCaption = null;
    let ytTitle = null;
    let ytDescription = null;

    if (!isRepost) {
      let geminiVideoFile = null;

      try {
        // Step 1: Upload video to Gemini ONCE
        await logToDiscord(
          message.channel,
          `📹 Uploading video to AI for analysis...`,
          "info"
        );

        geminiVideoFile = await geminiService.uploadVideoForAnalysis(finalPath);
        console.log(`✅ Video uploaded to Gemini: ${geminiVideoFile.name}`);

        // Step 2: Generate Instagram caption using uploaded video
        await logToDiscord(
          message.channel,
          `🤖 Generating Instagram caption...`,
          "info"
        );

        aiGeneratedCaption =
          await geminiService.generateInstagramCaptionWithFile(
            originalCaption,
            author,
            originalHashtags,
            geminiVideoFile
          );

        console.log(
          `✨ Instagram caption generated (${
            aiGeneratedCaption.length
          } chars): ${aiGeneratedCaption.substring(0, 100)}...`
        );

        // Step 3: Generate YouTube metadata using SAME uploaded video
        if (YOUTUBE_ACCOUNTS.length > 0) {
          await logToDiscord(
            message.channel,
            `🤖 Generating YouTube metadata...`,
            "info"
          );

          const ytMetadata =
            await geminiService.generateYouTubeMetadataWithFile(
              originalCaption,
              author,
              originalHashtags,
              geminiVideoFile
            );

          ytTitle = ytMetadata.title;
          ytDescription = ytMetadata.description;

          console.log(`✨ YouTube metadata generated:`);
          console.log(`   Title: ${ytTitle}`);
          console.log(`   Description: ${ytDescription.substring(0, 100)}...`);
        }

        // Step 4: Clean up uploaded video file
        await geminiService.cleanupVideoFile(geminiVideoFile.name);
        console.log(`🧹 Cleaned up Gemini video file`);
      } catch (error) {
        console.error("Failed to generate AI captions:", error);
        await logToDiscord(
          message.channel,
          `⚠️ AI caption generation failed: ${error.message}`,
          "warning"
        );
        await logToDiscord(
          message.channel,
          `Using fallback captions for all accounts`,
          "info"
        );

        // Clean up video file if it was uploaded
        if (geminiVideoFile) {
          try {
            await geminiService.cleanupVideoFile(geminiVideoFile.name);
          } catch (cleanupError) {
            console.error("Failed to cleanup video file:", cleanupError);
          }
        }
      }
    }

    let completedUploads = 0;
    const totalUploads = ACCOUNTS.length;

    for (let account of ACCOUNTS) {
      try {
        await updateStatus(
          "📤 Upload Progress",
          `Uploading to Instagram (${account.name})...`,
          [
            { name: "Current Account", value: account.name, inline: true },
            { name: "Platform", value: "Instagram", inline: true },
            {
              name: "Progress",
              value: `${completedUploads}/${totalUploads}`,
              inline: true,
            },
            { name: "Status", value: "⏳ Publishing…", inline: false },
          ],
          0xf1c40f
        );

        await retryUpload(
          postToInstagram,
          account,
          githubVideoUrl,
          githubStoryUrl,
          author,
          originalHashtags,
          message.channel,
          originalCaption,
          isRepost,
          aiGeneratedCaption // Pass the pre-generated caption
        );
        completedUploads++;
      } catch (error) {
        await logToDiscord(
          message.channel,
          `❌ All retry attempts failed for ${account.name}: ${error.message}`,
          "error"
        );
        await logToDiscord(
          message.channel,
          `Skipping to the next account...`,
          "info"
        );
      }
      await delay(DELAYS.BETWEEN_ACCOUNTS);
    }

    // Upload to YouTube accounts
    let completedYouTubeUploads = 0;
    const totalYouTubeUploads = YOUTUBE_ACCOUNTS.length;

    // YouTube metadata already generated above (reusing same video upload)
    // Set fallback if not generated
    if (!ytTitle && YOUTUBE_ACCOUNTS.length > 0) {
      ytTitle = `${author} | K-drama/K-pop Content | idolchat.app`;
      ytDescription =
        isRepost && originalCaption
          ? originalCaption
          : `${BASE_CAPTION.replace("%author%", author).replace(
              "%originalCaption%",
              originalCaption || "No caption available"
            )}`;
    }

    const ytTags = ["kpop", "kdrama", "idolchat", "viral", "trending", author];

    for (let ytAccount of YOUTUBE_ACCOUNTS) {
      try {
        await updateStatus(
          "📤 YouTube Upload Progress",
          `Uploading to YouTube (${ytAccount.name})...`,
          [
            { name: "Current Account", value: ytAccount.name, inline: true },
            { name: "Platform", value: "YouTube", inline: true },
            {
              name: "Progress",
              value: `${completedYouTubeUploads}/${totalYouTubeUploads}`,
              inline: true,
            },
            { name: "Status", value: "⏳ Uploading…", inline: false },
          ],
          0xff0000
        );

        await uploadToYouTube(
          ytAccount,
          finalPath,
          ytTitle,
          ytDescription,
          ytTags,
          message.channel
        );
        completedYouTubeUploads++;
      } catch (error) {
        await logToDiscord(
          message.channel,
          `❌ YouTube upload failed for ${ytAccount.name}: ${error.message}`,
          "error"
        );
        await logToDiscord(
          message.channel,
          `Skipping to the next YouTube account...`,
          "info"
        );
      }
      await delay(DELAYS.BETWEEN_YOUTUBE); // Delay between YouTube uploads
    }

    try {
      const filesToClean = [
        path.join(__dirname, "videos", `reel_${sessionId}.mp4`),
        path.join(__dirname, "videos", `cleaned_${sessionId}.mp4`),
        path.join(__dirname, "videos", `edited_reel_${sessionId}.mp4`),
        path.join(__dirname, "videos", `final_reel_${sessionId}.mp4`),
      ];

      // Also clean up any retry attempt files
      try {
        const videosDir = path.join(__dirname, "videos");
        if (fs.existsSync(videosDir)) {
          const allFiles = fs.readdirSync(videosDir);
          const retryFiles = allFiles
            .filter(
              (f) => f.includes(sessionId) || f.startsWith("instagram_upload_")
            )
            .map((f) => path.join(videosDir, f));
          filesToClean.push(...retryFiles);
        }
      } catch (dirError) {
        console.error(`Error reading videos directory:`, dirError.message);
      }

      // Use Set to avoid duplicate file paths
      const uniqueFiles = [...new Set(filesToClean)];

      for (const file of uniqueFiles) {
        try {
          // Double-check existence before deletion to avoid race conditions
          if (fs.existsSync(file)) {
            fs.unlinkSync(file);
            console.log(`🧹 Cleaned up: ${path.basename(file)}`);
          }
        } catch (error) {
          // Ignore ENOENT errors (file already deleted)
          if (error.code !== "ENOENT") {
            console.error(
              `Failed to delete ${path.basename(file)}:`,
              error.message
            );
          }
        }
      }
      console.log(`🧹 Cleanup completed for session: ${sessionId}`);
    } catch (cleanupError) {
      console.error(
        `Cleanup error for session ${sessionId}:`,
        cleanupError.message
      );
    } finally {
      // Only delete session here, not in try block (prevents race condition)
      if (activeSessions.has(sessionId)) {
        activeSessions.delete(sessionId);
        console.log(
          `Session ${sessionId} completed. Active sessions: ${activeSessions.size}`
        );
      }
    }

    // Better success/failure logic
    const instagramFailed = totalUploads > 0 && completedUploads === 0;
    const youtubeFailed =
      totalYouTubeUploads > 0 && completedYouTubeUploads === 0;
    const instagramPartial =
      totalUploads > 0 &&
      completedUploads > 0 &&
      completedUploads < totalUploads;
    const youtubePartial =
      totalYouTubeUploads > 0 &&
      completedYouTubeUploads > 0 &&
      completedYouTubeUploads < totalYouTubeUploads;

    if (instagramFailed && youtubeFailed) {
      await updateStatus(
        "❌ Process Failed",
        "All uploads failed. Please check the logs for details.",
        [
          {
            name: "Instagram Uploads",
            value: `${completedUploads}/${totalUploads}`,
            inline: true,
          },
          {
            name: "YouTube Uploads",
            value: `${completedYouTubeUploads}/${totalYouTubeUploads}`,
            inline: true,
          },
          { name: "Author", value: author, inline: true },
        ],
        0xe74c3c
      );
    } else if (
      instagramFailed ||
      youtubeFailed ||
      instagramPartial ||
      youtubePartial
    ) {
      await updateStatus(
        "⚠️ Partial Success",
        "Some uploads completed, but some failed. Check logs for details.",
        [
          {
            name: "Instagram Uploads",
            value: `${completedUploads}/${totalUploads}`,
            inline: true,
          },
          {
            name: "YouTube Uploads",
            value: `${completedYouTubeUploads}/${totalYouTubeUploads}`,
            inline: true,
          },
          { name: "Author", value: author, inline: true },
          {
            name: "Time Taken",
            value: `${Math.round(
              (Date.now() - statusMsg.createdTimestamp) / 1000
            )}s`,
            inline: true,
          },
        ],
        0xf39c12
      );
    } else {
      await updateStatus(
        "✅ Process Completed",
        "All operations completed successfully!",
        [
          {
            name: "Instagram Uploads",
            value: `${completedUploads}/${totalUploads}`,
            inline: true,
          },
          {
            name: "YouTube Uploads",
            value: `${completedYouTubeUploads}/${totalYouTubeUploads}`,
            inline: true,
          },
          { name: "Author", value: author, inline: true },
          {
            name: "Time Taken",
            value: `${Math.round(
              (Date.now() - statusMsg.createdTimestamp) / 1000
            )}s`,
            inline: true,
          },
        ],
        0x2ecc71
      );
    }
  } catch (error) {
    await logToDiscord(
      message.channel,
      `Error in session ${sessionId}: ${error.message}`,
      "error"
    );
    console.error(`Process failed for session ${sessionId}:`, error);
  } finally {
    // Ensure session is always cleaned up on error
    if (activeSessions.has(sessionId)) {
      activeSessions.delete(sessionId);
      console.log(
        `Session ${sessionId} cleaned up after error. Active sessions: ${activeSessions.size}`
      );
    }
  }
});

async function downloadReel(
  instagramUrl,
  sessionId,
  manualCaption = "",
  isRepost = false
) {
  if (
    !instagramUrl ||
    typeof instagramUrl !== "string" ||
    !instagramUrl.includes("instagram.com")
  ) {
    throw new Error("Invalid Instagram URL provided");
  }

  const API_URL = `https://igdl-five.vercel.app/api/video?postUrl=${encodeURIComponent(
    instagramUrl
  )}`;

  try {
    const response = await axios.get(API_URL, {
      timeout: TIMEOUTS.AXIOS_DEFAULT,
      maxRedirects: 5,
    });

    // Validate response structure
    if (
      !response?.data?.data?.videoUrl ||
      typeof response.data.data.videoUrl !== "string"
    ) {
      throw new Error("Invalid or missing video URL in API response");
    }
    const videoUrl = response.data.data.videoUrl;

    // Always try to get the original caption
    let originalCaption = "";
    let originalHashtags = [];

    try {
      console.log(`� Extracting original caption for session: ${sessionId}`);

      const captionPromise = extractInstagramCaption(instagramUrl, sessionId);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Caption extraction timeout")),
          TIMEOUTS.CAPTION_EXTRACTION
        )
      );

      const captionData = await Promise.race([captionPromise, timeoutPromise]);

      if (captionData?.caption && typeof captionData.caption === "string") {
        originalCaption = captionData.caption
          .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
          .trim();

        // Truncate at word boundary to avoid cutting mid-word
        if (originalCaption.length > 600) {
          const truncated = originalCaption.substring(0, 597);
          const lastSpace = truncated.lastIndexOf(" ");
          originalCaption =
            (lastSpace > 500 ? truncated.substring(0, lastSpace) : truncated) +
            "...";
        }

        // Store the extracted hashtags
        originalHashtags = captionData.hashtags || [];

        console.log(`✅ Original caption extracted (${
          originalCaption.length
        } chars) for session: ${sessionId}
                Preview: "${originalCaption.substring(0, 80)}${
          originalCaption.length > 80 ? "..." : ""
        }"
                Hashtags found: ${originalHashtags.length} (${originalHashtags
          .slice(0, 5)
          .join(" ")}${originalHashtags.length > 5 ? "..." : ""})`);
      } else {
        originalCaption = "";
        originalHashtags = [];
        console.log(`⚠️ No caption found for session: ${sessionId}`);
      }
    } catch (captionError) {
      console.log(
        `Could not extract caption for session ${sessionId}:`,
        captionError.message
      );
    }

    const videoPath = path.join(__dirname, "videos", `reel_${sessionId}.mp4`);
    const writer = fs.createWriteStream(videoPath);
    const videoResponse = await axios.get(videoUrl, {
      responseType: "stream",
      timeout: TIMEOUTS.AXIOS_DOWNLOAD,
      maxContentLength: 100 * 1024 * 1024, // 100MB max
      validateStatus: (status) => status === 200, // Only accept 200 status
    });

    if (!videoResponse.headers["content-type"]?.includes("video/")) {
      throw new Error("Invalid content type received for video");
    }

    videoResponse.data.pipe(writer);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        try {
          writer.destroy();
        } catch (e) {}
        try {
          videoResponse.data.destroy(); // Also destroy response stream
        } catch (e) {}
        fs.unlink(videoPath, () => {}); // Clean up partial file
        reject(new Error(`Download timeout for session ${sessionId}`));
      }, TIMEOUTS.DOWNLOAD_TOTAL);

      writer.on("error", (err) => {
        clearTimeout(timeout);
        try {
          writer.destroy(); // Properly close the stream
        } catch (e) {}
        try {
          videoResponse.data.destroy(); // Close the response stream
        } catch (e) {}
        fs.unlink(videoPath, () => {});
        reject(new Error(`Video write error: ${err.message}`));
      });

      writer.on("finish", () => {
        clearTimeout(timeout);

        // Verify file size
        const stats = fs.statSync(videoPath);
        if (stats.size < FILE_LIMITS.MIN_VIDEO_SIZE) {
          // Less than 1KB is definitely invalid
          try {
            writer.destroy();
          } catch (e) {}
          fs.unlink(videoPath, () => {});
          reject(new Error("Downloaded file is too small to be a valid video"));
          return;
        }

        // Validate video file with ffprobe
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
          if (
            err ||
            !metadata ||
            !metadata.streams ||
            metadata.streams.length === 0
          ) {
            console.error(
              `Invalid video file for session ${sessionId}:`,
              err?.message || "No streams found"
            );
            try {
              writer.destroy();
            } catch (e) {}
            fs.unlink(videoPath, () => {});
            reject(new Error("Downloaded file is not a valid video"));
            return;
          }

          const hasVideo = metadata.streams.some(
            (s) => s.codec_type === "video"
          );
          if (!hasVideo) {
            console.error(`No video stream found for session ${sessionId}`);
            try {
              writer.destroy();
            } catch (e) {}
            fs.unlink(videoPath, () => {});
            reject(new Error("Downloaded file has no video stream"));
            return;
          }

          console.log(`Downloaded reel for session: ${sessionId}`);
          resolve({
            videoPath,
            originalCaption,
            originalHashtags,
            isRepost,
          });
        });
      });
    });
  } catch (error) {
    console.log(`Download error for session ${sessionId}:`, error);
    throw new Error(`Failed to download reel: ${error.message}`);
  }
}

async function extractInstagramCaption(instagramUrl, sessionId) {
  console.log(`Attempting to extract caption for session: ${sessionId}`);

  if (!instagramUrl || !instagramUrl.includes("instagram.com")) {
    throw new Error("Invalid Instagram URL provided");
  }
  try {
    console.log(`Trying oEmbed API for session: ${sessionId}`);
    const oembedUrl = `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(
      instagramUrl
    )}`;

    const oembedResponse = await Promise.race([
      axios.get(oembedUrl, {
        timeout: TIMEOUTS.OEMBED_API,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("oEmbed timeout")),
          TIMEOUTS.OEMBED_API
        )
      ),
    ]);

    if (oembedResponse?.data?.title) {
      const caption = String(oembedResponse.data.title);
      const hashtagMatches = caption.match(/#[\w\u0590-\u05ff]+/g) || [];
      console.log(
        `oEmbed success: Found ${hashtagMatches.length} hashtags for session: ${sessionId}`
      );
      return {
        caption: caption,
        hashtags: hashtagMatches, // Include all found hashtags
      };
    }
  } catch (oembedError) {
    console.log(`oEmbed failed for session ${sessionId}:`, oembedError.message);
  }

  // Method 2: Try alternative Instagram API (with safer URL parsing)
  try {
    console.log(`Trying alternative API for session: ${sessionId}`);

    // Safely extract shortcode
    const urlParts = instagramUrl.split("/reel/");
    if (urlParts.length < 2) throw new Error("Invalid reel URL format");

    const shortcode = urlParts[1].split("/")[0];
    if (!shortcode) throw new Error("Could not extract shortcode");

    const altApiUrl = `https://www.instagram.com/api/v1/media/info/?shortcode=${shortcode}`;

    const altResponse = await Promise.race([
      axios.get(altApiUrl, {
        timeout: TIMEOUTS.ALT_API,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Alt API timeout")), TIMEOUTS.ALT_API)
      ),
    ]);

    if (altResponse?.data?.caption) {
      const caption = String(altResponse.data.caption);
      const hashtagMatches = caption.match(/#[\w\u0590-\u05ff]+/g) || [];
      console.log(
        `Alt API success: Found ${hashtagMatches.length} hashtags for session: ${sessionId}`
      );
      return {
        caption: caption,
        hashtags: hashtagMatches, // Include all found hashtags
      };
    }
  } catch (altApiError) {
    console.log(
      `Alternative API failed for session ${sessionId}:`,
      altApiError.message
    );
  }

  // Method 3: Try basic web scraping (simple approach)
  try {
    console.log(`Trying basic scraping for session: ${sessionId}`);

    const response = await Promise.race([
      axios.get(instagramUrl, {
        timeout: TIMEOUTS.SCRAPING,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Accept-Encoding": "gzip, deflate",
          Connection: "keep-alive",
        },
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Scraping timeout")),
          TIMEOUTS.SCRAPING
        )
      ),
    ]);

    // Safely handle HTML content
    const htmlContent = String(response?.data || "");
    if (!htmlContent) throw new Error("Empty HTML response");

    // Try to find JSON data in script tags (with safety checks)
    try {
      const jsonMatches = htmlContent.match(
        /<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs
      );
      if (jsonMatches && Array.isArray(jsonMatches)) {
        for (const jsonMatch of jsonMatches) {
          try {
            const jsonContent = jsonMatch
              .replace(/<script[^>]*>/, "")
              .replace(/<\/script>/, "");
            if (!jsonContent.trim()) continue;

            const data = JSON.parse(jsonContent);
            if (data && (data.caption || data.description || data.name)) {
              const caption = String(
                data.caption || data.description || data.name
              );
              const hashtagMatches =
                caption.match(/#[\w\u0590-\u05ff]+/g) || [];
              console.log(
                `Scraping success: Found ${hashtagMatches.length} hashtags for session: ${sessionId}`
              );
              return {
                caption: caption,
                hashtags: hashtagMatches.slice(0, 10),
              };
            }
          } catch (parseError) {
            continue; // Skip malformed JSON
          }
        }
      }
    } catch (jsonError) {
      console.log(
        `JSON parsing failed for session ${sessionId}:`,
        jsonError.message
      );
    }

    // Try to find hashtags in meta tags (with safety checks)
    try {
      const metaMatches = htmlContent.match(/<meta[^>]+content="[^"]*#[^"]*"/g);
      if (metaMatches && Array.isArray(metaMatches)) {
        const allHashtags = [];
        metaMatches.forEach((meta) => {
          try {
            const contentMatch = meta.match(/content="([^"]*)"/);
            if (contentMatch && contentMatch[1]) {
              const hashtagMatches =
                contentMatch[1].match(/#[\w\u0590-\u05ff]+/g) || [];
              allHashtags.push(...hashtagMatches);
            }
          } catch (metaError) {
            // Skip malformed meta tag
          }
        });

        if (allHashtags.length > 0) {
          const uniqueHashtags = [...new Set(allHashtags)]; // Include all unique hashtags
          console.log(
            `Meta scraping success: Found ${uniqueHashtags.length} hashtags for session: ${sessionId}`
          );
          return {
            caption: "",
            hashtags: uniqueHashtags,
          };
        }
      }
    } catch (metaError) {
      console.log(
        `Meta tag parsing failed for session ${sessionId}:`,
        metaError.message
      );
    }
  } catch (scrapingError) {
    console.log(
      `Scraping failed for session ${sessionId}:`,
      scrapingError.message
    );
  }

  console.log(
    `All caption extraction methods failed for session: ${sessionId}`
  );
  throw new Error("Could not extract caption from any source");
}

function generateHashtags() {
  const defaultHashtags = [
    "#anime",
    "#kpop",
    "#kdrama",
    "#viral",
    "#reels",
    "#fyp",
    "#entertainment",
    "#idolchat",
    "#cai",
    "#trending",
    "#idolchatapp",
    "#chai",
    "#c.ai",
    "#app",
  ];
  const defaultKeywords = [
    "anime",
    "kpop",
    "kdrama",
    "viral",
    "reels",
    "fyp",
    "entertainment",
    "idolchat",
    "cai",
    "trending",
    "idolchatapp",
    "chai",
    "c.ai",
    "app",
  ];
  return [...defaultHashtags, ...defaultKeywords];
}

async function addPromoToVideo(videoPath, sessionId, opts = {}) {
  return new Promise((resolve) => {
    try {
      const outDir = path.join(__dirname, "videos");
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const finalPath = path.join(outDir, `final_reel_${sessionId}.mp4`);
      try {
        if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
      } catch {}

      const {
        text = "idolchat.app", // Main text to display
        subtitle = "Better than c.ai", // Subtitle text
        x = 60, // Left padding from edge
        y = 80, // Top padding from edge
        appearAt = 0.5, // Start showing at 0.5s
        visibleFor = 4.0, // Show for 4 seconds
        fadeInDuration = 0.3, // Fade in over 0.3s
        fadeOutDuration = 0.3, // Fade out over 0.3s
        fontSize = 48, // Main text font size
        subtitleSize = 28, // Subtitle font size
        barWidth = 6, // Red bar width
        barColor = "red", // Bar color
        textColor = "white", // Text color
        crf = 23,
        preset = "medium",
      } = opts;

      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          console.error("ffprobe error:", err.message);
          return resolve(videoPath);
        }

        const vs = metadata.streams.find((s) => s.codec_type === "video");
        if (!vs) {
          console.error("No video stream found.");
          return resolve(videoPath);
        }
        const hasAudio = metadata.streams.some((s) => s.codec_type === "audio");

        const width = vs.width;
        const height = vs.height;
        const targetW = 1080;
        const targetH = 1920;
        const aspect = width / height;
        const targetAspect = 9 / 16;

        let scaleFilter, padFilter;
        if (aspect > targetAspect) {
          const newW = targetW;
          const newH = Math.floor(targetW / aspect);
          const padTop = Math.floor((targetH - newH) / 2);
          scaleFilter = `scale=${newW}:${newH}`;
          padFilter = `pad=${targetW}:${targetH}:0:${padTop}:black`;
        } else {
          const newH = targetH;
          const newW = Math.floor(targetH * aspect);
          const padLeft = Math.floor((targetW - newW) / 2);
          scaleFilter = `scale=${newW}:${newH}`;
          padFilter = `pad=${targetW}:${targetH}:${padLeft}:0:black`;
        }

        const now = new Date();
        const kst = new Date(now.getTime() + 9 * 3600 * 1000)
          .toISOString()
          .replace(/\.\d+Z$/, "");
        const city = { name: "Seoul, South Korea", lat: 37.5665, lng: 126.978 };

        const showStart = Math.max(0, appearAt);
        const showEnd = showStart + visibleFor;
        const fadeInEnd = showStart + fadeInDuration;
        const fadeOutStart = showEnd - fadeOutDuration;

        // Calculate alpha for fade in/out effect
        // Fade in: 0 to 1 from showStart to fadeInEnd
        // Full opacity: fadeInEnd to fadeOutStart
        // Fade out: 1 to 0 from fadeOutStart to showEnd
        const alphaExpr = `if(lt(t\\,${showStart})\\,0\\,if(lt(t\\,${fadeInEnd})\\,(t-${showStart})/${fadeInDuration}\\,if(lt(t\\,${fadeOutStart})\\,1\\,if(lt(t\\,${showEnd})\\,(${showEnd}-t)/${fadeOutDuration}\\,0))))`;

        // Find available font file (cross-platform)
        const fontPaths = [
          "/Windows/Fonts/arial.ttf", // Windows
          "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", // Linux
          "/System/Library/Fonts/Helvetica.ttc", // macOS
          "C:\\Windows\\Fonts\\arial.ttf", // Windows alternative
        ];
        const fontFile =
          fontPaths.find((p) => fs.existsSync(p)) || fontPaths[0];

        // Escape text for drawtext filter
        const escapedText = text.replace(/:/g, "\\:").replace(/'/g, "\\'");
        const escapedSubtitle = subtitle
          .replace(/:/g, "\\:")
          .replace(/'/g, "\\'");

        const cmd = ffmpeg(videoPath)
          .complexFilter([
            // Scale and pad video
            `[0:v]${scaleFilter}[scaled]`,
            `[scaled]${padFilter}[padded]`,
            // Draw red vertical bar on the left
            `[padded]drawbox=x=${x - barWidth - 15}:y=${y}:w=${barWidth}:h=${
              fontSize + subtitleSize + 20
            }:color=${barColor}:t=fill:enable='between(t\\,${showStart}\\,${showEnd})'[with_bar]`,
            // Draw main text with fade effect
            `[with_bar]drawtext=text='${escapedText}':fontfile=${fontFile}:fontsize=${fontSize}:fontcolor=${textColor}:x=${x}:y=${y}:alpha='${alphaExpr}'[with_text]`,
            // Draw subtitle with fade effect
            `[with_text]drawtext=text='${escapedSubtitle}':fontfile=${fontFile}:fontsize=${subtitleSize}:fontcolor=${textColor}:x=${x}:y=${
              y + fontSize + 10
            }:alpha='${alphaExpr}'[vout]`,
          ])
          .outputOptions([
            "-map",
            "[vout]",
            ...(hasAudio ? ["-map", "0:a?"] : ["-an"]),
            "-c:v",
            "libx264",
            "-preset",
            preset,
            "-crf",
            String(crf),
            ...(hasAudio ? ["-c:a", "aac", "-b:a", "192k"] : []),
            "-movflags",
            "+faststart",
            "-metadata",
            `title=K-drama/K-pop | idolchat.app`,
            "-metadata",
            `comment=Reposted Content | Powered by idolchat.app`,
            "-metadata",
            `location=${city.name}`,
            "-metadata",
            `creation_time=${kst}`,
            "-metadata",
            `latitude=${city.lat}`,
            "-metadata",
            `longitude=${city.lng}`,
            "-metadata",
            `location-eng=${city.name}`,
            "-metadata",
            `copyright=idolchat.app`,
          ])
          .on("stderr", (line) => {
            if (line) console.log("[ffmpeg]", line);
          })
          .on("end", () => {
            console.log(
              `✅ Netflix-style text overlay added ${showStart}s→${showEnd}s: ${finalPath}`
            );
            resolve(finalPath);
          })
          .on("error", (e) => {
            try {
              cmd.kill("SIGKILL"); // Kill FFmpeg process to prevent leak
            } catch (killError) {
              console.error(
                "Failed to kill FFmpeg process:",
                killError.message
              );
            }
            console.log(
              `⚠️ Text overlay failed (${e.message}). Returning original.`
            );
            resolve(videoPath);
          });

        cmd.output(finalPath).run();
      });
    } catch (e) {
      console.log("⚠️ addPromoToVideo unexpected error:", e.message);
      return resolve(videoPath);
    }
  });
}

async function stripAllMetadata(videoPath, sessionId) {
  return new Promise((resolve, reject) => {
    const cleanedPath = path.join(
      __dirname,
      "videos",
      `cleaned_${sessionId}.mp4`
    );

    console.log(`🧹 Stripping ALL metadata for session: ${sessionId}`);

    // Simple metadata stripping - no complex fake data to avoid FFmpeg errors
    ffmpeg(videoPath)
      .outputOptions([
        // Strip ALL existing metadata completely
        "-map_metadata",
        "-1",
        "-map_metadata:s:v",
        "-1",
        "-map_metadata:s:a",
        "-1",

        // Copy codecs without re-encoding for speed
        "-c:v",
        "copy",
        "-c:a",
        "copy",

        // Remove all flags and timestamps
        "-fflags",
        "+bitexact",
        "-avoid_negative_ts",
        "make_zero",
      ])
      .output(cleanedPath)
      .on("end", () => {
        console.log(
          `✅ All metadata stripped successfully for session: ${sessionId}`
        );
        resolve(cleanedPath);
      })
      .on("error", (err) => {
        console.error(
          `❌ Metadata stripping failed for session ${sessionId}:`,
          err.message
        );
        console.log(
          `⚠️ Using original video (metadata not stripped) for session: ${sessionId}`
        );
        // Fallback to original if metadata stripping fails
        resolve(videoPath);
      })
      .run();
  });
}

async function processVideo(videoPath, sessionId) {
  return new Promise((resolve, reject) => {
    const editedPath = path.join(
      __dirname,
      "videos",
      `edited_reel_${sessionId}.mp4`
    );

    console.log(`Starting video processing for session: ${sessionId}`);

    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err)
        return reject(
          new Error(
            `Failed to probe video for session ${sessionId}: ` + err.message
          )
        );

      const videoStream = metadata.streams.find(
        (s) => s.codec_type === "video"
      );
      if (!videoStream) return reject(new Error("No video stream found"));

      const hasAudio = metadata.streams.some((s) => s.codec_type === "audio");
      const duration = parseFloat(metadata.format.duration);

      const width = videoStream.width;
      const height = videoStream.height;

      const targetWidth = 1080;
      const targetHeight = 1920;

      const videoAspect = width / height;
      const targetAspect = 9 / 16;

      let scaleFilter, padFilter;

      if (videoAspect > targetAspect) {
        const newWidth = targetWidth;
        const newHeight = Math.floor(targetWidth / videoAspect);
        const paddingTop = Math.floor((targetHeight - newHeight) / 2);
        const paddingBottom = targetHeight - newHeight - paddingTop;

        scaleFilter = `scale=${newWidth}:${newHeight}`;
        padFilter = `pad=${targetWidth}:${targetHeight}:0:${paddingTop}:black`;
      } else {
        const newHeight = targetHeight;
        const newWidth = Math.floor(targetHeight * videoAspect);
        const paddingLeft = Math.floor((targetWidth - newWidth) / 2);
        const paddingRight = targetWidth - newWidth - paddingLeft;

        scaleFilter = `scale=${newWidth}:${newHeight}`;
        padFilter = `pad=${targetWidth}:${targetHeight}:${paddingLeft}:0:black`;
      }

      const now = new Date();
      const kstTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      const kstTimeStr = kstTime.toISOString().replace(/\.\d+Z$/, "");

      const SEO_CITIES = [
        {
          name: "Seoul, South Korea",
          lat: 37.5665,
          lng: 126.978,
          address: "South Korea",
        },
      ];

      const selectedCity = SEO_CITIES[0];

      const trimDuration = (Math.random() * 0.02 + 0.05).toFixed(2);
      const endTrimDuration = (Math.random() * 0.02 + 0.05).toFixed(2);
      const baseDuration =
        duration - parseFloat(trimDuration) - parseFloat(endTrimDuration);
      const outputDuration = baseDuration;

      const contrast = (Math.random() * 0.08 + 1.05).toFixed(3);
      const brightness = (Math.random() * 0.02 - 0.01).toFixed(3);
      const saturation = (Math.random() * 0.1 + 1.05).toFixed(3);
      const gamma = (Math.random() * 0.05 + 0.98).toFixed(3);

      const frameRate = (29.8 + Math.random() * 0.2).toFixed(2);

      const videoBitrate = `${Math.floor(8000 + Math.random() * 2000)}k`;
      const audioBitrate = `${Math.floor(256 + Math.random() * 64)}k`;

      let videoFilters = [];
      videoFilters.push(scaleFilter);
      videoFilters.push(
        `eq=contrast=${contrast}:brightness=${brightness}:saturation=${saturation}:gamma=${gamma}`
      );
      videoFilters.push(`unsharp=5:5:0.8:3:3:0.4`);
      videoFilters.push(`hqdn3d=4:3:6:4.5`);
      videoFilters.push(`colorbalance=rs=0.1:gs=0.05:bs=-0.05`);
      videoFilters.push(`fps=${frameRate}`);

      const finalFilter = `[padded]copy[final]`;

      const command = ffmpeg(videoPath)
        .inputOptions([`-ss ${trimDuration}`])
        .complexFilter(
          [
            `[0:v]${videoFilters.join(",")}[scaled]`,
            `[scaled]${padFilter}[padded]`,
            finalFilter,
          ],
          "final"
        )
        .outputOptions([
          "-t",
          outputDuration.toFixed(2),
          "-c:v",
          "libx264",
          "-c:a",
          "aac",
          `-b:v`,
          `${videoBitrate}`,
          `-b:a`,
          `${audioBitrate}`,
          "-maxrate",
          `${Math.floor(parseInt(videoBitrate) * 1.8)}k`, // Higher maxrate for quality
          "-bufsize",
          `${Math.floor(parseInt(videoBitrate) * 3)}k`, // Larger buffer for quality
          "-crf",
          "15", // Ultra high quality (lower CRF)
          "-preset",
          "veryslow", // Best quality preset
          "-profile:v",
          "high",
          "-level:v",
          "4.2",
          "-pix_fmt",
          "yuv420p",
          "-threads",
          "0", // Use all available cores
          "-movflags",
          "+faststart",
          "-g",
          "48", // Smaller GOP for better quality
          "-keyint_min",
          "24",
          "-sc_threshold",
          "0",
          "-tune",
          "film", // Optimize for high quality content
          "-x264opts",
          "ref=4:bframes=4:b-adapt=2:direct=auto:me=umh:subme=8:analyse=all:8x8dct=1:trellis=2:fast-pskip=0:mixed-refs=1",
          // Keep metadata changes for anti-detection
          "-metadata",
          `title=K-drama/K-pop | idolchat.app`,
          "-metadata",
          `comment=Content | Powered by idolchat.app`,
          "-metadata",
          `location=${selectedCity.name}`,
          "-metadata",
          `creation_time=${kstTimeStr}`,
          "-metadata",
          `latitude=${selectedCity.lat}`,
          "-metadata",
          `longitude=${selectedCity.lng}`,
          "-metadata",
          `location-eng=${selectedCity.name}`,
          "-metadata",
          `copyright=idolchat.app`,
        ]);

      if (hasAudio) {
        // High-quality audio processing with enhancement filters
        command
          .audioFilter(
            "highpass=f=80,lowpass=f=18000,dynaudnorm=g=3,acompressor=threshold=0.1:ratio=2:attack=5:release=50,equalizer=f=3000:width=1000:g=1"
          )
          .outputOptions([
            "-map",
            "0:a?",
            "-ar",
            "48000", // High sample rate
            "-ac",
            "2", // Stereo
            "-b:a",
            "320k", // High quality audio bitrate
            "-acodec",
            "aac",
          ]);
      }

      command
        .output(editedPath)
        .on("end", () => {
          console.log(
            `Video processing completed successfully for session: ${sessionId}`
          );
          resolve(editedPath);
        })
        .on("error", (err) => {
          console.error(
            `Video processing failed for session ${sessionId}:`,
            err.message
          );
          reject(
            new Error(
              `Failed to process video for session ${sessionId}: `.concat(
                err.message
              )
            )
          );
        })
        .run();
    });
  });
}

async function uploadToGitHub(channel, filePath) {
  try {
    const { Octokit } = await import("@octokit/rest");
    const octokit = new Octokit({
      auth: GITHUB_CONFIG.token,
    });

    // Create unique filename
    const timestamp = Date.now();
    const fileName = `video-${timestamp}.mp4`;
    const githubPath = `videos/${fileName}`;

    await logToDiscord(
      channel,
      `Uploading video to GitHub: ${fileName}`,
      "info"
    );

    // Check file size
    const stats = fs.statSync(filePath);
    const fileSizeMB = stats.size / (1024 * 1024);

    // GitHub API limit is 100MB, but base64 encoding adds ~33% overhead
    // So practical limit is around 70MB for the original file to ensure encoded size < 100MB
    if (fileSizeMB > FILE_LIMITS.GITHUB_MAX_MB) {
      throw new Error(
        `File too large (${fileSizeMB.toFixed(2)}MB). GitHub API limit is ${
          FILE_LIMITS.GITHUB_MAX_MB
        }MB (accounting for base64 encoding overhead). Consider using Git LFS or alternative storage.`
      );
    }

    await logToDiscord(
      channel,
      `File size: ${fileSizeMB.toFixed(2)}MB - Encoding to base64...`,
      "info"
    );

    // Read and encode the video file
    const fileContent = fs.readFileSync(filePath);
    const base64Content = fileContent.toString("base64");

    await logToDiscord(
      channel,
      `Uploading to GitHub (this may take a moment)...`,
      "info"
    );

    // Upload directly to repository with timeout handling
    const uploadPromise = octokit.rest.repos.createOrUpdateFileContents({
      owner: GITHUB_CONFIG.owner,
      repo: GITHUB_CONFIG.repo,
      path: githubPath,
      message: `Upload video: ${fileName}`,
      content: base64Content,
      branch: "main",
    });

    // Add a reasonable timeout for large files
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Upload timeout after 2 minutes")),
        TIMEOUTS.GITHUB_UPLOAD
      )
    );

    await Promise.race([uploadPromise, timeoutPromise]);

    // Generate raw GitHub URL
    const rawUrl = `https://raw.githubusercontent.com/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/main/${githubPath}`;

    await logToDiscord(
      channel,
      `✅ Video uploaded successfully! (${fileSizeMB.toFixed(2)}MB)`,
      "success"
    );

    return rawUrl;
  } catch (error) {
    await logToDiscord(
      channel,
      `GitHub upload failed: ${error.message}`,
      "error"
    );

    // Provide more helpful error messages
    if (error.status === 500) {
      throw new Error(
        `GitHub server error (500). File may be too large or GitHub is experiencing issues. Try again later.`
      );
    } else if (error.status === 422) {
      throw new Error(
        `GitHub rejected the upload (422). File may exceed size limits or be invalid.`
      );
    } else if (error.message.includes("timeout")) {
      throw new Error(
        `Upload timed out. File may be too large for GitHub API.`
      );
    }

    throw new Error(`GitHub Upload Failed: ${error.message}`);
  }
}

async function postFirstComment(account, mediaId, channel) {
  try {
    await delay(Math.floor(Math.random() * 8000) + 5000);

    const selectedHashtags = generateHashtags().join(" ");

    const firstCommentLines = [
      "Follow @idolchat.app for more! ✨",
      "@idolchat.app bringing you the best moments daily! 🔥",
      "More viral content coming to @idolchat.app feed! 💫",
      "@idolchat.app users get the premium experience! ⭐",
      "Join the @idolchat.app community for more! 🚀",
      "Daily dose of perfection by @idolchat.app! ✨",
      "@idolchat.app never misses with the content! 🎯",
    ];

    const randomFirstLine =
      firstCommentLines[Math.floor(Math.random() * firstCommentLines.length)];
    const commentText = `${randomFirstLine}\n.\n.\n.${selectedHashtags}`;

    const apiVersion = "v22.0";
    const userAgent =
      "Instagram 219.0.0.12.117 Android (30/11; 420dpi; 1080x2158; samsung; SM-G998B; p3s; exynos2100; en_US)";

    const commentParams = new URLSearchParams({
      message: commentText,
      access_token: account.token,
    });

    await axios.post(
      `https://graph.instagram.com/${apiVersion}/${mediaId}/comments`,
      commentParams,
      {
        headers: {
          "User-Agent": userAgent,
        },
      }
    );

    await logToDiscord(
      channel,
      `Posted first comment on ${account.name}'s reel.`,
      "success"
    );
  } catch (error) {
    await logToDiscord(
      channel,
      `Failed to post first comment for ${account.name}: ${
        error.response?.data?.error?.message || error.message
      }`,
      "warning"
    );
  }
}

async function uploadToYouTube(
  account,
  videoPath,
  title,
  description,
  tags,
  channel
) {
  let readStream = null;
  try {
    await logToDiscord(
      channel,
      `Starting YouTube upload for ${account.name}...`,
      "info"
    );

    // Validate and truncate title (YouTube limit: 100 characters) at word boundary
    if (title.length > 100) {
      const truncated = title.substring(0, 97);
      const lastSpace = truncated.lastIndexOf(" ");
      title =
        (lastSpace > 80 ? truncated.substring(0, lastSpace) : truncated) +
        "...";
      console.log(`YouTube title truncated to 100 characters`);
    }

    // Validate and truncate description (YouTube limit: 5000 characters) at word boundary
    if (description.length > 5000) {
      const truncated = description.substring(0, 4997);
      const lastSpace = truncated.lastIndexOf(" ");
      description =
        (lastSpace > 4900 ? truncated.substring(0, lastSpace) : truncated) +
        "...";
      console.log(`YouTube description truncated to 5000 characters`);
    }

    // Validate tags (YouTube limits: max 500 characters total, 30 characters per tag)
    if (tags && tags.length > 0) {
      tags = tags
        .map((tag) => (tag.length > 30 ? tag.substring(0, 30) : tag))
        .filter((tag) => tag.length > 0);

      // Ensure total tags length doesn't exceed 500 characters
      let totalLength = tags.join(",").length;
      while (totalLength > 500 && tags.length > 0) {
        tags.pop();
        totalLength = tags.join(",").length;
      }
    }

    const { google } = await import("googleapis");

    const oauth2Client = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID || "YOUR_CLIENT_ID",
      process.env.YOUTUBE_CLIENT_SECRET || "YOUR_CLIENT_SECRET",
      process.env.YOUTUBE_REDIRECT_URI || "YOUR_REDIRECT_URI"
    );

    oauth2Client.setCredentials({
      access_token: account.accessToken,
      refresh_token: account.refreshToken,
    });

    // Auto-refresh access token when it expires
    oauth2Client.on("tokens", (tokens) => {
      if (tokens.refresh_token) {
        console.log(`New refresh token for ${account.name}`);
      }
      if (tokens.access_token) {
        account.accessToken = tokens.access_token;
        console.log(`Access token refreshed for ${account.name}`);
      }
    });

    const youtube = google.youtube({
      version: "v3",
      auth: oauth2Client,
    });

    const fileSize = fs.statSync(videoPath).size;
    const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
    const fileSizeGB = fileSize / (1024 * 1024 * 1024);

    // YouTube limits: 256GB for verified accounts, 128GB for unverified
    // Most users are unverified, so we'll use the conservative limit
    if (fileSizeGB > FILE_LIMITS.YOUTUBE_MAX_GB) {
      throw new Error(
        `Video file too large (${fileSizeGB.toFixed(2)}GB). YouTube limit is ${
          FILE_LIMITS.YOUTUBE_MAX_GB
        }GB for unverified accounts.`
      );
    }

    await logToDiscord(
      channel,
      `Uploading ${fileSizeMB}MB to YouTube (${account.name})...`,
      "info"
    );

    readStream = fs.createReadStream(videoPath);

    const res = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title: title,
          description: description,
          tags: tags,
          categoryId: "24", // Entertainment category
        },
        status: {
          privacyStatus: "public", // or "private" or "unlisted"
          selfDeclaredMadeForKids: false,
        },
      },
      media: {
        body: readStream,
      },
    });

    const videoId = res.data.id;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    await logToDiscord(
      channel,
      `✅ Successfully uploaded to YouTube (${account.name}): ${videoUrl}`,
      "success"
    );

    return videoUrl;
  } catch (error) {
    // Provide more detailed error messages
    let errorMsg = error.message;
    if (error.code === 401) {
      errorMsg =
        "Authentication failed. Access token may be invalid or expired.";
    } else if (error.code === 403) {
      errorMsg =
        "Permission denied. Check YouTube API quota or channel permissions.";
    } else if (error.code === 400) {
      errorMsg = "Bad request. Video file may be invalid or too large.";
    }

    await logToDiscord(
      channel,
      `❌ YouTube upload failed for ${account.name}: ${errorMsg}`,
      "error"
    );
    throw error;
  } finally {
    // Always close the read stream
    if (readStream) {
      readStream.destroy();
    }
  }
}

async function postToInstagram(
  account,
  videoUrl,
  storyUrl,
  author,
  originalHashtags,
  channel,
  originalCaption = "",
  isRepost = false,
  maxRetries = 3,
  preGeneratedCaption = null // NEW: Accept pre-generated AI caption
) {
  let attempt = 0;
  let lastError = null;

  while (attempt < maxRetries) {
    try {
      attempt++;
      if (attempt > 1) {
        await logToDiscord(
          channel,
          `🔄 Retry attempt ${attempt}/${maxRetries} for ${account.name}`,
          "warning"
        );
        // Exponential backoff: 30s, 60s, 120s
        const backoffDelay = Math.pow(2, attempt - 1) * 30000;
        await delay(backoffDelay);
      }

      console.log(`📝 Caption info for ${account.name} (Attempt ${attempt}):
            Author: ${author}
            Is Repost: ${isRepost}
            Original Caption Length: ${
              originalCaption ? originalCaption.length : 0
            }
            Hashtags Count: ${originalHashtags ? originalHashtags.length : 0}`);

      const USER_AGENTS = [
        "Instagram 219.0.0.12.117 Android (30/11; 420dpi; 1080x2158; samsung; SM-G998B; p3s; exynos2100; en_US)",
        "Instagram 187.0.0.32.120 Android (28/9; 480dpi; 1080x2076; samsung; SM-G973F; beyond1; exynos9820; en_GB)",
        "Instagram 165.1.0.29.119 Android (29/10; 480dpi; 1080x2340; OnePlus; GM1913; OnePlus7Pro; qcom; en_US)",
        "Instagram 195.0.0.31.123 Android (26/8.0.0; 480dpi; 1080x1920; Xiaomi; MI 6; sagit; qcom; en_US)",
      ];

      const API_VERSIONS = ["v22.0", "v21.0", "v20.0"];

      const userAgent =
        USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
      const apiVersion =
        API_VERSIONS[Math.floor(Math.random() * API_VERSIONS.length)];

      await logToDiscord(
        channel,
        `Preparing to upload to Instagram (${account.name})${
          isRepost ? " [REPOST MODE]" : ""
        }...`,
        "info"
      );
      if (isRepost && originalCaption) {
        await logToDiscord(
          channel,
          `🔄 Using original caption (${originalCaption.length} chars) for ${account.name}`,
          "info"
        );
      } else if (isRepost && !originalCaption) {
        await logToDiscord(
          channel,
          `⚠️ Repost mode but no original caption found, generating new caption for ${account.name}`,
          "warning"
        );
      }
      await delay(Math.floor(Math.random() * 5000) + 3000);

      // Download video with retry
      const localVideoPath = path.join(
        "videos",
        `instagram_upload_${Date.now()}_${attempt}.mp4`
      );
      let downloadSuccess = false;
      let downloadAttempts = 0;
      const maxDownloadAttempts = 3;

      while (!downloadSuccess && downloadAttempts < maxDownloadAttempts) {
        try {
          downloadAttempts++;
          const writer = fs.createWriteStream(localVideoPath);
          const videoResponse = await axios.get(videoUrl, {
            responseType: "stream",
            timeout: 60000, // 60 second timeout
          });
          videoResponse.data.pipe(writer);

          await new Promise((resolve, reject) => {
            writer.on("finish", resolve);
            writer.on("error", reject);
          });

          downloadSuccess = true;
          await logToDiscord(
            channel,
            `Video downloaded for direct upload to ${account.name}`,
            "info"
          );
        } catch (downloadError) {
          // Clean up partial file and destroy stream
          try {
            if (writer) writer.destroy();
          } catch (e) {}
          try {
            if (videoResponse?.data) videoResponse.data.destroy();
          } catch (e) {}
          if (fs.existsSync(localVideoPath)) {
            fs.unlinkSync(localVideoPath);
          }
          if (downloadAttempts === maxDownloadAttempts) {
            throw new Error(
              `Failed to download video after ${maxDownloadAttempts} attempts: ${downloadError.message}`
            );
          }
          await delay(5000); // Wait 5 seconds before retry
        }
      }

      await delay(Math.floor(Math.random() * 3000) + 2000);

      const stats = fs.statSync(localVideoPath);

      console.log("originalCaption:", originalCaption);

      let caption;
      if (isRepost && originalCaption) {
        caption = originalCaption;
      } else if (preGeneratedCaption) {
        // Use pre-generated AI caption (generated once for all accounts)
        caption = preGeneratedCaption;
        console.log(`Using pre-generated AI caption for ${account.name}`);
      } else {
        // Fallback to basic caption if AI generation failed
        console.log(`Using fallback caption for ${account.name}`);
        caption =
          BASE_CAPTION.replace("%author%", author).replace(
            "%originalCaption%",
            originalCaption || "No caption available"
          ) +
          "\n\n" +
          generateHashtags().join(" ");
      }

      // Instagram caption length limit
      if (caption.length > FILE_LIMITS.INSTAGRAM_CAPTION_MAX) {
        caption =
          caption.substring(0, FILE_LIMITS.INSTAGRAM_CAPTION_MAX - 3) + "...";
        console.log(
          `⚠️ Caption truncated to ${FILE_LIMITS.INSTAGRAM_CAPTION_MAX} chars for ${account.name}`
        );
      }

      console.log("caption:", caption);

      // Create media container with retry
      let containerRes;
      let containerAttempts = 0;
      const maxContainerAttempts = 3;

      while (containerAttempts < maxContainerAttempts) {
        try {
          containerAttempts++;
          const containerParams = new URLSearchParams({
            media_type: "REELS",
            video_url: videoUrl,
            caption: caption,
            access_token: account.token,
            share_to_feed: "true",
          });

          containerRes = await axios.post(
            `https://graph.instagram.com/${apiVersion}/${account.id}/media`,
            containerParams,
            {
              headers: {
                "User-Agent": userAgent,
                Accept: "application/json",
                "X-Instagram-AJAX": "1",
                "X-IG-App-ID": "936619743392459",
              },
              timeout: 30000, // 30 second timeout
            }
          );
          break; // Success, exit loop
        } catch (containerError) {
          if (containerAttempts === maxContainerAttempts) {
            throw containerError;
          }
          if (containerError.response?.status === 429) {
            await delay(60000); // Wait 1 minute for rate limit
          } else {
            await delay(10000); // Wait 10 seconds for other errors
          }
        }
      }

      const containerId = containerRes.data.id;

      await delay(Math.floor(Math.random() * 5000) + 3000);

      let isReady = false;
      let retries = 30; // Increased from 20 to 30 for more patience

      while (!isReady && retries > 0) {
        try {
          const checkDelay = Math.floor(Math.random() * 8000) + 5000; // Increased delay range
          await delay(checkDelay);

          const checkStatus = await axios.get(
            `https://graph.instagram.com/${apiVersion}/${containerId}?fields=status_code&access_token=${account.token}`,
            {
              headers: {
                "User-Agent": userAgent,
                Accept: "application/json",
              },
              timeout: 15000, // 15 second timeout
            }
          );

          const statusCode = checkStatus.data.status_code;

          if (statusCode === "FINISHED") {
            isReady = true;
          } else if (statusCode === "ERROR") {
            throw new Error(`Instagram processing failed with error status`);
          } else if (statusCode === "IN_PROGRESS") {
            retries--;
            if (retries % 5 === 0) {
              // Log every 5th attempt to reduce spam
              await logToDiscord(
                channel,
                `Still processing for ${account.name}, ${retries} attempts remaining...`,
                "info"
              );
            }
          } else {
            retries--;
            await logToDiscord(
              channel,
              `Processing status: ${statusCode} for ${account.name}, waiting...`,
              "info"
            );
          }
        } catch (error) {
          if (error.response?.status === 429) {
            await logToDiscord(
              channel,
              `Rate limited for ${account.name}, waiting 45 seconds...`,
              "warning"
            );
            await delay(45000); // Longer delay for rate limits
            retries--;
          } else if (error.response?.status >= 500) {
            await logToDiscord(
              channel,
              `Instagram server error for ${account.name}, waiting before retry...`,
              "warning"
            );
            await delay(15000);
            retries--;
          } else {
            throw error;
          }
        }
      }

      if (!isReady) {
        throw new Error(
          `Media processing timeout after ${
            30 - retries
          } attempts. Instagram may be experiencing high load.`
        );
      }

      await delay(Math.floor(Math.random() * 5000) + 5000);

      // Publish media with retry
      let publishResponse;
      let publishAttempts = 0;
      const maxPublishAttempts = 3;

      while (publishAttempts < maxPublishAttempts) {
        try {
          publishAttempts++;
          publishResponse = await axios.post(
            `https://graph.instagram.com/${apiVersion}/${account.id}/media_publish`,
            new URLSearchParams({
              creation_id: containerId,
              access_token: account.token,
              device_id: generateRandomDeviceId(),
            }),
            {
              headers: {
                "User-Agent": userAgent,
                Accept: "application/json",
                "X-Instagram-AJAX": "1",
                "X-IG-App-ID": "936619743392459",
              },
              timeout: 30000, // 30 second timeout
            }
          );
          break; // Success, exit loop
        } catch (publishError) {
          if (publishAttempts === maxPublishAttempts) {
            throw publishError;
          }
          if (publishError.response?.status === 429) {
            await delay(60000); // Wait 1 minute for rate limit
          } else {
            await delay(10000); // Wait 10 seconds for other errors
          }
        }
      }

      const mediaId = publishResponse.data.id;

      // Try to post comment and story, but don't fail the whole function if these fail
      try {
        await postFirstComment(account, mediaId, channel);
      } catch (commentError) {
        await logToDiscord(
          channel,
          `⚠️ Failed to post first comment for ${account.name}: ${commentError.message}`,
          "warning"
        );
      }

      await delay(Math.floor(Math.random() * 3000) + 2000);

      const mediaInfo = await axios.get(
        `https://graph.instagram.com/${apiVersion}/${mediaId}?fields=permalink,like_count,comments_count&access_token=${account.token}`,
        {
          headers: {
            "User-Agent": userAgent,
            Accept: "application/json",
          },
          timeout: 15000, // 15 second timeout
        }
      );

      const reelUrl = mediaInfo.data.permalink;

      // Clean up video file
      if (fs.existsSync(localVideoPath)) {
        fs.unlinkSync(localVideoPath);
      }

      await logToDiscord(
        channel,
        `✅ Successfully posted to Instagram: ${account.name}${
          isRepost ? " [REPOST]" : ""
        }\nReel URL: ${reelUrl}`,
        "success"
      );
      return reelUrl;
    } catch (error) {
      lastError = error;

      // Clean up video file on error
      const localVideoPath = path.join(
        "videos",
        `instagram_upload_${Date.now()}_${attempt}.mp4`
      );
      if (fs.existsSync(localVideoPath)) {
        fs.unlinkSync(localVideoPath);
      }

      await logToDiscord(
        channel,
        `❌ Attempt ${attempt}/${maxRetries} failed for ${account.name}: ${error.message}`,
        "error"
      );

      // Check if this is a non-retryable error
      if (isNonRetryableError(error)) {
        await logToDiscord(
          channel,
          `🚫 Non-retryable error detected for ${account.name}, stopping attempts`,
          "error"
        );
        break;
      }

      // If this was the last attempt, don't continue
      if (attempt === maxRetries) {
        break;
      }
    }
  }

  // If we get here, all retries failed
  throw new Error(
    `Instagram Upload Failed after ${maxRetries} attempts for ${
      account.name
    }: ${
      lastError?.response?.data?.error?.message ||
      lastError?.message ||
      "Unknown error"
    }`
  );
}

// Helper function to determine if an error should not be retried
function isNonRetryableError(error) {
  const errorMessage =
    error.response?.data?.error?.message || error.message || "";
  const statusCode = error.response?.status;
  const errorCode = error.code;

  // Don't retry on authentication/authorization errors
  if (statusCode === 401 || statusCode === 403) {
    return true;
  }

  // Don't retry on invalid media format errors
  if (
    errorMessage.toLowerCase().includes("invalid media") ||
    errorMessage.toLowerCase().includes("unsupported format") ||
    errorMessage.toLowerCase().includes("media type not supported")
  ) {
    return true;
  }

  // Don't retry on quota exceeded errors (different from rate limiting)
  if (
    errorMessage.toLowerCase().includes("quota exceeded") ||
    errorMessage.toLowerCase().includes("api limit exceeded")
  ) {
    return true;
  }

  // Don't retry on invalid token errors
  if (
    errorMessage.toLowerCase().includes("invalid access token") ||
    errorMessage.toLowerCase().includes("access token has expired")
  ) {
    return true;
  }

  // Don't retry on unrecoverable network errors
  if (
    errorCode === "ENOTFOUND" ||
    errorCode === "ECONNREFUSED" ||
    errorCode === "EHOSTUNREACH" ||
    errorCode === "ENETUNREACH"
  ) {
    return true;
  }

  return false;
}

function generateRandomDeviceId() {
  // Use crypto for better randomness and avoid collisions
  const crypto = require("crypto");
  return crypto.randomBytes(8).toString("hex"); // 16 hex characters
}

// Graceful shutdown handlers
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  try {
    await geminiService.cleanup();
    console.log("✅ Cleanup complete");
  } catch (error) {
    console.error("❌ Cleanup error:", error);
  }
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  try {
    await geminiService.cleanup();
    console.log("✅ Cleanup complete");
  } catch (error) {
    console.error("❌ Cleanup error:", error);
  }
  process.exit(0);
});

client.login(DISCORD_TOKEN);
