'use strict';

const express = require('express');
const path = require('path');
const detectRouter = require('./routes/detect');
const reverseRouter = require('./routes/reverse');
const reportRouter = require('./routes/report');
const casesRouter = require('./routes/cases');
const searchRouter = require('./routes/search');

const app = express();
const PORT = 8000;  // ✅ Fixed: frontend connects to port 8000

// Parse JSON bodies — increased limit for base64 heatmap images in /report
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS — allow frontend (aranged.html) to communicate from any host
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Serve the frontend static files from the project root
app.use(express.static(path.join(__dirname, '..')));

// Serve saved case files (PDFs + JSONs) from backend/projects/
app.use('/projects', express.static(path.join(__dirname, 'projects')));

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/detect', detectRouter);
app.use('/analyze', detectRouter);
app.use('/reverse', reverseRouter);
app.use('/report', reportRouter);           // POST /report → PDF generation
app.use('/v1/case', casesRouter);           // POST /v1/case, GET /v1/case/list
app.use('/search-similar', searchRouter);   // POST /search-similar → reverse image search

// Root route — open localhost:8000 directly in browser
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'aranged.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', port: PORT, timestamp: new Date().toISOString() });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[TECHNO SCOPE] Server running at http://localhost:${PORT}`);
  console.log(`[TECHNO SCOPE] POST /analyze          — primary detection endpoint`);
  console.log(`[TECHNO SCOPE] POST /detect           — alias endpoint`);
  console.log(`[TECHNO SCOPE] POST /reverse          — image reverse engineering`);
  console.log(`[TECHNO SCOPE] POST /report           — PDF forensic report`);
  console.log(`[TECHNO SCOPE] POST /v1/case          — save comparison case`);
  console.log(`[TECHNO SCOPE] GET  /v1/case/list     — list saved cases`);
  console.log(`[TECHNO SCOPE] POST /search-similar   — reverse image search`);
});

module.exports = app;
