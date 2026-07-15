/**
 * API router aggregator — mounts domain route modules
 */
const express = require('express');
const { createApiContext } = require('./shared');

const modules = [
  require('./permissions'),
  require('./resources'),
  require('./clients'),
  require('./projects'),
  require('./schedule-data'),
  require('./bookings'),
  require('./timesheets'),
  require('./leave'),
  require('./reports'),
  require('./wecom'),
  require('./export'),
  require('./sse'),
  require('./audit'),
];

module.exports = function(db) {
  const router = express.Router();
  const ctx = createApiContext(db);
  for (const register of modules) {
    register(router, ctx);
  }
  return router;
};
