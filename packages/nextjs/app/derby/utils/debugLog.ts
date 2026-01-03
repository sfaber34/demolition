// Debug logging utility for collision/damage analysis
// Logs are stored in memory and can be saved to server for analysis

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

class DebugLogger {
  private logs: CollisionLogEntry[] = [];
  private maxLogs = 1000;
  private enabled = true;
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

  log(entry: Omit<CollisionLogEntry, "index">) {
    if (!this.enabled) return;
    this.logs.push({ ...entry, index: this.logIndex++ });
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  getLogs(): CollisionLogEntry[] {
    return [...this.logs];
  }

  getRecentLogs(count: number = 20): CollisionLogEntry[] {
    return this.logs.slice(-count);
  }

  // Get summary stats
  getSummary() {
    const carCollisions = this.logs.filter(l => l.type === "car_collision");
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
    console.log("=== Recent Collision Logs ===");
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
