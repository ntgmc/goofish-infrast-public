import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import { installStaleChunkReloadHandler } from './lib/chunk-reload'
import { clearLocalViteDevCaches } from './lib/local-dev-cache'
import './index.css'

clearLocalViteDevCaches()
installStaleChunkReloadHandler()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
