import { Snake, SnakeSnapshot, SpecialItemType, Point, PlayerLoadoutConfig } from '../shared/types';
import {
  BASE_SPEED,
  BOOST_SPEED,
  SPECIAL_SPEED_MULTIPLIER,
  TURN_SPEED,
  INITIAL_SNAKE_LENGTH,
  SEGMENT_DISTANCE,
  SPECIAL_ITEMS_CONFIG,
  WORLD_WIDTH,
  WORLD_HEIGHT,
} from '../shared/constants';

interface PendingInput {
  sequence: number;
  direction: number;
  boost: boolean;
  timestamp: number;
}

export class PlayerEntity {
  public data: Snake;
  public prevHead: Point;
  private inputQueue: PendingInput[] = [];

  constructor(
    id: string,
    name: string,
    color: string,
    spawnX: number,
    spawnY: number,
    isPlayer: boolean,
    loadout?: PlayerLoadoutConfig,
    sessionId?: string
  ) {
    const angle = Math.random() * Math.PI * 2;
    const segments: Point[] = [];
    for (let i = 0; i < INITIAL_SNAKE_LENGTH; i++) {
      segments.push({
        x: spawnX - i * SEGMENT_DISTANCE * Math.cos(angle),
        y: spawnY - i * SEGMENT_DISTANCE * Math.sin(angle),
      });
    }

    this.prevHead = { x: spawnX, y: spawnY };

    this.data = {
      id,
      sessionId,
      name,
      color,
      segments,
      angle,
      targetAngle: angle,
      speed: BASE_SPEED,
      length: INITIAL_SNAKE_LENGTH,
      isPlayer,
      score: 0,
      isBoosting: false,
      powerupInventory: {
        SIZE: 0,
        SPEED: 0,
        ANGEL: 0,
        MAGNET: 0,
        SCOUTER: 0,
        SLICER: 0,
        USURPER: 0,
        STALKER: 0,
      },
      speedBoostEndTime: 0,
      invincibilityEndTime: Date.now() + 2500, // 2.5s safe spawn protection
      magnetEndTime: 0,
      scouterEndTime: 0,
      slicerEndTime: 0,
      usurperEndTime: 0,
      stalkerEndTime: 0,
      lastKnifeTime: 0,
      lastInputSequence: 0,
      lastInputTime: Date.now(),
      loadout,
    };
  }

  public queueInput(sequence: number, direction: number, boost: boolean): void {
    // Sanitize values
    if (isNaN(direction) || !isFinite(direction)) return;

    // Normalize angle
    let safeDir = direction % (Math.PI * 2);
    if (safeDir > Math.PI) safeDir -= Math.PI * 2;
    if (safeDir < -Math.PI) safeDir += Math.PI * 2;

    this.inputQueue.push({
      sequence,
      direction: safeDir,
      boost: Boolean(boost),
      timestamp: Date.now(),
    });

    // Guard against queue bloating
    if (this.inputQueue.length > 20) {
      this.inputQueue = this.inputQueue.slice(-20);
    }
  }

  public processInputs(): void {
    if (this.inputQueue.length === 0) return;

    // Process all pending inputs in order
    for (const input of this.inputQueue) {
      this.data.targetAngle = input.direction;
      this.data.isBoosting = input.boost;
      this.data.lastInputSequence = input.sequence;
      this.data.lastInputTime = input.timestamp;
    }
    this.inputQueue = [];
  }

  public updateMovement(dt: number, now: number): { droppedFood?: Point } {
    // Process active powerup queue
    this.processPowerupQueue(now);

    // Smooth turn towards targetAngle
    let angleDiff = this.data.targetAngle - this.data.angle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    this.data.angle += angleDiff * TURN_SPEED * dt;

    let currentBaseSpeed = BASE_SPEED;
    if (this.data.speedBoostEndTime > now) {
      currentBaseSpeed *= SPECIAL_SPEED_MULTIPLIER;
    }

    let droppedFood: Point | undefined = undefined;

    // Boosting consumes small length
    if (this.data.isBoosting && this.data.segments.length > 5) {
      this.data.speed = currentBaseSpeed * (BOOST_SPEED / BASE_SPEED);
      if (Math.random() < Math.min(0.5, 0.1 * dt)) {
        this.data.length = Math.max(5, this.data.length - 0.1);
        const tail = this.data.segments[this.data.segments.length - 1];
        if (tail) {
          droppedFood = { x: tail.x, y: tail.y };
        }
      }
    } else {
      this.data.speed = currentBaseSpeed;
    }

    const head = this.data.segments[0];
    this.prevHead = { x: head.x, y: head.y };
    const newHead: Point = {
      x: head.x + Math.cos(this.data.angle) * this.data.speed * dt,
      y: head.y + Math.sin(this.data.angle) * this.data.speed * dt,
    };

    // Add new head segment
    this.data.segments.unshift(newHead);

    // Trim tail to match authoritative length
    while (this.data.segments.length > Math.ceil(this.data.length)) {
      this.data.segments.pop();
    }

    return { droppedFood };
  }

  public isOutOfBounds(): boolean {
    const head = this.data.segments[0];
    return head.x < 0 || head.x > WORLD_WIDTH || head.y < 0 || head.y > WORLD_HEIGHT;
  }

  private processPowerupQueue(now: number): void {
    const types: SpecialItemType[] = ['SPEED', 'ANGEL', 'MAGNET', 'SCOUTER', 'SLICER', 'USURPER', 'STALKER'];

    for (const type of types) {
      let endTimeKey: keyof Snake;
      switch (type) {
        case 'SPEED':
          endTimeKey = 'speedBoostEndTime';
          break;
        case 'ANGEL':
          endTimeKey = 'invincibilityEndTime';
          break;
        case 'MAGNET':
          endTimeKey = 'magnetEndTime';
          break;
        case 'SCOUTER':
          endTimeKey = 'scouterEndTime';
          break;
        case 'SLICER':
          endTimeKey = 'slicerEndTime';
          break;
        case 'USURPER':
          endTimeKey = 'usurperEndTime';
          break;
        case 'STALKER':
          endTimeKey = 'stalkerEndTime';
          break;
        default:
          continue;
      }

      const currentEndTime = this.data[endTimeKey] as number;
      if (now > currentEndTime && this.data.powerupInventory[type] > 0) {
        this.data.powerupInventory[type]--;
        const duration = SPECIAL_ITEMS_CONFIG[type].durationMs || 10000;
        (this.data as any)[endTimeKey] = now + duration;
        if (type === 'SLICER') this.data.lastKnifeTime = 0;
      }
    }

    if (this.data.powerupInventory.SIZE > 0) {
      this.data.length *= 2;
      this.data.score += 500;
      this.data.powerupInventory.SIZE--;
    }
  }

  public toSnapshot(): SnakeSnapshot {
    return {
      id: this.data.id,
      name: this.data.name,
      color: this.data.color,
      segments: this.data.segments.map((s) => ({ x: Math.round(s.x), y: Math.round(s.y) })),
      angle: Number(this.data.angle.toFixed(3)),
      speed: Number(this.data.speed.toFixed(2)),
      length: Math.round(this.data.length),
      isPlayer: this.data.isPlayer,
      score: Math.floor(this.data.score),
      isBoosting: this.data.isBoosting,
      powerupInventory: { ...this.data.powerupInventory },
      speedBoostEndTime: this.data.speedBoostEndTime,
      invincibilityEndTime: this.data.invincibilityEndTime,
      magnetEndTime: this.data.magnetEndTime,
      scouterEndTime: this.data.scouterEndTime,
      slicerEndTime: this.data.slicerEndTime,
      usurperEndTime: this.data.usurperEndTime,
      stalkerEndTime: this.data.stalkerEndTime,
    };
  }
}
