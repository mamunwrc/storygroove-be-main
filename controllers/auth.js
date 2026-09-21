import axios from 'axios';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { StatusCodes } from 'http-status-codes';
import fetch from 'node-fetch';
import User from '../models/user.js';
import * as StripeService from '../service/stripeService.js';
import sendEmail, { EmailDeliveryError, sendVerificationEmail } from '../utils/mailGun.js';
import { validateName } from "../validations/userDataValidations.js";
import { queueActivityLog } from "../utils/queueActivityLog.js";

const TWO_FA_CHALLENGE_TTL = '10m';

const buildLoginResponse = async (user) => {
  const token = await user.createJWT();
  const openaikeyExist =
    typeof user.openaiKey === 'string' && user.openaiKey.trim() !== '';
  return {
    token,
    userName: user.fname,
    userid: user._id,
    compId: user.companyId,
    role: user.role,
    openaikeyExist,
    fname: user.fname,
    lname: user.lname,
  };
};

const sendTwoFactorEmail = async (user, code) => {
  try {
    await sendEmail(
      user.email,
      'Your StoryGroove verification code',
      { name: user.fname, code, expiresInMinutes: 10 },
      '../utils/template/twoFactorCode.handlebars',
      false
    );
  } catch (err) {
    console.error('Failed to send 2FA email:', err);
  }
};

const issueChallengeToken = (user) =>
  jwt.sign(
    { userId: user._id.toString(), purpose: '2fa' },
    process.env.JWT_SECRET,
    { expiresIn: TWO_FA_CHALLENGE_TTL }
  );

export const registerUser = async (req, res) => {
  try {
    const { fname, lname, password, email: rawEmail, username: rawUsername } = req.body;
    const email = String(rawEmail || '').trim().toLowerCase();
    const username = String(rawUsername || rawEmail || '').trim().toLowerCase();

    const emailExist = await User.findOne({ email });
    if (emailExist) {
      res.status(StatusCodes.BAD_REQUEST).json({ message: 'Email already in Use' });
      return;
    }

    const CheckUserNameExists = await User.findOne({ username });
    if (CheckUserNameExists) {
      res.status(StatusCodes.BAD_REQUEST).json({ message: 'Please use different UserName' });
      return;
    }


    if(!validateName(fname)){
      res.status(StatusCodes.BAD_REQUEST).json({ message: 'First name should be text only' });
      return;
    }

    if(!validateName(lname)){
      res.status(StatusCodes.BAD_REQUEST).json({ message: 'last name should be text only' });
      return;
    }


    const verificationString = await crypto.randomBytes(32).toString('hex');

    const user = await User.create({
      fname: fname,
      lname: lname,
      username: username,
      password: password,
      email: email,
      role: 'user',
      status: 'inactive',
      signupType: 'register',
      verificationToken: {
        token: verificationString, 
        expires: new Date((Date.now() + 15 * 60 * 1000)).getTime(),
      },
    });

    const varifyLink = `${process.env.CLIENT_URL}/verify/${verificationString}`;
    try {
      await sendVerificationEmail({
        email: user.email,
        name: user.fname,
        verifyLink: varifyLink,
      });
      user.verificationEmailSentAt = new Date();
      await user.save();
    } catch (emailErr) {
      await User.deleteOne({ _id: user._id });
      console.error('Registration verification email failed:', emailErr);
      const message =
        emailErr instanceof EmailDeliveryError
          ? 'We could not send your verification email. Please try again in a few minutes or contact support@storygroove.ai.'
          : 'Registration could not be completed. Please try again.';
      return res.status(StatusCodes.SERVICE_UNAVAILABLE).json({
        message,
        code: 'EMAIL_DELIVERY_FAILED',
      });
    }

    res.status(StatusCodes.CREATED).json({
      message: 'Registered user successfully',
      code: 'REGISTRATION_PENDING_VERIFICATION',
      email: user.email,
    });
    queueActivityLog({
      req,
      userId: user._id,
      action: 'create',
      module: 'auth',
      description: 'User registered',
      metadata: { email: user.email },
    });
    await StripeService.createCustomer(user);
    return;
  } catch (err) {
    return res.status(StatusCodes.BAD_REQUEST).json({ message: err.message });
  }
};

export const loginUser = async (req, res) => {
  try {
    const { email: tempEmail, password } = req.body;
    if (!tempEmail || !password) {
      return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Please provide Email and Password' });
    }
    const email = tempEmail.toLowerCase();

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Invalid credentials' });
    }

    if (user.isLocked()) {
      return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Invalid credentials' });
    }

    const correctPassword = await user.comparePasword(password);
    if (!correctPassword) {
      await user.registerFailedLogin();
      return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Invalid credentials' });
    }

    if (user.passwordSetupRequired) {
      return res.status(StatusCodes.FORBIDDEN).json({
        message: 'Please set your password using the link from your verification email before logging in.',
        code: 'PASSWORD_SETUP_REQUIRED',
        email: user.email,
      });
    }

    if (user && user.status === 'inactive') {
      return res.status(StatusCodes.UNAUTHORIZED).json({
        message: 'Your account is inactive, please verify your account before logging in',
        code: 'ACCOUNT_UNVERIFIED',
        email: user.email,
      });
    }

    await user.registerSuccessfulLogin();

    if (user.role === 'superadmin') {
      const code = await user.issueTwoFactorCode();
      await sendTwoFactorEmail(user, code);
      const challengeToken = issueChallengeToken(user);
      queueActivityLog({
        req,
        userId: user._id,
        action: 'login',
        module: 'auth',
        description: 'Superadmin login: two-factor challenge issued',
        metadata: { step: 'two_factor_challenge' },
      });
      return res.status(StatusCodes.OK).json({
        twoFactorRequired: true,
        challengeToken,
      });
    }

    const payload = await buildLoginResponse(user);
    queueActivityLog({
      req,
      userId: user._id,
      action: 'login',
      module: 'auth',
      description: 'User logged in',
      metadata: { role: user.role },
    });
    return res.status(StatusCodes.OK).json(payload);
  } catch (err) {
    console.error("Login error:", err);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: "An error occurred during login" });
  }
};

const decodeChallengeToken = (challengeToken) => {
  try {
    const decoded = jwt.verify(challengeToken, process.env.JWT_SECRET);
    if (!decoded || decoded.purpose !== '2fa' || !decoded.userId) {
      return null;
    }
    return decoded;
  } catch (_e) {
    return null;
  }
};

export const verifyLoginTwoFactor = async (req, res) => {
  try {
    const { challengeToken, code } = req.body || {};
    if (!challengeToken || !code) {
      return res
        .status(StatusCodes.UNAUTHORIZED)
        .json({ message: 'Invalid or expired code' });
    }

    const decoded = decodeChallengeToken(challengeToken);
    if (!decoded) {
      return res
        .status(StatusCodes.UNAUTHORIZED)
        .json({ message: 'Invalid or expired code' });
    }

    const user = await User.findById(decoded.userId);
    if (!user || user.role !== 'superadmin') {
      return res
        .status(StatusCodes.UNAUTHORIZED)
        .json({ message: 'Invalid or expired code' });
    }

    const ok = await user.verifyTwoFactorCode(code);
    if (!ok) {
      return res
        .status(StatusCodes.UNAUTHORIZED)
        .json({ message: 'Invalid or expired code' });
    }

    const payload = await buildLoginResponse(user);
    queueActivityLog({
      req,
      userId: user._id,
      action: 'login',
      module: 'auth',
      description: 'Superadmin completed two-factor login',
      metadata: { role: user.role },
    });
    return res.status(StatusCodes.OK).json(payload);
  } catch (err) {
    console.error('verifyLoginTwoFactor error:', err);
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ message: 'An error occurred during verification' });
  }
};

export const resendLoginTwoFactor = async (req, res) => {
  const genericResponse = () =>
    res
      .status(StatusCodes.OK)
      .json({ message: 'If your code expired, a new one has been sent' });

  try {
    const { challengeToken } = req.body || {};
    if (!challengeToken) return genericResponse();

    const decoded = decodeChallengeToken(challengeToken);
    if (!decoded) return genericResponse();

    const user = await User.findById(decoded.userId);
    if (!user || user.role !== 'superadmin') return genericResponse();

    if (!user.canResendTwoFactor()) return genericResponse();

    const code = await user.issueTwoFactorCode();
    await sendTwoFactorEmail(user, code);
    return genericResponse();
  } catch (err) {
    console.error('resendLoginTwoFactor error:', err);
    return genericResponse();
  }
};
