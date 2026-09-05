import React, { useRef, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  SpecialItemType,
  SnakeSnapshot,
  FoodSnapshot,
  SpecialItemSnapshot,
  KnifeSnapshot,
  LeaderboardEntry,
  GameInitPayload,
  GameStateSnapshotPayload,
  PlayerDeathPayload,
  SOCKET_EVENTS,
  Point,
} from '../types';
import {
  WORLD_SIZE,
  SPECIAL_ITEMS_CONFIG,
} from '../constants';

export interface ActivePowerup {
  type: SpecialItemType;
  timeLeft: number;
  label: string;
  icon: string;
  color: string;
}

interface GameCanvasProps {
  onScoreUpdate: (score: number) => void;
  onLeaderboardUpdate: (leaders: LeaderboardEntry[]) => void;
  onPowerupsUpdate?: (powerups: ActivePowerup[]) => void;
  onGameOver: () => void;
  playerName: string;
  isPaused: boolean;
  enabledItems: Record<SpecialItemType, boolean>;
}

interface InterpolatedSnake {
  id: string;
  name: string;
  color: string;
  segments: Point[];
  angle: number;
  length: number;
  isPlayer: boolean;
  score: number;
  isBoosting: boolean;
  powerupInventory: Record<SpecialItemType, number>;
  speedBoostEndTime: number;
  invincibilityEndTime: number;
  magnetEndTime: number;
  scouterEndTime: number;
  slicerEndTime: number;
  usurperEndTime: number;
  stalkerEndTime: number;
}

const SESSION_KEY = 'neon_slither_session_token';

const GameCanvas: React.FC<GameCanvasProps> = ({
  onScoreUpdate,
  onLeaderboardUpdate,
  onPowerupsUpdate,
  onGameOver,
  playerName,
  isPaused,
  enabledItems,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const requestRef = useRef<number | undefined>(undefined);
  const playerIdRef = useRef<string | null>(null);

  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const callbacksRef = useRef({ onScoreUpdate, onLeaderboardUpdate, onPowerupsUpdate, onGameOver });
  callbacksRef.current = { onScoreUpdate, onLeaderboardUpdate, onPowerupsUpdate, onGameOver };

  // Authoritative snapshots buffer for interpolation
  const prevSnapshotRef = useRef<GameStateSnapshotPayload | null>(null);
  const latestSnapshotRef = useRef<GameStateSnapshotPayload | null>(null);
  const lastSnapshotReceivedTime = useRef<number>(0);

  // Client-side interpolated render state
  const renderSnakesRef = useRef<Map<string, InterpolatedSnake>>(new Map());
  const cameraPosRef = useRef<Point>({ x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 });

  // Input state
  const targetAngleRef = useRef<number>(0);
  const isBoostingRef = useRef<boolean>(false);
  const inputSequenceRef = useRef<number>(0);
  const lastInputSentTimeRef = useRef<number>(0);
  const keysPressedRef = useRef<{ [key: string]: boolean }>({});

  const resize = useCallback(() => {
    if (canvasRef.current) {
      canvasRef.current.width = window.innerWidth || document.documentElement.clientWidth || 800;
      canvasRef.current.height = window.innerHeight || document.documentElement.clientHeight || 600;
    }
  }, []);

  useEffect(() => {
    window.addEventListener('resize', resize);
    resize();

    // Connect Socket.IO client
    const socket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[Socket] Connected to game server.');
      const savedToken = localStorage.getItem(SESSION_KEY) || undefined;
      socket.emit(SOCKET_EVENTS.GAME_JOIN, {
        name: playerName,
        loadout: { enabledItems },
        sessionToken: savedToken,
      });
    });

    socket.on(SOCKET_EVENTS.GAME_INIT, (init: GameInitPayload) => {
      playerIdRef.current = init.playerId;
      if (init.sessionToken) {
        localStorage.setItem(SESSION_KEY, init.sessionToken);
      }
    });

    socket.on(SOCKET_EVENTS.GAME_STATE, (snapshot: GameStateSnapshotPayload) => {
      prevSnapshotRef.current = latestSnapshotRef.current || snapshot;
      latestSnapshotRef.current = snapshot;
      lastSnapshotReceivedTime.current = performance.now();

      // Update HUD elements
      if (snapshot.player) {
        callbacksRef.current.onScoreUpdate(Math.floor(snapshot.player.score));

        // Update active powerups
        if (callbacksRef.current.onPowerupsUpdate) {
          const activePowers: ActivePowerup[] = [];
          const now = Date.now();

          const checkPower = (type: SpecialItemType, endTime: number) => {
            if (endTime > now) {
              const conf = SPECIAL_ITEMS_CONFIG[type];
              if (conf) {
                activePowers.push({
                  type,
                  timeLeft: Math.ceil((endTime - now) / 1000),
                  label: type === 'USURPER' ? 'USURPER' : type === 'STALKER' ? 'STALKER' : type === 'ANGEL' ? 'ANGEL' : type,
                  icon: conf.label,
                  color: conf.color,
                });
              }
            }
          };

          checkPower('ANGEL', snapshot.player.invincibilityEndTime);
          checkPower('SPEED', snapshot.player.speedBoostEndTime);
          checkPower('MAGNET', snapshot.player.magnetEndTime);
          checkPower('SCOUTER', snapshot.player.scouterEndTime);
          checkPower('SLICER', snapshot.player.slicerEndTime);
          checkPower('USURPER', snapshot.player.usurperEndTime);
          checkPower('STALKER', snapshot.player.stalkerEndTime);

          callbacksRef.current.onPowerupsUpdate(activePowers);
        }
      }

      if (snapshot.leaderboard) {
        callbacksRef.current.onLeaderboardUpdate(snapshot.leaderboard);
      }
    });

    socket.on(SOCKET_EVENTS.PLAYER_DEATH, (death: PlayerDeathPayload) => {
      console.log('[Socket] Player died. Final score:', death.score);
      callbacksRef.current.onScoreUpdate(death.score);
      callbacksRef.current.onGameOver();
    });

    // Keyboard handlers
    const handleKeyDown = (e: KeyboardEvent) => {
      keysPressedRef.current[e.key.toLowerCase()] = true;
      if (e.code === 'Space') {
        isBoostingRef.current = true;
        sendInput();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressedRef.current[e.key.toLowerCase()] = false;
      if (e.code === 'Space') {
        isBoostingRef.current = false;
        sendInput();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Send input intent to authoritative server
    const sendInput = () => {
      if (isPausedRef.current || !socketRef.current || !socketRef.current.connected) return;
      const seq = ++inputSequenceRef.current;
      socketRef.current.emit(SOCKET_EVENTS.PLAYER_INPUT, {
        sequence: seq,
        direction: targetAngleRef.current,
        boost: isBoostingRef.current,
      });
      lastInputSentTimeRef.current = performance.now();
    };

    // Keyboard navigation update
    const updateKeyboard = () => {
      let dx = 0;
      let dy = 0;
      if (keysPressedRef.current['w'] || keysPressedRef.current['arrowup']) dy -= 1;
      if (keysPressedRef.current['s'] || keysPressedRef.current['arrowdown']) dy += 1;
      if (keysPressedRef.current['a'] || keysPressedRef.current['arrowleft']) dx -= 1;
      if (keysPressedRef.current['d'] || keysPressedRef.current['arrowright']) dx += 1;

      if (dx !== 0 || dy !== 0) {
        targetAngleRef.current = Math.atan2(dy, dx);
      }
    };

    // Render helper functions
    const renderMaskIcon = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      color: string,
      time: number,
      isOverlay = false
    ) => {
      ctx.save();
      ctx.translate(x, y);
      if (!isOverlay) {
        ctx.rotate(time / 1500);
        ctx.strokeStyle = color + '80';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 12]);
        ctx.beginPath();
        ctx.arc(0, 0, 42, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.rotate(-time / 1500);
        ctx.shadowBlur = 15;
        ctx.shadowColor = color;
      } else {
        ctx.scale(0.8, 0.8);
      }
      ctx.fillStyle = isOverlay ? 'rgba(255,255,255,0.9)' : color;
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, Math.PI, true);
      ctx.lineTo(-18, 10);
      ctx.quadraticCurveTo(0, 22, 18, 10);
      ctx.closePath();
      ctx.fill();
      if (!isOverlay) {
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(-12, -4, 24, 7, 4);
      } else {
        ctx.rect(-12, -4, 24, 7);
      }
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(-6, -0.5, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(6, -0.5, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const renderEyeIcon = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      color: string,
      time: number,
      isOverlay = false
    ) => {
      ctx.save();
      ctx.translate(x, y);
      if (isOverlay) ctx.scale(0.7, 0.7);
      const pulse = Math.sin(time / 200) * 5 + 35;
      ctx.shadowBlur = isOverlay ? 10 : pulse;
      ctx.shadowColor = color;
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.ellipse(0, 0, 30, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = color;
      const lookX = Math.cos(time / 400) * 8;
      ctx.beginPath();
      ctx.arc(lookX, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(lookX, 0, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    // Main animation and interpolation loop
    const animate = (time: number) => {
      if (!isPausedRef.current) {
        updateKeyboard();
        // Regular input sync at ~25Hz
        if (time - lastInputSentTimeRef.current > 40) {
          sendInput();
        }
      }

      render(time);
      requestRef.current = requestAnimationFrame(animate);
    };

    const render = (time: number) => {
      try {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        const latest = latestSnapshotRef.current;
        const prev = prevSnapshotRef.current;
        if (!latest) {
          // Waiting for first snapshot
          ctx.fillStyle = '#020617';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#64748b';
          ctx.font = 'bold 16px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('Conectando ao servidor multiplayer...', canvas.width / 2, canvas.height / 2);
          return;
        }

        // Calculate interpolation factor alpha (0 to 1)
        const snapshotInterval = 1000 / 15; // ~66ms
        const elapsedSinceSnapshot = performance.now() - lastSnapshotReceivedTime.current;
        const alpha = Math.min(1.2, Math.max(0, elapsedSinceSnapshot / snapshotInterval));

        // Update render snakes with lerp
        const currentRenderSnakes = renderSnakesRef.current;
        const activeIds = new Set<string>();

        latest.snakes.forEach((targetSnake) => {
          activeIds.add(targetSnake.id);
          let current = currentRenderSnakes.get(targetSnake.id);

          if (!current) {
            // New snake
            current = {
              ...targetSnake,
              segments: targetSnake.segments.map((s) => ({ ...s })),
            };
            currentRenderSnakes.set(targetSnake.id, current);
          } else {
            // Smoothly interpolate segments
            const lerpSpeed = Math.min(1.0, alpha * 0.4 + 0.3);
            const targetSegs = targetSnake.segments;

            // Match length
            while (current.segments.length < targetSegs.length) {
              current.segments.push({ ...targetSegs[current.segments.length] });
            }
            while (current.segments.length > targetSegs.length) {
              current.segments.pop();
            }

            for (let i = 0; i < current.segments.length; i++) {
              current.segments[i].x += (targetSegs[i].x - current.segments[i].x) * lerpSpeed;
              current.segments[i].y += (targetSegs[i].y - current.segments[i].y) * lerpSpeed;
            }

            current.name = targetSnake.name;
            current.color = targetSnake.color;
            current.angle = targetSnake.angle;
            current.length = targetSnake.length;
            current.score = targetSnake.score;
            current.isBoosting = targetSnake.isBoosting;
            current.powerupInventory = targetSnake.powerupInventory;
            current.speedBoostEndTime = targetSnake.speedBoostEndTime;
            current.invincibilityEndTime = targetSnake.invincibilityEndTime;
            current.magnetEndTime = targetSnake.magnetEndTime;
            current.scouterEndTime = targetSnake.scouterEndTime;
            current.slicerEndTime = targetSnake.slicerEndTime;
            current.usurperEndTime = targetSnake.usurperEndTime;
            current.stalkerEndTime = targetSnake.stalkerEndTime;
          }
        });

        // Remove snakes no longer present
        for (const id of currentRenderSnakes.keys()) {
          if (!activeIds.has(id)) {
            currentRenderSnakes.delete(id);
          }
        }

        // Locate local player
        const player = playerIdRef.current ? currentRenderSnakes.get(playerIdRef.current) : null;
        if (player && player.segments[0]) {
          const head = player.segments[0];
          cameraPosRef.current.x += (head.x - cameraPosRef.current.x) * 0.15;
          cameraPosRef.current.y += (head.y - cameraPosRef.current.y) * 0.15;
        }

        // Clear canvas
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Apply camera transform
        const zoom = player ? Math.max(0.35, 1 - (player.length - 10) * 0.00035) : 0.8;
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(zoom, zoom);
        ctx.translate(-cameraPosRef.current.x, -cameraPosRef.current.y);

        // Draw background grid
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        const step = 400;
        for (let x = 0; x <= WORLD_SIZE; x += step) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, WORLD_SIZE);
          ctx.stroke();
        }
        for (let y = 0; y <= WORLD_SIZE; y += step) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(WORLD_SIZE, y);
          ctx.stroke();
        }

        // Draw neon world border
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 20;
        ctx.strokeRect(0, 0, WORLD_SIZE, WORLD_SIZE);

        // Draw Knives
        latest.knives.forEach((knife) => {
          ctx.save();
          ctx.translate(knife.x, knife.y);
          ctx.rotate(knife.angle);
          ctx.shadowBlur = 10;
          ctx.shadowColor = 'white';
          ctx.fillStyle = '#e2e8f0';
          ctx.beginPath();
          ctx.moveTo(-15, -4);
          ctx.lineTo(5, -4);
          ctx.lineTo(15, 0);
          ctx.lineTo(5, 4);
          ctx.lineTo(-15, 4);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        });

        // Draw Foods
        latest.foods.forEach((food) => {
          ctx.save();
          if (food.value > 5) {
            const pulse = Math.sin(time / 150) * 10 + 15;
            ctx.shadowBlur = pulse;
            ctx.shadowColor = food.color;
            ctx.globalAlpha = 0.3;
            ctx.fillStyle = food.color;
            ctx.beginPath();
            ctx.arc(food.x, food.y, food.size * 1.8, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1.0;
          }
          ctx.fillStyle = food.color;
          ctx.beginPath();
          ctx.arc(food.x, food.y, food.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        });

        // Draw Special Items
        latest.specialItems.forEach((item) => {
          if (!item.isAvailable) return;
          const config = SPECIAL_ITEMS_CONFIG[item.type];
          if (!config) return;

          if (item.type === 'USURPER') {
            renderMaskIcon(ctx, item.x, item.y, config.color, time);
          } else if (item.type === 'STALKER') {
            renderEyeIcon(ctx, item.x, item.y, config.color, time);
          } else {
            const pulse = Math.sin(time / 200) * 8 + 20;
            ctx.save();
            ctx.shadowBlur = pulse;
            ctx.shadowColor = config.color;
            ctx.fillStyle = config.color;
            ctx.beginPath();
            ctx.arc(item.x, item.y, 30, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = 'white';
            ctx.font = 'bold 28px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(config.label, item.x, item.y);
            ctx.restore();
          }
        });

        // Draw Snakes
        const nowMs = Date.now();
        currentRenderSnakes.forEach((snake) => {
          if (!snake.segments || snake.segments.length === 0) return;

          const isInvincible = snake.invincibilityEndTime > nowMs;
          const isFast = snake.speedBoostEndTime > nowMs;
          const hasMagnet = snake.magnetEndTime > nowMs;
          const hasScouter = snake.scouterEndTime > nowMs;
          const isSlicer = snake.slicerEndTime > nowMs;
          const isUsurper = snake.usurperEndTime > nowMs;
          const isStalker = snake.stalkerEndTime > nowMs;
          const head = snake.segments[0];

          // Laser targeting line for Stalker
          if (isStalker) {
            let targetSnake: InterpolatedSnake | null = null;
            let minDistSq = 2000 * 2000;
            currentRenderSnakes.forEach((other) => {
              if (other.id === snake.id || !other.segments[0]) return;
              const d = (head.x - other.segments[0].x) ** 2 + (head.y - other.segments[0].y) ** 2;
              if (d < minDistSq && other.score >= snake.score) {
                minDistSq = d;
                targetSnake = other;
              }
            });
            if (targetSnake && (targetSnake as InterpolatedSnake).segments[0]) {
              const targetHead = (targetSnake as InterpolatedSnake).segments[0];
              ctx.save();
              ctx.beginPath();
              ctx.setLineDash([10, 10]);
              ctx.moveTo(head.x, head.y);
              ctx.lineTo(targetHead.x, targetHead.y);
              ctx.strokeStyle = 'rgba(248, 113, 113, 0.5)';
              ctx.lineWidth = 3;
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.beginPath();
              ctx.arc(targetHead.x, targetHead.y, 100, 0, Math.PI * 2);
              ctx.strokeStyle = '#f87171';
              ctx.lineWidth = 2;
              ctx.stroke();
              ctx.restore();
            }
          }

          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          const bodyWidth = 20 + Math.min(100, snake.length * 0.1);

          // 1. Black outer outline
          ctx.beginPath();
          snake.segments.forEach((seg, i) => {
            if (i === 0) ctx.moveTo(seg.x, seg.y);
            else ctx.lineTo(seg.x, seg.y);
          });
          ctx.lineWidth = bodyWidth + 5;
          ctx.strokeStyle = '#000000';
          ctx.shadowBlur = 0;
          ctx.stroke();

          // 2. Neon Body with gradient
          ctx.lineWidth = bodyWidth;
          if (isInvincible) {
            ctx.shadowBlur = 35;
            ctx.shadowColor = '#60a5fa';
          } else if (isUsurper) {
            ctx.shadowBlur = 35;
            ctx.shadowColor = '#22d3ee';
          } else if (isStalker) {
            ctx.shadowBlur = 40;
            ctx.shadowColor = '#f87171';
          } else if (isSlicer) {
            ctx.shadowBlur = 30;
            ctx.shadowColor = '#94a3b8';
          } else {
            ctx.shadowBlur = 15;
            ctx.shadowColor = snake.color;
          }

          const tail = snake.segments[snake.segments.length - 1];
          const gradient = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
          let startColor = snake.color;
          if (isStalker) startColor = '#111';
          else if (isUsurper) startColor = '#eee';
          gradient.addColorStop(0, startColor);
          gradient.addColorStop(1, '#000000');
          ctx.strokeStyle = gradient;
          ctx.stroke();

          // 3. Head rendering
          ctx.fillStyle = '#000000';
          ctx.shadowBlur = 0;
          ctx.beginPath();
          ctx.arc(head.x, head.y, (bodyWidth + 5) / 2, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = startColor;
          ctx.beginPath();
          ctx.arc(head.x, head.y, bodyWidth / 2, 0, Math.PI * 2);
          ctx.fill();

          if (isUsurper) renderMaskIcon(ctx, head.x, head.y, '#22d3ee', time, true);
          else if (isStalker) renderEyeIcon(ctx, head.x, head.y, '#f87171', time, true);

          // Nametag and active powerup icons
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'white';
          ctx.font = 'bold 18px sans-serif';
          ctx.textAlign = 'center';
          let icons = '';
          const activeTypes: SpecialItemType[] = ['ANGEL', 'SPEED', 'SLICER', 'MAGNET', 'SCOUTER', 'SIZE'];
          activeTypes.forEach((type) => {
            let isActive = false;
            switch (type) {
              case 'ANGEL':
                isActive = isInvincible;
                break;
              case 'SPEED':
                isActive = isFast;
                break;
              case 'SLICER':
                isActive = isSlicer;
                break;
              case 'MAGNET':
                isActive = hasMagnet;
                break;
              case 'SCOUTER':
                isActive = hasScouter;
                break;
            }
            const count = (isActive ? 1 : 0) + (snake.powerupInventory?.[type] || 0);
            if (count > 0) {
              const label = SPECIAL_ITEMS_CONFIG[type]?.label || '';
              icons += ` ${label}${count > 1 ? 'x' + count : ''}`;
            }
          });
          const tag = snake.name + (icons ? ' (' + icons.trim() + ')' : '');
          ctx.fillText(tag, head.x, head.y - bodyWidth / 2 - 25);
        });

        // --- Minimap HUD ---
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const mmSize = Math.min(canvas.width * 0.22, 220);
        const mmX = canvas.width - mmSize - 20;
        const mmY = canvas.height - mmSize - 20;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(mmX, mmY, mmSize, mmSize);
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
        ctx.lineWidth = 2;
        ctx.strokeRect(mmX, mmY, mmSize, mmSize);

        const isPlayerScouting = player && player.scouterEndTime > nowMs;

        latest.specialItems.forEach((item) => {
          if (!item.isAvailable) return;
          const sx = mmX + (item.x / WORLD_SIZE) * mmSize;
          const sy = mmY + (item.y / WORLD_SIZE) * mmSize;
          const config = SPECIAL_ITEMS_CONFIG[item.type];
          if (!config) return;
          ctx.fillStyle = config.color;
          ctx.beginPath();
          ctx.arc(
            sx,
            sy,
            isPlayerScouting || item.type === 'STALKER' || item.type === 'USURPER' ? 4 : 2,
            0,
            Math.PI * 2
          );
          ctx.fill();
        });

        currentRenderSnakes.forEach((snake) => {
          if (!snake.segments[0]) return;
          const sx = mmX + (snake.segments[0].x / WORLD_SIZE) * mmSize;
          const sy = mmY + (snake.segments[0].y / WORLD_SIZE) * mmSize;
          ctx.fillStyle = snake.id === playerIdRef.current ? 'white' : snake.color;
          ctx.beginPath();
          ctx.arc(sx, sy, snake.id === playerIdRef.current ? 4 : 2, 0, Math.PI * 2);
          ctx.fill();
        });
      } catch (err) {
        console.error('Multiplayer canvas render error:', err);
      }
    };

    requestRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [resize, playerName, enabledItems]);

  const handlePointerInput = (clientX: number, clientY: number) => {
    if (isPaused) return;
    const dx = clientX - window.innerWidth / 2;
    const dy = clientY - window.innerHeight / 2;
    targetAngleRef.current = Math.atan2(dy, dx);
  };

  const handleMouseMove = (e: React.MouseEvent) => handlePointerInput(e.clientX, e.clientY);
  const handleTouchMove = (e: React.TouchEvent) => handlePointerInput(e.touches[0].clientX, e.touches[0].clientY);

  const handleMouseDown = () => {
    if (isPaused) return;
    isBoostingRef.current = true;
    if (socketRef.current && socketRef.current.connected) {
      const seq = ++inputSequenceRef.current;
      socketRef.current.emit(SOCKET_EVENTS.PLAYER_INPUT, {
        sequence: seq,
        direction: targetAngleRef.current,
        boost: true,
      });
    }
  };

  const handleMouseUp = () => {
    isBoostingRef.current = false;
    if (socketRef.current && socketRef.current.connected) {
      const seq = ++inputSequenceRef.current;
      socketRef.current.emit(SOCKET_EVENTS.PLAYER_INPUT, {
        sequence: seq,
        direction: targetAngleRef.current,
        boost: false,
      });
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block cursor-crosshair touch-none"
      onMouseMove={handleMouseMove}
      onTouchMove={handleTouchMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onTouchStart={handleMouseDown}
      onTouchEnd={handleMouseUp}
    />
  );
};

export default GameCanvas;
