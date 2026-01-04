// Debug Configuration - Toggle debug overlays here
// All flags are easy booleans - flip to true/false as needed

export const DEBUG_CONFIG = {
  // Master switch - set to false to disable all debug overlays
  enabled: true,

  // Individual overlays (only active when enabled=true)
  showWallDistance: true, // Distance to nearest wall
  showSpeed: false, // Current speed
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
