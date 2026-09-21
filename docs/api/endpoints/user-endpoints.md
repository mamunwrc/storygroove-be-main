# User endpoints — `/api/user`

Router: `routers/userRoute.js` → `controllers/auth.js` + `controllers/userController.js`. Profile pics: **`multerUploadProfilePic.single('image')`**.

## Public / pre-auth

| Method | Path | Handler |
|--------|------|---------|
| POST | `/api/user/login` | `loginUser` |
| POST | `/api/user/login/verify-2fa` | `verifyLoginTwoFactor` |
| POST | `/api/user/login/resend-2fa` | `resendLoginTwoFactor` |
| POST | `/api/user/register` | `registerUser` |
| GET | `/api/user/verify/:token` | `verifyToken` |
| POST | `/api/user/verifyTokenAuth` | `verifyTokenAuth` |
| POST | `/api/user/generate-new-token` | `generateNewToken` |
| POST | `/api/user/forgotpassword/` | `UpdateUserPassword` |
| PATCH | `/api/user/resetPassword` | `resetPassword` |

## Authenticated (`authenticateUserWithoutOpenAI`)

| Method | Path | Handler |
|--------|------|---------|
| POST | `/api/user/logout` | `logoutUser` |
| GET | `/api/user/getuser` | `getSingleUser` |
| POST | `/api/user/changepassword/` | `changePassword` |
| POST | `/api/user/updateprofile/` | `updateProfile` |
| POST | `/api/user/uploadprofilepic/` | `uploadProfilePic` |
| POST | `/api/user/removeprofilepic/` | `removeProfilePic` |
| POST | `/api/user/openaikey` | `storeOpenAIKey` |

## Admin (`requireAdmin`)

| Method | Path | Handler |
|--------|------|---------|
| POST | `/api/user/getAllUsers` | `getAllUsers` |
| POST | `/api/user/delete/:id` | `UpdateUserStatus` |
| PATCH | `/api/user/updateuser/:id` | `UpdateUser` |
| PUT | `/api/user/updatestatus/:id` | `UpdateUserStatus` |
| POST | `/api/user/unlock/:id` | `unlockUserAccount` |
| GET | `/api/user/getusertokens/:id` | `getUserTokens` |

## `authenticateUser` (requires `openaiKey`)

| Method | Path | Handler |
|--------|------|---------|
| POST | `/api/user/project/delete` | `deleteProject` |
