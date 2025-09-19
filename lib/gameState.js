// lib/gameState.js
import { query } from "./db.js"; // assumes MySQL connection

const matches = {}; // matchId => match object

// match = { id, difficulty, status, players, aiIntervals }

export function createMatch(matchId, settings = { difficulty: "EASY", host_role: "DODGER" }) {
  matches[matchId] = {
    id: matchId,
    difficulty: settings.difficulty || "EASY",
    status: "PENDING",
    players: {},
    aiIntervals: {},
    box: { x: 250, y: 200, w: 100, h: 200 },
    balls: [],
  };
  return matches[matchId];
}

export function getMatch(matchId) {
  return matches[matchId];
}

export function addHumanToMatch(matchId, playerState) {
  const m = matches[matchId];
  if (!m) return null;
  m.players[playerState.id] = playerState;
  return playerState;
}

export function addAIToMatch(matchId, aiId, role) {
  const m = matches[matchId];
  const ai = {
    id: aiId,
    playerId: null,
    name: `AI-${aiId}`,
    isAI: true,
    role,
    lives: 1,
    scoreHits: 0,
    scoreDodges: 0,
    socketId: null,
    controls: null,
  };
  m.players[aiId] = ai;
  return ai;
}

export function removeFromMatch(matchId, id) {
  const m = matches[matchId];
  if (!m) return;
  delete m.players[id];
}

export function startMatch(matchId, io) {
  const m = matches[matchId];
  if (!m) return null;
  m.status = "RUNNING";

  // start AI loops
  Object.values(m.players).forEach((p) => {
    if (p.isAI) startAILoop(matchId, p, io);
  });

  io.to(matchId).emit("match-state", snapshot(m));
  return m;
}

export function snapshot(m) {
  return {
    id: m.id,
    difficulty: m.difficulty,
    status: m.status,
    players: Object.values(m.players).map((p) => ({
      id: p.id,
      name: p.name,
      isAI: p.isAI,
      role: p.role,
      lives: p.lives,
      scoreHits: p.scoreHits,
      scoreDodges: p.scoreDodges,
    })),
    box: m.box,
    balls: m.balls,
  };
}

function startAILoop(matchId, aiPlayer, io) {
  const m = matches[matchId];
  if (!m) return;

  const base = m.difficulty === "EASY" ? 1200 : m.difficulty === "MEDIUM" ? 800 : 450;
  const intervalMs = base + Math.floor(Math.random() * 300);

  const id = setInterval(() => {
    if (m.status !== "RUNNING") return;

    if (aiPlayer.role === "THROWER") {
      const dodgers = Object.values(m.players).filter((p) => p.role === "DODGER");
      if (dodgers.length === 0) return;

      const target = dodgers[Math.floor(Math.random() * dodgers.length)];
      const chance = m.difficulty === "EASY" ? 0.35 : m.difficulty === "MEDIUM" ? 0.55 : 0.75;
      const hit = Math.random() < chance;

      if (hit) {
        aiPlayer.scoreHits++;
        target.lives--;
        io.to(matchId).emit("hit", { thrower: aiPlayer.id, dodger: target.id });
        if (target.lives <= 0) io.to(matchId).emit("player-eliminated", { id: target.id });
      } else {
        if (Math.random() < 0.6) {
          target.scoreDodges++;
          io.to(matchId).emit("dodge", { dodger: target.id });
        }
      }
      io.to(matchId).emit("match-state", snapshot(m));
    } else {
      if (Math.random() < 0.05) {
        aiPlayer.lives++;
        io.to(matchId).emit("extra-life", { id: aiPlayer.id, lives: aiPlayer.lives });
      } else if (Math.random() < 0.25) {
        aiPlayer.scoreDodges++;
        io.to(matchId).emit("dodge", { dodger: aiPlayer.id });
      }
      io.to(matchId).emit("match-state", snapshot(m));
    }
  }, intervalMs);

  m.aiIntervals[aiPlayer.id] = id;
}

export async function stopMatch(matchId) {
  const m = matches[matchId];
  if (!m) return;
  m.status = "FINISHED";

  // clear AI
  Object.values(m.aiIntervals).forEach((id) => clearInterval(id));
  m.aiIntervals = {};

  await persistMatchResult(m);
  delete matches[matchId];
}

export async function persistMatchResult(match) {
  for (const p of Object.values(match.players)) {
    if (!p.playerId) continue; // skip AI
    if (p.role === "THROWER") {
      const col =
        match.difficulty === "EASY"
          ? "total_hits_easy"
          : match.difficulty === "MEDIUM"
          ? "total_hits_medium"
          : "total_hits_hard";
      await query(`UPDATE players SET ${col} = ${col} + ? WHERE id = ?`, [p.scoreHits, p.playerId]);
    } else {
      const col =
        match.difficulty === "EASY"
          ? "total_dodges_easy"
          : match.difficulty === "MEDIUM"
          ? "total_dodges_medium"
          : "total_dodges_hard";
      await query(`UPDATE players SET ${col} = ${col} + ? WHERE id = ?`, [p.scoreDodges, p.playerId]);
    }
  }
}

export function applyPlayerAction(matchId, playerId, action, io) {
  const m = matches[matchId];
  if (!m) return;
  const p = m.players[playerId];
  if (!p) return;

  if (action.type === "throw") {
    const dodgers = Object.values(m.players).filter((x) => x.role === "DODGER" && x.id !== p.id);
    if (dodgers.length === 0) {
      io.to(matchId).emit("info", { message: "No dodgers to hit" });
      return;
    }
    const target = dodgers[Math.floor(Math.random() * dodgers.length)];
    const chance = m.difficulty === "EASY" ? 0.3 : m.difficulty === "MEDIUM" ? 0.55 : 0.75;
    const hit = Math.random() < chance;
    if (hit) {
      p.scoreHits++;
      target.lives--;
      io.to(matchId).emit("hit", { thrower: p.id, dodger: target.id });
      if (target.lives <= 0) io.to(matchId).emit("player-eliminated", { id: target.id });
    } else {
      target.scoreDodges++;
      io.to(matchId).emit("dodge", { dodger: target.id });
    }
    io.to(matchId).emit("match-state", snapshot(m));
  } else if (action.type === "catch") {
    p.lives++;
    io.to(matchId).emit("extra-life", { id: p.id, lives: p.lives });
    io.to(matchId).emit("match-state", snapshot(m));
  } else if (action.type === "move") {
    io.to(matchId).emit("info", { message: `${p.name} moved ${action.dir || ""}` });
  }
}
