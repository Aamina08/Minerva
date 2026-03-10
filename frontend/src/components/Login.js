import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import "./Login.css";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = new URLSearchParams(location.search).get("redirect");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { data } = await api.post("/auth/login", {
        email,
        password,
      });

      // Save token + user
      login(data.token, data.user);

      // Preserve invite query so users auto-join the shared study group after login.
      if (redirectTo) {
        navigate(redirectTo);
      } else {
        navigate("/chat");
      }

    } catch (err) {
      if (!err.response) {
        setError("Cannot reach server. Start backend on http://localhost:5000 and try again.");
      } else {
        setError(err.response?.data?.message || "Login failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <div className="login-left">
          <h2>Welcome</h2>
          <p>Smart Virtual Academic Assistant</p>
        </div>

        <div className="login-right">
          <h2>Login</h2>

          <form onSubmit={handleSubmit}>
            <input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <input
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            <button
              type="submit"
              className="login-btn"
              disabled={loading}
            >
              {loading ? "Logging in..." : "Login"}
            </button>

            {error && (
              <p style={{ color: "#dc2626", marginTop: "10px" }}>
                {error}
              </p>
            )}
          </form>

          <p className="signup-text">
            Don't have an account?{" "}
            <Link to={`/signup${redirectTo ? `?redirect=${encodeURIComponent(redirectTo)}` : ""}`}>
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
