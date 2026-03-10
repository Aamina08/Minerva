import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from "react-router-dom";
import Login from "./components/Login";
import Signup from "./components/Signup";
import Chatbot from "./components/Chatbot";
import JoinGroup from "./components/JoinGroup";
import Navbar from "./components/Navbar";
import { useAuth } from "./context/AuthContext";

function Layout() {
  const location = useLocation();
  const { user } = useAuth();

  const hideNavbar =
    location.pathname === "/" ||
    location.pathname === "/login" ||
    location.pathname === "/signup" ||
    location.pathname.startsWith("/join/");

  return (
    <>
      {!hideNavbar && user && <Navbar />}

      <Routes>
        <Route path="/" element={user ? <Navigate to="/chat" replace /> : <Login />} />
        <Route path="/login" element={user ? <Navigate to="/chat" replace /> : <Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/join/:inviteCode" element={<JoinGroup />} />
        <Route
          path="/chat"
          element={
            user ? (
              <Chatbot />
            ) : (
              <Navigate
                to={`/login?redirect=${encodeURIComponent(`/chat${location.search || ""}`)}`}
                replace
              />
            )
          }
        />
      </Routes>
    </>
  );
}

function App() {
  return (
    <Router>
      <Layout />
    </Router>
  );
}

export default App;
