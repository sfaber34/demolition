// Smart AI Driver System for Demolition Derby
import { getCarCorners, getCarForward, vec } from "./physics";
import { AI_CONFIG, ARENA_CONFIG, Car, Vector2D } from "./types";

// Speed requirements for damage - adjusted for realistic car speeds
// With maxSpeed ~120 and 0-60 in ~8 seconds, these are realistic thresholds
const MIN_DAMAGE_SPEED = 10; // Low threshold - most moving collisions count
const MIN_RUN_UP_DISTANCE = 150; // Need more distance to build speed with slower acceleration

// Get health percentage
function getHealthPercent(car: Car): number {
  return (car.health / car.maxHealth) * 100;
}

// Check if car should be defensive based on health
function shouldBeDefensive(car: Car): boolean {
  const healthPct = getHealthPercent(car);
  return healthPct < (AI_CONFIG.lowHealthThreshold || 35);
}

// Find the best target to attack
function selectTarget(self: Car, cars: Car[]): Car | null {
  let bestTarget: Car | null = null;
  let bestScore = -Infinity;

  const isDefensive = shouldBeDefensive(self);

  for (const other of cars) {
    if (other.id === self.id || !other.isAlive) continue;

    const distance = vec.distance(self.position, other.position);
    const otherSpeed = vec.length(other.velocity);
    const otherForward = getCarForward(other);
    const otherHealthPct = getHealthPercent(other);

    // Calculate angle to target's side/rear
    const toTarget = vec.normalize(vec.sub(other.position, self.position));
    const targetAngle = Math.abs(vec.dot(otherForward, toTarget));

    // Score factors - AGGRESSIVE target selection
    // PRIORITY: Further targets = more run-up = higher speed = more damage!
    let score = 0;

    // Distance score - PREFER FURTHEST TARGETS for max speed rams!
    // More distance = more time to accelerate = bigger hits
    score += distance * 0.15; // Strongly prefer far targets

    // Extra bonus for very far targets (cross-arena rams)
    if (distance > 400) score += 40;
    else if (distance > 300) score += 20;

    // Vulnerability score (side/rear hits are much better)
    score += (1 - targetAngle) * 15;

    // Speed score (stationary targets easier to hit hard)
    score += (1 - otherSpeed / 160) * 10;

    // Health score - prioritize finishing off damaged cars
    if (otherHealthPct < 30) {
      score += 25; // High priority to finish them
    } else if (otherHealthPct < 50) {
      score += 10;
    }

    // When low health, just hit ANYTHING nearby
    if (isDefensive) {
      score += 30; // Boost all targets
    }

    // Head-on collisions are GREAT - mutual destruction is acceptable
    if (other.targetId === self.id) {
      score += 15; // BONUS for mutual rams!
    }

    if (score > bestScore) {
      bestScore = score;
      bestTarget = other;
    }
  }

  return bestTarget;
}

// Calculate wall avoidance force
function getWallAvoidance(car: Car): Vector2D {
  const avoidance = { x: 0, y: 0 };
  const margin = AI_CONFIG.wallAvoidDistance;
  const innerLeft = ARENA_CONFIG.wallThickness + margin;
  const innerRight = ARENA_CONFIG.width - ARENA_CONFIG.wallThickness - margin;
  const innerTop = ARENA_CONFIG.wallThickness + margin;
  const innerBottom = ARENA_CONFIG.height - ARENA_CONFIG.wallThickness - margin;

  const corners = getCarCorners(car);
  const speed = vec.length(car.velocity);

  // Predictive avoidance: check where we'll be
  const lookAhead = Math.min(speed * 0.5, 100);
  const futurePos = vec.add(car.position, vec.mul(vec.normalize(car.velocity), lookAhead));

  // Multi-layer avoidance with exponential falloff
  const checkPositions = [car.position, futurePos, ...corners];

  for (const pos of checkPositions) {
    // Left wall
    if (pos.x < innerLeft) {
      const dist = Math.max(1, pos.x - ARENA_CONFIG.wallThickness);
      avoidance.x += AI_CONFIG.wallAvoidStrength * (margin / dist);
    }
    // Right wall
    if (pos.x > innerRight) {
      const dist = Math.max(1, ARENA_CONFIG.width - ARENA_CONFIG.wallThickness - pos.x);
      avoidance.x -= AI_CONFIG.wallAvoidStrength * (margin / dist);
    }
    // Top wall
    if (pos.y < innerTop) {
      const dist = Math.max(1, pos.y - ARENA_CONFIG.wallThickness);
      avoidance.y += AI_CONFIG.wallAvoidStrength * (margin / dist);
    }
    // Bottom wall
    if (pos.y > innerBottom) {
      const dist = Math.max(1, ARENA_CONFIG.height - ARENA_CONFIG.wallThickness - pos.y);
      avoidance.y -= AI_CONFIG.wallAvoidStrength * (margin / dist);
    }
  }

  return avoidance;
}

// Update AI state machine
export function updateAI(car: Car, cars: Car[], deltaTime: number): void {
  if (!car.isAlive) return;

  const now = Date.now();
  const speed = vec.length(car.velocity);
  const forward = getCarForward(car);
  const isLowHealth = shouldBeDefensive(car);

  // Count alive cars
  const aliveCars = cars.filter(c => c.isAlive);
  const onlyTwoLeft = aliveCars.length === 2;

  // FINAL SHOWDOWN - When only 2 cars remain, ALWAYS attack!
  if (onlyTwoLeft) {
    const opponent = aliveCars.find(c => c.id !== car.id);
    if (opponent) {
      car.targetId = opponent.id;
      car.aiState = "attacking";
    }
  }

  // MATCH START - Everyone attacks immediately!
  // Target the FURTHEST car for maximum speed impact!
  if (!car.targetId && car.aiState === "seeking") {
    let furthestDist = 0;
    let furthestId: string | null = null;
    for (const other of cars) {
      if (other.id === car.id || !other.isAlive) continue;
      const dist = vec.distance(car.position, other.position);
      if (dist > furthestDist) {
        furthestDist = dist;
        furthestId = other.id;
      }
    }
    if (furthestId) {
      car.targetId = furthestId;
      car.aiState = "attacking"; // Full speed ahead!
    }
  }

  // LOW HEALTH = KAMIKAZE MODE
  if (isLowHealth && car.aiState !== "attacking") {
    // Find nearest alive enemy and attack
    let nearestDist = Infinity;
    let nearestId: string | null = null;
    for (const other of cars) {
      if (other.id === car.id || !other.isAlive) continue;
      const dist = vec.distance(car.position, other.position);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestId = other.id;
      }
    }
    if (nearestId) {
      car.targetId = nearestId;
      car.aiState = "attacking"; // Always attack when low health
    }
  }

  // Track if stuck
  const distMoved = vec.distance(car.position, car.lastPosition);
  if (distMoved < AI_CONFIG.stuckThreshold) {
    car.stuckTimer += deltaTime;
  } else {
    car.stuckTimer = 0;
  }
  car.lastPosition = { ...car.position };

  // State machine transitions
  switch (car.aiState) {
    case "disengaging":
      // Quick disengage - get back to fighting fast!
      // Low health = even faster recovery (desperation mode)
      const disengageTime = isLowHealth ? AI_CONFIG.disengageTime * 0.5 : AI_CONFIG.disengageTime;
      if (now - car.lastImpactTime > disengageTime) {
        car.aiState = "seeking";
      }
      break;

    case "recovering":
      // Always go back to seeking after recovery - stay aggressive!
      if (now - car.lastImpactTime > AI_CONFIG.recoveryTime) {
        car.aiState = "seeking";
      }
      break;

    case "seeking":
      // Select a target and attack immediately
      const target = selectTarget(car, cars);
      if (target) {
        car.targetId = target.id;
        car.aiState = "attacking"; // Attack right away, don't circle
        car.stateTimer = 0;
      }
      break;

    case "circling":
      // Smart positioning to maximize attack speed
      const circleTarget = cars.find(c => c.id === car.targetId);
      if (!circleTarget || !circleTarget.isAlive) {
        car.aiState = "seeking";
        car.targetId = null;
        break;
      }

      const toTargetCircle = vec.sub(circleTarget.position, car.position);
      const distToCircleTarget = vec.length(toTargetCircle);
      const toTargetNormCircle = vec.normalize(toTargetCircle);
      const alignment = vec.dot(forward, toTargetNormCircle);
      const hasKillingSpeedCircle = speed >= MIN_DAMAGE_SPEED;
      const hasGoodDistance = distToCircleTarget >= MIN_RUN_UP_DISTANCE;

      car.stateTimer += deltaTime;

      // Attack when we have good conditions:
      // 1. Good distance + facing target (will build speed during charge), OR
      // 2. Already have killing speed + facing target, OR
      // 3. Been trying too long
      const readyToAttack =
        (hasGoodDistance && alignment > 0.6) || (hasKillingSpeedCircle && alignment > 0.5) || car.stateTimer > 2500;

      if (readyToAttack) {
        car.aiState = "attacking";
        car.stateTimer = 0;
      }
      break;

    case "attacking":
      // Check if target is still valid
      const attackTarget = cars.find(c => c.id === car.targetId);
      if (!attackTarget || !attackTarget.isAlive) {
        // Find new target immediately
        car.aiState = "seeking";
        car.targetId = null;
        break;
      }

      const distToAttackTarget = vec.distance(car.position, attackTarget.position);
      const hasKillingSpeedAttack = speed >= MIN_DAMAGE_SPEED;

      // If we passed the target, turn around and attack again
      if (distToAttackTarget > AI_CONFIG.attackDistance * 1.5 && car.stateTimer > 500) {
        car.aiState = "seeking"; // Find new target or same target from new angle
        car.stateTimer = 0;
      }

      // If close to target without killing speed, back up to build run-up
      if (distToAttackTarget < 150 && !hasKillingSpeedAttack && car.stateTimer > 400) {
        car.aiState = "disengaging"; // Back up to get speed!
        car.lastImpactTime = now;
      }

      car.stateTimer += deltaTime;
      break;

    case "evading":
      // Quickly get back to attacking - evading is only temporary
      car.stateTimer += deltaTime;
      if (car.stateTimer > 500) {
        // Only evade for 500ms max
        car.aiState = "seeking";
        car.stateTimer = 0;
      }
      break;
  }

  // If stuck, find a new approach (but low health cars just keep attacking)
  if (car.stuckTimer > AI_CONFIG.stuckTime && !isLowHealth) {
    car.aiState = "seeking";
    car.targetId = null;
    car.stuckTimer = 0;
  }

  // Low health and stuck? Just pick nearest target and charge
  if (car.stuckTimer > AI_CONFIG.stuckTime && isLowHealth) {
    let nearestDist = Infinity;
    let nearestId: string | null = null;
    for (const other of cars) {
      if (other.id === car.id || !other.isAlive) continue;
      const dist = vec.distance(car.position, other.position);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestId = other.id;
      }
    }
    if (nearestId) {
      car.targetId = nearestId;
      car.aiState = "attacking";
    }
    car.stuckTimer = 0;
  }
}

// Get AI steering and throttle
export function getAIControls(car: Car, cars: Car[]): { throttle: number; steer: number } {
  if (!car.isAlive) return { throttle: 0, steer: 0 };

  let throttle = 0;
  let steer = 0;

  const forward = getCarForward(car);
  const speed = vec.length(car.velocity);
  const wallAvoidance = getWallAvoidance(car);

  // Get target direction based on state
  let targetDir: Vector2D = forward;
  let accelerate = true;

  switch (car.aiState) {
    case "seeking": {
      // Move towards center while looking for target
      const toCenter = vec.normalize(vec.sub({ x: ARENA_CONFIG.width / 2, y: ARENA_CONFIG.height / 2 }, car.position));
      targetDir = toCenter;
      accelerate = true;
      break;
    }

    case "circling": {
      // No more circling - just CHARGE!
      const target = cars.find(c => c.id === car.targetId);
      if (target) {
        const toTarget = vec.sub(target.position, car.position);
        const toTargetNorm = vec.normalize(toTarget);

        // Always charge directly at target!
        targetDir = toTargetNorm;
        throttle = 1.5;
        accelerate = true;
      }
      break;
    }

    case "attacking": {
      const target = cars.find(c => c.id === car.targetId);
      if (target) {
        const toTarget = vec.sub(target.position, car.position);
        const distToTarget = vec.length(toTarget);
        const toTargetNorm = vec.normalize(toTarget);

        // Check if stuck (close to target but slow)
        const isStuck = distToTarget < 100 && speed < 25;

        if (isStuck) {
          // Stuck! Reverse briefly
          targetDir = vec.mul(toTargetNorm, -1);
          throttle = -1.0;
          accelerate = false;
        } else {
          // ALWAYS ATTACK! Lead the target for better hits
          const leadTime = Math.min(0.4, distToTarget / 300);
          const predictedPos = vec.add(target.position, vec.mul(target.velocity, leadTime));
          targetDir = vec.normalize(vec.sub(predictedPos, car.position));
          accelerate = true;
          throttle = 1.5; // FULL THROTTLE ALWAYS!
        }
      } else {
        targetDir = forward;
        accelerate = true;
        throttle = 1.0;
      }
      break;
    }

    case "disengaging": {
      // Actively reverse away to get ramming distance
      const target = cars.find(c => c.id === car.targetId);
      if (target) {
        const awayFromTarget = vec.normalize(vec.sub(car.position, target.position));
        targetDir = awayFromTarget;

        // Always reverse when disengaging
        throttle = -1.0;
        accelerate = false;
      } else {
        // No target, just reverse
        targetDir = vec.mul(forward, -1);
        throttle = -1.0;
        accelerate = false;
      }
      break;
    }

    case "recovering": {
      // Just try to move away and regain control
      targetDir = forward;
      accelerate = speed < 80;
      break;
    }

    case "evading": {
      // Brief evasion - just move towards center to reposition
      const toCenter = vec.normalize(vec.sub({ x: ARENA_CONFIG.width / 2, y: ARENA_CONFIG.height / 2 }, car.position));
      targetDir = toCenter;
      accelerate = true;
      throttle = 1.0;
      break;
    }
  }

  // Apply wall avoidance - but NOT when attacking (we want to ram, not avoid!)
  const wallForce = vec.length(wallAvoidance);
  const isAttacking = car.aiState === "attacking";
  if (wallForce > 0.5 && !isAttacking) {
    const avoidWeight = Math.min(wallForce / 4, 0.5); // Reduced wall avoidance
    targetDir = vec.normalize(
      vec.add(vec.mul(targetDir, 1 - avoidWeight), vec.mul(vec.normalize(wallAvoidance), avoidWeight)),
    );
  }

  // Calculate steering
  const targetAngle = Math.atan2(targetDir.y, targetDir.x);
  let angleDiff = targetAngle - car.rotation;

  // Normalize angle difference
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

  // Check if we should reverse (target is behind us)
  if (Math.abs(angleDiff) > Math.PI * 0.7 && speed < 60) {
    // Reverse is faster
    throttle = -0.7;
    angleDiff = angleDiff > 0 ? angleDiff - Math.PI : angleDiff + Math.PI;
  } else if (accelerate && throttle >= 0) {
    throttle = Math.max(throttle, 0.9);
  }

  // Steering intensity based on angle difference
  steer = Math.max(-1, Math.min(1, angleDiff * 2));

  // Reduce steering at high speed to prevent spin-out (based on traction)
  if (speed > 120) {
    const steerReduction = Math.min(1, (speed - 120) / 100) * (1 - car.traction * 0.3);
    steer *= 1 - steerReduction * 0.5;
  }

  return { throttle, steer };
}

// Apply AI controls to car
export function applyAIControls(car: Car, controls: { throttle: number; steer: number }, deltaTime: number): void {
  if (!car.isAlive) return;

  const dt = deltaTime / 16.67;
  const forward = getCarForward(car);
  const speed = vec.length(car.velocity);

  // Apply throttle
  const accelForce = controls.throttle * car.acceleration * car.traction;

  if (controls.throttle > 0) {
    // Forward acceleration
    car.velocity = vec.add(car.velocity, vec.mul(forward, accelForce * dt));
  } else if (controls.throttle < 0) {
    // Reverse/brake
    car.velocity = vec.add(car.velocity, vec.mul(forward, accelForce * dt));
  }

  // Apply steering (more effective at speed, but affected by traction)
  const steerEffectiveness = Math.min(1, speed / 40) * car.cornering;
  car.angularVelocity += controls.steer * 0.12 * steerEffectiveness * dt;

  // Clamp angular velocity
  const maxAngularVel = 0.15 / car.traction;
  car.angularVelocity = Math.max(-maxAngularVel, Math.min(maxAngularVel, car.angularVelocity));
}

// Handle impact event (call this after collision)
export function onCarImpact(car: Car, wasAttacker: boolean): void {
  const now = Date.now();
  car.lastImpactTime = now;

  if (wasAttacker) {
    // Successful hit, disengage
    car.aiState = "disengaging";
  } else {
    // We got hit, recover
    car.aiState = "recovering";
  }
}
