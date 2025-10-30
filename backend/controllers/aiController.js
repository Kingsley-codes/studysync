import axios from 'axios'
import { Conversation } from '../models/aiChatModel.js';
import { ragService } from '../utils/ragService.js';
import * as pdf from 'pdf-parse';
import mongoose from 'mongoose';


const DEEPSEEK_URL = process.env.DEEPSEEK_API_URL;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY; // Add this line


// ✅ Helper function to extract text from PDF buffer
const extractTextFromPDF = async (pdfBuffer) => {
    try {
        const data = await pdf.default(pdfBuffer); // Note the `.default`
        return data.text;
    } catch (error) {
        console.error('PDF extraction error:', error);
        throw new Error('Failed to extract text from PDF');
    }
};


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


// ✅ Enhanced prompt crafting with RAG
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
        // Store the content in Pinecone for future reference (non-blocking)
        ragService.storeConversationChunks(
            context._id.toString(),
            message,
            { type: 'original_content' }
        ).catch(console.error);

        return `Please analyze and summarize the following content. Provide a comprehensive summary with:
    
            📌 MAIN SUMMARY: 2-5 sentence overview
            🎯 KEY POINTS: Bullet points of important concepts
            💡 CORE CONCEPTS: Fundamental ideas to understand
            🔍 DEEPER INSIGHTS: Interesting observations

        Content to analyze:
        ${message}

        After your analysis, invite the user to ask follow-up questions or request related resources.`;
    }

    // If we have context and user asks a question - USE RAG
    if (context.hasSummary && (isQuestion(message) || action === 'followup')) {
        // Search for relevant context from Pinecone
        const relevantContext = await ragService.searchRelevantContext(
            message,
            context._id.toString(),
            3
        );

        // Also search external knowledge for broader context
        const externalContext = await ragService.searchExternalResources(message, 2);

        let externalContextText = '';
        if (externalContext.length > 0) {
            externalContextText = `\n\nEXTERNAL KNOWLEDGE:\n${externalContext.map(ec => `• ${ec.content} (Source: ${ec.source})`).join('\n')}`;
        }

        return `Based on the original content, conversation history, and relevant knowledge, please answer the user's question.

        ORIGINAL CONTEXT:
        ${context.originalText.substring(0, 1000)}...

        RELEVANT RETRIEVED CONTEXT:
        ${relevantContext || "No specific relevant context found."}
        ${externalContextText}

        CONVERSATION HISTORY:
        ${context.conversation.slice(-4).map(msg => `${msg.role.toUpperCase()}: ${msg.content}`).join('\n')}

        USER'S CURRENT QUESTION: ${message}

        Please provide a helpful, detailed answer. Reference the retrieved context when relevant. 
        If the context doesn't fully answer the question, acknowledge this and provide the best answer you can based on general knowledge.`;
    }

    // If user asks for resources specifically - USE RAG
    if (message.toLowerCase().includes('resource') || message.toLowerCase().includes('learn more') || action === 'resources') {
        const sourceText = context.originalText || message;
        const topic = extractTopic(message, sourceText);

        // Search for relevant external resources
        const externalResources = await ragService.searchExternalResources(topic, 5);

        let resourcesContext = '';
        if (externalResources.length > 0) {
            resourcesContext = `\n\nRETRIEVED RESOURCES:\n${externalResources.map(resource =>
                `• ${resource.content} - ${resource.source} (Relevance: ${(resource.score * 100).toFixed(1)}%)`
            ).join('\n')}`;
        }

        return `The user wants learning resources about "${topic}". 

        ORIGINAL CONTEXT:
        ${sourceText.substring(0, 800)}...
        ${resourcesContext}

        ${externalResources.length > 0 ?
                `Please present these specific, verified resources in a helpful, organized way. Explain why each resource is relevant and how it can help the user.` :
                `Since no specific resources were found in our knowledge base, please suggest 3-5 high-quality online resources for further learning. For each resource include:
            • 📚 Type (Article, Video, Course, Research Paper, etc.)
            • 🎯 Why it's relevant
            • ⏱️ Estimated time commitment
            • 🔗 Suggested search terms to find it`
            }`;
    }

    // For general questions without context - USE RAG
    if (isQuestion(message) && !context.hasSummary) {
        const relevantKnowledge = await ragService.searchExternalResources(message, 3);

        let knowledgeContext = '';
        if (relevantKnowledge.length > 0) {
            knowledgeContext = `\n\nRELEVANT KNOWLEDGE:\n${relevantKnowledge.map(k => `• ${k.content} (Source: ${k.source})`).join('\n')}`;
        }

        return `Answer the user's question: "${message}"
        ${knowledgeContext}

        CONVERSATION HISTORY (if any):
        ${context.conversation.slice(-3).map(msg => `${msg.role.toUpperCase()}: ${msg.content}`).join('\n')}

        Please provide a comprehensive, accurate answer. Use the retrieved knowledge when relevant, and supplement with your general knowledge.`;
    }

    // Default: general conversation with context awareness
    if (context.hasSummary) {
        return `Continue the conversation with the user. You have this context available:

        ORIGINAL CONTEXT:
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

// Helper function to extract topic from message
const extractTopic = (message, context) => {
    // Simple topic extraction
    const questionWords = ['what', 'how', 'why', 'when', 'where', 'who', 'explain', 'tell me about'];
    const words = message.toLowerCase().split(' ');

    for (let i = 0; i < words.length; i++) {
        if (questionWords.includes(words[i]) && i + 1 < words.length) {
            return words.slice(i + 1).join(' ').replace('?', '');
        }
    }

    // If no question word found, use first few meaningful words
    return message.split(' ').slice(0, 5).join(' ').replace('?', '');
};

// Enhanced handleAIChat function with RAG storage
export const handleAIChat = async (req, res) => {
    try {
        const userID = req.user;
        console.log(userID);

        if (!userID) return res.status(403).json({
            success: false,
            message: "You are Unauthorized"
        });

        // ✅ Handle both JSON and FormData
        let { message, action = 'auto', chatId } = req.body;
        const file = req.file; // From multer middleware

        // ✅ If file is uploaded, extract text from PDF
        let extractedText = '';
        if (file) {
            if (file.mimetype === 'application/pdf') {
                extractedText = await extractTextFromPDF(file.buffer);
                // Use extracted text as the message
                message = extractedText;
            } else {
                return res.status(400).json({ error: 'Only PDF files are supported' });
            }
        }

        if (!message && !file) {
            return res.status(400).json({ error: 'Message or file is required' });
        }

        // ✅ Enable Server-Sent Events (streaming)
        // res.setHeader("Content-Type", "text/event-stream");
        // res.setHeader("Cache-Control", "no-cache");
        // res.setHeader("Connection", "keep-alive");
        // res.flushHeaders();

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

            // ✅ Store in Pinecone for RAG (non-blocking)
            ragService.storeConversationChunks(
                context._id.toString(),
                message,
                { type: 'original_content', userID: userID.toString() }
            ).catch(error => {
                console.error('Failed to store in Pinecone:', error);
            });

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

        // ✅ Generate advanced prompt with RAG
        const finalPrompt = await craftIntelligentPrompt(message, context, action);
        history.push({ role: "user", content: finalPrompt });

        // ✅ STREAM Ai Response
        // let fullResponse = "";
        // await callDeepSeekAPI(history, (token) => {
        //     fullResponse += token;
        //     res.write(`data: ${token}\n\n`);
        // });

        // ✅ Ensure history only contains plain strings. only needed for non-streaming
        const safeHistory = history.map(msg => ({
            role: String(msg.role),
            content: String(msg.content)
        }));

        // Call DeepSeek API without streaming
        const fullResponse = await callDeepSeekAPI(safeHistory);


        // ✅ Save to DB after stream ends
        context.conversation.push(
            { role: "user", content: message },
            { role: "assistant", content: fullResponse }
        );
        await context.save();

        // ✅ Store the assistant's response in Pinecone for future context (non-blocking)
        if (context.hasSummary && fullResponse.length > 50) {
            ragService.storeConversationChunks(
                context._id.toString(),
                fullResponse,
                { type: 'assistant_response', userID: userID.toString() }
            ).catch(console.error);
        }

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