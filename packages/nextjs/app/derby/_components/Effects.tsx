"use client";

import React from "react";
import { DamageNumber, Explosion, SmokeParticle, Spark, TireMark } from "../effects/effectsTypes";
import { getCarRear, getSpeed } from "../physics/PhysicsEngine";
import { CarSim } from "../sim/typesSim";

// Tire marks on the ground
export const TireMarks: React.FC<{ marks: TireMark[] }> = ({ marks }) => (
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
);

// Sparks from collisions
export const Sparks: React.FC<{ sparks: Spark[] }> = ({ sparks }) => (
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
          style={{ filter: "blur(0.5px)" }}
        />
      );
    })}
  </g>
);

// Smoke particles
export const SmokeParticles: React.FC<{ particles: SmokeParticle[] }> = ({ particles }) => (
  <g>
    {particles.map(particle => (
      <circle
        key={particle.id}
        cx={particle.position.x}
        cy={particle.position.y}
        r={particle.size}
        fill={`rgba(80, 80, 80, ${particle.opacity})`}
        style={{ filter: "blur(2px)" }}
      />
    ))}
  </g>
);

// Explosion effect - uses ageMs instead of Date.now()
export const ExplosionEffect: React.FC<{ explosion: Explosion }> = ({ explosion }) => {
  // Use ageMs for progress instead of Date.now()
  const progress = Math.min(1, explosion.ageMs / explosion.duration);

  return (
    <g>
      {/* Central flash */}
      <circle
        cx={explosion.position.x}
        cy={explosion.position.y}
        r={30 * progress}
        fill={`rgba(255, 200, 100, ${1 - progress})`}
        style={{ filter: "blur(5px)" }}
      />
      {/* Particles */}
      {explosion.particles.map((particle, i) => {
        const distance = particle.distance * progress * particle.speed;
        const x = explosion.position.x + Math.cos(particle.angle) * distance;
        const y = explosion.position.y + Math.sin(particle.angle) * distance;
        const opacity = 1 - progress * 0.8;
        const size = particle.size * (1 - progress * 0.5);

        return (
          <g key={i}>
            {/* Debris */}
            <rect
              x={x - size / 2}
              y={y - size / 2}
              width={size}
              height={size}
              fill={particle.color}
              opacity={opacity}
              transform={`rotate(${particle.rotation + progress * 360}, ${x}, ${y})`}
            />
          </g>
        );
      })}
      {/* Smoke ring */}
      <circle
        cx={explosion.position.x}
        cy={explosion.position.y}
        r={50 * progress}
        fill="none"
        stroke={`rgba(100, 100, 100, ${(1 - progress) * 0.5})`}
        strokeWidth={10 * (1 - progress)}
        style={{ filter: "blur(3px)" }}
      />
    </g>
  );
};

// Smoke/Fire effects for damaged cars
// Note: These still use Date.now() for continuous animation since they're
// purely visual effects that don't affect game state
export const CarEffects: React.FC<{ car: CarSim }> = ({ car }) => {
  if (!car.isAlive) {
    // Dead car - continuous smoke
    return (
      <g>
        {Array.from({ length: 5 }).map((_, i) => {
          const offset = (Date.now() / 100 + i * 20) % 100;
          const x = car.position.x + (Math.sin(offset * 0.3) - 0.5) * 10;
          const y = car.position.y - offset * 0.5;
          const size = 5 + offset * 0.15;
          const opacity = Math.max(0, 0.4 - offset * 0.004);
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={size}
              fill={`rgba(60, 60, 60, ${opacity})`}
              style={{ filter: "blur(3px)" }}
            />
          );
        })}
      </g>
    );
  }

  const healthPercent = car.health / car.maxHealth;

  // Smoke for damaged cars (below 50% health)
  if (healthPercent < 0.5) {
    const intensity = 1 - healthPercent * 2;
    const particleCount = Math.floor(intensity * 4);

    return (
      <g>
        {Array.from({ length: particleCount }).map((_, i) => {
          const time = Date.now() / 100;
          const phase = (time + i * 25) % 60;
          const x = car.position.x + Math.sin(time * 0.1 + i) * 5;
          const y = car.position.y - phase * 0.4;
          const size = 3 + phase * 0.1;
          const opacity = Math.max(0, 0.3 * intensity - phase * 0.005);

          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={size}
              fill={healthPercent < 0.25 ? `rgba(200, 100, 50, ${opacity})` : `rgba(80, 80, 80, ${opacity})`}
              style={{ filter: "blur(2px)" }}
            />
          );
        })}
        {/* Fire flicker for critical damage */}
        {healthPercent < 0.25 && (
          <>
            {Array.from({ length: 3 }).map((_, i) => {
              const flicker = Math.sin(Date.now() / 50 + i * 2) * 0.3 + 0.7;
              return (
                <circle
                  key={`fire-${i}`}
                  cx={car.position.x + (Math.sin(Date.now() / 100 + i) - 0.5) * 10}
                  cy={car.position.y + (Math.cos(Date.now() / 80 + i * 2) - 0.5) * 10}
                  r={4 + Math.sin(Date.now() / 50 + i * 3) * 1.5}
                  fill={`rgba(255, ${100 + Math.sin(Date.now() / 30 + i) * 50}, 0, ${flicker * 0.5})`}
                  style={{ filter: "blur(1px)" }}
                />
              );
            })}
          </>
        )}
      </g>
    );
  }

  return null;
};

// Dust cloud effect when moving
export const DustCloud: React.FC<{ car: CarSim }> = ({ car }) => {
  if (!car.isAlive) return null;

  // car.velocity is the velocity
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
        // Use deterministic offset based on time + index for some variation
        const timeOffset = (Date.now() / 50 + i * 37) % 100;
        const spreadX = Math.sin(timeOffset * 0.3 + i * 1.5) * 10;
        const spreadY = Math.cos(timeOffset * 0.25 + i * 2) * 10;
        const x = rearX + spreadX;
        const y = rearY + spreadY;
        const size = 4 + (timeOffset % 1) * 6;

        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={size}
            fill={`rgba(180, 160, 130, ${0.15 * intensity})`}
            style={{ filter: "blur(2px)" }}
          />
        );
      })}
    </g>
  );
};

// Floating damage numbers
export const DamageNumbers: React.FC<{ damageNumbers: DamageNumber[] }> = ({ damageNumbers }) => (
  <g>
    {damageNumbers.map(dmg => {
      const lifeRatio = dmg.life / dmg.maxLife;
      const opacity = Math.min(1, lifeRatio * 2); // Fade out in second half
      const scale = 0.8 + lifeRatio * 0.4; // Start big, shrink slightly

      return (
        <g key={dmg.id}>
          {/* Shadow/outline for readability */}
          <text
            x={dmg.position.x}
            y={dmg.position.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={16 * scale}
            fontWeight="bold"
            fontFamily="system-ui, -apple-system, sans-serif"
            fill="#000"
            opacity={opacity * 0.8}
            style={{
              pointerEvents: "none",
              userSelect: "none",
            }}
          >
            -{dmg.damage}
          </text>
          {/* Main text */}
          <text
            x={dmg.position.x}
            y={dmg.position.y - 1}
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
              filter: "drop-shadow(0 0 2px rgba(0,0,0,0.5))",
            }}
          >
            -{dmg.damage}
          </text>
        </g>
      );
    })}
  </g>
);

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
