import React from "react";

/**
 * AmbientalLogo — Sol da Ambiental (ícone oficial)
 *
 * Fundo verde #94C23C + sol amarelo #FFC60C com anel central e 16 raios
 * em forma de pílula (medidas extraídas do ícone original).
 * Renderizado como SVG inline (nítido em qualquer tamanho, sem assets externos).
 */
interface AmbientalLogoProps {
  /** Tamanho do ícone quadrado (px). */
  size?: number;
  /** Classes Tailwind adicionais. */
  className?: string;
}

/** Ângulos dos 16 raios do sol (a cada 22.5°) */
const RAY_ANGLES = Array.from({ length: 16 }, (_, i) => i * 22.5);

export function AmbientalLogo({ size = 32, className }: AmbientalLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Ambiental"
    >
      {/* Fundo verde (identidade Ambiental) */}
      <rect width="100" height="100" rx="16" fill="#94C23C" />

      {/* Anel central do sol */}
      <circle cx="50" cy="50" r="14" stroke="#FFC60C" strokeWidth="5.6" />

      {/* 16 raios do sol (pílulas radiais) */}
      <g stroke="#FFC60C" strokeWidth="3.2" strokeLinecap="round">
        {RAY_ANGLES.map((angle) => (
          <line
            key={angle}
            x1="50"
            y1="22"
            x2="50"
            y2="14"
            transform={`rotate(${angle} 50 50)`}
          />
        ))}
      </g>
    </svg>
  );
}

export default AmbientalLogo;
