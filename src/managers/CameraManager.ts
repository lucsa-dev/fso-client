import Phaser from "phaser";
import { CAMERA_LERP, CAMERA_ZOOM, CAMERA_ZOOM_MAX, CAMERA_ZOOM_MIN, CAMERA_ZOOM_STEP } from "@/utils/Constants";

/** localStorage key the current zoom is persisted under — a client-side UI preference, not account data, so it's kept separate from PlayerSession and survives logout. */
const ZOOM_STORAGE_KEY = "fso.cameraZoom";

/**
 * Wraps the scene's main camera: bounds it to the map, smooth-follows the
 * player, and controls zoom (persisted to localStorage so it survives
 * reloads — see `readStoredZoom`/`persistZoom`). Isolated so future
 * features (screen shake, cutscene pans) have a single place to extend.
 */
export class CameraManager {
  private readonly camera: Phaser.Cameras.Scene2D.Camera;
  private zoom = CameraManager.readStoredZoom() ?? CAMERA_ZOOM;

  public constructor(scene: Phaser.Scene) {
    this.camera = scene.cameras.main;
  }

  private static readStoredZoom(): number | null {
    try {
      const raw = localStorage.getItem(ZOOM_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const value = Number(raw);
      return Number.isFinite(value) ? Phaser.Math.Clamp(value, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX) : null;
    } catch {
      return null;
    }
  }

  private static persistZoom(value: number): void {
    try {
      localStorage.setItem(ZOOM_STORAGE_KEY, String(value));
    } catch {
      // localStorage unavailable (e.g. private browsing) — falls back to in-memory only.
    }
  }

  public setWorldBounds(widthPx: number, heightPx: number): void {
    this.camera.setBounds(0, 0, widthPx, heightPx);
  }

  /** Same as `setWorldBounds`, but for a rect that isn't anchored at the origin — used while two maps are visible side by side during a crossing transition. */
  public setWorldBoundsRect(x: number, y: number, widthPx: number, heightPx: number): void {
    this.camera.setBounds(x, y, widthPx, heightPx);
  }

  public follow(target: Phaser.GameObjects.GameObject): void {
    this.camera.setZoom(this.zoom);
    this.camera.startFollow(target, true, CAMERA_LERP, CAMERA_LERP);
  }

  /** Steps zoom in/out by `CAMERA_ZOOM_STEP`, clamped to `[CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX]` — used by the settings menu's zoom buttons. */
  public zoomIn(): void {
    this.setZoom(this.zoom + CAMERA_ZOOM_STEP);
  }

  public zoomOut(): void {
    this.setZoom(this.zoom - CAMERA_ZOOM_STEP);
  }

  private setZoom(value: number): void {
    this.zoom = Phaser.Math.Clamp(value, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);
    this.camera.setZoom(this.zoom);
    CameraManager.persistZoom(this.zoom);
  }

  /** Detaches the camera from whatever it was following — used to hand scrolling over to an explicit tween during a transition. */
  public stopFollow(): void {
    this.camera.stopFollow();
  }

  public get scrollX(): number {
    return this.camera.scrollX;
  }

  public get scrollY(): number {
    return this.camera.scrollY;
  }

  /** Nudges the current scroll position instantly, with no tween — used to keep the view stable when rebasing world coordinates. */
  public shiftScroll(dx: number, dy: number): void {
    this.camera.scrollX += dx;
    this.camera.scrollY += dy;
  }

  /** Animates scroll by a relative delta and resolves once it settles. Bypasses follow-lerp so the pan lands exactly on target. */
  public tweenScrollBy(scene: Phaser.Scene, dx: number, dy: number, duration: number): Promise<void> {
    return new Promise((resolve) => {
      scene.tweens.add({
        targets: this.camera,
        scrollX: this.camera.scrollX + dx,
        scrollY: this.camera.scrollY + dy,
        duration,
        ease: Phaser.Math.Easing.Cubic.InOut,
        onComplete: () => resolve(),
      });
    });
  }
}
