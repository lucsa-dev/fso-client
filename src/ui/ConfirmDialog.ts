/**
 * Small centered confirmation modal, styled to match MobEditorModal's dark
 * parchment look. Used for destructive actions that need an explicit
 * "are you sure" — e.g. deleting a mob type that's still placed on the map
 * (see MapEditorPanel's mob list). Destroys itself on either button or a
 * click on the dimmed backdrop; the backdrop and Cancelar both mean "do
 * nothing", so only `onConfirm` distinguishes proceeding from cancelling.
 */
export class ConfirmDialog {
  private readonly overlay: HTMLDivElement;

  public constructor(message: string, onConfirm: () => void) {
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
      width: 280px;
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
      gap: 14px;
    `;
    dialog.addEventListener("click", (event) => event.stopPropagation());

    const messageEl = document.createElement("div");
    messageEl.textContent = message;
    messageEl.style.cssText = "line-height: 1.4;";
    dialog.appendChild(messageEl);

    const buttonRow = document.createElement("div");
    buttonRow.style.cssText = "display: flex; gap: 8px;";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "Cancelar";
    cancelButton.style.cssText = this.actionButtonStyle("#6b5a3a", "#4a3f2a");
    cancelButton.addEventListener("click", () => this.destroy());

    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.textContent = "Excluir";
    confirmButton.style.cssText = this.actionButtonStyle("#a11f1f", "#6e1414");
    confirmButton.addEventListener("click", () => {
      this.destroy();
      onConfirm();
    });

    buttonRow.appendChild(cancelButton);
    buttonRow.appendChild(confirmButton);
    dialog.appendChild(buttonRow);

    this.overlay.appendChild(dialog);
    document.body.appendChild(this.overlay);
  }

  public destroy(): void {
    this.overlay.remove();
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
