import Phaser from "phaser";
import playerSpriteUrl from "@/assets/sprites/player.png";
import player1SpriteUrl from "@/assets/sprites/player1.png";
import { CREATE_ACCOUNT_ENDPOINT, DEFAULT_PLAYER_SKIN, PLAYER_SKINS, PLAYER_SPRITE, SCENE_KEYS, type PlayerSkinId } from "@/utils/Constants";
import {
  AUTH_ERROR_STYLE,
  AUTH_INPUT_STYLE,
  AUTH_LABEL_STYLE,
  AUTH_PANEL_STYLE,
  AUTH_PRIMARY_BUTTON_STYLE,
  AUTH_SECONDARY_BUTTON_STYLE,
} from "@/ui/AuthFormStyles";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Same source images BootScene loads as Phaser textures — reused here as plain CSS backgrounds so the swatch previews need no extra art. */
const PLAYER_SKIN_URLS: Record<string, string> = {
  player: playerSpriteUrl,
  player1: player1SpriteUrl,
};

/** Full source spritesheet dimensions (see PLAYER_SPRITE's doc comment) — every skin's PNG shares this size, needed to scale the whole sheet down for the swatch crop below. */
const SKIN_SHEET_WIDTH_PX = 976;
const SKIN_SHEET_HEIGHT_PX = 1103;

/** Swatch preview size — big enough to actually see the character, small enough to sit comfortably in the form. */
const SKIN_SWATCH_WIDTH_PX = 72;

const FORM_HTML = `
  <div style="${AUTH_PANEL_STYLE}">
    <div style="font-size: 20px; letter-spacing: 2px;">Criar novo usuário</div>

    <label style="${AUTH_LABEL_STYLE}">Nome</label>
    <input id="register-name-input" type="text" maxlength="20" autocomplete="off" style="${AUTH_INPUT_STYLE}" />

    <label style="${AUTH_LABEL_STYLE}">Senha</label>
    <input id="register-password-input" type="password" maxlength="64" autocomplete="off" style="${AUTH_INPUT_STYLE}" />

    <label style="${AUTH_LABEL_STYLE}">E-mail</label>
    <input id="register-email-input" type="email" maxlength="100" autocomplete="off" style="${AUTH_INPUT_STYLE}" />

    <label style="${AUTH_LABEL_STYLE}">Skin</label>
    <div id="register-skin-selector" style="display: flex; gap: 10px;"></div>

    <div id="register-error" style="${AUTH_ERROR_STYLE}">Preencha nome, senha e e-mail válido.</div>

    <button id="create-user-submit-button" style="${AUTH_PRIMARY_BUTTON_STYLE}">Criar usuário</button>
    <button id="register-back-button" style="${AUTH_SECONDARY_BUTTON_STYLE}">Voltar</button>
  </div>
`;

/**
 * "Criar novo usuário" screen, reached from LoginScene. Validates locally,
 * then POSTs to the gateway's /accounts endpoint (internal/accountstore) to
 * persist the account in Postgres. On success, sends the player to
 * LoginScene to authenticate with the credentials just created.
 */
export class RegisterScene extends Phaser.Scene {
  public constructor() {
    super(SCENE_KEYS.REGISTER);
  }

  public create(): void {
    this.cameras.main.setBackgroundColor("#0a0a0a");

    const domElement = this.add.dom(this.scale.width / 2, this.scale.height / 2).createFromHTML(FORM_HTML);

    const nameInput = domElement.getChildByID("register-name-input") as HTMLInputElement;
    const passwordInput = domElement.getChildByID("register-password-input") as HTMLInputElement;
    const emailInput = domElement.getChildByID("register-email-input") as HTMLInputElement;
    const skinSelectorEl = domElement.getChildByID("register-skin-selector") as HTMLDivElement;
    const errorLabel = domElement.getChildByID("register-error") as HTMLDivElement;
    const submitButton = domElement.getChildByID("create-user-submit-button") as HTMLButtonElement;
    const backButton = domElement.getChildByID("register-back-button") as HTMLButtonElement;

    let selectedSkin: PlayerSkinId = DEFAULT_PLAYER_SKIN;
    const skinSwatches = new Map<PlayerSkinId, HTMLDivElement>();

    const selectSkin = (skinId: PlayerSkinId): void => {
      selectedSkin = skinId;
      for (const [id, swatch] of skinSwatches) {
        swatch.style.borderColor = id === skinId ? "#ffd700" : "transparent";
      }
    };

    for (const skin of PLAYER_SKINS) {
      const swatch = this.createSkinSwatch(skin.id, skin.label);
      swatch.addEventListener("click", () => selectSkin(skin.id));
      skinSwatches.set(skin.id, swatch);
      skinSelectorEl.appendChild(swatch);
    }
    selectSkin(selectedSkin);

    const setError = (message: string): void => {
      errorLabel.textContent = message;
      errorLabel.style.visibility = "visible";
    };

    const clearError = (): void => {
      errorLabel.style.visibility = "hidden";
    };

    const submit = async (): Promise<void> => {
      const name = nameInput.value.trim();
      const password = passwordInput.value;
      const email = emailInput.value.trim();
      if (!name || !password || !EMAIL_PATTERN.test(email)) {
        setError("Preencha nome, senha e e-mail válido.");
        return;
      }

      submitButton.disabled = true;
      try {
        const response = await fetch(CREATE_ACCOUNT_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password, skin: selectedSkin }),
        });

        if (response.status === 201) {
          this.scene.start(SCENE_KEYS.LOGIN);
          return;
        }

        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        switch (body?.error) {
          case "name_taken":
            setError("Esse nome já está em uso.");
            break;
          case "email_taken":
            setError("Esse e-mail já está cadastrado.");
            break;
          default:
            setError("Não foi possível criar o usuário. Tente novamente.");
        }
      } catch {
        setError("Não foi possível conectar ao servidor.");
      } finally {
        submitButton.disabled = false;
      }
    };

    submitButton.addEventListener("click", () => void submit());
    backButton.addEventListener("click", () => this.scene.start(SCENE_KEYS.LOGIN));

    for (const field of [nameInput, passwordInput, emailInput]) {
      field.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          void submit();
        }
        clearError();
      });
    }
    nameInput.focus();

    this.scale.on(Phaser.Scale.Events.RESIZE, () => {
      domElement.setPosition(this.scale.width / 2, this.scale.height / 2);
    });
  }

  /**
   * One clickable preview swatch for the skin picker: the character's idle,
   * camera-facing pose — frame (0, 0) of that skin's spritesheet, the same
   * source image BootScene loads as a Phaser texture, cropped via
   * background-position/-size rather than needing separate thumbnail art.
   * Selection border is toggled by the caller (`selectSkin`), same pattern
   * as MapEditorPanel's texture swatches.
   */
  private createSkinSwatch(skinId: PlayerSkinId, label: string): HTMLDivElement {
    const scale = SKIN_SWATCH_WIDTH_PX / PLAYER_SPRITE.FRAME_WIDTH;
    const swatch = document.createElement("div");
    swatch.title = label;
    swatch.style.cssText = `
      width: ${SKIN_SWATCH_WIDTH_PX}px;
      height: ${Math.round(PLAYER_SPRITE.FRAME_HEIGHT * scale)}px;
      background-image: url(${PLAYER_SKIN_URLS[skinId]});
      background-repeat: no-repeat;
      background-position: 0 0;
      background-size: ${SKIN_SHEET_WIDTH_PX * scale}px ${SKIN_SHEET_HEIGHT_PX * scale}px;
      background-color: #1c1712;
      border: 2px solid transparent;
      border-radius: 3px;
      box-sizing: border-box;
      cursor: pointer;
    `;
    return swatch;
  }
}
