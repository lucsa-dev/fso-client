/**
 * Small "Salvando..." banner centered on screen while the map editor's
 * Save button is persisting a map — the save is a fire-and-forget fetch
 * with no feedback of its own otherwise, and the editor panel closes as
 * soon as it settles, so without this the save would look like it did
 * nothing until the panel vanished.
 */
export class SavingIndicator {
  private readonly element: HTMLDivElement;

  public constructor() {
    this.element = document.createElement("div");
    this.element.textContent = "Salvando...";
    this.element.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      padding: 10px 24px;
      background: rgba(20, 16, 12, 0.92);
      border: 2px solid #8a7346;
      border-radius: 4px;
      font-family: Georgia, 'Times New Roman', serif;
      color: #f2e9d0;
      font-size: 15px;
      letter-spacing: 1px;
      z-index: 2000;
      display: none;
    `;
    document.body.appendChild(this.element);
  }

  public show(): void {
    this.element.style.display = "block";
  }

  public hide(): void {
    this.element.style.display = "none";
  }

  public destroy(): void {
    this.element.remove();
  }
}
