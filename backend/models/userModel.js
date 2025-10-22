import mongoose from "mongoose";
import validator from "validator";


const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      trim: true,
    },
    userName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      validate: {
        validator: validator.isEmail,
        message: "Invalid email format",
      },
    },
    password: {
      type: String,
      required: true,
      minlength: 8,
    },
    profilePhoto: {
      publicId: { type: String },
      url: { type: String }
    },
    gender: {
      type: String,
      enum: ["male", "female"],
    }
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

export default User;
