import React, { useRef, useEffect, useCallback, useState } from 'react';
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
  GAME_TICK_RATE,
  SIMULATION_HERTZ,
  BASE_SPEED,
  BOOST_SPEED,
  TURN_SPEED,
  SPECIAL_SPEED_MULTIPLIER,
  SEGMENT_DISTANCE,
} from '../constants';

export type ConnectionState =
  | 'CONNECTING'
  | 'JOINING'
  | 'PLAYING'
  | 'RECONNECTING'
  | 'DISCONNECTED'
  | 'GAME_OVER';

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
  externalBoost?: boolean;
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

interface SnapshotBufferEntry {
  time: number; // Local performance.now() reception timestamp
  serverTime: number; // Authoritative snapshot.timestamp from server
  snapshot: GameStateSnapshotPayload;
}

// Server emits at 15 Hz (~66.67ms interval).
// 90ms delay (~1.35x snapshot interval) ensures client always has a pair of snapshots
// to smoothly interpolate between in 60/120 FPS without extrapolation stutter.
const INTERPOLATION_DELAY_MS = 90;

const SESSION_KEY = 'neon_slither_session_token';

const GameCanvas: React.FC<GameCanvasProps> = ({
  onScoreUpdate,
  onLeaderboardUpdate,
  onPowerupsUpdate,
  onGameOver,
  playerName,
  isPaused,
  enabledItems,
  externalBoost = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const requestRef = useRef<number | undefined>(undefined);
  const playerIdRef = useRef<string | null>(null);

  // Connection state management
  const connectionStateRef = useRef<ConnectionState>('CONNECTING');
  const [, setConnectionState] = useState<ConnectionState>('CONNECTING');

  const setConnState = useCallback((nextState: ConnectionState) => {
    connectionStateRef.current = nextState;
    setConnectionState(nextState);
  }, []);

  // Room and sequence validation
  const roomIdRef = useRef<string | null>(null);
  const lastSequenceRef = useRef<number>(-1);

  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const externalBoostRef = useRef(externalBoost);
  externalBoostRef.current = externalBoost;

  const callbacksRef = useRef({ onScoreUpdate, onLeaderboardUpdate, onPowerupsUpdate, onGameOver });
  callbacksRef.current = { onScoreUpdate, onLeaderboardUpdate, onPowerupsUpdate, onGameOver };

  // Authoritative snapshots sliding buffer for temporal interpolation
  const snapshotBufferRef = useRef<SnapshotBufferEntry[]>([]);

  // Client-side interpolated render state
  const renderSnakesRef = useRef<Map<string, InterpolatedSnake>>(new Map());
  const cameraPosRef = useRef<Point>({ x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 });
  const cameraInitializedRef = useRef<boolean>(false);

  // Client-side prediction for local player presentation
  const localPredictedRef = useRef<{
    initialized: boolean;
    x: number;
    y: number;
    angle: number;
    segments: Point[];
    lastTime: number;
    reconOffsetX: number;
    reconOffsetY: number;
  }>({
    initialized: false,
    x: WORLD_SIZE / 2,
    y: WORLD_SIZE / 2,
    angle: 0,
    segments: [],
    lastTime: 0,
    reconOffsetX: 0,
    reconOffsetY: 0,
  });

  // Input state
  const targetAngleRef = useRef<number>(0);
  const isBoostingRef = useRef<boolean>(false);
  const inputSequenceRef = useRef<number>(0);
  const lastInputSentTimeRef = useRef<number>(0);
  const lastSentAngleRef = useRef<number>(-999);
  const lastSentBoostRef = useRef<boolean>(false);
  const keysPressedRef = useRef<{ [key: string]: boolean }>({});

  const sendInput = useCallback((boostOverride?: boolean, force?: boolean) => {
    if (
      connectionStateRef.current !== 'PLAYING' ||
      isPausedRef.current ||
      !socketRef.current ||
      !socketRef.current.connected
    ) {
      return;
    }
    const boostActive = boostOverride !== undefined ? boostOverride : (isBoostingRef.current || !!externalBoostRef.current);
    const currentAngle = targetAngleRef.current;
    const now = performance.now();

    const angleDiff = Math.abs(currentAngle - lastSentAngleRef.current);
    const boostChanged = boostActive !== lastSentBoostRef.current;
    const timeSinceLast = now - lastInputSentTimeRef.current;

    // Send immediately if angle shifted or boost changed, or periodic sync (40ms)
    if (!force && !boostChanged && angleDiff < 0.015 && timeSinceLast < 40) {
      return;
    }

    const seq = ++inputSequenceRef.current;
    socketRef.current.emit(SOCKET_EVENTS.PLAYER_INPUT, {
      sequence: seq,
      direction: currentAngle,
      boost: boostActive,
    });
    lastInputSentTimeRef.current = now;
    lastSentAngleRef.current = currentAngle;
    lastSentBoostRef.current = boostActive;
  }, []);

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Use container rect and viewport
    const rect = canvas.getBoundingClientRect();
    const width = Math.floor(rect.width || window.innerWidth || document.documentElement.clientWidth || 360);
    const height = Math.floor(rect.height || window.innerHeight || document.documentElement.clientHeight || 640);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }, []);

  // Update input immediately when externalBoost prop changes
  useEffect(() => {
    if (externalBoost !== undefined) {
      isBoostingRef.current = !!externalBoost;
      sendInput(!!externalBoost);
    }
  }, [externalBoost, sendInput]);

  useEffect(() => {
    resize();

    // Attach ResizeObserver for responsive adaptation across all devices and orientation changes
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && canvasRef.current) {
      ro = new ResizeObserver(() => {
        resize();
      });
      ro.observe(canvasRef.current);
      if (canvasRef.current.parentElement) {
        ro.observe(canvasRef.current.parentElement);
      }
    }

    const handleResizeEvent = () => resize();
    window.addEventListener('resize', handleResizeEvent);
    window.addEventListener('orientationchange', handleResizeEvent);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResizeEvent);
    }

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
      setConnState('JOINING');
      const savedToken = localStorage.getItem(SESSION_KEY) || undefined;
      socket.emit(SOCKET_EVENTS.GAME_JOIN, {
        name: playerName,
        loadout: { enabledItems },
        sessionToken: savedToken,
      });
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected from game server. Reason:', reason);
      if (connectionStateRef.current !== 'GAME_OVER') {
        setConnState('RECONNECTING');
      }
    });

    socket.on('connect_error', (err) => {
      console.warn('[Socket] Connect error:', err.message);
      if (connectionStateRef.current !== 'GAME_OVER') {
        setConnState('RECONNECTING');
      }
    });

    socket.io.on('reconnect_attempt', (attempt) => {
      console.log(`[Socket] Reconnect attempt #${attempt}`);
      if (connectionStateRef.current !== 'GAME_OVER') {
        setConnState('RECONNECTING');
      }
    });

    socket.io.on('reconnect_failed', () => {
      console.error('[Socket] Reconnect failed definitively.');
      if (connectionStateRef.current !== 'GAME_OVER') {
        setConnState('DISCONNECTED');
      }
    });

    socket.on(SOCKET_EVENTS.GAME_INIT, (init: GameInitPayload) => {
      const isNewRoom = !roomIdRef.current || (init.roomId && init.roomId !== roomIdRef.current);
      roomIdRef.current = init.roomId || null;
      playerIdRef.current = init.playerId;

      if (init.sessionToken) {
        localStorage.setItem(SESSION_KEY, init.sessionToken);
      }

      if (isNewRoom) {
        // Novo Room detectado: limpar completamente o contexto e buffers do Room anterior
        lastSequenceRef.current = -1;
        snapshotBufferRef.current = [];
        renderSnakesRef.current.clear();
        localPredictedRef.current.initialized = false;
      } else {
        // Reconexão no mesmo Room: limpar snapshots acumulados e reancorar predição no estado autoritativo
        snapshotBufferRef.current = [];
        localPredictedRef.current.initialized = false;
      }
    });

    socket.on(SOCKET_EVENTS.GAME_STATE, (snapshot: GameStateSnapshotPayload) => {
      // 1. Validar se o snapshot pertence ao Room atualmente ativo
      if (roomIdRef.current && snapshot.roomId && snapshot.roomId !== roomIdRef.current) {
        return; // Descarta snapshot de sala antiga ou incorreta
      }

      // 2. Validar monotonicidade da sequência (descartar snapshots antigos ou duplicados)
      if (typeof snapshot.sequence === 'number') {
        if (snapshot.sequence <= lastSequenceRef.current) {
          return; // Snapshot atrasado ou fora de ordem
        }
        lastSequenceRef.current = snapshot.sequence;
      }

      // 3. Transição segura para PLAYING ao receber snapshot válido
      if (connectionStateRef.current === 'JOINING' || connectionStateRef.current === 'RECONNECTING') {
        setConnState('PLAYING');
      }

      const now = performance.now();
      snapshotBufferRef.current.push({
        time: now,
        serverTime: snapshot.timestamp,
        snapshot,
      });

      // Maintain a sliding window of recent snapshots (covers ~1.6 seconds at 15Hz)
      if (snapshotBufferRef.current.length > 25) {
        snapshotBufferRef.current.shift();
      }

      // Update HUD elements & reconcile local predicted state
      const mySnake = snapshot.player || (playerIdRef.current ? snapshot.snakes.find((s) => s.id === playerIdRef.current) : null);
      if (mySnake && mySnake.segments[0]) {
        const srvHead = mySnake.segments[0];
        const pred = localPredictedRef.current;

        if (!pred.initialized) {
          pred.x = srvHead.x;
          pred.y = srvHead.y;
          pred.angle = mySnake.angle;
          pred.segments = mySnake.segments.map((seg) => ({ x: seg.x, y: seg.y }));
          pred.initialized = true;
          pred.reconOffsetX = 0;
          pred.reconOffsetY = 0;
          pred.lastTime = performance.now();
        } else {
          // Keep segments length aligned with authoritative server length
          const targetLen = mySnake.segments.length;
          while (pred.segments.length < targetLen) {
            const tail = pred.segments[pred.segments.length - 1] || { x: pred.x, y: pred.y };
            pred.segments.push({ x: tail.x, y: tail.y });
          }
          while (pred.segments.length > targetLen) {
            pred.segments.pop();
          }

          // Measure divergence between server authoritative head and predicted head
          const diffX = srvHead.x - pred.x;
          const diffY = srvHead.y - pred.y;
          const dist = Math.hypot(diffX, diffY);

          if (dist > 150) {
            // Large divergence (e.g. respawn / warp): snap directly
            pred.x = srvHead.x;
            pred.y = srvHead.y;
            pred.angle = mySnake.angle;
            pred.reconOffsetX = 0;
            pred.reconOffsetY = 0;
            for (let i = 0; i < pred.segments.length; i++) {
              if (mySnake.segments[i]) {
                pred.segments[i].x = mySnake.segments[i].x;
                pred.segments[i].y = mySnake.segments[i].y;
              }
            }
          } else if (dist > 6) {
            // Small/medium latency offset: smooth error bleed-off over multiple frames
            pred.reconOffsetX = diffX;
            pred.reconOffsetY = diffY;
          }
        }
      }

      if (snapshot.player) {
        callbacksRef.current.onScoreUpdate(Math.floor(snapshot.player.score));

        // Update active powerups
        if (callbacksRef.current.onPowerupsUpdate) {
          const activePowers: ActivePowerup[] = [];
          const nowMs = Date.now();

          const checkPower = (type: SpecialItemType, endTime: number) => {
            if (endTime > nowMs) {
              const conf = SPECIAL_ITEMS_CONFIG[type];
              if (conf) {
                activePowers.push({
                  type,
                  timeLeft: Math.ceil((endTime - nowMs) / 1000),
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
      setConnState('GAME_OVER');
      localPredictedRef.current.initialized = false;
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

    // Keyboard navigation update
    const updateKeyboard = () => {
      let dx = 0;
      let dy = 0;
      if (keysPressedRef.current['w'] || keysPressedRef.current['arrowup']) dy -= 1;
      if (keysPressedRef.current['s'] || keysPressedRef.current['arrowdown']) dy += 1;
      if (keysPressedRef.current['a'] || keysPressedRef.current['arrowleft']) dx -= 1;
      if (keysPressedRef.current['d'] || keysPressedRef.current['arrowright']) dx += 1;

      if (dx !== 0 || dy !== 0) {
        const newAngle = Math.atan2(dy, dx);
        if (Math.abs(newAngle - targetAngleRef.current) > 0.01) {
          targetAngleRef.current = newAngle;
          sendInput();
        }
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

        const buffer = snapshotBufferRef.current;
        if (buffer.length === 0) {
          // Waiting for first snapshot
          ctx.fillStyle = '#020617';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#64748b';
          ctx.font = 'bold 16px sans-serif';
          ctx.textAlign = 'center';

          let statusMsg = 'Conectando ao servidor multiplayer...';
          if (connectionStateRef.current === 'DISCONNECTED') {
            statusMsg = 'Não foi possível conectar ao servidor.';
          } else if (connectionStateRef.current === 'RECONNECTING') {
            statusMsg = 'Conexão perdida. Tentando reconectar...';
          }
          ctx.fillText(statusMsg, canvas.width / 2, canvas.height / 2);
          return;
        }

        // Temporal interpolation calculation using performance.now()
        const now = performance.now();
        const renderTime = now - INTERPOLATION_DELAY_MS;

        let s0: SnapshotBufferEntry;
        let s1: SnapshotBufferEntry;
        let t = 0;

        if (buffer.length === 1) {
          s0 = buffer[0];
          s1 = buffer[0];
          t = 1;
        } else if (renderTime <= buffer[0].time) {
          // renderTime older than oldest snapshot in buffer
          s0 = buffer[0];
          s1 = buffer[0];
          t = 0;
        } else if (renderTime >= buffer[buffer.length - 1].time) {
          // renderTime newer than latest received snapshot (network jitter / packet delay)
          s0 = buffer[buffer.length - 2];
          s1 = buffer[buffer.length - 1];
          const span = s1.time - s0.time;
          t = span > 0 ? (renderTime - s0.time) / span : 1;
          // Bounded fallback: strictly cap extrapolation to prevent jumping or teleports
          t = Math.min(1.05, Math.max(0, t));
        } else {
          // Find the two surrounding snapshots for renderTime
          let i = buffer.length - 1;
          while (i > 0 && buffer[i].time > renderTime) {
            i--;
          }
          s0 = buffer[i];
          s1 = buffer[i + 1];
          const span = s1.time - s0.time;
          t = span > 0 ? (renderTime - s0.time) / span : 1;
          t = Math.min(1, Math.max(0, t));
        }

        const s0Snap = s0.snapshot;
        const s1Snap = s1.snapshot;
        const latest = s1Snap;

        // --- 1. Client-Side Prediction for Local Player Presentation ---
        const pred = localPredictedRef.current;
        if (pred.initialized) {
          if (connectionStateRef.current === 'PLAYING') {
            const lastTime = pred.lastTime || now;
            pred.lastTime = now;
            const dtSec = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
            const dt = dtSec * SIMULATION_HERTZ;

            // Immediate angular response: angle turns toward targetAngleRef.current on THIS frame
            let angleDiff = targetAngleRef.current - pred.angle;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            pred.angle += angleDiff * TURN_SPEED * dt;

            // Compute movement speed using authoritative powerup metadata
            let currentBaseSpeed = BASE_SPEED;
            const localMeta = latest.snakes.find((s) => s.id === playerIdRef.current);
            if (localMeta && localMeta.speedBoostEndTime > Date.now()) {
              currentBaseSpeed *= SPECIAL_SPEED_MULTIPLIER;
            }
            const isBoosting = isBoostingRef.current || !!externalBoostRef.current;
            const speed = (isBoosting && pred.segments.length > 5)
              ? currentBaseSpeed * (BOOST_SPEED / BASE_SPEED)
              : currentBaseSpeed;

            const step = speed * dt;
            pred.x += Math.cos(pred.angle) * step;
            pred.y += Math.sin(pred.angle) * step;
            pred.x = Math.max(10, Math.min(WORLD_SIZE - 10, pred.x));
            pred.y = Math.max(10, Math.min(WORLD_SIZE - 10, pred.y));

            // Soft reconciliation decay over multiple frames
            if (Math.abs(pred.reconOffsetX) > 0.01 || Math.abs(pred.reconOffsetY) > 0.01) {
              pred.x += pred.reconOffsetX * 0.12;
              pred.y += pred.reconOffsetY * 0.12;
              pred.reconOffsetX *= 0.85;
              pred.reconOffsetY *= 0.85;
            }

            // Update head segment
            if (pred.segments.length > 0) {
              pred.segments[0].x = pred.x;
              pred.segments[0].y = pred.y;
            }

            // Inverse-kinematic segment following constraint for smooth organic body curvature
            const targetDist = SEGMENT_DISTANCE;
            for (let i = 1; i < pred.segments.length; i++) {
              const leader = pred.segments[i - 1];
              const follower = pred.segments[i];
              const dx = follower.x - leader.x;
              const dy = follower.y - leader.y;
              const dist = Math.hypot(dx, dy);
              if (dist > targetDist) {
                const ratio = targetDist / dist;
                follower.x = leader.x + dx * ratio;
                follower.y = leader.y + dy * ratio;
              }
            }
          } else {
            // Freeze prediction time progression while offline/reconnecting so dt doesn't jump
            pred.lastTime = now;
          }
        }

        // Update render snakes: local player uses prediction, remote snakes use temporal interpolation
        const currentRenderSnakes = renderSnakesRef.current;
        const activeIds = new Set<string>();

        const s0SnakesMap = new Map<string, SnakeSnapshot>();
        for (let i = 0; i < s0Snap.snakes.length; i++) {
          const s = s0Snap.snakes[i];
          s0SnakesMap.set(s.id, s);
        }

        latest.snakes.forEach((targetSnake) => {
          activeIds.add(targetSnake.id);
          const isLocal = targetSnake.id === playerIdRef.current;
          const s0Snake = s0SnakesMap.get(targetSnake.id);
          let current = currentRenderSnakes.get(targetSnake.id);

          if (!current) {
            // New snake entered viewport / game
            current = {
              id: targetSnake.id,
              name: targetSnake.name,
              color: targetSnake.color,
              segments: targetSnake.segments.map((seg) => ({ x: seg.x, y: seg.y })),
              angle: targetSnake.angle,
              length: targetSnake.length,
              isPlayer: targetSnake.isPlayer,
              score: targetSnake.score,
              isBoosting: targetSnake.isBoosting,
              powerupInventory: targetSnake.powerupInventory,
              speedBoostEndTime: targetSnake.speedBoostEndTime,
              invincibilityEndTime: targetSnake.invincibilityEndTime,
              magnetEndTime: targetSnake.magnetEndTime,
              scouterEndTime: targetSnake.scouterEndTime,
              slicerEndTime: targetSnake.slicerEndTime,
              usurperEndTime: targetSnake.usurperEndTime,
              stalkerEndTime: targetSnake.stalkerEndTime,
            };
            currentRenderSnakes.set(targetSnake.id, current);
          } else {
            if (isLocal && pred.initialized) {
              // Local player presentation: strictly use predicted state for instant feedback
              for (let i = 0; i < pred.segments.length; i++) {
                if (!current.segments[i]) current.segments.push({ x: 0, y: 0 });
                current.segments[i].x = pred.segments[i].x;
                current.segments[i].y = pred.segments[i].y;
              }
              current.segments.length = pred.segments.length;
              current.angle = pred.angle;
              current.length = targetSnake.length;
            } else {
              // Remote players: keep temporal snapshot interpolation between s0 and s1
              const targetSegs = targetSnake.segments;
              const targetLen = targetSegs.length;

              while (current.segments.length < targetLen) {
                current.segments.push({ x: 0, y: 0 });
              }
              if (current.segments.length > targetLen) {
                current.segments.length = targetLen;
              }

              if (s0Snake) {
                const n0 = s0Snake.segments.length;
                for (let i = 0; i < targetLen; i++) {
                  const p1 = targetSegs[i];
                  if (i < n0) {
                    const p0 = s0Snake.segments[i];
                    current.segments[i].x = p0.x + (p1.x - p0.x) * t;
                    current.segments[i].y = p0.y + (p1.y - p0.y) * t;
                  } else {
                    const p0Tail = s0Snake.segments[n0 - 1] || p1;
                    current.segments[i].x = p0Tail.x + (p1.x - p0Tail.x) * t;
                    current.segments[i].y = p0Tail.y + (p1.y - p0Tail.y) * t;
                  }
                }

                let diff = (targetSnake.angle - s0Snake.angle) % (Math.PI * 2);
                if (diff < -Math.PI) diff += Math.PI * 2;
                if (diff > Math.PI) diff -= Math.PI * 2;
                current.angle = s0Snake.angle + diff * t;
                current.length = s0Snake.length + (targetSnake.length - s0Snake.length) * t;
              } else {
                for (let i = 0; i < targetLen; i++) {
                  current.segments[i].x = targetSegs[i].x;
                  current.segments[i].y = targetSegs[i].y;
                }
                current.angle = targetSnake.angle;
                current.length = targetSnake.length;
              }
            }

            current.name = targetSnake.name;
            current.color = targetSnake.color;
            current.score = targetSnake.score;
            current.isBoosting = isLocal ? (isBoostingRef.current || !!externalBoostRef.current) : targetSnake.isBoosting;
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

        // Remove snakes no longer present in latest snapshot
        for (const id of currentRenderSnakes.keys()) {
          if (!activeIds.has(id)) {
            currentRenderSnakes.delete(id);
          }
        }

        // Locate local player and synchronize camera with zero latency
        const player = playerIdRef.current ? currentRenderSnakes.get(playerIdRef.current) : null;
        if (player && player.segments[0]) {
          const head = player.segments[0];
          cameraPosRef.current.x = head.x;
          cameraPosRef.current.y = head.y;
          cameraInitializedRef.current = true;
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

        // Draw Knives with temporal interpolation
        const s0KnivesMap = new Map<string, KnifeSnapshot>();
        for (let i = 0; i < s0Snap.knives.length; i++) {
          const k = s0Snap.knives[i];
          s0KnivesMap.set(k.id, k);
        }

        latest.knives.forEach((knife) => {
          ctx.save();
          const k0 = s0KnivesMap.get(knife.id);
          let kx = knife.x;
          let ky = knife.y;
          let kAngle = knife.angle;
          if (k0) {
            kx = k0.x + (knife.x - k0.x) * t;
            ky = k0.y + (knife.y - k0.y) * t;
            let diff = (knife.angle - k0.angle) % (Math.PI * 2);
            if (diff < -Math.PI) diff += Math.PI * 2;
            if (diff > Math.PI) diff -= Math.PI * 2;
            kAngle = k0.angle + diff * t;
          }
          ctx.translate(kx, ky);
          ctx.rotate(kAngle);
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

        // --- Responsive Minimap HUD (All platforms & mobile viewports) ---
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const minDim = Math.min(canvas.width, canvas.height);
        const isMobileScreen = minDim < 640 || canvas.width < 768;

        // Responsive size: between 76px and 190px
        const mmSize = Math.max(76, Math.min(minDim * 0.24, isMobileScreen ? 110 : 190));

        // Margins respecting mobile screen edges, safe area insets and gesture bars
        const marginX = isMobileScreen ? 12 : 20;
        const isPortrait = canvas.height > canvas.width;
        // On portrait mobile, give safe clearance from bottom browser UI / gesture bar
        const marginY = isMobileScreen ? (isPortrait ? 28 : 12) : 20;

        const mmX = Math.max(8, canvas.width - mmSize - marginX);
        const mmY = Math.max(8, canvas.height - mmSize - marginY);

        ctx.save();
        // Minimap background with neon border
        ctx.fillStyle = 'rgba(2, 6, 23, 0.85)';
        ctx.fillRect(mmX, mmY, mmSize, mmSize);
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(mmX, mmY, mmSize, mmSize);

        // Clip to minimap interior so no dots or effects bleed outside
        ctx.beginPath();
        ctx.rect(mmX, mmY, mmSize, mmSize);
        ctx.clip();

        // Subtle grid crosshair
        ctx.strokeStyle = 'rgba(51, 65, 85, 0.35)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(mmX + mmSize / 2, mmY);
        ctx.lineTo(mmX + mmSize / 2, mmY + mmSize);
        ctx.moveTo(mmX, mmY + mmSize / 2);
        ctx.lineTo(mmX + mmSize, mmY + mmSize / 2);
        ctx.stroke();

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
            isPlayerScouting || item.type === 'STALKER' || item.type === 'USURPER' ? 3.5 : 1.8,
            0,
            Math.PI * 2
          );
          ctx.fill();
        });

        currentRenderSnakes.forEach((snake) => {
          if (!snake.segments[0]) return;
          const sx = mmX + (snake.segments[0].x / WORLD_SIZE) * mmSize;
          const sy = mmY + (snake.segments[0].y / WORLD_SIZE) * mmSize;
          const isMe = snake.id === playerIdRef.current;
          ctx.fillStyle = isMe ? '#ffffff' : snake.color;
          ctx.beginPath();
          ctx.arc(sx, sy, isMe ? 3.5 : 2, 0, Math.PI * 2);
          ctx.fill();
        });

        ctx.restore();

        // Subtle connection status banner during active gameplay
        if (connectionStateRef.current === 'RECONNECTING' || connectionStateRef.current === 'DISCONNECTED') {
          ctx.save();
          const isReconnecting = connectionStateRef.current === 'RECONNECTING';
          const bannerMsg = isReconnecting
            ? 'Conexão perdida. Tentando reconectar...'
            : 'Desconectado do servidor.';
          const bannerWidth = 280;
          const bannerHeight = 34;
          const bx = (canvas.width - bannerWidth) / 2;
          const by = 16;

          ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(bx, by, bannerWidth, bannerHeight, 8);
          } else {
            ctx.rect(bx, by, bannerWidth, bannerHeight);
          }
          ctx.fill();
          ctx.strokeStyle = isReconnecting ? 'rgba(234, 179, 8, 0.7)' : 'rgba(239, 68, 68, 0.7)';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.fillStyle = isReconnecting ? '#facc15' : '#f87171';
          ctx.font = 'bold 13px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(bannerMsg, canvas.width / 2, by + bannerHeight / 2);
          ctx.restore();
        }
      } catch (err) {
        console.error('Multiplayer canvas render error:', err);
      }
    };

    requestRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [resize, playerName, enabledItems, sendInput, setConnState]);

  const handlePointerInput = useCallback((clientX: number, clientY: number) => {
    if (isPausedRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    targetAngleRef.current = Math.atan2(dy, dx);
    sendInput();
  }, [sendInput]);

  const handleMouseMove = (e: React.MouseEvent) => {
    handlePointerInput(e.clientX, e.clientY);
  };

  const handleMouseDown = () => {
    if (isPausedRef.current) return;
    isBoostingRef.current = true;
    sendInput(true);
  };

  const handleMouseUp = () => {
    if (isPausedRef.current) return;
    isBoostingRef.current = false;
    sendInput(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (isPausedRef.current) return;
    if (e.touches.length > 0) {
      handlePointerInput(e.touches[0].clientX, e.touches[0].clientY);
    }
    // Multi-touch: 2+ touches activates boost
    if (e.touches.length > 1) {
      isBoostingRef.current = true;
      sendInput(true);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isPausedRef.current) return;
    if (e.touches.length > 0) {
      handlePointerInput(e.touches[0].clientX, e.touches[0].clientY);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (isPausedRef.current) return;
    if (e.touches.length <= 1 && !externalBoostRef.current) {
      isBoostingRef.current = false;
      sendInput(false);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block cursor-crosshair touch-none select-none"
      onMouseMove={handleMouseMove}
      onTouchMove={handleTouchMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    />
  );
};

export default GameCanvas;
