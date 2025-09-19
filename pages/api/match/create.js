// pages/api/match/create.js
import { query } from "@/lib/db";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { difficulty = "EASY", matchKey } = req.body;
  try {
    const r = await query("INSERT INTO matches (match_key, difficulty) VALUES (?, ?)", [matchKey, difficulty]);
    res.json({ ok: true, matchId: r.insertId });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
