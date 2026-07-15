/**
 * Build front-end dist assets before Playwright webServer + tests.
 * (index.html loads /js/dist/*.min.js)
 */
const { execSync } = require('child_process');
const path = require('path');

module.exports = async function globalSetup() {
  console.log('[e2e] building front-end assets (bundle + terser)...');
  execSync('npm run build', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: process.env,
  });
  console.log('[e2e] build done');
};
