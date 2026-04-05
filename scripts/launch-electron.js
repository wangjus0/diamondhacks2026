const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load .env file
const envPath = path.join(__dirname, '..', 'apps', 'server', '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = { ...process.env, ELECTRON_RENDERER_URL: 'http://localhost:5173' };

for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx === -1) continue;
  env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
}

// Compile TypeScript
execSync('npx tsc -p electron/tsconfig.json', { stdio: 'inherit', cwd: path.join(__dirname, '..') });

// Launch Electron
const electron = require('electron');
const child = spawn(electron, ['dist-electron/main.js'], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
  env,
});

child.on('close', (code) => process.exit(code));
