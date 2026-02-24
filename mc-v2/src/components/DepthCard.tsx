import { useRef, type ReactNode, type CSSProperties } from 'react';

interface DepthCardProps {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}

/**
 * Card with parallax depth on hover.
 * Tracks mouse position relative to card center,
 * applies subtle 3D tilt + shadow shift.
 */
export function DepthCard({ children, style, className }: DepthCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  function handleMove(e: React.MouseEvent) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;  // -0.5 to 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.transform = `perspective(600px) rotateY(${x * 4}deg) rotateX(${-y * 4}deg) translateZ(2px)`;
    el.style.boxShadow = `${-x * 8}px ${y * 8}px 24px rgba(0,0,0,0.25), 0 0 1px rgba(255,255,255,0.05)`;
  }

  function handleLeave() {
    const el = ref.current;
    if (!el) return;
    el.style.transform = '';
    el.style.boxShadow = '';
  }

  return (
    <div
      ref={ref}
      className={`depth-card ${className || ''}`}
      style={style}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      {children}
    </div>
  );
}
