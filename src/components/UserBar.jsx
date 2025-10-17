// src/components/UserBar.jsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import './UserBar.css'; // Crearemos este CSS

const UserBar = ({ session }) => {
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  // Si no hay sesión, no renderizamos nada.
  if (!session) {
    return null;
  }

  return (
    <div className="user-bar">
      <div className="user-bar-content container">
        <span className="welcome-message">
          Bienvenido, {session.user.user_metadata?.full_name || session.user.email}
        </span>
        <button onClick={handleSignOut} className="btn-signout">
          Cerrar Sesión
        </button>
      </div>
    </div>
  );
};

export default UserBar;