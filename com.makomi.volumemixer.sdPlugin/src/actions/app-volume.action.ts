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

interface Settings {
  [key: string]: JsonValue;
  processName?: string;
  sensitivity?: number;
}

@action({ UUID: "com.makomi.volumemixer.appvolume" })
export class AppVolumeAction extends SingletonAction<Settings> {
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly quickVolumes = new Map<string, { at: number; volume: number }>();

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    if (!ev.action.isDial()) return;
    const dialAction = ev.action;
    await dialAction.setFeedbackLayout(VOLUME_LAYOUT);
    await this.refreshDisplay(dialAction, ev.payload.settings);
    const t = setInterval(() => this.refreshDisplay(dialAction, null), 800);
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
    const sessions = await this.resolveSessions(settings.processName as string | undefined);
    if (sessions.length === 0) return;

    const delta = ((settings.sensitivity as number | undefined) ?? 0.02) * ticks;
    const currentVolume = this.getDisplayVolume(ev.action.id, sessions);
    const nextVolume = Math.max(0, Math.min(1, currentVolume + delta));
    this.quickVolumes.set(ev.action.id, { at: Date.now(), volume: nextVolume });

    await Promise.all(sessions.map((session) => audioService.setVolume(session.pid, nextVolume)));
    if (ev.action.isDial()) await this.refreshDisplay(ev.action, settings);
  }

  override async onDialDown(ev: DialDownEvent<Settings>): Promise<void> {
    const sessions = await this.resolveSessions(ev.payload.settings.processName as string | undefined);
    if (sessions.length === 0) return;

    const shouldMute = sessions.some((session) => !session.muted);
    await Promise.all(sessions.map((session) => audioService.setMuted(session.pid, shouldMute)));
    if (ev.action.isDial()) await this.refreshDisplay(ev.action, ev.payload.settings);
  }

  override async onTouchTap(ev: TouchTapEvent<Settings>): Promise<void> {
    const sessions = await this.resolveSessions(ev.payload.settings.processName as string | undefined);
    if (sessions.length === 0) return;

    await Promise.all(
      sessions.map((session) => audioService.setVolume(session.pid, ev.payload.hold ? 0 : 1.0))
    );
    if (ev.action.isDial()) await this.refreshDisplay(ev.action, ev.payload.settings);
  }

  override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, Settings>): Promise<void> {
    const payload = ev.payload as { event?: string };
    if (payload.event === "requestSessions") {
      const sessions = await audioService.listSessions();
      const sessionsWithIcons = await Promise.all(
        sessions.map(async (session) => ({
          ...session,
          icon: (await audioService.getIcon(session.pid).catch(() => null)) ?? "",
        }))
      );
      await streamDeck.ui.sendToPropertyInspector({ sessions: sessionsWithIcons });
    }
  }

  private async resolveSessions(processName?: string): Promise<AudioSession[]> {
    if (!processName) return [];
    const sessions = await audioService.listSessions();
    const name = processName.toLowerCase();
    return sessions.filter(
      (s) =>
        s.name.toLowerCase() === name ||
        s.name.toLowerCase().replace(".exe", "") === name.replace(".exe", "")
    );
  }

  private async refreshDisplay(
    action: DialAction<Settings>,
    settings: Settings | null
  ): Promise<void> {
    try {
      const s = settings ?? (await action.getSettings());
      const processName = s.processName as string | undefined;
      const sessions = await this.resolveSessions(processName);

      if (sessions.length === 0) {
        await action.setFeedback({
          icon: { value: "imgs/actions/AppVolume/action.png" },
          appName: { value: processName ? formatAppName(processName) : "No app" },
          levelText: { value: "—" },
          levelBar: { value: 0, opacity: 0.3 },
        });
        return;
      }

      const session = sessions[0];
      const volume = this.getDisplayVolume(action.id, sessions);
      const muted = sessions.every((s) => s.muted);
      const pct = Math.round(volume * 100);
      const label = formatAppName(session?.windowTitle || session?.displayName || processName || "").substring(0, 16);
      const icon = (await audioService.getIcon(session.pid)) ?? "imgs/actions/AppVolume/action.png";

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

  private getDisplayVolume(actionId: string, sessions: AudioSession[]): number {
    const quick = this.quickVolumes.get(actionId);
    if (quick && Date.now() - quick.at < 750) {
      return quick.volume;
    }

    return sessions.reduce((sum, s) => sum + s.volume, 0) / sessions.length;
  }
}
