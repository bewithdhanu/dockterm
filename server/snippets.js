import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const FILE_NAME = 'shippets';

export function getSnippetsPath() {
  return path.join(os.homedir(), '.ssh', FILE_NAME);
}

function ensureSshDir() {
  const dir = path.join(os.homedir(), '.ssh');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { mode: 0o700, recursive: true });
  }
  return dir;
}

function normalizeSnippet(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim();
  const command = String(raw.command || '').replace(/\r\n/g, '\n');
  if (!name || !command.trim()) return null;
  return {
    id: String(raw.id || randomUUID()),
    name,
    command: command.replace(/\s+$/, ''),
  };
}

export function listSnippets() {
  const filePath = getSnippetsPath();
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid ~/.ssh/shippets (expected JSON array)');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Invalid ~/.ssh/shippets (expected JSON array)');
  }
  return parsed.map(normalizeSnippet).filter(Boolean);
}

export function writeSnippets(snippets) {
  ensureSshDir();
  const filePath = getSnippetsPath();
  const list = (Array.isArray(snippets) ? snippets : [])
    .map(normalizeSnippet)
    .filter(Boolean);
  fs.writeFileSync(filePath, `${JSON.stringify(list, null, 2)}\n`, {
    mode: 0o600,
  });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* ignore */
  }
  return list;
}

export function createSnippet({ name, command } = {}) {
  const next = normalizeSnippet({ name, command, id: randomUUID() });
  if (!next) throw new Error('name and command are required');
  const list = listSnippets();
  if (list.some((s) => s.name.toLowerCase() === next.name.toLowerCase())) {
    throw new Error(`Snippet "${next.name}" already exists`);
  }
  list.push(next);
  return { snippet: next, snippets: writeSnippets(list) };
}

export function updateSnippet(id, { name, command } = {}) {
  const list = listSnippets();
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) throw new Error('Snippet not found');
  const next = normalizeSnippet({
    id,
    name: name ?? list[idx].name,
    command: command ?? list[idx].command,
  });
  if (!next) throw new Error('name and command are required');
  if (
    list.some(
      (s, i) => i !== idx && s.name.toLowerCase() === next.name.toLowerCase()
    )
  ) {
    throw new Error(`Snippet "${next.name}" already exists`);
  }
  list[idx] = next;
  return { snippet: next, snippets: writeSnippets(list) };
}

export function deleteSnippet(id) {
  const list = listSnippets();
  const next = list.filter((s) => s.id !== id);
  if (next.length === list.length) throw new Error('Snippet not found');
  return { snippets: writeSnippets(next) };
}
