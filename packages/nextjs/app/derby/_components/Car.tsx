"use client";

import React, { memo, useMemo } from "react";
import { CarSim } from "../sim/typesSim";

interface CarProps {
  car: CarSim;
}

export const Car: React.FC<CarProps> = memo(({ car }) => {
  const { position, rotation, width, height, color, health, maxHealth, isAlive } = car;

  // Pre-compute transform string
  const transformStr = `translate(${position.x}, ${position.y}) rotate(${(rotation * 180) / Math.PI})`;

  const healthPercent = health / maxHealth;

  // Generate damage visualization
  const damageElements = useMemo(() => {
    const elements: React.ReactNode[] = [];
    const damageLevel = 1 - healthPercent;

    if (damageLevel > 0.25) {
      // Minor scratches and dents - use deterministic positions based on car id
      const scratchCount = Math.floor(damageLevel * 8);
      const seed = car.id.charCodeAt(car.id.length - 1) / 255;
      for (let i = 0; i < scratchCount; i++) {
        const seedOffset = (seed + i * 0.137) % 1;
        const x = (seedOffset - 0.5) * width * 0.8;
        const y = (((seedOffset * 7) % 1) - 0.5) * height * 0.8;
        const angle = ((seedOffset * 17) % 1) * 180;
        const length = 3 + ((seedOffset * 11) % 1) * 8;
        elements.push(
          <line
            key={`scratch-${i}`}
            x1={x - length / 2}
            y1={y}
            x2={x + length / 2}
            y2={y}
            stroke="rgba(0,0,0,0.4)"
            strokeWidth={1}
            transform={`rotate(${angle}, ${x}, ${y})`}
          />,
        );
      }
    }

    if (damageLevel > 0.5) {
      // Visible dents (darker areas)
      const dentCount = Math.floor((damageLevel - 0.5) * 6);
      const seed = car.id.charCodeAt(car.id.length - 2) / 255;
      for (let i = 0; i < dentCount; i++) {
        const seedOffset = (seed + i * 0.193) % 1;
        const x = (seedOffset - 0.5) * width * 0.7;
        const y = (((seedOffset * 13) % 1) - 0.5) * height * 0.7;
        const size = 4 + seedOffset * 6;
        elements.push(
          <ellipse
            key={`dent-${i}`}
            cx={x}
            cy={y}
            rx={size}
            ry={size * 0.6}
            fill="rgba(0,0,0,0.25)"
            transform={`rotate(${seedOffset * 360}, ${x}, ${y})`}
          />,
        );
      }
    }

    if (damageLevel > 0.75) {
      // Cracks
      const crackCount = Math.floor((damageLevel - 0.75) * 8);
      const seed = car.id.charCodeAt(0) / 255;
      for (let i = 0; i < crackCount; i++) {
        const seedOffset = (seed + i * 0.271) % 1;
        const startX = (seedOffset - 0.5) * width * 0.6;
        const startY = (((seedOffset * 7) % 1) - 0.5) * height * 0.6;
        const segments = 2 + Math.floor((seedOffset * 3) % 3);
        let pathD = `M ${startX} ${startY}`;
        let x = startX;
        let y = startY;
        for (let j = 0; j < segments; j++) {
          const segSeed = (seedOffset + j * 0.31) % 1;
          x += (segSeed - 0.5) * 12;
          y += (((segSeed * 3) % 1) - 0.5) * 12;
          pathD += ` L ${x} ${y}`;
        }
        elements.push(<path key={`crack-${i}`} d={pathD} stroke="rgba(0,0,0,0.5)" strokeWidth={1.5} fill="none" />);
      }
    }

    return elements;
  }, [healthPercent, width, height, car.id]);

  // Darken color based on damage
  const darkenAmount = Math.min(0.4, (1 - healthPercent) * 0.5);
  const adjustedColor = useMemo(() => {
    // Parse hex color and darken it
    const hex = color.replace("#", "");
    const r = Math.max(0, parseInt(hex.slice(0, 2), 16) * (1 - darkenAmount));
    const g = Math.max(0, parseInt(hex.slice(2, 4), 16) * (1 - darkenAmount));
    const b = Math.max(0, parseInt(hex.slice(4, 6), 16) * (1 - darkenAmount));
    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  }, [color, darkenAmount]);

  // Lighter front end color
  const frontColor = useMemo(() => {
    const hex = color.replace("#", "");
    const r = Math.min(255, parseInt(hex.slice(0, 2), 16) * 1.2);
    const g = Math.min(255, parseInt(hex.slice(2, 4), 16) * 1.2);
    const b = Math.min(255, parseInt(hex.slice(4, 6), 16) * 1.2);
    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  }, [color]);

  if (!isAlive) {
    // Dead car - maximum damage appearance (deterministic)
    // Note: removed brightness filter for performance - use darker colors instead
    const seed = car.id.charCodeAt(0) / 255;
    return (
      <g transform={transformStr} opacity={0.6}>
        {/* Main body - heavily damaged */}
        <rect
          x={-width / 2}
          y={-height / 2}
          width={width}
          height={height}
          fill={adjustedColor}
          stroke="#222"
          strokeWidth={2}
          rx={3}
        />
        {/* Heavy damage overlay */}
        <rect x={-width / 2} y={-height / 2} width={width} height={height} fill="rgba(0,0,0,0.4)" rx={3} />
        {/* Cracks everywhere - deterministic */}
        {Array.from({ length: 12 }).map((_, i) => {
          const seedOffset = (seed + i * 0.083) % 1;
          const startX = (seedOffset - 0.5) * width;
          const startY = (((seedOffset * 7) % 1) - 0.5) * height;
          return (
            <line
              key={`dead-crack-${i}`}
              x1={startX}
              y1={startY}
              x2={startX + (((seedOffset * 17) % 1) - 0.5) * 20}
              y2={startY + (((seedOffset * 23) % 1) - 0.5) * 20}
              stroke="rgba(0,0,0,0.6)"
              strokeWidth={2}
            />
          );
        })}
      </g>
    );
  }

  return (
    <g transform={transformStr}>
      {/* Shadow */}
      <ellipse cx={2} cy={2} rx={width / 2 + 2} ry={height / 2 + 2} fill="rgba(0,0,0,0.2)" />

      {/* Main body */}
      <rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        fill={adjustedColor}
        stroke="#222"
        strokeWidth={2}
        rx={4}
      />

      {/* Front section (lighter) */}
      <rect
        x={width / 2 - width * 0.35}
        y={-height / 2 + 2}
        width={width * 0.33}
        height={height - 4}
        fill={frontColor}
        rx={3}
      />

      {/* Headlights */}
      <rect x={width / 2 - 4} y={-height / 2 + 3} width={3} height={4} fill="#ffeaa7" />
      <rect x={width / 2 - 4} y={height / 2 - 7} width={3} height={4} fill="#ffeaa7" />

      {/* Windshield */}
      <rect
        x={width / 2 - width * 0.5}
        y={-height / 2 + 4}
        width={width * 0.25}
        height={height - 8}
        fill="rgba(100,149,237,0.4)"
        rx={2}
      />

      {/* Damage visualization */}
      {damageElements}

      {/* Wheels */}
      <rect x={width / 2 - 12} y={-height / 2 - 3} width={10} height={5} fill="#111" rx={1} />
      <rect x={width / 2 - 12} y={height / 2 - 2} width={10} height={5} fill="#111" rx={1} />
      <rect x={-width / 2 + 2} y={-height / 2 - 3} width={10} height={5} fill="#111" rx={1} />
      <rect x={-width / 2 + 2} y={height / 2 - 2} width={10} height={5} fill="#111" rx={1} />
    </g>
  );
});
Car.displayName = "Car";

export default Car;
