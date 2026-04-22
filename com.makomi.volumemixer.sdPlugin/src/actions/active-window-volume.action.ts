import streamDeck, {
  action,
  DialAction,
  DialDownEvent,
  DialRotateEvent,
  SendToPluginEvent,
  SingletonAction,
  TouchTapEvent,
  WillAppearEvent,
  WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";
import { audioService, AudioSession } from "../services/audio-service";

const VOLUME_LAYOUT = "layouts/volume.json";

function formatAppName(name: string): string {
  const cleaned = name.replace(/\.exe$/i, "").replace(/([a-z])(\d)/gi, "$1 $2").trim();
  return cleaned
    .split(/\s+/)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function normalizeAppKey(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const GAME_PROCESS_HINTS = [
  "helldivers",
  "cyberpunk",
  "eldenring",
  "armoredcore",
  "bg3",
  "baldursgate",
  "dota",
  "cs2",
  "counterstrike",
  "valorant",
  "fortnite",
  "rocketleague",
  "destiny2",
  "diablo",
  "pathofexile",
  "worldofwarcraft",
  "wow",
  "overwatch",
  "gta",
  "rdr",
  "starfield",
  "palworld",
  "minecraft",
  "roblox",
  "apex",
  "warzone",
  "cod",
  "battlefield",
  "escapefromtarkov",
  "tarkov",
  "thefinals",
  "leagueoflegends",
  "starcitizen",
  "stalker",
  "warthunder",
  "rainbowsix",
  "r6",
  "pubg",
];

const NON_GAME_PROCESS_HINTS = [
  "chrome",
  "msedge",
  "firefox",
  "opera",
  "brave",
  "discord",
  "telegram",
  "spotify",
  "steam",
  "steamwebhelper",
  "epicgameslauncher",
  "eadesktop",
  "origin",
  "battlenet",
  "riotclient",
  "ubisoftconnect",
  "windows",
  "terminal",
  "powershell",
  "explorer",
  "powertoys",
  "obs",
];

function isLauncherOrOverlaySurface(foreground: { name: string; title?: string }): boolean {
  const name = normalizeAppKey(foreground.name);
  const title = normalizeAppKey(foreground.title);
  return (
    name === "steam" ||
    name === "steamwebhelper" ||
    name === "gameoverlayui" ||
    name === "epicgameslauncher" ||
    name === "eosoverlayrenderer" ||
    name === "eadesktop" ||
    name === "origin" ||
    name === "battlenet" ||
    name === "agent" ||
    name === "riotclientservices" ||
    name === "riotclientux" ||
    name === "ubisoftconnect" ||
    name === "upc" ||
    name === "xboxgamebar" ||
    name === "gamebar" ||
    name === "gamingservices" ||
    name === "gameguard" ||
    name === "gamemon" ||
    name === "nprotect" ||
    title.includes("steam") ||
    title.includes("epicgames") ||
    title.includes("gamebar") ||
    title.includes("xbox")
  );
}

function isLikelyGameSession(session: AudioSession): boolean {
  const title = normalizeAppKey(session.windowTitle);
  const displayName = normalizeAppKey(session.displayName);
  const processName = normalizeAppKey(session.name);
  const combined = `${title} ${displayName} ${processName}`;

  if (NON_GAME_PROCESS_HINTS.some((hint) => combined.includes(hint))) return false;
  if (GAME_PROCESS_HINTS.some((hint) => combined.includes(hint))) return true;

  return title.length > 0 && processName.length > 0;
}

interface Settings {
  [key: string]: JsonValue;
  sensitivity?: number;
}

interface CachedAudioTarget {
  processName: string;
  displayName: string;
}

@action({ UUID: "com.makomi.volumemixer.activewindow" })
export class ActiveWindowVolumeAction extends SingletonAction<Settings> {
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly lastAudioTargets = new Map<string, CachedAudioTarget>();
  private readonly quickVolumes = new Map<string, { at: number; volume: number }>();

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    if (!ev.action.isDial()) return;
    const dialAction = ev.action;
    await dialAction.setFeedbackLayout(VOLUME_LAYOUT);
    await this.refreshDisplay(dialAction);
    const t = setInterval(() => this.refreshDisplay(dialAction), 400);
    this.timers.set(dialAction.id, t);
  }

  override async onWillDisappear(ev: WillDisappearEvent<Settings>): Promise<void> {
    const t = this.timers.get(ev.action.id);
    if (t) {
      clearInterval(t);
      this.timers.delete(ev.action.id);
    }
  }

  override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
    const { ticks, settings } = ev.payload;
    const target = await this.resolveTarget(ev.action.id);
    if (target.sessions.length === 0) return;

    const delta = ((settings.sensitivity as number | undefined) ?? 0.02) * ticks;
    const currentVolume = this.getDisplayVolume(ev.action.id, target.sessions);
    const nextVolume = Math.max(0, Math.min(1, currentVolume + delta));
    this.quickVolumes.set(ev.action.id, { at: Date.now(), volume: nextVolume });

    await Promise.all(
      target.sessions.map((session) => audioService.setVolume(session.pid, nextVolume))
    );
    if (ev.action.isDial()) await this.refreshDisplay(ev.action);
  }

  override async onDialDown(ev: DialDownEvent<Settings>): Promise<void> {
    const target = await this.resolveTarget(ev.action.id);
    if (target.sessions.length === 0) return;

    const shouldMute = target.sessions.some((session) => !session.muted);
    await Promise.all(target.sessions.map((session) => audioService.setMuted(session.pid, shouldMute)));
    if (ev.action.isDial()) await this.refreshDisplay(ev.action);
  }

  override async onTouchTap(ev: TouchTapEvent<Settings>): Promise<void> {
    const target = await this.resolveTarget(ev.action.id);
    if (target.sessions.length === 0) return;

    await Promise.all(
      target.sessions.map((session) => audioService.setVolume(session.pid, ev.payload.hold ? 0 : 1.0))
    );
    if (ev.action.isDial()) await this.refreshDisplay(ev.action);
  }

  override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, Settings>): Promise<void> {
    const payload = ev.payload as { event?: string };
    if (payload.event !== "requestForeground") return;

    const target = await this.resolveTarget(ev.action.id);
    if (!target.foreground && target.sessions.length === 0) {
      await streamDeck.ui.sendToPropertyInspector({ foreground: null });
      return;
    }

    const session = target.sessions[0];
    await streamDeck.ui.sendToPropertyInspector({
      foreground: {
        name: target.foreground?.name ?? "",
        displayName:
          session?.windowTitle ||
          session?.displayName ||
          target.displayName ||
          target.foreground?.title ||
          target.foreground?.name.replace(".exe", "") ||
          "",
        volume: session?.volume ?? null,
        muted: session?.muted ?? false,
        hasAudio: target.sessions.length > 0,
        icon: session ? (await audioService.getIcon(session.pid).catch(() => null)) ?? "" : "",
      },
    });
  }

  private async refreshDisplay(action: DialAction<Settings>): Promise<void> {
    try {
      const target = await this.resolveTarget(action.id);

      if (!target.foreground && target.sessions.length === 0) {
        await action.setFeedback({
          icon: { value: "imgs/actions/ActiveWindow/action.png" },
          appName: { value: "Active window" },
          levelText: { value: "—" },
          levelBar: { value: 0, opacity: 0.3 },
        });
        return;
      }

      if (target.sessions.length === 0) {
        await action.setFeedback({
          icon: { value: "imgs/actions/ActiveWindow/action.png" },
          appName: { value: formatAppName(target.foreground?.name ?? "No audio").substring(0, 16) },
          levelText: { value: "No audio" },
          levelBar: { value: 0, opacity: 0.3 },
        });
        return;
      }

      const session = target.sessions[0];
      const volume = this.getDisplayVolume(action.id, target.sessions);
      const muted = target.sessions.every((s) => s.muted);
      const pct = Math.round(volume * 100);
      const label = formatAppName(target.displayName || session.displayName || session.name).substring(0, 16);
      const icon = (await audioService.getIcon(session.pid)) ?? "imgs/actions/ActiveWindow/action.png";

      await action.setFeedback({
        icon: { value: icon },
        appName: { value: label },
        levelText: { value: muted ? "Muted" : `${pct}%` },
        levelBar: { value: muted ? 0 : pct, opacity: muted ? 0.3 : 1 },
      });
    } catch {
      // action may have disappeared
    }
  }

  private async resolveTarget(actionId: string): Promise<{
    foreground: { pid: number; name: string; title?: string } | null;
    displayName: string;
    sessions: AudioSession[];
  }> {
    const foreground = await audioService.getForeground();
    const sessions = await audioService.listSessions();

    if (foreground) {
      const foregroundSessions = this.findForegroundSessions(sessions, foreground);
      if (foregroundSessions.length > 0) {
        const session = foregroundSessions[0];
        this.lastAudioTargets.set(actionId, {
          processName: session.name,
          displayName: session.windowTitle || session.displayName || foreground.title || foreground.name,
        });

        return {
          foreground,
          displayName: session.windowTitle || session.displayName || foreground.title || foreground.name,
          sessions: foregroundSessions,
        };
      }

      const launcherGameSessions = this.findLauncherGameSessions(sessions, foreground);
      if (launcherGameSessions.length > 0) {
        const session = launcherGameSessions[0];
        this.lastAudioTargets.set(actionId, {
          processName: session.name,
          displayName: session.windowTitle || session.displayName || session.name,
        });

        return {
          foreground,
          displayName: session.windowTitle || session.displayName || session.name,
          sessions: launcherGameSessions,
        };
      }
    }

    const cached = this.lastAudioTargets.get(actionId);
    if (cached) {
      const cachedSessions = this.findSessionsByProcessName(sessions, cached.processName);
      if (cachedSessions.length > 0) {
        return {
          foreground,
          displayName: cached.displayName,
          sessions: cachedSessions,
        };
      }
    }

    return {
      foreground,
      displayName: foreground?.name ?? "",
      sessions: [],
    };
  }

  private findForegroundSessions(
    sessions: AudioSession[],
    foreground: { pid: number; name: string; title?: string }
  ): AudioSession[] {
    const direct = sessions.filter((s) => s.pid === foreground.pid);
    if (direct.length > 0) return direct;

    const name = foreground.name.toLowerCase();
    const byProcess = sessions.filter(
      (s) =>
        s.name.toLowerCase() === name ||
        s.name.toLowerCase().replace(".exe", "") === name.replace(".exe", "")
    );
    if (byProcess.length > 0) return byProcess;

    const foregroundTitle = normalizeAppKey(foreground.title);
    if (!foregroundTitle) return [];

    return sessions.filter((s) => {
      const title = normalizeAppKey(s.windowTitle);
      const displayName = normalizeAppKey(s.displayName);
      const processName = normalizeAppKey(s.name);
      return (
        title === foregroundTitle ||
        displayName === foregroundTitle ||
        processName === foregroundTitle ||
        (title.length > 0 && (title.includes(foregroundTitle) || foregroundTitle.includes(title))) ||
        (displayName.length > 0 &&
          (displayName.includes(foregroundTitle) || foregroundTitle.includes(displayName))) ||
        (processName.length > 0 &&
          (processName.includes(foregroundTitle) || foregroundTitle.includes(processName)))
      );
    });
  }

  private findSessionsByProcessName(sessions: AudioSession[], processName: string): AudioSession[] {
    const name = processName.toLowerCase();
    return sessions.filter(
      (s) =>
        s.name.toLowerCase() === name ||
        s.name.toLowerCase().replace(".exe", "") === name.replace(".exe", "")
    );
  }

  private findLauncherGameSessions(
    sessions: AudioSession[],
    foreground: { name: string; title?: string }
  ): AudioSession[] {
    if (!isLauncherOrOverlaySurface(foreground)) return [];
    return sessions.filter(isLikelyGameSession);
  }

  private getDisplayVolume(actionId: string, sessions: AudioSession[]): number {
    const quick = this.quickVolumes.get(actionId);
    if (quick && Date.now() - quick.at < 750) {
      return quick.volume;
    }

    return sessions.reduce((sum, s) => sum + s.volume, 0) / sessions.length;
  }
}
