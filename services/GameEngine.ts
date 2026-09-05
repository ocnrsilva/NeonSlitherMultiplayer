
import { Point, Snake, Food, GameState, SpecialItem, SpecialItemType, TrailParticle, Knife } from '../types';
import { 
  WORLD_SIZE, 
  INITIAL_SNAKE_LENGTH, 
  SEGMENT_DISTANCE, 
  BASE_SPEED, 
  BOOST_SPEED, 
  TURN_SPEED, 
  FOOD_COUNT, 
  AI_COUNT,
  COLORS,
  NAMES,
  SPECIAL_ITEMS_CONFIG,
  SPECIAL_SPEED_MULTIPLIER,
  MAGNET_RADIUS,
  MAGNET_PULL_STRENGTH,
  FOOD_TIERS,
  KNIFE_SPEED,
  KNIFE_MAX_DISTANCE
} from '../constants';

export class GameEngine {
  public state: GameState;
  private lastUpdate: number = 0;
  private readonly VALUE_PER_SEGMENT = 6.6667;
  private enabledSpecialItems: Record<SpecialItemType, boolean>;

  constructor(enabledItems: Record<SpecialItemType, boolean>) {
    this.enabledSpecialItems = enabledItems;
    this.state = {
      player: null,
      snakes: [],
      foods: [],
      specialItems: [],
      trails: [],
      knives: [],
      worldSize: WORLD_SIZE,
      isGameOver: false
    };
    this.init();
  }

  private init() {
    this.maintainEntities(0); 
    for (let i = 0; i < AI_COUNT; i++) {
      this.spawnSnake(false);
    }
    this.initSpecialItems();
  }

  private initSpecialItems() {
    (Object.keys(SPECIAL_ITEMS_CONFIG) as SpecialItemType[]).forEach(type => {
      // Apenas spawna se o item estiver habilitado pelo jogador
      if (this.enabledSpecialItems[type]) {
        const config = SPECIAL_ITEMS_CONFIG[type];
        for (let i = 0; i < config.max; i++) {
          this.spawnSpecialItem(type);
        }
      }
    });
  }

  private spawnSpecialItem(type: SpecialItemType) {
    let x = 0, y = 0;
    let attempts = 0;
    const minDistance = 750;

    while (attempts < 50) {
      x = Math.random() * (WORLD_SIZE - 600) + 300;
      y = Math.random() * (WORLD_SIZE - 600) + 300;
      let tooClose = false;
      for (const item of this.state.specialItems) {
        const dx = item.x - x; const dy = item.y - y;
        if (dx * dx + dy * dy < minDistance * minDistance) { tooClose = true; break; }
      }
      if (!tooClose) break;
      attempts++;
    }

    this.state.specialItems.push({
      id: Math.random().toString(36).substr(2, 9),
      x, y, type, isAvailable: true
    });
  }

  public spawnPlayer(name: string) {
    const player = this.createSnake(name, true);
    player.invincibilityEndTime = performance.now() + 2000;
    this.state.player = player;
    this.state.snakes.push(player);
    this.state.isGameOver = false;
    return player;
  }

  private spawnSnake(isPlayer: boolean) {
    const name = NAMES[Math.floor(Math.random() * NAMES.length)];
    const snake = this.createSnake(name, isPlayer);
    this.state.snakes.push(snake);
  }

  private createSnake(name: string, isPlayer: boolean): Snake {
    const x = Math.random() * (WORLD_SIZE - 400) + 200;
    const y = Math.random() * (WORLD_SIZE - 400) + 200;
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const angle = Math.random() * Math.PI * 2;
    const segments: Point[] = [];
    for (let i = 0; i < INITIAL_SNAKE_LENGTH; i++) {
      segments.push({ x: x - i * SEGMENT_DISTANCE * Math.cos(angle), y: y - i * SEGMENT_DISTANCE * Math.sin(angle) });
    }
    return {
      id: Math.random().toString(36).substr(2, 9),
      name, color, segments, angle, targetAngle: angle, speed: BASE_SPEED, length: INITIAL_SNAKE_LENGTH,
      isPlayer, score: 0, isBoosting: false,
      powerupInventory: {
        SIZE: 0, SPEED: 0, ANGEL: 0, MAGNET: 0, SCOUTER: 0, SLICER: 0, USURPER: 0, STALKER: 0
      },
      speedBoostEndTime: 0, invincibilityEndTime: 0, magnetEndTime: 0, scouterEndTime: 0,
      slicerEndTime: 0, usurperEndTime: 0, stalkerEndTime: 0, lastKnifeTime: 0
    };
  }

  private spawnFood(count: number, x?: number, y?: number, radius: number = 0) {
    for (let i = 0; i < count; i++) {
      let fx, fy;
      if (x !== undefined && y !== undefined) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * radius;
        fx = Math.max(10, Math.min(WORLD_SIZE - 10, x + Math.cos(angle) * dist));
        fy = Math.max(10, Math.min(WORLD_SIZE - 10, y + Math.sin(angle) * dist));
      } else {
        fx = Math.random() * WORLD_SIZE; fy = Math.random() * WORLD_SIZE;
      }
      this.state.foods.push(this.createFood(fx, fy));
    }
  }

  private createFood(x: number, y: number, manualValue?: number): Food {
    let tier = FOOD_TIERS.NORMAL;
    const rand = Math.random();
    if (manualValue === undefined) {
      if (rand < FOOD_TIERS.RARE.probability) tier = FOOD_TIERS.RARE;
      else if (rand < FOOD_TIERS.RARE.probability + FOOD_TIERS.LARGE.probability) tier = FOOD_TIERS.LARGE;
    }
    return {
      x, y,
      size: manualValue ? 3 + manualValue / 3 : tier.size,
      color: tier === FOOD_TIERS.RARE ? '#ffffff' : COLORS[Math.floor(Math.random() * COLORS.length)],
      value: manualValue ?? tier.value
    };
  }

  public update(now: number) {
    if (!this.lastUpdate) { this.lastUpdate = now; return; }
    const dt = Math.min(2.0, (now - this.lastUpdate) / 16.6);
    this.lastUpdate = now;
    this.updateSnakes(dt, now);
    this.updateFoodMagnet(dt, now);
    this.updateTrails(dt);
    this.updateKnives(dt);
    this.handleCollisions(now);
    this.updateAI(now);
    this.maintainEntities(now);
  }

  private updateSnakes(dt: number, now: number) {
    this.state.snakes.forEach(snake => {
      this.processPowerupQueue(snake, now);

      let angleDiff = snake.targetAngle - snake.angle;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      snake.angle += angleDiff * TURN_SPEED * dt;

      let currentBaseSpeed = BASE_SPEED;
      if (snake.speedBoostEndTime > now) currentBaseSpeed *= SPECIAL_SPEED_MULTIPLIER;

      if (snake.isBoosting && snake.segments.length > 5) {
        snake.speed = currentBaseSpeed * (BOOST_SPEED / BASE_SPEED);
        if (Math.random() < 0.1) {
          snake.length -= 0.1; 
          const tail = snake.segments.pop();
          if (tail) this.state.foods.push(this.createFood(tail.x, tail.y, 0.1 / 0.15));
        }
      } else {
        snake.speed = currentBaseSpeed;
      }

      const head = snake.segments[0];
      const newHead = {
        x: head.x + Math.cos(snake.angle) * snake.speed * dt,
        y: head.y + Math.sin(snake.angle) * snake.speed * dt
      };

      if (newHead.x < 0 || newHead.x > WORLD_SIZE || newHead.y < 0 || newHead.y > WORLD_SIZE) {
        this.killSnake(snake, now); return;
      }

      snake.segments.unshift(newHead);
      while (snake.segments.length > snake.length) snake.segments.pop();

      if (Math.random() < 0.4) {
        const tail = snake.segments[snake.segments.length - 1];
        this.state.trails.push({
          x: tail.x + (Math.random() - 0.5) * 10, y: tail.y + (Math.random() - 0.5) * 10,
          color: snake.color, life: 1.0, size: 2 + Math.random() * 3
        });
      }

      if (snake.slicerEndTime > now && now - snake.lastKnifeTime > 5000) {
        this.fireKnife(snake); snake.lastKnifeTime = now;
      }
    });
  }

  private processPowerupQueue(snake: Snake, now: number) {
    const types: SpecialItemType[] = ['SPEED', 'ANGEL', 'MAGNET', 'SCOUTER', 'SLICER', 'USURPER', 'STALKER'];
    
    types.forEach(type => {
      let endTimeKey: keyof Snake;
      switch(type) {
        case 'SPEED': endTimeKey = 'speedBoostEndTime'; break;
        case 'ANGEL': endTimeKey = 'invincibilityEndTime'; break;
        case 'MAGNET': endTimeKey = 'magnetEndTime'; break;
        case 'SCOUTER': endTimeKey = 'scouterEndTime'; break;
        case 'SLICER': endTimeKey = 'slicerEndTime'; break;
        case 'USURPER': endTimeKey = 'usurperEndTime'; break;
        case 'STALKER': endTimeKey = 'stalkerEndTime'; break;
        default: return;
      }

      const currentEndTime = snake[endTimeKey] as number;
      if (now > currentEndTime && snake.powerupInventory[type] > 0) {
        snake.powerupInventory[type]--;
        const duration = SPECIAL_ITEMS_CONFIG[type].durationMs || 10000;
        (snake as any)[endTimeKey] = now + duration;
        if (type === 'SLICER') snake.lastKnifeTime = 0;
      }
    });

    if (snake.powerupInventory.SIZE > 0) {
        snake.length *= 2;
        snake.score += 500;
        snake.powerupInventory.SIZE--;
    }
  }

  private fireKnife(snake: Snake) {
    const head = snake.segments[0];
    this.state.knives.push({
      id: Math.random().toString(36).substr(2, 9),
      x: head.x, y: head.y, angle: snake.angle, ownerId: snake.id,
      speed: KNIFE_SPEED, distanceTravelled: 0
    });
  }

  private updateKnives(dt: number) {
    this.state.knives = this.state.knives.filter(knife => {
      const step = knife.speed * dt;
      knife.x += Math.cos(knife.angle) * step;
      knife.y += Math.sin(knife.angle) * step;
      knife.distanceTravelled += step;
      if (knife.x < 0 || knife.x > WORLD_SIZE || knife.y < 0 || knife.y > WORLD_SIZE) return false;
      return knife.distanceTravelled <= KNIFE_MAX_DISTANCE;
    });
  }

  private updateTrails(dt: number) {
    this.state.trails.forEach(p => p.life -= 0.02 * dt);
    this.state.trails = this.state.trails.filter(p => p.life > 0);
    if (this.state.trails.length > 500) this.state.trails = this.state.trails.slice(-500);
  }

  private updateFoodMagnet(dt: number, now: number) {
    this.state.foods.forEach(food => {
      for (const snake of this.state.snakes) {
        if (snake.magnetEndTime > now) {
          const head = snake.segments[0];
          const dx = head.x - food.x; const dy = head.y - food.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < MAGNET_RADIUS * MAGNET_RADIUS) {
            const dist = Math.sqrt(distSq);
            if (dist > 5) {
              food.x += (dx / dist) * MAGNET_PULL_STRENGTH * dt;
              food.y += (dy / dist) * MAGNET_PULL_STRENGTH * dt;
            }
          }
        }
      }
    });
  }

  private handleCollisions(now: number) {
    this.state.snakes.forEach(snake => {
      const head = snake.segments[0];
      this.state.foods = this.state.foods.filter(food => {
        const distSq = (head.x - food.x) ** 2 + (head.y - food.y) ** 2;
        if (distSq < (food.size + 15) ** 2) {
          snake.length += food.value * 0.15;
          snake.score += Math.floor(food.value * 10);
          return false;
        }
        return true;
      });

      this.state.specialItems.forEach(item => {
        if (!item.isAvailable) return;
        const distSq = (head.x - item.x) ** 2 + (head.y - item.y) ** 2;
        if (distSq < 35 * 35) this.collectSpecialItem(snake, item, now);
      });
    });

    this.state.knives = this.state.knives.filter(knife => {
      let hit = false;
      for (const target of this.state.snakes) {
        if (target.id === knife.ownerId || target.invincibilityEndTime > now) continue;
        for (const seg of target.segments) {
          const distSq = (knife.x - seg.x)**2 + (knife.y - seg.y)**2;
          if (distSq < 25**2) { this.sliceSnake(target); hit = true; break; }
        }
        if (hit) break;
      }
      return !hit;
    });

    const snakesToKill = new Set<string>();
    const activeAttackers = new Set<string>();
    this.state.snakes.forEach(s => {
      if (s.usurperEndTime > now || s.stalkerEndTime > now) activeAttackers.add(s.id);
    });

    this.state.snakes.forEach(attacker => {
      if (snakesToKill.has(attacker.id) || attacker.invincibilityEndTime > now) return;
      const head = attacker.segments[0];
      const isHero = activeAttackers.has(attacker.id);

      for (const target of this.state.snakes) {
        if (attacker.id === target.id) continue;
        for (let i = 0; i < target.segments.length; i++) {
          const distSq = (head.x - target.segments[i].x) ** 2 + (head.y - target.segments[i].y) ** 2;
          if (distSq < 15 ** 2) {
            if (isHero) {
              attacker.length = target.length; attacker.score = target.score; attacker.color = target.color;
              attacker.invincibilityEndTime = now + 5000;
              if (attacker.stalkerEndTime > now) snakesToKill.add(target.id);
              else target.invincibilityEndTime = now + 1500;
              attacker.usurperEndTime = 0; attacker.stalkerEndTime = 0;
              return;
            } else {
              snakesToKill.add(attacker.id); return;
            }
          }
        }
      }
    });

    snakesToKill.forEach(id => {
      const s = this.state.snakes.find(sn => sn.id === id);
      if (s) this.killSnake(s, now);
    });
  }

  private sliceSnake(target: Snake) {
    if (target.length <= 5) return;
    target.score = Math.floor(target.score / 2);
    const slicePoint = Math.floor(target.length / 2);
    const lostSegments = target.segments.slice(slicePoint);
    target.length = slicePoint; target.segments = target.segments.slice(0, slicePoint);
    lostSegments.forEach((seg, i) => {
      if (i % 2 === 0) this.state.foods.push(this.createFood(seg.x + (Math.random()-0.5)*10, seg.y + (Math.random()-0.5)*10, this.VALUE_PER_SEGMENT * 2));
    });
  }

  private collectSpecialItem(snake: Snake, item: SpecialItem, now: number) {
    item.isAvailable = false;
    item.respawnAt = now + SPECIAL_ITEMS_CONFIG[item.type].respawnMs;
    snake.powerupInventory[item.type]++;
  }

  private killSnake(snake: Snake, now: number) {
    if (snake.invincibilityEndTime > now) return;
    if (this.state.player?.id === snake.id) this.state.isGameOver = true;
    snake.segments.forEach((seg, i) => {
      if (i % 2 === 0) this.state.foods.push(this.createFood(seg.x + (Math.random()-0.5)*20, seg.y + (Math.random()-0.5)*20, this.VALUE_PER_SEGMENT * 2));
    });
    this.state.snakes = this.state.snakes.filter(s => s.id !== snake.id);
  }

  private updateAI(now: number) {
    this.state.snakes.forEach(snake => {
      if (snake.isPlayer) return;
      const head = snake.segments[0];
      snake.isBoosting = false;

      let obstacleDetected = false;
      const isInvincible = snake.invincibilityEndTime > now;

      if (!isInvincible) {
        for (const other of this.state.snakes) {
          if (other.id === snake.id) continue;
          for (let i = 0; i < other.segments.length; i += 5) {
            const seg = other.segments[i];
            const dx = seg.x - head.x; const dy = seg.y - head.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < 120 * 120 && distSq > 0) {
              snake.targetAngle = Math.atan2(dy, dx) + Math.PI + (Math.random() - 0.5);
              obstacleDetected = true;
              if (distSq < 60 * 60) snake.isBoosting = true;
              break;
            }
          }
          if (obstacleDetected) break;
        }
      }

      const isStalker = snake.stalkerEndTime > now;
      const isUsurper = snake.usurperEndTime > now;
      
      if (!obstacleDetected && (isStalker || isUsurper)) {
        let target: Snake | null = null;
        let minDistSq = 1200 * 1200;
        this.state.snakes.forEach(other => {
          if (other.id === snake.id) return;
          const d = (head.x - other.segments[0].x)**2 + (head.y - other.segments[0].y)**2;
          if (d < minDistSq) { minDistSq = d; target = other; }
        });
        if (target) {
          const targetHead = target.segments[0];
          snake.targetAngle = Math.atan2(targetHead.y - head.y, targetHead.x - head.x);
          if (minDistSq < 400 * 400) snake.isBoosting = true;
          return;
        }
      }

      const isSlicer = snake.slicerEndTime > now;
      if (!obstacleDetected && isSlicer) {
        let target: Snake | null = null;
        this.state.snakes.forEach(other => {
           if (other.id === snake.id) return;
           const d = (head.x - other.segments[0].x)**2 + (head.y - other.segments[0].y)**2;
           if (d < 500 * 500) target = other;
        });
        if (target) {
          const targetHead = target.segments[0];
          snake.targetAngle = Math.atan2(targetHead.y - head.y, targetHead.x - head.x);
          return; 
        }
      }

      const totalInventory = Object.values(snake.powerupInventory).reduce((a: number, b: number) => a + b, 0);
      const lowInventory = totalInventory < 3;
      if (!obstacleDetected && (lowInventory || Math.random() < 0.2)) {
        let closestItem: SpecialItem | null = null;
        let minD = lowInventory ? 2000 * 2000 : 1000 * 1000;
        this.state.specialItems.forEach(item => {
          if (!item.isAvailable) return;
          const d = (head.x - item.x)**2 + (head.y - item.y)**2;
          if (d < minD) { minD = d; closestItem = item; }
        });
        if (closestItem) {
          snake.targetAngle = Math.atan2(closestItem.y - head.y, closestItem.x - head.x);
          if (minD < 300 * 300) snake.isBoosting = true;
          return;
        }
      }

      if (!obstacleDetected && Math.random() < 0.05) {
        let closestFood: Point | null = null;
        let minD = 600 * 600;
        for (let i = 0; i < Math.min(this.state.foods.length, 150); i++) {
          const f = this.state.foods[i];
          const d = (head.x - f.x)**2 + (head.y - f.y)**2;
          const weight = f.value > 10 ? 4 : (f.value > 3 ? 2 : 1);
          if (d / weight < minD) { minD = d / weight; closestFood = {x: f.x, y: f.y}; }
        }
        if (closestFood) snake.targetAngle = Math.atan2(closestFood.y - head.y, closestFood.x - head.x);
      }
      
      const borderMargin = 400;
      if (head.x < borderMargin) snake.targetAngle = 0;
      else if (head.x > WORLD_SIZE - borderMargin) snake.targetAngle = Math.PI;
      else if (head.y < borderMargin) snake.targetAngle = Math.PI/2;
      else if (head.y > WORLD_SIZE - borderMargin) snake.targetAngle = -Math.PI/2;
    });
  }

  private maintainEntities(now: number) {
    const player = this.state.player;
    let dynamicFoodTarget = FOOD_COUNT;
    if (player && player.length > 50) {
      dynamicFoodTarget += Math.floor((player.length - 50) * 20);
      dynamicFoodTarget = Math.min(dynamicFoodTarget, 12000);
    }
    if (this.state.foods.length < dynamicFoodTarget) {
      const needed = dynamicFoodTarget - this.state.foods.length;
      if (needed > 50) {
        const clusterSize = player && player.length > 100 ? 40 : 15;
        const clusters = Math.floor(needed / clusterSize);
        for (let i = 0; i < clusters; i++) this.spawnFood(clusterSize, Math.random() * WORLD_SIZE, Math.random() * WORLD_SIZE, 300);
      } else this.spawnFood(needed);
    }
    if (this.state.snakes.length < AI_COUNT + (this.state.player ? 1 : 0)) this.spawnSnake(false);
    
    const itemsToRespawn: SpecialItemType[] = [];
    this.state.specialItems = this.state.specialItems.filter(item => {
      // Verifica se o item ainda está habilitado antes de permitir o respawn
      if (!item.isAvailable && item.respawnAt && now >= item.respawnAt) { 
        if (this.enabledSpecialItems[item.type]) {
          itemsToRespawn.push(item.type); 
        }
        return false; 
      }
      return true;
    });
    itemsToRespawn.forEach(type => this.spawnSpecialItem(type));
  }
}
