/**
 * Plain-DOM overlay fixed to the top-left of the viewport, independent of
 * the Phaser canvas/camera. A single gear icon that toggles a dropdown with
 * the map editor toggle and, last, logout. Replaces the old full-width top
 * bar — the character name doesn't need a slot here since it's already
 * shown above the player's own sprite (see Player's nameLabel). Only ever
 * mounted while GameScene is active.
 */
export class SettingsMenu {
  private readonly button: HTMLButtonElement;
  private readonly dropdown: HTMLDivElement;
  private isOpen = false;
  private readonly onDocumentClick = (event: MouseEvent): void => {
    const target = event.target as Node;
    if (this.isOpen && target !== this.button && !this.dropdown.contains(target)) {
      this.close();
    }
  };

  public constructor(
    onLogout: () => void,
    onToggleMapEditor: () => void,
    onZoomIn: () => void,
    onZoomOut: () => void,
  ) {
    this.button = document.createElement("button");
    this.button.id = "settings-menu-button";
    this.button.type = "button";
    this.button.setAttribute("aria-label", "Configurações");
    this.button.textContent = "⚙";
    this.button.style.cssText = `
      position: fixed;
      top: 10px;
      left: 10px;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      font-size: 18px;
      line-height: 1;
      font-family: Georgia, 'Times New Roman', serif;
      background: rgba(20, 16, 12, 0.92);
      border: 1px solid #8a7346;
      border-radius: 4px;
      color: #e8dcc0;
      cursor: pointer;
      z-index: 1001;
    `;

    this.dropdown = document.createElement("div");
    this.dropdown.id = "settings-menu-dropdown";
    this.dropdown.style.cssText = `
      position: fixed;
      top: 50px;
      left: 10px;
      display: none;
      flex-direction: column;
      min-width: 170px;
      box-sizing: border-box;
      background: rgba(20, 16, 12, 0.96);
      border: 1px solid #8a7346;
      border-radius: 4px;
      overflow: hidden;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 13px;
      color: #e8dcc0;
      z-index: 1001;
    `;

    const zoomRow = this.createZoomRow(onZoomIn, onZoomOut);
    const mapEditorItem = this.createMenuItem("Editor de Mapas", false, () => {
      this.close();
      onToggleMapEditor();
    });
    // Logout is last, visually separated, since it's the destructive/exit action.
    const logoutItem = this.createMenuItem("Logout", true, () => {
      this.close();
      onLogout();
    });

    this.dropdown.appendChild(zoomRow);
    this.dropdown.appendChild(mapEditorItem);
    this.dropdown.appendChild(logoutItem);

    this.button.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggle();
    });
    document.addEventListener("click", this.onDocumentClick);

    document.body.appendChild(this.button);
    document.body.appendChild(this.dropdown);
  }

  /** The zoom controls: a "Zoom" label with -/+ buttons, laid out like a menu item but not clickable/closing itself (the dropdown stays open so zoom can be stepped repeatedly). */
  private createZoomRow(onZoomIn: () => void, onZoomOut: () => void): HTMLDivElement {
    const row = document.createElement("div");
    row.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 14px;
      border-bottom: 1px solid #8a7346;
      letter-spacing: 1px;
      color: #f2e9d0;
    `;

    const label = document.createElement("span");
    label.textContent = "Zoom";

    const buttons = document.createElement("div");
    buttons.style.cssText = "display: flex; gap: 6px;";

    const zoomOutButton = this.createZoomButton("−", onZoomOut);
    const zoomInButton = this.createZoomButton("+", onZoomIn);

    buttons.appendChild(zoomOutButton);
    buttons.appendChild(zoomInButton);
    row.appendChild(label);
    row.appendChild(buttons);
    return row;
  }

  private createZoomButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-label", label === "+" ? "Aumentar zoom" : "Diminuir zoom");
    button.style.cssText = `
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: inherit;
      font-size: 14px;
      background: #4a3f2a;
      border: 1px solid #8a7346;
      border-radius: 3px;
      color: #f2e9d0;
      cursor: pointer;
    `;
    button.addEventListener("mouseenter", () => {
      button.style.background = "#5c4e34";
    });
    button.addEventListener("mouseleave", () => {
      button.style.background = "#4a3f2a";
    });
    // Doesn't close the dropdown or stopPropagation beyond the click itself — zoom is meant to be stepped multiple times in a row.
    button.addEventListener("click", onClick);
    return button;
  }

  private createMenuItem(label: string, isLast: boolean, onClick: () => void): HTMLButtonElement {
    const item = document.createElement("button");
    item.type = "button";
    item.textContent = label;
    item.style.cssText = `
      padding: 10px 14px;
      text-align: left;
      background: transparent;
      border: none;
      ${isLast ? "border-top: 1px solid #8a7346;" : ""}
      font-family: inherit;
      font-size: inherit;
      letter-spacing: 1px;
      color: ${isLast ? "#e8a0a0" : "#f2e9d0"};
      cursor: pointer;
    `;
    item.addEventListener("mouseenter", () => {
      item.style.background = "#4a3f2a";
    });
    item.addEventListener("mouseleave", () => {
      item.style.background = "transparent";
    });
    item.addEventListener("click", onClick);
    return item;
  }

  private toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.isOpen = true;
      this.dropdown.style.display = "flex";
    }
  }

  private close(): void {
    this.isOpen = false;
    this.dropdown.style.display = "none";
  }

  public destroy(): void {
    document.removeEventListener("click", this.onDocumentClick);
    this.button.remove();
    this.dropdown.remove();
  }
}
