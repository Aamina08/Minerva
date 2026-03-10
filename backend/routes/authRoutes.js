const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "secretkey123";

//////////////////////////////////////////////////
// HELPERS
//////////////////////////////////////////////////

const escapeRegex = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeEmail = (value) =>
  (value || "").trim().toLowerCase();

//////////////////////////////////////////////////
// REGISTER
//////////////////////////////////////////////////

router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const safeName = (name || "").trim();
    const safeEmail = normalizeEmail(email);

    if (!safeName || !safeEmail || !password) {
      return res
        .status(400)
        .json({ message: "Name, email, and password are required" });
    }

    const existingUser = await User.findOne({
      email: { $regex: `^${escapeRegex(safeEmail)}$`, $options: "i" },
    });

    if (existingUser) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      name: safeName,
      email: safeEmail,
      password: hashedPassword,
    });

    await user.save();

    res.json({ message: "User registered successfully" });

  } catch (error) {
    res.status(500).json({ message: "Failed to register user" });
  }
});

//////////////////////////////////////////////////
// LOGIN
//////////////////////////////////////////////////

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const safeEmail = normalizeEmail(email);

    if (!safeEmail || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const user = await User.findOne({
      email: { $regex: `^${escapeRegex(safeEmail)}$`, $options: "i" },
    });

    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    const storedPassword = String(user.password || "");
    const looksHashed = /^\$2[aby]\$\d{2}\$/.test(storedPassword);
    const isMatch = looksHashed
      ? await bcrypt.compare(password, storedPassword)
      : password === storedPassword;

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid password" });
    }

    // Migrate legacy plaintext password records after successful login.
    if (!looksHashed) {
      user.password = await bcrypt.hash(password, 10);
      await user.save();
    }

    const token = jwt.sign(
      { id: user._id },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
      },
    });

  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ message: "Login failed" });
  }
});

module.exports = router;
