/**
 * Safe .env File Updater
 * Handles concurrent writes, backups, and validation
 */

const fs = require("fs");
const path = require("path");

class EnvUpdater {
  constructor() {
    this.lockFile = path.join(__dirname, "..", ".env.lock");
    this.envFile = path.join(__dirname, "..", ".env");
    this.maxLockWaitTime = 10000; // 10 seconds
    this.lockCheckInterval = 100; // 100ms
  }

  /**
   * Acquire lock with timeout
   */
  async acquireLock() {
    const startTime = Date.now();

    while (Date.now() - startTime < this.maxLockWaitTime) {
      try {
        // Try to create lock file (exclusive)
        fs.writeFileSync(this.lockFile, process.pid.toString(), { flag: "wx" });
        return true;
      } catch (error) {
        if (error.code === "EEXIST") {
          // Lock exists, check if process is still alive
          try {
            const lockPid = parseInt(fs.readFileSync(this.lockFile, "utf8"));
            try {
              // Check if process exists (throws if not)
              process.kill(lockPid, 0);
              // Process exists, wait
              await this.sleep(this.lockCheckInterval);
            } catch {
              // Process doesn't exist, remove stale lock
              fs.unlinkSync(this.lockFile);
            }
          } catch {
            // Can't read lock file, remove it
            try {
              fs.unlinkSync(this.lockFile);
            } catch {}
          }
        } else {
          throw error;
        }
      }
    }

    throw new Error("Could not acquire lock on .env file (timeout)");
  }

  /**
   * Release lock
   */
  releaseLock() {
    try {
      if (fs.existsSync(this.lockFile)) {
        fs.unlinkSync(this.lockFile);
      }
    } catch (error) {
      console.warn(`Warning: Could not release lock: ${error.message}`);
    }
  }

  /**
   * Create backup of .env file
   */
  createBackup() {
    try {
      if (fs.existsSync(this.envFile)) {
        const backupFile = `${this.envFile}.backup`;
        fs.copyFileSync(this.envFile, backupFile);
        return backupFile;
      }
    } catch (error) {
      console.warn(`Warning: Could not create backup: ${error.message}`);
    }
    return null;
  }

  /**
   * Restore from backup
   */
  restoreBackup(backupFile) {
    try {
      if (backupFile && fs.existsSync(backupFile)) {
        fs.copyFileSync(backupFile, this.envFile);
        fs.unlinkSync(backupFile);
        return true;
      }
    } catch (error) {
      console.error(`Error restoring backup: ${error.message}`);
    }
    return false;
  }

  /**
   * Validate JSON before writing
   */
  validateJSON(jsonString) {
    try {
      const parsed = JSON.parse(jsonString);
      if (!Array.isArray(parsed)) {
        throw new Error("Expected array");
      }
      return true;
    } catch (error) {
      throw new Error(`Invalid JSON: ${error.message}`);
    }
  }

  /**
   * Sanitize account data to prevent injection
   */
  sanitizeAccounts(accounts) {
    return accounts.map((acc) => {
      const sanitized = {};
      // Only allow specific fields
      if (acc.name) sanitized.name = String(acc.name).substring(0, 100);
      if (acc.id) sanitized.id = String(acc.id).substring(0, 100);
      if (acc.token) sanitized.token = String(acc.token).substring(0, 500);
      if (acc.accessToken)
        sanitized.accessToken = String(acc.accessToken).substring(0, 500);
      if (acc.refreshToken)
        sanitized.refreshToken = String(acc.refreshToken).substring(0, 500);
      return sanitized;
    });
  }

  /**
   * Update .env file safely
   */
  async updateEnvFile(key, accounts) {
    let backupFile = null;
    let lockAcquired = false;

    try {
      // Validate input
      if (!key || typeof key !== "string") {
        throw new Error("Invalid key parameter");
      }

      if (!Array.isArray(accounts)) {
        throw new Error("Accounts must be an array");
      }

      // Sanitize accounts
      const sanitizedAccounts = this.sanitizeAccounts(accounts);

      // Validate JSON
      const jsonString = JSON.stringify(sanitizedAccounts);
      this.validateJSON(jsonString);

      // Acquire lock
      await this.acquireLock();
      lockAcquired = true;

      // Create backup
      backupFile = this.createBackup();

      // Read current .env content
      let envContent = "";
      if (fs.existsSync(this.envFile)) {
        envContent = fs.readFileSync(this.envFile, "utf8");
      }

      // Replace or add the key
      const newLine = `${key}=${jsonString}`;
      const regex = new RegExp(`^${key}=.*$`, "m");

      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, newLine);
      } else {
        // Add if doesn't exist
        if (envContent && !envContent.endsWith("\n")) {
          envContent += "\n";
        }
        envContent += `${newLine}\n`;
      }

      // Write atomically (write to temp file, then rename)
      const tempFile = `${this.envFile}.tmp`;
      fs.writeFileSync(tempFile, envContent, "utf8");

      // Verify temp file is valid
      if (!fs.existsSync(tempFile)) {
        throw new Error("Failed to write temp file");
      }

      // Atomic rename
      fs.renameSync(tempFile, this.envFile);

      // Clean up backup on success
      if (backupFile && fs.existsSync(backupFile)) {
        fs.unlinkSync(backupFile);
      }

      return {
        success: true,
        message: "✅ .env file updated successfully",
      };
    } catch (error) {
      // Restore backup on error
      if (backupFile) {
        console.error(`Error updating .env: ${error.message}`);
        console.log("Attempting to restore from backup...");
        if (this.restoreBackup(backupFile)) {
          console.log("✅ Backup restored successfully");
        }
      }

      return {
        success: false,
        error: error.message,
      };
    } finally {
      // Always release lock
      if (lockAcquired) {
        this.releaseLock();
      }
    }
  }

  /**
   * Helper sleep function
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = new EnvUpdater();
