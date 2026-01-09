// stepEffects - Updates visual effects state based on sim events
// This layer consumes SimEvents and creates/updates VFX objects.
// It uses ageMs counters instead of Date.now() for timing.
// Math.random() is used here for VFX variety (not in sim layer).
import { vec } from "../physics/PhysicsEngine";
import { CarDeathEvent, CarImpactEvent, CarSim, SimEvent, TireMarkEvent, WallImpactEvent } from "../sim/typesSim";
import { DamageNumber, EFFECTS_CONFIG, EffectsState, Spark, TireMark } from "./effectsTypes";

let effectIdCounter = 0;
const generateEffectId = () => `effect-${++effectIdCounter}`;

// ============ Effect Creators ============

function createSparks(position: { x: number; y: number }, count: number): Spark[] {
  const sparks: Spark[] = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    // Keep sparks near the impact point (roughly 50–75px travel) instead of flying off-screen.
    // With dt=8ms, position step uses (dt/16) scaling and we apply per-tick damping below.
    const speed = 12 + Math.random() * 6; // 12..18
    const life = 140 + Math.random() * 60; // 140..200ms
    sparks.push({
      id: generateEffectId(),
      position: { x: position.x, y: position.y },
      velocity: {
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed,
      },
      life,
      maxLife: life,
      color: EFFECTS_CONFIG.sparkColors[Math.floor(Math.random() * EFFECTS_CONFIG.sparkColors.length)],
    });
  }
  return sparks;
}

function createTireMark(position: { x: number; y: number }, rotation: number): TireMark {
  return {
    id: generateEffectId(),
    position: { x: position.x, y: position.y },
    rotation,
    opacity: 1,
    ageMs: 0,
  };
}

function createDamageNumber(position: { x: number; y: number }, damage: number, color: string): DamageNumber {
  return {
    id: generateEffectId(),
    position: {
      x: position.x + (Math.random() - 0.5) * 20,
      y: position.y - 20,
    },
    damage: Math.round(damage),
    color,
    life: 1000,
    maxLife: 1000,
  };
}

// ============ Event Handlers ============

function handleCarImpact(event: CarImpactEvent, effects: EffectsState, getCarColor: (carId: string) => string): void {
  // Create damage numbers
  if (event.damageA >= 1) {
    // Position slightly offset for visibility
    effects.damageNumbers.push(
      createDamageNumber(
        { x: event.contactPoint.x - 15, y: event.contactPoint.y },
        event.damageA,
        getCarColor(event.carAId) ?? "#ff4444",
      ),
    );
  }
  if (event.damageB >= 1) {
    effects.damageNumbers.push(
      createDamageNumber(
        { x: event.contactPoint.x + 15, y: event.contactPoint.y },
        event.damageB,
        getCarColor(event.carBId) ?? "#ff4444",
      ),
    );
  }

  // Create sparks based on impact speed
  const sparkCount = Math.min(15, Math.floor(event.impactSpeed / 20));
  if (sparkCount > 0) {
    effects.sparks.push(...createSparks(event.contactPoint, sparkCount));
  }
}

function handleWallImpact(event: WallImpactEvent, effects: EffectsState, getCarColor: (carId: string) => string): void {
  // Create damage number for wall hits
  if (event.damage >= 1) {
    effects.damageNumbers.push(
      createDamageNumber(event.contactPoint, event.damage, getCarColor(event.carId) ?? "#ffaa44"),
    );
  }

  // Create sparks
  const sparkCount = Math.min(8, Math.floor(event.damage / 2));
  if (sparkCount > 0) {
    effects.sparks.push(...createSparks(event.contactPoint, sparkCount));
  }
}

function handleCarDeath(event: CarDeathEvent, effects: EffectsState): void {
  // Intentionally no "death explosion" here.
  // Dead car VFX is handled by `CarEffects` (animated fire/smoke) so we don't double-render fire.
  void event;
  void effects;
}

function handleTireMark(event: TireMarkEvent, effects: EffectsState): void {
  // Only add if random check passes (for visual variety)
  if (Math.random() < 0.3) {
    effects.tireMarks.push(createTireMark(event.position, event.rotation));
  }
}

// ============ Main Step Function ============

/**
 * Update effects state with new events and advance existing effects.
 * This function mutates the effects state in place.
 *
 * @param effects - The current effects state (will be mutated)
 * @param events - New simulation events to process
 * @param dtMs - Delta time in milliseconds
 * @param cars - Optional cars list, used to color effects (e.g. damage numbers) by car color
 */
export function stepEffects(effects: EffectsState, events: SimEvent[], dtMs: number, cars?: CarSim[]): void {
  const carColorById = new Map<string, string>();
  if (cars) {
    for (const car of cars) carColorById.set(car.id, car.color);
  }
  const getCarColor = (carId: string) => carColorById.get(carId) ?? "#ff4444";

  // Process new events
  for (const event of events) {
    switch (event.type) {
      case "car_impact":
        handleCarImpact(event, effects, getCarColor);
        break;
      case "wall_impact":
        handleWallImpact(event, effects, getCarColor);
        break;
      case "car_death":
        handleCarDeath(event, effects);
        break;
      case "tire_mark":
        handleTireMark(event, effects);
        break;
    }
  }

  // Update sparks
  for (let i = effects.sparks.length - 1; i >= 0; i--) {
    const spark = effects.sparks[i];
    spark.position = vec.add(spark.position, vec.mul(spark.velocity, dtMs / 16));
    // Faster damping keeps sparks from traveling too far.
    spark.velocity = vec.mul(spark.velocity, 0.9);
    spark.life -= dtMs;

    if (spark.life <= 0) {
      effects.sparks.splice(i, 1);
    }
  }

  // Update tire marks (fade based on age)
  for (let i = effects.tireMarks.length - 1; i >= 0; i--) {
    const mark = effects.tireMarks[i];
    mark.ageMs += dtMs;
    mark.opacity = Math.max(0, 1 - mark.ageMs / EFFECTS_CONFIG.tireMarkMaxAge);

    if (mark.opacity <= 0) {
      effects.tireMarks.splice(i, 1);
    }
  }

  // Limit tire marks
  if (effects.tireMarks.length > EFFECTS_CONFIG.maxTireMarks) {
    effects.tireMarks.splice(0, effects.tireMarks.length - EFFECTS_CONFIG.maxTireMarks);
  }

  // Update explosions
  for (let i = effects.explosions.length - 1; i >= 0; i--) {
    const exp = effects.explosions[i];
    exp.ageMs += dtMs;

    if (exp.ageMs >= exp.duration) {
      effects.explosions.splice(i, 1);
    }
  }

  // Update damage numbers (float up and fade)
  for (let i = effects.damageNumbers.length - 1; i >= 0; i--) {
    const dmg = effects.damageNumbers[i];
    dmg.position.y -= dtMs * 0.05; // Float up
    dmg.life -= dtMs;

    if (dmg.life <= 0) {
      effects.damageNumbers.splice(i, 1);
    }
  }
}

/**
 * Create a shallow copy of effects state for React rendering.
 * This creates new arrays but shares the individual effect objects.
 */
export function snapshotEffects(effects: EffectsState): EffectsState {
  return {
    tireMarks: [...effects.tireMarks],
    sparks: [...effects.sparks],
    smokeParticles: [...effects.smokeParticles],
    explosions: [...effects.explosions],
    damageNumbers: [...effects.damageNumbers],
  };
}
