import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
/* Last: the capability gate has to win over component styles. */
import './widgetRenderBudget.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
