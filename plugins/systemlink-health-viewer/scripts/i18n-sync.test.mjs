import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

const pluginDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localeDirectory = path.join(pluginDirectory, 'src', 'locale');
const localeFiles = ['de', 'fr', 'ja', 'zh'].map(
  language => path.join(localeDirectory, `messages.${language}.json`)
);
const placeholderTokens = value => [...value.matchAll(/\{\$[A-Z0-9_]+\}/g)].map(match => match[0]).sort();
let server;
let serverUrl;

before(async () => {
  server = createServer((_request, response) => {
    response.writeHead(503).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  serverUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
});

test('i18n sync refuses to overwrite locale files when SystemLink translations are unavailable', async () => {
  const originalFiles = await Promise.all(localeFiles.map(file => readFile(file)));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['scripts/i18n-sync.mjs', '--server', serverUrl],
      { cwd: pluginDirectory }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', chunk => (stderr += chunk));
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
  const currentFiles = await Promise.all(localeFiles.map(file => readFile(file)));

  assert.equal(result.code, 1);
  assert.match(result.stderr, /refusing to overwrite its locale file/);
  assert.deepEqual(currentFiles, originalFiles);
});

test('locale catalogs retain source keys and interpolation placeholders', async () => {
  const source = JSON.parse(await readFile(path.join(localeDirectory, 'messages.json'), 'utf8')).translations;
  const sourceIds = Object.keys(source).sort();

  for (const language of ['de', 'fr', 'ja', 'zh']) {
    const catalog = JSON.parse(
      await readFile(path.join(localeDirectory, `messages.${language}.json`), 'utf8')
    );
    assert.equal(catalog.locale, language);
    assert.deepEqual(Object.keys(catalog.translations).sort(), sourceIds, `${language} source keys`);
    for (const [id, english] of Object.entries(source)) {
      assert.deepEqual(
        placeholderTokens(catalog.translations[id]),
        placeholderTokens(english),
        `${language}/${id} placeholders`
      );
    }

    const manual = JSON.parse(
      await readFile(path.join(localeDirectory, 'manual', `${language}.json`), 'utf8')
    );
    for (const [english, translated] of Object.entries(manual)) {
      assert.ok(Object.values(source).includes(english), `${language} manual key: ${english}`);
      assert.deepEqual(
        placeholderTokens(translated),
        placeholderTokens(english),
        `${language} manual placeholders: ${english}`
      );
    }
  }
});
