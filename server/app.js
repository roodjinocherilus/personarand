require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const path = require('path');
const fs = require('fs');
const { authMiddleware } = require('./middleware/auth');

const app = express();
// Capture rawBody so webhook signature verification runs on the exact bytes
// the sender signed (Svix requires the raw payload, not the re-serialized one).
app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// Auth middleware — applied first. Public path allowlist inside.
app.use(authMiddleware);

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    anthropic_key: Boolean(process.env.ANTHROPIC_API_KEY),
    database_url: Boolean(process.env.DATABASE_URL),
    supabase_url: Boolean(process.env.SUPABASE_URL),
    time: new Date().toISOString(),
  });
});

app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/calendar-ai', require('./routes/calendarAi'));
app.use('/api/generate', require('./routes/generate'));
app.use('/api/content', require('./routes/library'));
app.use('/api/metrics', require('./routes/metrics'));
app.use('/api/uploads', require('./routes/uploads'));
app.use('/api/carousels', require('./routes/carousels'));
app.use('/api/outcomes', require('./routes/outcomes'));
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/prompts', require('./routes/prompts'));
app.use('/api/subscribers', require('./routes/subscribers'));
app.use('/api/newsletter', require('./routes/newsletter'));
app.use('/api/newsletter-ai', require('./routes/newsletterAi'));
app.use('/api/webhooks', require('./routes/webhooks'));
app.use('/api/newsletter/welcome', require('./routes/welcome'));
app.use('/api/signup', require('./routes/signup'));
app.use('/api/prospects', require('./routes/prospects'));
app.use('/api/email-templates', require('./routes/templates'));
app.use('/api/outreach', require('./routes/outreach'));
app.use('/api/meetings', require('./routes/meetings'));
app.use('/api/pipeline', require('./routes/pipeline'));
app.use('/api/attribution', require('./routes/attribution'));
app.use('/api/insights', require('./routes/insights'));
app.use('/api/unified', require('./routes/unified'));
app.use('/api/cron', require('./routes/cron'));
app.use('/api/briefings', require('./routes/briefings'));
app.use('/api/knowledge', require('./routes/knowledge'));
app.use('/api/voice-profile', require('./routes/voiceProfile'));
app.use('/api/quick-capture', require('./routes/quickCapture'));
app.use('/api/crisis', require('./routes/crisis'));

// Short URL for hosted signup pages
app.get('/s/:id', (req, res) => res.redirect(302, `/api/signup/page/${req.params.id}`));

// Production: serve the built React client
if (process.env.NODE_ENV === 'production') {
  const distDir = path.join(__dirname, '..', 'client', 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    // SPA fallback — catch-all for non-API routes
    app.get(/^(?!\/api).*/, (req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }
}

app.use((err, req, res, next) => {
  console.error('[error]', err);
  // Respect err.status when a route (or downstream helper like anthropic.js)
  // has set one — otherwise 500. This is how 429 / 504 / 400 from the
  // Anthropic wrapper reach the UI with the right semantics.
  const status = typeof err.status === 'number' && err.status >= 400 && err.status < 600
    ? err.status
    : 500;
  res.status(status).json({ error: err.message || 'internal error' });
});

module.exports = app;
