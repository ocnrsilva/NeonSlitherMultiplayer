import { Food, FoodSnapshot, Point } from '../shared/types';
import { FOOD_TIERS, COLORS, WORLD_WIDTH, WORLD_HEIGHT, MAGNET_RADIUS, MAGNET_PULL_STRENGTH } from '../shared/constants';

let foodIdCounter = 0;

export class FoodSystem {
  private foods: Map<string, Food> = new Map();

  public getAll(): Food[] {
    return Array.from(this.foods.values());
  }

  public get(id: string): Food | undefined {
    return this.foods.get(id);
  }

  public remove(id: string): boolean {
    return this.foods.delete(id);
  }

  public count(): number {
    return this.foods.size;
  }

  public clear(): void {
    this.foods.clear();
  }

  public createFood(x: number, y: number, manualValue?: number): Food {
    let tier = FOOD_TIERS.NORMAL;
    const rand = Math.random();
    if (manualValue === undefined) {
      if (rand < FOOD_TIERS.RARE.probability) tier = FOOD_TIERS.RARE;
      else if (rand < FOOD_TIERS.RARE.probability + FOOD_TIERS.LARGE.probability) tier = FOOD_TIERS.LARGE;
    }

    const id = `f_${++foodIdCounter}`;
    const food: Food = {
      id,
      x: Math.max(20, Math.min(WORLD_WIDTH - 20, x)),
      y: Math.max(20, Math.min(WORLD_HEIGHT - 20, y)),
      size: manualValue ? Math.min(15, 3 + manualValue / 3) : tier.size,
      color: tier === FOOD_TIERS.RARE ? '#ffffff' : COLORS[Math.floor(Math.random() * COLORS.length)],
      value: manualValue ?? tier.value,
    };

    this.foods.set(id, food);
    return food;
  }

  public spawnRandom(count: number): void {
    for (let i = 0; i < count; i++) {
      const x = Math.random() * (WORLD_WIDTH - 200) + 100;
      const y = Math.random() * (WORLD_HEIGHT - 200) + 100;
      this.createFood(x, y);
    }
  }

  public spawnCluster(count: number, center: Point, radius: number, valuePerItem?: number): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * radius;
      const x = center.x + Math.cos(angle) * dist;
      const y = center.y + Math.sin(angle) * dist;
      this.createFood(x, y, valuePerItem);
    }
  }

  public updateMagnets(magnetSnakes: { head: Point; pullStrength?: number }[], dt: number): void {
    if (magnetSnakes.length === 0) return;

    for (const food of this.foods.values()) {
      for (const snake of magnetSnakes) {
        const dx = snake.head.x - food.x;
        const dy = snake.head.y - food.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < MAGNET_RADIUS * MAGNET_RADIUS) {
          const dist = Math.sqrt(distSq);
          if (dist > 5) {
            const pull = (snake.pullStrength || MAGNET_PULL_STRENGTH) * dt;
            food.x += (dx / dist) * pull;
            food.y += (dy / dist) * pull;
          }
        }
      }
    }
  }

  public getSnapshotsInArea(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    centerX?: number,
    centerY?: number,
    maxCount = 2000
  ): FoodSnapshot[] {
    const matching: Food[] = [];
    for (const f of this.foods.values()) {
      if (f.x >= minX && f.x <= maxX && f.y >= minY && f.y <= maxY) {
        matching.push(f);
      }
    }

    if (matching.length > maxCount && centerX !== undefined && centerY !== undefined) {
      matching.sort((a, b) => {
        const da = (a.x - centerX) ** 2 + (a.y - centerY) ** 2;
        const db = (b.x - centerX) ** 2 + (b.y - centerY) ** 2;
        return da - db;
      });
      matching.length = maxCount;
    } else if (matching.length > maxCount) {
      matching.length = maxCount;
    }

    return matching.map((f) => ({
      x: Math.round(f.x),
      y: Math.round(f.y),
      size: f.size,
      color: f.color,
      value: f.value,
    }));
  }
}
