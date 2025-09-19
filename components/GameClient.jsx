// components/GameClient.jsx
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const SOCKET_PATH = process.env.NEXT_PUBLIC_SOCKET_PATH || "/api/socketio";

export default function GameClient({ matchId, name, role = "DODGER", onGameOver }) {
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState(null);
  const canvasRef = useRef(null);
  const socketRef = useRef(null);
  const playerIdRef = useRef(`client-${Math.random().toString(36).slice(2, 8)}`);

  // connect
  useEffect(() => {
    fetch(SOCKET_PATH).finally(() => {
      const socket = io({ path: SOCKET_PATH });
      socketRef.current = socket;

      socket.on("connect", () => setConnected(true));
      socket.on("disconnect", () => setConnected(false));

      socket.on("match-state", (s) => {
        console.log("📡 received match-state", s);
        setState(s);
      });

      socket.on("hit", (evt) => console.log("hit evt", evt));
      socket.on("extra-life", (evt) => console.log("extra", evt));

      // ✅ use matchId instead of matchKey
      socket.emit("create-match", { matchId, difficulty: "EASY" }, (r) => {
        socket.emit(
          "join-match",
          { matchId, clientPlayerId: playerIdRef.current, name, role },
          (res) => {
            console.log("joined", res);
            // auto start for now (host)
            socket.emit("start-match", { matchId }, (s) => console.log("start cb", s));
          }
        );
      });
    });

    const onKey = (e) => {
      const socket = socketRef.current;
      if (!socket) return;

      if (e.key === " ") {
        socket.emit("player-action", {
          matchId,
          playerId: playerIdRef.current,
          action: { type: "throw" },
        });
      } else if (e.key === "c") {
        socket.emit("player-action", {
          matchId,
          playerId: playerIdRef.current,
          action: { type: "catch" },
        });
      } else if (
        [
          "w",
          "a",
          "s",
          "d",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "i",
          "j",
          "k",
          "l",
          "Numpad8",
          "Numpad4",
          "Numpad6",
          "Numpad2",
        ].includes(e.key)
      ) {
        // unify some numpad keynames
        const dir =
          e.key === "Numpad8"
            ? "ArrowUp"
            : e.key === "Numpad2"
            ? "ArrowDown"
            : e.key === "Numpad4"
            ? "ArrowLeft"
            : e.key === "Numpad6"
            ? "ArrowRight"
            : e.key;
        socket.emit("player-action", {
          matchId,
          playerId: playerIdRef.current,
          action: { type: "move", dir },
        });
      }
    };

    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      const socket = socketRef.current;
      if (socket) {
        socket.emit("leave-match", { matchId, playerId: playerIdRef.current });
        socket.disconnect();
      }
    };
  }, [matchId, name, role]);

  // draw canvas each state update
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !state) return;
    const ctx = canvas.getContext("2d");

    // clear
    ctx.clearRect(0, 0, 640, 640);

    // arena background
    ctx.fillStyle = "#f7f7f7";
    ctx.fillRect(0, 0, 640, 640);

    // draw box
    const box = state.box || { x: 250, y: 200, w: 100, h: 200 };
    ctx.save();
    ctx.fillStyle = "#fff3cd";
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeStyle = "#f1c40f";
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.restore();

    // draw balls
    ctx.fillStyle = "crimson";
    (state.balls || []).forEach((b) => {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 8, 0, Math.PI * 2);
      ctx.fill();
    });

    // draw players
    (state.players || []).forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);

      // color throwers vs dodgers
      if (p.role === "THROWER") ctx.fillStyle = "#2c3e50";
      else ctx.fillStyle = p.id === playerIdRef.current ? "#3498db" : "#27ae60";

      ctx.fill();

      ctx.fillStyle = "#000";
      ctx.font = "12px sans-serif";
      ctx.fillText(`${p.name} (${p.lives})`, p.x - 20, p.y - 20);
    });
  }, [state]);

  // game over detection
  useEffect(() => {
    if (!state) return;
    if (state.status === "FINISHED") {
      if (onGameOver) onGameOver(state);
    }
  }, [state, onGameOver]);

  if (!connected) return <div>Connecting to game server…</div>;
  if (!state) return <div>Waiting for match data…</div>;

  return (
    <div style={{ display: "flex", gap: 20 }}>
      <div>
        <canvas
          ref={canvasRef}
          width={640}
          height={640}
          style={{ border: "2px solid #333", background: "#e9f5ff" }}
        />
      </div>

      <div style={{ width: 300 }}>
        <h3>Match: {state.id}</h3>
        <p>Difficulty: {state.difficulty}</p>
        <h4>Players</h4>
        <div>
          {(state.players || []).map((p) => (
            <div key={p.id} style={{ marginBottom: 6 }}>
              <strong>{p.name}</strong> {p.isAI ? "(AI)" : ""} — {p.role} — Hits:{" "}
              {p.scoreHits} — Dodges: {p.scoreDodges} — Lives: {p.lives}
            </div>
          ))}
        </div>

        <div style={{ marginTop: 12 }}>
          <p>
            <strong>Controls</strong>
          </p>
          <ul>
            <li>WASD / Arrow keys — move</li>
            <li>Space — throw</li>
            <li>C — catch</li>
            <li>IJKL / Numpad also supported for other players</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
