import Phaser from "phaser";
import { DEFAULT_PLAYER_SKIN, isPlayerSkinId, LOGIN_ENDPOINT, SCENE_KEYS } from "@/utils/Constants";
import { PlayerSession } from "@/utils/PlayerSession";
import {
  AUTH_ERROR_STYLE,
  AUTH_INPUT_STYLE,
  AUTH_LABEL_STYLE,
  AUTH_PANEL_STYLE,
  AUTH_PRIMARY_BUTTON_STYLE,
  AUTH_SECONDARY_BUTTON_STYLE,
} from "@/ui/AuthFormStyles";
import type { GameSceneData } from "@/types/GameTypes";

const FORM_HTML = `
  <div style="${AUTH_PANEL_STYLE}">
    <div style="font-size: 20px; letter-spacing: 2px;">Entrar</div>

    <label style="${AUTH_LABEL_STYLE}">Nome</label>
    <input id="character-name-input" type="text" maxlength="20" autocomplete="off" style="${AUTH_INPUT_STYLE}" />

    <label style="${AUTH_LABEL_STYLE}">Senha</label>
    <input id="password-input" type="password" maxlength="64" autocomplete="off" style="${AUTH_INPUT_STYLE}" />

    <div id="login-error" style="${AUTH_ERROR_STYLE}">Preencha nome e senha.</div>

    <button id="play-button" style="${AUTH_PRIMARY_BUTTON_STYLE}">Entrar</button>
    <button id="settings-button" style="${AUTH_SECONDARY_BUTTON_STYLE}">Configurações</button>
    <button id="create-user-button" style="${AUTH_SECONDARY_BUTTON_STYLE}">Criar novo usuário</button>
  </div>
`;

/**
 * The initial screen with DOM UI. Authenticates against the gateway's
 * /accounts/login endpoint (internal/accountstore, Postgres-backed) — see
 * RegisterScene for account creation.
 */
interface LoginSceneData {
  /** Shown once, e.g. after the gateway kicked this session for a login elsewhere (see GameScene's handleNetworkError). */
  message?: string;
}

export class LoginScene extends Phaser.Scene {
  private initialMessage?: string;

  public constructor() {
    super(SCENE_KEYS.LOGIN);
  }

  public init(data: LoginSceneData): void {
    this.initialMessage = data.message;
  }

  public create(): void {
    this.cameras.main.setBackgroundColor("#0a0a0a");

    const domElement = this.add.dom(this.scale.width / 2, this.scale.height / 2).createFromHTML(FORM_HTML);

    const nameInput = domElement.getChildByID("character-name-input") as HTMLInputElement;
    const passwordInput = domElement.getChildByID("password-input") as HTMLInputElement;
    const errorLabel = domElement.getChildByID("login-error") as HTMLDivElement;
    const playButton = domElement.getChildByID("play-button") as HTMLButtonElement;
    const settingsButton = domElement.getChildByID("settings-button") as HTMLButtonElement;
    const createUserButton = domElement.getChildByID("create-user-button") as HTMLButtonElement;

    const setError = (message: string): void => {
      errorLabel.textContent = message;
      errorLabel.style.visibility = "visible";
    };

    const clearError = (): void => {
      errorLabel.style.visibility = "hidden";
    };

    if (this.initialMessage) {
      setError(this.initialMessage);
    }

    const submit = async (): Promise<void> => {
      const name = nameInput.value.trim();
      const password = passwordInput.value;
      if (!name || !password) {
        setError("Preencha nome e senha.");
        (name ? passwordInput : nameInput).focus();
        return;
      }

      playButton.disabled = true;
      try {
        const response = await fetch(LOGIN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, password }),
        });

        if (response.status === 200) {
          const body = (await response.json().catch(() => null)) as { skin?: string } | null;
          const skin = body?.skin && isPlayerSkinId(body.skin) ? body.skin : DEFAULT_PLAYER_SKIN;
          PlayerSession.setCharacterName(name);
          PlayerSession.setCharacterSkin(skin);
          const sceneData: GameSceneData = { characterName: name, skin };
          this.scene.start(SCENE_KEYS.GAME, sceneData);
          return;
        }

        setError(response.status === 401 ? "Nome ou senha inválidos." : "Não foi possível entrar. Tente novamente.");
      } catch {
        setError("Não foi possível conectar ao servidor.");
      } finally {
        playButton.disabled = false;
      }
    };

    playButton.addEventListener("click", () => void submit());
    settingsButton.addEventListener("click", () => this.scene.start(SCENE_KEYS.SETTINGS));
    createUserButton.addEventListener("click", () => this.scene.start(SCENE_KEYS.REGISTER));

    for (const field of [nameInput, passwordInput]) {
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
}
