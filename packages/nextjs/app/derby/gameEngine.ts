// Game Engine - Main game loop and state management
import { applyAIControls, getAIControls, onCarImpact, updateAI } from "./ai";
import {
  checkCarCollision,
  checkWallCollision,
  isCarPinned,
  resolveCarCollision,
  resolveWallCollision,
  updateCarPhysics,
  vec,
} from "./physics";
import {
  ARENA_CONFIG,
  CAR_COLORS,
  CAR_CONFIG,
  CAR_NAMES,
  Car,
  Explosion,
  ExplosionParticle,
  GameState,
  Spark,
  TireMark,
  Vector2D,
} from "./types";

let idCounter = 0;
const generateId = () => `id-${++idCounter}-${Date.now()}`;

// Initialize a car at a given position
function createCar(name: string, color: string, position: Vector2D, rotation: number): Car {
  // Slight stat variations for each car
  const accelVariation = 0.9 + Math.random() * 0.3;
  const corneringVariation = 0.85 + Math.random() * 0.3;
  const tractionVariation = 0.75 + Math.random() * 0.3;

  return {
    id: generateId(),
    name,
    color,
    position: { ...position },
    velocity: { x: 0, y: 0 },
    rotation,
    angularVelocity: 0,
    health: CAR_CONFIG.maxHealth,
    maxHealth: CAR_CONFIG.maxHealth,
    damageDealt: 0,
    isAlive: true,
    width: CAR_CONFIG.width,
    height: CAR_CONFIG.height,
    // Realistic car physics based on 0-60 times:
    // - Demolition derby cars are often modified V8s: 5-8 seconds 0-60
    // - At 60 FPS, that's ~300-480 frames to reach top speed
    // - maxSpeed 120 ≈ 40 mph in arena scale (reasonable for tight arena)
    acceleration: 0.25 * accelVariation, // ~5-7 sec to top speed (V8 beater)
    maxSpeed: 120, // ~40 mph equivalent - realistic derby speed
    cornering: 0.9 * corneringVariation, // Decent turning for old cars
    traction: 0.7 * tractionVariation,
    aiState: "seeking",
    stateTimer: 0,
    targetId: null,
    lastImpactTime: 0,
    stuckTimer: 0,
    lastPosition: { ...position },
  };
}

// Create initial game state
export function createInitialGameState(): GameState {
  const { width, height, wallThickness } = ARENA_CONFIG;
  const margin = 80;

  // Spawn positions near corners - spread out with cars pointing towards center
  const spawnPositions: { pos: Vector2D; rotation: number }[] = [
    {
      pos: {
        x: wallThickness + margin + Math.random() * 30,
        y: wallThickness + margin + Math.random() * 30,
      },
      rotation: Math.PI / 4 + (Math.random() - 0.5) * 0.3, // Pointing towards center
    },
    {
      pos: {
        x: width - wallThickness - margin - Math.random() * 30,
        y: wallThickness + margin + Math.random() * 30,
      },
      rotation: (3 * Math.PI) / 4 + (Math.random() - 0.5) * 0.3,
    },
    {
      pos: {
        x: wallThickness + margin + Math.random() * 30,
        y: height - wallThickness - margin - Math.random() * 30,
      },
      rotation: -Math.PI / 4 + (Math.random() - 0.5) * 0.3,
    },
    {
      pos: {
        x: width - wallThickness - margin - Math.random() * 30,
        y: height - wallThickness - margin - Math.random() * 30,
      },
      rotation: (-3 * Math.PI) / 4 + (Math.random() - 0.5) * 0.3,
    },
  ];

  const colors = Object.values(CAR_COLORS);
  const cars: Car[] = spawnPositions.map((spawn, i) => createCar(CAR_NAMES[i], colors[i], spawn.pos, spawn.rotation));

  return {
    cars,
    tireMarks: [],
    sparks: [],
    smokeParticles: [],
    explosions: [],
    gamePhase: "title",
    winner: null,
    gameTime: 0,
  };
}

// Create explosion effect
function createExplosion(position: Vector2D): Explosion {
  const particleCount = 20 + Math.floor(Math.random() * 15);
  const particles: ExplosionParticle[] = [];

  for (let i = 0; i < particleCount; i++) {
    particles.push({
      angle: (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.5,
      distance: 60 + Math.random() * 40,
      speed: 0.5 + Math.random() * 1,
      size: 4 + Math.random() * 8,
      color: ["#e74c3c", "#f39c12", "#f1c40f", "#d35400", "#c0392b"][Math.floor(Math.random() * 5)],
      rotation: Math.random() * 360,
    });
  }

  return {
    id: generateId(),
    position: { ...position },
    particles,
    startTime: Date.now(),
    duration: 1500,
  };
}

// Create sparks at collision point
function createSparks(position: Vector2D, count: number): Spark[] {
  const sparks: Spark[] = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 50 + Math.random() * 100;
    sparks.push({
      id: generateId(),
      position: { ...position },
      velocity: {
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed,
      },
      life: 300 + Math.random() * 300,
      maxLife: 500,
      color: ["#ffd700", "#ff8c00", "#ff4500", "#ffffff"][Math.floor(Math.random() * 4)],
    });
  }
  return sparks;
}

// Create tire mark
function createTireMark(position: Vector2D, rotation: number): TireMark {
  return {
    id: generateId(),
    position: { ...position },
    rotation,
    opacity: 1,
    timestamp: Date.now(),
  };
}

// Main game update function
export function updateGame(state: GameState, deltaTime: number): GameState {
  if (state.gamePhase !== "playing") return state;

  // Deep copy cars to ensure React detects changes
  const newCars = state.cars.map(car => ({
    ...car,
    position: { ...car.position },
    velocity: { ...car.velocity },
    lastPosition: { ...car.lastPosition },
  }));

  const newState: GameState = {
    ...state,
    cars: newCars,
    tireMarks: [...state.tireMarks],
    sparks: [...state.sparks],
    smokeParticles: [...state.smokeParticles],
    explosions: [...state.explosions],
  };
  newState.gameTime += deltaTime;

  // Update AI and physics for each car
  for (const car of newState.cars) {
    if (!car.isAlive) continue;

    // Update AI state machine
    updateAI(car, newState.cars, deltaTime);

    // Get AI controls
    const controls = getAIControls(car, newState.cars);

    // Apply controls
    applyAIControls(car, controls, deltaTime);

    // Update physics
    updateCarPhysics(car, deltaTime);

    // Create tire marks when turning hard at speed
    const speed = vec.length(car.velocity);
    if (speed > 80 && Math.abs(car.angularVelocity) > 0.05) {
      if (Math.random() < 0.3) {
        newState.tireMarks.push(createTireMark(car.position, car.rotation));
      }
    }
  }

  // Check car-car collisions
  for (let i = 0; i < newState.cars.length; i++) {
    for (let j = i + 1; j < newState.cars.length; j++) {
      const carA = newState.cars[i];
      const carB = newState.cars[j];

      const collision = checkCarCollision(carA, carB);
      if (collision) {
        const { damageA, damageB } = resolveCarCollision(collision);

        // Apply damage
        if (damageA > 0 || damageB > 0) {
          carA.health -= damageA;
          carB.health -= damageB;

          // Track damage dealt
          carB.damageDealt += damageA;
          carA.damageDealt += damageB;

          // Create sparks
          const sparkCount = Math.min(15, Math.floor(collision.impactSpeed / 20));
          if (sparkCount > 0) {
            newState.sparks.push(...createSparks(collision.contactPoint, sparkCount));
          }

          // Update AI states based on who was the attacker
          const speedA = vec.length(carA.velocity);
          const speedB = vec.length(carB.velocity);
          onCarImpact(carA, speedA > speedB);
          onCarImpact(carB, speedB > speedA);
        }
      }
    }
  }

  // Check wall collisions
  for (const car of newState.cars) {
    if (!car.isAlive) continue;

    const wallCollision = checkWallCollision(car);
    if (wallCollision) {
      let damage = resolveWallCollision(wallCollision);

      // Check if pinned against wall
      if (isCarPinned(car, newState.cars, wallCollision)) {
        damage *= CAR_CONFIG.pinnedDamageMultiplier;
      }

      if (damage > 0) {
        car.health -= damage;

        // Create sparks
        const sparkCount = Math.min(8, Math.floor(damage / 2));
        if (sparkCount > 0) {
          newState.sparks.push(...createSparks(wallCollision.contactPoint, sparkCount));
        }
      }
    }
  }

  // Check for car deaths
  for (const car of newState.cars) {
    if (car.isAlive && car.health <= 0) {
      car.isAlive = false;
      car.health = 0;
      car.velocity = { x: 0, y: 0 };
      car.angularVelocity = 0;

      // Create explosion
      newState.explosions.push(createExplosion(car.position));
    }
  }

  // Update sparks
  newState.sparks = newState.sparks
    .map(spark => ({
      ...spark,
      position: vec.add(spark.position, vec.mul(spark.velocity, deltaTime / 16)),
      velocity: vec.mul(spark.velocity, 0.95),
      life: spark.life - deltaTime,
    }))
    .filter(spark => spark.life > 0);

  // Update tire marks (fade out)
  const markMaxAge = 10000;
  newState.tireMarks = newState.tireMarks
    .map(mark => ({
      ...mark,
      opacity: Math.max(0, 1 - (Date.now() - mark.timestamp) / markMaxAge),
    }))
    .filter(mark => mark.opacity > 0);

  // Limit tire marks
  if (newState.tireMarks.length > 200) {
    newState.tireMarks = newState.tireMarks.slice(-200);
  }

  // Update explosions
  newState.explosions = newState.explosions.filter(exp => Date.now() - exp.startTime < exp.duration);

  // Check for game over
  const aliveCars = newState.cars.filter(c => c.isAlive);
  if (aliveCars.length <= 1) {
    newState.gamePhase = "gameover";
    newState.winner = aliveCars.length === 1 ? aliveCars[0] : null;
  }

  return newState;
}

// Start a new game
export function startGame(): GameState {
  const newState = createInitialGameState();
  newState.gamePhase = "playing";
  return newState;
}

// Restart the game
export function restartGame(): GameState {
  const state = createInitialGameState();
  state.gamePhase = "playing";
  return state;
}
