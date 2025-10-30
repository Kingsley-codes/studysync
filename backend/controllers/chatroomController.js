import crypto from "crypto";
import User from "../models/userModel.js";
import Chatroom from "../models/chatroomModel.js";
import { v2 as cloudinary } from "cloudinary";


cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const createChatroom = async (req, res) => {
    const { name } = req.body;
    const userId = req.user;

    if (!userId) {
        return res.status(403).json({
            success: false,
            message: "You are Unauthorized",
        });
    }

    const token = crypto.randomBytes(6).toString("hex");
    const chatroom = await Chatroom.create({
        name,
        creator: userId,
        members: [userId],
        inviteLink: token,
    });

    await User.findByIdAndUpdate(userId, { $push: { chatrooms: chatroom._id } });
    res.json(chatroom);
};

export const joinChatroom = async (req, res) => {
    const { token } = req.params;
    const userId = req.user;

    if (!userId) {
        return res.status(403).json({
            success: false,
            message: "You are Unauthorized",
        });
    }

    const chatroom = await Chatroom.findOne({ inviteLink: token });
    if (!chatroom) return res.status(404).json({ message: "Chatroom not found" });

    if (!chatroom.members.includes(userId)) {
        chatroom.members.push(userId);
        await chatroom.save();
    }

    await User.findByIdAndUpdate(userId, { $addToSet: { chatrooms: chatroom._id } });
    res.json(chatroom);
};

export const getUserChatrooms = async (req, res) => {
    const userId = req.user;
    if (!userId) {
        return res.status(403).json({
            success: false,
            message: "You are Unauthorized",
        });
    }
    const user = await User.findById(userId).populate("chatrooms");
    res.json(user.chatrooms);
};


export const uploadFile = async (req, res) => {
    try {
        const result = await cloudinary.uploader.upload_stream(
            { resource_type: "auto" },
            (error, result) => {
                if (error) return res.status(500).json(error);
                res.json({ url: result.secure_url });
            }
        );
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
