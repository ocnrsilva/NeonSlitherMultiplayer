import { SpecialItem, Knife, Point, SpecialItemType } from '../shared/types';
import { SPECIAL_ITEMS_CONFIG, VALUE_PER_SEGMENT } from '../shared/constants';
import { PlayerEntity } from './Player';
import { FoodSystem } from './Food';
import { SpatialGrid } from './SpatialGrid';

export interface CollisionResults {
  deadSnakes: { snake: PlayerEntity; killerId?: string; reason: 'COLLISION' | 'BORDER' | 'STALKER' | 'KNIFE' }[];
  knivesToRemove: Set<string>;
}

function distSqPointToSegment(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ddx = px - x1;
    const ddy = py - y1;
    return ddx * ddx + ddy * ddy;
  }
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lenSq));
  const projX = x0 + t * dx;
  const projY = y0 + t * dy;
  const ddx = px - projX;
  const ddy = py - projY;
  return ddx * ddx + ddy * ddy;
}

export class CollisionSystem {
  public checkFoodCollisions(
    snakes: PlayerEntity[],
    foodSystem: FoodSystem,
    foodGrid: SpatialGrid<{ id: string; x: number; y: number; size: number; value: number }>
  ): void {
    for (const player of snakes) {
      const head = player.data.segments[0];
      if (!head) continue;

      const eatRadius = 25;
      const nearbyFood = foodGrid.queryRadius(head, eatRadius);

      for (const food of nearbyFood) {
        if (foodSystem.remove(food.id)) {
          player.data.length += food.value * 0.15;
          player.data.score += Math.floor(food.value * 10);
        }
      }
    }
  }

  public checkSpecialItemCollisions(snakes: PlayerEntity[], items: SpecialItem[], now: number): void {
    for (const player of snakes) {
      const head = player.data.segments[0];
      if (!head) continue;

      for (const item of items) {
        if (!item.isAvailable) continue;
        const dx = head.x - item.x;
        const dy = head.y - item.y;
        if (dx * dx + dy * dy < 35 * 35) {
          // Collect item
          item.isAvailable = false;
          const config = SPECIAL_ITEMS_CONFIG[item.type];
          item.respawnAt = now + (config ? config.respawnMs : 60000);
          player.data.powerupInventory[item.type] = (player.data.powerupInventory[item.type] || 0) + 1;
        }
      }
    }
  }

  public checkKnifeCollisions(
    knives: Knife[],
    snakes: PlayerEntity[],
    foodSystem: FoodSystem,
    now: number
  ): Set<string> {
    const knivesToRemove = new Set<string>();

    for (const knife of knives) {
      let hit = false;
      for (const target of snakes) {
        if (target.data.id === knife.ownerId || target.data.invincibilityEndTime > now) continue;

        for (const seg of target.data.segments) {
          const dx = knife.x - seg.x;
          const dy = knife.y - seg.y;
          if (dx * dx + dy * dy < 25 * 25) {
            this.sliceSnake(target, foodSystem);
            hit = true;
            break;
          }
        }
        if (hit) break;
      }

      if (hit) {
        knivesToRemove.add(knife.id);
      }
    }

    return knivesToRemove;
  }

  private sliceSnake(target: PlayerEntity, foodSystem: FoodSystem): void {
    if (target.data.length <= 5) return;

    target.data.score = Math.floor(target.data.score / 2);
    const slicePoint = Math.floor(target.data.length / 2);
    const lostSegments = target.data.segments.slice(slicePoint);
    target.data.length = slicePoint;
    target.data.segments = target.data.segments.slice(0, slicePoint);

    lostSegments.forEach((seg, i) => {
      if (i % 2 === 0) {
        foodSystem.createFood(
          seg.x + (Math.random() - 0.5) * 10,
          seg.y + (Math.random() - 0.5) * 10,
          VALUE_PER_SEGMENT * 2
        );
      }
    });
  }

  public checkSnakeCollisions(
    snakes: PlayerEntity[],
    segmentGrid: SpatialGrid<{ id: string; x: number; y: number; snakeId: string; isHead: boolean }>,
    now: number
  ): { snake: PlayerEntity; killerId?: string; reason: 'COLLISION' | 'BORDER' | 'STALKER' | 'KNIFE' }[] {
    const deadSnakes: { snake: PlayerEntity; killerId?: string; reason: 'COLLISION' | 'BORDER' | 'STALKER' | 'KNIFE' }[] = [];
    const deadIds = new Set<string>();

    for (const attacker of snakes) {
      if (deadIds.has(attacker.data.id)) continue;
      if (attacker.data.invincibilityEndTime > now) continue;

      const head = attacker.data.segments[0];
      if (!head) continue;

      const isUsurper = attacker.data.usurperEndTime > now;
      const isStalker = attacker.data.stalkerEndTime > now;
      const isHero = isUsurper || isStalker;

      const COLLISION_RADIUS = 15;
      const radiusSq = COLLISION_RADIUS * COLLISION_RADIUS; // 225

      const p0 = attacker.prevHead || head;
      const p1 = head;

      const minX = Math.min(p0.x, p1.x) - COLLISION_RADIUS;
      const maxX = Math.max(p0.x, p1.x) + COLLISION_RADIUS;
      const minY = Math.min(p0.y, p1.y) - COLLISION_RADIUS;
      const maxY = Math.max(p0.y, p1.y) + COLLISION_RADIUS;

      const nearbySegments = segmentGrid.queryArea(minX, minY, maxX, maxY);

      for (const seg of nearbySegments) {
        if (seg.snakeId === attacker.data.id) continue; // Don't collide with self

        const distSq = distSqPointToSegment(seg.x, seg.y, p0.x, p0.y, p1.x, p1.y);
        if (distSq >= radiusSq) continue; // Effective collision radius strictly 15px

        const targetSnake = snakes.find((s) => s.data.id === seg.snakeId);
        if (!targetSnake) continue;

        if (isHero) {
          // Usurper / Stalker ability effect
          attacker.data.length = Math.max(attacker.data.length, targetSnake.data.length);
          attacker.data.score = Math.max(attacker.data.score, targetSnake.data.score);
          attacker.data.color = targetSnake.data.color;
          attacker.data.invincibilityEndTime = now + 4000;

          if (isStalker) {
            deadSnakes.push({ snake: targetSnake, killerId: attacker.data.id, reason: 'STALKER' });
            deadIds.add(targetSnake.data.id);
          } else {
            targetSnake.data.invincibilityEndTime = now + 1500;
          }

          attacker.data.usurperEndTime = 0;
          attacker.data.stalkerEndTime = 0;
          break;
        } else {
          // Standard lethal collision against another snake's body
          deadSnakes.push({ snake: attacker, killerId: targetSnake.data.id, reason: 'COLLISION' });
          deadIds.add(attacker.data.id);
          break;
        }
      }
    }

    return deadSnakes;
  }
}
