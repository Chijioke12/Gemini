import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import { exec } from "child_process";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  const PORT = 3000;

  // WebSocket Server setup
  const wss = new WebSocketServer({ server });

  // Map to store connections by room ID
  const rooms = new Map<string, { uiSockets: Set<WebSocket>, agentSockets: Set<WebSocket> }>();

  wss.on("connection", (socket, req) => {
    // ... existing ws logic ...
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const roomId = url.searchParams.get("room");
    const role = url.searchParams.get("role");

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
    } else if (role === "agent") {
      room.agentSockets.add(socket);
      room.uiSockets.forEach(s => s.send(JSON.stringify({ type: "status", data: "agent_connected" })));
    }

    socket.on("message", (data) => {
      if (role === "ui") {
        room.agentSockets.forEach(s => s.send(data.toString()));
      } else {
        room.uiSockets.forEach(s => s.send(data.toString()));
      }
    });

    socket.on("close", () => {
      if (role === "ui") {
        room.uiSockets.delete(socket);
      } else {
        room.agentSockets.delete(socket);
        room.uiSockets.forEach(s => s.send(JSON.stringify({ type: "status", data: "agent_disconnected" })));
      }
      if (room.uiSockets.size === 0 && room.agentSockets.size === 0) {
        rooms.delete(roomId);
      }
    });
  });

  // Direct Execution APIs (for when running locally in Termux)
  const WORKSPACE_DIR = path.join(process.cwd(), 'workspace');
  if (!fs.existsSync(WORKSPACE_DIR)) fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  app.post("/api/execute", (req, res) => {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: "Missing command" });

    exec(command, { cwd: WORKSPACE_DIR }, (error, stdout, stderr) => {
      res.json({
        output: stdout,
        error: stderr || (error ? error.message : null)
      });
    });
  });

  app.post("/api/write", (req, res) => {
    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) return res.status(400).json({ error: "Missing path or content" });

    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(WORKSPACE_DIR, filePath);
      
      // Safety check: ensure path is within workspace
      if (!fullPath.startsWith(WORKSPACE_DIR)) {
        return res.status(403).json({ error: "Forbidden: Path must be inside workspace/" });
      }

      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, content);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
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
