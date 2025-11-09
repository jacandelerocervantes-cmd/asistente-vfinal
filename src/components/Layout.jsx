// src/components/Layout.jsx
import React from 'react';
import Header from './Header';
import Footer from './Footer';
import UserBar from './UserBar'; // <-- 1. IMPORTA LA NUEVA BARRA
import InactivityModal from './InactivityModal'; // <-- 1. IMPORTAR
import './Layout.css';

const Layout = ({ children, session }) => {
  return (
    <div className="app-layout">
      {/* 2. PASAR LA SESIÓN AL MODAL */}
      <InactivityModal session={session} /> 
      
      <Header />
      <UserBar session={session} /> {/* <-- 2. AÑÁDELA AQUÍ */}
      <main className="app-content">
        {children}
      </main>
      <Footer />
    </div>
  );
};

export default Layout;