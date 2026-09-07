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

  private enabledSpecialItems: Record<SpecialItemType, boolean> = {
    SIZE: true,
    SPEED: true,
    MAGNET: true,
    SCOUTER: true,
    ANGEL: false,
    SLICER: false,
    USURPER: false,
    STALKER: false,
  };

  constructor() {
    this.init();
  }

  private init(): void {
    // Initial food spawn
    this.foodSystem.spawnRandom(FOOD_COUNT);

    // Initial special items spawn (only enabled items)
    this.initSpecialItems();

    // Populate initial AI snakes
    this.maintainAIs();
  }

  private initSpecialItems(): void {
    this.specialItems = [];
    (Object.keys(SPECIAL_ITEMS_CONFIG) as SpecialItemType[]).forEach((type) => {
      if (this.enabledSpecialItems[type]) {
        const conf = SPECIAL_ITEMS_CONFIG[type];
        for (let i = 0; i < conf.max; i++) {
          this.specialItems.push(this.spawnSystem.spawnSpecialItem(type, this.specialItems));
        }
      }
    });
  }

  public syncEnabledItems(enabled: Record<SpecialItemType, boolean>): void {
    this.enabledSpecialItems = { ...enabled };

    // 1. Immediately remove any items in the world that are not enabled
    this.specialItems = this.specialItems.filter((item) => this.enabledSpecialItems[item.type] === true);

    // 2. For each enabled type, replace unavailable/stale items with fresh available ones
    // and ensure exactly conf.max available items exist in the world
    (Object.keys(SPECIAL_ITEMS_CONFIG) as SpecialItemType[]).forEach((type) => {
      if (this.enabledSpecialItems[type]) {
        const conf = SPECIAL_ITEMS_CONFIG[type];
        // Remove unavailable items of this type so fresh available ones spawn
        this.specialItems = this.specialItems.filter((item) => item.type !== type || item.isAvailable);

        const currentAvailable = this.specialItems.filter((item) => item.type === type && item.isAvailable).length;
        for (let i = currentAvailable; i < conf.max; i++) {
          this.specialItems.push(this.spawnSystem.spawnSpecialItem(type, this.specialItems));
        }
      }
    });
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
        this.foodSystem.createFood(droppedFood.x, droppedFood.y, 0.6667);
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
      // Index all segments (spacing = 5px) to guarantee zero gaps and accurate head-to-head / head-to-body collisions
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        this.segmentGrid.insert({
          id: `${player.data.id}_${i}`,
          x: s.x,
          y: s.y,
          snakeId: player.data.id,
          isHead: i === 0,
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
    const itemsToRespawn: SpecialItemType[] = [];
    this.specialItems = this.specialItems.filter((item) => {
      // Se o item nao esta mais habilitado, remove-o imediatamente
      if (!this.enabledSpecialItems[item.type]) return false;
      // Verifica se o item esta indisponivel e atingiu o tempo de respawn
      if (!item.isAvailable && item.respawnAt && now >= item.respawnAt) {
        itemsToRespawn.push(item.type);
        return false;
      }
      return true;
    });
    for (const type of itemsToRespawn) {
      if (this.enabledSpecialItems[type]) {
        this.specialItems.push(this.spawnSystem.spawnSpecialItem(type, this.specialItems));
      }
    }

    // Garante que cada tipo habilitado mantenha conf.max itens no mundo
    for (const type of Object.keys(SPECIAL_ITEMS_CONFIG) as SpecialItemType[]) {
      if (this.enabledSpecialItems[type]) {
        const conf = SPECIAL_ITEMS_CONFIG[type];
        const count = this.specialItems.filter((item) => item.type === type).length;
        for (let i = count; i < conf.max; i++) {
          this.specialItems.push(this.spawnSystem.spawnSpecialItem(type, this.specialItems));
        }
      }
    }

    // Dynamic food count matching offline
    let dynamicFoodTarget = FOOD_COUNT;
    let maxPlayerLength = 0;
    for (const player of this.players.values()) {
      if (player.data.isPlayer && player.data.length > maxPlayerLength) {
        maxPlayerLength = player.data.length;
      }
    }
    if (maxPlayerLength > 50) {
      dynamicFoodTarget += Math.floor((maxPlayerLength - 50) * 20);
      dynamicFoodTarget = Math.min(dynamicFoodTarget, 12000);
    }

    const currentFoodCount = this.foodSystem.count();
    if (currentFoodCount < dynamicFoodTarget) {
      const needed = dynamicFoodTarget - currentFoodCount;
      if (needed > 50) {
        const clusterSize = maxPlayerLength > 100 ? 40 : 15;
        const clusters = Math.min(8, Math.floor(needed / clusterSize));
        for (let i = 0; i < clusters; i++) {
          this.foodSystem.spawnCluster(
            clusterSize,
            {
              x: Math.random() * (WORLD_WIDTH - 1000) + 500,
              y: Math.random() * (WORLD_HEIGHT - 1000) + 500,
            },
            300
          );
        }
      } else {
        this.foodSystem.spawnRandom(Math.min(25, needed));
      }
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

      // 1. Desvio de obstaculo contra o corpo de outras cobras
      if (!isInvincible) {
        for (const other of allSnakes) {
          if (other.data.id === ai.data.id) continue;
          for (let i = 0; i < other.data.segments.length; i += 5) {
            const seg = other.data.segments[i];
            const dx = seg.x - head.x;
            const dy = seg.y - head.y;
            const distSq = dx * dx + dy * dy;

            if (distSq < 120 * 120 && distSq > 0) {
              ai.data.targetAngle = Math.atan2(dy, dx) + Math.PI + (Math.random() - 0.5);
              obstacleDetected = true;
              if (distSq < 60 * 60) ai.data.isBoosting = true;
              break;
            }
          }
          if (obstacleDetected) break;
        }
      }

      let hasTarget = false;

      // 2. Comportamento predatorio (Stalker ou Usurper ativo)
      const isStalker = ai.data.stalkerEndTime > now;
      const isUsurper = ai.data.usurperEndTime > now;
      if (!obstacleDetected && (isStalker || isUsurper)) {
        let target: PlayerEntity | null = null;
        let minDistSq = 1200 * 1200;
        for (const other of allSnakes) {
          if (other.data.id === ai.data.id) continue;
          const otherHead = other.data.segments[0];
          if (!otherHead) continue;
          const d = (head.x - otherHead.x) ** 2 + (head.y - otherHead.y) ** 2;
          if (d < minDistSq) {
            minDistSq = d;
            target = other;
          }
        }
        if (target && target.data.segments[0]) {
          const targetHead = target.data.segments[0];
          ai.data.targetAngle = Math.atan2(targetHead.y - head.y, targetHead.x - head.x);
          if (minDistSq < 400 * 400) ai.data.isBoosting = true;
          hasTarget = true;
        }
      }

      // 3. Comportamento de ataque com Fatiador (Slicer ativo)
      const isSlicer = ai.data.slicerEndTime > now;
      if (!obstacleDetected && !hasTarget && isSlicer) {
        let target: PlayerEntity | null = null;
        for (const other of allSnakes) {
          if (other.data.id === ai.data.id) continue;
          const otherHead = other.data.segments[0];
          if (!otherHead) continue;
          const d = (head.x - otherHead.x) ** 2 + (head.y - otherHead.y) ** 2;
          if (d < 500 * 500) {
            target = other;
            break;
          }
        }
        if (target && target.data.segments[0]) {
          const targetHead = target.data.segments[0];
          ai.data.targetAngle = Math.atan2(targetHead.y - head.y, targetHead.x - head.x);
          hasTarget = true;
        }
      }

      // 4. Busca ativa por power-ups / itens especiais habilitados
      const totalInventory = Object.values(ai.data.powerupInventory).reduce((a: number, b: number) => a + b, 0);
      const lowInventory = totalInventory < 3;
      if (!obstacleDetected && !hasTarget && (lowInventory || Math.random() < 0.2)) {
        let closestItem: SpecialItem | null = null;
        let minD = lowInventory ? 2000 * 2000 : 1000 * 1000;
        for (const item of this.specialItems) {
          if (!item.isAvailable || !this.enabledSpecialItems[item.type]) continue;
          const d = (head.x - item.x) ** 2 + (head.y - item.y) ** 2;
          if (d < minD) {
            minD = d;
            closestItem = item;
          }
        }
        if (closestItem) {
          ai.data.targetAngle = Math.atan2(closestItem.y - head.y, closestItem.x - head.x);
          if (minD < 300 * 300) ai.data.isBoosting = true;
          hasTarget = true;
        }
      }

      // 5. Busca de comida ponderada por valor (exatamente como offline)
      if (!obstacleDetected && !hasTarget && Math.random() < 0.05) {
        let closestFood: Point | null = null;
        let minD = 600 * 600;
        const nearbyFoods = this.foodGrid.queryRadius(head, 600);
        for (let i = 0; i < Math.min(nearbyFoods.length, 150); i++) {
          const f = nearbyFoods[i];
          const d = (head.x - f.x) ** 2 + (head.y - f.y) ** 2;
          const weight = f.value > 10 ? 4 : f.value > 3 ? 2 : 1;
          if (d / weight < minD) {
            minD = d / weight;
            closestFood = { x: f.x, y: f.y };
          }
        }
        if (closestFood) {
          ai.data.targetAngle = Math.atan2(closestFood.y - head.y, closestFood.x - head.x);
        }
      }

      // 6. Evitacao de bordas do mapa
      const borderMargin = 400;
      if (head.x < borderMargin) ai.data.targetAngle = 0;
      else if (head.x > WORLD_WIDTH - borderMargin) ai.data.targetAngle = Math.PI;
      else if (head.y < borderMargin) ai.data.targetAngle = Math.PI / 2;
      else if (head.y > WORLD_HEIGHT - borderMargin) ai.data.targetAngle = -Math.PI / 2;
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
