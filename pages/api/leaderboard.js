// pages/api/leaderboard.js
import { query } from "@/lib/db";

export default async function handler(req, res) {
  const { role = "THROWER", difficulty = "EASY", limit = 10 } = req.query;
  const col = role === "THROWER" ? `total_hits_${difficulty.toLowerCase()}` : `total_dodges_${difficulty.toLowerCase()}`;
  try {
    const rows = await query(`SELECT id, username, ${col} as score FROM players ORDER BY ${col} DESC LIMIT ?`, [Number(limit)]);
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
