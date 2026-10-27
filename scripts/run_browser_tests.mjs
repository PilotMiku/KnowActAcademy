import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';

const processes = [];
const python = process.env.PYTHON || 'python3';
const serviceDiagnostics = [];
async function start(command, args) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  processes.push(child);
  let diagnostic = '';
  child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-10000); });
  serviceDiagnostics.push(() => diagnostic);
  const lines = createInterface({ input: child.stdout });
  const first = await Promise.race([
    once(lines, 'line').then(([line]) => line),
    once(child, 'exit').then(([code]) => { throw new Error(`Test service exited: ${code}\n${diagnostic}`); }),
    once(child, 'error').then(([error]) => { throw error; }),
  ]);
  lines.close();
  return first;
}
async function run(file, env) {
  const child = spawn(process.execPath, [file], { stdio: 'inherit', env: { ...process.env, ...env } });
  processes.push(child);
  const [code] = await once(child, 'exit');
  if (code !== 0) {
    for (const diagnostic of serviceDiagnostics) process.stderr.write(diagnostic());
    throw new Error(`${file} failed (${code})`);
  }
}
try {
  const rootLine = await start(python, ['server.py', '--port', '0']);
  const rootURL = rootLine.match(/http:\/\/\S+/)[0].replace(/\/$/, '');
  await run('tests/pages-smoke.mjs', { LOCAL_NEUMATHE_URL: rootURL });
  const prefixLine = await start(python, ['server.py', '--port', '0', '--prefix', 'test-repo']);
  const baseURL = prefixLine.match(/http:\/\/\S+/)[0].replace(/\/$/, '');
  const backend = JSON.parse(await start(python, ['tests/live_api.py', new URL(baseURL).origin]));
  const env = { LOCAL_NEUMATHE_URL: baseURL, ZHIXING_TEST_API: backend.url, ZHIXING_TEST_KEY: backend.key };
  for (const file of ['local-bank-browser', 'browser', 'exam-chapters-browser', 'preparation-browser', 'preparation-mastery-browser', 'study-browser', 'learning-progress-browser', 'interaction-browser', 'knowledge-browser', 'sync-browser', 'study-improvements-browser'])
    await run(`tests/${file}.mjs`, env);
  console.log('Browser regression passed at root and /test-repo/, including real backend sync.');
} finally {
  for (const child of processes) if (child.exitCode === null) child.kill('SIGTERM');
}
