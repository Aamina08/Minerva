import React, { useEffect, useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "./JoinGroup.css";

function JoinGroup() {
  const { inviteCode = "" } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const cleanCode = useMemo(() => String(inviteCode || "").trim(), [inviteCode]);

  useEffect(() => {
    if (!cleanCode || !user) return;
    navigate(`/chat?groupInvite=${encodeURIComponent(cleanCode)}`, { replace: true });
  }, [cleanCode, user, navigate]);

  if (!cleanCode) {
    return (
      <div className="join-shell">
        <div className="join-card">
          <h2>Invalid Invite Link</h2>
          <p>The study group invite code is missing.</p>
          <Link to="/" className="join-primary">Go to Login</Link>
        </div>
      </div>
    );
  }

  if (!user) {
    const redirectTo = encodeURIComponent(`/join/${cleanCode}`);
    return (
      <div className="join-shell">
        <div className="join-card">
          <h2>Join Study Group</h2>
          <p>Sign in with your account to join this study group.</p>
          <div className="join-actions">
            <Link to={`/?redirect=${redirectTo}`} className="join-primary">Login</Link>
            <Link to={`/signup?redirect=${redirectTo}`} className="join-secondary">Sign Up</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="join-shell">
      <div className="join-card">
        <h2>Joining Study Group...</h2>
        <p>Please wait while we connect you to the shared session.</p>
      </div>
    </div>
  );
}

export default JoinGroup;
