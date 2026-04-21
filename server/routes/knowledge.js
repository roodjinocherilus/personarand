const express = require('express');
const { openDb } = require('../db');
const { invalidateKbCache } = require('../lib/anthropic');

const router = express.Router();

const CATEGORIES = ['note', 'project', 'client', 'framework', 'positioning', 'voice', 'haiti', 'other'];

// Rough token estimate: ~4 chars per token for English prose
function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

router.get('/', async (req, res, next) => {
  try {
    const db = openDb();
    const rows = await db.prepare(`SELECT * FROM knowledge_base ORDER BY is_active DESC, updated_at DESC`).all();
    const totalActiveTokens = rows.filter((r) => r.is_active).reduce((s, r) => s + (r.token_estimate || 0), 0);
    res.json({ entries: rows, total_active_tokens: totalActiveTokens, categories: CATEGORIES });
  } catch (e) { next(e); }
});

router.get('/export', async (req, res, next) => {
  try {
    const db = openDb();
    const rows = await db.prepare(`SELECT * FROM knowledge_base ORDER BY category ASC, updated_at DESC`).all();
    const date = new Date().toISOString().slice(0, 10);
    const lines = [
      `# Knowledge Base Export`,
      `> Exported ${date} · ${rows.length} entries`,
      ``,
    ];
    for (const r of rows) {
      const updated = r.updated_at ? new Date(r.updated_at).toISOString().slice(0, 10) : '—';
      lines.push('---');
      lines.push('');
      lines.push(`## ${r.title}`);
      lines.push('');
      lines.push(`- **Category:** ${r.category}`);
      lines.push(`- **Active:** ${r.is_active ? 'yes' : 'no'}`);
      lines.push(`- **Tokens:** ~${r.token_estimate || 0}`);
      lines.push(`- **Last updated:** ${updated}`);
      lines.push('');
      lines.push(r.content_md || '');
      lines.push('');
    }
    const markdown = lines.join('\n');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="knowledge-export-${date}.md"`);
    res.send(markdown);
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const db = openDb();
    const row = await db.prepare(`SELECT * FROM knowledge_base WHERE id = ?`).get([req.params.id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const db = openDb();
    const { title, category, content_md, is_active = true } = req.body || {};
    if (!title || !content_md) return res.status(400).json({ error: 'title + content_md required' });
    const tokens = estimateTokens(content_md);
    const info = await db.prepare(`
      INSERT INTO knowledge_base (title, category, content_md, is_active, token_estimate)
      VALUES (?, ?, ?, ?, ?)
    `).run([title, category || 'note', content_md, is_active ? true : false, tokens]);
    const row = await db.prepare(`SELECT * FROM knowledge_base WHERE id = ?`).get([info.lastInsertRowid]);
    invalidateKbCache();
    res.status(201).json(row);
  } catch (e) { next(e); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const db = openDb();
    const { title, category, content_md, is_active } = req.body || {};
    const existing = await db.prepare(`SELECT * FROM knowledge_base WHERE id = ?`).get([req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const nextContent = content_md ?? existing.content_md;
    const tokens = estimateTokens(nextContent);
    await db.prepare(`
      UPDATE knowledge_base SET title = ?, category = ?, content_md = ?, is_active = ?, token_estimate = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run([
      title ?? existing.title,
      category ?? existing.category,
      nextContent,
      is_active !== undefined ? (is_active ? true : false) : existing.is_active,
      tokens,
      req.params.id,
    ]);
    const row = await db.prepare(`SELECT * FROM knowledge_base WHERE id = ?`).get([req.params.id]);
    invalidateKbCache();
    res.json(row);
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const db = openDb();
    const r = await db.prepare(`DELETE FROM knowledge_base WHERE id = ?`).run([req.params.id]);
    if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
    invalidateKbCache();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Bulk toggle active/inactive
router.post('/toggle', async (req, res, next) => {
  try {
    const db = openDb();
    const { ids, is_active } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids[] required' });
    for (const id of ids) {
      await db.prepare(`UPDATE knowledge_base SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run([!!is_active, id]);
    }
    invalidateKbCache();
    res.json({ ok: true, updated: ids.length });
  } catch (e) { next(e); }
});

module.exports = router;
