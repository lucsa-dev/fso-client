import type { MobAggressiveness, MobTypeDef } from "@/types/MapTypes";
import { DEFAULT_MOB_SKIN, isMobSkinId, MOB_SIZE_DEFAULT, MOB_SIZE_MAX, MOB_SIZE_MIN, MOB_SIZE_STEP, MOB_SKINS, type MobSkinId } from "@/utils/Constants";
import { createMobSkinThumbnail } from "@/utils/MobSkinAssets";

const AGGRESSIVENESS_OPTIONS: ReadonlyArray<{ value: MobAggressiveness; label: string }> = [
  { value: "pacifico", label: "Pacífico" },
  { value: "neutro", label: "Neutro" },
  { value: "agressivo", label: "Agressivo" },
];

const DEFAULT_STRENGTH = 10;
const DEFAULT_MAX_HP = 30;
const DEFAULT_DEFENDED_TILES = 4;
const DEFAULT_XP_REWARD = 10;
const DEFAULT_RESPAWN_SECONDS = 30;
const DEFAULT_SPAWN_COUNT = 1;

/**
 * First centered-modal component in the codebase — every other editor
 * surface (see MapEditorPanel) is a docked side panel — styled to match
 * their shared dark-parchment look instead of introducing a new one.
 * Collects every MobTypeDef field from the mob system spec (nome, skin,
 * força, agressividade, vida, quadros defendidos) and hands the finished
 * type to `onSubmit`; destroys itself on submit or cancel (including a
 * click on the dimmed backdrop).
 *
 * Passing `initialMobType` switches the modal into edit mode: every field
 * starts pre-filled from it, the title/submit button read "Editar
 * Mob"/"Salvar" instead of "Criar Mob"/"Criar", and `onSubmit` receives the
 * same `id` back so the caller can replace the existing catalog entry in
 * place rather than adding a new one.
 */
export class MobEditorModal {
  private readonly overlay: HTMLDivElement;
  private selectedSkin: MobSkinId;
  private selectedAggressiveness: MobAggressiveness;

  public constructor(onSubmit: (mobType: MobTypeDef) => void, initialMobType?: MobTypeDef) {
    this.selectedSkin = initialMobType && isMobSkinId(initialMobType.skin) ? initialMobType.skin : DEFAULT_MOB_SKIN;
    this.selectedAggressiveness = initialMobType?.aggressiveness ?? "neutro";

    this.overlay = document.createElement("div");
    this.overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    `;
    this.overlay.addEventListener("click", (event) => {
      if (event.target === this.overlay) {
        this.destroy();
      }
    });

    const dialog = document.createElement("div");
    dialog.style.cssText = `
      width: 300px;
      max-height: 90vh;
      overflow-y: auto;
      box-sizing: border-box;
      padding: 16px;
      background: rgba(20, 16, 12, 0.96);
      border: 2px solid #8a7346;
      border-radius: 6px;
      font-family: Georgia, 'Times New Roman', serif;
      color: #e8dcc0;
      font-size: 13px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    `;
    dialog.addEventListener("click", (event) => event.stopPropagation());

    const title = document.createElement("div");
    title.textContent = initialMobType ? "Editar Mob" : "Criar Mob";
    title.style.cssText = "font-size: 15px; letter-spacing: 1px;";
    dialog.appendChild(title);

    const nameInput = this.createTextField(dialog, "Nome");
    nameInput.value = initialMobType?.name ?? "";
    this.createSkinRow(dialog);
    const strengthSlider = this.createSliderField(dialog, "Força (dano por hit)", 1, 100, initialMobType?.strength ?? DEFAULT_STRENGTH);
    const sizeSlider = this.createSliderField(dialog, "Tamanho (em blocos)", MOB_SIZE_MIN, MOB_SIZE_MAX, initialMobType?.size ?? MOB_SIZE_DEFAULT, MOB_SIZE_STEP);
    this.createAggressivenessRow(dialog);
    const hpInput = this.createNumberField(dialog, "Vida", 1, initialMobType?.maxHp ?? DEFAULT_MAX_HP);
    const defendedTilesInput = this.createNumberField(dialog, "Quadros defendidos (região protegida)", 0, initialMobType?.defendedTiles ?? DEFAULT_DEFENDED_TILES);
    const xpInput = this.createNumberField(dialog, "XP fornecido", 0, initialMobType?.xp ?? DEFAULT_XP_REWARD);
    const spawnCountInput = this.createNumberField(dialog, "Quantidade na região protegida", 1, initialMobType?.spawnCount ?? DEFAULT_SPAWN_COUNT);
    const respawnSecondsInput = this.createNumberField(dialog, "Tempo de respawn (segundos)", 0, initialMobType?.respawnSeconds ?? DEFAULT_RESPAWN_SECONDS);

    const buttonRow = document.createElement("div");
    buttonRow.style.cssText = "display: flex; gap: 8px; margin-top: 4px;";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "Cancelar";
    cancelButton.style.cssText = this.actionButtonStyle("#6b5a3a", "#4a3f2a");
    cancelButton.addEventListener("click", () => this.destroy());

    const createButton = document.createElement("button");
    createButton.type = "button";
    createButton.textContent = initialMobType ? "Salvar" : "Criar";
    createButton.style.cssText = this.actionButtonStyle("#3a7d34", "#274f22");
    createButton.addEventListener("click", () => {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      onSubmit({
        id: initialMobType?.id ?? crypto.randomUUID(),
        name,
        skin: this.selectedSkin,
        strength: Number(strengthSlider.value),
        aggressiveness: this.selectedAggressiveness,
        maxHp: Math.max(1, Number(hpInput.value) || DEFAULT_MAX_HP),
        size: Math.min(MOB_SIZE_MAX, Math.max(MOB_SIZE_MIN, Number(sizeSlider.value) || MOB_SIZE_DEFAULT)),
        defendedTiles: Math.max(0, Number(defendedTilesInput.value) || 0),
        xp: Math.max(0, Number(xpInput.value) || 0),
        spawnCount: Math.max(1, Number(spawnCountInput.value) || DEFAULT_SPAWN_COUNT),
        respawnSeconds: Math.max(0, Number(respawnSecondsInput.value) || 0),
      });
      this.destroy();
    });

    buttonRow.appendChild(cancelButton);
    buttonRow.appendChild(createButton);
    dialog.appendChild(buttonRow);

    this.overlay.appendChild(dialog);
    document.body.appendChild(this.overlay);
    nameInput.focus();
  }

  public destroy(): void {
    this.overlay.remove();
  }

  private createTextField(parent: HTMLElement, label: string): HTMLInputElement {
    const wrap = this.fieldWrap(parent, label);
    const input = document.createElement("input");
    input.type = "text";
    input.style.cssText = this.inputStyle();
    wrap.appendChild(input);
    return input;
  }

  private createNumberField(parent: HTMLElement, label: string, min: number, defaultValue: number): HTMLInputElement {
    const wrap = this.fieldWrap(parent, label);
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(min);
    input.value = String(defaultValue);
    input.style.cssText = this.inputStyle();
    wrap.appendChild(input);
    return input;
  }

  private createSliderField(parent: HTMLElement, label: string, min: number, max: number, defaultValue: number, step = 1): HTMLInputElement {
    const wrap = this.fieldWrap(parent, label);
    const row = document.createElement("div");
    row.style.cssText = "display: flex; align-items: center; gap: 8px;";

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(defaultValue);
    slider.style.cssText = "flex: 1; accent-color: #c9a24a;";

    const valueLabel = document.createElement("span");
    valueLabel.textContent = String(defaultValue);
    valueLabel.style.cssText = "min-width: 28px; text-align: right;";

    slider.addEventListener("input", () => {
      valueLabel.textContent = slider.value;
    });

    row.appendChild(slider);
    row.appendChild(valueLabel);
    wrap.appendChild(row);
    return slider;
  }

  private createSkinRow(parent: HTMLElement): void {
    const wrap = this.fieldWrap(parent, "Skin");
    const row = document.createElement("div");
    row.style.cssText = "display: flex; gap: 8px;";

    const buttons = new Map<MobSkinId, HTMLButtonElement>();
    for (const skin of MOB_SKINS) {
      const button = document.createElement("button");
      button.type = "button";
      button.style.cssText = this.skinButtonStyle(skin.id === this.selectedSkin);

      const thumb = createMobSkinThumbnail(skin.id, 40);
      thumb.style.marginBottom = "4px";

      const label = document.createElement("span");
      label.textContent = skin.label;

      button.appendChild(thumb);
      button.appendChild(label);
      button.addEventListener("click", () => {
        this.selectedSkin = skin.id;
        buttons.forEach((b, id) => {
          b.style.cssText = this.skinButtonStyle(id === this.selectedSkin);
        });
      });
      buttons.set(skin.id, button);
      row.appendChild(button);
    }

    wrap.appendChild(row);
  }

  private createAggressivenessRow(parent: HTMLElement): void {
    const wrap = this.fieldWrap(parent, "Agressividade");
    const row = document.createElement("div");
    row.style.cssText = "display: flex; gap: 6px;";

    const buttons = new Map<MobAggressiveness, HTMLButtonElement>();
    for (const option of AGGRESSIVENESS_OPTIONS) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = option.label;
      button.style.cssText = this.toggleButtonStyle(option.value === this.selectedAggressiveness);
      button.addEventListener("click", () => {
        this.selectedAggressiveness = option.value;
        buttons.forEach((b, value) => {
          b.style.cssText = this.toggleButtonStyle(value === this.selectedAggressiveness);
        });
      });
      buttons.set(option.value, button);
      row.appendChild(button);
    }

    wrap.appendChild(row);
  }

  private fieldWrap(parent: HTMLElement, label: string): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display: flex; flex-direction: column; gap: 4px;";
    const labelEl = document.createElement("label");
    labelEl.textContent = label;
    labelEl.style.cssText = "font-size: 11px; color: #b6a887;";
    wrap.appendChild(labelEl);
    parent.appendChild(wrap);
    return wrap;
  }

  private inputStyle(): string {
    return `
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid #8a7346;
      border-radius: 3px;
      color: #f2e9d0;
      font-family: inherit;
      font-size: 13px;
    `;
  }

  /** Same active/inactive treatment as `toggleButtonStyle`, but laid out as a column so the skin thumbnail sits above its label instead of a plain text-only button. */
  private skinButtonStyle(active: boolean): string {
    return `
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 8px 0 6px;
      font-family: inherit;
      font-size: 12px;
      background: ${active ? "rgba(201, 162, 74, 0.25)" : "#4a3f2a"};
      border: 1px solid ${active ? "#ffd700" : "#8a7346"};
      border-radius: 3px;
      color: ${active ? "#ffd700" : "#e8dcc0"};
      cursor: pointer;
    `;
  }

  private toggleButtonStyle(active: boolean): string {
    return `
      flex: 1;
      padding: 6px 0;
      font-family: inherit;
      font-size: 12px;
      background: ${active ? "rgba(201, 162, 74, 0.25)" : "#4a3f2a"};
      border: 1px solid ${active ? "#ffd700" : "#8a7346"};
      border-radius: 3px;
      color: ${active ? "#ffd700" : "#e8dcc0"};
      cursor: pointer;
    `;
  }

  private actionButtonStyle(bg: string, border: string): string {
    return `
      flex: 1;
      height: 32px;
      padding: 0;
      font-size: 13px;
      font-family: inherit;
      letter-spacing: 1px;
      background: ${bg};
      border: 1px solid ${border};
      border-radius: 3px;
      color: #f2e9d0;
      cursor: pointer;
    `;
  }
}
