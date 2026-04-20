import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = 3000;

  // WebSocket Server setup
  const wss = new WebSocketServer({ server });

  // Map to store connections by room ID
  // roomId -> { uiSockets: Set<WebSocket>, agentSockets: Set<WebSocket> }
  const rooms = new Map<string, { uiSockets: Set<WebSocket>, agentSockets: Set<WebSocket> }>();

  wss.on("connection", (socket, req) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const roomId = url.searchParams.get("room");
    const role = url.searchParams.get("role"); // 'ui' or 'agent'

    if (!roomId || !role) {
      socket.close(1008, "Missing room or role");
      return;
    }

    if (!rooms.has(roomId)) {
      rooms.set(roomId, { uiSockets: new Set(), agentSockets: new Set() });
    }

    const room = rooms.get(roomId)!;
    if (role === "ui") {
      room.uiSockets.add(socket);
      console.log(`UI connected to room: ${roomId}`);
    } else if (role === "agent") {
      room.agentSockets.add(socket);
      console.log(`Agent connected to room: ${roomId}`);
      // Notify UI that agent is connected
      room.uiSockets.forEach(s => s.send(JSON.stringify({ type: "status", data: "agent_connected" })));
    }

    socket.on("message", (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch (e) {
        return;
      }

      // Relay logic
      if (role === "ui") {
        // Relay to all agents in the room
        room.agentSockets.forEach(s => s.send(data.toString()));
      } else {
        // Relay to all UI clients in the room
        room.uiSockets.forEach(s => s.send(data.toString()));
      }
    });

    socket.on("close", () => {
      if (role === "ui") {
        room.uiSockets.delete(socket);
      } else {
        room.agentSockets.delete(socket);
        // Notify UI that agent disconnected
        room.uiSockets.forEach(s => s.send(JSON.stringify({ type: "status", data: "agent_disconnected" })));
      }
      
      if (room.uiSockets.size === 0 && room.agentSockets.size === 0) {
        rooms.delete(roomId);
      }
    });
  });

  // API Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", rooms: rooms.size });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production static files
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
