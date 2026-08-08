import {
  BRUSH_FILL_BLOCK,
  BRUSH_FILL_LAYER_INDEX,
  TILESET_BLOCK_PX,
  isBrushTilesetKey,
  loadTilesetBlocks,
  type TilesetBlock,
} from "@/utils/TilesetCatalog";
import { DEFAULT_MOB_SKIN, EMPTY_TILE_INDEX, isMobSkinId, MAX_PAINT_LAYERS, MOB_DRAG_DATA_TYPE } from "@/utils/Constants";
import { MobEditorModal } from "@/ui/MobEditorModal";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { createMobSkinThumbnail } from "@/utils/MobSkinAssets";
import type { MobAggressiveness, MobSpawnDef, MobTypeDef } from "@/types/MapTypes";

const AGGRESSIVENESS_LABELS: Record<MobAggressiveness, string> = {
  pacifico: "Pacífico",
  neutro: "Neutro",
  agressivo: "Agressivo",
};

/**
 * Width of the map editor's own content — palette, controls, etc. Fixed at
 * exactly what the swatch grid needs for 4 per row (SWATCH_DISPLAY_PX *
 * 4 + SWATCH_GAP_PX * 3 + the scroll area's own padding): 4 columns must
 * never regress to 3, so the tab strip's width (TAB_BAR_WIDTH_PX) is added
 * on top of this in MAP_EDITOR_PANEL_WIDTH_PX rather than carved out of
 * it — the content area's width is never a function of the tab strip's.
 */
const EDITOR_CONTENT_WIDTH_PX = 260;

/** How large each block swatch renders in the palette, regardless of its source pixel size. */
const SWATCH_DISPLAY_PX = 48;

/** Gap between swatches in the palette grid — also used to work out each swatch's row/column when laying out a multi-texture stamp (see `getSwatchGridPosition`). */
const SWATCH_GAP_PX = 6;

const SLOT_RADIO_GROUP_NAME = "map-editor-slot";

/** Width of the vertical tab strip docked to the content area's left edge — see `createTabBar`. Narrow because its labels are rotated vertical text, not because of any width pressure — see EDITOR_CONTENT_WIDTH_PX. */
const TAB_BAR_WIDTH_PX = 32;

/** Total docked panel width — also how much the game canvas shrinks by while it's open (see GameScene). Content area plus the tab strip, added rather than shared, so the palette's 4-column layout is never at the tab strip's mercy. */
export const MAP_EDITOR_PANEL_WIDTH_PX = EDITOR_CONTENT_WIDTH_PX + TAB_BAR_WIDTH_PX;

type EditorTabId = "editor" | "brushes" | "mobs" | "structures";

/** Order here is the tab strip's top-to-bottom order. "editor" is the existing map editor content (layers, palette, Save); the rest are placeholders — title only, no content yet. */
const TAB_DEFS: ReadonlyArray<{ id: EditorTabId; label: string }> = [
  { id: "editor", label: "Editor de Mapas" },
  { id: "brushes", label: "Pincéis" },
  { id: "mobs", label: "Mobs" },
  { id: "structures", label: "Estruturas" },
];

type PaintTool = "bucket" | "brush" | "random";

/** Per-block settings the controls section remembers: which layer, which tool, the Block flag, the Estrutural flag, the Alternar flag, and the random tool's density — restored the next time that same block is selected. */
export interface BlockConfig {
  layerIndex: number;
  tool: PaintTool;
  blocked: boolean;
  /** Marks this texture as structural — tiles already painted with it are skipped by the random fill tool instead of being overwritten. */
  structural: boolean;
  /** Marks this texture as blinking — every tile painted with it toggles visible/invisible once a second (see MapManager's blink timer) for as long as this stays checked. */
  alternating: boolean;
  /** 0-1 fraction of map tiles the random tool scatters this texture across. */
  randomDensity: number;
}

const DEFAULT_RANDOM_DENSITY = 0.3;

const DEFAULT_BLOCK_CONFIG: BlockConfig = {
  layerIndex: 0,
  tool: "brush",
  blocked: false,
  structural: false,
  alternating: false,
  randomDensity: DEFAULT_RANDOM_DENSITY,
};

/**
 * Tile indices marked Alternar across `blockConfigs` — the set MapManager
 * blinks visible/invisible once a second. A standalone function rather than
 * a method on the panel (unlike `getStructuralTileIndices`, which only
 * matters mid-paint while the panel is open) because blinking is a live map
 * effect: GameScene needs to derive it from the same `blockConfigs` map even
 * while the editor panel is closed, so the effect keeps running during
 * ordinary play.
 */
export function getAlternatingTileIndices(blockConfigs: ReadonlyMap<number, BlockConfig>): Set<number> {
  const alternatingTileIndices = new Set<number>();
  for (const [tileIndex, config] of blockConfigs) {
    if (config.alternating) {
      alternatingTileIndices.add(tileIndex);
    }
  }
  return alternatingTileIndices;
}

/** Icons for the tool-picker buttons in the controls section (brush / bucket / random) — same pictographs as the cursors above, sized for a small button. */
const BRUSH_ICON_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 28 28'>" +
  "<line x1='24' y1='4' x2='11' y2='17' stroke='#f2e9d0' stroke-width='4' stroke-linecap='round'/>" +
  "<path d='M11 17 L4 26 L13 21 Z' fill='#c9a24a' stroke='#f2e9d0' stroke-width='1'/>" +
  "</svg>";
const BUCKET_ICON_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 28 28'>" +
  "<rect x='5' y='4' width='16' height='3' rx='1' fill='#f2e9d0'/>" +
  "<path d='M6 7 L20 7 L18 17 L8 17 Z' fill='#f2e9d0'/>" +
  "<path d='M13 17 L11 25 L16 21 Z' fill='#2f6f8f' stroke='#f2e9d0' stroke-width='1'/>" +
  "</svg>";
const RANDOM_ICON_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 28 28'>" +
  "<rect x='4' y='4' width='20' height='20' rx='4' fill='none' stroke='#f2e9d0' stroke-width='2.5'/>" +
  "<circle cx='10' cy='10' r='2.1' fill='#f2e9d0'/>" +
  "<circle cx='18' cy='10' r='2.1' fill='#f2e9d0'/>" +
  "<circle cx='14' cy='14' r='2.1' fill='#f2e9d0'/>" +
  "<circle cx='10' cy='18' r='2.1' fill='#f2e9d0'/>" +
  "<circle cx='18' cy='18' r='2.1' fill='#f2e9d0'/>" +
  "</svg>";

/** Icon for the palette's "no texture" eraser swatch — a broom, drawn on the swatch's red background. */
const BROOM_ICON_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'>" +
  "<line x1='21' y1='2' x2='11' y2='15' stroke='#f2e9d0' stroke-width='3' stroke-linecap='round'/>" +
  "<path d='M11 15 L4 26 L9 27 L12.5 18 L15.5 18 L19 27 L24 26 Z' fill='#f2e9d0' stroke='#5a4326' stroke-width='1'/>" +
  "</svg>";

/** Icon for the mob list's edit button — a pencil, drawn on the button's transparent background. */
const EDIT_ICON_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 28 28'>" +
  "<path d='M19 4 L24 9 L10 23 L4 24 L5 18 Z' fill='none' stroke='#e8dcc0' stroke-width='2' stroke-linejoin='round' stroke-linecap='round'/>" +
  "<line x1='16' y1='7' x2='21' y2='12' stroke='#e8dcc0' stroke-width='2'/>" +
  "</svg>";

/** Icon for the mob list's delete button — a trash can, drawn on the button's transparent background. */
const TRASH_ICON_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 28 28'>" +
  "<path d='M6 8 L22 8 L20.5 25 L7.5 25 Z' fill='none' stroke='#e8dcc0' stroke-width='2' stroke-linejoin='round'/>" +
  "<line x1='4' y1='8' x2='24' y2='8' stroke='#e8dcc0' stroke-width='2' stroke-linecap='round'/>" +
  "<path d='M11 8 L11 4 L17 4 L17 8' fill='none' stroke='#e8dcc0' stroke-width='2' stroke-linejoin='round'/>" +
  "<line x1='11' y1='12' x2='11' y2='21' stroke='#e8dcc0' stroke-width='1.5' stroke-linecap='round'/>" +
  "<line x1='14' y1='12' x2='14' y2='21' stroke='#e8dcc0' stroke-width='1.5' stroke-linecap='round'/>" +
  "<line x1='17' y1='12' x2='17' y2='21' stroke='#e8dcc0' stroke-width='1.5' stroke-linecap='round'/>" +
  "</svg>";

/**
 * One selected texture's paint instructions, read straight from its own
 * remembered `BlockConfig` — see `MapEditorPanel.getSelectedPaints`.
 * `gridOffsetX`/`gridOffsetY` place it within the multi-texture stamp: the
 * same row/column layout the textures have in the palette itself, relative
 * to the top-left-most selected one (which sits at 0,0). `autoBorder` is
 * true only when this texture was selected via its "Pincéis"-tab swatch
 * (see `MapEditorPanel.isBrushTabSelection`) — GameScene uses it to decide
 * whether a brush stroke should also stamp the matching border ring (see
 * `MapManager.applyBrushBorder`); the very same texture painted via the
 * main palette instead paints on its own, with no border.
 */
export interface SelectedPaint {
  layerIndex: number;
  tileIndex: number;
  blocked: boolean;
  tool: PaintTool;
  randomDensity: number;
  gridOffsetX: number;
  gridOffsetY: number;
  autoBorder: boolean;
}

/**
 * Plain-DOM side panel for the map editor. Shows 5 numbered slot radio
 * buttons at the top, then a controls section (paint tool, the "Block" and
 * "Estrutural" flags, and the random tool's density slider) docked right
 * below those layer numbers, then the palette of every block from every
 * tileset under assets/tilesets. Clicking a block in the palette selects it
 * (replacing any previous selection); shift-clicking instead toggles that
 * block into/out of a multi-selection, so several textures can be active at
 * once, each keeping its own yellow border. The controls section always
 * edits the *focused* block — the one most recently clicked — and every
 * other selected block keeps whatever settings it already had; nothing
 * about batch-selecting a block changes its own remembered config. While
 * anything is selected, the game canvas's cursor and hover highlight
 * reflect the tools in play across the whole selection (see
 * `getHoverHighlightMode`). A Save button is pinned to the bottom of the
 * panel and persists the map (see the `onSave` callback). GameScene reads
 * `getHoverHighlightMode()` and `getSelectedPaints()` off this panel to
 * paint the map as the brush is used — one paint action per selected
 * texture, each using that texture's own layer/tool/Block/density.
 *
 * Each block remembers its own last-used layer/tool/Block settings
 * (`blockConfigs`, keyed by tile index) — selecting a block restores
 * whatever was last configured for it instead of carrying over whatever
 * was selected before. That map is owned by the caller (see GameScene) and
 * passed in rather than created here, because the panel itself gets
 * destroyed and recreated every time the editor is toggled or a Save
 * completes — keeping the map outside the instance is what makes those
 * remembered settings survive a close/reopen instead of resetting.
 * `onConfigChange` fires after every edit to that map so the caller can
 * mirror it to localStorage (see MapEditorSession) and survive a reload too.
 */
export class MapEditorPanel {
  private readonly element: HTMLDivElement;
  private readonly tabButtons = new Map<EditorTabId, HTMLButtonElement>();
  private readonly tabContents = new Map<EditorTabId, HTMLDivElement>();
  private readonly paletteEl: HTMLDivElement;
  private readonly brushPaletteEl: HTMLDivElement;
  private readonly controlsEl: HTMLDivElement;
  private readonly controlsPlaceholder: HTMLDivElement;
  private readonly bucketButton: HTMLButtonElement;
  private readonly brushButton: HTMLButtonElement;
  private readonly randomButton: HTMLButtonElement;
  private readonly blockCheckbox: HTMLInputElement;
  private readonly structuralCheckbox: HTMLInputElement;
  private readonly alternatingCheckbox: HTMLInputElement;
  private readonly densityRow: HTMLDivElement;
  private readonly densitySlider: HTMLInputElement;
  private readonly densityValueLabel: HTMLSpanElement;
  private readonly slotRadios: HTMLInputElement[] = [];
  private readonly onSave: () => void;
  private readonly onClose: () => void;
  private readonly blockConfigs: Map<number, BlockConfig>;
  private readonly onConfigChange: () => void;
  /** Live reference to the current map's MobTypeDef catalog (mapManager.getMapData().mobTypes) — pushing into it here already persists it, same as every other mapData mutation the editor makes. */
  private readonly mobTypes: MobTypeDef[];
  /** Live reference to the current map's MobSpawnDef list (mapManager.getMapData().mobSpawns) — read to count how many placed instances a mob type has, and spliced when deleting a type cascades into deleting its spawns too. */
  private readonly mobSpawns: MobSpawnDef[];
  /** Fired with every spawn id removed by a mob-type deletion, so the caller (GameScene) can tear down the matching on-screen sprite (editor preview or live server mob) — this panel only owns the data, not the map's visuals. */
  private readonly onMobSpawnsRemoved: (removedSpawnIds: string[]) => void;
  private readonly mobListEl: HTMLDivElement;
  /** Which tab is currently showing — see `showTab`. Read by GameScene (`getActiveTab`) to decide whether the footer eraser erases a texture (any other tab) or a placed mob (the Mobs tab) — see `isEraserSelected`. */
  private activeTab: EditorTabId = "editor";

  /**
   * Every currently selected swatch, tileIndex -> element, in selection
   * order — insertion order also decides which one becomes focused when the
   * current focus is removed. An "M" tileset's fill block has two separate
   * swatch elements sharing this one tile index, one in the main palette
   * and one in the "Pincéis" tab (see `populatePalette`); they are
   * independent selections, not kept in sync, and which one is stored here
   * is exactly what `isBrushTabSelection` reads to decide whether the
   * current selection gets brush treatment (locked layer, auto-border) or
   * behaves like any other block.
   */
  private readonly selectedSwatches = new Map<number, HTMLDivElement>();
  /** The most recently (shift-)clicked selected block — the one the controls section below the layer numbers is currently editing. */
  private focusedTileIndex: number | null = null;
  private selectedTool: PaintTool = "brush";
  private selectedSlot = 1;
  private selectedDensity = DEFAULT_RANDOM_DENSITY;

  /**
   * `bottomInsetPx` should be `BOTTOM_BAR_HEIGHT_PX` only while the bottom
   * bar is actually expanded, 0 while it's collapsed (its default state,
   * especially on mobile) — otherwise the panel reserves dead space for a
   * bar that isn't visibly there, leaving a block of empty background below
   * the Save button and stealing that height from the scrollable palette
   * above it. See `setBottomInset` for keeping this in sync if the bottom
   * bar's collapsed state changes while the panel is already open.
   */
  public constructor(
    onSave: () => void,
    blockConfigs: Map<number, BlockConfig>,
    onConfigChange: () => void,
    bottomInsetPx: number,
    onClose: () => void,
    mobTypes: MobTypeDef[],
    mobSpawns: MobSpawnDef[],
    onMobSpawnsRemoved: (removedSpawnIds: string[]) => void,
  ) {
    this.onSave = onSave;
    this.onClose = onClose;
    this.blockConfigs = blockConfigs;
    this.onConfigChange = onConfigChange;
    this.mobTypes = mobTypes;
    this.mobSpawns = mobSpawns;
    this.onMobSpawnsRemoved = onMobSpawnsRemoved;

    this.element = document.createElement("div");
    this.element.id = "map-editor-panel";
    this.element.style.cssText = `
      position: fixed;
      top: 0;
      right: 0;
      width: ${MAP_EDITOR_PANEL_WIDTH_PX}px;
      height: calc(100% - ${bottomInsetPx}px);
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      background: rgba(20, 16, 12, 0.92);
      border-left: 2px solid #8a7346;
      font-family: Georgia, 'Times New Roman', serif;
      color: #e8dcc0;
      font-size: 13px;
      z-index: 999;
    `;

    const bodyRow = document.createElement("div");
    bodyRow.style.cssText = "flex: 1; display: flex; flex-direction: row; min-height: 0;";
    bodyRow.appendChild(this.createTabBar());

    const scrollArea = document.createElement("div");
    scrollArea.style.cssText = "flex: 1; overflow-y: auto; padding: 12px;";

    const title = document.createElement("div");
    title.textContent = "Editor de Mapas";
    title.style.cssText = "font-size: 15px; letter-spacing: 1px; margin-bottom: 10px;";
    scrollArea.appendChild(title);

    scrollArea.appendChild(this.createSlotSelector());

    const controls = this.createControlsSection();
    this.controlsEl = controls.controlsEl;
    this.controlsPlaceholder = controls.placeholder;
    this.bucketButton = controls.bucketButton;
    this.brushButton = controls.brushButton;
    this.randomButton = controls.randomButton;
    this.blockCheckbox = controls.blockCheckbox;
    this.structuralCheckbox = controls.structuralCheckbox;
    this.alternatingCheckbox = controls.alternatingCheckbox;
    this.densityRow = controls.densityRow;
    this.densitySlider = controls.densitySlider;
    this.densityValueLabel = controls.densityValueLabel;
    scrollArea.appendChild(this.controlsEl);

    this.paletteEl = document.createElement("div");
    this.paletteEl.style.cssText = `display: flex; flex-wrap: wrap; gap: ${SWATCH_GAP_PX}px;`;
    scrollArea.appendChild(this.paletteEl);

    const editorContent = document.createElement("div");
    editorContent.style.cssText = "flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0;";
    editorContent.appendChild(scrollArea);
    this.tabContents.set("editor", editorContent);

    const brushesResult = this.createBrushesTabContent();
    this.brushPaletteEl = brushesResult.paletteEl;
    this.tabContents.set("brushes", brushesResult.content);

    const mobsResult = this.createMobsTabContent();
    this.mobListEl = mobsResult.listEl;
    this.tabContents.set("mobs", mobsResult.content);
    this.renderMobTypeList();

    for (const tab of TAB_DEFS) {
      if (tab.id !== "editor" && tab.id !== "brushes" && tab.id !== "mobs") {
        this.tabContents.set(tab.id, this.createPlaceholderTabContent(tab.label));
      }
      bodyRow.appendChild(this.tabContents.get(tab.id)!);
    }

    this.element.appendChild(bodyRow);
    // Outside bodyRow, not any one tab's content, so Save and the eraser stay visible and usable no matter which tab is active — see createFooter.
    this.element.appendChild(this.createFooter());
    document.body.appendChild(this.element);

    this.showTab("editor");
    this.updateToolButtons();
    this.updateControlsEnabled();
    void this.populatePalette();
  }

  public destroy(): void {
    this.element.remove();
  }

  /** Vertical strip of tab buttons docked to the content area's left edge — see TAB_DEFS for the tabs and their order, `showTab` for switching between them. */
  private createTabBar(): HTMLDivElement {
    const tabBar = document.createElement("div");
    tabBar.style.cssText = `
      flex-shrink: 0;
      width: ${TAB_BAR_WIDTH_PX}px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      background: rgba(0, 0, 0, 0.2);
      border-right: 1px solid #4a3f2a;
    `;

    for (const tab of TAB_DEFS) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = tab.label;
      button.style.cssText = `
        padding: 10px 4px;
        writing-mode: vertical-rl;
        white-space: nowrap;
        font-family: inherit;
        font-size: 11px;
        letter-spacing: 0.5px;
        text-align: center;
        background: transparent;
        border: none;
        border-left: 3px solid transparent;
        color: #b6a887;
        cursor: pointer;
      `;
      button.addEventListener("click", () => this.showTab(tab.id));
      this.tabButtons.set(tab.id, button);
      tabBar.appendChild(button);
    }

    return tabBar;
  }

  /** Placeholder content for a not-yet-built tab — just its title, centered in the same flex column shape `editorContent` uses so switching tabs doesn't jump the layout around. */
  private createPlaceholderTabContent(label: string): HTMLDivElement {
    const content = document.createElement("div");
    content.style.cssText = "flex: 1; display: flex; flex-direction: column; padding: 12px; box-sizing: border-box;";

    const title = document.createElement("div");
    title.textContent = label;
    title.style.cssText = "font-size: 15px; letter-spacing: 1px;";
    content.appendChild(title);

    return content;
  }

  /**
   * The "Pincéis" tab's content: same shape as the main editor tab's own
   * scrollable area (title + swatch grid, same swatch size/spacing) but fed
   * only one swatch per "M" tileset — its fill block (row 4, col 2), the
   * only block that tab ever exposes, see `populatePalette`. That same fill
   * block also has its own, independent swatch in the main editor tab's
   * palette alongside the rest of its tileset's blocks; selecting it there
   * behaves like any ordinary block (free layer choice, no border ring).
   * Selecting *this* tab's copy is what triggers the brush treatment —
   * locked layer, auto-stamped border ring — see `isBrushTabSelection`.
   */
  private createBrushesTabContent(): { content: HTMLDivElement; paletteEl: HTMLDivElement } {
    const content = document.createElement("div");
    content.style.cssText = "flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0;";

    const scrollArea = document.createElement("div");
    scrollArea.style.cssText = "flex: 1; overflow-y: auto; padding: 12px;";

    const title = document.createElement("div");
    title.textContent = "Pincéis";
    title.style.cssText = "font-size: 15px; letter-spacing: 1px; margin-bottom: 10px;";
    scrollArea.appendChild(title);

    const paletteEl = document.createElement("div");
    paletteEl.style.cssText = `display: flex; flex-wrap: wrap; gap: ${SWATCH_GAP_PX}px;`;
    scrollArea.appendChild(paletteEl);

    content.appendChild(scrollArea);
    return { content, paletteEl };
  }

  /**
   * The "Mobs" tab's content: a "Criar Mob" button that opens MobEditorModal,
   * followed by the current map's mob type catalog (`mobTypes`) rendered as
   * a scrollable list of draggable rows — dragging one onto the game canvas
   * is what places a MobSpawnDef (see GameScene's canvas drop handler).
   */
  private createMobsTabContent(): { content: HTMLDivElement; listEl: HTMLDivElement } {
    const content = document.createElement("div");
    content.style.cssText = "flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0;";

    const scrollArea = document.createElement("div");
    scrollArea.style.cssText = "flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px;";

    const title = document.createElement("div");
    title.textContent = "Mobs";
    title.style.cssText = "font-size: 15px; letter-spacing: 1px;";
    scrollArea.appendChild(title);

    const createButton = document.createElement("button");
    createButton.type = "button";
    createButton.textContent = "Criar Mob";
    createButton.style.cssText = `
      height: 32px;
      padding: 0 12px;
      font-size: 13px;
      font-family: inherit;
      letter-spacing: 0.5px;
      background: #3a7d34;
      border: 1px solid #274f22;
      border-radius: 3px;
      color: #f2e9d0;
      cursor: pointer;
    `;
    createButton.addEventListener("click", () => {
      new MobEditorModal((mobType) => {
        this.mobTypes.push(mobType);
        this.renderMobTypeList();
      });
    });
    scrollArea.appendChild(createButton);

    const listEl = document.createElement("div");
    listEl.style.cssText = "display: flex; flex-direction: column; gap: 6px;";
    scrollArea.appendChild(listEl);

    content.appendChild(scrollArea);
    return { content, listEl };
  }

  /** Rebuilds the Mobs tab's list from `mobTypes` — called after a new type is created (see `createMobsTabContent`). */
  private renderMobTypeList(): void {
    this.mobListEl.replaceChildren();
    for (const mobType of this.mobTypes) {
      this.mobListEl.appendChild(this.createMobTypeRow(mobType));
    }
  }

  /** One draggable row in the Mobs tab's list — dragstart carries the mob type's id (MOB_DRAG_DATA_TYPE) for GameScene's canvas drop handler to read. */
  private createMobTypeRow(mobType: MobTypeDef): HTMLDivElement {
    const row = document.createElement("div");
    row.draggable = true;
    row.title = "Arraste para o mapa para posicionar";
    row.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid #8a7346;
      border-radius: 4px;
      cursor: grab;
    `;

    const thumb = createMobSkinThumbnail(isMobSkinId(mobType.skin) ? mobType.skin : DEFAULT_MOB_SKIN, 28);
    thumb.style.border = "1px solid #8a7346";

    const info = document.createElement("div");
    info.style.cssText = "flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0;";

    const nameEl = document.createElement("div");
    nameEl.textContent = mobType.name;
    nameEl.style.cssText = "font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";

    const statsEl = document.createElement("div");
    statsEl.textContent = `HP ${mobType.maxHp} · Força ${mobType.strength} · XP ${mobType.xp} · ${AGGRESSIVENESS_LABELS[mobType.aggressiveness]}`;
    statsEl.style.cssText = "font-size: 10px; color: #b6a887;";

    const spawnStatsEl = document.createElement("div");
    spawnStatsEl.textContent = `${mobType.spawnCount}x na região protegida · respawn ${mobType.respawnSeconds}s`;
    spawnStatsEl.style.cssText = "font-size: 10px; color: #b6a887;";

    info.appendChild(nameEl);
    info.appendChild(statsEl);
    info.appendChild(spawnStatsEl);
    row.appendChild(thumb);
    row.appendChild(info);
    row.appendChild(this.createEditMobTypeButton(mobType));
    row.appendChild(this.createDeleteMobTypeButton(mobType));

    row.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData(MOB_DRAG_DATA_TYPE, mobType.id);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "copy";
      }
    });

    return row;
  }

  /**
   * The pencil button on a mob type row. `draggable = false` so this button
   * doesn't inherit its draggable row ancestor's drag gesture — a click here
   * must fire click, not start a drag. Opens MobEditorModal pre-filled with
   * this mob type's current fields (see `updateMobType`); already-placed
   * spawns just reference the type by id, so editing it in place is enough
   * for every existing spawn to pick up the change with no further work.
   */
  private createEditMobTypeButton(mobType: MobTypeDef): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.draggable = false;
    button.title = "Editar mob";
    button.style.cssText = `
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: 1px solid #8a7346;
      border-radius: 3px;
      background-image: url("data:image/svg+xml,${encodeURIComponent(EDIT_ICON_SVG)}");
      background-repeat: no-repeat;
      background-position: center;
      cursor: pointer;
    `;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      new MobEditorModal((updatedMobType) => this.updateMobType(updatedMobType), mobType);
    });
    return button;
  }

  /** Replaces a mob type's fields in place (same id, see MobEditorModal's edit mode) and re-renders the list. */
  private updateMobType(updatedMobType: MobTypeDef): void {
    const typeIndex = this.mobTypes.findIndex((type) => type.id === updatedMobType.id);
    if (typeIndex !== -1) {
      this.mobTypes[typeIndex] = updatedMobType;
    }
    this.renderMobTypeList();
  }

  /**
   * The trash-can button on a mob type row. `draggable = false` so this
   * button doesn't inherit its draggable row ancestor's drag gesture — a
   * click here must fire click, not start a drag. If the type has spawns
   * placed on the current map, deleting it deletes every one of them too
   * (see `deleteMobType`), so a confirmation naming the count comes first;
   * with none placed there's nothing to lose, so it deletes immediately.
   */
  private createDeleteMobTypeButton(mobType: MobTypeDef): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.draggable = false;
    button.title = "Excluir mob";
    button.style.cssText = `
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: 1px solid #8a7346;
      border-radius: 3px;
      background-image: url("data:image/svg+xml,${encodeURIComponent(TRASH_ICON_SVG)}");
      background-repeat: no-repeat;
      background-position: center;
      cursor: pointer;
    `;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const affectedSpawnIds = this.mobSpawns.filter((spawn) => spawn.mobTypeId === mobType.id).map((spawn) => spawn.id);
      if (affectedSpawnIds.length === 0) {
        this.deleteMobType(mobType, affectedSpawnIds);
        return;
      }
      new ConfirmDialog(
        `Existem ${affectedSpawnIds.length} ${mobType.name} no mapa. Se excluir, todos serão apagados. Deseja prosseguir?`,
        () => this.deleteMobType(mobType, affectedSpawnIds),
      );
    });
    return button;
  }

  /** Removes a mob type and every one of its placed spawns from the live mapData arrays, then tells the caller which spawn ids went away so it can tear down their on-screen sprites — see `onMobSpawnsRemoved`'s doc. */
  private deleteMobType(mobType: MobTypeDef, affectedSpawnIds: string[]): void {
    const typeIndex = this.mobTypes.findIndex((type) => type.id === mobType.id);
    if (typeIndex !== -1) {
      this.mobTypes.splice(typeIndex, 1);
    }
    for (const spawnId of affectedSpawnIds) {
      const spawnIndex = this.mobSpawns.findIndex((spawn) => spawn.id === spawnId);
      if (spawnIndex !== -1) {
        this.mobSpawns.splice(spawnIndex, 1);
      }
    }
    this.onMobSpawnsRemoved(affectedSpawnIds);
    this.renderMobTypeList();
  }

  /** Shows `tabId`'s content and hides every other tab's, and highlights the matching tab button. */
  private showTab(tabId: EditorTabId): void {
    this.activeTab = tabId;
    for (const [id, content] of this.tabContents) {
      content.style.display = id === tabId ? "flex" : "none";
    }
    for (const [id, button] of this.tabButtons) {
      const active = id === tabId;
      button.style.color = active ? "#f2e9d0" : "#b6a887";
      button.style.borderLeftColor = active ? "#c9a24a" : "transparent";
      button.style.background = active ? "rgba(0, 0, 0, 0.3)" : "transparent";
    }
  }

  /** Which tab is currently showing — see `showTab`. GameScene reads this to decide how the footer eraser behaves (see `isEraserSelected`). */
  public getActiveTab(): EditorTabId {
    return this.activeTab;
  }

  /** True while the footer's broom swatch is the (sole) current selection. While the Mobs tab is active, GameScene treats this as "erase the mob under the cursor" instead of the ordinary "clear this tile's texture" — see `getActiveTab`. */
  public isEraserSelected(): boolean {
    return this.selectedSwatches.has(EMPTY_TILE_INDEX);
  }

  /** Keeps the panel's height in sync if the bottom bar's collapsed state changes while the panel is already open — see the constructor's `bottomInsetPx` doc. */
  public setBottomInset(px: number): void {
    this.element.style.height = `calc(100% - ${px}px)`;
  }

  /**
   * One paint instruction per selected texture, each read straight from
   * that texture's own remembered `BlockConfig` (falling back to the
   * defaults for one that's never been configured) — never from whatever
   * the controls section currently shows, since that only reflects the
   * focused block. `gridOffsetX`/`gridOffsetY` mirror each swatch's actual
   * row/column in the palette, relative to the top-left-most selected one,
   * so a stamp made of several textures lands on the map laid out the same
   * way they're arranged in the palette. Empty if nothing is selected.
   */
  public getSelectedPaints(): SelectedPaint[] {
    const entries = [...this.selectedSwatches.entries()];
    const positions = entries.map(([, swatch]) => this.getSwatchGridPosition(swatch));
    const minRow = Math.min(...positions.map((position) => position.row));
    const minCol = Math.min(...positions.map((position) => position.col));

    return entries.map(([tileIndex], index) => {
      const config = this.blockConfigs.get(tileIndex) ?? DEFAULT_BLOCK_CONFIG;
      const position = positions[index]!;
      return {
        layerIndex: config.layerIndex,
        tileIndex,
        blocked: config.blocked,
        tool: config.tool,
        randomDensity: config.randomDensity,
        gridOffsetX: position.col - minCol,
        gridOffsetY: position.row - minRow,
        autoBorder: this.isBrushTabSelection(tileIndex),
      };
    });
  }

  /** The row/column a swatch occupies within its own wrapping grid (the tileset palette, or the default-blocks section), derived from its actual rendered position — see `getSelectedPaints`. */
  private getSwatchGridPosition(swatch: HTMLDivElement): { row: number; col: number } {
    const containerRect = swatch.parentElement!.getBoundingClientRect();
    const swatchRect = swatch.getBoundingClientRect();
    const pitch = SWATCH_DISPLAY_PX + SWATCH_GAP_PX;
    return {
      row: Math.round((swatchRect.top - containerRect.top) / pitch),
      col: Math.round((swatchRect.left - containerRect.left) / pitch),
    };
  }

  /**
   * How the map's hover highlight (and the canvas cursor) should react to
   * the current selection: `"tiles"` whenever any selected texture paints
   * with the brush — one outline per selected texture, in a row starting at
   * the cursor (see GameScene.handleTileHover), so the user can see exactly
   * where each one will land. `"all"` outlines the whole map when the
   * selection is bucket/random only, since those ignore the cursor.
   * `"hidden"` when nothing is selected.
   */
  public getHoverHighlightMode(): "tiles" | "all" | "hidden" {
    const paints = this.getSelectedPaints();
    if (paints.some((paint) => paint.tool === "brush")) {
      return "tiles";
    }
    if (paints.some((paint) => paint.tool === "bucket" || paint.tool === "random")) {
      return "all";
    }
    return "hidden";
  }

  /** Tile indices marked Estrutural — the random fill tool must leave tiles already painted with one of these alone. */
  public getStructuralTileIndices(): Set<number> {
    const structuralTileIndices = new Set<number>();
    for (const [tileIndex, config] of this.blockConfigs) {
      if (config.structural) {
        structuralTileIndices.add(tileIndex);
      }
    }
    return structuralTileIndices;
  }

  /**
   * Populates both palettes from one shared block list, in the tilesets'
   * own natural order. Every block — including every block of every "M"
   * tileset — goes into the main editor tab's palette, exactly like any
   * other tileset's; there's nothing special about an "M" tileset there.
   * Splitting the two loads off one shared list (rather than two separate
   * ones) keeps every block's `globalTileIndex` consistent with the single
   * gid sequence `loadTilesetBlocks` assigns across all tilesets together.
   *
   * On top of that, an "M" tileset's fill block — line 5, column 3
   * (1-indexed; row 4, col 2 in the zero-indexed `TilesetBlock` fields) —
   * also gets a second, separate swatch element appended to the "Pincéis"
   * tab's palette (`isBrushTilesetKey` picks out "M" tilesets). Both
   * swatches share the same `globalTileIndex` and so the same underlying
   * `BlockConfig`, but they're independent DOM elements and independent
   * selections: the "Pincéis" copy is the only one that gets the locked
   * layer and auto-border ring treatment (see `isBrushTabSelection`) — the
   * main-palette copy paints like an ordinary block.
   */
  private async populatePalette(): Promise<void> {
    const blocks = await loadTilesetBlocks();
    for (const block of blocks) {
      this.paletteEl.appendChild(this.createSwatch(block));
      if (isBrushTilesetKey(block.tilesetKey) && block.row === BRUSH_FILL_BLOCK.row && block.col === BRUSH_FILL_BLOCK.col) {
        this.brushPaletteEl.appendChild(this.createSwatch(block));
      }
    }
  }

  /**
   * The always-present footer docked to the bottom of the panel, below
   * `bodyRow` and outside every tab's own content — so Save and the eraser
   * stay visible and usable no matter which tab is active, rather than
   * only while the main editor tab is open. Kept as small as possible — on
   * a short viewport (a phone in landscape) this footer and whichever
   * tab's scrollable content is showing above it (`flex: 1`) are fighting
   * over very little vertical space, so every pixel this row doesn't need
   * is a pixel that content gets back instead of being squeezed to
   * nothing behind it. The eraser lives in its own single-item row here
   * rather than either tileset palette's grid so it can't shift that
   * grid's order or the row/column math `getSwatchGridPosition` relies on.
   */
  private createFooter(): HTMLDivElement {
    const footer = document.createElement("div");
    footer.style.cssText = `
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      box-sizing: border-box;
      padding: 6px 8px;
      border-top: 1px solid #4a3f2a;
    `;

    footer.appendChild(this.createEraserSwatch(32));
    footer.appendChild(this.createSaveButton());
    footer.appendChild(this.createCloseButton());

    return footer;
  }

  /**
   * A red block with a broom icon that doesn't come from any tileset. It
   * behaves exactly like any other block — same controls section, same
   * per-block layer/tool/Block memory via `blockConfigs` — but paints
   * EMPTY_TILE_INDEX, which erases whatever texture was on that tile
   * instead of drawing one. `sizePx` defaults to the palette's swatch size
   * but the footer renders it smaller, matching the Save button's height,
   * since it sits alone in its own row and isn't part of the palette grid's
   * row/column math.
   */
  private createEraserSwatch(sizePx: number = SWATCH_DISPLAY_PX): HTMLDivElement {
    const swatch = document.createElement("div");
    swatch.title = "Limpar textura";
    swatch.style.cssText = `
      width: ${sizePx}px;
      height: ${sizePx}px;
      flex-shrink: 0;
      background-color: #a11f1f;
      background-image: url("data:image/svg+xml,${encodeURIComponent(BROOM_ICON_SVG)}");
      background-repeat: no-repeat;
      background-position: center;
      background-size: 60%;
      border: 2px solid transparent;
      box-sizing: border-box;
      cursor: pointer;
    `;
    swatch.addEventListener("click", (event) => this.selectSwatch(swatch, EMPTY_TILE_INDEX, event.shiftKey));
    return swatch;
  }

  private createSwatch(block: TilesetBlock): HTMLDivElement {
    const scale = SWATCH_DISPLAY_PX / TILESET_BLOCK_PX;
    const swatch = document.createElement("div");
    swatch.style.cssText = `
      width: ${SWATCH_DISPLAY_PX}px;
      height: ${SWATCH_DISPLAY_PX}px;
      background-image: url(${block.imageUrl});
      background-repeat: no-repeat;
      background-size: ${block.imageWidth * scale}px ${block.imageHeight * scale}px;
      background-position: -${block.col * TILESET_BLOCK_PX * scale}px -${block.row * TILESET_BLOCK_PX * scale}px;
      background-clip: padding-box;
      image-rendering: pixelated;
      border: 2px solid transparent;
      box-sizing: border-box;
      cursor: pointer;
    `;
    swatch.addEventListener("click", (event) => this.selectSwatch(swatch, block.globalTileIndex, event.shiftKey));
    return swatch;
  }

  /**
   * A plain click replaces the whole selection with just this block (or, if
   * it was already the sole selected block, clears the selection — same
   * toggle-off behavior as before). A shift-click instead adds or removes
   * this block from whatever's already selected, without touching the
   * others. Either way the clicked block becomes focused and the controls
   * section is reloaded from its own remembered config.
   */
  private selectSwatch(swatch: HTMLDivElement, tileIndex: number, additive: boolean): void {
    if (!additive) {
      const wasSoleSelection = this.selectedSwatches.size === 1 && this.selectedSwatches.has(tileIndex);
      this.clearSelection();
      if (wasSoleSelection) {
        this.updateControlsEnabled();
        return;
      }
      this.addToSelection(swatch, tileIndex);
      this.updateControlsEnabled();
      return;
    }

    if (this.selectedSwatches.has(tileIndex)) {
      this.removeFromSelection(tileIndex);
    } else {
      this.addToSelection(swatch, tileIndex);
    }
    this.updateControlsEnabled();
  }

  /** Adds a block to the selection, marks it focused, and loads its remembered config into the controls section. */
  private addToSelection(swatch: HTMLDivElement, tileIndex: number): void {
    swatch.style.borderColor = "#ffd700";
    this.selectedSwatches.set(tileIndex, swatch);
    this.focusedTileIndex = tileIndex;
    this.loadConfigIntoControls(tileIndex);
  }

  /** Removes a block from the selection; if it was focused, focus falls back to the most recently selected block that's still selected (or nothing). */
  private removeFromSelection(tileIndex: number): void {
    const swatch = this.selectedSwatches.get(tileIndex);
    if (swatch) {
      swatch.style.borderColor = "transparent";
    }
    this.selectedSwatches.delete(tileIndex);

    if (this.focusedTileIndex !== tileIndex) {
      return;
    }
    const remaining = [...this.selectedSwatches.keys()];
    const nextFocus = remaining[remaining.length - 1] ?? null;
    this.focusedTileIndex = nextFocus;
    if (nextFocus !== null) {
      this.loadConfigIntoControls(nextFocus);
    }
  }

  /** Clears every selected swatch's border and empties the selection, including the focus. */
  private clearSelection(): void {
    for (const swatch of this.selectedSwatches.values()) {
      swatch.style.borderColor = "transparent";
    }
    this.selectedSwatches.clear();
    this.focusedTileIndex = null;
  }

  /**
   * True when `tileIndex` is currently selected via its "Pincéis"-tab
   * swatch rather than its main-palette one. Only an "M" tileset's fill
   * block has both (see `populatePalette`); every other block only ever has
   * one swatch, so this is false for it regardless of which one is
   * selected. Drives the locked layer and auto-border ring treatment — see
   * `loadConfigIntoControls`, `saveCurrentConfig`, `updateControlsEnabled`,
   * and `getSelectedPaints`' `autoBorder` field. Selecting the very same
   * fill block from the main palette instead behaves like any other block:
   * free layer choice, no border.
   */
  private isBrushTabSelection(tileIndex: number): boolean {
    const swatch = this.selectedSwatches.get(tileIndex);
    return swatch !== undefined && swatch.parentElement === this.brushPaletteEl;
  }

  /** Restores a block's remembered layer/tool/flags/density into the controls section — used whenever the focused block changes. */
  private loadConfigIntoControls(tileIndex: number): void {
    const config = this.blockConfigs.get(tileIndex) ?? DEFAULT_BLOCK_CONFIG;
    const isBrushFill = this.isBrushTabSelection(tileIndex);
    this.selectedSlot = isBrushFill ? BRUSH_FILL_LAYER_INDEX + 1 : config.layerIndex + 1;
    this.selectedTool = config.tool;
    this.blockCheckbox.checked = config.blocked;
    this.structuralCheckbox.checked = config.structural;
    this.alternatingCheckbox.checked = config.alternating;
    this.selectedDensity = config.randomDensity;
    this.applySelectedSlot();
    this.applyDensityToSlider();
    this.updateToolButtons();
  }

  /** Remembers the current layer/Block/Estrutural/Alternar settings against the focused block only — every other selected block keeps its own layer/Block/Estrutural/Alternar untouched. Unlike the tool and density (see `applyToolToSelection`/`applyDensityToSelection`), those three stay individually tied to whichever block is focused. An "M" tileset's fill block selected via the "Pincéis" tab always saves with `BRUSH_FILL_LAYER_INDEX`, ignoring the slot radios (disabled for it anyway — see `updateControlsEnabled`) — its border ring is locked to its own fixed layer separately, see `MapManager.applyBrushBorder`. The very same block selected from the main palette instead saves whatever slot the user picked, like any other block. */
  private saveCurrentConfig(): void {
    if (this.focusedTileIndex === null) {
      return;
    }
    const layerIndex = this.isBrushTabSelection(this.focusedTileIndex) ? BRUSH_FILL_LAYER_INDEX : this.selectedSlot - 1;
    this.blockConfigs.set(this.focusedTileIndex, {
      layerIndex,
      tool: this.selectedTool,
      blocked: this.blockCheckbox.checked,
      structural: this.structuralCheckbox.checked,
      alternating: this.alternatingCheckbox.checked,
      randomDensity: this.selectedDensity,
    });
    this.onConfigChange();
  }

  /**
   * Writes `tool` into every currently selected block's own config, leaving
   * each one's layer/Block/Estrutural/Alternar/density exactly as they were. Unlike
   * those, the paint tool is a property of the whole selection — picking a
   * tool while several blocks are selected sets it for the batch, not just
   * the focused block, since a click needs every selected block to act the
   * same way (all brush-stamped, or all flooding their own layer, etc).
   */
  private applyToolToSelection(tool: PaintTool): void {
    for (const tileIndex of this.selectedSwatches.keys()) {
      const existing = this.blockConfigs.get(tileIndex) ?? DEFAULT_BLOCK_CONFIG;
      this.blockConfigs.set(tileIndex, { ...existing, tool });
    }
    this.onConfigChange();
  }

  /** Same batch treatment as `applyToolToSelection`, but for the random tool's density — also a property of the selection as a whole rather than any one block. */
  private applyDensityToSelection(density: number): void {
    for (const tileIndex of this.selectedSwatches.keys()) {
      const existing = this.blockConfigs.get(tileIndex) ?? DEFAULT_BLOCK_CONFIG;
      this.blockConfigs.set(tileIndex, { ...existing, randomDensity: density });
    }
    this.onConfigChange();
  }

  /** Syncs the density slider's position/label to `selectedDensity`, e.g. after restoring a block's remembered config. */
  private applyDensityToSlider(): void {
    const percent = Math.round(this.selectedDensity * 100);
    this.densitySlider.value = String(percent);
    this.densityValueLabel.textContent = `${percent}%`;
  }

  /** Checks the radio matching `selectedSlot`, e.g. after restoring a block's remembered layer. */
  private applySelectedSlot(): void {
    for (const radio of this.slotRadios) {
      radio.checked = Number(radio.value) === this.selectedSlot;
    }
  }

  /** Row of numbered radio buttons shown at the top of the panel, above the controls section — picks which layer the brush paints into. */
  private createSlotSelector(): HTMLDivElement {
    const row = document.createElement("div");
    row.style.cssText = "display: flex; gap: 8px; margin-bottom: 12px;";

    for (let slot = 1; slot <= MAX_PAINT_LAYERS; slot++) {
      const label = document.createElement("label");
      label.style.cssText = "display: flex; flex-direction: column; align-items: center; gap: 2px; cursor: pointer;";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = SLOT_RADIO_GROUP_NAME;
      radio.value = String(slot);
      radio.checked = slot === 1;
      radio.addEventListener("change", () => {
        this.selectedSlot = slot;
        this.saveCurrentConfig();
      });
      this.slotRadios.push(radio);

      const numberLabel = document.createElement("span");
      numberLabel.textContent = String(slot);

      label.appendChild(radio);
      label.appendChild(numberLabel);
      row.appendChild(label);
    }

    return row;
  }

  /** Save button, sharing the footer row with the eraser swatch — see `createFooter`. */
  private createSaveButton(): HTMLButtonElement {
    const button = document.createElement("button");
    button.textContent = "Salvar";
    button.style.cssText = `
      flex: 1;
      height: 32px;
      padding: 0;
      font-size: 13px;
      font-family: inherit;
      letter-spacing: 1px;
      background: #3a7d34;
      border: 1px solid #274f22;
      border-radius: 3px;
      color: #f2e9d0;
      cursor: pointer;
    `;
    button.addEventListener("click", () => this.onSave());
    return button;
  }

  /** Close button, sharing the footer row with Save and the eraser swatch — see `createFooter`. */
  private createCloseButton(): HTMLButtonElement {
    const button = document.createElement("button");
    button.textContent = "Fechar";
    button.style.cssText = `
      flex: 1;
      height: 32px;
      padding: 0;
      font-size: 13px;
      font-family: inherit;
      letter-spacing: 1px;
      background: #6b5a3a;
      border: 1px solid #4a3f2a;
      border-radius: 3px;
      color: #f2e9d0;
      cursor: pointer;
    `;
    button.addEventListener("click", () => this.onClose());
    return button;
  }

  /**
   * Builds the controls section docked right below the layer-number row:
   * the paint-tool picker, the Block/Estrutural/Alternar flags, and the random tool's
   * density slider. Unlike the old floating popup this section is always
   * present in the panel's flow; it's dimmed and non-interactive until a
   * texture is selected (see `updateControlsEnabled`), at which point it
   * reflects that texture's remembered settings.
   */
  private createControlsSection(): {
    controlsEl: HTMLDivElement;
    placeholder: HTMLDivElement;
    bucketButton: HTMLButtonElement;
    brushButton: HTMLButtonElement;
    randomButton: HTMLButtonElement;
    blockCheckbox: HTMLInputElement;
    structuralCheckbox: HTMLInputElement;
    alternatingCheckbox: HTMLInputElement;
    densityRow: HTMLDivElement;
    densitySlider: HTMLInputElement;
    densityValueLabel: HTMLSpanElement;
  } {
    const controlsEl = document.createElement("div");
    controlsEl.style.cssText = `
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 8px;
      box-sizing: border-box;
      padding: 10px;
      margin-bottom: 12px;
      background: rgba(0, 0, 0, 0.2);
      border: 2px solid #8a7346;
      border-radius: 4px;
    `;

    const placeholder = document.createElement("div");
    placeholder.textContent = "Selecione uma textura";
    placeholder.style.cssText = "font-size: 12px; text-align: center; color: #b6a887;";
    controlsEl.appendChild(placeholder);

    const toolRow = document.createElement("div");
    toolRow.style.cssText = "display: flex; gap: 6px;";

    const brushButton = this.createToolButton(BRUSH_ICON_SVG, "Pincel", "brush");
    const bucketButton = this.createToolButton(BUCKET_ICON_SVG, "Balde de Tinta", "bucket");
    const randomButton = this.createToolButton(RANDOM_ICON_SVG, "Random", "random");
    toolRow.appendChild(brushButton);
    toolRow.appendChild(bucketButton);
    toolRow.appendChild(randomButton);

    const flagsRow = document.createElement("div");
    flagsRow.style.cssText = "display: flex; align-items: center; gap: 14px;";

    const blockRow = document.createElement("label");
    blockRow.style.cssText = "display: flex; align-items: center; gap: 6px; cursor: pointer;";

    const blockCheckbox = document.createElement("input");
    blockCheckbox.type = "checkbox";
    blockCheckbox.addEventListener("change", () => this.saveCurrentConfig());

    const blockLabelText = document.createElement("span");
    blockLabelText.textContent = "Block";

    blockRow.appendChild(blockCheckbox);
    blockRow.appendChild(blockLabelText);

    const structuralRow = document.createElement("label");
    structuralRow.style.cssText = "display: flex; align-items: center; gap: 6px; cursor: pointer;";

    const structuralCheckbox = document.createElement("input");
    structuralCheckbox.type = "checkbox";
    structuralCheckbox.addEventListener("change", () => this.saveCurrentConfig());

    const structuralLabelText = document.createElement("span");
    structuralLabelText.textContent = "Estrutural";

    structuralRow.appendChild(structuralCheckbox);
    structuralRow.appendChild(structuralLabelText);

    const alternatingRow = document.createElement("label");
    alternatingRow.style.cssText = "display: flex; align-items: center; gap: 6px; cursor: pointer;";

    const alternatingCheckbox = document.createElement("input");
    alternatingCheckbox.type = "checkbox";
    alternatingCheckbox.addEventListener("change", () => this.saveCurrentConfig());

    const alternatingLabelText = document.createElement("span");
    alternatingLabelText.textContent = "Alternar";

    alternatingRow.appendChild(alternatingCheckbox);
    alternatingRow.appendChild(alternatingLabelText);

    flagsRow.appendChild(blockRow);
    flagsRow.appendChild(structuralRow);
    flagsRow.appendChild(alternatingRow);

    const { densityRow, densitySlider, densityValueLabel } = this.createDensityRow();

    controlsEl.appendChild(toolRow);
    controlsEl.appendChild(flagsRow);
    controlsEl.appendChild(densityRow);

    return {
      controlsEl,
      placeholder,
      bucketButton,
      brushButton,
      randomButton,
      blockCheckbox,
      structuralCheckbox,
      alternatingCheckbox,
      densityRow,
      densitySlider,
      densityValueLabel,
    };
  }

  /**
   * Shows the controls section as active (something is selected, so there's
   * a focused block to edit) or dimmed/inert (nothing selected), toggling
   * both the visuals and the `disabled` state of every input inside it. The
   * layer slot radios get the same disabled treatment whenever the focused
   * block is selected via its "Pincéis"-tab swatch — its layer is locked to
   * `BRUSH_FILL_LAYER_INDEX` (see `saveCurrentConfig`), so letting the user
   * click a different slot here would show a selection the data doesn't
   * actually honor. The same block selected from the main palette instead
   * leaves the slot radios enabled, like any other block.
   */
  private updateControlsEnabled(): void {
    const hasSelection = this.focusedTileIndex !== null;
    const layerLocked = this.focusedTileIndex !== null && this.isBrushTabSelection(this.focusedTileIndex);

    this.bucketButton.disabled = !hasSelection;
    this.brushButton.disabled = !hasSelection;
    this.randomButton.disabled = !hasSelection;
    this.blockCheckbox.disabled = !hasSelection;
    this.structuralCheckbox.disabled = !hasSelection;
    this.alternatingCheckbox.disabled = !hasSelection;
    this.densitySlider.disabled = !hasSelection;
    for (const radio of this.slotRadios) {
      radio.disabled = !hasSelection || layerLocked;
    }

    this.controlsEl.style.opacity = hasSelection ? "1" : "0.5";
    this.controlsPlaceholder.style.display = hasSelection ? "none" : "block";
  }

  /** Slider controlling how much of the map the random tool scatters the selected texture across — only shown while that tool is active. */
  private createDensityRow(): { densityRow: HTMLDivElement; densitySlider: HTMLInputElement; densityValueLabel: HTMLSpanElement } {
    const densityRow = document.createElement("div");
    densityRow.style.cssText = "display: none; flex-direction: column; gap: 4px;";

    const labelRow = document.createElement("div");
    labelRow.style.cssText = "display: flex; justify-content: space-between; font-size: 11px;";

    const labelText = document.createElement("span");
    labelText.textContent = "Aleatoriedade";

    const densityValueLabel = document.createElement("span");
    densityValueLabel.textContent = `${Math.round(DEFAULT_RANDOM_DENSITY * 100)}%`;

    labelRow.appendChild(labelText);
    labelRow.appendChild(densityValueLabel);

    const densitySlider = document.createElement("input");
    densitySlider.type = "range";
    densitySlider.min = "1";
    densitySlider.max = "100";
    densitySlider.value = String(Math.round(DEFAULT_RANDOM_DENSITY * 100));
    densitySlider.style.cssText = "width: 100%; accent-color: #e0e0e0; color-scheme: light;";
    densitySlider.addEventListener("input", () => {
      this.selectedDensity = Number(densitySlider.value) / 100;
      densityValueLabel.textContent = `${densitySlider.value}%`;
      this.applyDensityToSelection(this.selectedDensity);
    });

    densityRow.appendChild(labelRow);
    densityRow.appendChild(densitySlider);

    return { densityRow, densitySlider, densityValueLabel };
  }

  private createToolButton(iconSvg: string, title: string, tool: PaintTool): HTMLButtonElement {
    const button = document.createElement("button");
    button.title = title;
    button.style.cssText = `
      flex: 1;
      height: 32px;
      padding: 0;
      background-color: #4a3f2a;
      background-image: url("data:image/svg+xml,${encodeURIComponent(iconSvg)}");
      background-repeat: no-repeat;
      background-position: center;
      background-size: 20px 20px;
      border: 1px solid #8a7346;
      border-radius: 3px;
      cursor: pointer;
    `;
    button.addEventListener("click", () => {
      this.selectedTool = tool;
      this.updateToolButtons();
      this.applyToolToSelection(tool);
    });
    return button;
  }

  private updateToolButtons(): void {
    this.bucketButton.style.borderColor = this.selectedTool === "bucket" ? "#ffd700" : "#8a7346";
    this.brushButton.style.borderColor = this.selectedTool === "brush" ? "#ffd700" : "#8a7346";
    this.randomButton.style.borderColor = this.selectedTool === "random" ? "#ffd700" : "#8a7346";
    this.densityRow.style.display = this.selectedTool === "random" ? "flex" : "none";
  }
}
