import { GAME_TICK_RATE, SNAPSHOT_RATE } from '../shared/constants';

export class GameLoop {
  private tickIntervalMs: number;
  private snapshotIntervalMs: number;
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private lastTickTime: number = 0;
  private lastSnapshotTime: number = 0;

  private onTickCallback: (dt: number, now: number) => void;
  private onSnapshotCallback: (now: number) => void;

  constructor(
    onTick: (dt: number, now: number) => void,
    onSnapshot: (now: number) => void
  ) {
    this.tickIntervalMs = Math.round(1000 / GAME_TICK_RATE); // 50ms
    this.snapshotIntervalMs = Math.round(1000 / SNAPSHOT_RATE); // ~66ms
    this.onTickCallback = onTick;
    this.onSnapshotCallback = onSnapshot;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTickTime = Date.now();
    this.lastSnapshotTime = Date.now();

    // Single unified loop timer running at the tick interval
    this.timer = setInterval(() => {
      if (!this.isRunning) return;

      const now = Date.now();
      const elapsed = (now - this.lastTickTime) / 1000;
      this.lastTickTime = now;

      // Bound delta-time to avoid spiral of death
      const dt = Math.min(2.5, elapsed * GAME_TICK_RATE);

      try {
        this.onTickCallback(dt, now);
      } catch (err) {
        console.error('[GameLoop] Error during tick:', err);
      }

      // Check if it's time to broadcast snapshot
      if (now - this.lastSnapshotTime >= this.snapshotIntervalMs) {
        this.lastSnapshotTime = now;
        try {
          this.onSnapshotCallback(now);
        } catch (err) {
          console.error('[GameLoop] Error during snapshot broadcast:', err);
        }
      }
    }, this.tickIntervalMs);

    console.log(`[GameLoop] Started with TickRate=${GAME_TICK_RATE}Hz (${this.tickIntervalMs}ms), SnapshotRate=${SNAPSHOT_RATE}Hz (${this.snapshotIntervalMs}ms)`);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[GameLoop] Stopped.');
  }
}
