import { useEffect, useRef, useState } from 'react';

interface ScoreRingProps {
  value: number;
  label: string;
  color: string;
  size?: number;
}

const RADIUS = 40;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ~251.33

export default function ScoreRing({ value, label, color, size = 100 }: ScoreRingProps) {
  const [animated, setAnimated] = useState(false);
  const [displayValue, setDisplayValue] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !animated) {
          setAnimated(true);

          const start = Date.now();
          const duration = 1300;

          const tick = () => {
            const elapsed = Date.now() - start;
            const t = Math.min(elapsed / duration, 1);
            // ease-out cubic
            const eased = 1 - Math.pow(1 - t, 3);
            setDisplayValue(Math.round(eased * value));
            if (t < 1) requestAnimationFrame(tick);
          };

          requestAnimationFrame(tick);
          observer.disconnect();
        }
      },
      { threshold: 0.4 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [animated, value]);

  const dashoffset = animated
    ? CIRCUMFERENCE * (1 - value / 100)
    : CIRCUMFERENCE;

  return (
    <div ref={containerRef} className="flex flex-col items-center gap-3">
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        role="img"
        aria-label={`${label}: ${value} out of 100`}
      >
        {/* Track */}
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          stroke="rgba(10,10,10,0.08)"
          strokeWidth="8"
        />
        {/* Arc */}
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashoffset}
          className="score-arc"
          transform="rotate(-90 50 50)"
        />
        {/* Score number */}
        <text
          x="50"
          y="54"
          textAnchor="middle"
          style={{
            fontFamily: 'Inter, sans-serif',
            fontWeight: 700,
            fontSize: '24px',
            fill: '#0a0a0a',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {displayValue}
        </text>
      </svg>
      <span
        className="font-body font-semibold uppercase"
        style={{ fontSize: '11px', letterSpacing: '2px', color: 'rgba(10,10,10,0.45)' }}
      >
        {label}
      </span>
    </div>
  );
}