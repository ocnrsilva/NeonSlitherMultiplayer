import {
  SpecialItem,
  SpecialItemType,
  Knife,
  LeaderboardEntry,
  Point,
} from '../shared/types';
import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  SPECIAL_ITEMS_CONFIG,
  AI_COUNT,
  FOOD_COUNT,
  KNIFE_SPEED,
  KNIFE_MAX_DISTANCE,
  VALUE_PER_SEGMENT,
} from '../shared/constants';
import { PlayerEntity } from './Player';
import { FoodSystem } from './Food';
import { SpatialGrid } from './SpatialGrid';
import { SpawnSystem } from './SpawnSystem';
import { CollisionSystem } from './CollisionSystem';

export class World {
  public players: Map<string, PlayerEntity> = new Map();
  public foodSystem: FoodSystem = new FoodSystem();
  public specialItems: SpecialItem[] = [];
  public knives: Knife[] = [];

  private spawnSystem = new SpawnSystem();
  private collisionSystem = new CollisionSystem();

  private foodGrid = new SpatialGrid<{ id: string; x: number; y: number; size: number; value: number }>();
  private segmentGrid = new SpatialGrid<{ id: string; x: number; y: number; snakeId: string; isHead: boolean }>();

  constructor() {
    this.init();
  }

  private init(): void {
    // Initial food spawn
    this.foodSystem.spawnRandom(FOOD_COUNT);

    // Initial special items spawn
    (Object.keys(SPECIAL_ITEMS_CONFIG) as SpecialItemType[]).forEach((type) => {
      const conf = SPECIAL_ITEMS_CONFIG[type];
      for (let i = 0; i < conf.max; i++) {
        this.specialItems.push(this.spawnSystem.spawnSpecialItem(type, this.specialItems));
      }
    });

    // Populate initial AI snakes
    this.maintainAIs();
  }

  public maintainAIs(): void {
    let aiCount = 0;
    for (const p of this.players.values()) {
      if (!p.data.isPlayer) aiCount++;
    }

    const needed = AI_COUNT - aiCount;
    for (let i = 0; i < needed; i++) {
      const id = `ai_${Math.random().toString(36).substring(2, 9)}`;
      const name = this.spawnSystem.getRandomAIName();
      const color = this.spawnSystem.getRandomColor();
      const spawn = this.spawnSystem.findSafeSpawn(Array.from(this.players.values()));

      const ai = new PlayerEntity(id, name, color, spawn.x, spawn.y, false);
      this.players.set(id, ai);
    }
  }

  public addPlayer(player: PlayerEntity): void {
    this.players.set(player.data.id, player);
  }

  public removePlayer(id: string): PlayerEntity | undefined {
    const player = this.players.get(id);
    if (player) {
      this.players.delete(id);
    }
    return player;
  }

  public getPlayer(id: string): PlayerEntity | undefined {
    return this.players.get(id);
  }

  public update(dt: number, now: number): {
    deadPlayers: { player: PlayerEntity; killerId?: string; reason: 'COLLISION' | 'BORDER' | 'STALKER' | 'KNIFE' }[];
  } {
    const deadPlayers: { player: PlayerEntity; killerId?: string; reason: 'COLLISION' | 'BORDER' | 'STALKER' | 'KNIFE' }[] = [];

    // 1. Process inputs for all players
    for (const player of this.players.values()) {
      player.processInputs();
    }

    // 2. AI logic
    this.updateAIs(now);

    // 3. Update movement
    const magnetSnakes: { head: Point; pullStrength?: number }[] = [];

    for (const player of this.players.values()) {
      const { droppedFood } = player.updateMovement(dt, now);
      if (droppedFood) {
        this.foodSystem.createFood(droppedFood.x, droppedFood.y, 0.5);
      }

      // Border check
      if (player.isOutOfBounds()) {
        deadPlayers.push({ player, reason: 'BORDER' });
      }

      if (player.data.magnetEndTime > now && player.data.segments[0]) {
        magnetSnakes.push({ head: player.data.segments[0] });
      }

      // Check Slicer knife firing (every 5s)
      if (player.data.slicerEndTime > now && now - player.data.lastKnifeTime > 5000) {
        this.fireKnife(player);
        player.data.lastKnifeTime = now;
      }
    }

    // 4. Update knives
    this.updateKnives(dt);

    // 5. Update food magnets
    this.foodSystem.updateMagnets(magnetSnakes, dt);

    // 6. Build spatial grids
    this.foodGrid.clear();
    for (const food of this.foodSystem.getAll()) {
      this.foodGrid.insert({
        id: food.id,
        x: food.x,
        y: food.y,
        size: food.size,
        value: food.value,
      });
    }

    this.segmentGrid.clear();
    for (const player of this.players.values()) {
      // Don't index segments if currently invincible
      const isInvincible = player.data.invincibilityEndTime > now;
      if (isInvincible) continue;

      const segs = player.data.segments;
      // Index segments (stride of 2 for efficiency)
      for (let i = 1; i < segs.length; i += 2) {
        const s = segs[i];
        this.segmentGrid.insert({
          id: `${player.data.id}_${i}`,
          x: s.x,
          y: s.y,
          snakeId: player.data.id,
          isHead: false,
        });
      }
    }

    // 7. Check collisions
    const activeSnakes = Array.from(this.players.values());

    // Head vs Food
    this.collisionSystem.checkFoodCollisions(activeSnakes, this.foodSystem, this.foodGrid);

    // Head vs Special Items
    this.collisionSystem.checkSpecialItemCollisions(activeSnakes, this.specialItems, now);

    // Knife vs Snakes
    const hitKnifeIds = this.collisionSystem.checkKnifeCollisions(this.knives, activeSnakes, this.foodSystem, now);
    if (hitKnifeIds.size > 0) {
      this.knives = this.knives.filter((k) => !hitKnifeIds.has(k.id));
    }

    // Snake vs Snake bodies
    const snakeCollisions = this.collisionSystem.checkSnakeCollisions(activeSnakes, this.segmentGrid, now);
    for (const c of snakeCollisions) {
      deadPlayers.push({ player: c.snake, killerId: c.killerId, reason: c.reason });
    }

    // 8. Process deaths
    const deadIds = new Set<string>();
    for (const dead of deadPlayers) {
      if (deadIds.has(dead.player.data.id)) continue;
      deadIds.add(dead.player.data.id);
      this.killPlayer(dead.player);
    }

    // 9. Respawn items and maintain entities
    this.spawnSystem.checkItemRespawns(this.specialItems, now);
    if (this.foodSystem.count() < FOOD_COUNT) {
      this.foodSystem.spawnRandom(Math.min(25, FOOD_COUNT - this.foodSystem.count()));
    }
    this.maintainAIs();

    return { deadPlayers };
  }

  private fireKnife(player: PlayerEntity): void {
    const head = player.data.segments[0];
    if (!head) return;

    this.knives.push({
      id: `k_${Math.random().toString(36).substring(2, 9)}`,
      x: head.x,
      y: head.y,
      angle: player.data.angle,
      ownerId: player.data.id,
      speed: KNIFE_SPEED,
      distanceTravelled: 0,
    });
  }

  private updateKnives(dt: number): void {
    this.knives = this.knives.filter((k) => {
      const step = k.speed * dt;
      k.x += Math.cos(k.angle) * step;
      k.y += Math.sin(k.angle) * step;
      k.distanceTravelled += step;

      if (k.x < 0 || k.x > WORLD_WIDTH || k.y < 0 || k.y > WORLD_HEIGHT) return false;
      return k.distanceTravelled <= KNIFE_MAX_DISTANCE;
    });
  }

  public killPlayer(player: PlayerEntity): void {
    // Drop food along snake body
    player.data.segments.forEach((seg, i) => {
      if (i % 2 === 0) {
        this.foodSystem.createFood(
          seg.x + (Math.random() - 0.5) * 20,
          seg.y + (Math.random() - 0.5) * 20,
          VALUE_PER_SEGMENT * 2
        );
      }
    });

    this.players.delete(player.data.id);
  }

  private updateAIs(now: number): void {
    const allSnakes = Array.from(this.players.values());

    for (const ai of allSnakes) {
      if (ai.data.isPlayer) continue;

      const head = ai.data.segments[0];
      if (!head) continue;
      ai.data.isBoosting = false;

      let obstacleDetected = false;
      const isInvincible = ai.data.invincibilityEndTime > now;

      if (!isInvincible) {
        for (const other of allSnakes) {
          if (other.data.id === ai.data.id) continue;
          for (let i = 0; i < other.data.segments.length; i += 4) {
            const seg = other.data.segments[i];
            const dx = seg.x - head.x;
            const dy = seg.y - head.y;
            const distSq = dx * dx + dy * dy;

            if (distSq < 130 * 130 && distSq > 0) {
              ai.data.targetAngle = Math.atan2(dy, dx) + Math.PI + (Math.random() - 0.5);
              obstacleDetected = true;
              if (distSq < 60 * 60) ai.data.isBoosting = true;
              break;
            }
          }
          if (obstacleDetected) break;
        }
      }

      if (!obstacleDetected) {
        // Find nearest food
        const nearbyFood = this.foodGrid.queryRadius(head, 400);
        if (nearbyFood.length > 0) {
          const nearest = nearbyFood[0];
          ai.data.targetAngle = Math.atan2(nearest.y - head.y, nearest.x - head.x);
        } else if (Math.random() < 0.03) {
          ai.data.targetAngle += (Math.random() - 0.5) * 0.8;
        }
      }
    }
  }

  public getLeaderboard(): LeaderboardEntry[] {
    return Array.from(this.players.values())
      .sort((a, b) => b.data.score - a.data.score)
      .slice(0, 5)
      .map((p) => ({
        id: p.data.id,
        name: p.data.name,
        score: Math.floor(p.data.score),
        isPlayer: p.data.isPlayer,
      }));
  }
}
