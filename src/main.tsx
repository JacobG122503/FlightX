import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';

// Running inside the FlightX desktop shell (Electron): enables title-bar spacing and window dragging.
if (navigator.userAgent.includes('Electron')) {
  const root = document.documentElement;
  root.classList.add('is-desktop');
  // Fullscreen has no title bar, so the panels can sit right at the top of the screen.
  const syncFullscreen = () =>
    root.classList.toggle('is-fullscreen', Math.abs(window.innerWidth - screen.width) < 2 && Math.abs(window.innerHeight - screen.height) < 2);
  syncFullscreen();
  window.addEventListener('resize', syncFullscreen);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
