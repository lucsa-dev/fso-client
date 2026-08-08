import { SKY_WIDGET_WIDTH_PX } from "@/utils/Constants";

/**
 * Narrow column between the chat and the inventory, reserved for a future
 * day/night indicator (sun/moon shape changing with the in-game clock).
 * Space-only placeholder for now — mounted as a column of BottomBar, which
 * owns the actual fixed positioning.
 */
export class SkyWidget {
  private readonly element: HTMLDivElement;

  public constructor() {
    this.element = document.createElement("div");
    this.element.id = "sky-widget";
    this.element.style.cssText = `
      flex: 0 0 ${SKY_WIDGET_WIDTH_PX}px;
      height: 100%;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      border-left: 1px solid #8a7346;
      border-right: 1px solid #8a7346;
      background: rgba(20, 16, 12, 0.75);
      color: #8a7346;
      font-size: 16px;
    `;
    this.element.textContent = "☀";
  }

  /** The mountable root — appended into BottomBar's layout row. */
  public getElement(): HTMLDivElement {
    return this.element;
  }

  public destroy(): void {
    this.element.remove();
  }
}
