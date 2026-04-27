import { spawn, ChildProcess } from "child_process";
import path from "path";
import { EventEmitter } from "events";
import type { JsonValue } from "@elgato/utils";
import { writeDebugLog } from "./debug-log";

export interface AudioSession {
  [key: string]: JsonValue;
  pid: number;
  name: string;
  displayName: string;
  windowTitle?: string;
  volume: number;
  muted: boolean;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

interface AudioResponse {
  id: number;
  error?: string;
}

class AudioService extends EventEmitter {
  private proc: ChildProcess | null = null;
  private buffer = "";
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private restarting = false;
  private iconCache = new Map<number, string | null>();
  private sessionsCache: { at: number; value: AudioSession[] } | null = null;
  private foregroundCache: { at: number; value: { pid: number; name: string; title?: string } | null } | null = null;
  private lastLoggedForeground = "";
  private lastLoggedSessionsSignature = "";

  constructor() {
    super();
    this.start();
  }

  private helperPath(): string {
    return path.join(__dirname, "../native/bin/VolumeControllerHelper2.exe");
  }

  private start(): void {
    writeDebugLog("audio-service", "starting helper", { helperPath: this.helperPath() });
    this.proc = spawn(this.helperPath(), [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.proc.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      this.buffer += chunk;
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed) as AudioResponse & Record<string, unknown>;
          const req = this.pending.get(msg.id);
          if (req) {
            this.pending.delete(msg.id);
            clearTimeout(req.timer);
            if (msg.error) {
              req.reject(new Error(msg.error));
            } else {
              req.resolve(msg);
            }
          }
        } catch {
          // ignore malformed output
        }
      }
    });

    this.proc.stderr?.setEncoding("utf8").on("data", (d: string) => {
      writeDebugLog("audio-service", "helper stderr", { message: d.trim() });
      console.error("[VolumeController]", d.trim());
    });

    this.proc.on("error", (err) => {
      writeDebugLog("audio-service", "helper failed to start", { error: String(err) });
      console.error("[VolumeController] failed to start", err);
      this.rejectPending(err);
    });

    this.proc.on("exit", (code) => {
      writeDebugLog("audio-service", "helper exited", { code });
      this.rejectPending(new Error(`VolumeController exited (${code})`));
      if (!this.restarting) {
        console.error(`[VolumeController] exited (${code}), restarting in 1s…`);
        this.restarting = true;
        setTimeout(() => {
          this.restarting = false;
          this.start();
        }, 1000);
      }
    });
  }

  private send<T>(cmd: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`audio-service timeout for cmd=${cmd["cmd"]}`));
      }, 5000);

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

      const payload = JSON.stringify({ ...cmd, id }) + "\n";
      if (!this.proc?.stdin?.writable) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error("VolumeController is not running"));
        return;
      }

      this.proc.stdin.write(payload, (err) => {
        if (!err) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  private rejectPending(reason: Error): void {
    for (const [id, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(reason);
      this.pending.delete(id);
    }
  }

  async listSessions(): Promise<AudioSession[]> {
    const now = Date.now();
    if (this.sessionsCache && now - this.sessionsCache.at < 250) {
      return this.sessionsCache.value;
    }

    const res = await this.send<{ sessions: AudioSession[] }>({ cmd: "list" });
    const sessions = res.sessions ?? [];
    this.sessionsCache = { at: now, value: sessions };
    this.logSessionsSnapshot(sessions);
    return sessions;
  }

  async getVolume(pid: number): Promise<{ volume: number; muted: boolean }> {
    return this.send<{ volume: number; muted: boolean }>({ cmd: "get", pid });
  }

  async setVolume(pid: number, volume: number): Promise<void> {
    const normalized = Math.max(0, Math.min(1, volume));
    this.patchCachedSession(pid, { volume: normalized });
    await this.send({ cmd: "set", pid, volume: normalized });
  }

  async setMuted(pid: number, muted: boolean): Promise<void> {
    this.patchCachedSession(pid, { muted });
    await this.send({ cmd: "mute", pid, muted });
  }

  async toggleMute(pid: number): Promise<boolean> {
    const current = await this.getVolume(pid);
    const newMuted = !current.muted;
    await this.setMuted(pid, newMuted);
    return newMuted;
  }

  async getForeground(): Promise<{ pid: number; name: string; title?: string } | null> {
    const now = Date.now();
    if (this.foregroundCache && now - this.foregroundCache.at < 150) {
      return this.foregroundCache.value;
    }

    const res = await this.send<{ pid: number; name: string; title?: string }>({ cmd: "foreground" });
    const foreground = res.pid > 0 ? res : null;
    this.foregroundCache = { at: now, value: foreground };
    this.logForegroundSnapshot(foreground);
    return foreground;
  }

  async getIcon(pid: number): Promise<string | null> {
    if (this.iconCache.has(pid)) {
      return this.iconCache.get(pid) ?? null;
    }

    const res = await this.send<{ icon: string | null }>({ cmd: "icon", pid });
    this.iconCache.set(pid, res.icon ?? null);
    return res.icon ?? null;
  }

  dispose(): void {
    this.restarting = true;
    this.proc?.kill();
  }

  private patchCachedSession(pid: number, patch: Partial<Pick<AudioSession, "volume" | "muted">>): void {
    if (!this.sessionsCache) return;

    this.sessionsCache = {
      at: Date.now(),
      value: this.sessionsCache.value.map((session) =>
        session.pid === pid ? { ...session, ...patch } : session
      ),
    };
  }

  private logForegroundSnapshot(foreground: { pid: number; name: string; title?: string } | null): void {
    const signature = foreground
      ? `${foreground.pid}:${foreground.name}:${foreground.title ?? ""}`
      : "none";
    if (signature === this.lastLoggedForeground) return;

    this.lastLoggedForeground = signature;
    writeDebugLog("audio-service", "foreground changed", foreground);
  }

  private logSessionsSnapshot(sessions: AudioSession[]): void {
    const top = sessions
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name) || a.pid - b.pid)
      .slice(0, 8)
      .map((session) => ({
        pid: session.pid,
        name: session.name,
        displayName: session.displayName,
        windowTitle: session.windowTitle ?? "",
        volume: Math.round(session.volume * 100),
        muted: session.muted,
      }));
    const signature = JSON.stringify(top);
    if (signature === this.lastLoggedSessionsSignature) return;

    this.lastLoggedSessionsSignature = signature;
    writeDebugLog("audio-service", "sessions changed", { count: sessions.length, top });
  }
}

export const audioService = new AudioService();
