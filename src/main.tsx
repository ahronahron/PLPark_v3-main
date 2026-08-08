/**
 * main.tsx — Application Entry Point
 *
 * This file bootstraps the entire PLPark React application.
 * It grabs the root DOM element from index.html (#root),
 * wraps the <App /> component in React's StrictMode for
 * development warnings, and mounts the component tree.
 *
 * StrictMode intentionally double-invokes certain lifecycle
 * methods in development to surface side-effects and help
 * identify potential problems early.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

/**
 * createRoot — Creates the React concurrent root.
 * The non-null assertion (!) is used because we're certain
 * the #root element exists in index.html.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
