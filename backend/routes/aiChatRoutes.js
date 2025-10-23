import express from "express";
import { callDeepSeekAPI, getChatHistory, getUserConversations } from "../controllers/aiController";


const aiChatRouter = express.Router();

// Define your AI chat routes here

aiChatRouter.post("/chat", callDeepSeekAPI)
aiChatRouter.get("/chat", getUserConversations)
aiChatRouter.get("/chat/:chatId", getChatHistory)

export default aiChatRouter;