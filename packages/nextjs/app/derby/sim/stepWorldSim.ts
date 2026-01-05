// stepWorldSim - Pure deterministic simulation step
// This function advances the world simulation by dtMs milliseconds.
// It does NOT:
// - Use Date.now() or any wall-clock time
// - Create VFX objects (sparks, explosions, damage numbers)
// - Use Math.random() (except for deterministic seeded RNG if needed)
// - Perform React immutability copies
//
// It DOES:
// - Apply car inputs (throttle/steer)
// - Integrate physics (position/rotation/velocity)
// - Resolve car-car collisions
// - Resolve wall collisions
// - Apply damage and deaths
// - Emit lightweight SimEvents for the effects layer
import { getRealSpeed, physicsEngine } from "../physics/PhysicsEngine";
import {
  CAR_CONFIG,
  CarDeathEvent,
  CarImpactEvent,
  SimEvent,
  TireMarkEvent,
  WallImpactEvent,
  WorldSim,
} from "./typesSim";

/**
 * Advance the world simulation by dtMs milliseconds.
 * Mutates the worldSim in place for performance.
 * Returns an array of SimEvents for the effects layer.
 */
export function stepWorldSim(world: WorldSim, dtMs: number): SimEvent[] {
  if (world.gamePhase !== "playing") {
    return [];
  }

  const events: SimEvent[] = [];

  // Accumulate game time
  world.gameTime += dtMs;

  // Phase 1: Apply inputs and integrate physics for each car
  for (const car of world.cars) {
    if (!car.isAlive) continue;

    // Save lastPosition for stuck detection (before position updates)
    car.lastPosition.x = car.position.x;
    car.lastPosition.y = car.position.y;

    // Apply control inputs (throttle/steer → velocity changes)
    physicsEngine.applyControls(car, car.input, dtMs);

    // Integrate physics (velocity → position, apply friction)
    physicsEngine.integrateCar(car, dtMs);

    // Check for tire mark emission (high speed + turning)
    // Use centralized real speed function
    const realSpeed = getRealSpeed(car, dtMs);
    if (realSpeed > 4 && Math.abs(car.angularVelocity) > 0.05) {
      // Deterministic: emit based on state, not random
      // We use a simple modulo check on position for determinism
      const posHash = Math.floor(car.position.x * 0.1) + Math.floor(car.position.y * 0.1);
      if (posHash % 3 === 0) {
        events.push({
          type: "tire_mark",
          carId: car.id,
          position: { x: car.position.x, y: car.position.y },
          rotation: car.rotation,
        } as TireMarkEvent);
      }
    }
  }

  // Phase 2: Resolve car-car collisions
  for (let i = 0; i < world.cars.length; i++) {
    for (let j = i + 1; j < world.cars.length; j++) {
      const carA = world.cars[i];
      const carB = world.cars[j];

      if (!carA.isAlive || !carB.isAlive) continue;

      const collision = physicsEngine.checkCarCollision(carA, carB);
      if (collision) {
        const { damageA, damageB } = physicsEngine.resolveCarCollision(
          collision,
          world.gameTime,
          world.collisionCooldowns,
          dtMs,
        );

        // Apply damage
        if (damageA > 0 || damageB > 0) {
          carA.health -= damageA;
          carB.health -= damageB;

          // Track damage dealt
          carB.damageDealt += damageA;
          carA.damageDealt += damageB;

          // Emit impact event
          events.push({
            type: "car_impact",
            carAId: carA.id,
            carBId: carB.id,
            damageA,
            damageB,
            impactSpeed: collision.impactSpeed,
            contactPoint: { x: collision.contactPoint.x, y: collision.contactPoint.y },
          } as CarImpactEvent);
        }
      }
    }
  }

  // Phase 3: Resolve wall collisions
  for (const car of world.cars) {
    if (!car.isAlive) continue;

    const wallCollision = physicsEngine.checkWallCollision(car, dtMs);
    if (wallCollision) {
      let damage = physicsEngine.resolveWallCollision(wallCollision, dtMs);

      // Check if pinned against wall
      if (physicsEngine.isCarPinned(car, world.cars, wallCollision, dtMs)) {
        damage *= CAR_CONFIG.pinnedDamageMultiplier;
      }

      if (damage > 0) {
        car.health -= damage;

        // Emit wall impact event
        events.push({
          type: "wall_impact",
          carId: car.id,
          damage,
          impactSpeed: wallCollision.impactSpeed,
          contactPoint: { x: wallCollision.contactPoint.x, y: wallCollision.contactPoint.y },
        } as WallImpactEvent);
      }
    }
  }

  // Phase 4: Check for car deaths
  for (const car of world.cars) {
    if (car.isAlive && car.health <= 0) {
      car.isAlive = false;
      car.health = 0;
      car.velocity = { x: 0, y: 0 };
      car.angularVelocity = 0;

      // Emit death event
      events.push({
        type: "car_death",
        carId: car.id,
        position: { x: car.position.x, y: car.position.y },
      } as CarDeathEvent);
    }
  }

  // Phase 5: Check for game over
  const aliveCars = world.cars.filter(c => c.isAlive);
  if (aliveCars.length <= 1) {
    world.gamePhase = "gameover";
    world.winner = aliveCars.length === 1 ? aliveCars[0] : null;
  }

  return events;
}

/**
 * Deep clone a WorldSim for rollout simulation.
 * Use this to create an isolated copy before running simulated futures.
 */
export function cloneWorldSim(world: WorldSim): WorldSim {
  return {
    cars: world.cars.map(car => ({
      ...car,
      position: { ...car.position },
      velocity: { ...car.velocity },
      lastPosition: { ...car.lastPosition },
      input: { ...car.input },
    })),
    gamePhase: world.gamePhase,
    winner: world.winner ? { ...world.winner } : null,
    gameTime: world.gameTime,
    collisionCooldowns: { ...world.collisionCooldowns },
  };
}

/**
 * Run multiple simulation steps (for rollout planning).
 * Returns the final world state and all accumulated events.
 */
export function rolloutSim(world: WorldSim, steps: number, fixedDtMs: number): { world: WorldSim; events: SimEvent[] } {
  const clonedWorld = cloneWorldSim(world);
  const allEvents: SimEvent[] = [];

  for (let i = 0; i < steps; i++) {
    const stepEvents = stepWorldSim(clonedWorld, fixedDtMs);
    allEvents.push(...stepEvents);

    // Early exit if game is over
    if (clonedWorld.gamePhase !== "playing") {
      break;
    }
  }

  return { world: clonedWorld, events: allEvents };
}
