// src/components/common/ToggleSwitch.jsx
import React from 'react';
import './ToggleSwitch.css';

const ToggleSwitch = ({ id, isChecked, onChange, disabled = false }) => {
  return (
    <label className="toggle-switch" htmlFor={id}>
      <input
        type="checkbox"
        id={id}
        checked={isChecked}
        onChange={onChange}
        disabled={disabled}
      />
      <span className="slider round"></span>
    </label>
  );
};

export default ToggleSwitch;