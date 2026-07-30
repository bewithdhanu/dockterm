import { useEffect, useRef, useState } from 'react';
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

function stripAnsi(text) {
  return String(text || '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\r/g, '');
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

/**
 * Derive a compact banner from diverted SSH connect output.
 * Host-key / password prompts surface as structured UI instead of a full-screen log.
 */
function deriveSshBanner(text, mode, host, opts = {}) {
  const plain = String(text || '');
  const lower = plain.toLowerCase();

  if (mode === 'error') {
    return {
      kind: 'error',
      title: host ? `SSH failed · ${host}` : 'SSH failed',
      detail:
        lastMeaningfulLines(plain, 5) || 'Connection failed.',
      confirm: null,
    };
  }

  const hostKey =
    /are you sure you want to continue connecting/i.test(plain) ||
    /authenticity of host .+ can'?t be established/i.test(plain);

  if (hostKey) {
    const authenticity = plain.match(
      /The authenticity of host[\s\S]*?(?=Are you sure|$)/i
    );
    const fingerprint = plain.match(
      /(?:ED25519|RSA|ECDSA|DSA)\s+key fingerprint is\s+\S+/i
    );
    const detail = [
      authenticity?.[0]?.trim(),
      fingerprint && !authenticity?.[0]?.includes(fingerprint[0])
        ? fingerprint[0]
        : null,
    ]
      .filter(Boolean)
      .join('\n\n')
      .trim();

    if (opts.hostKeyAnswered) {
      return {
        kind: 'connecting',
        title: host ? `Connecting · ${host}` : 'Connecting…',
        detail: 'Host key accepted — finishing sign-in…',
        confirm: null,
      };
    }

    return {
      kind: 'confirm',
      title: 'Trust this host?',
      detail:
        detail ||
        'This host is not in your known_hosts allow list yet.',
      confirm: 'hostkey',
    };
  }

  if (
    /password:/i.test(plain) ||
    /passphrase for/i.test(plain) ||
    /verification code:/i.test(plain)
  ) {
    return {
      kind: 'auth',
      title: host ? `Sign in · ${host}` : 'Authentication',
      detail: /passphrase/i.test(plain)
        ? 'Enter your key passphrase…'
        : /verification code/i.test(plain)
          ? 'Enter the verification code…'
          : 'Enter your password…',
      confirm: null,
    };
  }

  if (
    /connection refused|connection timed out|no route to host|could not resolve|network is unreachable|connection reset|operation timed out/i.test(
      lower
    )
  ) {
    return {
      kind: 'retry',
      title: host ? `Retrying · ${host}` : 'Retrying…',
      detail: lastMeaningfulLines(plain, 3) || 'Waiting to reconnect…',
      confirm: null,
    };
  }

  return {
    kind: 'connecting',
    title: host ? `Connecting · ${host}` : 'Connecting…',
    detail: lastMeaningfulLines(plain, 2) || 'Establishing SSH session…',
    confirm: null,
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

export function TerminalPane({
  id,
  active,
  visible = active,
  send,
  registerHandlers,
  registerSerializer,
  onTitle,
  onCwd,
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

  onTitleRef.current = onTitle;
  onCwdRef.current = onCwd;
  sendRef.current = send;
  activeRef.current = active;
  sshStatusRef.current = sshStatus;

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
      applyConnectingCursor(termRef.current, false);
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
    }
  }, [isSsh, sshStatus, sshHost, id]);

  // Create the terminal ONCE per pane id — never tear down on parent re-renders.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    applyTermBgCssVar();

    const connecting = Boolean(isSsh && sshStatusRef.current === 'connecting');
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
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(serializeAddon);
    term.open(el);
    termRef.current = term;
    fitRef.current = fit;
    serializeRef.current = serializeAddon;

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
        const note = `\r\n[SSH disconnected — exit code ${code ?? 0}]\r\nTab kept open so you can read any error above.\r\n`;
        if (isSsh) {
          connectLogRef.current += note;
          setOverlayRef.current({
            mode: 'error',
            text: stripAnsi(connectLogRef.current),
            host: sshHost || '',
          });
          // With restored history, also leave a short note in the terminal.
          if (hasHistoryRef.current && !divertRef.current) {
            term.writeln('');
            term.writeln(
              `\x1b[91m[SSH disconnected — exit code ${code ?? 0}]\x1b[0m`
            );
          }
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
      if (activeRef.current && sshStatusRef.current !== 'connecting') {
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
          isSsh && sshStatusRef.current === 'connecting';
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
    // Keep focus off the empty PTY while connecting (password auth re-focuses later).
    if (isSsh && sshStatus === 'connecting') return;
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

  return (
    <div
      className={`terminal-host-wrap${
        isSsh && sshStatus === 'connecting' ? ' is-connecting' : ''
      }`}
    >
      <div className="terminal-host" ref={containerRef} />
      {overlay && banner && (
        <div
          className={`ssh-connect-toast mode-${banner.kind}`}
          role="status"
          aria-live="polite"
        >
          <div className="ssh-connect-toast-header">
            <span className="ssh-connect-toast-dot" />
            <span className="ssh-connect-toast-title">{banner.title}</span>
            {overlay.mode === 'error' ? (
              <button
                type="button"
                className="ssh-connect-toast-btn quiet"
                onClick={() => {
                  overlayDismissedRef.current = true;
                  setOverlay(null);
                }}
              >
                Dismiss
              </button>
            ) : null}
          </div>
          {banner.detail ? (
            <pre className="ssh-connect-toast-detail">{banner.detail}</pre>
          ) : null}
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
          {banner.kind === 'auth' ? (
            <div className="ssh-connect-toast-hint">
              Type in the terminal — input is not shown here.
            </div>
          ) : null}
          {banner.kind === 'error' ? (
            <div className="ssh-connect-toast-hint">
              Tab kept open so you can retry or close it.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
