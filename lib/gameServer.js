// lib/gameServer.js
import {
  createMatch,
  getMatch,
  addHumanToMatch,
  addAIToMatch,
  startMatch,
  applyPlayerAction,
  stopMatch,
  snapshot,
} from "./gameState.js";

export function initGameServer(io) {
  io.on("connection", (socket) => {
    console.log("socket connected", socket.id);

    // create a new match
    socket.on("create-match", async (payload, cb) => {
      const matchId = payload.matchId || `match-${socket.id}`;
      const match = createMatch(matchId, {
        difficulty: payload.difficulty || "EASY",
        host_role: payload.host_role || "DODGER",
      });
      socket.join(matchId);
      cb && cb({ ok: true, matchId });
      // send initial snapshot right away
      io.to(matchId).emit("match-state", snapshot(match));
    });

    // join an existing match
    socket.on("join-match", async (payload, cb) => {
      const m = getMatch(payload.matchId);
      if (!m) {
        cb && cb({ ok: false, error: "no match" });
        return;
      }
      const newPlayer = {
        id: payload.clientPlayerId || `p-${socket.id}`,
        playerId: payload.playerId || null,
        name: payload.name || `Player-${socket.id.substring(0, 4)}`,
        isAI: payload.isAI || false,
        role: payload.role || "DODGER",
        lives: 1,
        scoreHits: 0,
        scoreDodges: 0,
        socketId: socket.id,
        controls: payload.controls || null,
      };
      addHumanToMatch(payload.matchId, newPlayer);
      socket.join(payload.matchId);
      io.to(payload.matchId).emit("player-updated", { added: newPlayer });
      io.to(payload.matchId).emit("match-state", snapshot(m));
      cb && cb({ ok: true });
    });

    // start a match
    socket.on("start-match", (payload, cb) => {
      const m = startMatch(payload.matchId, io);
      if (m) io.to(payload.matchId).emit("match-state", snapshot(m));
      cb && cb({ ok: true });
    });

    // player actions
    socket.on("player-action", (payload) => {
      applyPlayerAction(payload.matchId, payload.playerId, payload.action, io);
    });

    // leave a match
    socket.on("leave-match", (payload) => {
      socket.leave(payload.matchId);
      io.to(payload.matchId).emit("player-left", { id: payload.playerId });
    });

    // disconnect
    socket.on("disconnect", () => {
      console.log("socket disconnect", socket.id);
    });
  });
}
