// Debug display utilities - color functions for debug overlays

/** Get color based on wall distance (green=safe, yellow=caution, red=danger) */
export function getWallDistColor(dist: number): string {
  if (dist < 10) return "#ff4444"; // Critical - red
  if (dist < 35) return "#ffaa00"; // Danger - orange
  if (dist < 65) return "#ffff44"; // Caution - yellow
  return "#44ff44"; // Safe - green
}

/** Get color for speed display (0-10 range) */
export function getSpeedColor(speed: number): string {
  if (speed > 6) return "#44ff44"; // Fast - green
  if (speed > 3) return "#ffff44"; // Medium - yellow
  return "#aaaaaa"; // Slow - gray
}
