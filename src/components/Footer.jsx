// src/components/Footer.jsx
import React from 'react';
import './Footer.css'; // Creamos este CSS en el siguiente paso

const Footer = () => {
  const year = new Date().getFullYear();
  return (
    <footer className="main-footer">
      <div className="footer-content container">
        <p>&copy; {year} Juan Candelero| Instituto Tecnológico de Tizimín</p>
        <p>V 1.0.0|Todos los derechos reservados.</p>
      </div>
    </footer>
  );
};

export default Footer;