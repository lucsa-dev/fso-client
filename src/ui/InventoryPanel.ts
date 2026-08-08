import { INVENTORY_PANEL_WIDTH_PX } from "@/utils/Constants";

const INVENTORY_SLOT_COUNT = 10;
const INVENTORY_COLUMNS = 5;

const STAT_BARS: ReadonlyArray<{ label: string; fillColor: string; trackColor: string }> = [
  { label: "HP", fillColor: "#a83232", trackColor: "#3a1414" },
  { label: "SP", fillColor: "#3266a8", trackColor: "#14243a" },
  { label: "XP", fillColor: "#3aa832", trackColor: "#163212" },
];

interface StatBarRefs {
  fill: HTMLDivElement;
  label: HTMLDivElement;
}

function buildStatBar(spec: { label: string; fillColor: string; trackColor: string }): { row: HTMLDivElement; refs: StatBarRefs } {
  const row = document.createElement("div");
  row.style.cssText = `
    position: relative;
    height: 12px;
    border: 1px solid #8a7346;
    border-radius: 2px;
    background: ${spec.trackColor};
    overflow: hidden;
  `;

  const fill = document.createElement("div");
  fill.style.cssText = `
    height: 100%;
    width: 100%;
    background: ${spec.fillColor};
  `;

  const label = document.createElement("div");
  label.textContent = spec.label;
  label.style.cssText = `
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    letter-spacing: 1px;
    color: #f2e9d0;
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.8);
  `;

  row.appendChild(fill);
  row.appendChild(label);
  return { row, refs: { fill, label } };
}

/**
 * Right column of BottomBar: the HP/SP/XP status bars stacked above a grid
 * of item slots — the only place these show as labeled numbers ("HP 20/20");
 * the player's head-anchored bars (see Player.redrawHpBar/redrawXpBar) are
 * deliberately numberless. HP and XP are pushed by GameScene the same way
 * (see `updateHp`/`updateXp`); SP stays a placeholder — no SP concept exists
 * yet. Items are still reserved layout only.
 */
export class InventoryPanel {
  private readonly element: HTMLDivElement;
  private readonly hp: StatBarRefs;
  private readonly xp: StatBarRefs;

  public constructor() {
    this.element = document.createElement("div");
    this.element.id = "inventory-panel";
    this.element.style.cssText = `
      flex: 0 0 ${INVENTORY_PANEL_WIDTH_PX}px;
      height: 100%;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 6px 8px;
      background: rgba(20, 16, 12, 0.92);
      font-family: Georgia, 'Times New Roman', serif;
    `;

    const statsSection = document.createElement("div");
    statsSection.style.cssText = "display: flex; flex-direction: column; gap: 3px;";
    const bars = STAT_BARS.map((spec) => buildStatBar(spec));
    bars.forEach(({ row }) => statsSection.appendChild(row));
    this.hp = bars[0]!.refs;
    this.xp = bars[2]!.refs;

    const grid = document.createElement("div");
    grid.id = "inventory-grid";
    grid.style.cssText = `
      flex: 1 1 auto;
      display: grid;
      grid-template-columns: repeat(${INVENTORY_COLUMNS}, 1fr);
      gap: 4px;
      align-content: start;
    `;
    for (let i = 0; i < INVENTORY_SLOT_COUNT; i++) {
      const slot = document.createElement("div");
      slot.style.cssText = `
        aspect-ratio: 1;
        border: 1px solid #8a7346;
        border-radius: 2px;
        background: rgba(255, 255, 255, 0.04);
      `;
      grid.appendChild(slot);
    }

    this.element.appendChild(statsSection);
    this.element.appendChild(grid);
  }

  public updateHp(hp: number, maxHp: number): void {
    InventoryPanel.applyStat(this.hp, "HP", hp, maxHp);
  }

  public updateXp(xp: number, maxXp: number): void {
    InventoryPanel.applyStat(this.xp, "XP", xp, maxXp);
  }

  private static applyStat(refs: StatBarRefs, prefix: string, current: number, max: number): void {
    const percent = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
    refs.fill.style.width = `${percent}%`;
    refs.label.textContent = `${prefix} ${current}/${max}`;
  }

  /** The mountable root — appended into BottomBar's layout row. */
  public getElement(): HTMLDivElement {
    return this.element;
  }

  public destroy(): void {
    this.element.remove();
  }
}
