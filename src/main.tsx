import './bridge';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { ProfileWindow } from './ui/ProfileWindow';
import './ui/styles.css';

// The match window and the profile window load the same page; the bridge says which one this is.
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{window.ancient?.windowName === 'profile' ? <ProfileWindow /> : <App />}</React.StrictMode>,
);
