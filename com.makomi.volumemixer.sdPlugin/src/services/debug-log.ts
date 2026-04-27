import fs from "fs";
import os from "os";
import path from "path";

const LOG_PATH = path.join(os.tmpdir(), "focused-app-volume-debug.log");
const MAX_LOG_SIZE = 512 * 1024;

function rotateIfNeeded(): void {
  try {
    const stat = fs.statSync(LOG_PATH);
    if (stat.size < MAX_LOG_SIZE) return;

    const archive = `${LOG_PATH}.1`;
    try {
      if (fs.existsSync(archive)) fs.unlinkSync(archive);
    } catch {
      // ignore archive cleanup issues
    }

    fs.renameSync(LOG_PATH, archive);
  } catch {
    // no existing log or rotation failure
  }
}

export function writeDebugLog(scope: string, message: string, details?: unknown): void {
  try {
    rotateIfNeeded();
    const timestamp = new Date().toISOString();
    const suffix = details === undefined ? "" : ` ${safeStringify(details)}`;
    fs.appendFileSync(LOG_PATH, `[${timestamp}] [${scope}] ${message}${suffix}\n`, "utf8");
  } catch {
    // never let logging break plugin behavior
  }
}

export function getDebugLogPath(): string {
  return LOG_PATH;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
