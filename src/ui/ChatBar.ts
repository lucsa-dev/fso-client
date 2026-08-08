export type ChatSubmitHandler = (message: string) => void;

/** Maximum lines kept in the scrollback — oldest lines drop off past this. */
const MAX_LOG_LINES = 50;
const INPUT_ROW_HEIGHT_PX = 34;

/**
 * Chat column: a scrollback log (populated by appendMessage, fed from
 * incoming ChatMessage network events) stacked above an input row — Enter
 * (or the Send button) submits and clears the field. Fills whatever height
 * its parent gives it; mounted as the left column of BottomBar, which owns
 * the actual fixed positioning. Only ever mounted while GameScene is active.
 */
export class ChatBar {
  private readonly element: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly log: HTMLDivElement;

  public constructor(onSubmit: ChatSubmitHandler) {
    this.element = document.createElement("div");
    this.element.id = "chat-bar";
    this.element.style.cssText = `
      flex: 1 1 auto;
      min-width: 260px;
      height: 100%;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      font-family: Georgia, 'Times New Roman', serif;
    `;

    this.log = document.createElement("div");
    this.log.id = "chat-log";
    this.log.style.cssText = `
      flex: 1 1 auto;
      box-sizing: border-box;
      overflow-y: auto;
      padding: 6px 10px;
      background: rgba(20, 16, 12, 0.75);
      font-size: 12px;
      color: #f2e9d0;
    `;

    const inputRow = document.createElement("div");
    inputRow.style.cssText = `
      flex: 0 0 ${INPUT_ROW_HEIGHT_PX}px;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
      border-top: 1px solid #8a7346;
      background: rgba(20, 16, 12, 0.92);
    `;

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.maxLength = 200;
    this.input.autocomplete = "off";
    this.input.placeholder = "Digite uma mensagem...";
    this.input.style.cssText = `
      flex: 1;
      box-sizing: border-box;
      padding: 6px 10px;
      font-size: 14px;
      font-family: inherit;
      background: #1c1712;
      border: 1px solid #8a7346;
      border-radius: 3px;
      color: #f2e9d0;
      outline: none;
    `;

    const sendButton = document.createElement("button");
    sendButton.textContent = "Enviar";
    sendButton.style.cssText = `
      padding: 4px 14px;
      font-size: 13px;
      font-family: inherit;
      letter-spacing: 1px;
      background: #4a3f2a;
      border: 1px solid #8a7346;
      border-radius: 3px;
      color: #f2e9d0;
      cursor: pointer;
    `;

    const submit = (): void => {
      const message = this.input.value.trim();
      if (!message) {
        return;
      }
      onSubmit(message);
      this.input.value = "";
    };

    sendButton.addEventListener("click", submit);
    this.input.addEventListener("keydown", (event) => {
      // Only steals keys (including arrows/F1) from Phaser's keyboard
      // handlers once the player has actually started composing a message —
      // with an empty box, arrow keys still move the player so clicking
      // into the chat input doesn't strand them.
      if (this.input.value.length > 0) {
        event.stopPropagation();
      }
      if (event.key === "Enter") {
        submit();
      }
    });

    inputRow.appendChild(this.input);
    inputRow.appendChild(sendButton);
    this.element.appendChild(this.log);
    this.element.appendChild(inputRow);
  }

  /** The mountable root — appended into BottomBar's layout row. */
  public getElement(): HTMLDivElement {
    return this.element;
  }

  /** Appends one line to the scrollback log (from an incoming ChatMessage network event) and scrolls to the bottom. */
  public appendMessage(senderName: string, message: string): void {
    const line = document.createElement("div");
    line.textContent = `${senderName}: ${message}`;
    this.log.appendChild(line);

    while (this.log.childElementCount > MAX_LOG_LINES) {
      this.log.firstElementChild?.remove();
    }
    this.log.scrollTop = this.log.scrollHeight;
  }

  public destroy(): void {
    this.element.remove();
  }
}
