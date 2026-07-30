import WebSocket from 'ws';

const messages = [];
const truncate = (s, n = 200) => {
  const str = typeof s === 'string' ? s : JSON.stringify(s);
  return str.length > n ? str.slice(0, n) + `…(+${str.length - n} chars)` : str;
};

function summarize(msg) {
  if (msg && msg.type === 'output' && typeof msg.data === 'string') {
    return {
      type: msg.type,
      id: msg.id,
      dataLen: msg.data.length,
      dataPreview: truncate(JSON.stringify(msg.data)),
      dataType: typeof msg.data,
    };
  }
  return msg;
}

const ws = new WebSocket('ws://localhost:3001/ws');

await new Promise((resolve, reject) => {
  ws.once('open', resolve);
  ws.once('error', reject);
});

ws.on('message', (raw) => {
  let msg;
  try {
    msg = JSON.parse(String(raw));
  } catch (e) {
    messages.push({ parseError: String(e), raw: truncate(String(raw)) });
    return;
  }
  messages.push(msg);
});

ws.send(JSON.stringify({ type: 'create', cols: 80, rows: 24 }));

const created = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout waiting for created')), 5000);
  const onMsg = (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'created') {
        clearTimeout(t);
        ws.off('message', onMsg);
        resolve(msg);
      }
      if (msg.type === 'error') {
        clearTimeout(t);
        ws.off('message', onMsg);
        reject(new Error(msg.message || JSON.stringify(msg)));
      }
    } catch { /* ignore */ }
  };
  ws.on('message', onMsg);
});

const id = created.id;
console.log('CREATED:', JSON.stringify(created));

await new Promise((r) => setTimeout(r, 1000));

const beforeInput = messages.filter((m) => m.type === 'output').length;
console.log(`After 1s wait: ${beforeInput} output message(s)`);

ws.send(JSON.stringify({ type: 'input', id, data: 'echo HELLO_PTY_TEST\n' }));
console.log('Sent input: echo HELLO_PTY_TEST');

await new Promise((r) => setTimeout(r, 2000));

ws.close();

console.log('\n=== ALL MESSAGES ===');
for (const [i, m] of messages.entries()) {
  console.log(`[${i}]`, JSON.stringify(summarize(m)));
}

const allOutput = messages
  .filter((m) => m.type === 'output')
  .map((m) => m.data)
  .join('');
const hasHello = allOutput.includes('HELLO_PTY_TEST');
console.log('\n=== SUMMARY ===');
console.log('totalMessages:', messages.length);
console.log('outputCount:', messages.filter((m) => m.type === 'output').length);
console.log('contains HELLO_PTY_TEST:', hasHello);
console.log('combinedOutputPreview:', truncate(JSON.stringify(allOutput), 500));
process.exit(0);
