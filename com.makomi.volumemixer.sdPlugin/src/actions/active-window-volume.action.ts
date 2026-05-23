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
import { getDebugLogPath, writeDebugLog } from "../services/debug-log";

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

function stripExecutableSuffix(value: string): string {
  return value.replace(/\.exe$/i, "");
}

function stripWrapperSuffixes(value: string): string {
  return value.replace(/(portable|launcher|client|helper|overlay|updater|service|bootstrapper)+$/g, "");
}

function buildAppAliases(value: string | undefined): string[] {
  const normalized = normalizeAppKey(stripExecutableSuffix(value ?? ""));
  if (!normalized) return [];

  const aliases = new Set<string>([normalized]);
  const stripped = stripWrapperSuffixes(normalized);
  if (stripped) aliases.add(stripped);

  if (normalized.endsWith("64") || normalized.endsWith("32")) {
    aliases.add(normalized.replace(/(64|32)$/g, ""));
  }

  if (stripped.endsWith("64") || stripped.endsWith("32")) {
    aliases.add(stripped.replace(/(64|32)$/g, ""));
  }

  return Array.from(aliases).filter(Boolean);
}

function aliasMatches(left: string | undefined, right: string | undefined): boolean {
  const leftAliases = buildAppAliases(left);
  const rightAliases = buildAppAliases(right);
  return leftAliases.some((l) => rightAliases.some((r) => l === r || l.includes(r) || r.includes(l)));
}

function scoreAliasOverlap(left: string | undefined, right: string | undefined): number {
  const leftAliases = buildAppAliases(left);
  const rightAliases = buildAppAliases(right);
  let score = 0;

  for (const l of leftAliases) {
    for (const r of rightAliases) {
      if (l === r) score = Math.max(score, 120);
      else if (l && r && (l.includes(r) || r.includes(l))) score = Math.max(score, 70);
    }
  }

  return score;
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
  // additional titles
  "forza",
  "deathstranding",
  "witcher",
  "darksouls",
  "sekiro",
  "eldenring",
  "dragonage",
  "masseffect",
  "fallout",
  "monsterhunter",
  "persona",
  "hades",
  "hollowknight",
  "deepskyderelicts",
  "outriders",
  "ghostrunner",
  "deathloop",
  "control",
  "doom",
  "wolfenstein",
  "borderlands",
  "bioshock",
  "dishonored",
  "prey",
  "xcom",
  "civilization",
  "totalwar",
  "deeprockgalactic",
  "vermintide",
  "darktide",
  "reddeadredemption",
  "thelastofus",
  "horizon",
  "godofwar",
  "spiderman",
  "uncharted",
  "ghostoftsushima",
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
    title.includes("xbox") ||
    title.includes("gameguard") ||
    title.includes("nprotect")
  );
}

function isTransientFocusSurface(foreground: { name: string; title?: string } | null): boolean {
  if (!foreground) return true;

  const name = normalizeAppKey(foreground.name);
  const title = normalizeAppKey(foreground.title);

  return (
    isLauncherOrOverlaySurface(foreground) ||
    !title ||
    name === "explorer" ||
    name === "shellexperiencehost" ||
    name === "searchhost" ||
    name === "searchapp" ||
    name === "startmenuexperiencehost" ||
    name === "applicationframehost" ||
    name === "lockapp" ||
    title === "taskswitcher" ||
    title === "taskview" ||
    title === "desktopwindowmanager"
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
  ignoredProcesses?: string[];
}

interface CachedAudioTarget {
  processName: string;
  displayName: string;
  isGame?: boolean;
  updatedAt?: number;
}

const DEFAULT_IGNORED_PROCESSES = [
  "powershell",
  "pwsh",
  "windowsterminal",
  "cmd",
  "conhost",
];

const GAME_TARGET_GRACE_MS = 2500;

function normalizeIgnoredProcesses(value: JsonValue | undefined): string[] {
  const userValues = Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .map((item) => stripExecutableSuffix(item.toLowerCase()))
    : [];

  return Array.from(new Set([...DEFAULT_IGNORED_PROCESSES, ...userValues]));
}

function isLikelyGameForeground(foreground: { name: string; title?: string } | null): boolean {
  if (!foreground) return false;

  const combined = `${normalizeAppKey(foreground.name)} ${normalizeAppKey(foreground.title)}`;
  if (NON_GAME_PROCESS_HINTS.some((hint) => combined.includes(hint))) return false;
  return GAME_PROCESS_HINTS.some((hint) => combined.includes(hint));
}

@action({ UUID: "com.makomi.volumemixer.activewindow" })
export class ActiveWindowVolumeAction extends SingletonAction<Settings> {
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly lastAudioTargets = new Map<string, CachedAudioTarget>();
  private readonly lastGameTargets = new Map<string, CachedAudioTarget>();
  private readonly quickVolumes = new Map<string, { at: number; volume: number }>();
  private readonly settingsCache = new Map<string, Settings>();
  private readonly lastResolutionLog = new Map<string, string>();

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    if (!ev.action.isDial()) return;
    const dialAction = ev.action;
    this.settingsCache.set(dialAction.id, ev.payload.settings);
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
    this.settingsCache.delete(ev.action.id);
    this.lastGameTargets.delete(ev.action.id);
  }

  override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
    const { ticks, settings } = ev.payload;
    this.settingsCache.set(ev.action.id, settings);
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
    this.settingsCache.set(ev.action.id, ev.payload.settings);
    const target = await this.resolveTarget(ev.action.id);
    if (target.sessions.length === 0) return;

    const shouldMute = target.sessions.some((session) => !session.muted);
    await Promise.all(target.sessions.map((session) => audioService.setMuted(session.pid, shouldMute)));
    if (ev.action.isDial()) await this.refreshDisplay(ev.action);
  }

  override async onTouchTap(ev: TouchTapEvent<Settings>): Promise<void> {
    this.settingsCache.set(ev.action.id, ev.payload.settings);
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

    const liveSettings = await ev.action.getSettings();
    this.settingsCache.set(ev.action.id, liveSettings);
    const target = await this.resolveTarget(ev.action.id);
    const settings = this.settingsCache.get(ev.action.id) ?? liveSettings;
    const ignoredProcesses = normalizeIgnoredProcesses(settings.ignoredProcesses);
    if (!target.foreground && target.sessions.length === 0) {
      await streamDeck.ui.sendToPropertyInspector({ foreground: null, ignoredProcesses, logPath: getDebugLogPath() });
      return;
    }

    const session = target.sessions[0];
    await streamDeck.ui.sendToPropertyInspector({
      ignoredProcesses,
      logPath: getDebugLogPath(),
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
        ignored: this.isIgnoredForeground(target.foreground, ignoredProcesses),
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
    const settings = this.settingsCache.get(actionId);
    const ignoredProcesses = normalizeIgnoredProcesses(settings?.ignoredProcesses);

    if (foreground && !this.isIgnoredForeground(foreground, ignoredProcesses)) {
      const foregroundSessions = this.findForegroundSessions(sessions, foreground);
      if (foregroundSessions.length > 0) {
        const session = foregroundSessions[0];
        this.lastAudioTargets.set(actionId, {
          processName: session.name,
          displayName: session.windowTitle || session.displayName || foreground.title || foreground.name,
          isGame: isLikelyGameSession(session) || isLikelyGameForeground(foreground),
          updatedAt: Date.now(),
        });
        this.updateGameCache(actionId, session, foreground);
        this.logResolution(actionId, "foreground-match", foreground, foregroundSessions, {
          ignoredProcesses,
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
          isGame: true,
          updatedAt: Date.now(),
        });
        this.updateGameCache(actionId, session, foreground);
        this.logResolution(actionId, "launcher-game-fallback", foreground, launcherGameSessions, {
          ignoredProcesses,
          displayName: session.windowTitle || session.displayName || session.name,
        });

        return {
          foreground,
          displayName: session.windowTitle || session.displayName || session.name,
          sessions: launcherGameSessions,
        };
      }
    }

    // Fix: clear stale game cache when a confirmed different game takes focus.
    // Prevents wrong displayName (Forza) being shown while a new game (Helldivers) is active.
    if (foreground && isLikelyGameForeground(foreground) && !this.isIgnoredForeground(foreground, ignoredProcesses)) {
      const staleGame = this.lastGameTargets.get(actionId);
      if (staleGame && !aliasMatches(foreground.name, staleGame.processName)) {
        this.lastGameTargets.delete(actionId);
        writeDebugLog("active-window", "game cache invalidated", {
          reason: "different game in foreground",
          foreground: foreground.name,
          evicted: staleGame.processName,
        });
      }
    }

    const cachedGame = this.lastGameTargets.get(actionId);
    if (cachedGame) {
      const cachedGameSessions = this.findSessionsByCachedTarget(sessions, cachedGame);
      if (cachedGameSessions.length > 0) {
        this.logResolution(actionId, "cached-game", foreground, cachedGameSessions, {
          ignoredProcesses,
          cachedGame,
          gameGraceActive: this.isGameGraceActive(cachedGame),
          gameForeground: isLikelyGameForeground(foreground),
          launcherSurface: isLauncherOrOverlaySurface(foreground ?? { name: "", title: "" }),
        });
        return {
          foreground,
          displayName: cachedGame.displayName,
          sessions: cachedGameSessions,
        };
      }
    }

    const cached = this.lastAudioTargets.get(actionId);
    if (cached) {
      const cachedSessions = this.findSessionsByCachedTarget(sessions, cached);
      if (cachedSessions.length > 0) {
        this.logResolution(actionId, "cached-audio", foreground, cachedSessions, {
          ignoredProcesses,
          cached,
        });
        return {
          foreground,
          displayName: cached.displayName,
          sessions: cachedSessions,
        };
      }
    }

    this.logResolution(actionId, "no-match", foreground, [], {
      ignoredProcesses,
      sessionCount: sessions.length,
    });
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

    const byProcess = sessions.filter((s) => aliasMatches(s.name, foreground.name));
    if (byProcess.length > 0) return byProcess;

    const foregroundTitle = normalizeAppKey(foreground.title);
    const scored = sessions
      .map((session) => ({
        session,
        score: this.scoreForegroundSessionMatch(session, foreground, foregroundTitle),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      // Fix: fallback for games where audio runs under a different PID/process name
      // (e.g. EasyAntiCheat wrapper, Steam subprocess). Match by shared game keyword.
      if (isLikelyGameForeground(foreground)) {
        const foregroundKey = `${normalizeAppKey(foreground.name)} ${normalizeAppKey(foreground.title)}`;
        const matchingHints = GAME_PROCESS_HINTS.filter((hint) => foregroundKey.includes(hint));
        if (matchingHints.length > 0) {
          const hintSessions = sessions.filter((s) => {
            const sessionKey = `${normalizeAppKey(s.name)} ${normalizeAppKey(s.displayName)} ${normalizeAppKey(s.windowTitle)}`;
            return matchingHints.some((hint) => sessionKey.includes(hint));
          });
          if (hintSessions.length > 0) return hintSessions;
        }
        // Last resort: exactly one game session active — safe to assume it's the foreground game
        const gameSessions = sessions.filter(isLikelyGameSession);
        if (gameSessions.length === 1) return gameSessions;
      }
      return [];
    }

    const bestScore = scored[0].score;
    return scored.filter((entry) => entry.score === bestScore).map((entry) => entry.session);
  }

  private findSessionsByProcessName(sessions: AudioSession[], processName: string): AudioSession[] {
    return sessions.filter((s) => aliasMatches(s.name, processName));
  }

  private updateGameCache(
    actionId: string,
    session: AudioSession,
    foreground: { name: string; title?: string }
  ): void {
    if (!isLikelyGameSession(session) && !isLikelyGameForeground(foreground)) return;

    this.lastGameTargets.set(actionId, {
      processName: session.name,
      displayName: session.windowTitle || session.displayName || foreground.title || session.name,
      isGame: true,
      updatedAt: Date.now(),
    });
  }

  private isGameGraceActive(target: CachedAudioTarget): boolean {
    return typeof target.updatedAt === "number" && Date.now() - target.updatedAt <= GAME_TARGET_GRACE_MS;
  }

  private logResolution(
    actionId: string,
    reason: string,
    foreground: { pid: number; name: string; title?: string } | null,
    sessions: AudioSession[],
    extra?: Record<string, unknown>
  ): void {
    const summary = {
      reason,
      foreground: foreground
        ? { pid: foreground.pid, name: foreground.name, title: foreground.title ?? "" }
        : null,
      matches: sessions.slice(0, 4).map((session) => ({
        pid: session.pid,
        name: session.name,
        displayName: session.displayName,
        windowTitle: session.windowTitle ?? "",
        volume: Math.round(session.volume * 100),
        muted: session.muted,
      })),
      ...(extra ?? {}),
    };
    const signature = JSON.stringify(summary);
    if (this.lastResolutionLog.get(actionId) === signature) return;

    this.lastResolutionLog.set(actionId, signature);
    writeDebugLog("active-window", "resolved target", summary);
  }

  private isIgnoredForeground(
    foreground: { name: string; title?: string } | null,
    ignoredProcesses: string[]
  ): boolean {
    if (!foreground) return false;

    const foregroundName = stripExecutableSuffix(foreground.name.toLowerCase());
    return ignoredProcesses.some((ignored) => aliasMatches(foregroundName, ignored));
  }

  private findSessionsByCachedTarget(
    sessions: AudioSession[],
    cached: CachedAudioTarget
  ): AudioSession[] {
    const scored = sessions
      .map((session) => ({
        session,
        score: this.scoreCachedSessionMatch(session, cached),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return [];

    const bestScore = scored[0].score;
    return scored.filter((entry) => entry.score === bestScore).map((entry) => entry.session);
  }

  private findLauncherGameSessions(
    sessions: AudioSession[],
    foreground: { name: string; title?: string }
  ): AudioSession[] {
    if (!isLauncherOrOverlaySurface(foreground)) return [];

    const foregroundTitle = normalizeAppKey(foreground.title);
    const scored = sessions
      .filter(isLikelyGameSession)
      .map((session) => ({
        session,
        score: this.scoreForegroundSessionMatch(session, { pid: -1, ...foreground }, foregroundTitle),
      }))
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return [];

    const positive = scored.filter((entry) => entry.score > 0);
    if (positive.length > 0) {
      const bestScore = positive[0].score;
      return positive
        .filter((entry) => entry.score === bestScore)
        .map((entry) => entry.session);
    }

    return scored.slice(0, 1).map((entry) => entry.session);
  }

  private getDisplayVolume(actionId: string, sessions: AudioSession[]): number {
    const quick = this.quickVolumes.get(actionId);
    if (quick && Date.now() - quick.at < 750) {
      return quick.volume;
    }

    return sessions.reduce((sum, s) => sum + s.volume, 0) / sessions.length;
  }

  private scoreForegroundSessionMatch(
    session: AudioSession,
    foreground: { pid: number; name: string; title?: string },
    foregroundTitle: string
  ): number {
    let score = 0;

    if (session.pid === foreground.pid) score += 1000;
    score += scoreAliasOverlap(session.name, foreground.name);
    score += scoreAliasOverlap(session.displayName, foreground.name);
    score += scoreAliasOverlap(session.windowTitle, foreground.name);

    const sessionTitle = normalizeAppKey(session.windowTitle);
    const sessionDisplayName = normalizeAppKey(session.displayName);
    const sessionProcessName = normalizeAppKey(stripExecutableSuffix(session.name));

    if (foregroundTitle) {
      if (sessionTitle === foregroundTitle) score += 400;
      else if (sessionTitle && (sessionTitle.includes(foregroundTitle) || foregroundTitle.includes(sessionTitle))) score += 180;

      if (sessionDisplayName === foregroundTitle) score += 320;
      else if (
        sessionDisplayName &&
        (sessionDisplayName.includes(foregroundTitle) || foregroundTitle.includes(sessionDisplayName))
      ) score += 140;

      if (sessionProcessName === foregroundTitle) score += 260;
      else if (
        sessionProcessName &&
        (sessionProcessName.includes(foregroundTitle) || foregroundTitle.includes(sessionProcessName))
      ) score += 120;
    }

    return score;
  }

  private scoreCachedSessionMatch(session: AudioSession, cached: CachedAudioTarget): number {
    let score = 0;

    if (aliasMatches(session.name, cached.processName)) score += 260;
    score += scoreAliasOverlap(session.displayName, cached.displayName);
    score += scoreAliasOverlap(session.windowTitle, cached.displayName);
    score += scoreAliasOverlap(session.name, cached.displayName);

    const cachedDisplay = normalizeAppKey(cached.displayName);
    const sessionTitle = normalizeAppKey(session.windowTitle);
    const sessionDisplayName = normalizeAppKey(session.displayName);
    const sessionProcessName = normalizeAppKey(stripExecutableSuffix(session.name));

    if (cachedDisplay) {
      if (sessionTitle === cachedDisplay) score += 360;
      else if (sessionTitle && (sessionTitle.includes(cachedDisplay) || cachedDisplay.includes(sessionTitle))) score += 180;

      if (sessionDisplayName === cachedDisplay) score += 320;
      else if (
        sessionDisplayName &&
        (sessionDisplayName.includes(cachedDisplay) || cachedDisplay.includes(sessionDisplayName))
      ) score += 150;

      if (sessionProcessName === cachedDisplay) score += 200;
      else if (
        sessionProcessName &&
        (sessionProcessName.includes(cachedDisplay) || cachedDisplay.includes(sessionProcessName))
      ) score += 100;
    }

    // Removed: isLikelyGameSession +40 bonus caused ANY game session to score >0 against
    // a stale game cache, returning wrong sessions (e.g. Helldivers matched Forza cache).

    return score;
  }
}
