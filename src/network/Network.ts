import { NetworkEventType } from "@/types/NetworkTypes";
import type { NetworkEventHandler, NetworkMessage } from "@/types/NetworkTypes";

/**
 * Thin pub/sub wrapper around the gateway WebSocket connection (see
 * fso_web_server's internal/gateway). Fires NetworkEventType.Connected /
 * Disconnected as local lifecycle events (never sent over the wire); every
 * other event type round-trips through the socket as a NetworkMessage.
 */
export class Network {
  private socket: WebSocket | null = null;
  private readonly handlers = new Map<NetworkEventType, Set<NetworkEventHandler>>();

  public isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  public connect(url: string): void {
    if (this.socket) {
      return;
    }

    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onopen = () => this.emit(NetworkEventType.Connected, undefined);

    socket.onclose = () => {
      if (this.socket === socket) {
        this.socket = null;
      }
      this.emit(NetworkEventType.Disconnected, undefined);
    };

    socket.onerror = () => {
      console.warn("Network: WebSocket error.");
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      let message: NetworkMessage;
      try {
        message = JSON.parse(event.data) as NetworkMessage;
      } catch {
        console.warn("Network: received malformed message, ignoring.", event.data);
        return;
      }
      this.emit(message.type, message.payload);
    };
  }

  public disconnect(): void {
    this.socket?.close();
    this.socket = null;
  }

  private emit<TPayload>(type: NetworkEventType, payload: TPayload): void {
    this.handlers.get(type)?.forEach((handler) => handler(payload));
  }

  public send<TPayload>(type: NetworkEventType, payload: TPayload): void {
    if (!this.isConnected() || !this.socket) {
      return;
    }
    const message: NetworkMessage<TPayload> = { type, payload, timestamp: Date.now() };
    this.socket.send(JSON.stringify(message));
  }

  public on<TPayload>(type: NetworkEventType, handler: NetworkEventHandler<TPayload>): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)?.add(handler as NetworkEventHandler);
  }

  public off<TPayload>(type: NetworkEventType, handler: NetworkEventHandler<TPayload>): void {
    this.handlers.get(type)?.delete(handler as NetworkEventHandler);
  }
}

export const network = new Network();
