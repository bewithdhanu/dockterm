import { useCallback, useEffect, useRef, useState } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import {
  APP_THEME_EVENT,
  getResolvedAppAppearance,
} from './appTheme.js';

let sshLanguageRegistered = false;

function registerSshConfigLanguage(monaco) {
  if (sshLanguageRegistered) return;
  sshLanguageRegistered = true;

  monaco.languages.register({ id: 'sshconfig' });
  monaco.languages.setMonarchTokensProvider('sshconfig', {
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/^\s*(Host|Match)\b/, 'keyword'],
        [
          /^\s*(HostName|User|Port|IdentityFile|ProxyJump|ProxyCommand|LocalForward|RemoteForward|DynamicForward|ForwardAgent|IdentitiesOnly|PreferredAuthentications|ServerAliveInterval|ServerAliveCountMax|StrictHostKeyChecking|UserKnownHostsFile|Include|AddressFamily|BindAddress|ChallengeResponseAuthentication|Compression|ControlMaster|ControlPath|ControlPersist|EscapeChar|ExitOnForwardFailure|FingerprintHash|GatewayPorts|GlobalKnownHostsFile|HashKnownHosts|HostKeyAlgorithms|HostKeyAlias|Hostname|IPQoS|KbdInteractiveAuthentication|KexAlgorithms|LogLevel|MACs|NumberOfPasswordPrompts|PasswordAuthentication|PKCS11Provider|Port|PubkeyAuthentication|RekeyLimit|RemoteCommand|RequestTTY|SendEnv|SetEnv|TCPKeepAlive|Tunnel|UpdateHostKeys|VerifyHostKeyDNS|VisualHostKey|XAuthLocation)\b/i,
          'type',
        ],
        [/\d+/, 'number'],
        [/~?[A-Za-z0-9_./:@+=,-]+/, 'string'],
      ],
    },
  });
  monaco.languages.setLanguageConfiguration('sshconfig', {
    comments: { lineComment: '#' },
    autoClosingPairs: [
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });
}

loader.init().then((monaco) => {
  registerSshConfigLanguage(monaco);
});

export function ConfigEditorPane({ active, onHostsChanged }) {
  const [path, setPath] = useState('~/.ssh/config');
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  const editorRef = useRef(null);

  const dirty = content !== original;
  const [monacoTheme, setMonacoTheme] = useState(() =>
    getResolvedAppAppearance() === 'light' ? 'vs' : 'vs-dark'
  );

  useEffect(() => {
    const sync = () => {
      setMonacoTheme(
        getResolvedAppAppearance() === 'light' ? 'vs' : 'vs-dark'
      );
    };
    window.addEventListener(APP_THEME_EVENT, sync);
    return () => window.removeEventListener(APP_THEME_EVENT, sync);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatus('');
    try {
      const res = await fetch('/api/ssh-config');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const text = data.content ?? '';
      setContent(text);
      setOriginal(text);
      if (data.path) setPath(data.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (active && editorRef.current) {
      // Layout when tab becomes visible
      requestAnimationFrame(() => {
        editorRef.current?.layout();
        editorRef.current?.focus();
      });
    }
  }, [active]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setStatus('');
    try {
      const res = await fetch('/api/ssh-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setOriginal(content);
      setStatus('Saved');
      onHostsChanged?.(data.hosts || []);
      setTimeout(() => setStatus(''), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [content, onHostsChanged]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dirty && !saving) save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, dirty, saving, save]);

  const displayPath = path
    .replace(/\/Users\/[^/]+/, '~')
    .replace(/^\/home\/[^/]+/, '~');

  return (
    <div className="editor-pane">
      <div className="editor-toolbar">
        <div className="editor-file">
          <span className="editor-file-icon">📄</span>
          <span className="editor-file-name">
            {displayPath}
            {dirty ? ' •' : ''}
          </span>
        </div>
        <div className="editor-toolbar-actions">
          {status && <span className="editor-status ok">{status}</span>}
          {error && <span className="editor-status err">{error}</span>}
          <button
            type="button"
            className="btn ghost"
            onClick={load}
            disabled={loading || saving}
          >
            Revert
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={save}
            disabled={loading || saving || !dirty}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="editor-monaco">
        {loading ? (
          <div className="sidebar-empty">Loading config…</div>
        ) : (
          <Editor
            height="100%"
            theme={monacoTheme}
            language="sshconfig"
            value={content}
            onChange={(v) => setContent(v ?? '')}
            onMount={(editor, monaco) => {
              editorRef.current = editor;
              registerSshConfigLanguage(monaco);
              editor.focus();
            }}
            options={{
              fontFamily:
                '"SF Mono", Menlo, Monaco, "Cascadia Code", Consolas, monospace',
              fontSize: 13,
              lineHeight: 20,
              minimap: { enabled: true, scale: 1 },
              scrollBeyondLastLine: false,
              wordWrap: 'off',
              renderWhitespace: 'selection',
              tabSize: 2,
              automaticLayout: true,
              padding: { top: 8, bottom: 8 },
              cursorBlinking: 'smooth',
              smoothScrolling: true,
              bracketPairColorization: { enabled: true },
            }}
          />
        )}
      </div>

      <div className="editor-statusbar">
        <span>SSH Config</span>
        <span>UTF-8</span>
        <span>LF</span>
        <span>{dirty ? 'Modified' : 'Saved'}</span>
        <span className="editor-statusbar-hint">⌘S to save · backup on write</span>
      </div>
    </div>
  );
}
