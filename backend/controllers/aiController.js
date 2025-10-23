import axios from 'axios'
import { Conversation } from '../models/aiChatModel';

const DEEPSEEK_URL = process.env.DEEPSEEK_API_URL;


// ✅ Enhanced helper function to detect pleasantries
const isPleasantry = (text) => {
    const pleasantries = [
        'hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening',
        'how are you', 'how do you do', 'nice to meet you', 'greetings',
        'thanks', 'thank you', 'appreciate it', 'thanks a lot',
        'bye', 'goodbye', 'see you', 'farewell', 'have a good day'
    ];

    const cleanText = text.toLowerCase().trim();
    return pleasantries.some(pleasantry => cleanText.includes(pleasantry));
};

// ✅ Enhanced prompt crafting
const craftIntelligentPrompt = async (message, context, action) => {
    // ✅ Handle pleasantries first
    if (isPleasantry(message)) {
        return `The user said: "${message}". 
        
        Please respond naturally and warmly to this greeting or pleasantry. Keep it friendly, engaging, and appropriate for the context. 
        If this is the start of a conversation, briefly introduce yourself as a helpful AI assistant and invite them to share what they'd like help with.
        
        Be conversational and human-like in your response.`;
    }

    // If no context exists yet and message is long, assume it's content to summarize
    if (!context.hasSummary && message.length > 200 && !isPleasantry(message)) {
        return `Please analyze and summarize the following content. Provide a comprehensive summary with:
    
            📌 MAIN SUMMARY: 2-5 sentence overview
            🎯 KEY POINTS: Bullet points of important concepts
            💡 CORE CONCEPTS: Fundamental ideas to understand
            🔍 DEEPER INSIGHTS: Interesting observations

        Content to analyze:
        ${message}

        After your analysis, invite the user to ask follow-up questions or request related resources.`;
    }

    // If we have context and user asks a question
    if (context.hasSummary && (isQuestion(message) || action === 'followup')) {
        return `Based on the original content and conversation history, please answer the user's question.

        ORIGINAL CONTEXT:
        ${context.originalText.substring(0, 1500)}...

        CONVERSATION HISTORY:
        ${context.conversation.slice(-4).map(msg => `${msg.role.toUpperCase()}: ${msg.content}`).join('\n')}

        USER'S CURRENT QUESTION: ${message}

        Please provide a helpful, detailed answer. If you need to reference the original content, do so clearly. If the question goes beyond the available context, acknowledge this and provide the best answer you can.`;
    }

    // If user asks for resources specifically
    if (message.toLowerCase().includes('resource') || message.toLowerCase().includes('learn more') || action === 'resources') {
        const sourceText = context.originalText || message;
        return `The user wants learning resources. Based on this content:
            
        ${sourceText.substring(0, 1000)}

        Please suggest 3-5 high-quality online resources for further learning. For each resource include:
        • 📚 Type (Article, Video, Course, Research Paper, etc.)
        • 🎯 Why it's relevant
        • ⏱️ Estimated time commitment
        • 🔗 Suggested search terms to find it

        Format this as a helpful, organized list.`;
    }

    // Default: general conversation with context awareness
    if (context.hasSummary) {
        return `Continue the conversation with the user. You have this context available:

        ORIGINAL CONTENT SUMMARY:
        ${context.originalText.substring(0, 1000)}...

        RECENT CONVERSATION:
        ${context.conversation.slice(-4).map(msg => `${msg.role.toUpperCase()}: ${msg.content}`).join('\n')}

        USER'S MESSAGE: ${message}

        Respond helpfully and naturally. Reference previous context when relevant.`;
    }

    // Fallback: general AI response for casual conversation
    return `The user says: "${message}". 
    
    Please provide a helpful, engaging, and conversational response. 
    Be friendly and natural in your tone. If they're starting a general conversation, respond appropriately and ask how you can help them today.`;
};

// ✅ Enhanced content submission detection
const isLikelyContentSubmission = (text) => {
    // Don't mark pleasantries as content submissions
    if (isPleasantry(text)) return false;

    return text.length > 200 ||
        (text.includes('\n') && text.length > 50) ||
        text.includes('http') ||
        text.toLowerCase().includes('summarize') ||
        text.toLowerCase().includes('analyze');
};

// ✅ Helper function to generate conversation title
const generateConversationTitle = async (firstMessage) => {
    // For very short messages or questions, create a descriptive title
    if (firstMessage.length < 50 || firstMessage.endsWith('?')) {
        const truncated = firstMessage.substring(0, 30);
        return `${truncated}${firstMessage.length > 30 ? '...' : ''}`;
    }

    // For longer content, extract first few meaningful words
    const words = firstMessage.split(' ').slice(0, 5).join(' ');
    return `${words}...`;
};

// ✅ Helper function to generate title for content-based conversations
const generateContentBasedTitle = async (content) => {
    // Extract first sentence or first 40 characters as title
    const firstSentence = content.split('.')[0];
    if (firstSentence.length > 20 && firstSentence.length < 60) {
        return firstSentence;
    }

    // Fallback: first 40 characters
    return content.substring(0, 40) + (content.length > 40 ? '...' : '');
};


// Helper functions
const isQuestion = (text) => {
    const questionWords = ['what', 'how', 'why', 'when', 'where', 'who', 'explain', 'tell me about', '?'];
    return questionWords.some(word => text.toLowerCase().includes(word));
};


export const handleAIChat = async (req, res) => {
    try {
        const userID = req.user;
        if (!userID) return res.status(403).json({
            success: false,
            message: "You are Unauthorized"
        });

        const { message, action = 'auto', chatId } = req.body;
        if (!message) return res.status(400).json({
            error: 'Message is required'
        });

        // ✅ Enable Server-Sent Events (streaming)
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders();

        // ✅ Get or create conversation
        let context = await Conversation.findOne({ _id: chatId, userID });
        let isNewConversation = false;

        if (!context) {
            // ✅ Generate title for new conversation
            const conversationTitle = await generateConversationTitle(message);

            context = await Conversation.create({
                userID,
                originalText: "",
                conversation: [],
                hasSummary: false,
                title: conversationTitle
            });
            isNewConversation = true;
        }

        // ✅ Track first content for summary logic
        if (!context.hasSummary && isLikelyContentSubmission(message)) {
            context.originalText = message;
            context.hasSummary = true;

            // ✅ Update title if it's a content-based conversation
            if (isNewConversation) {
                context.title = await generateContentBasedTitle(message);
            }

            await context.save();
        }

        // ✅ Build conversation history (last 10 messages)
        let history = context.conversation.slice(-10)
            .map(msg => ({
                role: msg.role,
                content: msg.content
            }));

        // ✅ Generate advanced prompt
        const finalPrompt = await craftIntelligentPrompt(message, context, action);
        history.push({ role: "user", content: finalPrompt });

        // ✅ STREAM Ai Response
        let fullResponse = "";
        await callDeepSeekAPI(history, (token) => {
            fullResponse += token;
            res.write(`data: ${token}\n\n`);  // <-- Sends token to frontend in real time
        });

        // ✅ Save to DB after stream ends
        context.conversation.push(
            { role: "user", content: message },
            { role: "assistant", content: fullResponse }
        );
        await context.save();

        // ✅ Send conversation metadata for new conversations
        if (isNewConversation) {
            res.write(`data: [CONVERSATION_CREATED]${JSON.stringify({
                chatId: context._id,
                title: context.title
            })}\n\n`);
        }

        res.write(`data: [DONE]\n\n`);
        res.end();

    } catch (error) {
        console.error("AI Chat Error:", error);
        if (!res.headersSent) {
            res.status(500).json({ error: "Failed to process request", details: error.message });
        }
    }
};


export const callDeepSeekAPI = async (messages, onToken) => {
    const response = await axios({
        method: 'POST',
        url: DEEPSEEK_URL,
        data: {
            model: 'deepseek-chat',
            messages,
            temperature: 0.7,
            max_tokens: 2000,
            stream: true,
        },
        headers: {
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json',
        },
        responseType: 'stream'
    });

    return new Promise((resolve, reject) => {
        let fullResponse = "";

        response.data.on('data', (chunk) => {
            const lines = chunk.toString().split('\n').filter(line => line.trim());
            for (const line of lines) {
                if (!line.startsWith("data:")) continue;

                const data = line.replace("data:", "").trim();
                if (data === "[DONE]") {
                    return resolve(fullResponse);
                }

                try {
                    const json = JSON.parse(data);
                    const token = json?.choices?.[0]?.delta?.content;
                    if (token) {
                        fullResponse += token;
                        if (onToken) onToken(token); // ✅ Stream token to caller
                    }
                } catch (err) {
                    console.error("Streaming JSON parse error:", err);
                }
            }
        });

        response.data.on('end', () => resolve(fullResponse));
        response.data.on('error', (err) => reject(err));
    });
};


export const getUserConversations = async (req, res) => {
    try {
        const userID = req.user;
        const page = parseInt(req.query.page) || 1;
        const limit = 10; // Fixed batch size of 10

        // Validate userID
        if (!userID) {
            return res.status(400).json({
                status: "error",
                message: "Valid user ID is required"
            });
        }

        const skip = (page - 1) * limit;

        // Fetch conversations with pagination
        const conversations = await Conversation.find({ userID })
            .select('title _id createdAt') // Only return title, id, and createdAt
            .sort({ createdAt: -1 }) // Sort by latest first
            .skip(skip)
            .limit(limit);

        // Get total count for pagination info
        const totalConversations = await Conversation.countDocuments({ userID });

        res.status(200).json({
            status: "success",
            data: conversations.map(conv => ({
                chatId: conv._id,
                title: conv.title,
                createdAt: conv.createdAt
            })),
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(totalConversations / limit),
                totalConversations,
                hasNext: page < Math.ceil(totalConversations / limit),
                hasPrev: page > 1
            }
        });

    } catch (err) {
        res.status(500).json({
            status: "error",
            message: err.message
        });
    }
};


export const getChatHistory = async (req, res) => {
    try {
        const { chatId } = req.params;
        const userID = req.user;

        // Validate chatId
        if (!chatId || !mongoose.Types.ObjectId.isValid(chatId)) {
            return res.status(400).json({
                success: false,
                message: "Valid chat ID is required"
            });
        }

        if (!userID) {
            return res.status(403).json({
                success: false,
                message: "You are Unauthorized"
            });
        }

        // Find conversation by both userID and chatId
        const conversation = await Conversation.findOne({
            _id: chatId,
            userID: userID
        });

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: "Conversation not found"
            });
        }

        res.status(200).json({
            success: true,
            data: {
                chatId: conversation._id,
                title: conversation.title,
                originalText: conversation.originalText,
                hasSummary: conversation.hasSummary,
                createdAt: conversation.createdAt,
                updatedAt: conversation.updatedAt,
                conversation: conversation.conversation
            }
        });

    } catch (error) {
        console.error("Get Chat History Error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch chat history",
            error: error.message
        });
    }
};