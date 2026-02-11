const express = require('express');

function createApiServer(port, onNotification, apiToken) {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  // Auth middleware — require bearer token on all POST routes
  function requireToken(req, res, next) {
    if (!apiToken) return next(); // no token configured = open (dev mode)
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.query.token;
    if (token !== apiToken) {
      return res.status(401).json({ error: 'Unauthorized — invalid or missing token' });
    }
    next();
  }

  // Health check (no auth needed)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', app: 'atlas-notifications', uptime: process.uptime() });
  });

  // Receive notification from Atlas
  app.post('/notify', requireToken, (req, res) => {
    const payload = req.body;

    if (!payload || !payload.title) {
      return res.status(400).json({ error: 'Missing required field: title' });
    }

    const validTypes = ['toast', 'briefing', 'alert', 'production-card'];
    if (payload.type && !validTypes.includes(payload.type)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
    }

    const validPriorities = ['low', 'normal', 'high'];
    if (payload.priority && !validPriorities.includes(payload.priority)) {
      return res.status(400).json({ error: `Invalid priority. Must be one of: ${validPriorities.join(', ')}` });
    }

    try {
      const notif = onNotification(payload);
      res.json({ success: true, id: notif.id });
    } catch (err) {
      res.status(500).json({ error: 'Failed to process notification' });
    }
  });

  // Get notification history
  app.get('/notifications', (_req, res) => {
    // This is a convenience endpoint for Atlas to check delivery
    res.json({ status: 'ok', message: 'Use the panel to view notifications' });
  });

  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Atlas Notifications API listening on port ${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Try a different port in settings.`);
    }
  });

  return server;
}

module.exports = { createApiServer };
