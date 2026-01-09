"use client";

import React, { memo } from "react";
import { DamageNumber, Explosion, SmokeParticle, Spark, TireMark } from "../effects/effectsTypes";
import { getCarRear, getSpeed } from "../physics/PhysicsEngine";
import { CarSim } from "../sim/typesSim";

// Tire marks on the ground
export const TireMarks: React.FC<{ marks: TireMark[] }> = memo(({ marks }) => (
  <g>
    {marks.map(mark => (
      <ellipse
        key={mark.id}
        cx={mark.position.x}
        cy={mark.position.y}
        rx={8}
        ry={4}
        fill={`rgba(60, 50, 40, ${mark.opacity * 0.4})`}
        transform={`rotate(${(mark.rotation * 180) / Math.PI}, ${mark.position.x}, ${mark.position.y})`}
      />
    ))}
  </g>
));
TireMarks.displayName = "TireMarks";

// Sparks from collisions - removed blur filter for performance
export const Sparks: React.FC<{ sparks: Spark[] }> = memo(({ sparks }) => (
  <g>
    {sparks.map(spark => {
      const lifeRatio = spark.life / spark.maxLife;
      return (
        <circle
          key={spark.id}
          cx={spark.position.x}
          cy={spark.position.y}
          r={1 + lifeRatio * 2}
          fill={spark.color}
          opacity={lifeRatio}
        />
      );
    })}
  </g>
));
Sparks.displayName = "Sparks";

// Smoke particles - removed blur filter for performance
export const SmokeParticles: React.FC<{ particles: SmokeParticle[] }> = memo(({ particles }) => (
  <g>
    {particles.map(particle => (
      <circle
        key={particle.id}
        cx={particle.position.x}
        cy={particle.position.y}
        r={particle.size}
        fill={`rgba(80, 80, 80, ${particle.opacity})`}
      />
    ))}
  </g>
));
SmokeParticles.displayName = "SmokeParticles";

// Explosion effect - uses ageMs instead of Date.now()
// Removed blur filters for performance
export const ExplosionEffect: React.FC<{ explosion: Explosion }> = memo(({ explosion }) => {
  // Use ageMs for progress instead of Date.now()
  const progress = Math.min(1, explosion.ageMs / explosion.duration);

  return (
    <g>
      {/* Central flash - multiple circles for soft glow effect without blur */}
      <circle
        cx={explosion.position.x}
        cy={explosion.position.y}
        r={35 * progress}
        fill={`rgba(255, 200, 100, ${(1 - progress) * 0.3})`}
      />
      <circle
        cx={explosion.position.x}
        cy={explosion.position.y}
        r={25 * progress}
        fill={`rgba(255, 180, 80, ${(1 - progress) * 0.5})`}
      />
      <circle
        cx={explosion.position.x}
        cy={explosion.position.y}
        r={15 * progress}
        fill={`rgba(255, 150, 50, ${(1 - progress) * 0.8})`}
      />
      {/* Particles */}
      {explosion.particles.map((particle, i) => {
        const distance = particle.distance * progress * particle.speed;
        const x = explosion.position.x + Math.cos(particle.angle) * distance;
        const y = explosion.position.y + Math.sin(particle.angle) * distance;
        const opacity = 1 - progress * 0.8;
        const size = particle.size * (1 - progress * 0.5);

        return (
          <rect
            key={i}
            x={x - size / 2}
            y={y - size / 2}
            width={size}
            height={size}
            fill={particle.color}
            opacity={opacity}
            transform={`rotate(${particle.rotation + progress * 360}, ${x}, ${y})`}
          />
        );
      })}
      {/* Smoke ring - no blur */}
      <circle
        cx={explosion.position.x}
        cy={explosion.position.y}
        r={50 * progress}
        fill="none"
        stroke={`rgba(100, 100, 100, ${(1 - progress) * 0.4})`}
        strokeWidth={8 * (1 - progress)}
      />
    </g>
  );
});
ExplosionEffect.displayName = "ExplosionEffect";

// Smoke/Fire effects for damaged cars
// Uses deterministic offsets based on car position for animation
// Removed Date.now() and blur filters for performance
export const CarEffects: React.FC<{ car: CarSim; tMs: number }> = ({ car, tMs }) => {
  const t = tMs / 1000;

  if (!car.isAlive) {
    // Dead car effects are rendered in dedicated layers so living cars can drive between fire and smoke.
    // See `DeadCarFlames` / `DeadCarSmoke`.
    return null;
  }

  const healthPercent = car.health / car.maxHealth;

  // Smoke for damaged cars (below 50% health)
  if (healthPercent < 0.5) {
    const intensity = 1 - healthPercent * 2;
    const particleCount = Math.floor(intensity * 3);

    return (
      <g>
        {Array.from({ length: particleCount }).map((_, i) => {
          const x = car.position.x + (i % 2 === 0 ? -3 : 3);
          const y = car.position.y - 5 - i * 6 - Math.sin(t * 2.5 + i * 1.1) * 1.2;
          const size = 4 + i + Math.sin(t * 2.1 + i * 1.4) * 0.6;
          const opacity = Math.max(0, 0.25 * intensity - i * 0.05);

          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={size}
              fill={healthPercent < 0.25 ? `rgba(200, 100, 50, ${opacity})` : `rgba(80, 80, 80, ${opacity})`}
            />
          );
        })}
        {/* Fire effect for critical damage - animated flames */}
        {healthPercent < 0.25 && (
          <>
            {Array.from({ length: 2 }).map((_, i) => {
              const flicker = 0.5 + 0.5 * Math.sin(t * 13 + i * 4.1);
              const x = car.position.x + (i === 0 ? -4 : 4) + Math.sin(t * 9 + i) * 1.8;
              const y = car.position.y - 2 - flicker * 5;
              const r = 3.8 + flicker * 3.8;
              const opacity = 0.18 + flicker * 0.35;
              return <circle key={`fire-${i}`} cx={x} cy={y} r={r} fill={`rgba(255, 120, 0, ${opacity})`} />;
            })}
          </>
        )}
      </g>
    );
  }

  return null;
};
CarEffects.displayName = "CarEffects";

export const DeadCarFlames: React.FC<{ car: CarSim; tMs: number }> = ({ car, tMs }) => {
  if (car.isAlive) return null;
  const t = tMs / 1000;

  return (
    <g>
      {Array.from({ length: 3 }).map((_, i) => {
        const flicker = 0.5 + 0.5 * Math.sin(t * 12 + i * 2.3);
        const jitterX = Math.sin(t * 10 + i * 3.1) * 2.5;
        const jitterY = Math.cos(t * 11 + i * 2.2) * 1.8;
        const x = car.position.x + (i - 1) * 5 + jitterX;
        const y = car.position.y - 2 - flicker * 7 + jitterY;
        const r = 3.5 + flicker * 4.5;
        const opacity = 0.12 + flicker * 0.28;
        const fill = i === 0 ? `rgba(255, 180, 60, ${opacity})` : `rgba(255, 90, 0, ${opacity})`;
        return <circle key={`dead-fire-${i}`} cx={x} cy={y} r={r} fill={fill} />;
      })}
    </g>
  );
};
DeadCarFlames.displayName = "DeadCarFlames";

export const DeadCarSmoke: React.FC<{ car: CarSim; tMs: number }> = ({ car, tMs }) => {
  if (car.isAlive) return null;
  const t = tMs / 1000;

  return (
    <g>
      {Array.from({ length: 6 }).map((_, i) => {
        // 0..1 repeating rise progress per puff
        const rise = (((tMs / 650 + i * 0.21) % 1) + 1) % 1;
        const swirl = Math.sin(t * 2.2 + i * 1.7) * (5 + i * 0.4);
        const x = car.position.x + (i % 2 === 0 ? -4 : 4) + swirl;
        const y = car.position.y - 6 - rise * 44;
        const size = 6 + rise * 10 + Math.sin(t * 3.1 + i) * 0.8;
        const opacity = Math.max(0, (1 - rise) * (0.35 - i * 0.035));
        const shade = 55 + i * 6;
        return (
          <circle
            key={`dead-smoke-${i}`}
            cx={x}
            cy={y}
            r={size}
            fill={`rgba(${shade}, ${shade}, ${shade}, ${opacity})`}
          />
        );
      })}
    </g>
  );
};
DeadCarSmoke.displayName = "DeadCarSmoke";

// Dust cloud effect when moving
// Removed Date.now() and blur filter for performance
export const DustCloud: React.FC<{ car: CarSim }> = memo(({ car }) => {
  if (!car.isAlive) return null;

  const speed = getSpeed(car);
  if (speed < 2) return null;

  const intensity = Math.min(1, speed / 8);
  const particleCount = Math.floor(intensity * 3);

  // Use centralized rear position calculation
  const rear = getCarRear(car);
  const rearX = rear.x;
  const rearY = rear.y;

  return (
    <g>
      {Array.from({ length: particleCount }).map((_, i) => {
        // Use deterministic offset based on car position for stable rendering
        const spreadX = (i % 2 === 0 ? -1 : 1) * 5 * (i + 1);
        const spreadY = ((i % 3) - 1) * 4;
        const x = rearX + spreadX;
        const y = rearY + spreadY;
        const size = 5 + i * 2;

        return <circle key={i} cx={x} cy={y} r={size} fill={`rgba(180, 160, 130, ${0.12 * intensity})`} />;
      })}
    </g>
  );
});
DustCloud.displayName = "DustCloud";

// Floating damage numbers - removed drop-shadow filter for performance
export const DamageNumbers: React.FC<{ damageNumbers: DamageNumber[] }> = memo(({ damageNumbers }) => (
  <g>
    {damageNumbers.map(dmg => {
      const lifeRatio = dmg.life / dmg.maxLife;
      const opacity = Math.min(1, lifeRatio * 2); // Fade out in second half
      const scale = 0.8 + lifeRatio * 0.4; // Start big, shrink slightly

      return (
        <g key={dmg.id}>
          {/* Shadow/outline for readability - stroke instead of drop-shadow */}
          <text
            x={dmg.position.x}
            y={dmg.position.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={16 * scale}
            fontWeight="bold"
            fontFamily="system-ui, -apple-system, sans-serif"
            fill={dmg.color}
            stroke="#000"
            strokeWidth={2}
            opacity={opacity}
            style={{
              pointerEvents: "none",
              userSelect: "none",
            }}
          >
            -{dmg.damage}
          </text>
          {/* Main text on top */}
          <text
            x={dmg.position.x}
            y={dmg.position.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={16 * scale}
            fontWeight="bold"
            fontFamily="system-ui, -apple-system, sans-serif"
            fill={dmg.color}
            opacity={opacity}
            style={{
              pointerEvents: "none",
              userSelect: "none",
            }}
          >
            -{dmg.damage}
          </text>
        </g>
      );
    })}
  </g>
));
DamageNumbers.displayName = "DamageNumbers";

const Effects = {
  TireMarks,
  Sparks,
  SmokeParticles,
  ExplosionEffect,
  CarEffects,
  DustCloud,
  DamageNumbers,
};

export default Effects;
