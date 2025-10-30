import Message from "../models/messageModel.js";

const chatSocket = (io) => {
    io.on('connection', (socket) => {
        console.log(`User connected: ${socket.id}`);

        socket.on('joinRoom', (roomId) => {
            socket.join(roomId);
            console.log(`User joined room ${roomId}`);
        });

        socket.on("sendMessage", async (data) => {
            const { chatroomId, senderId, content, fileUrl, fileType } = data;

            const message = await Message.create({
                chatroom: chatroomId,
                sender: senderId,
                content,
                fileUrl,
                fileType,
            });

            // Emit the message to all clients in the chatroom
            io.to(chatroomId).emit('receiveMessage', message);
        });

        socket.on('disconnect', () => {
            console.log(`User disconnected: ${socket.id}`);
        });
    });
};

export default chatSocket;
