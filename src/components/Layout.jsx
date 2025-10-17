// src/components/Layout.jsx
import React from 'react';
import Header from './Header';
import Footer from './Footer';
import UserBar from './UserBar'; // <-- 1. IMPORTA LA NUEVA BARRA
import './Layout.css';

const Layout = ({ children, session }) => {
  return (
    <div className="app-layout">
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