import { applyAppChrome, startAppThemeListener } from './appTheme.js';
import { applyTermBgCssVar } from './terminalThemes.js';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

applyAppChrome();
startAppThemeListener();
applyTermBgCssVar();

createRoot(document.getElementById('root')).render(<App />);
