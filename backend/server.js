const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const { Server } = require("socket.io");

const authRoutes = require("./routes/authRoutes");
const chatbotRoutes = require("./routes/chatbotRoutes");
const studyGroupRoutes = require("./routes/studyGroupRoutes");
const { setupStudyGroupSocket } = require("./sockets/studyGroupSocket");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json({ limit: "12mb" }));

//////////////////////////////////////////////////
// DATABASE
//////////////////////////////////////////////////

mongoose
  .connect("mongodb://127.0.0.1:27017/assistant_app")
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log(err));

//////////////////////////////////////////////////
// ROUTES
//////////////////////////////////////////////////

app.use("/api/auth", authRoutes);
app.use("/api/chat", chatbotRoutes);
app.use("/api/study-groups", studyGroupRoutes);

app.get("/", (req, res) => {
  res.send("AI Assistant Backend Running");
});

//////////////////////////////////////////////////
// START SERVER
//////////////////////////////////////////////////

setupStudyGroupSocket(io);

server.listen(5000, () => {
  console.log("Server running on port 5000");
});
