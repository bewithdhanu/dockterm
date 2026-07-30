import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SerializeAddon } from '@xterm/addon-serialize';
import '@xterm/xterm/css/xterm.css';
import { MAX_SCROLLBACK_ROWS } from './sessionPersist.js';

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
      setOverlay({
        mode: 'connecting',
        text: stripAnsi(connectLogRef.current),
        host: sshHost || '',
      });
    } else if (sshStatus === 'error') {
      divertRef.current = false;
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
      const term = termRef.current;
      const raw = connectLogRef.current;
      const prompt = lastPromptLine(raw);
      connectLogRef.current = '';
      setOverlay(null);

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
    }
  }, [isSsh, sshStatus, sshHost, id]);

  // Create the terminal ONCE per pane id — never tear down on parent re-renders.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily:
        '"MesloLGS NF", "SF Mono", Menlo, Monaco, "Cascadia Mono", monospace',
      fontSize: 14,
      lineHeight: 1.05,
      letterSpacing: 0,
      fontWeight: '400',
      fontWeightBold: '700',
      theme: {
        background: '#1e1e1e',
        foreground: '#cccccc',
        cursor: '#aeafad',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#264f78',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5',
      },
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
      try {
        if (document.fonts?.load) {
          await Promise.all([
            document.fonts.load('14px "MesloLGS NF"'),
            document.fonts.load('bold 14px "MesloLGS NF"'),
          ]);
          await document.fonts.ready;
        }
      } catch {
        /* ignore */
      }

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
      if (activeRef.current) term.focus();
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
  }, [active, id]);

  // Auto-scroll overlay log as bytes arrive.
  const logRef = useRef(null);
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [overlay?.text]);

  return (
    <div className="terminal-host-wrap">
      <div className="terminal-host" ref={containerRef} />
      {overlay && (
        <div
          className={`ssh-connect-overlay mode-${overlay.mode}`}
          aria-live="polite"
        >
          <div className="ssh-connect-overlay-header">
            <span className="ssh-connect-overlay-dot" />
            <span>
              {overlay.mode === 'error'
                ? `SSH failed${overlay.host ? ` · ${overlay.host}` : ''}`
                : `Connecting${overlay.host ? ` · ${overlay.host}` : ''}…`}
            </span>
            {overlay.mode === 'error' ? (
              <button
                type="button"
                className="ssh-connect-overlay-dismiss"
                onClick={() => {
                  overlayDismissedRef.current = true;
                  setOverlay(null);
                }}
              >
                Dismiss
              </button>
            ) : null}
          </div>
          <pre ref={logRef} className="ssh-connect-overlay-log">
            {overlay.text ||
              (overlay.mode === 'error'
                ? 'No output captured.'
                : 'Waiting for remote…')}
          </pre>
          <div className="ssh-connect-overlay-hint">
            {overlay.mode === 'error'
              ? 'Tab kept open — dismiss to see the terminal, or close the tab when done.'
              : 'Password / prompts: type normally (focus stays on the terminal).'}
          </div>
        </div>
      )}
    </div>
  );
}
