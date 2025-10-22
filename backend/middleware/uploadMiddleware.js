import multer from 'multer';
import fs from "fs";


// SETUP: Ensure upload folder exists
const uploadDir = "uploads/";
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}


// ALLOWED MIME TYPES
const allowedMimeTypes = ["image/jpeg", "image/png", "image/jpg", "image/webp"];


// COMMON FILE FILTER
const fileFilter = (req, file, cb) => {
    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error("Invalid file type. Only JPG, PNG, JPEG, and WEBP images are allowed."), false);
    }
};


// COMMON STORAGE ENGINE
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const safeName = file.originalname
            .toLowerCase()
            .replace(/\s+/g, "-")
            .replace(/[^a-z0-9.-]/g, "");
        cb(null, `${uniqueSuffix}-${safeName}`);
    },
});


// Simple multer configuration
export const upload = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter,
});

export const uploadServiceImages = upload.fields([
    { name: 'image1', maxCount: 1 },
    { name: 'image2', maxCount: 1 },
    { name: 'image3', maxCount: 1 },
    { name: 'driverPhoto', maxCount: 1 }
]);

export const uploadDriverImages = upload.fields([
    { name: "passport", maxCount: 1 },
    { name: "license", maxCount: 1 },
    { name: "address", maxCount: 1 },
]);




