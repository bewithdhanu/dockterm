import { useEffect, useRef, useState } from 'react';
import { LuCheck, LuCopy } from 'react-icons/lu';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SerializeAddon } from '@xterm/addon-serialize';
import '@xterm/xterm/css/xterm.css';
import { MAX_SCROLLBACK_ROWS } from './sessionPersist.js';
import {
  TERM_THEME_EVENT,
  TERM_FONT_FAMILY,
  applyTermBgCssVar,
  getTermTheme,
  getTermFontSize,
} from './terminalThemes.js';
import { appendCommandHistory } from './commandHistory.js';

function stripAnsi(text) {
  return String(text || '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\r/g, '');
}

/** Open a terminal link in the OS default app (Electron) or a new tab (browser). */
function openTerminalLink(_event, uri) {
  const url = String(uri ?? '').trim();
  if (!url) return;
  const api = typeof window !== 'undefined' ? window.dockterm : null;
  if (api?.openExternal) {
    void api.openExternal(url);
    return;
  }
  // Avoid xterm's default window.open() then location=url — Electron maps that
  // to about:blank and never opens the real link.
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function writeClipboard(text) {
  const value = String(text ?? '');
  const api = typeof window !== 'undefined' ? window.dockterm : null;
  if (api?.clipboardWrite) {
    await api.clipboardWrite(value);
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } finally {
      ta.remove();
    }
  }
}

async function readClipboard() {
  const api = typeof window !== 'undefined' ? window.dockterm : null;
  if (api?.clipboardRead) {
    return String((await api.clipboardRead()) ?? '');
  }
  try {
    return await navigator.clipboard.readText();
  } catch {
    return '';
  }
}

function isMacPlatform() {
  return (
    /Mac|iPhone|iPod|iPad/.test(navigator.platform) ||
    navigator.userAgent.includes('Mac')
  );
}

function lastPromptLine(buf) {
  const lines = String(buf || '').split(/\r?\n/);
  return lines[lines.length - 1] || '';
}

function lastMeaningfulLines(text, max = 4) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(-max).join('\n');
}

function parseHostKeyInfo(plain) {
  const hostMatch = plain.match(
    /authenticity of host ['"]([^'"]+)['"]\s*(?:\(([^)]+)\))?/i
  );
  const keyMatch = plain.match(
    /(ED25519|RSA|ECDSA|DSA)\s+key fingerprint is\s+(\S+)/i
  );
  const algoMatch = plain.match(
    /(?:Offering|Server host key):\s*([^\r\n]+)/i
  );
  return {
    target: hostMatch?.[1] || null,
    address: hostMatch?.[2] || null,
    keyType: keyMatch?.[1] || null,
    fingerprint: keyMatch?.[2] || null,
    keyOffer: algoMatch?.[1]?.trim() || null,
  };
}

function classifyConnectError(plain) {
  const lower = String(plain || '').toLowerCase();
  if (/permission denied|authentication failed|too many authentication/i.test(lower)) {
    return {
      label: 'Authentication failed',
      summary: 'Credentials were rejected by the remote host.',
    };
  }
  if (/connection refused/i.test(lower)) {
    return {
      label: 'Connection refused',
      summary: 'Nothing is accepting SSH on that host/port.',
    };
  }
  if (/timed out|timeout/i.test(lower)) {
    return {
      label: 'Timed out',
      summary: 'The host did not respond in time.',
    };
  }
  if (/could not resolve|name or service not known|nodename nor servname/i.test(lower)) {
    return {
      label: 'Host not found',
      summary: 'DNS could not resolve that hostname.',
    };
  }
  if (/no route to host|network is unreachable/i.test(lower)) {
    return {
      label: 'Unreachable',
      summary: 'No network path to the remote host.',
    };
  }
  if (/host key verification failed/i.test(lower)) {
    return {
      label: 'Host key mismatch',
      summary: 'The remote key does not match known_hosts.',
    };
  }
  return {
    label: 'Connection failed',
    summary: 'SSH could not complete the session.',
  };
}

function inferConnectStep(plain, opts = {}) {
  if (opts.hostKeyAnswered) return 3;
  const lower = String(plain || '').toLowerCase();
  if (/password:|passphrase for|verification code:|authenticated to|auth succeeded/i.test(lower)) {
    return 3;
  }
  if (
    /authenticity of host|are you sure you want to continue|connecting to|connection established|banner/i.test(
      lower
    )
  ) {
    return 2;
  }
  if (plain && plain.trim()) return 1;
  return 0;
}

const CONNECT_STEPS = [
  {
    id: 'resolve',
    label: 'Resolve host',
    log: 'Resolving hostname and reading SSH config…',
  },
  {
    id: 'tcp',
    label: 'Open connection',
    log: 'Opening a TCP connection to the remote SSH service…',
  },
  {
    id: 'verify',
    label: 'Verify host key',
    log: 'Checking the remote host key against known_hosts…',
  },
  {
    id: 'auth',
    label: 'Authenticate',
    log: 'Negotiating encryption and authenticating…',
  },
];

function stageLogForProgress(steps, progress) {
  if (!steps?.length) return null;
  const i = Math.min(
    Math.max(Math.floor(progress), 0),
    steps.length - 1
  );
  return steps[i]?.log || steps[i]?.label || null;
}

/**
 * Derive a rich banner from diverted SSH connect output.
 */
function deriveSshBanner(text, mode, host, opts = {}) {
  const plain = String(text || '');
  const lower = plain.toLowerCase();
  const hostKeyInfo = parseHostKeyInfo(plain);
  const displayHost = host || hostKeyInfo.target || 'remote';
  const facts = [];

  if (host || hostKeyInfo.target) {
    facts.push({ label: 'Host', value: host || hostKeyInfo.target });
  }
  if (hostKeyInfo.address) {
    facts.push({ label: 'Address', value: hostKeyInfo.address });
  }
  if (hostKeyInfo.keyType) {
    facts.push({ label: 'Key type', value: hostKeyInfo.keyType });
  }
  if (hostKeyInfo.fingerprint) {
    facts.push({ label: 'Fingerprint', value: hostKeyInfo.fingerprint, mono: true });
  }

  if (mode === 'error') {
    const err = classifyConnectError(plain);
    return {
      kind: 'error',
      status: 'Failed',
      title: err.label,
      subtitle: displayHost,
      summary: err.summary,
      detail: lastMeaningfulLines(plain, 6) || null,
      facts,
      steps: CONNECT_STEPS,
      stepIndex: CONNECT_STEPS.length - 1,
      confirm: null,
      hint: 'Tab kept open — dismiss to read the terminal, or close the tab.',
    };
  }

  const hostKey =
    /are you sure you want to continue connecting/i.test(plain) ||
    /authenticity of host .+ can'?t be established/i.test(plain);

  if (hostKey) {
    if (opts.hostKeyAnswered) {
      return {
        kind: 'connecting',
        status: 'Connecting',
        title: 'Finishing sign-in',
        subtitle: displayHost,
        summary: 'Host key accepted. Completing authentication…',
        detail: null,
        facts,
        steps: CONNECT_STEPS,
        stepIndex: 3,
        confirm: null,
        hint: null,
      };
    }

    return {
      kind: 'confirm',
      status: 'New host',
      title: 'Trust this host?',
      subtitle: displayHost,
      summary:
        'This host is not in your known_hosts allow list yet. Confirm the fingerprint before continuing.',
      detail: null,
      facts,
      steps: CONNECT_STEPS,
      stepIndex: 2,
      confirm: 'hostkey',
      hint: 'Only continue if you recognize this machine and fingerprint.',
    };
  }

  if (
    /password:/i.test(plain) ||
    /passphrase for/i.test(plain) ||
    /verification code:/i.test(plain)
  ) {
    const authKind = /passphrase/i.test(plain)
      ? 'passphrase'
      : /verification code/i.test(plain)
        ? 'otp'
        : 'password';
    return {
      kind: 'auth',
      status: 'Authentication',
      title:
        authKind === 'passphrase'
          ? 'Key passphrase required'
          : authKind === 'otp'
            ? 'Verification code required'
            : 'Password required',
      subtitle: displayHost,
      summary:
        authKind === 'passphrase'
          ? 'Enter the passphrase for your private key.'
          : authKind === 'otp'
            ? 'Enter the one-time verification code.'
            : 'Enter your SSH password in the terminal.',
      detail: null,
      facts,
      steps: CONNECT_STEPS,
      stepIndex: 3,
      confirm: null,
      hint: 'Type directly in the terminal — input is not echoed here.',
    };
  }

  if (
    /connection refused|connection timed out|no route to host|could not resolve|network is unreachable|connection reset|operation timed out/i.test(
      lower
    )
  ) {
    const err = classifyConnectError(plain);
    return {
      kind: 'retry',
      status: 'Retrying',
      title: err.label,
      subtitle: displayHost,
      summary: err.summary,
      detail: lastMeaningfulLines(plain, 4) || null,
      facts,
      steps: CONNECT_STEPS,
      stepIndex: inferConnectStep(plain, opts),
      confirm: null,
      hint: 'Still trying to reach the remote host…',
    };
  }

  const stepIndex = inferConnectStep(plain, opts);
  return {
    kind: 'connecting',
    status: 'Connecting',
    title: 'Establishing SSH session',
    subtitle: displayHost,
    // Summary is driven by visual pipeline progress in the UI.
    summary: null,
    detail: lastMeaningfulLines(plain, 3) || null,
    facts: facts.length
      ? facts
      : host
        ? [{ label: 'Host', value: host }]
        : [],
    steps: CONNECT_STEPS,
    stepIndex,
    confirm: null,
    hint: null,
  };
}

function applyConnectingCursor(term, connecting) {
  if (!term) return;
  try {
    term.options.cursorBlink = !connecting;
    const base = getTermTheme();
    if (connecting) {
      // Match bg so any leftover cursor draw is invisible (xterm rejects "transparent").
      const bg = base.background || '#000000';
      term.options.theme = {
        ...base,
        cursor: bg,
        cursorAccent: bg,
      };
    } else {
      term.options.theme = base;
    }
    term.refresh(0, term.rows - 1);
  } catch {
    /* ignore */
  }
}

/**
 * Feed typed PTY input into a line buffer; return committed commands on Enter.
 * Skips CSI/SS3 sequences so arrow keys don't corrupt the buffer.
 */
function feedTypedLine(buf, data) {
  let line = String(buf || '');
  const committed = [];
  let i = 0;
  const s = String(data || '');

  while (i < s.length) {
    const ch = s[i];

    if (ch === '\x1b') {
      i += 1;
      if (s[i] === '[') {
        i += 1;
        while (i < s.length && !/[A-Za-z~]/.test(s[i])) i += 1;
        i += 1;
      } else if (s[i] === 'O') {
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      if (line.trim()) committed.push(line);
      line = '';
      i += 1;
      if (ch === '\r' && s[i] === '\n') i += 1;
      continue;
    }

    if (ch === '\x7f' || ch === '\b') {
      line = line.slice(0, -1);
      i += 1;
      continue;
    }

    if (ch === '\x03' || ch === '\x15') {
      // Ctrl-C / Ctrl-U — discard partial line
      line = '';
      i += 1;
      continue;
    }

    if (ch === '\x17') {
      // Ctrl-W — delete last word
      line = line.replace(/\s*\S*$/, '');
      i += 1;
      continue;
    }

    if (ch === '\t' || ch >= ' ') {
      line += ch;
    }
    i += 1;
  }

  return { line, committed };
}

export function TerminalPane({
  id,
  active,
  visible = active,
  send,
  registerHandlers,
  registerSerializer,
  onTitle,
  onCwd,
  onClose,
  initialScrollback,
  isSsh = false,
  sshStatus = null,
  sshHost = null,
}) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const serializeRef = useRef(null);
  const onTitleRef = useRef(onTitle);
  const onCwdRef = useRef(onCwd);
  const sendRef = useRef(send);
  const activeRef = useRef(active);
  const initialScrollbackRef = useRef(initialScrollback);
  const hasHistoryRef = useRef(Boolean(initialScrollback));
  const sshStatusRef = useRef(sshStatus);
  const sshHostRef = useRef(sshHost);
  const cwdRef = useRef(null);
  const typedLineRef = useRef('');
  const connectLogRef = useRef('');
  const divertRef = useRef(Boolean(isSsh && sshStatus === 'connecting'));
  const finishedConnectRef = useRef(sshStatus === 'connected');
  const [overlay, setOverlay] = useState(() =>
    isSsh && (sshStatus === 'connecting' || sshStatus === 'error')
      ? {
          mode: sshStatus === 'error' ? 'error' : 'connecting',
          text: '',
          host: sshHost || '',
        }
      : null
  );
  const setOverlayRef = useRef(setOverlay);
  setOverlayRef.current = setOverlay;
  const overlayDismissedRef = useRef(false);
  const [hostKeyAnswered, setHostKeyAnswered] = useState(false);
  const [connectStartedAt, setConnectStartedAt] = useState(() =>
    isSsh && sshStatus === 'connecting' ? Date.now() : null
  );
  const [elapsedSec, setElapsedSec] = useState(0);
  const [pipelineProgress, setPipelineProgress] = useState(0);
  const pipelineProgressRef = useRef(0);
  const [logCopied, setLogCopied] = useState(false);
  const logCopiedTimerRef = useRef(null);

  onTitleRef.current = onTitle;
  onCwdRef.current = onCwd;
  sendRef.current = send;
  activeRef.current = active;
  sshStatusRef.current = sshStatus;
  sshHostRef.current = sshHost;

  // Keep divert flag in sync with SSH lifecycle.
  useEffect(() => {
    if (!isSsh) {
      divertRef.current = false;
      return;
    }
    if (sshStatus === 'connecting') {
      divertRef.current = true;
      finishedConnectRef.current = false;
      overlayDismissedRef.current = false;
      setHostKeyAnswered(false);
      setConnectStartedAt(Date.now());
      setElapsedSec(0);
      pipelineProgressRef.current = 0;
      setPipelineProgress(0);
      applyConnectingCursor(termRef.current, true);
      try {
        termRef.current?.blur();
      } catch {
        /* ignore */
      }
      setOverlay({
        mode: 'connecting',
        text: stripAnsi(connectLogRef.current),
        host: sshHost || '',
      });
    } else if (sshStatus === 'error') {
      divertRef.current = false;
      applyConnectingCursor(termRef.current, true);
      try {
        termRef.current?.blur();
      } catch {
        /* ignore */
      }
      if (!overlayDismissedRef.current) {
        setOverlay({
          mode: 'error',
          text: stripAnsi(connectLogRef.current) || 'Connection failed.',
          host: sshHost || '',
        });
      }
    } else if (sshStatus === 'connected' && !finishedConnectRef.current) {
      finishedConnectRef.current = true;
      divertRef.current = false;
      applyConnectingCursor(termRef.current, false);
      setConnectStartedAt(null);
      const term = termRef.current;
      const raw = connectLogRef.current;
      const prompt = lastPromptLine(raw);
      connectLogRef.current = '';
      setOverlay(null);
      setHostKeyAnswered(false);

      if (!term) return;
      try {
        if (hasHistoryRef.current) {
          // Preserve restored scrollback — only mark the reconnect.
          term.write('\r\n\x1b[90m── reconnected ──\x1b[0m\r\n');
          if (prompt) term.write(prompt);
        } else {
          // Fresh session: drop MOTD / connect noise, start clean.
          term.reset();
          fitRef.current?.fit();
          if (prompt) term.write(prompt);
        }
        if (activeRef.current) term.focus();
      } catch {
        /* ignore */
      }
    } else if (sshStatus === 'connected') {
      applyConnectingCursor(termRef.current, false);
      setConnectStartedAt(null);
    }
  }, [isSsh, sshStatus, sshHost, id]);

  // Create the terminal ONCE per pane id — never tear down on parent re-renders.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    applyTermBgCssVar();

    const connecting = Boolean(
      isSsh &&
        (sshStatusRef.current === 'connecting' ||
          sshStatusRef.current === 'error')
    );
    const baseTheme = getTermTheme();
    const hideCursorTheme = connecting
      ? {
          ...baseTheme,
          cursor: baseTheme.background || '#000000',
          cursorAccent: baseTheme.background || '#000000',
        }
      : baseTheme;
    const term = new Terminal({
      cursorBlink: !connecting,
      cursorStyle: 'bar',
      cursorWidth: 2,
      fontFamily: TERM_FONT_FAMILY,
      fontSize: getTermFontSize(),
      lineHeight: 1.2,
      letterSpacing: 0,
      fontWeight: '400',
      fontWeightBold: '700',
      theme: hideCursorTheme,
      allowProposedApi: true,
      scrollback: 10000,
      macOptionIsMeta: true,
      convertEol: false,
      drawBoldTextInBrightColors: true,
    });

    const fit = new FitAddon();
    const serializeAddon = new SerializeAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon(openTerminalLink));
    term.loadAddon(serializeAddon);
    term.open(el);
    termRef.current = term;
    fitRef.current = fit;
    serializeRef.current = serializeAddon;

    let pasteLock = false;
    const pasteOnce = (text) => {
      if (!text || pasteLock) return;
      pasteLock = true;
      term.paste(text);
      setTimeout(() => {
        pasteLock = false;
      }, 50);
    };

    // xterm selection is not DOM text — handle clipboard ourselves.
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') return true;
      const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
      const mac = isMacPlatform();
      const primary = mac ? ev.metaKey : ev.ctrlKey;

      // ⌘C / Ctrl+Shift+C → copy selection (Ctrl+C alone still sends ^C except when
      // there is a selection on non-Mac, matching common terminal apps).
      if (
        ((primary && key === 'c' && !ev.shiftKey && !ev.altKey) ||
          (ev.ctrlKey && ev.shiftKey && key === 'c')) &&
        term.hasSelection()
      ) {
        void writeClipboard(term.getSelection());
        return false;
      }

      // Paste shortcuts: block xterm from treating them as input; paste is done
      // via the native `paste` event and/or dockterm:clipboard (Electron menu).
      if (
        (primary && key === 'v' && !ev.altKey && (mac || !ev.shiftKey)) ||
        (ev.ctrlKey && ev.shiftKey && key === 'v')
      ) {
        return false;
      }

      return true;
    });

    const onCopy = (e) => {
      if (!term.hasSelection()) return;
      e.preventDefault();
      const text = term.getSelection();
      e.clipboardData?.setData('text/plain', text);
      void writeClipboard(text);
    };
    const onPaste = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const fromEvent = e.clipboardData?.getData('text/plain');
      if (fromEvent) {
        pasteOnce(fromEvent);
        return;
      }
      void readClipboard().then((text) => pasteOnce(text));
    };
    const onAppClipboard = (e) => {
      if (!activeRef.current) return;
      const action = e?.detail?.action;
      if (action === 'copy') {
        if (!term.hasSelection()) return;
        void writeClipboard(term.getSelection());
        return;
      }
      if (action === 'paste') {
        void readClipboard().then((text) => pasteOnce(text));
        return;
      }
      if (action === 'selectAll') {
        try {
          term.selectAll();
        } catch {
          /* ignore */
        }
      }
    };
    el.addEventListener('copy', onCopy);
    el.addEventListener('paste', onPaste);
    window.addEventListener('dockterm:clipboard', onAppClipboard);

    const fitAndResize = () => {
      try {
        fit.fit();
        sendRef.current({
          type: 'resize',
          id,
          cols: term.cols,
          rows: term.rows,
        });
      } catch {
        /* ignore */
      }
    };

    const dataDisp = term.onData((data) => {
      sendRef.current({ type: 'input', id, data });

      // Don't record while SSH is still handshaking (password / host key noise).
      if (divertRef.current || sshStatusRef.current === 'connecting') {
        typedLineRef.current = '';
        return;
      }

      const { line, committed } = feedTypedLine(typedLineRef.current, data);
      typedLineRef.current = line;
      const where = isSsh
        ? sshHostRef.current || 'SSH'
        : 'Local';
      for (const command of committed) {
        appendCommandHistory({
          command,
          where,
          cwd: cwdRef.current,
        });
      }
    });

    const titleDisp = term.onTitleChange((title) => {
      onTitleRef.current?.(title);
    });

    try {
      term.parser.registerOscHandler(7, (data) => {
        try {
          const raw = String(data || '');
          const url = new URL(raw);
          if (url.protocol === 'file:') {
            let cwd = decodeURIComponent(url.pathname || '');
            if (/^\/[A-Za-z]:\//.test(cwd)) cwd = cwd.slice(1);
            if (cwd) {
              cwdRef.current = cwd;
              onCwdRef.current?.(cwd);
              sendRef.current({ type: 'cwd', id, cwd });
            }
          }
        } catch {
          /* ignore */
        }
        return false;
      });
    } catch {
      /* older xterm */
    }

    let scrollbackReady = !initialScrollbackRef.current;
    const earlyLive = [];

    const pushConnectLog = (data) => {
      connectLogRef.current += data;
      const mode =
        sshStatusRef.current === 'error' ? 'error' : 'connecting';
      setOverlayRef.current({
        mode,
        text: stripAnsi(connectLogRef.current),
        host: sshHost || '',
      });
    };

    const handleLiveOutput = (data) => {
      if (divertRef.current || sshStatusRef.current === 'connecting') {
        divertRef.current = true;
        pushConnectLog(data);
        return;
      }
      term.write(data);
    };

    const unregister = registerHandlers(id, {
      onOutput: (data) => {
        if (!scrollbackReady) {
          earlyLive.push(data);
          return;
        }
        handleLiveOutput(data);
      },
      onExit: (code) => {
        if (isSsh) {
          // Connection-phase failure only — keep toast so the user can read why.
          const stillConnecting =
            divertRef.current ||
            sshStatusRef.current === 'connecting' ||
            !finishedConnectRef.current;
          if (stillConnecting) {
            const note = `\r\n[SSH disconnected — exit code ${code ?? 0}]\r\n`;
            connectLogRef.current += note;
            setOverlayRef.current({
              mode: 'error',
              text: stripAnsi(connectLogRef.current),
              host: sshHost || '',
            });
          }
          // Already connected: App closes the pane; no failure toast.
          return;
        }
        term.writeln('');
        term.writeln(`\x1b[90m[Process exited with code ${code}]\x1b[0m`);
      },
    });

    const unregisterSerializer = registerSerializer?.(id, () => {
      try {
        return serializeAddon.serialize({ scrollback: MAX_SCROLLBACK_ROWS });
      } catch {
        return '';
      }
    });

    const ro = new ResizeObserver(() => {
      fitAndResize();
    });
    ro.observe(el);

    const start = async () => {
      const saved = initialScrollbackRef.current;
      initialScrollbackRef.current = null;
      if (saved) {
        hasHistoryRef.current = true;
        try {
          await new Promise((resolve) => {
            term.write(saved, resolve);
          });
        } catch {
          /* ignore */
        }
      }

      scrollbackReady = true;
      for (const chunk of earlyLive.splice(0)) {
        handleLiveOutput(chunk);
      }

      fitAndResize();
      // Don't focus while SSH is still connecting — avoids a blinking empty cursor.
      if (
        activeRef.current &&
        sshStatusRef.current !== 'connecting' &&
        sshStatusRef.current !== 'error'
      ) {
        term.focus();
      }
    };
    start();

    const t1 = setTimeout(fitAndResize, 100);
    const t2 = setTimeout(fitAndResize, 400);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      ro.disconnect();
      el.removeEventListener('copy', onCopy);
      el.removeEventListener('paste', onPaste);
      window.removeEventListener('dockterm:clipboard', onAppClipboard);
      dataDisp.dispose();
      titleDisp.dispose();
      unregister();
      unregisterSerializer?.();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      serializeRef.current = null;
    };
  }, [id, registerHandlers, registerSerializer, isSsh, sshHost]);

  useEffect(() => {
    const onTheme = (e) => {
      const term = termRef.current;
      const fit = fitRef.current;
      if (!term) return;
      try {
        const theme = e?.detail?.theme || getTermTheme();
        const fontSize = e?.detail?.fontSize || getTermFontSize();
        const connecting =
          isSsh &&
          (sshStatusRef.current === 'connecting' ||
            sshStatusRef.current === 'error');
        const bg = theme.background || '#000000';
        term.options.theme = connecting
          ? { ...theme, cursor: bg, cursorAccent: bg }
          : theme;
        term.options.cursorBlink = !connecting;
        term.options.fontFamily = TERM_FONT_FAMILY;
        term.options.fontSize = fontSize;
        term.refresh(0, term.rows - 1);
        if (fit) {
          fit.fit();
          sendRef.current({
            type: 'resize',
            id,
            cols: term.cols,
            rows: term.rows,
          });
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener(TERM_THEME_EVENT, onTheme);
    return () => window.removeEventListener(TERM_THEME_EVENT, onTheme);
  }, [id, isSsh]);

  useEffect(() => {
    if (!visible) return;
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;

    const frame = requestAnimationFrame(() => {
      try {
        fit.fit();
        sendRef.current({
          type: 'resize',
          id,
          cols: term.cols,
          rows: term.rows,
        });
      } catch {
        /* ignore */
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, id]);

  useEffect(() => {
    if (!active) return;
    // Keep focus off the empty PTY while connecting or after a failed connect.
    if (isSsh && (sshStatus === 'connecting' || sshStatus === 'error')) return;
    const term = termRef.current;
    if (!term) return;
    const frame = requestAnimationFrame(() => {
      try {
        term.focus();
      } catch {
        /* ignore */
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [active, id, isSsh, sshStatus]);

  const banner = overlay
    ? deriveSshBanner(overlay.text, overlay.mode, overlay.host, {
        hostKeyAnswered,
      })
    : null;

  useEffect(() => {
    if (!overlay || !connectStartedAt) return undefined;
    if (overlay.mode === 'error') return undefined;
    const tick = () => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - connectStartedAt) / 1000)));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [overlay, connectStartedAt, overlay?.mode]);

  // Smooth pipeline progress: glide through stages (~550ms each) instead of jumping.
  useEffect(() => {
    if (!overlay || !banner?.steps?.length) return undefined;

    if (banner.kind === 'error') {
      pipelineProgressRef.current = banner.steps.length;
      setPipelineProgress(banner.steps.length);
      return undefined;
    }

    const STAGE_MS = 550;
    const MAX_HOLD = banner.steps.length - 0.12; // keep last circle spinning
    let raf = 0;
    let last = performance.now();

    const loop = (now) => {
      const dt = Math.min(64, now - last);
      last = now;
      const elapsed = Date.now() - (connectStartedAt || Date.now());

      let target;
      if (banner.kind === 'confirm') {
        // Reach verify stage smoothly, then hold there.
        target = Math.min(2, elapsed / STAGE_MS);
        if (banner.stepIndex >= 2) target = 2;
      } else if (banner.kind === 'auth') {
        target = Math.min(MAX_HOLD, Math.max(3, elapsed / STAGE_MS));
      } else {
        const timed = elapsed / STAGE_MS;
        target = Math.max(timed, banner.stepIndex || 0);
        target = Math.min(MAX_HOLD, target);
      }

      let cur = pipelineProgressRef.current;
      if (cur < target) {
        // Constant-ish speed so each stage is visible (~1 unit / STAGE_MS).
        cur = Math.min(target, cur + dt / STAGE_MS);
      } else if (cur > target + 0.001) {
        cur = Math.max(target, cur - dt / (STAGE_MS * 0.6));
      } else {
        cur = target;
      }

      pipelineProgressRef.current = cur;
      setPipelineProgress(cur);
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [
    overlay,
    banner?.kind,
    banner?.stepIndex,
    banner?.steps?.length,
    connectStartedAt,
  ]);

  // Focus when password / OTP is needed so the user can type without clicking.
  useEffect(() => {
    if (!active || !banner || banner.kind !== 'auth') return;
    const term = termRef.current;
    if (!term) return;
    try {
      term.focus();
    } catch {
      /* ignore */
    }
  }, [active, banner?.kind]);

  const sendConnectReply = (data) => {
    if (data === 'yes\n' || data === 'no\n') {
      setHostKeyAnswered(true);
    }
    sendRef.current({ type: 'input', id, data });
    try {
      termRef.current?.focus();
    } catch {
      /* ignore */
    }
  };

  const formatElapsed = (sec) => {
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${String(s).padStart(2, '0')}s`;
  };

  const visualStepIndex = banner?.steps?.length
    ? Math.min(
        Math.max(Math.floor(pipelineProgress), 0),
        banner.steps.length - 1
      )
    : 0;

  const stageLog = stageLogForProgress(banner?.steps, pipelineProgress);

  // Stage copy follows the animated circles. Real SSH lines (when any) append under it.
  // Failed / auth / host-key keep their own richer messages.
  const logText = (() => {
    if (!banner) return 'Waiting for remote…';
    if (banner.kind === 'error') {
      return (
        banner.detail ||
        banner.summary ||
        overlay?.text?.trim() ||
        'Connection failed.'
      );
    }
    if (banner.kind === 'confirm' || banner.kind === 'auth') {
      return (
        banner.summary ||
        banner.detail ||
        stageLog ||
        overlay?.text?.trim() ||
        'Waiting for remote…'
      );
    }
    const sshLines = banner.detail?.trim();
    if (stageLog && sshLines && !sshLines.includes(stageLog)) {
      return `${stageLog}\n${sshLines}`;
    }
    return stageLog || sshLines || banner.summary || 'Waiting for remote…';
  })();

  const copyLog = async () => {
    const value = String(logText || '');
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        return;
      }
    }
    setLogCopied(true);
    if (logCopiedTimerRef.current) clearTimeout(logCopiedTimerRef.current);
    logCopiedTimerRef.current = setTimeout(() => setLogCopied(false), 1200);
  };

  return (
    <div
      className={`terminal-host-wrap${
        isSsh && (sshStatus === 'connecting' || sshStatus === 'error')
          ? ' is-connecting'
          : ''
      }`}
    >
      <div className="terminal-host" ref={containerRef} />
      {overlay && banner && (
        <div
          className={`ssh-connect-toast mode-${banner.kind}`}
          role="status"
          aria-live="polite"
        >
          <div className="ssh-connect-toast-top">
            <div className="ssh-connect-host" title={banner.subtitle || ''}>
              {banner.subtitle || banner.title}
            </div>
            <div className="ssh-connect-toast-top-right">
              {overlay.mode !== 'error' && connectStartedAt ? (
                <span className="ssh-connect-toast-elapsed">
                  {formatElapsed(elapsedSec)}
                </span>
              ) : null}
              {overlay.mode === 'error' ? (
                <button
                  type="button"
                  className="ssh-connect-toast-btn quiet"
                  onClick={() => {
                    overlayDismissedRef.current = true;
                    setOverlay(null);
                    onClose?.();
                  }}
                >
                  Close
                </button>
              ) : null}
            </div>
          </div>

          {banner.steps ? (
            <div className="ssh-connect-pipeline" aria-label="Connection progress">
              {banner.steps.map((step, i) => {
                const p = pipelineProgress;
                const state =
                  banner.kind === 'error'
                    ? i < banner.steps.length - 1
                      ? 'done'
                      : 'error'
                    : p >= i + 1
                      ? 'done'
                      : p >= i
                        ? 'active'
                        : 'pending';
                const lineFill =
                  banner.kind === 'error'
                    ? 100
                    : Math.max(0, Math.min(100, (p - (i - 1)) * 100));
                return (
                  <div key={step.id} className="ssh-connect-pipeline-item">
                    {i > 0 ? (
                      <span
                        className="ssh-connect-pipeline-line"
                        aria-hidden="true"
                      >
                        <span
                          className="ssh-connect-pipeline-line-fill"
                          style={{ width: `${lineFill}%` }}
                        />
                      </span>
                    ) : null}
                    <span
                      className={`ssh-connect-pipeline-circle ${state}`}
                      title={step.label}
                      aria-label={`${step.label}: ${state}`}
                    >
                      <span className="ssh-connect-pipeline-ring" aria-hidden="true" />
                      {state === 'done' ? (
                        <span className="ssh-connect-pipeline-check" aria-hidden="true">
                          ✓
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}

          {banner.steps ? (
            <div className="ssh-connect-stage-label">
              {banner.kind === 'error'
                ? banner.title
                : banner.steps[visualStepIndex]?.label}
            </div>
          ) : (
            <div className="ssh-connect-stage-label">{banner.title}</div>
          )}

          {banner.confirm === 'hostkey' && banner.facts?.length ? (
            <dl className="ssh-connect-toast-facts">
              {banner.facts
                .filter((f) => f.label !== 'Host')
                .map((fact) => (
                  <div
                    key={`${fact.label}-${fact.value}`}
                    className="ssh-connect-toast-fact"
                  >
                    <dt>{fact.label}</dt>
                    <dd
                      className={fact.mono ? 'mono' : undefined}
                      title={fact.value}
                    >
                      {fact.value}
                    </dd>
                  </div>
                ))}
            </dl>
          ) : null}

          <div
            className={`ssh-connect-toast-log-wrap${
              banner.kind === 'error' ? ' has-copy' : ''
            }`}
          >
            {banner.kind === 'error' ? (
              <button
                type="button"
                className={`ssh-connect-toast-log-copy${
                  logCopied ? ' copied' : ''
                }`}
                title={logCopied ? 'Copied' : 'Copy log'}
                aria-label={logCopied ? 'Copied' : 'Copy log'}
                onClick={copyLog}
              >
                {logCopied ? (
                  <LuCheck size={13} aria-hidden="true" />
                ) : (
                  <LuCopy size={13} aria-hidden="true" />
                )}
              </button>
            ) : null}
            <pre className="ssh-connect-toast-log">{logText}</pre>
          </div>

          {banner.confirm === 'hostkey' ? (
            <div className="ssh-connect-toast-actions">
              <button
                type="button"
                className="ssh-connect-toast-btn danger"
                onClick={() => sendConnectReply('no\n')}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ssh-connect-toast-btn primary"
                onClick={() => sendConnectReply('yes\n')}
              >
                Trust & continue
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
