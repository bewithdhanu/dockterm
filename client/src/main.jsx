import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import {
  applyAppChromeDefaults,
  applyTermBgCssVar,
} from './terminalThemes.js';

applyTermBgCssVar();
applyAppChromeDefaults();

createRoot(document.getElementById('root')).render(<App />);
