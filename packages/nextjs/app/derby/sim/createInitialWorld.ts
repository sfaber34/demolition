import { ARENA_CONFIG, CAR_COLORS, CAR_CONFIG, CAR_NAMES, type CarSim, type Vector2D, type WorldSim } from "./typesSim";

function createCar(id: string, name: string, color: string, position: Vector2D, rotation: number): CarSim {
  // Slight stat variations for each car (using deterministic seed based on name)
  const seed = name.charCodeAt(0) / 255;
  const accelVariation = 0.9 + seed * 0.3;
  const corneringVariation = 0.85 + ((seed * 7) % 1) * 0.3;
  const tractionVariation = 0.75 + ((seed * 13) % 1) * 0.3;

  return {
    id,
    name,
    color,
    position: { x: position.x, y: position.y },
    velocity: { x: 0, y: 0 },
    rotation,
    angularVelocity: 0,
    health: CAR_CONFIG.maxHealth,
    maxHealth: CAR_CONFIG.maxHealth,
    damageDealt: 0,
    isAlive: true,
    width: CAR_CONFIG.width,
    height: CAR_CONFIG.height,
    acceleration: 0.35 * accelVariation,
    maxSpeed: 15, // Actual achievable max with friction physics is ~10-15
    cornering: 1.0 * corneringVariation,
    traction: 0.75 * tractionVariation,
    input: { throttle: 0, steer: 0 },
    aiState: "orbiting",
    stateTimer: 0,
    targetId: null,
    stuckTimer: 0,
    lastPosition: { x: position.x, y: position.y },
    aiDebug: {},
  };
}

export function createInitialCars(): CarSim[] {
  const { width, height, wallThickness } = ARENA_CONFIG;
  const margin = 80;

  // Spawn positions near corners
  const spawnPositions: { pos: Vector2D; rotation: number }[] = [
    {
      pos: { x: wallThickness + margin + 15, y: wallThickness + margin + 15 },
      rotation: Math.PI / 4,
    },
    {
      pos: { x: width - wallThickness - margin - 15, y: wallThickness + margin + 15 },
      rotation: (3 * Math.PI) / 4,
    },
    {
      pos: { x: wallThickness + margin + 15, y: height - wallThickness - margin - 15 },
      rotation: -Math.PI / 4,
    },
    {
      pos: { x: width - wallThickness - margin - 15, y: height - wallThickness - margin - 15 },
      rotation: (-3 * Math.PI) / 4,
    },
  ];

  const colors = Object.values(CAR_COLORS);
  // IMPORTANT: IDs must be deterministic and independent of module-level counters.
  // In React StrictMode (dev), components can mount twice. If IDs are counter-based,
  // the "first game" can differ from subsequent restarts even with the same seed.
  return spawnPositions.map((spawn, i) =>
    createCar(`car-${i + 1}`, CAR_NAMES[i], colors[i], spawn.pos, spawn.rotation),
  );
}

export function createInitialWorld(): WorldSim {
  return {
    cars: createInitialCars(),
    gamePhase: "title",
    winner: null,
    gameTime: 0,
    victoryTime: 0,
    collisionCooldowns: {},
  };
}
