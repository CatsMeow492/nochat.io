// @dev Load app fonts first
import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';

// index.js
import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';

// Remove React.StrictMode to test if this is causing the issue
ReactDOM.render(
  <App />,
  document.getElementById('root')
);