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
          r={2 + lifeRatio * 3}
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
export const CarEffects: React.FC<{ car: CarSim }> = memo(({ car }) => {
  if (!car.isAlive) {
    // Dead car - static smoke plume (no animation for performance)
    return (
      <g>
        {Array.from({ length: 4 }).map((_, i) => {
          const x = car.position.x + (i % 2 === 0 ? -5 : 5);
          const y = car.position.y - 5 - i * 8;
          const size = 6 + i * 2;
          const opacity = 0.35 - i * 0.07;
          return <circle key={i} cx={x} cy={y} r={size} fill={`rgba(60, 60, 60, ${opacity})`} />;
        })}
      </g>
    );
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
          const y = car.position.y - 5 - i * 6;
          const size = 4 + i;
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
        {/* Fire effect for critical damage - static flames */}
        {healthPercent < 0.25 && (
          <>
            {Array.from({ length: 2 }).map((_, i) => (
              <circle
                key={`fire-${i}`}
                cx={car.position.x + (i === 0 ? -4 : 4)}
                cy={car.position.y - 2}
                r={5}
                fill="rgba(255, 120, 0, 0.4)"
              />
            ))}
          </>
        )}
      </g>
    );
  }

  return null;
});
CarEffects.displayName = "CarEffects";

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
