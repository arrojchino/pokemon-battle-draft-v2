import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/screens.css';
import './styles/lobby.css';
import './styles/hub.css';
import './styles/match.css';
import './styles/battle.css';
import './styles/battle-fx.css';
import './styles/battle-hud.css';
import './styles/pokedex.css';
import './styles/settings.css';
import './styles/world.css';

import { discoverBackend } from './net/session.js';

// Learn the advertised battle server before the transport is created (at most 2.5 s; the app starts either way).
void discoverBackend().finally(() => {
  createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
});
