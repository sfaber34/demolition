// Debug Configuration - Toggle debug overlays here
// All flags are easy booleans - flip to true/false as needed
import type { AIBehavior } from "../sim/typesSim";

/**
 * What value to show in the HUD below health bars (replaces DMG when debug is on)
 * - 'dmg': Default damage dealt (production mode)
 * - 'wallDistance': Distance to nearest wall
 * - 'speed': Current car speed
 * - 'throttle': Current throttle input
 */
export type HudDebugValue = "dmg" | "wallDistance" | "speed" | "throttle";

/**
 * AI testing helper:
 * - Set to "orbiting" to test Wander + WallAvoid only (default).
 * - Set to "striking" or "repositioning" to force those modes.
 * - Set to "auto" once you want full behavior switching.
 *
 * Note: This config is independent of DEBUG_CONFIG.enabled so you can test AI
 * without turning on visual overlays.
 */
export type AiForceMode = "auto" | AIBehavior;
export const AI_TEST_CONFIG: { forceMode: AiForceMode } = {
  // Default: start in wander+wall-avoid so you can tune driving first.
  forceMode: "orbiting",
};

export const DEBUG_CONFIG = {
  // Master switch - set to false to disable all debug overlays
  enabled: true,

  // HUD debug display - what to show in place of DMG in the HUD
  // Set to 'dmg' for normal production display
  hudDebugValue: "wallDistance" as HudDebugValue,

  // Individual overlays (only active when enabled=true)
  showWallDistance: false, // Distance to nearest wall (in-game overlay)
  showSpeed: false, // Current speed (in-game overlay)
  showVelocityVector: false, // Arrow showing velocity direction
  showForwardVector: false, // Arrow showing car facing direction
  showCarId: false, // Car ID/name label
  showHealth: false, // Health value (already in HUD, but useful for quick glance)
  showAiScore: false, // Reserved: show AI decision scores (future)
  showPredictedPath: false, // Reserved: show where AI predicts car will go (future)
  showThreats: false, // Reserved: show lines to threatening opponents (future)
  showTargets: false, // Reserved: show lines to attack targets (future)
};

// Shorthand to check if any debug is active
export function isDebugActive(): boolean {
  return DEBUG_CONFIG.enabled;
}
