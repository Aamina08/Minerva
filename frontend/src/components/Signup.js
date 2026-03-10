import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import "./Login.css";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";

function Signup() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = new URLSearchParams(location.search).get("redirect");

  const handleSignup = async () => {
    if (!name || !email || !password || !confirmPassword) {
      setError("Please fill all fields");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    try {
      setLoading(true);
      setError("");
      setSuccess("");

      const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role: "student" }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Signup failed");
        return;
      }

      setSuccess("Account created successfully. Redirecting to login...");
      setTimeout(() => {
        navigate(`/login${redirectTo ? `?redirect=${encodeURIComponent(redirectTo)}` : ""}`);
      }, 1000);
    } catch (err) {
      setError("Unable to connect to server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <div className="login-left">
          <h2>Create Account</h2>
          <p>Join Smart Virtual Academic Assistant</p>
        </div>

        <div className="login-right">
          <h2>Student Sign Up</h2>

          <input
            type="text"
            placeholder="Full Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <input
            type="password"
            placeholder="Confirm Password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />

          <button className="login-btn" onClick={handleSignup} disabled={loading}>
            {loading ? "Creating account..." : "Sign Up"}
          </button>

          {error && <p style={{ color: "#dc2626", marginTop: "10px" }}>{error}</p>}
          {success && <p style={{ color: "#15803d", marginTop: "10px" }}>{success}</p>}

          <p className="signup-text">
            Already have an account?{" "}
            <Link to={`/login${redirectTo ? `?redirect=${encodeURIComponent(redirectTo)}` : ""}`}>
              <span>Login</span>
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Signup;
