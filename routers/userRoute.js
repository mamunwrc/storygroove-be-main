import express from 'express';
import {
  loginUser,
  registerUser,
  verifyLoginTwoFactor,
  resendLoginTwoFactor,
} from '../controllers/auth.js';
import {
  getAllUsers,
  UpdateUser,
  UpdateUserStatus,
  UpdateUserPassword,
  getSingleUser,
  resetPassword,
  getUserTokens,
  changePassword,
  updateProfile,
  uploadProfilePic,
  removeProfilePic,
  deleteProject,
  verifyToken,
  verifyTokenAuth,
  generateNewToken,
  storeOpenAIKey,
  unlockUserAccount,
  logoutUser,
} from '../controllers/userController.js';
import { multerUploadProfilePic } from '../config/multer.js';

const userRouter = express.Router();
import authenticateUser, { authenticateUserWithoutOpenAI, requireAdmin } from '../config/tokenverify.js';

userRouter.route('/login').post(loginUser);
userRouter.route('/login/verify-2fa').post(verifyLoginTwoFactor);
userRouter.route('/login/resend-2fa').post(resendLoginTwoFactor);
userRouter.route('/register').post(registerUser);
userRouter.route('/logout').post(authenticateUserWithoutOpenAI, logoutUser);

/**
 *  Auth routes for user
 *
 */
userRouter.route('/verify/:token').get(verifyToken);
userRouter.route('/verifyTokenAuth').post(verifyTokenAuth);
userRouter.route('/generate-new-token').post(generateNewToken);
userRouter.route('/getAllUsers').post(authenticateUserWithoutOpenAI, requireAdmin, getAllUsers);
userRouter.route('/getuser').get(authenticateUserWithoutOpenAI, getSingleUser);
userRouter.route('/delete/:id').post(authenticateUserWithoutOpenAI, requireAdmin, UpdateUserStatus);
userRouter.route('/updateuser/:id').patch(authenticateUserWithoutOpenAI, requireAdmin, UpdateUser);
userRouter.route('/forgotpassword/').post(UpdateUserPassword);
userRouter.route('/resetPassword').patch(resetPassword);
userRouter.route('/updatestatus/:id').put(authenticateUserWithoutOpenAI, requireAdmin, UpdateUserStatus);
userRouter.route('/unlock/:id').post(authenticateUserWithoutOpenAI, requireAdmin, unlockUserAccount);
userRouter.route('/getusertokens/:id').get(authenticateUserWithoutOpenAI, requireAdmin, getUserTokens);
userRouter.route('/changepassword/').post(authenticateUserWithoutOpenAI, changePassword);
userRouter.route('/updateprofile/').post(authenticateUserWithoutOpenAI, updateProfile);
userRouter.route('/uploadprofilepic/').post(authenticateUserWithoutOpenAI, multerUploadProfilePic.single('image'), uploadProfilePic);
userRouter.route('/removeprofilepic/').post(authenticateUserWithoutOpenAI, removeProfilePic);
userRouter.route('/project/delete').post(authenticateUser, deleteProject);
userRouter.route('/openaikey').post(authenticateUserWithoutOpenAI, storeOpenAIKey)

export default userRouter;
