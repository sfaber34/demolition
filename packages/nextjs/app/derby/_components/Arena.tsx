"use client";

import React from "react";
import { ARENA_CONFIG } from "../types";

export const Arena: React.FC = () => {
  const { width, height, wallThickness } = ARENA_CONFIG;

  // Generate wood plank pattern for walls
  const generatePlanks = (x: number, y: number, w: number, h: number, isVertical: boolean) => {
    const planks: React.ReactNode[] = [];
    const plankWidth = isVertical ? w : 15;
    const plankHeight = isVertical ? 18 : h;
    const count = isVertical ? Math.ceil(h / plankHeight) : Math.ceil(w / plankWidth);

    for (let i = 0; i < count; i++) {
      const px = isVertical ? x : x + i * plankWidth;
      const py = isVertical ? y + i * plankHeight : y;
      const pw = isVertical ? w : Math.min(plankWidth, w - i * plankWidth);
      const ph = isVertical ? Math.min(plankHeight, h - i * plankHeight) : h;

      // Vary the wood color slightly for each plank
      const hue = 25 + (i % 5) * 3;
      const lightness = 30 + (i % 3) * 5;
      const baseColor = `hsl(${hue}, 50%, ${lightness}%)`;
      const darkColor = `hsl(${hue}, 50%, ${lightness - 10}%)`;

      planks.push(
        <g key={`plank-${x}-${y}-${i}`}>
          {/* Main plank */}
          <rect x={px} y={py} width={pw} height={ph} fill={baseColor} stroke={darkColor} strokeWidth={0.5} />
          {/* Wood grain lines */}
          {isVertical && (
            <>
              <line
                x1={px + pw * 0.3}
                y1={py}
                x2={px + pw * 0.3}
                y2={py + ph}
                stroke={darkColor}
                strokeWidth={0.5}
                opacity={0.3}
              />
              <line
                x1={px + pw * 0.7}
                y1={py}
                x2={px + pw * 0.7}
                y2={py + ph}
                stroke={darkColor}
                strokeWidth={0.5}
                opacity={0.3}
              />
            </>
          )}
          {/* Nail holes */}
          {isVertical && i % 3 === 0 && (
            <>
              <circle cx={px + pw * 0.2} cy={py + ph * 0.3} r={1.5} fill="#1a1a1a" />
              <circle cx={px + pw * 0.8} cy={py + ph * 0.7} r={1.5} fill="#1a1a1a" />
            </>
          )}
        </g>,
      );
    }

    return planks;
  };

  return (
    <g>
      {/* Dirt floor background */}
      <defs>
        <pattern id="dirtPattern" patternUnits="userSpaceOnUse" width={40} height={40}>
          <rect width={40} height={40} fill="#c9b896" />
          {/* Dirt texture spots - static positions */}
          <circle cx={5} cy={8} r={2} fill="rgba(139, 119, 86, 0.3)" />
          <circle cx={18} cy={3} r={3} fill="rgba(139, 119, 86, 0.25)" />
          <circle cx={32} cy={12} r={2.5} fill="rgba(139, 119, 86, 0.35)" />
          <circle cx={8} cy={25} r={1.5} fill="rgba(139, 119, 86, 0.4)" />
          <circle cx={25} cy={22} r={2} fill="rgba(139, 119, 86, 0.3)" />
          <circle cx={38} cy={30} r={3} fill="rgba(139, 119, 86, 0.25)" />
          <circle cx={12} cy={35} r={2} fill="rgba(139, 119, 86, 0.35)" />
          <circle cx={30} cy={38} r={1.5} fill="rgba(139, 119, 86, 0.3)" />
          {/* Small stones - static positions */}
          <ellipse cx={15} cy={18} rx={2} ry={1} fill="rgba(100, 90, 70, 0.5)" />
          <ellipse cx={35} cy={5} rx={2.5} ry={1.2} fill="rgba(100, 90, 70, 0.45)" />
          <ellipse cx={22} cy={32} rx={1.5} ry={0.8} fill="rgba(100, 90, 70, 0.55)" />
        </pattern>
        {/* Gradient for inner edges of walls */}
        <linearGradient id="wallShadowLeft" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(0,0,0,0)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.3)" />
        </linearGradient>
        <linearGradient id="wallShadowRight" x1="100%" y1="0%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="rgba(0,0,0,0)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.3)" />
        </linearGradient>
        <linearGradient id="wallShadowTop" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(0,0,0,0)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.3)" />
        </linearGradient>
        <linearGradient id="wallShadowBottom" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="rgba(0,0,0,0)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.3)" />
        </linearGradient>
      </defs>

      {/* Dirt floor */}
      <rect
        x={wallThickness}
        y={wallThickness}
        width={width - wallThickness * 2}
        height={height - wallThickness * 2}
        fill="url(#dirtPattern)"
      />

      {/* Floor dirt variation overlay */}
      <rect
        x={wallThickness}
        y={wallThickness}
        width={width - wallThickness * 2}
        height={height - wallThickness * 2}
        fill="rgba(180, 160, 130, 0.1)"
      />

      {/* Wall shadows on floor */}
      <rect
        x={wallThickness}
        y={wallThickness}
        width={15}
        height={height - wallThickness * 2}
        fill="url(#wallShadowLeft)"
      />
      <rect
        x={width - wallThickness - 15}
        y={wallThickness}
        width={15}
        height={height - wallThickness * 2}
        fill="url(#wallShadowRight)"
      />
      <rect
        x={wallThickness}
        y={wallThickness}
        width={width - wallThickness * 2}
        height={15}
        fill="url(#wallShadowTop)"
      />
      <rect
        x={wallThickness}
        y={height - wallThickness - 15}
        width={width - wallThickness * 2}
        height={15}
        fill="url(#wallShadowBottom)"
      />

      {/* Wooden walls - Left */}
      <g>{generatePlanks(0, 0, wallThickness, height, true)}</g>

      {/* Wooden walls - Right */}
      <g>{generatePlanks(width - wallThickness, 0, wallThickness, height, true)}</g>

      {/* Wooden walls - Top */}
      <g>{generatePlanks(wallThickness, 0, width - wallThickness * 2, wallThickness, false)}</g>

      {/* Wooden walls - Bottom */}
      <g>{generatePlanks(wallThickness, height - wallThickness, width - wallThickness * 2, wallThickness, false)}</g>

      {/* Corner posts */}
      {[
        [0, 0],
        [width - wallThickness, 0],
        [0, height - wallThickness],
        [width - wallThickness, height - wallThickness],
      ].map(([cx, cy], i) => (
        <g key={`corner-${i}`}>
          <rect
            x={cx}
            y={cy}
            width={wallThickness}
            height={wallThickness}
            fill="#5d4e37"
            stroke="#3d2e17"
            strokeWidth={1}
          />
          {/* Corner bolt */}
          <circle cx={cx + wallThickness / 2} cy={cy + wallThickness / 2} r={4} fill="#2a2a2a" />
          <circle cx={cx + wallThickness / 2} cy={cy + wallThickness / 2} r={2.5} fill="#444" />
        </g>
      ))}

      {/* Outer border */}
      <rect x={0} y={0} width={width} height={height} fill="none" stroke="#2d1f0f" strokeWidth={4} />
    </g>
  );
};

export default Arena;
