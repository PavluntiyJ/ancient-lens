import './bridge';
import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';

// The profile window loads its own chunk; the match window renders without waiting for one.
const ProfileWindow = lazy(() => import('./ui/ProfileWindow').then((module) => ({ default: module.ProfileWindow })));

// The match window and the profile window load the same page; the bridge says which one this is.
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.ancient?.windowName === 'profile' ? (
      <Suspense fallback={null}>
        <ProfileWindow />
      </Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
