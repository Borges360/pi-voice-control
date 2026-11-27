#!/usr/bin/env node
// Host smoke: loads index.ts with the extension loader of an installed Pi release (default
// ~/.pi/agent/install/releases/1.6.0, or PI_HOST_DIR), opens /voice through the registered
// command and renders the panel at 40/80/120 columns with the host's pi-tui keybindings.
//
// It never records, enumerates devices, downloads or writes settings: PI_CODING_AGENT_DIR and
// the working directory point to a temporary directory, and only navigation keys and Esc are sent.
// It does not start or restart a Pi session and does not touch ~/.pi/agent/settings.json.
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const hostDir = resolve(process.env.PI_HOST_DIR ?? join(homedir(), '.pi', 'agent', 'install', 'releases', '1.6.0'));
const modules = join(hostDir, 'node_modules', '@earendil-works');
const load = path => import(pathToFileURL(path).href);
const { loadExtensions } = await load(join(modules, 'pi-coding-agent', 'dist', 'core', 'extensions', 'loader.js'));
const tui = await load(join(modules, 'pi-tui', 'dist', 'index.js'));
const agentVersion = (await load(join(modules, 'pi-coding-agent', 'dist', 'config.js')).catch(() => ({}))).VERSION;

const extension = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'index.ts');
const scratch = await mkdtemp(join(tmpdir(), 'voice-host-smoke-'));
const saved = { cwd: process.cwd(), agentDir: process.env.PI_CODING_AGENT_DIR, write: process.stdout.write };
const tty = [process.stdin, process.stdout].map(s => Object.getOwnPropertyDescriptor(s, 'isTTY'));
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
try {
  process.env.PI_CODING_AGENT_DIR = join(scratch, 'agent');
  process.chdir(scratch);
  const loaded = await loadExtensions([extension], scratch);
  check(loaded.errors.length === 0, `loader errors: ${JSON.stringify(loaded.errors)}`);
  const ext = loaded.extensions[0];
  const command = ext?.commands.get('voice');
  check(!!command, '/voice is not registered');
  // index.ts refuses non-interactive hosts; pretend to be a TTY and drop the focus-reporting escape.
  for (const stream of [process.stdin, process.stdout]) Object.defineProperty(stream, 'isTTY', { configurable: true, value: true });
  process.stdout.write = function (data, ...args) { return String(data).includes('\x1b[?1004') ? true : saved.write.call(this, data, ...args); };
  let component, opened = 0; const notices = [];
  let resolveOpen; const open = new Promise(r => { resolveOpen = r; });
  const ui = {
    custom: (factory, options) => new Promise(done => {
      ++opened;
      component = factory({ terminal: { rows: 30 }, requestRender() {} }, { fg: (_c, s) => s, bold: s => s }, tui.getKeybindings(), done);
      resolveOpen(options);
    }),
    notify: (m, kind) => notices.push(`${kind ?? 'info'}: ${m}`), setWidget() {}, setStatus() {},
    onTerminalInput: () => () => {}, pasteToEditor() { throw new Error('smoke must not paste'); },
  };
  const ctx = { cwd: scratch, hasUI: true, ui, isProjectTrusted: () => true,
    sessionManager: { getSessionId: () => 'smoke', getLeafId: () => 'smoke' } };
  const running = command.handler('', ctx);
  const options = await Promise.race([open, running.then(() => undefined)]);
  check(opened === 1 && !!component, `panel did not open (${notices.join(' | ')})`);
  if (component) {
    const settle = async () => { await component.drain?.(); await new Promise(r => setImmediate(r)); };
    for (const width of [40, 80, 120]) {
      const lines = component.render(width);
      const widest = Math.max(...lines.map(l => tui.visibleWidth(l)));
      check(widest <= width, `width ${width}: line of ${widest} columns`);
      console.log(`--- ${width} columns, ${lines.length} rows, widest ${widest} ---`);
      for (const line of lines) console.log(`|${line}`);
    }
    const first = component.render(80).join('\n');
    check(first.includes('Voice / Settings') && first.includes('Ctrl+S save'), 'English panel text missing');
    check(options?.overlayOptions?.minWidth === 40, 'overlay options were not passed to ui.custom');
    for (const key of ['\x1b[B', '\x1b[B', '\x1b[A']) { component.handleInput(key); await settle(); }
    check(component.controller.session.focusedId === 'microphone', `focus after ↓↓↑: ${component.controller.session.focusedId}`);
    component.handleInput('\x1b'); await settle();
  }
  await running;
  const written = await readdir(scratch);
  // The only writes allowed are the design-system themes the extension installs (themes/) and their
  // ownership record (state/); voice settings are never written by opening and closing the panel.
  const agentEntries = written.includes('agent') ? await readdir(join(scratch, 'agent')) : [];
  check(agentEntries.every(e => e === 'themes' || e === 'state'), `settings were written: ${agentEntries.join(', ')}`);
  const themes = agentEntries.includes('themes') ? (await readdir(join(scratch, 'agent', 'themes'))).sort() : [];
  check(themes.join(',') === 'inteiro-contrast-dark.json,inteiro-contrast-light.json,inteiro-dark.json,inteiro-light.json', `themes not installed: ${themes.join(', ')}`);
  const discover = ext?.handlers.get('resources_discover') ?? [];
  check(discover.length === 1 && (await discover[0]({}, ctx)).themePaths.length === 4, 'themes not listed in resources_discover');
  for (const handler of ext?.handlers.get('session_shutdown') ?? []) await handler({}, ctx);
  console.log(`host: ${hostDir} (pi-coding-agent ${agentVersion ?? '?'})`);
  console.log(`notifications: ${notices.length ? notices.join(' | ') : 'none'}`);
} finally {
  process.stdout.write = saved.write;
  [process.stdin, process.stdout].forEach((s, i) => { if (tty[i]) Object.defineProperty(s, 'isTTY', tty[i]); else delete s.isTTY; });
  process.chdir(saved.cwd);
  if (saved.agentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = saved.agentDir;
  await rm(scratch, { recursive: true, force: true });
}
if (failures.length) { for (const f of failures) console.error(`smoke failed: ${f}`); process.exitCode = 1; }
else console.log('smoke ok: /voice panel opened by the host loader, rendered at 40/80/120, closed with Esc, no setting written, themes installed in the agent dir');
