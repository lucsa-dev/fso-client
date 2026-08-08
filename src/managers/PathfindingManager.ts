import type { GridPosition } from "@/types/MapTypes";
import { GridUtils } from "@/utils/GridUtils";

interface AStarNode {
  position: GridPosition;
  gCost: number;
  hCost: number;
  parent: AStarNode | null;
}

const fCost = (node: AStarNode): number => node.gCost + node.hCost;

/**
 * Minimal binary min-heap keyed by fCost. Plain array + linear scan would
 * also work at this map scale, but a heap keeps pathfinding O(log n) per
 * step as maps grow larger later.
 */
class MinHeap {
  private items: AStarNode[] = [];

  public get size(): number {
    return this.items.length;
  }

  public push(node: AStarNode): void {
    this.items.push(node);
    this.bubbleUp(this.items.length - 1);
  }

  public pop(): AStarNode | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last !== undefined) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  public contains(predicate: (node: AStarNode) => boolean): AStarNode | undefined {
    return this.items.find(predicate);
  }

  private bubbleUp(index: number): void {
    let i = index;
    while (i > 0) {
      const parentIndex = Math.floor((i - 1) / 2);
      const current = this.items[i];
      const parent = this.items[parentIndex];
      if (!current || !parent || fCost(parent) <= fCost(current)) {
        break;
      }
      this.items[i] = parent;
      this.items[parentIndex] = current;
      i = parentIndex;
    }
  }

  private bubbleDown(index: number): void {
    let i = index;
    const length = this.items.length;
    for (;;) {
      const left = i * 2 + 1;
      const right = i * 2 + 2;
      let smallest = i;

      const smallestNode = this.items[smallest];
      const leftNode = this.items[left];
      const rightNode = this.items[right];

      if (left < length && leftNode && smallestNode && fCost(leftNode) < fCost(smallestNode)) {
        smallest = left;
      }
      const currentSmallest = this.items[smallest];
      if (right < length && rightNode && currentSmallest && fCost(rightNode) < fCost(currentSmallest)) {
        smallest = right;
      }
      if (smallest === i) {
        break;
      }

      const temp = this.items[i];
      const swap = this.items[smallest];
      if (!temp || !swap) {
        break;
      }
      this.items[i] = swap;
      this.items[smallest] = temp;
      i = smallest;
    }
  }
}

/**
 * Grid-agnostic A* pathfinder. Takes a walkability grid explicitly on every
 * call rather than owning map state itself, so it stays reusable for any
 * future grid (a different map, a temporary obstacle overlay, etc.).
 */
export class PathfindingManager {
  private static readonly ORTHOGONAL_OFFSETS: GridPosition[] = [
    { x: 0, y: -1 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
  ];

  /**
   * Finds the shortest tile-by-tile path from `start` to `goal` using
   * orthogonal movement only (no diagonal cutting through walls).
   * Returns null when no path exists. The returned path excludes `start`
   * and includes `goal` as its final element.
   */
  public findPath(start: GridPosition, goal: GridPosition, walkableGrid: readonly boolean[][]): GridPosition[] | null {
    const height = walkableGrid.length;
    const width = height > 0 ? (walkableGrid[0]?.length ?? 0) : 0;

    if (!GridUtils.isInBounds(start, width, height) || !GridUtils.isInBounds(goal, width, height)) {
      return null;
    }
    if (!this.isWalkable(goal, walkableGrid)) {
      return null;
    }
    if (GridUtils.equals(start, goal)) {
      return [];
    }

    const open = new MinHeap();
    const closed = new Set<string>();
    const openLookup = new Map<string, AStarNode>();

    const startNode: AStarNode = {
      position: start,
      gCost: 0,
      hCost: GridUtils.manhattanDistance(start, goal),
      parent: null,
    };
    open.push(startNode);
    openLookup.set(this.key(start), startNode);

    while (open.size > 0) {
      const current = open.pop();
      if (!current) {
        break;
      }
      const currentKey = this.key(current.position);
      openLookup.delete(currentKey);

      if (GridUtils.equals(current.position, goal)) {
        return this.reconstructPath(current);
      }
      closed.add(currentKey);

      for (const offset of PathfindingManager.ORTHOGONAL_OFFSETS) {
        const neighborPos: GridPosition = {
          x: current.position.x + offset.x,
          y: current.position.y + offset.y,
        };
        const neighborKey = this.key(neighborPos);

        if (closed.has(neighborKey)) {
          continue;
        }
        if (!GridUtils.isInBounds(neighborPos, width, height)) {
          continue;
        }
        if (!this.isWalkable(neighborPos, walkableGrid)) {
          continue;
        }

        const tentativeGCost = current.gCost + 1;
        const existing = openLookup.get(neighborKey);

        if (!existing) {
          const neighborNode: AStarNode = {
            position: neighborPos,
            gCost: tentativeGCost,
            hCost: GridUtils.manhattanDistance(neighborPos, goal),
            parent: current,
          };
          open.push(neighborNode);
          openLookup.set(neighborKey, neighborNode);
        } else if (tentativeGCost < existing.gCost) {
          existing.gCost = tentativeGCost;
          existing.parent = current;
        }
      }
    }

    return null;
  }

  private isWalkable(position: GridPosition, grid: readonly boolean[][]): boolean {
    return grid[position.y]?.[position.x] === true;
  }

  private key(position: GridPosition): string {
    return `${position.x},${position.y}`;
  }

  private reconstructPath(endNode: AStarNode): GridPosition[] {
    const path: GridPosition[] = [];
    let node: AStarNode | null = endNode;
    while (node && node.parent) {
      path.push(node.position);
      node = node.parent;
    }
    return path.reverse();
  }
}
