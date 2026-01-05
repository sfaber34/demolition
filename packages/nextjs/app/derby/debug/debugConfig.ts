// Debug Configuration - Toggle debug overlays here
// All flags are easy booleans - flip to true/false as needed

/**
 * What value to show in the HUD below health bars (replaces DMG when debug is on)
 * - 'dmg': Default damage dealt (production mode)
 * - 'wallDistance': Distance to nearest wall
 * - 'realVelocity': Actual movement speed (not state velocity)
 * - 'stateVelocity': Physics state velocity (for comparison)
 * - 'throttle': Current throttle input
 */
export type HudDebugValue = "dmg" | "wallDistance" | "realVelocity" | "stateVelocity" | "throttle";

export const DEBUG_CONFIG = {
  // Master switch - set to false to disable all debug overlays
  enabled: false,

  // HUD debug display - what to show in place of DMG in the HUD
  // Set to 'dmg' for normal production display
  hudDebugValue: "dmg" as HudDebugValue,

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
