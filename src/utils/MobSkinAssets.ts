import ratoSpriteUrl from "@/assets/mobs/rato.png";
import kukaSpriteUrl from "@/assets/mobs/kuka.png";
import { MOB_STATIC_FRAME, PLAYER_SPRITE, getMobSkinPattern, type MobSkinId } from "@/utils/Constants";

/** Every mob skin's source image, keyed the same way as BootScene's own MOB_SKIN_URLS — kept separate so plain-DOM UI (which can't touch Phaser's texture cache) can render a preview without needing the game scene running. */
const MOB_SKIN_URLS: Record<MobSkinId, string> = {
  rato: ratoSpriteUrl,
  kuka: kukaSpriteUrl,
};

/**
 * Builds a small DOM element showing a mob skin's actual art, so a
 * user picking or reviewing a mob type can see it instead of just a label —
 * used by both MobEditorModal's skin picker and MapEditorPanel's mob type
 * list. "static" skins (rato) show their one full pose; "animated" skins
 * (kuka) are cropped to just the down-facing idle frame (row 0, col 0) out
 * of the walk sheet, the same frame Mob itself starts on.
 */
export function createMobSkinThumbnail(skin: MobSkinId, heightPx: number): HTMLDivElement {
  const thumb = document.createElement("div");
  thumb.style.cssText = `
    flex-shrink: 0;
    background-repeat: no-repeat;
    background-color: rgba(0, 0, 0, 0.25);
    image-rendering: pixelated;
    border-radius: 4px;
  `;

  const url = MOB_SKIN_URLS[skin];

  if (getMobSkinPattern(skin) === "static") {
    const scale = heightPx / MOB_STATIC_FRAME.HEIGHT;
    const widthPx = MOB_STATIC_FRAME.WIDTH * scale;
    thumb.style.width = `${widthPx}px`;
    thumb.style.height = `${heightPx}px`;
    thumb.style.backgroundImage = `url(${url})`;
    thumb.style.backgroundSize = `${widthPx}px ${heightPx}px`;
    return thumb;
  }

  // Crop to one frame: container is exactly one frame's on-screen size, and
  // the whole sheet is scaled up so that frame's native size matches it —
  // background-position (0, 0) then lands on row 0 / col 0 (down-facing
  // idle), and anything outside the container's own box is naturally
  // clipped without needing overflow:hidden.
  const scale = heightPx / PLAYER_SPRITE.FRAME_HEIGHT;
  const widthPx = PLAYER_SPRITE.FRAME_WIDTH * scale;
  thumb.style.width = `${widthPx}px`;
  thumb.style.height = `${heightPx}px`;
  thumb.style.backgroundImage = `url(${url})`;
  thumb.style.backgroundSize = `${PLAYER_SPRITE.FRAME_WIDTH * 4 * scale}px ${PLAYER_SPRITE.FRAME_HEIGHT * 3 * scale}px`;
  thumb.style.backgroundPosition = "0px 0px";
  return thumb;
}
