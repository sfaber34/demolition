// Debug logging utility for collision/damage analysis
// Logs are stored in memory and can be saved to server for analysis

/**
 * Simple global flag to enable/disable collision logging.
 * - Keep this `false` for normal play (less overhead).
 * - Set to `true` when you want to analyze collisions/damage.
 *
 * You can also toggle at runtime from the console via `window.debugLog.enable()` / `.disable()`.
 */
export const COLLISION_LOGGING_ENABLED = false;

export interface CarSnapshot {
  id: string;
  name: string;
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  speed: number;
  rotation: number; // degrees
  rotationRad: number; // radians
  angularVelocity: number;
  health: number;
  isAlive: boolean;
}

export interface CollisionLogEntry {
  index: number;
  timestamp: number;
  gameTimeMs: number;
  type: "car_collision" | "wall_collision";

  // Car snapshots at collision time
  carA?: CarSnapshot;
  carB?: CarSnapshot;
  car?: CarSnapshot; // For wall collisions

  // Collision geometry
  contactPoint: { x: number; y: number };
  collisionNormal: { x: number; y: number };
  penetration: number;

  // Velocity analysis
  relativeVelocity?: { x: number; y: number };
  relativeImpact: number; // dot(relVel, normal)
  combinedSpeed: number;
  damageImpactSpeed: number;

  // Damage results
  damageA: number;
  damageB: number;
  totalDamage: number;

  // Filtering
  wasFiltered: boolean;
  filterReason?: string;
}

export interface EscapeLogEntry {
  index: number;
  timestamp: number;
  gameTimeMs: number;
  type: "escape";
  event: "enter" | "tick" | "exit";

  car: CarSnapshot;
  input: { throttle: number; steer: number };

  // Escape context
  wallClear: number;
  nearWall: boolean;
  contactZone: boolean;
  pushingIntoWall: boolean;
  moved: number;
  wallStuckMs: number;

  escapeMaxMs: number;
  escapeMinMs: number;
  clearStableMs: number;
  clearNow: boolean;
  startClear: number;

  // Decision info
  toCenter: { x: number; y: number };
  dotToCenter: number;
  desiredGear: 1 | -1;
  gear: 1 | -1;
  gearHoldMs: number;
}

export interface PlanLogEntry {
  index: number;
  timestamp: number;
  gameTimeMs: number;
  type: "plan";
  car: CarSnapshot;
  input: { throttle: number; steer: number };
  wallClear: number;
  toCenter: { x: number; y: number };
  dotToCenter: number;
  note?: string;
}

export type DebugLogEntry = CollisionLogEntry | EscapeLogEntry | PlanLogEntry;

function isCollisionLogEntry(e: DebugLogEntry): e is CollisionLogEntry {
  return e.type === "car_collision" || e.type === "wall_collision";
}

class DebugLogger {
  private logs: DebugLogEntry[] = [];
  private maxLogs = 1000;
  private enabled = COLLISION_LOGGING_ENABLED;
  private enabledTypes: Set<DebugLogEntry["type"]> | null = null; // null = all types
  private logIndex = 0;

  enable() {
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
  }

  clear() {
    this.logs = [];
    this.logIndex = 0;
  }

  /**
   * Increase this when debugging longer behaviors. Note: logs are kept in-memory in the browser.
   */
  setMaxLogs(max: number) {
    this.maxLogs = Math.max(10, Math.floor(max));
    // Trim if needed.
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
  }

  /**
   * Restrict which log entry types are recorded. Useful to avoid collisions flooding the buffer.
   * Example: `window.debugLog.setEnabledTypes(["escape"])`
   */
  setEnabledTypes(types: DebugLogEntry["type"][] | null) {
    this.enabledTypes = types ? new Set(types) : null;
  }

  log(entry: Omit<CollisionLogEntry, "index">): void;
  log(entry: Omit<EscapeLogEntry, "index">): void;
  log(entry: Omit<PlanLogEntry, "index">): void;
  log(entry: Omit<DebugLogEntry, "index">) {
    if (!this.enabled) return;
    if (this.enabledTypes && !this.enabledTypes.has((entry as any).type)) return;
    // The overloads guarantee correctness at call sites; we cast here to avoid
    // union-spread narrowing issues in TS.
    this.logs.push({ ...(entry as any), index: this.logIndex++ } as DebugLogEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  getLogs(): DebugLogEntry[] {
    return [...this.logs];
  }

  getRecentLogs(count: number = 20): DebugLogEntry[] {
    return this.logs.slice(-count);
  }

  // Get summary stats
  getSummary() {
    const carCollisions = this.logs.filter(isCollisionLogEntry).filter(l => l.type === "car_collision");
    const damaging = carCollisions.filter(l => !l.wasFiltered);
    const filtered = carCollisions.filter(l => l.wasFiltered);

    const avgDamageImpact =
      damaging.length > 0 ? damaging.reduce((sum, l) => sum + l.damageImpactSpeed, 0) / damaging.length : 0;
    const avgFilteredImpact =
      filtered.length > 0 ? filtered.reduce((sum, l) => sum + l.damageImpactSpeed, 0) / filtered.length : 0;

    return {
      totalCollisions: carCollisions.length,
      damagingCollisions: damaging.length,
      filteredCollisions: filtered.length,
      avgDamageImpactSpeed: avgDamageImpact.toFixed(1),
      avgFilteredImpactSpeed: avgFilteredImpact.toFixed(1),
      totalDamageDealt: damaging.reduce((sum, l) => sum + l.totalDamage, 0).toFixed(1),
      avgDamagePerHit:
        damaging.length > 0 ? (damaging.reduce((sum, l) => sum + l.totalDamage, 0) / damaging.length).toFixed(1) : 0,
    };
  }

  // Save logs to server
  async saveToServer(): Promise<{ success: boolean; count: number }> {
    try {
      const response = await fetch("/api/debug-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.logs),
      });
      return await response.json();
    } catch (error) {
      console.error("Failed to save logs:", error);
      return { success: false, count: 0 };
    }
  }

  // Print recent logs to console in readable format
  printRecent(count: number = 10) {
    const recent = this.getRecentLogs(count);
    console.log("=== Recent Debug Logs ===");
    recent.forEach(log => {
      if (log.type === "car_collision" && log.carA && log.carB) {
        console.log(
          `[${log.index}] ${log.carA.name} vs ${log.carB.name}`,
          `\n  Speeds: A=${log.carA.speed.toFixed(1)} B=${log.carB.speed.toFixed(1)}`,
          `\n  Positions: A=(${log.carA.position.x.toFixed(0)},${log.carA.position.y.toFixed(0)}) B=(${log.carB.position.x.toFixed(0)},${log.carB.position.y.toFixed(0)})`,
          `\n  RelImpact=${log.relativeImpact.toFixed(1)} DmgImpact=${log.damageImpactSpeed.toFixed(1)}`,
          `\n  Damage: A=${log.damageA.toFixed(1)} B=${log.damageB.toFixed(1)}`,
          log.wasFiltered ? `\n  FILTERED: ${log.filterReason}` : "",
        );
      } else if (log.type === "escape") {
        console.log(
          `[${log.index}] ESCAPE ${log.event} ${log.car.name}`,
          `\n  pos=(${log.car.position.x.toFixed(0)},${log.car.position.y.toFixed(0)}) speed=${log.car.speed.toFixed(1)} wallClear=${log.wallClear.toFixed(1)}`,
          `\n  nearWall=${log.nearWall} contactZone=${log.contactZone} pushingIntoWall=${log.pushingIntoWall} moved=${log.moved.toFixed(2)} stuckMs=${log.wallStuckMs.toFixed(0)}`,
          `\n  escapeMax=${log.escapeMaxMs.toFixed(0)} escapeMin=${log.escapeMinMs.toFixed(0)} clearNow=${log.clearNow} clearStable=${log.clearStableMs.toFixed(0)} startClear=${log.startClear.toFixed(1)}`,
          `\n  toCenter=(${log.toCenter.x.toFixed(2)},${log.toCenter.y.toFixed(2)}) dot=${log.dotToCenter.toFixed(2)} gear=${log.gear} desiredGear=${log.desiredGear} holdMs=${log.gearHoldMs.toFixed(0)}`,
          `\n  input throttle=${log.input.throttle.toFixed(2)} steer=${log.input.steer.toFixed(2)}`,
        );
      } else if (log.type === "plan") {
        console.log(
          `[${log.index}] PLAN ${log.car.name}`,
          `\n  pos=(${log.car.position.x.toFixed(0)},${log.car.position.y.toFixed(0)}) speed=${log.car.speed.toFixed(1)} wallClear=${log.wallClear.toFixed(1)}`,
          `\n  toCenter=(${log.toCenter.x.toFixed(2)},${log.toCenter.y.toFixed(2)}) dot=${log.dotToCenter.toFixed(2)}`,
          `\n  input throttle=${log.input.throttle.toFixed(2)} steer=${log.input.steer.toFixed(2)}`,
          log.note ? `\n  note=${log.note}` : "",
        );
      }
    });
    console.log("=== Summary ===", this.getSummary());
  }
}

export const debugLog = new DebugLogger();

// Expose to window for console access
if (typeof window !== "undefined") {
  (window as unknown as { debugLog: DebugLogger }).debugLog = debugLog;
}
