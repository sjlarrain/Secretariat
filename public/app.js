const form = document.getElementById('config-form');
const statusText = document.getElementById('status-text');
const statusDot = document.getElementById('status-dot');
const saveBtn = document.getElementById('save-btn');
const reloadBtn = document.getElementById('reload-btn');

let configState = {};

function setStatus(text, ok = true) {
  statusText.textContent = text;
  statusDot.className = `dot ${ok ? 'ok' : 'error'}`;
}

function renderForm(config) {
  configState = config;
  form.innerHTML = '';

  Object.entries(config).forEach(([key, meta]) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'field';

    const title = document.createElement('span');
    title.className = 'field-title';
    title.textContent = key;

    const source = document.createElement('small');
    source.className = 'field-source';
    source.textContent = `source: ${meta.source}${meta.hasValue ? ' • value set' : ' • empty'}`;

    const input = document.createElement('input');
    input.name = key;
    input.placeholder = meta.hasValue ? 'Configured (hidden)' : 'Set value';
    input.type = /PASSWORD|SECRET|TOKEN|KEY/.test(key) ? 'password' : 'text';

    wrapper.appendChild(title);
    wrapper.appendChild(source);
    wrapper.appendChild(input);
    form.appendChild(wrapper);
  });
}

async function loadConfig() {
  try {
    const health = await fetch('/health').then((r) => r.json());
    setStatus(
      health.ok ? `Service online • ${new Date(health.timestamp).toLocaleString()}` : 'Service unavailable',
      !!health.ok
    );

    const data = await fetch('/api/config').then((r) => r.json());
    if (!data.ok) {
      throw new Error('Could not load config');
    }
    renderForm(data.config);
  } catch (error) {
    setStatus(error.message || 'Error loading service', false);
  }
}

async function saveConfig() {
  const payload = { config: {} };
  const inputs = form.querySelectorAll('input');

  inputs.forEach((input) => {
    if (input.value.trim()) {
      payload.config[input.name] = input.value.trim();
    }
  });

  try {
    const result = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then((r) => r.json());

    if (!result.ok) {
      throw new Error(result.error || 'Failed to save config');
    }

    setStatus('Configuration saved (mock storage).');
    await loadConfig();
  } catch (error) {
    setStatus(error.message || 'Save failed', false);
  }
}

saveBtn.addEventListener('click', saveConfig);
reloadBtn.addEventListener('click', loadConfig);

loadConfig();
