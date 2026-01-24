import { DurableObject } from "cloudflare:workers";
import { EnvBindings } from "../bindings";

export interface SocketEvent {
    name: string;
    data: any;
  };

export class SocketDO extends DurableObject {

  constructor(state: DurableObjectState, env: EnvBindings) {
    super(state, env);
  }

  async fetch(request: Request) {
    const socketPair = new WebSocketPair();

    const client = socketPair[0];
    const server = socketPair[1];

    // Accept the websocket connection
    server.accept();

    server.addEventListener("message", (event) => {
      console.log("Received from Next.js:", event.data);
      server.send(`Airtable Sync Update: ${new Date().toISOString()}`);
    });

    server.addEventListener("close", () => {
      console.log("Connection closed");
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async sendEvent(event: SocketEvent) {
    const payload = JSON.stringify(event);
    
    // Get all active WebSockets managed by this DO
    const vens = this.ctx.getWebSockets();
    
    vens.forEach((ws) => {
      try {
        ws.send(payload);
      } catch (e) {
        // Hibernation API handles cleanup mostly, but good to have
      }
    });
    
    return { success: true, clientCount: vens.length };
  }
}
