const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.env.PORT || 3000);
const configFilePath = path.join(__dirname, 'data', 'config.json');
const publicDir = path.join(__dirname, 'public');

const allowedConfigKeys = [
  'ADMIN_PASSWORD',
  'KAPSO_API_KEY',
  'KAPSO_PHONE_NUMBER_ID',
  'WHITELISTED_NUMBERS',
  'QSTASH_TOKEN',
  'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'MICROSOFT_CLIENT_ID',
  'MICROSOFT_CLIENT_SECRET',
  'MICROSOFT_TENANT_ID',
  'TOKEN_ENCRYPTION_KEY',
  'BASE_URL'
];

function ensureConfigStorage() {
  const dataDir = path.dirname(configFilePath);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(configFilePath)) {
    fs.writeFileSync(configFilePath, JSON.stringify({}, null, 2), 'utf8');
  }
}

function readStoredConfig() {
  ensureConfigStorage();
  try {
    const raw = fs.readFileSync(configFilePath, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (error) {
    return {};
  }
}

function saveStoredConfig(config) {
  ensureConfigStorage();
  fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2), 'utf8');
}

function toPublicConfig(config) {
  const output = {};

  for (const key of allowedConfigKeys) {
    const value = config[key] ?? process.env[key] ?? '';
    const isSecret = /PASSWORD|SECRET|TOKEN|KEY/.test(key);

    output[key] = {
      value: isSecret && value ? '••••••••••' : value,
      hasValue: Boolean(value),
      source: key in config ? 'stored' : process.env[key] ? 'env' : 'empty'
    };
  }

  return output;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath, contentType) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const content = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(content);
}

function collectJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host}`);

  if (req.method === 'GET' && requestUrl.pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'secretariat-config-mock',
      timestamp: new Date().toISOString()
    });
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/config') {
    const config = readStoredConfig();
    return sendJson(res, 200, { ok: true, config: toPublicConfig(config) });
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/config') {
    try {
      const body = await collectJsonBody(req);
      const incomingConfig = body && typeof body.config === 'object' ? body.config : {};
      const stored = readStoredConfig();

      for (const key of allowedConfigKeys) {
        if (typeof incomingConfig[key] === 'string') {
          const nextValue = incomingConfig[key].trim();
          if (nextValue.length > 0) {
            stored[key] = nextValue;
          }
        }
      }

      saveStoredConfig(stored);
      return sendJson(res, 200, { ok: true, message: 'Configuration saved (mock)' });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message || 'Bad request' });
    }
  }

  if (req.method === 'GET' && requestUrl.pathname === '/') {
    return sendFile(res, path.join(publicDir, 'index.html'), 'text/html; charset=utf-8');
  }

  if (req.method === 'GET' && requestUrl.pathname === '/app.js') {
    return sendFile(res, path.join(publicDir, 'app.js'), 'application/javascript; charset=utf-8');
  }

  if (req.method === 'GET' && requestUrl.pathname === '/styles.css') {
    return sendFile(res, path.join(publicDir, 'styles.css'), 'text/css; charset=utf-8');
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: 'Route not found' }));
});

server.listen(port, () => {
  console.log(`Mock config service listening on port ${port}`);
});
