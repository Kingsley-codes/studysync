import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import 'dotenv/config';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import chatSocket from './socket/chatSocket.js';
import userRouter from './backend/routes/userAuthRoutes.js';


dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: process.env.FRONTEND_URL,
        credentials: true,
    },
});

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

// Use separate file for socket events
chatSocket(io);

// ✅ Middlewares (before routes)
app.use(cors({
    origin: process.env.FRONTEND_URL,
    credentials: true
}));
app.use(express.json({ limit: '10mb' })); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded form data
app.use(passport.initialize());


// ✅ MongoDB Connection
try {
    await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log("✅ MongoDB Connected");
} catch (error) {
    console.error("❌ MongoDB Connection Error:", error);
    process.exit(1);
}

// Basic route for testing
app.get('/', (req, res) => {
    res.json({
        status: "success",
        message: "Welcome to StudySync API"
    });
});

// Routes
app.use('/api/auth', userRouter);
app.use('/api/ai', userRouter);


// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        status: "error",
        message: "Internal server error"
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
