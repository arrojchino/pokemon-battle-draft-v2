import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import './styles/fonts.css';
import './styles/base.css';
import './styles/screens.css';
import './styles/match.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
