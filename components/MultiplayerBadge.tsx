import React, { useEffect, useRef } from 'react';

export const MultiplayerBadge: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!canvas || !container || !textEl) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let startTime = performance.now();

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    };

    updateSize();

    const resizeObserver = new ResizeObserver(() => {
      updateSize();
    });
    resizeObserver.observe(container);

    const render = (now: number) => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      const textRect = textEl.getBoundingClientRect();

      const width = rect.width;
      const height = rect.height;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.scale(dpr, dpr);

      // Relative coordinates of 'M' (left edge of text) and 'R' (right edge of text)
      const xM = Math.max(0, textRect.left - rect.left + 4);
      const xR = Math.min(width, textRect.right - rect.left - 4);
      const yCenter = height / 2;

      // Cycle definition:
      // Left snake: 0 to 1.6s
      // Pause: 1.6s to 1.8s
      // Right snake: 1.8s to 3.4s
      // Pause: 3.4s to 3.6s
      const cycleDuration = 3600; // ms
      const elapsed = (now - startTime) % cycleDuration;

      const leftSnakeDuration = 1600;
      const rightSnakeStart = 1800;
      const rightSnakeDuration = 1600;

      const numSegments = 9;
      const segmentSpacing = 5.5;
      const waveFreq = 0.15;
      const waveAmp = 4;
      const waveSpeed = 0.016;

      if (elapsed < leftSnakeDuration) {
        // === LEFT SNAKE (Emerges from 'M', slithers LEFT, then disappears) ===
        const progress = elapsed / leftSnakeDuration; // 0 to 1
        const travelDistance = xM - 8; // slithers towards left edge

        // Head position
        const headX = xM - progress * travelDistance;
        const currentPhase = now * waveSpeed;
        const headY = yCenter + Math.sin(headX * waveFreq + currentPhase) * waveAmp;

        // Fade out smoothly in the last 35% of travel
        let alpha = 1.0;
        if (progress > 0.65) {
          alpha = Math.max(0, (1 - progress) / 0.35);
        }

        ctx.save();
        // Clip so segments behind 'M' (to the right of xM) are hidden, as if emerging from the 'M'
        ctx.beginPath();
        ctx.rect(0, 0, xM + 1, height);
        ctx.clip();

        // Draw body segments (tail to neck)
        const snakeColor = '#06b6d4'; // Cyan neon
        const headColor = '#22d3ee';

        for (let i = numSegments - 1; i >= 0; i--) {
          const segDist = (i + 1) * segmentSpacing;
          const segX = headX + segDist;
          const segY = yCenter + Math.sin(segX * waveFreq + currentPhase) * waveAmp;
          const radius = Math.max(1.8, 3.8 - i * 0.25);

          ctx.beginPath();
          ctx.arc(segX, segY, radius, 0, Math.PI * 2);
          ctx.fillStyle = snakeColor;
          ctx.shadowColor = '#06b6d4';
          ctx.shadowBlur = 8 * alpha;
          ctx.globalAlpha = Math.max(0, alpha * (1 - (i / numSegments) * 0.25));
          ctx.fill();
        }

        // Draw Head
        ctx.beginPath();
        ctx.arc(headX, headY, 4.4, 0, Math.PI * 2);
        ctx.fillStyle = headColor;
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = 10 * alpha;
        ctx.globalAlpha = alpha;
        ctx.fill();

        // Draw cute snake eyes (looking LEFT)
        if (alpha > 0.15) {
          const eyeX = headX - 1.2;
          const eyeY1 = headY - 1.8;
          const eyeY2 = headY + 1.8;

          // Eye whites
          ctx.fillStyle = '#ffffff';
          ctx.shadowBlur = 0;
          ctx.globalAlpha = alpha;

          ctx.beginPath();
          ctx.arc(eyeX, eyeY1, 1.2, 0, Math.PI * 2);
          ctx.arc(eyeX, eyeY2, 1.2, 0, Math.PI * 2);
          ctx.fill();

          // Pupils (focused leftward)
          ctx.fillStyle = '#0f172a';
          ctx.beginPath();
          ctx.arc(eyeX - 0.5, eyeY1, 0.65, 0, Math.PI * 2);
          ctx.arc(eyeX - 0.5, eyeY2, 0.65, 0, Math.PI * 2);
          ctx.fill();

          // Tiny flicking forked tongue (every ~400ms)
          const tongueFlick = Math.sin(now * 0.015);
          if (tongueFlick > 0.5) {
            ctx.strokeStyle = '#f43f5e';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(headX - 4.4, headY);
            ctx.lineTo(headX - 7.5, headY);
            ctx.lineTo(headX - 9.5, headY - 1.2);
            ctx.moveTo(headX - 7.5, headY);
            ctx.lineTo(headX - 9.5, headY + 1.2);
            ctx.stroke();
          }
        }

        ctx.restore();
      } else if (elapsed >= rightSnakeStart && elapsed < rightSnakeStart + rightSnakeDuration) {
        // === RIGHT SNAKE (Emerges from 'R', slithers RIGHT, then disappears) ===
        const progress = (elapsed - rightSnakeStart) / rightSnakeDuration; // 0 to 1
        const travelDistance = width - xR - 8; // slithers towards right edge

        // Head position
        const headX = xR + progress * travelDistance;
        const currentPhase = now * waveSpeed;
        const headY = yCenter + Math.sin(headX * waveFreq + currentPhase) * waveAmp;

        // Fade out smoothly in the last 35% of travel
        let alpha = 1.0;
        if (progress > 0.65) {
          alpha = Math.max(0, (1 - progress) / 0.35);
        }

        ctx.save();
        // Clip so segments behind 'R' (to the left of xR) are hidden, as if emerging from the 'R'
        ctx.beginPath();
        ctx.rect(xR - 1, 0, width - (xR - 1), height);
        ctx.clip();

        // Draw body segments (tail to neck)
        const snakeColor = '#10b981'; // Emerald/Lime neon
        const headColor = '#34d399';

        for (let i = numSegments - 1; i >= 0; i--) {
          const segDist = (i + 1) * segmentSpacing;
          const segX = headX - segDist;
          const segY = yCenter + Math.sin(segX * waveFreq + currentPhase) * waveAmp;
          const radius = Math.max(1.8, 3.8 - i * 0.25);

          ctx.beginPath();
          ctx.arc(segX, segY, radius, 0, Math.PI * 2);
          ctx.fillStyle = snakeColor;
          ctx.shadowColor = '#10b981';
          ctx.shadowBlur = 8 * alpha;
          ctx.globalAlpha = Math.max(0, alpha * (1 - (i / numSegments) * 0.25));
          ctx.fill();
        }

        // Draw Head
        ctx.beginPath();
        ctx.arc(headX, headY, 4.4, 0, Math.PI * 2);
        ctx.fillStyle = headColor;
        ctx.shadowColor = '#34d399';
        ctx.shadowBlur = 10 * alpha;
        ctx.globalAlpha = alpha;
        ctx.fill();

        // Draw cute snake eyes (looking RIGHT)
        if (alpha > 0.15) {
          const eyeX = headX + 1.2;
          const eyeY1 = headY - 1.8;
          const eyeY2 = headY + 1.8;

          // Eye whites
          ctx.fillStyle = '#ffffff';
          ctx.shadowBlur = 0;
          ctx.globalAlpha = alpha;

          ctx.beginPath();
          ctx.arc(eyeX, eyeY1, 1.2, 0, Math.PI * 2);
          ctx.arc(eyeX, eyeY2, 1.2, 0, Math.PI * 2);
          ctx.fill();

          // Pupils (focused rightward)
          ctx.fillStyle = '#0f172a';
          ctx.beginPath();
          ctx.arc(eyeX + 0.5, eyeY1, 0.65, 0, Math.PI * 2);
          ctx.arc(eyeX + 0.5, eyeY2, 0.65, 0, Math.PI * 2);
          ctx.fill();

          // Tiny flicking forked tongue (every ~400ms)
          const tongueFlick = Math.sin(now * 0.015);
          if (tongueFlick > 0.5) {
            ctx.strokeStyle = '#f43f5e';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(headX + 4.4, headY);
            ctx.lineTo(headX + 7.5, headY);
            ctx.lineTo(headX + 9.5, headY - 1.2);
            ctx.moveTo(headX + 7.5, headY);
            ctx.lineTo(headX + 9.5, headY + 1.2);
            ctx.stroke();
          }
        }

        ctx.restore();
      }

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative inline-flex items-center justify-center px-14 sm:px-20 md:px-24 py-2 mt-2 select-none overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />
      <span
        ref={textRef}
        className="relative z-10 text-xs md:text-sm font-black tracking-[0.35em] uppercase text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-teal-200 to-emerald-400 drop-shadow-[0_0_12px_rgba(34,211,238,0.5)]"
      >
        MULTIPLAYER
      </span>
    </div>
  );
};
