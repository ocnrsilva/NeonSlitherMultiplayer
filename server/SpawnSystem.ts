import { Point, SpecialItem, SpecialItemType } from '../shared/types';
import { WORLD_WIDTH, WORLD_HEIGHT, SPECIAL_ITEMS_CONFIG, COLORS, NAMES } from '../shared/constants';
import { PlayerEntity } from './Player';

export class SpawnSystem {
  public findSafeSpawn(existingSnakes: PlayerEntity[]): Point {
    let bestPoint: Point = {
      x: Math.random() * (WORLD_WIDTH - 1000) + 500,
      y: Math.random() * (WORLD_HEIGHT - 1000) + 500,
    };
    let maxMinDistSq = 0;

    // Try up to 10 random candidates to find the one furthest from existing snake heads
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate: Point = {
        x: Math.random() * (WORLD_WIDTH - 1200) + 600,
        y: Math.random() * (WORLD_HEIGHT - 1200) + 600,
      };

      if (existingSnakes.length === 0) return candidate;

      let minDistSq = Infinity;
      for (const snake of existingSnakes) {
        const head = snake.data.segments[0];
        if (!head) continue;
        const dSq = (candidate.x - head.x) ** 2 + (candidate.y - head.y) ** 2;
        if (dSq < minDistSq) minDistSq = dSq;
      }

      if (minDistSq > maxMinDistSq) {
        maxMinDistSq = minDistSq;
        bestPoint = candidate;
        // If we are at least 800px away from the closest snake, that's already very safe
        if (minDistSq > 800 * 800) break;
      }
    }

    return bestPoint;
  }

  public getRandomColor(): string {
    return COLORS[Math.floor(Math.random() * COLORS.length)];
  }

  public getRandomAIName(): string {
    return NAMES[Math.floor(Math.random() * NAMES.length)];
  }

  public spawnSpecialItem(type: SpecialItemType, existingItems: SpecialItem[]): SpecialItem {
    let x = 0;
    let y = 0;
    let attempts = 0;
    const minDistance = 750;

    while (attempts < 30) {
      x = Math.random() * (WORLD_WIDTH - 800) + 400;
      y = Math.random() * (WORLD_HEIGHT - 800) + 400;
      let tooClose = false;
      for (const item of existingItems) {
        const dx = item.x - x;
        const dy = item.y - y;
        if (dx * dx + dy * dy < minDistance * minDistance) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) break;
      attempts++;
    }

    return {
      id: `item_${Math.random().toString(36).substring(2, 9)}`,
      x,
      y,
      type,
      isAvailable: true,
    };
  }

  public checkItemRespawns(items: SpecialItem[], now: number): void {
    for (const item of items) {
      if (!item.isAvailable && item.respawnAt && now >= item.respawnAt) {
        item.isAvailable = true;
        item.x = Math.random() * (WORLD_WIDTH - 800) + 400;
        item.y = Math.random() * (WORLD_HEIGHT - 800) + 400;
        item.respawnAt = undefined;
      }
    }
  }
}
