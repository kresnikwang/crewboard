const express = require('express');
const path = require('path');
const cors = require('cors');
const { initDB, seedDemoData } = require('./db/schema');
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const { authMiddleware } = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Initialize database
const db = initDB();

// Only seed demo data when explicitly requested (SEED_DEMO=1 node server.js)
if (process.env.SEED_DEMO === '1') {
  seedDemoData(db);
  console.log('Demo data seeded.');
}

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Trust reverse proxy (Nginx)
app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Static files with caching in production
if (NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '7d',
    etag: true,
    setHeaders: (res, filePath) => {
      // Don't cache HTML files — they change on deploy
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  }));
} else {
  app.use(express.static(path.join(__dirname, 'public')));
}

// Auth middleware - attaches req.user if valid token
app.use('/api', authMiddleware(db));

// Routes
app.use('/api/auth', authRoutes(db));
app.use('/api', apiRoutes(db));

// Fallback to index.html (no-cache for SPA routing)
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`CrewBoard [${NODE_ENV}] running at http://127.0.0.1:${PORT}`);
});
