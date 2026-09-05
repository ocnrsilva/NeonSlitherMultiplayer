import { Point } from '../shared/types';
import { WORLD_WIDTH, WORLD_HEIGHT, GRID_CELL_SIZE } from '../shared/constants';

export class SpatialGrid<T extends { id: string; x: number; y: number }> {
  private cellSize: number;
  private cols: number;
  private rows: number;
  private cells: Map<number, Set<T>>;

  constructor(cellSize: number = GRID_CELL_SIZE) {
    this.cellSize = cellSize;
    this.cols = Math.ceil(WORLD_WIDTH / cellSize);
    this.rows = Math.ceil(WORLD_HEIGHT / cellSize);
    this.cells = new Map();
  }

  private getCellKey(col: number, row: number): number {
    return row * this.cols + col;
  }

  public clear(): void {
    this.cells.clear();
  }

  public insert(item: T): void {
    const col = Math.max(0, Math.min(this.cols - 1, Math.floor(item.x / this.cellSize)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor(item.y / this.cellSize)));
    const key = this.getCellKey(col, row);

    let cell = this.cells.get(key);
    if (!cell) {
      cell = new Set();
      this.cells.set(key, cell);
    }
    cell.add(item);
  }

  public queryRadius(center: Point, radius: number): T[] {
    const results: T[] = [];
    const minCol = Math.max(0, Math.floor((center.x - radius) / this.cellSize));
    const maxCol = Math.min(this.cols - 1, Math.floor((center.x + radius) / this.cellSize));
    const minRow = Math.max(0, Math.floor((center.y - radius) / this.cellSize));
    const maxRow = Math.min(this.rows - 1, Math.floor((center.y + radius) / this.cellSize));
    const radiusSq = radius * radius;

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const key = this.getCellKey(c, r);
        const cell = this.cells.get(key);
        if (!cell) continue;

        for (const item of cell) {
          const dx = item.x - center.x;
          const dy = item.y - center.y;
          if (dx * dx + dy * dy <= radiusSq) {
            results.push(item);
          }
        }
      }
    }

    return results;
  }

  public queryArea(minX: number, minY: number, maxX: number, maxY: number): T[] {
    const results: T[] = [];
    const minCol = Math.max(0, Math.floor(minX / this.cellSize));
    const maxCol = Math.min(this.cols - 1, Math.floor(maxX / this.cellSize));
    const minRow = Math.max(0, Math.floor(minY / this.cellSize));
    const maxRow = Math.min(this.rows - 1, Math.floor(maxY / this.cellSize));

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const key = this.getCellKey(c, r);
        const cell = this.cells.get(key);
        if (!cell) continue;

        for (const item of cell) {
          if (item.x >= minX && item.x <= maxX && item.y >= minY && item.y <= maxY) {
            results.push(item);
          }
        }
      }
    }

    return results;
  }
}
