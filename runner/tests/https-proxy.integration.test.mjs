import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { prepareBasePolicy } from '../policy.mjs';
import { startGuardProxy } from '../guard-proxy.mjs';

test('Chromium reaches a local HTTPS fixture through authenticated CONNECT', async t => {
  // Optional test dependency: generate a disposable self-signed certificate in memory.
  const generator = [
    'from cryptography import x509',
    'from cryptography.x509.oid import NameOID',
    'from cryptography.hazmat.primitives import hashes, serialization',
    'from cryptography.hazmat.primitives.asymmetric import rsa',
    'import datetime, ipaddress, json',
    'key=rsa.generate_private_key(public_exponent=65537,key_size=2048)',
    'name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,"localhost")])',
    'now=datetime.datetime.now(datetime.timezone.utc)',
    'cert=(x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(minutes=1)).not_valid_after(now+datetime.timedelta(days=1)).add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]),critical=False).sign(key,hashes.SHA256()))',
    'print(json.dumps({"key":key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()).decode(),"cert":cert.public_bytes(serialization.Encoding.PEM).decode()}))'
  ].join('\n');
  let generated = spawnSync('python', ['-c', generator], { encoding: 'utf8', timeout: 15000 });
  if (generated.error?.code === 'ENOENT') generated = spawnSync('python3', ['-c', generator], { encoding: 'utf8', timeout: 15000 });
  if (generated.error?.code === 'ENOENT' || (generated.status !== 0 && /No module named ['"]cryptography/.test(generated.stderr || ''))) {
    t.skip('Python with cryptography is unavailable; HTTPS browser integration is unverified'); return;
  }
  assert.equal(generated.status, 0, 'Could not generate the disposable TLS fixture');
  const cert = JSON.parse(generated.stdout);
  let hits = 0;
  const server = https.createServer(cert, (_req, res) => { hits++; res.end('<title>Fixture</title><main id="ok">TLS OK</main>'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `https://127.0.0.1:${server.address().port}/`;
  let proxy, browser;
  try {
    proxy = await startGuardProxy({ baseUrl: base, basePolicy: await prepareBasePolicy(base) });
    browser = await chromium.launch({ headless: true, args: ['--disable-quic'] });
    const context = await browser.newContext({ ignoreHTTPSErrors: true, proxy: { server: proxy.server, username: proxy.username, password: proxy.password, bypass: '<-loopback>' } });
    const page = await context.newPage();
    await page.goto(base);
    assert.equal(await page.locator('#ok').textContent(), 'TLS OK');
    assert.equal(hits, 1);
    await context.close();
  } finally {
    if (browser) await browser.close();
    if (proxy) await proxy.close();
    await new Promise(resolve => server.close(resolve));
  }
});
