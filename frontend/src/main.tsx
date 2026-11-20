import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import './styles/fonts.css';
import './styles/base.css';
import './styles/screens.css';
import './styles/match.css';
import './styles/battle.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
