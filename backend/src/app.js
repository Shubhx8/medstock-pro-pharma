const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Middlewares
app.use(cors({
  origin: '*', // Allow local frontend files and dev servers
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(morgan('dev'));

// Serve static frontend UI (accessible at http://localhost:5000/)
app.use(express.static(path.join(__dirname, '../../frontend')));

// Public health check endpoints
app.get('/health', (req, res) => {

  res.json({ status: 'ok' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Main API routes
app.use('/api', routes);

// Central error handler
app.use(errorHandler);

module.exports = app;
