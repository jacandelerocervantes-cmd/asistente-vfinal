import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import './context/Notification.css' // <-- AÑADE ESTA LÍNEA
import './forms.css' // <-- AÑADIR ESTA LÍNEA

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)