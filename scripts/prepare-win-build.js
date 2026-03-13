const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const unpackedDir = path.join(rootDir, "dist", "win-unpacked");
const executableName = "NexusPublish.exe";

function isAppRunning() {
  try {
    const output = execFileSync("tasklist", ["/FI", `IMAGENAME eq ${executableName}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    return output.includes(executableName);
  } catch {
    return false;
  }
}

function tryStopRunningApp() {
  if (!isAppRunning()) {
    return;
  }

  try {
    execFileSync("taskkill", ["/IM", executableName, "/F", "/T"], {
      stdio: "ignore",
      windowsHide: true,
    });
    console.log(`[prepare-win-build] Stopped ${executableName}.`);
  } catch (error) {
    console.warn(`[prepare-win-build] Failed to stop ${executableName}: ${error.message}`);
  }
}

function removeUnpackedDir() {
  if (!fs.existsSync(unpackedDir)) {
    console.log("[prepare-win-build] No previous win-unpacked directory to clean.");
    return;
  }

  try {
    fs.rmSync(unpackedDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 300,
    });
    console.log("[prepare-win-build] Removed previous dist/win-unpacked output.");
  } catch (error) {
    console.error("[prepare-win-build] Could not clean dist/win-unpacked.");
    console.error(
      "[prepare-win-build] Close NexusPublish.exe, release any Explorer preview/terminal handles, then retry.",
    );
    console.error(error.message);
    process.exit(1);
  }
}

tryStopRunningApp();
removeUnpackedDir();
