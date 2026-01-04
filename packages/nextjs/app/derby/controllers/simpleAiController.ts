// Simple AI Controller - Action Sampling + Scoring
// Every tick: generate candidate controls, predict outcomes, score, pick best.
// No state machines, no rollouts, just score-based decision making.
import { getCarForward, vec } from "../physics/PhysicsEngine";
import type { CarSim, WorldSim } from "../sim/typesSim";
import { ARENA_CONFIG } from "../sim/typesSim";
import type { CarController, Controls } from "./controllerTypes";

// ============ Tuning Constants ============

const AI_TUNING = {
  // Prediction
  lookaheadSec: 0.35, // How far ahead to predict (seconds)

  // Wall avoidance (most important - keeps cars alive)
  // NOTE: These are EDGE-to-wall distances (accounts for car size ~28px radius)
  wallCriticalDist: 10, // Huge penalty below this (almost touching)
  wallDangerDist: 35, // Big penalty below this
  wallCautionDist: 65, // Mild penalty below this
  cornerPenaltyThreshold: 50, // Extra penalty when both dx AND dy are small

  // Movement rewards
  speedRewardFactor: 2.5, // Reward per unit speed
  lowSpeedThreshold: 25, // Below this, penalize
  lowSpeedPenaltyFactor: 25, // Penalty per unit below threshold
  reversePenalty: 400, // Discourage reverse unless stuck

  // Attack scoring
  attackDistanceMax: 350, // Max distance to consider attacking
  attackClosingBonus: 25, // Bonus per unit closing speed
  attackApproachBonus: 350, // Bonus for being aimed at target

  // Defense scoring
  defenseDistanceMax: 280, // Max distance to worry about threats
  defenseClosingPenalty: 30, // Penalty per unit of enemy closing speed
  defenseApproachPenalty: 280, // Penalty when enemy is aimed at us
  defenseWallMultiplier: 6, // Wall proximity makes threats worse

  // Stuck detection
  stuckDistanceThreshold: 2.0, // Movement less than this = possibly stuck
  stuckSpeedThreshold: 18, // Speed below this when stuck = confirmed stuck
};

// ============ Arena Bounds ============

const innerLeft = ARENA_CONFIG.wallThickness;
const innerRight = ARENA_CONFIG.width - ARENA_CONFIG.wallThickness;
const innerTop = ARENA_CONFIG.wallThickness;
const innerBottom = ARENA_CONFIG.height - ARENA_CONFIG.wallThickness;

// ============ Helper Functions ============

interface Vector2D {
  x: number;
  y: number;
}

interface PredictedState {
  pos: Vector2D;
  vel: Vector2D;
  speed: number;
  rotation: number;
}

// Car dimensions for corner calculations
const CAR_HALF_WIDTH = 25; // width/2
const CAR_HALF_HEIGHT = 14; // height/2

/**
 * Get the 4 corners of a car given its center position and rotation
 */
function getCarCorners(pos: Vector2D, rotation: number): Vector2D[] {
  const corners = [
    { x: CAR_HALF_WIDTH, y: -CAR_HALF_HEIGHT }, // front-right
    { x: CAR_HALF_WIDTH, y: CAR_HALF_HEIGHT }, // front-left
    { x: -CAR_HALF_WIDTH, y: CAR_HALF_HEIGHT }, // back-left
    { x: -CAR_HALF_WIDTH, y: -CAR_HALF_HEIGHT }, // back-right
  ];
  return corners.map(c => vec.add(pos, vec.rotate(c, rotation)));
}

/**
 * Distance from a single point to the nearest wall
 */
function pointToWallDist(p: Vector2D): number {
  const dx = Math.min(p.x - innerLeft, innerRight - p.x);
  const dy = Math.min(p.y - innerTop, innerBottom - p.y);
  return Math.min(dx, dy);
}

/**
 * Distance from a car's nearest CORNER to the nearest wall.
 * This matches how the physics engine does wall collision detection.
 */
function distToWall(pos: Vector2D, rotation: number): number {
  const corners = getCarCorners(pos, rotation);
  let minDist = Infinity;
  for (const corner of corners) {
    const d = pointToWallDist(corner);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/**
 * Cheap kinematic prediction of where a car will be after tSec seconds
 * given candidate controls. Doesn't need to be physics-perfect, just good
 * enough to rank candidate actions.
 */
function predictState(car: CarSim, controls: Controls, tSec: number): PredictedState {
  const speed = vec.length(car.velocity);
  const forward = getCarForward(car);

  // Approximate steering: turn rate scales with speed (slow cars can't turn as fast)
  const turnRate = Math.min(1.2, speed / 30) * car.cornering * 0.14;
  const frames = tSec * 60; // Approximate frame count
  const deltaRotation = controls.steer * turnRate * frames;

  // Predicted rotation
  const newRotation = car.rotation + deltaRotation;

  // Predict new heading
  const newHeading = vec.normalize(vec.rotate(forward, deltaRotation));

  // Approximate acceleration effect
  const accelMagnitude = controls.throttle * car.acceleration * car.traction * 1.2;
  let newSpeed = speed + accelMagnitude * frames;
  newSpeed = Math.max(0, Math.min(car.maxSpeed, newSpeed));

  // Predicted velocity and position
  const vel = vec.mul(newHeading, newSpeed);
  // Apply slight damping to match friction behavior
  const pos = vec.add(car.position, vec.mul(vel, tSec * 0.88));

  return { pos, vel, speed: newSpeed, rotation: newRotation };
}

/**
 * Score wall/corner avoidance. Returns negative values (penalties).
 * This is the most critical scoring - keeps cars from suiciding into walls.
 */
function scoreWallSafety(predicted: PredictedState): number {
  const wallDist = distToWall(predicted.pos, predicted.rotation);
  let score = 0;

  // Tiered penalties - critical zone is essentially forbidden
  if (wallDist < AI_TUNING.wallCriticalDist) {
    score -= 8000 + (AI_TUNING.wallCriticalDist - wallDist) * 200;
  } else if (wallDist < AI_TUNING.wallDangerDist) {
    score -= (AI_TUNING.wallDangerDist - wallDist) * 60;
  } else if (wallDist < AI_TUNING.wallCautionDist) {
    score -= (AI_TUNING.wallCautionDist - wallDist) * 8;
  }

  // Extra corner penalty (near two walls at once)
  const dx = Math.min(predicted.pos.x - innerLeft, innerRight - predicted.pos.x);
  const dy = Math.min(predicted.pos.y - innerTop, innerBottom - predicted.pos.y);
  if (dx < AI_TUNING.cornerPenaltyThreshold && dy < AI_TUNING.cornerPenaltyThreshold) {
    score -= 1500;
  }

  return score;
}

/**
 * Score momentum - reward speed, penalize being slow or reversing
 */
function scoreMomentum(predictedSpeed: number, throttle: number): number {
  let score = 0;

  // Reward speed
  score += predictedSpeed * AI_TUNING.speedRewardFactor;

  // Penalize being slow
  if (predictedSpeed < AI_TUNING.lowSpeedThreshold) {
    score -= (AI_TUNING.lowSpeedThreshold - predictedSpeed) * AI_TUNING.lowSpeedPenaltyFactor;
  }

  // Penalize reverse (unless we're stuck, handled separately)
  if (throttle < 0) {
    score -= AI_TUNING.reversePenalty;
  }

  return score;
}

/**
 * Score attack opportunities against all opponents.
 * Returns positive values for good attack setups.
 */
function scoreAttack(self: CarSim, selfPredicted: PredictedState, opponents: CarSim[], tSec: number): number {
  let bestAttackScore = 0;

  for (const opp of opponents) {
    if (!opp.isAlive || opp.id === self.id) continue;

    // Predict opponent coasting (conservative estimate)
    const oppPredicted = predictState(opp, { throttle: 0, steer: 0 }, tSec);

    const toOpp = vec.sub(oppPredicted.pos, selfPredicted.pos);
    const dist = vec.length(toOpp);
    if (dist < 1 || dist > AI_TUNING.attackDistanceMax) continue;

    const dirToOpp = vec.mul(toOpp, 1 / dist);

    // Closing speed: positive means we're approaching
    const relVel = vec.sub(selfPredicted.vel, oppPredicted.vel);
    const closingSpeed = vec.dot(relVel, dirToOpp);

    // Approach angle: how well our velocity is aimed at them (1 = perfect)
    const selfDir = vec.normalize(selfPredicted.vel);
    const approachQuality = Math.max(0, vec.dot(selfDir, dirToOpp));

    // Attack score: close + closing fast + aimed well
    const distanceBonus = Math.max(0, AI_TUNING.attackDistanceMax - dist) * 1.5;
    const closingBonus = Math.max(0, closingSpeed) * AI_TUNING.attackClosingBonus;
    const approachBonus = approachQuality * AI_TUNING.attackApproachBonus;

    const attackScore = distanceBonus + closingBonus + approachBonus;
    bestAttackScore = Math.max(bestAttackScore, attackScore);
  }

  return bestAttackScore;
}

/**
 * Score defense - penalize situations where opponents threaten us.
 * Returns negative values (penalties) for dangerous situations.
 */
function scoreDefense(self: CarSim, selfPredicted: PredictedState, opponents: CarSim[], tSec: number): number {
  let totalDanger = 0;
  const wallDist = distToWall(selfPredicted.pos, selfPredicted.rotation);

  for (const opp of opponents) {
    if (!opp.isAlive || opp.id === self.id) continue;

    // Assume opponent might charge at us
    const oppPredicted = predictState(opp, { throttle: 1, steer: 0 }, tSec);

    const toUs = vec.sub(selfPredicted.pos, oppPredicted.pos);
    const dist = vec.length(toUs);
    if (dist < 1 || dist > AI_TUNING.defenseDistanceMax) continue;

    const dirToUs = vec.mul(toUs, 1 / dist);

    // Their closing speed on us
    const theirVel = vec.sub(oppPredicted.vel, selfPredicted.vel);
    const theirClosing = vec.dot(theirVel, dirToUs);

    // How well they're aimed at us
    const theirDir = vec.normalize(oppPredicted.vel);
    const theirApproach = Math.max(0, vec.dot(theirDir, dirToUs));

    // Danger from this opponent
    const distanceThreat = Math.max(0, AI_TUNING.defenseDistanceMax - dist) * 1.2;
    const closingThreat = Math.max(0, theirClosing) * AI_TUNING.defenseClosingPenalty;
    const approachThreat = theirApproach * AI_TUNING.defenseApproachPenalty;

    let danger = distanceThreat + closingThreat + approachThreat;

    // Being near wall while threatened is much worse
    if (wallDist < AI_TUNING.wallCautionDist) {
      danger += (AI_TUNING.wallCautionDist - wallDist) * AI_TUNING.defenseWallMultiplier;
    }

    totalDanger += danger;
  }

  return -totalDanger;
}

/**
 * Score a candidate control action
 */
function scoreCandidate(self: CarSim, cars: CarSim[], controls: Controls): number {
  const predicted = predictState(self, controls, AI_TUNING.lookaheadSec);

  const wallScore = scoreWallSafety(predicted);
  const momentumScore = scoreMomentum(predicted.speed, controls.throttle);
  const attackScore = scoreAttack(self, predicted, cars, AI_TUNING.lookaheadSec);
  const defenseScore = scoreDefense(self, predicted, cars, AI_TUNING.lookaheadSec);

  return wallScore + momentumScore + attackScore + defenseScore;
}

/**
 * Check if car appears stuck
 */
function isStuck(car: CarSim): boolean {
  const movement = vec.distance(car.position, car.lastPosition);
  const speed = vec.length(car.velocity);
  return movement < AI_TUNING.stuckDistanceThreshold && speed < AI_TUNING.stuckSpeedThreshold;
}

/**
 * Generate candidate control actions
 */
function generateCandidates(stuck: boolean): Controls[] {
  const candidates: Controls[] = [];

  // Standard grid of steer/throttle combinations
  const steerValues = [-1, -0.6, -0.3, 0, 0.3, 0.6, 1];
  const throttleValues = [0.5, 0.8, 1.0];

  for (const steer of steerValues) {
    for (const throttle of throttleValues) {
      candidates.push({ steer, throttle });
    }
  }

  // Add hard evasive maneuvers
  candidates.push({ steer: -1, throttle: 1.0 });
  candidates.push({ steer: 1, throttle: 1.0 });

  // Add recovery action only when stuck
  if (stuck) {
    candidates.push({ steer: 0, throttle: -0.7 });
    candidates.push({ steer: -0.5, throttle: -0.5 });
    candidates.push({ steer: 0.5, throttle: -0.5 });
  }

  return candidates;
}

/**
 * Get the best controls for a single car
 */
function getBestControls(self: CarSim, cars: CarSim[]): Controls {
  if (!self.isAlive) {
    return { throttle: 0, steer: 0 };
  }

  const stuck = isStuck(self);
  const candidates = generateCandidates(stuck);

  let best = candidates[0];
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    const score = scoreCandidate(self, cars, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

// ============ Controller Class ============

/**
 * Simple AI Controller using action sampling and scoring.
 * Each tick, evaluates candidate controls and picks the best scoring one.
 */
export class SimpleAiController implements CarController {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(world: WorldSim, dtMs: number, nowMs: number): void {
    if (world.gamePhase !== "playing") return;

    for (const car of world.cars) {
      if (!car.isAlive) continue;

      const controls = getBestControls(car, world.cars);
      car.input = controls;
    }
  }
}

// Also export standalone function for testing/direct use
export { getBestControls, scoreCandidate };
