const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "secretkey123";

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Access denied. No token." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // contains { id }
    next();
  } catch (err) {
    return res.status(400).json({ message: "Invalid token." });
  }
};

module.exports = authMiddleware;