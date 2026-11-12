import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';

// Running inside the FlightX desktop shell (Electron): enables title-bar spacing and window dragging.
if (navigator.userAgent.includes('Electron')) document.documentElement.classList.add('is-desktop');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
