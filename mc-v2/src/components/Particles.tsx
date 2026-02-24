import { useEffect, useRef } from 'react';
import { useThemeStore } from '../store/theme';

export function Particles() {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    if (theme !== 'relay' || !ref.current) return;
    const container = ref.current;
    const particles: HTMLDivElement[] = [];

    function spawn() {
      const p = document.createElement('div');
      p.className = 'particle';
      p.style.left = Math.random() * 100 + '%';
      p.style.bottom = '-2px';
      p.style.animation = `float-particle ${15 + Math.random() * 25}s linear forwards`;
      p.style.opacity = '0';
      container.appendChild(p);
      particles.push(p);
      p.addEventListener('animationend', () => {
        p.remove();
        const idx = particles.indexOf(p);
        if (idx > -1) particles.splice(idx, 1);
      });
    }

    const interval = setInterval(spawn, 2000);
    // Initial batch
    for (let i = 0; i < 5; i++) setTimeout(spawn, i * 400);

    return () => {
      clearInterval(interval);
      particles.forEach((p) => p.remove());
    };
  }, [theme]);

  if (theme !== 'relay') return null;

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 1,
        overflow: 'hidden',
      }}
    />
  );
}
