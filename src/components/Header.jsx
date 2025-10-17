// src/components/Header.jsx
import React from 'react';
import './Header.css';

// El Header ya no necesita saber nada de la sesión
const Header = () => {
  return (
    <header className="main-header">
      <div className="header-left-gradient"></div>
      <div className="header-content container">
        <img src="/images/tecnm_logo.png" alt="Logo Tecnológico Nacional de México" className="header-logo left-logo" />
        <h1 className="header-title">Asistente Docente v3</h1>
        <img src="/images/tec_tizimin_logo.png" alt="Logo Instituto Tecnológico de Tizimín" className="header-logo right-logo" />
      </div>
      <div className="header-right-gradient"></div>
    </header>
  );
};

export default Header;