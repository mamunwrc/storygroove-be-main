import User from "../models/user.js";
import ResetToken from "../models/token.js";
import StatusCodes from "http-status-codes";
import BadRequestError from "../errors/bad-request.js";
import bcrypt from "bcryptjs";
import sendEmail, { EmailDeliveryError, sendVerificationEmail } from "../utils/mailGun.js";
import crypto from "crypto";

import path from "path";
import fs from "fs";
import Image from "../models/image.js";
import * as StripeService from "../service/stripeService.js";

import jwt from "jsonwebtoken";
import { encrypt } from "../utils/keyEcryption.js";
import axios from "axios";
import { deleteFromS3 } from "../service/s3Service.js";
import { queueActivityLog } from "../utils/queueActivityLog.js";

const appDir = path.resolve(path.dirname(""));

/** Verification links are one-shot emails, so they need a window measured in hours. */
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export const getAllUsers = async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 10;
  const skip = (page - 1) * limit;
  const regex = req.query.search
    ? { email: { $regex: req.query.search, $options: "i" } }
    : {};

  // // Find users with pagination and sort by createdAt and search by partial email. get users total prompts count. sort by createdAt, status and prompts count
  const usersWithPrompts = await User.aggregate([
    { $match: { ...regex, role: { $ne: "superadmin" } } },
    {
      $lookup: {
        from: "prompts",
        let: { userid: "$_id" },
        pipeline: [{ $match: { $expr: { $eq: ["$userid", "$$userid"] } } }],
        as: "prompts",
      },
    },
    {
      $project: {
        companyId: 1,
        currentusertokens: 1,
        maxusertokens: 1,
        _id: 1,
        email: 1,
        fname: 1,
        lname: 1,
        role: 1,
        status: 1,
        createdAt: 1,
        updatedAt: 1,
        prompts: 1,
        username: 1,
        __v: 1,
        promptsCount: { $size: "$prompts" },
      },
    },
    { $sort: { promptsCount: -1 } },
    { $skip: skip },
    { $limit: limit },
  ]);

  // console.log(usersWithPrompts);

  let users = await User.find({ ...regex, role: { $ne: "superadmin" } })
    .select("-password")
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip(skip);

  // Get total count of documents matching the query
  const count = await User.countDocuments({
    ...regex,
    role: { $ne: "superadmin" },
  });

  res
    .status(StatusCodes.OK)
    .json({ user: usersWithPrompts, nbhits: count, page });
};

export const getSingleUser = async (req, res) => {
  const { _id: userId } = req.user;
  const user = await User.findOne({ _id: userId });
  if (!user) {
    throw new BadRequestError(`no user found with id ${userId}`);
  }
  res.status(StatusCodes.OK).json({ ...user._doc, password: undefined });
};

export const UpdateUser = async (req, res) => {
  const {
    params: { id: userId },
    body: { fname, lname, email, status, role, password },
  } = req;

  if (!fname || !lname || !email || !status || !role || !password) {
    throw new BadRequestError("Please provide the required fields");
  }

  const user = await User.findOne({ _id: userId });
  if (!user) {
    throw new BadRequestError(`No user found with id ${userId}`);
  }
  console.log("user is");

  user.fname = fname;
  user.lname = lname;
  user.email = email;
  user.status = status;
  user.role = role;
  user.password = password;

  await user.save();

  const token = await user.createJWT();
  queueActivityLog({
    req,
    userId: req.user._id,
    action: "update",
    module: "user",
    description: `Admin updated user ${userId}`,
    metadata: { targetUserId: String(userId) },
  });
  res.status(StatusCodes.OK).json({ user, token: token });
};

export const UpdateUserStatus = async (req, res) => {
  const {
    params: { id: userId },
    body: { id: adminId, status },
  } = req.user;

  if (!status) {
    throw new BadRequestError("Please specify the status");
  }
  const user = await User.findOne({ _id: adminId });
  if (!user) {
    throw new BadRequestError(`No user found with UserId ${adminId}`);
  }
  // checkUserRole(req.user, user.role);
  if (user.role === "superadmin" || user.role === "admin") {
    let appuser = await User.findOne({ _id: userId });
    if (!appuser) {
      throw new BadRequestError(`No user found with UserId ${userId}`);
    }
    appuser.status = status;
    await appuser.save();

    // res.status(StatusCodes.OK).json({ user });
    if (status === "active") {
      try {
        await sendEmail(
          appuser.email,
          "Account Approved",
          { name: appuser.fname, email: appuser.email },
          "../utils/template/userSignupApprove.handlebars",
          false
        );
      } catch (emailErr) {
        console.error("Account approval email failed:", emailErr);
      }
    }
    queueActivityLog({
      req,
      userId: req.user._id,
      action: "update",
      module: "user",
      description: `User status set to ${status}`,
      metadata: { targetUserId: String(userId), status },
    });
    res.status(StatusCodes.OK).json({ message: "updated user status" });
  } else {
    res
      .status(StatusCodes.UNAUTHORIZED)
      .json({ message: "You are not authorized to update user status" });
  }
};



export const UpdateUserPassword = async (req, res) => {
  try {
    const {
      body: { email },
    } = req;

    const user = await User.findOne({ email });
    if (!user) {
      return res
        .status(StatusCodes.OK)
        .json({ msg: "If an account with that email exists, a reset link has been sent." });
    }

    const EMAIL_COOLDOWN_MS = 60 * 1000;
    if (
      user.passwordResetRequestedAt &&
      Date.now() - user.passwordResetRequestedAt.getTime() < EMAIL_COOLDOWN_MS
    ) {
      return res
        .status(StatusCodes.OK)
        .json({ msg: "If an account with that email exists, a reset link has been sent." });
    }

    await User.updateOne(
      { _id: user._id },
      { $set: { passwordResetRequestedAt: new Date() } }
    );

    let token = await ResetToken.findOne({ userId: user._id });
    if (token) await token.deleteOne();
    let resetToken = crypto.randomBytes(32).toString("hex");
    const hash = bcrypt.hashSync(resetToken, 10);
    await new ResetToken({
      userId: user._id,
      token: hash,
      createdAt: Date.now(),
    }).save();
    const clientUrl = process.env.CLIENT_URL;
    const link = `${clientUrl}/passwordReset/${resetToken}/${user._id}`;
    try {
      await sendEmail(
        user.email,
        "Password Reset Request",
        { name: user.fname, link: link },
        "../utils/template/requestResetPassword.handlebars",
        false
      );
    } catch (emailErr) {
      console.error("Password reset email failed:", emailErr);
      return res.status(StatusCodes.SERVICE_UNAVAILABLE).json({
        msg: "We could not send the reset email. Please try again in a few minutes.",
      });
    }
    queueActivityLog({
      req,
      userId: user._id,
      action: "update",
      module: "user",
      description: "Password reset email requested",
      metadata: {},
    });
    return res.status(StatusCodes.OK).json({ msg: "If an account with that email exists, a reset link has been sent." });
  } catch (err) {
    console.error("UpdateUserPassword error:", err);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "An error occurred while processing the password reset request" });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const {
      body: { userId, token, password },
    } = req;
    let passwordResetToken = await ResetToken.findOne({ userId });

    if (!passwordResetToken) {
      return res.status(400).json({ message: "Invalid or expired password reset token" });
    }
    const data = token;
    const pass = passwordResetToken.token;
    const isValid = await bcrypt.compare(data, pass);
    if (!isValid) {
      return res.status(400).json({ message: "Invalid or expired password reset token" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(400).json({ message: "Invalid or expired password reset token" });
    }

    // Consuming a reset link proves the mailbox belongs to the user, so it counts as
    // email verification. Checkout signups otherwise end up with a working password on
    // an account that stays inactive and can never be verified.
    const shouldActivate = user.status === "inactive";

    const hash = await bcrypt.hash(password, 10);
    await User.updateOne(
      { _id: userId },
      {
        $set: {
          password: hash,
          passwordSetupRequired: false,
          ...(shouldActivate ? { status: "active" } : {}),
        },
        $unset: { verificationToken: "" },
      }
    );

    await passwordResetToken.deleteOne();

    queueActivityLog({
      req,
      userId,
      action: "update",
      module: "user",
      description: shouldActivate
        ? "Password reset completed via token; account activated"
        : "Password reset completed via token",
      metadata: {},
    });
    return res.status(StatusCodes.OK).json({ msg: "Password Reset Successfully" });
  } catch (err) {
    console.error("resetPassword error:", err);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "An error occurred while resetting the password" });
  }
};



// Get Current User Tokens
export const getUserTokens = async (req, res) => {
  const { id } = req.params;
  const user = await User.findOne({ _id: id });
  if (user) {
    const tokens = user.currentusertokens;
    res.status(StatusCodes.OK).json({ tokens });
  } else {
    res.status(StatusCodes.BAD_REQUEST).json({ message: "User not found" });
  }
};

export const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findOne({ _id: req.user._id });

  if (user) {
    if (user.signupType !== "register") {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: `You are not allowed to change password as you logged in through ${user.signupType}`,
      });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      res
        .status(StatusCodes.BAD_REQUEST)
        .send({ message: "Incorrect Password" });
    } else {
      const hash = await bcrypt.hash(newPassword, 10);
      await User.updateOne(
        { _id: req.user._id },
        { $set: { password: hash } },
        { new: true }
      );
      queueActivityLog({
        req,
        userId: req.user._id,
        action: "update",
        module: "user",
        description: "User changed password",
        metadata: {},
      });
      res
        .status(StatusCodes.OK)
        .send({ message: "Password Reset Successfully" });
    }
  } else {
    res.status(StatusCodes.BAD_REQUEST).json({ message: "User not found" });
  }
};

export const updateProfile = async (req, res) => {
  const { userId, name } = req.body;
  const user = await User.findOne({ _id: userId });
  const skip = ["userId", "name"];
  if (user) {
    if (name)
      await User.updateOne(
        { _id: userId },
        { $set: { fname: name.split(" ")[0], lname: name.split(" ")[1] } },
        { new: true }
      );

    for (const key in req.body) {
      if (!skip.includes(key)) {
        await User.updateOne(
          { _id: userId },
          { $set: { [key]: req.body[key] } },
          { new: true }
        );
      }
    }

    queueActivityLog({
      req,
      userId: req.user?._id || userId,
      action: "update",
      module: "user",
      description: "User profile updated",
      metadata: { updatedUserId: String(userId) },
    });
    res.status(StatusCodes.OK).send({ message: "Updated Successfully" });
  } else {
    res.status(StatusCodes.BAD_REQUEST).json({ message: "User not found" });
  }
};

export const uploadProfilePic = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded or file type not allowed" });
    }
    const { _id: userId } = req.user;
    const s3Key = req.file.key;
    const s3Url = req.file.location;
    const response = await User.updateOne(
      { _id: userId },
      { $set: { image: s3Key, imageUrl: s3Url } },
      { new: true }
    );
    queueActivityLog({
      req,
      userId,
      action: "update",
      module: "user",
      description: "Profile picture uploaded",
      metadata: {},
    });
    res.status(200).json({ message: "Image uploaded successfully", imageUrl: s3Url, response });
  } catch (err) {
    res.status(500).json({ error: err });
  }
};

export const removeProfilePic = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findOne({ _id: userId });
    const s3Key = user.image;

    if (!s3Key) {
      return res
        .status(500)
        .json({ error: "Cannot find profile picture to delete" });
    }

    try {
      await deleteFromS3(s3Key);
    } catch (s3Err) {
      console.error("S3 delete failed for profile pic, continuing with DB update:", s3Err.message);
    }

    const response = await User.updateOne(
      { _id: userId },
      { $set: { image: null, imageUrl: null } },
      { new: true }
    );
    queueActivityLog({
      req,
      userId,
      action: "update",
      module: "user",
      description: "Profile picture removed",
      metadata: {},
    });
    return res
      .status(200)
      .json({ message: "Image removed successfully", response });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: err });
  }
};

export const deleteProject = async (req, res) => {
  try {
    const { type, id } = req.body;
    switch (type) {
      case "image":
        const image = await Image.findById(id);
        if (image) {
          console.log(image);

          // Soft delete: retain the row and the underlying file on disk so the
          // image can be restored. A future purge job is responsible for the
          // hard delete + `fs.unlinkSync` cleanup.
          const deleteResp = await Image.updateOne(
            { _id: id },
            { $set: { deletedAt: new Date() } }
          );

          queueActivityLog({
            req,
            userId: req.user._id,
            action: "delete",
            module: "user",
            description: "User media project deleted (image)",
            metadata: { type, id: String(id) },
          });
          return res.status(StatusCodes.OK).json({
            message: "File deleted successfully",
          });
        } else {
          return res.status(StatusCodes.BAD_REQUEST).json({
            message:
              "File you are trying to delete is already been delete or no longer present on the server",
          });
        }
        break;
      case "video":
        console.log("called");
        const video = await Videos.findById(id);
        if (video) {
          const isDeleted = await Videos.updateOne(
            { _id: id },
            { $set: { deletedAt: new Date() } }
          );
          queueActivityLog({
            req,
            userId: req.user._id,
            action: "delete",
            module: "user",
            description: "User media project deleted (video)",
            metadata: { type, id: String(id) },
          });
          return res.status(StatusCodes.OK).json({
            message: "File deleted successfully",
          });
        } else {
          return res.status(StatusCodes.BAD_REQUEST).json({
            message:
              "File you are trying to delete is already been delete or no longer present on the server",
          });
        }
        break;
      default:
        return res.status(StatusCodes.BAD_REQUEST).json({
          message:
            "File you are trying to delete is already been delete or no longer present on the server",
        });
    }
  } catch (e) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: `Failed to delete the file, please try again after some times`,
    });
  }
};

export const verifyToken = async (req, res) => {
  const { token } = req.params;
  const user = await User.findOne({ "verificationToken.token": token });
  if (!user) {
    return res.status(400).json({ message: "Invalid token" });
  }

  // An active account that still owes a password must be allowed through so the
  // link can hand out a setup token.
  if (user.status === "active" && !user.passwordSetupRequired) {
    return res.status(400).json({ message: "User already verified" });
  }

  // check if token is expired
  const isExpired = new Date(user.verificationToken.expires) < new Date();
  if (isExpired) {
    return res.status(400).json({ message: "Token expired" });
  }

  // update user status to active
  user.status = "active";
  user.verificationToken = undefined;
  await user.save();

  const needsPasswordSetup =
    user.signupType === "stripe_checkout" || user.passwordSetupRequired;

  if (needsPasswordSetup) {
    let existingReset = await ResetToken.findOne({ userId: user._id });
    if (existingReset) await existingReset.deleteOne();

    const setupToken = crypto.randomBytes(32).toString("hex");
    const hash = bcrypt.hashSync(setupToken, 10);
    await new ResetToken({
      userId: user._id,
      token: hash,
      createdAt: Date.now(),
    }).save();

    queueActivityLog({
      req,
      userId: user._id,
      action: "update",
      module: "auth",
      description: "Email verification completed; password setup required",
      metadata: {},
    });

    return res.status(StatusCodes.OK).json({
      message: "Account verified — now create your password.",
      passwordSetupRequired: true,
      userId: user._id,
      setupToken,
    });
  }

  await StripeService.registerForFreePlan(user);

  const jwtToken = await user.createJWT();
  const openaikeyExist =
    typeof user.openaiKey === "string" && user.openaiKey.trim() !== "";

  queueActivityLog({
    req,
    userId: user._id,
    action: "update",
    module: "auth",
    description: "Email verification completed; account activated",
    metadata: {},
  });
  return res
    .status(StatusCodes.OK)
    .json({
      message: "User verified successfully",
      token: jwtToken,
      userName: user.fname,
      userid: user._id,
      compId: user.companyId,
      role: user.role,
      openaikeyExist,
      email: user.email,
      fname: user.fname,
      lname: user.lname,
    });
};

export const verifyTokenAuth = async (req, res) => {
  const { token } = req.body;

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      // JWT verification failed

      console.error("JWT verification failed:", err);
      return res.status(400).json({ message: "Invalid token" });
    } else {
      // JWT verification successful
      //console.log('userController - verifyTokenAuth: Decoded JWT payload:', decoded);
      return res.status(200).json({ message: "valid" });
    }
  });
};
export const generateNewToken = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res
      .status(StatusCodes.BAD_REQUEST)
      .json({ message: "Email is required" });
  }

  const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  const isEmailValid = emailPattern.test(email);

  if (!isEmailValid) {
    return res
      .status(StatusCodes.BAD_REQUEST)
      .json({ message: "Invalid email" });
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  // check if user exist with the email
  const user = await User.findOne({ email: normalizedEmail });

  if (!user) {
    return res.status(200).json({ message: "If this email is registered, a new verification link has been sent." });
  }

  //check status
  if (user.status === "active") {
    return res.status(400).json({ message: "User already verified" });
  }

  // Checkout-first signups also verify by email, so they must be able to ask for a
  // fresh link. Social/Shopify accounts have no verification email to resend.
  if (!["register", "stripe_checkout"].includes(user.signupType)) {
    return res.status(400).json({
      message: `This account signs in with ${user.signupType}, so no verification email is needed.`,
    });
  }

  const EMAIL_COOLDOWN_MS = 60 * 1000;
  if (
    user.verificationEmailSentAt &&
    Date.now() - user.verificationEmailSentAt.getTime() < EMAIL_COOLDOWN_MS
  ) {
    const retryAfterSeconds = Math.ceil(
      (EMAIL_COOLDOWN_MS - (Date.now() - user.verificationEmailSentAt.getTime())) / 1000
    );
    return res.status(StatusCodes.TOO_MANY_REQUESTS).json({
      message: `Please wait ${retryAfterSeconds} seconds before requesting another verification email.`,
      code: "EMAIL_COOLDOWN",
      retryAfterSeconds,
    });
  }

  // generate new token
  const token = crypto.randomBytes(32).toString("hex");

  user.verificationToken = {
    token: token,
    expires: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
  };

  await user.save();

  const varifyLink = `${process.env.CLIENT_URL}/verify/${token}`;
  try {
    await sendVerificationEmail({
      email: user.email,
      name: user.fname,
      verifyLink: varifyLink,
    });
    user.verificationEmailSentAt = new Date();
    await user.save();
  } catch (emailErr) {
    console.error("Verification resend email failed:", emailErr);
    const message =
      emailErr instanceof EmailDeliveryError
        ? "We could not send the verification email. Please try again in a few minutes or contact support@storygroove.ai."
        : "Could not send verification email. Please try again.";
    return res.status(StatusCodes.SERVICE_UNAVAILABLE).json({
      message,
      code: "EMAIL_DELIVERY_FAILED",
    });
  }
  queueActivityLog({
    req,
    userId: user._id,
    action: "update",
    module: "user",
    description: "New email verification link generated",
    metadata: {},
  });

  return res.status(StatusCodes.OK).json({
    message: "New verification link sent to your email",
    code: "VERIFICATION_EMAIL_SENT",
  });
};

export const storeOpenAIKey = async (req, res) => {
  const { openaiKey } = req.body;
  const userId = req.user._id;

  if (!openaiKey) {
    return res.status(400).json({ message: "OpenAI key is required." });
  }

  try {
    // Validate API key by listing models
    const testResponse = await axios.get("https://api.openai.com/v1/models", {
      headers: {
        Authorization: `Bearer ${openaiKey}`,
      },
    });

    if (testResponse.status === 200) {
      const encryptedKey = encrypt(openaiKey);

      await User.findByIdAndUpdate(
        userId,
        { openaiKey: encryptedKey },
        { new: true }
      );

      queueActivityLog({
        req,
        userId,
        action: "update",
        module: "user",
        description: "OpenAI API key stored (encrypted)",
        metadata: {},
      });
      return res
        .status(200)
        .json({ message: "API key saved successfully." });
    }
  } catch (error) {
    const errMessage =
      error.response?.data?.error?.message ||
      "Failed to validate the provided OpenAI API key.";
    return res.status(401).json({ message: errMessage });
  }
};

export const logoutUser = async (req, res) => {
  queueActivityLog({
    req,
    userId: req.user._id,
    action: "logout",
    module: "auth",
    description: "User logged out",
    metadata: {},
  });
  return res.status(StatusCodes.OK).json({ message: "Logged out" });
};

export const unlockUserAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await User.updateOne(
      { _id: id },
      { $unset: { failedLoginAttempts: "", lockUntil: "" } }
    );
    if (result.matchedCount === 0) {
      return res
        .status(StatusCodes.NOT_FOUND)
        .json({ message: "User not found" });
    }
    queueActivityLog({
      req,
      userId: req.user._id,
      action: "update",
      module: "user",
      description: "Admin unlocked user login",
      metadata: { targetUserId: String(id) },
    });
    return res
      .status(StatusCodes.OK)
      .json({ message: "Account unlocked" });
  } catch (err) {
    console.error("unlockUserAccount error:", err);
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ message: "Failed to unlock account" });
  }
};
