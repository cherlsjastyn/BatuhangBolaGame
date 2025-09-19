// pages/api/socketio.js
import { Server } from "socket.io";
import { query } from "@/lib/db";

const SOCKET_PATH = process.env.NEXT_PUBLIC_SOCKET_PATH || "/api/socketio";

let io;
let matches = {}; // matches keyed by matchKey (string)

function makeEmptyMatch(matchKey, difficulty = "EASY", settings = {}) {
  return {
    matchKey,
    difficulty,
    status: "PENDING",
    players: {}, // local matchPlayerId -> player object
    balls: [], // active balls
    tick: 0,
    settings,
    box: { x: 250, y: 200, w: 100, h: 200 }, // the box where dodgers can run through
  };
}

function spawnAIPlayer(match, id, role, controls) {
  const p = {
    id,
    playerId: null,
    name: `AI-${id.slice(0,4)}`,
    isAI: true,
    role,
    x: Math.random() * 520 + 40,
    y: Math.random() * 520 + 40,
    vx: 0, vy: 0,
    lives: 1,
    scoreHits: 0,
    scoreDodges: 0,
    controls: controls || null
  };
  match.players[id] = p;
  return p;
}

export default function handler(req, res) {
  if (!res.socket.server.io) {
    console.log("Creating Socket.IO server...");
    const ioServer = new Server(res.socket.server, {
      path: SOCKET_PATH,
      cors: { origin: "*" },
    });
    res.socket.server.io = ioServer;
    io = ioServer;

    io.on("connection", (socket) => {
      console.log("socket connected", socket.id);

      socket.on("create-match", ({ matchKey, difficulty }, cb) => {
        if (!matchKey) return cb && cb({ ok: false, error: "matchKey required" });
        if (!matches[matchKey]) {
          matches[matchKey] = makeEmptyMatch(matchKey, difficulty);
          // persist DB match row (non-blocking)
          (async () => {
            try {
              await query("INSERT IGNORE INTO matches (match_key,difficulty) VALUES (?,?)", [matchKey, difficulty]);
            } catch (e) {
              console.error("persist match error", e.message);
            }
          })();
        }
        socket.join(matchKey);
        cb && cb({ ok: true });
      });

      socket.on("join-match", ({ matchKey, clientPlayerId, name, role, isAI=false, controls }, cb) => {
        const match = matches[matchKey];
        if (!match) return cb && cb({ ok:false, error: "no match" });
        // add player
        const id = clientPlayerId || `p-${socket.id}`;
        const p = {
          id,
          playerId: null,
          name: name || `Player-${id.slice(0,4)}`,
          isAI,
          role: role || "DODGER",
          x: Math.random()*520 + 40,
          y: Math.random()*520 + 40,
          vx:0, vy:0,
          lives: 1,
          scoreHits: 0,
          scoreDodges: 0,
          socketId: socket.id,
          controls: controls || null
        };
        match.players[id] = p;
        socket.join(matchKey);
        io.to(matchKey).emit("player-updated", { added: p });
        cb && cb({ ok: true, id });
      });

      socket.on("start-match", ({ matchKey }, cb) => {
        const match = matches[matchKey];
        if (!match) return cb && cb({ ok:false, error:"no match" });
        if (match.status === "RUNNING") return cb && cb({ ok: false, error: "already running" });
        // ensure exactly two throwers exist (server enforces)
        // If fewer, add AI throwers
        const throwers = Object.values(match.players).filter(p => p.role === "THROWER");
        while (throwers.length < 2) {
          const id = `ai-throw-${Math.random().toString(36).slice(2,7)}`;
          spawnAIPlayer(match, id, "THROWER");
          throwers.push(match.players[id]);
        }
        // Fill missing dodgers with AI so total players match settings (if provided)
        const dodgers = Object.values(match.players).filter(p => p.role === "DODGER");
        const totalPlayersDesired = match.settings.totalPlayers || Math.max(1, dodgers.length);
        while (Object.values(match.players).length < (totalPlayersDesired + 2)) {
          const id = `ai-${Math.random().toString(36).slice(2,7)}`;
          spawnAIPlayer(match, id, "DODGER");
        }

        match.status = "RUNNING";
        io.to(matchKey).emit("match-state", snapshot(match));
        cb && cb({ ok: true });
      });

      socket.on("player-action", ({ matchKey, playerId, action }) => {
        const match = matches[matchKey];
        if (!match) return;
        const p = match.players[playerId];
        if (!p) return;
        // handle move
        if (action.type === "move") {
          // small step
          const step = match.difficulty === "EASY" ? 8 : match.difficulty === "MEDIUM" ? 12 : 16;
          if (action.dir === "w" || action.dir === "ArrowUp") p.y = Math.max(20, p.y - step);
          if (action.dir === "s" || action.dir === "ArrowDown") p.y = Math.min(580, p.y + step);
          if (action.dir === "a" || action.dir === "ArrowLeft") p.x = Math.max(20, p.x - step);
          if (action.dir === "d" || action.dir === "ArrowRight") p.x = Math.min(580, p.x + step);
        }
        if (action.type === "throw") {
          // throw a ball from thrower towards random dodger or box
          const from = p;
          const targets = Object.values(match.players).filter(x => x.role === "DODGER" && x.id !== from.id);
          // if no targets, aim at center box
          const target = targets.length ? targets[Math.floor(Math.random()*targets.length)] : { x: match.box.x + match.box.w/2, y: match.box.y + match.box.h/2 };
          const dx = target.x - from.x;
          const dy = target.y - from.y;
          const mag = Math.sqrt(dx*dx + dy*dy) || 1;
          const speedBase = match.difficulty === "EASY" ? 6 : match.difficulty === "MEDIUM" ? 9 : 12;
          const speed = speedBase + (from.isAI ? 0 : 0); // can adjust by who throws
          const vx = (dx/mag) * speed;
          const vy = (dy/mag) * speed;
          match.balls.push({
            id: `ball-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
            x: from.x,
            y: from.y,
            vx, vy,
            owner: from.id,
            life: 100
          });
          io.to(matchKey).emit("ball-thrown", { owner: from.id });
        }
        if (action.type === "catch") {
          // catch restores extra life
          p.lives += 1;
          io.to(matchKey).emit("extra-life", { id: p.id, lives: p.lives });
        }
      });

      socket.on("leave-match", ({ matchKey, playerId }) => {
        const match = matches[matchKey];
        if (!match) return;
        delete match.players[playerId];
        io.to(matchKey).emit("player-left", { id: playerId });
      });

      socket.on("disconnect", () => {
        // leave logic optional
      });
    });

    // Game loop: runs server-side, moves balls, resolves collisions, runs AI
    setInterval(async () => {
      Object.values(matches).forEach((match) => {
        if (match.status !== "RUNNING") {
          io.to(match.matchKey).emit("match-state", snapshot(match));
          return;
        }
        match.tick++;

        // AI behavior for AI players
        Object.values(match.players).forEach((p) => {
          if (!p.isAI) return;
          if (p.role === "THROWER") {
            // throw occasionally based on difficulty
            const freq = match.difficulty === "EASY" ? 120 : match.difficulty === "MEDIUM" ? 80 : 50;
            if (Math.random() * freq < 1) {
              // emit as if action type throw
              const targets = Object.values(match.players).filter(x => x.role === "DODGER" && x.id !== p.id);
              const target = targets.length ? targets[Math.floor(Math.random()*targets.length)] : { x: match.box.x + match.box.w/2, y: match.box.y + match.box.h/2 };
              const dx = target.x - p.x;
              const dy = target.y - p.y;
              const mag = Math.sqrt(dx*dx + dy*dy) || 1;
              const speedBase = match.difficulty === "EASY" ? 6 : match.difficulty === "MEDIUM" ? 9 : 12;
              const vx = (dx/mag)*speedBase;
              const vy = (dy/mag)*speedBase;
              match.balls.push({ id:`ai-ball-${Date.now()}`, x: p.x, y: p.y, vx, vy, owner: p.id, life: 120 });
            }
          } else {
            // dodger AI: sometimes move toward random point, sometimes sprint through box
            if (Math.random() < 0.02) {
              // pick random target point; if near box try run through
              const insideBox = Math.random() < 0.3;
              if (insideBox) {
                p.x = match.box.x + Math.random()*match.box.w;
                p.y = match.box.y + Math.random()*match.box.h;
              } else {
                p.x = Math.max(20, Math.min(580, p.x + (Math.random()-0.5)*60));
                p.y = Math.max(20, Math.min(580, p.y + (Math.random()-0.5)*60));
              }
            }
            // small random dodge increment
            if (Math.random() < 0.05) p.scoreDodges++;
          }
        });

        // Move balls
        match.balls.forEach((b) => {
          b.x += b.vx;
          b.y += b.vy;
          b.life -= 1;
        });

        // Resolve collisions ball vs players
        match.balls.forEach((b) => {
          Object.values(match.players).forEach((p) => {
            if (p.id === b.owner) return;
            const dx = p.x - b.x;
            const dy = p.y - b.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist < 18 && b.life > 0) {
              // If player is inside the box at moment of contact and is a dodger, treat possibility of catch
              const insideBox = p.x >= match.box.x && p.x <= match.box.x+match.box.w && p.y >= match.box.y && p.y <= match.box.y+match.box.h;
              if (p.role === "DODGER") {
                // If dodger catches (small chance) they gain a life instead of being hit
                if (insideBox && Math.random() < 0.25) {
                  p.lives += 1;
                  io.to(match.matchKey).emit("extra-life", { id: p.id, lives: p.lives });
                } else {
                  p.lives -= 1;
                  // increment thrower's hit score
                  const thrower = match.players[b.owner];
                  if (thrower) thrower.scoreHits++;
                  io.to(match.matchKey).emit("hit", { thrower: b.owner, dodger: p.id });
                }
              } else {
                // if hit a thrower (rare), just ignore
              }
              b.life = 0; // destroy ball
            }
          });
        });

        // cleanup balls
        match.balls = match.balls.filter(b => b.life > 0 && b.x >= -50 && b.x <= 700 && b.y >= -50 && b.y <= 700);

        // Check game end condition: if all dodgers have 0 lives => finish
        const aliveDodgers = Object.values(match.players).filter(p => p.role === "DODGER" && p.lives > 0);
        if (aliveDodgers.length === 0) {
          match.status = "FINISHED";
          io.to(match.matchKey).emit("match-state", snapshot(match));
          // persist results (aggregate) and cleanup
          (async () => {
            try {
              await persistMatchToDB(match);
            } catch (e) {
              console.error("persist err", e);
            }
            // delete after persisting
            delete matches[match.matchKey];
          })();
          return;
        }

        io.to(match.matchKey).emit("match-state", snapshot(match));
      });
    }, 100); // 100ms tick
  }
  res.end();
}

// snapshot to send to clients (minimal)
function snapshot(match) {
  return {
    id: match.matchKey,
    status: match.status,
    difficulty: match.difficulty,
    players: Object.values(match.players).map(p => ({
      id: p.id, name: p.name, role: p.role, isAI: p.isAI, x: p.x, y: p.y, lives: p.lives, scoreHits: p.scoreHits, scoreDodges: p.scoreDodges
    })),
    balls: match.balls.map(b => ({ id: b.id, x: b.x, y: b.y, owner: b.owner })),
    box: match.box
  };
}

// persist aggregates to DB on match finish
async function persistMatchToDB(match) {
  // for each player with playerId update players table
  for (const p of Object.values(match.players)) {
    if (!p.playerId) continue; // skip AI
    if (p.role === "THROWER") {
      const col = match.difficulty === "EASY" ? "total_hits_easy" : match.difficulty === "MEDIUM" ? "total_hits_medium" : "total_hits_hard";
      await query(`UPDATE players SET ${col} = ${col} + ? WHERE id = ?`, [p.scoreHits, p.playerId]);
    } else {
      const col = match.difficulty === "EASY" ? "total_dodges_easy" : match.difficulty === "MEDIUM" ? "total_dodges_medium" : "total_dodges_hard";
      await query(`UPDATE players SET ${col} = ${col} + ? WHERE id = ?`, [p.scoreDodges, p.playerId]);
    }
  }
}
