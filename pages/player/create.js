// pages/api/player/create.js
import { query } from "@/lib/db";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { username } = req.body;
  if (!username) return res.status(400).json({ ok: false, error: "username required" });
  try {
    const r = await query("INSERT INTO players (username) VALUES (?)", [username]);
    res.json({ ok: true, id: r.insertId });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
