import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// No StrictMode: it double-invokes effects in dev, which would spin up the
// WebGL scene twice. The engine and surfaces are pure; the 3D view is the one
// place that must mount once.
createRoot(document.getElementById('reimagine-root')).render(<App />);
