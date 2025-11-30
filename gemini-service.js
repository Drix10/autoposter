const {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
} = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
require("dotenv").config();

// Validate API key on startup
if (!process.env.GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY not found in .env file!");
  console.warn(
    "⚠️ AI caption generation will be disabled. Using fallback captions."
  );
}

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

// Constants
const MAX_VIDEO_PROCESSING_TIME_MS = 60000; // 60 seconds
const VIDEO_PROCESSING_CHECK_INTERVAL_MS = 2000; // 2 seconds
const MAX_VIDEO_SIZE_MB = 20; // Gemini free tier limit
const TRIM_VIDEO_DURATION = 10; // Trim to first 10 seconds for AI analysis
const RATE_LIMIT_RPM = 10; // Conservative limit
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const MAX_CAPTION_LENGTH = 500;
const API_TIMEOUT_MS = 30000; // 30 seconds

const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];

const INSTAGRAM_SYSTEM_PROMPT = `You are a creative social media caption writer for Instagram Reels focused on K-pop and K-drama content.

Your task is to create engaging, unique captions that promote IdolChat - the #1 free AI chat & gaming app.

ABOUT IDOLCHAT.APP:
IdolChat is where collecting meets connection - a revolutionary app that combines AI character chat with card collecting:

Core Features:
• Chat with AI characters that remember your stories, jokes, and dreams
• Collect character cards (3M+ cards collected by 3K+ users)
• Free card drops every 30 minutes - choose from 2 random characters
• Create unlimited AI characters instantly (anime, K-pop idols, K-drama stars, gaming champions, custom)
• Characters have contextual memory, emotion-aware responses, and evolving personalities
• Social features: follow users, DM collectors, share characters (Instagram-like)
• Burn duplicate cards for coins with streak bonuses
• Earn achievements and unlock rewards

Pricing:
• FREE forever: 5 messages/day, unlimited card drops, infinite character creation
• Basic $10/mo: 100 messages/day, enhanced AI
• Premium $20/mo: 200 messages/day, premium AI, special events

What Makes It Special:
• Conversations that matter - characters grow with you and develop real bonds
• Complete collection experience with stats tracking
• Community-driven with 3K+ active users
• Better than c.ai/chai - combines chat with gaming/collecting

YOUR CAPTION STYLE:
1. Short & punchy (150-300 characters max)
2. Gen-Z language, trendy, authentic (not robotic)
3. Strategic emojis (2-4 max)
4. Natural promotion of IdolChat features
5. Call-to-action (download, join waitlist, create character)
6. Credit format: "🎬 via @{author}"
7. Vary your approach - never repeat structures

CAPTION ANGLES TO USE:
• "Conversations that matter" - AI that remembers you
• "Free card drops every 30 minutes" - collecting aspect
• "Create any character" - K-pop idols, anime heroes, K-drama stars
• "3M+ cards collected" - social proof
• "Start free forever" - no commitment
• "Better than c.ai" - direct comparison
• "Chat, collect, connect" - three pillars

IMPORTANT RULES:
- Keep under 300 characters
- Be creative and vary each caption
- Use trending phrases and slang
- Make it feel authentic
- Always mention idolchat.app naturally
- Focus on different features each time`;

const YOUTUBE_SYSTEM_PROMPT = `You are a professional YouTube content writer specializing in K-pop and K-drama shorts.

Your task is to create SEO-optimized titles and descriptions that promote IdolChat - the #1 free AI chat & gaming app.

ABOUT IDOLCHAT.APP:
IdolChat is where collecting meets connection - a revolutionary app that combines AI character chat with card collecting:

Core Features:
• Chat with AI characters that remember your stories and develop real bonds
• Collect character cards (3M+ cards collected, 3K+ active users)
• Free card drops every 30 minutes
• Create unlimited AI characters: K-pop idols (BLACKPINK, BTS), K-drama stars, anime heroes (Naruto, JJK), gaming champions (Genshin, LoL), or custom
• Characters have contextual memory, emotion-aware responses, evolving personalities
• Social features: follow users, DM collectors, share characters
• Burn duplicates for coins, earn achievements
• Free forever: 5 messages/day, unlimited drops, infinite character creation
• Premium: $10-20/mo for 100-200 messages/day

What Makes It Special:
• Conversations that matter - AI that grows with you
• Complete collection experience with stats and milestones
• Community of 3K+ users
• Better than c.ai/chai - combines chat with gaming/collecting
• iOS & Android, free forever plan

TITLE STRATEGY (max 100 chars):
- Attention-grabbing opener
- Include keywords: kpop, kdrama, viral, trending, AI, chat
- Mention IdolChat when it fits naturally
- Use emojis strategically
- Examples:
  * "This K-drama Scene 😭 | Chat with AI Characters on IdolChat"
  * "K-pop Fans Need This AI App 🔥 | IdolChat"
  * "When Your AI Character Remembers Everything 💫"

DESCRIPTION STRATEGY (200-400 chars):
- First line is crucial (appears in search)
- Hook: relate to video content
- Introduce IdolChat naturally
- Highlight 1-2 key features (free drops, character creation, collecting)
- Call-to-action: "Download IdolChat" or "Join 3K+ users"
- Social proof: "3M+ cards collected"
- Credit: "Credit: @{author}"
- Hashtags: #kpop #kdrama #ai #idolchat #viral

DESCRIPTION ANGLES TO ROTATE:
• "Chat with AI K-pop idols on IdolChat - free card drops every 30 minutes"
• "Create your own AI characters on IdolChat - K-drama stars, anime heroes, anyone"
• "3K+ users collecting AI character cards on IdolChat - join free"
• "Better than c.ai - IdolChat combines chat with card collecting"
• "Free forever AI chat app - 5 messages/day, unlimited character creation"

IMPORTANT RULES:
- Title: under 100 characters, SEO-optimized
- Description: 200-400 characters, engaging
- Professional but relatable tone
- Vary your approach each time
- Always mention idolchat.app
- Include credit to original creator
- Focus on different features each time`;

class GeminiCaptionService {
  constructor() {
    this.lastRequestTime = 0;
    this.requestsThisMinute = 0;
    this.resetInterval = null;
    this.isEnabled = !!genAI;
    this.uploadedFiles = new Set(); // Track uploaded files for cleanup

    if (!this.isEnabled) {
      console.warn("⚠️ Gemini AI is disabled - API key not configured");
      return;
    }

    // Get model name from env or use default
    const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash-exp";

    // Initialize models with system prompts
    this.instagramModel = genAI.getGenerativeModel({
      model: modelName,
      safetySettings,
      systemInstruction: INSTAGRAM_SYSTEM_PROMPT,
    });

    this.youtubeModel = genAI.getGenerativeModel({
      model: modelName,
      safetySettings,
      systemInstruction: YOUTUBE_SYSTEM_PROMPT,
    });

    // Reset counter every minute
    this.resetInterval = setInterval(() => {
      this.requestsThisMinute = 0;
    }, RATE_LIMIT_WINDOW_MS);
  }

  async cleanup() {
    if (this.resetInterval) {
      clearInterval(this.resetInterval);
      this.resetInterval = null;
    }

    // Clean up any remaining uploaded files
    if (this.uploadedFiles.size > 0 && genAI) {
      console.log(
        `🧹 Cleaning up ${this.uploadedFiles.size} uploaded files...`
      );
      const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);
      // Convert to array to avoid modifying Set during iteration
      const filesToDelete = Array.from(this.uploadedFiles);
      for (const fileName of filesToDelete) {
        try {
          await fileManager.deleteFile(fileName);
          this.uploadedFiles.delete(fileName);
        } catch (error) {
          console.error(`Failed to delete file ${fileName}:`, error.message);
        }
      }
    }
  }

  /**
   * Upload video once for reuse across multiple generations
   */
  async uploadVideoForAnalysis(videoPath) {
    if (!this.isEnabled) {
      throw new Error("Gemini AI is disabled - API key not configured");
    }

    let videoFile = null;
    let trimmedPath = null;
    let shouldCleanupTrimmed = false;

    try {
      // Validate input file exists
      if (!fs.existsSync(videoPath)) {
        throw new Error(`Video file not found: ${videoPath}`);
      }

      // Check file size first
      const stats = fs.statSync(videoPath);
      const fileSizeMB = stats.size / (1024 * 1024);

      // If video is too large, trim to first 10 seconds
      if (fileSizeMB > MAX_VIDEO_SIZE_MB) {
        console.log(
          `📹 Video too large (${fileSizeMB.toFixed(
            2
          )}MB), trimming to first ${TRIM_VIDEO_DURATION} seconds...`
        );
        trimmedPath = await this.trimVideoForAnalysis(videoPath);
        shouldCleanupTrimmed = true;

        // Validate trimmed file was created and is smaller
        if (!fs.existsSync(trimmedPath)) {
          throw new Error("Trimmed video file was not created");
        }

        const trimmedStats = fs.statSync(trimmedPath);
        const trimmedSizeMB = trimmedStats.size / (1024 * 1024);

        if (trimmedSizeMB > MAX_VIDEO_SIZE_MB) {
          throw new Error(
            `Trimmed video still too large (${trimmedSizeMB.toFixed(2)}MB)`
          );
        }

        console.log(`✅ Trimmed video size: ${trimmedSizeMB.toFixed(2)}MB`);
        videoFile = await this.uploadFileToGemini(trimmedPath);
      } else {
        videoFile = await this.uploadFileToGemini(videoPath);
      }

      this.uploadedFiles.add(videoFile.name);

      // Wait for processing
      const processedFile = await this.waitForVideoProcessing(videoFile.name);

      // Only clean up trimmed file AFTER successful processing
      if (shouldCleanupTrimmed && trimmedPath && fs.existsSync(trimmedPath)) {
        try {
          fs.unlinkSync(trimmedPath);
          console.log(`🧹 Cleaned up trimmed video`);
        } catch (e) {
          console.warn(`Warning: Could not delete trimmed video: ${e.message}`);
        }
      }

      return processedFile;
    } catch (error) {
      // Remove from tracking if upload/processing failed
      if (videoFile && videoFile.name) {
        this.uploadedFiles.delete(videoFile.name);
      }

      // Clean up trimmed file on error
      if (shouldCleanupTrimmed && trimmedPath && fs.existsSync(trimmedPath)) {
        try {
          fs.unlinkSync(trimmedPath);
          console.log(`🧹 Cleaned up trimmed video (error cleanup)`);
        } catch (e) {
          console.warn(`Warning: Could not delete trimmed video: ${e.message}`);
        }
      }

      throw error;
    }
  }

  /**
   * Clean up a specific video file
   */
  async cleanupVideoFile(fileName) {
    if (!fileName) return;

    try {
      const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);
      await fileManager.deleteFile(fileName);
      console.log(`🧹 Cleaned up video file: ${fileName}`);
    } catch (error) {
      console.error(`Failed to cleanup video file ${fileName}:`, error.message);
    } finally {
      // Always remove from tracking set, even if deletion failed
      this.uploadedFiles.delete(fileName);
    }
  }

  /**
   * Generate Instagram caption using pre-uploaded video file
   */
  async generateInstagramCaptionWithFile(
    originalCaption,
    author,
    hashtags = [],
    videoFile = null,
    retries = 3
  ) {
    if (!this.isEnabled) {
      return this.getFallbackInstagramCaption(originalCaption, author);
    }

    try {
      await this.checkRateLimit();

      const prompt = `Generate a unique, engaging Instagram Reels caption.

Context:
- Original creator: @${author}
- Original caption: "${originalCaption || "No caption provided"}"
- Hashtags from original: ${hashtags.join(", ") || "None"}
- Video content: Watch the video to understand the scene, emotions, and context

Requirements:
- Analyze BOTH the video content AND the original caption for context
- If the original caption provides useful context (story, emotion, meaning), incorporate that insight
- Watch the video to see what's actually happening (dance, scene, reaction, etc.)
- Create a NEW caption that's engaging and relates to the content
- Promote idolchat.app naturally (mention it's better than c.ai/chai)
- Keep it SHORT (150-300 characters max)
- Use emojis strategically (2-4 max)
- Be creative and trendy - don't just copy the original
- Credit the creator: "🎬 via @${author}"
- Add relevant hashtags at the end (max 5)

Example approach:
- If original says "This scene made me cry 😭" and video shows emotional K-drama scene
  → "When K-dramas hit different 😭 Chat with your fave characters on idolchat.app - way better than c.ai! 🎬 via @${author} #kdrama #emotional"

Generate ONLY the caption text, nothing else. No explanations, no quotes around it.`;

      let result;

      // If video file provided, use it
      if (videoFile) {
        try {
          console.log(`🎬 Generating caption with video analysis...`);

          result = await this.withTimeout(
            this.instagramModel.generateContent([
              {
                fileData: {
                  mimeType: videoFile.mimeType,
                  fileUri: videoFile.uri,
                },
              },
              { text: prompt },
            ]),
            API_TIMEOUT_MS
          );
        } catch (videoError) {
          console.warn(
            `⚠️ Video analysis failed, using text-only: ${videoError.message}`
          );
          result = await this.withTimeout(
            this.instagramModel.generateContent(prompt),
            API_TIMEOUT_MS
          );
        }
      } else {
        // Text-only generation
        result = await this.withTimeout(
          this.instagramModel.generateContent(prompt),
          API_TIMEOUT_MS
        );
      }

      let caption = result.response.text().trim();

      // Remove any markdown formatting or quotes
      caption = caption
        .replace(/```/g, "")
        .replace(/^["']|["']$/g, "")
        .trim();

      // Ensure it's not too long
      if (caption.length > MAX_CAPTION_LENGTH) {
        caption = caption.substring(0, MAX_CAPTION_LENGTH - 3) + "...";
      }

      console.log(`✨ Generated Instagram caption (${caption.length} chars)`);
      return caption;
    } catch (error) {
      console.error("Error generating Instagram caption:", error);

      if (retries > 0) {
        console.log(`Retrying... (${retries} attempts left)`);
        await this.sleep(2000);
        return this.generateInstagramCaptionWithFile(
          originalCaption,
          author,
          hashtags,
          videoFile, // Pass videoFile on retry, not videoPath
          retries - 1
        );
      }

      // Fallback to basic caption
      return this.getFallbackInstagramCaption(originalCaption, author);
    }
    // Note: No cleanup here - videoFile is managed by caller
  }

  // REMOVED: This function is deprecated - use generateYouTubeMetadataWithFile() instead

  getFallbackInstagramCaption(originalCaption, author) {
    const templates = [
      `✨ This hit different! Check out idolchat.app - way better than c.ai for chatting with your fave characters 💫\n\n🎬 via @${author}\n\n#kpop #kdrama #idolchat #viral`,
      `🔥 Can't stop watching this! Try idolchat.app to chat, collect & trade AI characters - it's like c.ai but actually fun 🎮\n\n🎬 via @${author}\n\n#trending #kpop #kdrama`,
      `💫 This is everything! idolchat.app lets you collect AI characters like trading cards - so much better than chai 🃏\n\n🎬 via @${author}\n\n#viral #kpop #idolchat`,
    ];

    return templates[Math.floor(Math.random() * templates.length)];
  }

  getFallbackYouTubeDescription(originalCaption, author) {
    return `Check out idolchat.app - the ultimate AI character chat platform! Better than c.ai and chai, you can chat, collect, style, and trade characters in a multiplayer experience.\n\nCredit: @${author}\n\n#kpop #kdrama #idolchat #viral #trending`;
  }

  /**
   * Trim video to first N seconds for AI analysis
   */
  async trimVideoForAnalysis(videoPath) {
    return new Promise((resolve, reject) => {
      const timestamp = Date.now();
      const trimmedPath = path.join(
        path.dirname(videoPath),
        `trimmed_ai_${timestamp}.mp4`
      );

      let command = null;
      let timeoutId = null;
      let resolved = false;

      console.log(
        `✂️ Trimming video to ${TRIM_VIDEO_DURATION} seconds for AI analysis...`
      );

      // Timeout protection (2 minutes max)
      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.error(`❌ Video trimming timeout after 2 minutes`);

          // Kill FFmpeg process
          if (command) {
            try {
              command.kill("SIGKILL");
            } catch (e) {
              console.error(`Failed to kill FFmpeg: ${e.message}`);
            }
          }

          // Clean up partial file
          if (fs.existsSync(trimmedPath)) {
            try {
              fs.unlinkSync(trimmedPath);
            } catch (e) {}
          }

          reject(new Error("Video trimming timeout"));
        }
      }, 120000); // 2 minutes

      try {
        command = ffmpeg(videoPath)
          .setStartTime(0)
          .setDuration(TRIM_VIDEO_DURATION)
          .outputOptions([
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "28", // Higher CRF for smaller file
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
          ])
          .output(trimmedPath)
          .on("end", () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeoutId);

              // Validate output file
              if (!fs.existsSync(trimmedPath)) {
                reject(new Error("Trimmed file was not created"));
                return;
              }

              const stats = fs.statSync(trimmedPath);
              if (stats.size < 1024) {
                // Less than 1KB
                try {
                  fs.unlinkSync(trimmedPath);
                } catch (e) {}
                reject(new Error("Trimmed file is too small (corrupted)"));
                return;
              }

              const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
              console.log(`✅ Trimmed video created: ${sizeMB}MB`);
              resolve(trimmedPath);
            }
          })
          .on("error", (err) => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeoutId);
              console.error(`❌ Video trimming failed: ${err.message}`);

              // Clean up partial file
              if (fs.existsSync(trimmedPath)) {
                try {
                  fs.unlinkSync(trimmedPath);
                } catch (e) {}
              }

              reject(new Error(`Failed to trim video: ${err.message}`));
            }
          });

        command.run();
      } catch (error) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          reject(error);
        }
      }
    });
  }

  async checkRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    // Reset counter if more than a minute has passed
    if (timeSinceLastRequest >= RATE_LIMIT_WINDOW_MS) {
      this.requestsThisMinute = 0;
      this.lastRequestTime = now;
    }

    // Check rate limit
    if (this.requestsThisMinute >= RATE_LIMIT_RPM) {
      const waitTime = RATE_LIMIT_WINDOW_MS - timeSinceLastRequest;
      if (waitTime > 0) {
        console.log(
          `⏳ Gemini rate limit: Waiting ${Math.ceil(waitTime / 1000)}s...`
        );
        await this.sleep(waitTime);
        this.requestsThisMinute = 0;
        this.lastRequestTime = Date.now();
      }
    }

    this.requestsThisMinute++;
  }

  async uploadFileToGemini(filePath) {
    // Validate file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Check file size
    const stats = fs.statSync(filePath);
    const fileSizeMB = stats.size / (1024 * 1024);

    if (fileSizeMB > MAX_VIDEO_SIZE_MB) {
      throw new Error(
        `Video too large (${fileSizeMB.toFixed(
          2
        )}MB). Max: ${MAX_VIDEO_SIZE_MB}MB`
      );
    }

    console.log(`📤 Uploading ${fileSizeMB.toFixed(2)}MB video to Gemini...`);

    const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

    const uploadResult = await fileManager.uploadFile(filePath, {
      mimeType: "video/mp4",
      displayName: `video_${Date.now()}`,
    });

    console.log(`✅ Video uploaded: ${uploadResult.file.name}`);
    return uploadResult.file;
  }

  async waitForVideoProcessing(fileName) {
    const startTime = Date.now();
    let iterations = 0;
    const maxIterations = Math.ceil(
      MAX_VIDEO_PROCESSING_TIME_MS / VIDEO_PROCESSING_CHECK_INTERVAL_MS
    );

    const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

    while (iterations < maxIterations) {
      const file = await fileManager.getFile(fileName);

      if (file.state === "ACTIVE") {
        const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✅ Video processed in ${processingTime}s`);
        return file;
      }

      if (file.state === "FAILED") {
        throw new Error("Video processing failed");
      }

      if (file.state === "PROCESSING") {
        iterations++;
        await this.sleep(VIDEO_PROCESSING_CHECK_INTERVAL_MS);
        continue;
      }

      // Unknown state
      throw new Error(`Unknown file state: ${file.state}`);
    }

    throw new Error(
      `Video processing timeout after ${MAX_VIDEO_PROCESSING_TIME_MS / 1000}s`
    );
  }

  async withTimeout(promise, timeoutMs) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Operation timeout after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ]);
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Generate YouTube metadata using pre-uploaded video file
   */
  async generateYouTubeMetadataWithFile(
    originalCaption,
    author,
    hashtags = [],
    videoFile = null,
    retries = 3
  ) {
    if (!this.isEnabled) {
      return {
        title: `${author} | K-drama/K-pop Content | idolchat.app`,
        description: this.getFallbackYouTubeDescription(
          originalCaption,
          author
        ),
      };
    }

    try {
      await this.checkRateLimit();

      const prompt = `Generate YouTube Shorts metadata (title and description).

Context:
- Original creator: @${author}
- Original caption: "${originalCaption || "No caption provided"}"
- Hashtags: ${hashtags.join(", ") || "None"}
- Video content: Watch the video to understand the scene, emotions, and context

Generate in this EXACT format:
TITLE: [your title here - max 100 chars]
DESCRIPTION: [your description here - max 400 chars]

Requirements for TITLE:
- Analyze BOTH the video content AND the original caption for full context
- If original caption reveals the emotion/story (e.g., "This scene broke me"), use that insight
- Watch the video to see what's actually happening
- Create attention-grabbing, SEO-friendly title
- Include keywords: kpop, kdrama, viral, trending, AI, chat
- Under 100 characters
- Include idolchat.app if it fits naturally

Requirements for DESCRIPTION:
- First line is crucial (appears in search results)
- Combine insights from BOTH video and original caption
- If original caption provides context (e.g., "Episode 12 finale"), mention it
- Describe what happens in the video
- Promote idolchat.app naturally (better than c.ai/chai)
- Highlight 1-2 IdolChat features (free drops, character creation, collecting)
- Credit: "Credit: @${author}"
- Include relevant hashtags
- Under 400 characters
- Professional but engaging

Example:
- Original: "This dance cover took 50 takes 😭"
- Video: K-pop dance performance
- Title: "When K-pop Choreography Hits Different 🔥 | IdolChat"
- Description: "This dance took 50 takes but the result is 🔥 Chat with K-pop AI idols on IdolChat - free card drops every 30 minutes! Better than c.ai. Credit: @${author} #kpop #dance #idolchat"

Generate ONLY in the format shown above. No extra text.`;

      let result;

      // If video file provided, use it
      if (videoFile) {
        try {
          console.log(`🎬 Generating YouTube metadata with video analysis...`);

          result = await this.withTimeout(
            this.youtubeModel.generateContent([
              {
                fileData: {
                  mimeType: videoFile.mimeType,
                  fileUri: videoFile.uri,
                },
              },
              { text: prompt },
            ]),
            API_TIMEOUT_MS
          );
        } catch (videoError) {
          console.warn(
            `⚠️ Video analysis failed, using text-only: ${videoError.message}`
          );
          result = await this.withTimeout(
            this.youtubeModel.generateContent(prompt),
            API_TIMEOUT_MS
          );
        }
      } else {
        // Text-only generation
        result = await this.withTimeout(
          this.youtubeModel.generateContent(prompt),
          API_TIMEOUT_MS
        );
      }

      let response = result.response.text().trim();

      // Parse the response
      const titleMatch = response.match(/TITLE:\s*(.+?)(?=\n|$)/i);
      const descMatch = response.match(/DESCRIPTION:\s*([\s\S]+?)(?=$)/i);

      let title =
        titleMatch?.[1]?.trim() ||
        `${author} | K-drama/K-pop Content | idolchat.app`;
      let description =
        descMatch?.[1]?.trim() ||
        this.getFallbackYouTubeDescription(originalCaption, author);

      // Ensure limits
      if (title.length > 100) {
        title = title.substring(0, 97) + "...";
      }
      if (description.length > 500) {
        description = description.substring(0, 497) + "...";
      }

      console.log(`✨ Generated YouTube metadata`);
      console.log(`   Title: ${title} (${title.length} chars)`);
      console.log(`   Description: ${description.length} chars`);

      return { title, description };
    } catch (error) {
      console.error("Error generating YouTube metadata:", error);

      if (retries > 0) {
        console.log(`Retrying... (${retries} attempts left)`);
        await this.sleep(2000);
        return this.generateYouTubeMetadataWithFile(
          originalCaption,
          author,
          hashtags,
          videoFile,
          retries - 1
        );
      }

      return {
        title: `${author} | K-drama/K-pop Content | idolchat.app`,
        description: this.getFallbackYouTubeDescription(
          originalCaption,
          author
        ),
      };
    }
  }
}

module.exports = new GeminiCaptionService();
