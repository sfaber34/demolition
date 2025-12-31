"use client";

import React, { useMemo } from "react";
import { Car as CarType } from "../types";

interface CarProps {
  car: CarType;
}

export const Car: React.FC<CarProps> = ({ car }) => {
  const { position, rotation, width, height, color, health, maxHealth, isAlive } = car;

  const healthPercent = health / maxHealth;

  // Generate damage visualization
  const damageElements = useMemo(() => {
    const elements: React.ReactNode[] = [];
    const damageLevel = 1 - healthPercent;

    if (damageLevel > 0.25) {
      // Minor scratches and dents
      const scratchCount = Math.floor(damageLevel * 8);
      for (let i = 0; i < scratchCount; i++) {
        const x = (Math.random() - 0.5) * width * 0.8;
        const y = (Math.random() - 0.5) * height * 0.8;
        const angle = Math.random() * 180;
        const length = 3 + Math.random() * 8;
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
      for (let i = 0; i < dentCount; i++) {
        const x = (Math.random() - 0.5) * width * 0.7;
        const y = (Math.random() - 0.5) * height * 0.7;
        const size = 4 + Math.random() * 6;
        elements.push(
          <ellipse
            key={`dent-${i}`}
            cx={x}
            cy={y}
            rx={size}
            ry={size * 0.6}
            fill="rgba(0,0,0,0.25)"
            transform={`rotate(${Math.random() * 360}, ${x}, ${y})`}
          />,
        );
      }
    }

    if (damageLevel > 0.75) {
      // Cracks
      const crackCount = Math.floor((damageLevel - 0.75) * 8);
      for (let i = 0; i < crackCount; i++) {
        const startX = (Math.random() - 0.5) * width * 0.6;
        const startY = (Math.random() - 0.5) * height * 0.6;
        const segments = 2 + Math.floor(Math.random() * 3);
        let pathD = `M ${startX} ${startY}`;
        let x = startX;
        let y = startY;
        for (let j = 0; j < segments; j++) {
          x += (Math.random() - 0.5) * 12;
          y += (Math.random() - 0.5) * 12;
          pathD += ` L ${x} ${y}`;
        }
        elements.push(<path key={`crack-${i}`} d={pathD} stroke="rgba(0,0,0,0.5)" strokeWidth={1.5} fill="none" />);
      }
    }

    return elements;
  }, [healthPercent, width, height]);

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
    // Dead car - maximum damage appearance
    return (
      <g
        transform={`translate(${position.x}, ${position.y}) rotate(${(rotation * 180) / Math.PI})`}
        style={{ filter: "brightness(0.5)" }}
      >
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
        {/* Cracks everywhere */}
        {Array.from({ length: 12 }).map((_, i) => {
          const startX = (Math.random() - 0.5) * width;
          const startY = (Math.random() - 0.5) * height;
          return (
            <line
              key={`dead-crack-${i}`}
              x1={startX}
              y1={startY}
              x2={startX + (Math.random() - 0.5) * 20}
              y2={startY + (Math.random() - 0.5) * 20}
              stroke="rgba(0,0,0,0.6)"
              strokeWidth={2}
            />
          );
        })}
      </g>
    );
  }

  return (
    <g transform={`translate(${position.x}, ${position.y}) rotate(${(rotation * 180) / Math.PI})`}>
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
};

export default Car;
