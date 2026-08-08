import Phaser from "phaser";
import { SCENE_KEYS } from "@/utils/Constants";
import { AUTH_PANEL_STYLE, AUTH_SECONDARY_BUTTON_STYLE } from "@/ui/AuthFormStyles";

const FORM_HTML = `
  <div style="${AUTH_PANEL_STYLE}">
    <div style="font-size: 20px; letter-spacing: 2px;">Configurações</div>
    <div style="font-size: 14px; color: #b8ac8e;">Em breve.</div>
    <button id="settings-back-button" style="${AUTH_SECONDARY_BUTTON_STYLE}">Voltar</button>
  </div>
`;

/** Placeholder "Configurações" screen, reached from LoginScene. No settings implemented yet. */
export class SettingsScene extends Phaser.Scene {
  public constructor() {
    super(SCENE_KEYS.SETTINGS);
  }

  public create(): void {
    this.cameras.main.setBackgroundColor("#0a0a0a");

    const domElement = this.add.dom(this.scale.width / 2, this.scale.height / 2).createFromHTML(FORM_HTML);

    const backButton = domElement.getChildByID("settings-back-button") as HTMLButtonElement;
    backButton.addEventListener("click", () => this.scene.start(SCENE_KEYS.LOGIN));

    this.scale.on(Phaser.Scale.Events.RESIZE, () => {
      domElement.setPosition(this.scale.width / 2, this.scale.height / 2);
    });
  }
}
