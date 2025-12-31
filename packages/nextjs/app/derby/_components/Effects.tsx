"use client";

import React from "react";
import { Car as CarType, Explosion, SmokeParticle, Spark, TireMark } from "../types";

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

// Explosion effect
export const ExplosionEffect: React.FC<{ explosion: Explosion }> = ({ explosion }) => {
  const elapsed = Date.now() - explosion.startTime;
  const progress = Math.min(1, elapsed / explosion.duration);

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
export const CarEffects: React.FC<{ car: CarType }> = ({ car }) => {
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
                  cx={car.position.x + (Math.random() - 0.5) * 10}
                  cy={car.position.y + (Math.random() - 0.5) * 10}
                  r={4 + Math.random() * 3}
                  fill={`rgba(255, ${100 + Math.random() * 100}, 0, ${flicker * 0.5})`}
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
export const DustCloud: React.FC<{ car: CarType }> = ({ car }) => {
  if (!car.isAlive) return null;

  const speed = Math.sqrt(car.velocity.x * car.velocity.x + car.velocity.y * car.velocity.y);
  if (speed < 30) return null;

  const intensity = Math.min(1, speed / 150);
  const particleCount = Math.floor(intensity * 3);

  // Calculate rear position
  const rearX = car.position.x - Math.cos(car.rotation) * (car.width / 2);
  const rearY = car.position.y - Math.sin(car.rotation) * (car.height / 2);

  return (
    <g>
      {Array.from({ length: particleCount }).map((_, i) => {
        const spread = (Math.random() - 0.5) * 20;
        const x = rearX + spread;
        const y = rearY + spread;
        const size = 4 + Math.random() * 6;

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

const Effects = {
  TireMarks,
  Sparks,
  SmokeParticles,
  ExplosionEffect,
  CarEffects,
  DustCloud,
};

export default Effects;
