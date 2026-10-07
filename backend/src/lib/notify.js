import { query } from '../db.js';

// Fire-and-forget in-app notification. Never throws.
export function notify(userId, { title, body, link }) {
  if (!userId || !title) return;
  query('INSERT INTO notifications (user_id, title, body, link) VALUES ($1,$2,$3,$4)', [
    userId, title, body || null, link || null,
  ]).catch((e) => console.error('notify failed:', e.message));
}
