// pages/index.js
import { useState, useEffect } from "react";
import GameClient from "@/components/GameClient";

export default function Home() {
  const [view, setView] = useState("home"); // home or game
  const [matchKey, setMatchKey] = useState(null);
  const [name, setName] = useState("Player");
  const [role, setRole] = useState("DODGER");
  const [numPlayers, setNumPlayers] = useState(1);
  const [difficulty, setDifficulty] = useState("EASY");

  const [showMechanics, setShowMechanics] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  function start() {
    // matchKey unique for session
    const mk = `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;
    setMatchKey(mk);
    // if dodger with numPlayers less than 4, we will let server fill AI
    // also pass desired total players in match settings via create-match in server (currently not using)
    setView("game");
  }

  if (view === "game" && matchKey) {
    return (
      <div style={{padding:20}}>
        <button onClick={() => { setView("home"); window.location.reload(); }}>Main menu</button>
        <GameClient matchKey={matchKey} name={name} role={role} onGameOver={() => alert("Game over! Click Main menu to play again.")} />
      </div>
    );
  }

  return (
    <div style={{padding:30}}>
      <h1>Batuhang Bola</h1>
      <p>Traditional Filipino playground game — dodge or throw!</p>

      <div style={{marginTop:20}}>
        <label>Username: <input value={name} onChange={(e)=>setName(e.target.value)} /></label>
      </div>

      <div style={{marginTop:10}}>
        <label>Choose Role:
          <select value={role} onChange={(e)=>setRole(e.target.value)}>
            <option value="DODGER">Dodger</option>
            <option value="THROWER">Thrower</option>
          </select>
        </label>
      </div>

      <div style={{marginTop:10}}>
        <label>Dodger players (if you chose Dodger): 
          <select value={numPlayers} onChange={(e)=>setNumPlayers(Number(e.target.value))}>
            <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option>
          </select>
        </label>
      </div>

      <div style={{marginTop:10}}>
        <label>Difficulty:
          <select value={difficulty} onChange={(e)=>setDifficulty(e.target.value)}>
            <option>EASY</option><option>MEDIUM</option><option>HARD</option>
          </select>
        </label>
      </div>

      <div style={{marginTop:20}}>
        <button onClick={start} style={{padding:'8px 16px'}}>Start Game</button>
        <button onClick={()=>setShowMechanics(true)} style={{marginLeft:10}}>Mechanics</button>
        <button onClick={()=>setShowLeaderboard(true)} style={{marginLeft:10}}>Leaderboard</button>
      </div>

      {showMechanics && (
        <div style={{position:'fixed',left:20,top:20,background:'#fff',padding:20,border:'1px solid #ccc'}}>
          <h3>Mechanics</h3>
          <ol>
            <li>Two Throwers per match. They throw balls at dodgers.</li>
            <li>Dodgers run through the yellow box to try to dodge/catch throws.</li>
            <li>Catch in the box sometimes gives +1 life.</li>
            <li>Throwers score hits when they hit a dodger. Dodgers score dodges when they avoid.</li>
            <li>Game ends when all dodgers have 0 lives.</li>
          </ol>
          <button onClick={()=>setShowMechanics(false)}>Back</button>
        </div>
      )}

      {showLeaderboard && (
        <div style={{position:'fixed',right:20,top:20,background:'#fff',padding:20,border:'1px solid #ccc', maxWidth:400}}>
          <h3>Leaderboard (Top Throwers Easy)</h3>
          <Leaderboard role="THROWER" difficulty="EASY" />
          <button onClick={()=>setShowLeaderboard(false)}>Back</button>
        </div>
      )}
    </div>
  );
}

function Leaderboard({ role, difficulty }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    fetch(`/api/leaderboard?role=${role}&difficulty=${difficulty}&limit=10`).then(r=>r.json()).then(j=>{
      if (j.ok) setRows(j.rows || []);
    });
  }, [role, difficulty]);
  return (
    <div>
      {rows.length === 0 ? <p>No data</p> : rows.map(r => <div key={r.id}>{r.username} — {r.score}</div>)}
    </div>
  );
}
