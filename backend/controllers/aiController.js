import axios from 'axios'

const DEEPSEEK_URL = process.env.DEEPSEEK_API_URL;
const API_KEY = process.env.DEEPSEEK_API_KEY;

// Store conversation context
const conversationContext = new Map();

const handleAIChat = async (req, res) => {
    try {
        const { message, sessionId = 'default', action = 'auto' } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Initialize or get conversation context
        if (!conversationContext.has(sessionId)) {
            conversationContext.set(sessionId, {
                originalText: '',
                conversation: [],
                hasSummary: false
            });
        }

        const context = conversationContext.get(sessionId);

        // Determine user intent and craft appropriate prompt
        const prompt = await craftIntelligentPrompt(message, context, action);

        // Call DeepSeek API
        const response = await callDeepSeekAPI(prompt);

        // Update conversation context
        context.conversation.push(
            { role: 'user', content: message },
            { role: 'assistant', content: response }
        );

        // If this looks like initial content, store it as original text
        if (!context.hasSummary && isLikelyContentSubmission(message)) {
            context.originalText = message;
            context.hasSummary = true;
        }

        res.json({
            success: true,
            response: response,
            sessionId: sessionId,
            hasContext: context.hasSummary
        });

    } catch (error) {
        console.error('AI Chat Error:', error);
        res.status(500).json({
            error: 'Failed to process request',
            details: error.message
        });
    }
};

// Intelligent prompt crafting based on user input
const craftIntelligentPrompt = async (message, context, action) => {
    // If no context exists yet and message is long, assume it's content to summarize
    if (!context.hasSummary && message.length > 200) {
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

    // Fallback: general AI response
    return `The user says: "${message}". Please provide a helpful, engaging response. 
If appropriate, you can offer to analyze content they paste, answer questions, or suggest learning resources.`;
};

// Helper functions
const isQuestion = (text) => {
    const questionWords = ['what', 'how', 'why', 'when', 'where', 'who', 'explain', 'tell me about', '?'];
    return questionWords.some(word => text.toLowerCase().includes(word));
};

const isLikelyContentSubmission = (text) => {
    return text.length > 100 || text.includes('\n') || text.includes('http');
};

const callDeepSeekAPI = async (prompt) => {
    const response = await axios.post(
        DEEPSEEK_URL,
        {
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 2000
        },
        {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            }
        }
    );

    return response.data.choices[0].message.content;
};

// Clear context endpoint (optional)
const clearContext = (req, res) => {
    const { sessionId = 'default' } = req.body;
    conversationContext.delete(sessionId);
    res.json({ success: true, message: 'Conversation context cleared' });
};

module.exports = {
    handleAIChat,
    clearContext
};