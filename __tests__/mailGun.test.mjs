import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const mailGunPath = new URL('../utils/mailGun.js', import.meta.url);

test('assertEmailConfig fails when required env vars are missing', async () => {
  const saved = {};
  for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'NODE_MAILER_USER', 'CLIENT_URL']) {
    saved[key] = process.env[key];
    delete process.env[key];
  }

  try {
    const { assertEmailConfig, EmailDeliveryError } = await import(
      `${mailGunPath.href}?t=${Date.now()}`
    );
    assert.throws(
      () => assertEmailConfig(),
      (err) => err instanceof EmailDeliveryError
    );
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('verification email template resolves from package directory, not process.cwd', () => {
  const utilsDir = path.dirname(fileURLToPath(mailGunPath));
  const templatePath = path.join(utilsDir, 'template', 'adminAprrovedNewUser.handlebars');
  assert.ok(fs.existsSync(templatePath), `expected template at ${templatePath}`);
});
