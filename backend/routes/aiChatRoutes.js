import express from "express";
import { callDeepSeekAPI, getChatHistory, getUserConversations } from "../controllers/aiController.js";
import { fileUpload } from "../middleware/uploadMiddleware.js";
import { userAuthenticate } from "../middleware/authenticationMiddleware.js";


const aiChatRouter = express.Router();

// Define your AI chat routes here

aiChatRouter.post("/chat", userAuthenticate, fileUpload.single('file'), callDeepSeekAPI)
aiChatRouter.get("/chat", userAuthenticate, getUserConversations)
aiChatRouter.get("/chat/:chatId", userAuthenticate, getChatHistory)

export default aiChatRouter;