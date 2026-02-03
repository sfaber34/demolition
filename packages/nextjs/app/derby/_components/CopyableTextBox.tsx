"use client";

import React, { useState } from "react";

interface CopyableTextBoxProps {
  value: string;
  label?: string;
  rows?: number;
  className?: string;
}

export const CopyableTextBox: React.FC<CopyableTextBoxProps> = ({ value, label, rows = 6, className = "" }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className={`w-full ${className}`}>
      {label && <div className="text-xs text-zinc-500 uppercase tracking-widest mb-2">{label}</div>}
      <div className="relative">
        <textarea
          readOnly
          value={value}
          rows={rows}
          className="w-full px-3 py-2 pr-20 bg-zinc-900/80 border border-zinc-700 rounded-lg text-zinc-300 font-mono text-xs resize-none focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
        <button
          onClick={handleCopy}
          className={`absolute top-2 right-2 px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition-all ${
            copied
              ? "bg-green-600 text-white"
              : "bg-zinc-700 hover:bg-zinc-600 text-zinc-300 hover:text-white border border-zinc-600"
          }`}
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
};

export default CopyableTextBox;
