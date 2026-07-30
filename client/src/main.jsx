import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { applyTermBgCssVar } from './terminalThemes.js';

applyTermBgCssVar();

createRoot(document.getElementById('root')).render(<App />);
