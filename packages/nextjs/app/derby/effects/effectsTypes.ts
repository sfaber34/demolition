// Effects Types - VFX state that is NOT part of simulation
// All timing is based on ageMs (incremented by dt) rather than timestamps
import { Vector2D } from "../sim/typesSim";

export interface TireMark {
  id: string;
  position: Vector2D;
  rotation: number;
  opacity: number;
  ageMs: number; // How long this mark has existed
}

export interface Spark {
  id: string;
  position: Vector2D;
  velocity: Vector2D;
  life: number; // Remaining life in ms
  maxLife: number;
  color: string;
}

export interface SmokeParticle {
  id: string;
  position: Vector2D;
  velocity: Vector2D;
  life: number;
  maxLife: number;
  size: number;
  opacity: number;
}

export interface ExplosionParticle {
  angle: number;
  distance: number;
  speed: number;
  size: number;
  color: string;
  rotation: number;
}

export interface Explosion {
  id: string;
  position: Vector2D;
  particles: ExplosionParticle[];
  ageMs: number; // How long since explosion started
  duration: number; // Total duration
}

export interface DamageNumber {
  id: string;
  position: Vector2D;
  damage: number;
  color: string;
  life: number;
  maxLife: number;
}

/** All VFX state - separate from simulation state */
export interface EffectsState {
  tireMarks: TireMark[];
  sparks: Spark[];
  smokeParticles: SmokeParticle[];
  explosions: Explosion[];
  damageNumbers: DamageNumber[];
}

export function createEmptyEffectsState(): EffectsState {
  return {
    tireMarks: [],
    sparks: [],
    smokeParticles: [],
    explosions: [],
    damageNumbers: [],
  };
}

// Constants for effects
export const EFFECTS_CONFIG = {
  tireMarkMaxAge: 10000, // ms until fully faded
  maxTireMarks: 200,
  explosionDuration: 1500,
  sparkColors: ["#ffd700", "#ff8c00", "#ff4500", "#ffffff"],
  explosionColors: ["#e74c3c", "#f39c12", "#f1c40f", "#d35400", "#c0392b"],
};
