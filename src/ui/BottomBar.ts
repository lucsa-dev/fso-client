import { BOTTOM_BAR_HEIGHT_PX } from "@/utils/Constants";
import { ChatBar, type ChatSubmitHandler } from "@/ui/ChatBar";
import { SkyWidget } from "@/ui/SkyWidget";
import { InventoryPanel } from "@/ui/InventoryPanel";

/**
 * Plain-DOM overlay fixed to the bottom of the viewport, independent of the
 * Phaser canvas/camera. Mirrors SettingsMenu's fixed-overlay approach. Lays out three
 * columns left-to-right: chat, sky widget, inventory — matching the
 * reference client's bottom bar. Chat is the only column with real
 * functionality today; sky and inventory are reserved space, filled in as
 * their features land. Only ever mounted while GameScene is active.
 *
 * Starts collapsed (slid fully off-screen) since on small/mobile viewports
 * its fixed height eats a large share of the screen; a small toggle button
 * pinned to the bottom-right corner slides it in and out on click. The
 * `onToggleCollapsed` callback lets the owning scene resize the game canvas
 * to reclaim the freed space while collapsed.
 */
export class BottomBar {
  private readonly element: HTMLDivElement;
  private readonly toggleButton: HTMLButtonElement;
  private readonly chatBar: ChatBar;
  private readonly skyWidget: SkyWidget;
  private readonly inventoryPanel: InventoryPanel;
  private collapsed = true;

  public constructor(onChatSubmit: ChatSubmitHandler, onToggleCollapsed: (collapsed: boolean) => void) {
    this.element = document.createElement("div");
    this.element.id = "bottom-bar";
    this.element.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: ${BOTTOM_BAR_HEIGHT_PX}px;
      box-sizing: border-box;
      display: flex;
      align-items: stretch;
      border-top: 2px solid #8a7346;
      z-index: 1000;
      transition: transform 0.2s ease;
    `;

    this.chatBar = new ChatBar(onChatSubmit);
    this.skyWidget = new SkyWidget();
    this.inventoryPanel = new InventoryPanel();

    this.element.appendChild(this.chatBar.getElement());
    this.element.appendChild(this.skyWidget.getElement());
    this.element.appendChild(this.inventoryPanel.getElement());
    document.body.appendChild(this.element);

    this.toggleButton = document.createElement("button");
    this.toggleButton.id = "bottom-bar-toggle";
    this.toggleButton.type = "button";
    this.toggleButton.style.cssText = `
      position: fixed;
      right: 10px;
      width: 34px;
      height: 34px;
      box-sizing: border-box;
      border-radius: 50%;
      background: rgba(20, 16, 12, 0.92);
      border: 1px solid #8a7346;
      color: #e8dcc0;
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1001;
      transition: bottom 0.2s ease;
    `;
    this.toggleButton.addEventListener("click", () => {
      this.collapsed = !this.collapsed;
      this.applyCollapsedState();
      onToggleCollapsed(this.collapsed);
    });
    document.body.appendChild(this.toggleButton);

    this.applyCollapsedState();
    onToggleCollapsed(this.collapsed);
  }

  private applyCollapsedState(): void {
    this.element.style.transform = this.collapsed ? "translateY(100%)" : "translateY(0)";
    this.toggleButton.textContent = this.collapsed ? "▲" : "▼";
    this.toggleButton.style.bottom = this.collapsed ? "10px" : `${BOTTOM_BAR_HEIGHT_PX + 10}px`;
  }

  /** Insets the bar's right edge by this many pixels — used to keep it clear of the map editor panel while it's open. */
  public setRightInset(insetPx: number): void {
    this.element.style.right = `${insetPx}px`;
  }

  /** Forwards to the chat column — appends one line to its scrollback log. */
  public appendMessage(senderName: string, message: string): void {
    this.chatBar.appendMessage(senderName, message);
  }

  /** Forwards to the inventory column's HP bar — kept in sync with the player's own head-anchored HP bar (see GameScene's Player.setOnHpChanged handler and Player.redrawHpBar). */
  public updateHp(hp: number, maxHp: number): void {
    this.inventoryPanel.updateHp(hp, maxHp);
  }

  /** Forwards to the inventory column's XP bar — see `updateHp`. */
  public updateXp(xp: number, maxXp: number): void {
    this.inventoryPanel.updateXp(xp, maxXp);
  }

  public destroy(): void {
    this.chatBar.destroy();
    this.skyWidget.destroy();
    this.inventoryPanel.destroy();
    this.element.remove();
    this.toggleButton.remove();
  }
}
