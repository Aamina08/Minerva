import React from "react";
import "./Navbar.css";

function Navbar() {
  return (
    <nav className="navbar">
      <div className="nav-brand">
        <span className="nav-brand-main" aria-label="MINERVA">
          <span className="brand-letter-m">M</span>
          <span className="brand-core">IN</span>
          <span className="brand-letter-e">E</span>
          <span className="brand-core">RVA</span>
        </span>
        <span className="nav-brand-sub">Smart Virtual Assistant</span>
      </div>
    </nav>
  );
}

export default Navbar;
