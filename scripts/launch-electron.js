const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load .env file
const envPath = path.join(__dirname, '..', 'apps', 'server', '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = { ...process.env, ELECTRON_RENDERER_URL: 'http://localhost:5173' };
if (process.platform === 'darwin' && !env.OS_ACTIVITY_MODE) {
  env.OS_ACTIVITY_MODE = 'disable';
}

for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx === -1) continue;
  env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
}

// Compile TypeScript
execSync('npx tsc -p electron/tsconfig.json', { stdio: 'inherit', cwd: path.join(__dirname, '..') });

const MENU_MODEL_WARNING =
  'representedObject is not a WeakPtrToElectronMenuModelAsNSObject';

function installGlobalWarningFilter(stream) {
  const originalWrite = stream.write.bind(stream);
  stream.write = (chunk, encoding, callback) => {
    const done = typeof encoding === 'function' ? encoding : callback;
    const normalizedEncoding = typeof encoding === 'string' ? encoding : undefined;
    const text = Buffer.isBuffer(chunk)
      ? chunk.toString(normalizedEncoding || 'utf8')
      : String(chunk ?? '');

    if (text.includes(MENU_MODEL_WARNING)) {
      if (typeof done === 'function') {
        done();
      }
      return true;
    }

    return originalWrite(chunk, encoding, callback);
  };
}

installGlobalWarningFilter(process.stdout);
installGlobalWarningFilter(process.stderr);

function forwardStream(stream, write) {
  if (!stream) return;
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.includes(MENU_MODEL_WARNING)) {
        continue;
      }
      write(`${line}\n`);
    }
  });
  stream.on('end', () => {
    if (buffer && !buffer.includes(MENU_MODEL_WARNING)) {
      write(`${buffer}\n`);
    }
  });
}

// Launch Electron
const electron = require('electron');
const child = spawn(electron, ['dist-electron/main.js'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  cwd: path.join(__dirname, '..'),
  env,
});

forwardStream(child.stdout, (line) => process.stdout.write(line));
forwardStream(child.stderr, (line) => process.stderr.write(line));

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));

child.on('close', (code) => process.exit(code));
