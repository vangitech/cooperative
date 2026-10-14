import express from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../utils/helpers.js';

const router = express.Router();
router.use(authenticate);

async function ensureParticipant(conversationId, userId) {
  const { rows } = await query(
    'SELECT id FROM chat_participants WHERE conversation_id = $1 AND user_id = $2',
    [conversationId, userId]
  );
  return !!rows[0];
}

// Contact picker: staff (admin/officer/accountant) + fellow org members.
// Grantor = any staff-side account; group = shared organisation.
// The super-admin never appears here unless the viewer is a super-admin.
router.get(
  '/contacts',
  asyncHandler(async (req, res) => {
    const hideSuper = req.user.role !== 'super_admin';
    const staff = await query(
      `SELECT id, first_name, last_name, email, role FROM users
       WHERE role IN ('super_admin','admin','officer','accountant','grantor') AND status = 'active' AND id <> $1
       ${hideSuper ? `AND role <> 'super_admin'` : ''}
       ORDER BY role, first_name LIMIT 100`,
      [req.user.id]
    );
    const myOrgs = await query(
      `SELECT org_id FROM organisation_members WHERE user_id = $1 AND status = 'active'`,
      [req.user.id]
    );
    const orgIds = myOrgs.rows.map((r) => r.org_id).filter(Boolean);
    let groupMembers = [];
    if (orgIds.length) {
      const gm = await query(
        `SELECT DISTINCT u.id, u.first_name, u.last_name, u.email, u.role, o.name AS org_name
         FROM organisation_members m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN organisations o ON o.id = m.org_id
         WHERE m.org_id = ANY($1) AND m.status = 'active' AND u.id <> $2 AND u.status = 'active'
         ${hideSuper ? `AND u.role <> 'super_admin'` : ''}
         ORDER BY u.first_name LIMIT 100`,
        [orgIds, req.user.id]
      );
      groupMembers = gm.rows;
    }
    const myGroups = orgIds.length
      ? (await query(`SELECT id, name, code FROM organisations WHERE id = ANY($1)`, [orgIds])).rows
      : [];
    res.json({
      me: { id: req.user.id, email: req.user.email, role: req.user.role },
      staff: staff.rows.map((u) => ({ ...u, kind: u.role === 'grantor' ? 'grantor' : (u.role === 'admin' || u.role === 'super_admin' ? 'admin' : 'officer') })),
      groupMembers: groupMembers.map((u) => ({ ...u, kind: 'group' })),
      myGroups,
    });
  })
);

// My conversations with last message + unread count.
router.get(
  '/conversations',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT c.id, c.type, c.title, c.org_id, c.created_at,
              (SELECT body FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_body,
              (SELECT created_at FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_at,
              (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id) AS message_count,
              (SELECT string_agg(u.first_name || ' ' || u.last_name, ', ')
               FROM chat_participants p JOIN users u ON u.id = p.user_id
               WHERE p.conversation_id = c.id AND p.user_id <> $1) AS peers
       FROM chat_conversations c
       JOIN chat_participants p ON p.conversation_id = c.id AND p.user_id = $1
       ORDER BY last_at DESC NULLS LAST, c.created_at DESC LIMIT 100`,
      [req.user.id]
    );
    res.json(rows);
  })
);

// Start (or reuse) a direct conversation, or create a group room.
router.post(
  '/conversations',
  asyncHandler(async (req, res) => {
    const { type = 'direct', title, participantIds = [], orgId } = req.body || {};
    const ids = [...new Set((participantIds || []).map(Number).filter((n) => n && n !== req.user.id))];
    if (!ids.length) return res.status(400).json({ message: 'Pick at least one person to chat with' });
    if (ids.length > 50) return res.status(400).json({ message: 'Too many participants' });

    // Verify every participant exists + active.
    const { rows: found } = await query(
      `SELECT id FROM users WHERE id = ANY($1) AND status = 'active'`,
      [ids]
    );
    if (found.length !== ids.length) return res.status(400).json({ message: 'One or more members not found' });
    // Nobody may open a chat with the super-admin (invisible account) —
    // unless they are a super-admin themselves.
    if (req.user.role !== 'super_admin') {
      const { rows: supers } = await query(
        `SELECT id FROM users WHERE id = ANY($1) AND role = 'super_admin'`,
        [ids]
      );
      if (supers.length) return res.status(403).json({ message: 'Insufficient permissions' });
    }

    if (type === 'direct' && ids.length === 1) {
      // Reuse existing 1:1 room if present.
      const { rows: existing } = await query(
        `SELECT c.id FROM chat_conversations c
         JOIN chat_participants p1 ON p1.conversation_id = c.id AND p1.user_id = $1
         JOIN chat_participants p2 ON p2.conversation_id = c.id AND p2.user_id = $2
         WHERE c.type = 'direct'
           AND (SELECT COUNT(*) FROM chat_participants p WHERE p.conversation_id = c.id) = 2
         LIMIT 1`,
        [req.user.id, ids[0]]
      );
      if (existing[0]) return res.json({ id: existing[0].id, reused: true });
    }

    const { rows: conv } = await query(
      `INSERT INTO chat_conversations (type, title, org_id, created_by)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [type === 'group' ? 'group' : 'direct', title || null, orgId || null, req.user.id]
    );
    const all = [req.user.id, ...ids];
    for (const uid of all) {
      await query(
        `INSERT INTO chat_participants (conversation_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [conv[0].id, uid]
      );
    }
    res.status(201).json({ ...conv[0], reused: false });
  })
);

// Message history (oldest first).
router.get(
  '/conversations/:id/messages',
  asyncHandler(async (req, res) => {
    if (!(await ensureParticipant(req.params.id, req.user.id))) {
      return res.status(403).json({ message: 'Not a participant' });
    }
    const limit = Math.min(Number(req.query.limit) || 100, 300);
    const { rows } = await query(
      `SELECT m.id, m.body, m.created_at, m.sender_id,
              u.first_name, u.last_name, u.email, u.role
       FROM chat_messages m LEFT JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1 ORDER BY m.created_at LIMIT $2`,
      [req.params.id, limit]
    );
    res.json(rows);
  })
);

// Send a message (must be a participant).
router.post(
  '/conversations/:id/messages',
  asyncHandler(async (req, res) => {
    const { body } = req.body || {};
    if (!body || !String(body).trim()) return res.status(400).json({ message: 'Message is empty' });
    if (String(body).length > 2000) return res.status(400).json({ message: 'Message too long (max 2000 chars)' });
    if (!(await ensureParticipant(req.params.id, req.user.id))) {
      return res.status(403).json({ message: 'Not a participant' });
    }
    const { rows } = await query(
      `INSERT INTO chat_messages (conversation_id, sender_id, body)
       VALUES ($1,$2,$3) RETURNING id, conversation_id, sender_id, body, created_at`,
      [req.params.id, req.user.id, String(body).trim()]
    );
    // Nudge other participants via in-app notifications (fire-and-forget).
    try {
      const peers = await query(
        `SELECT user_id FROM chat_participants WHERE conversation_id = $1 AND user_id <> $2`,
        [req.params.id, req.user.id]
      );
      for (const p of peers.rows) {
        await query(
          `INSERT INTO notifications (user_id, title, body, link) VALUES ($1,$2,$3,$4)`,
          [p.user_id, `New message from ${req.user.first_name}`, String(body).trim().slice(0, 120), null]
        );
      }
    } catch (e) {
      console.error('chat notify failed:', e.message);
    }
    res.status(201).json(rows[0]);
  })
);

export default router;
