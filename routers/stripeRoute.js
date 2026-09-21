import express from 'express';
import { authenticateUserWithoutOpenAI, requireSuperAdmin } from '../config/tokenverify.js';
import * as StripeController from '../controllers/stripeController.js';

const stripeRouter = express.Router();

stripeRouter.route('/create').post(authenticateUserWithoutOpenAI, StripeController.createNewSubscriber);
stripeRouter.route('/upgrade').post(authenticateUserWithoutOpenAI, StripeController.upgradeSubscription);
stripeRouter.route('/downgrade').post(authenticateUserWithoutOpenAI, StripeController.downgradeSubscription);
stripeRouter.route('/cancel').delete(authenticateUserWithoutOpenAI, StripeController.cancelSubscription);
stripeRouter.route('/pause').post(authenticateUserWithoutOpenAI, StripeController.pauseSubscription);
stripeRouter.route('/resume').post(authenticateUserWithoutOpenAI, StripeController.resumeSubscription);
stripeRouter.route('/get').get(authenticateUserWithoutOpenAI, StripeController.getSubscription);
stripeRouter.route('/get-price-list').get(authenticateUserWithoutOpenAI, StripeController.getPriceListFromStripe);
stripeRouter.route('/v2/get').get(authenticateUserWithoutOpenAI, StripeController.getSubscriptionV2);
stripeRouter.route('/v2/agent-access').get(authenticateUserWithoutOpenAI, StripeController.getAgentAccess);
stripeRouter.route('/simone/one-time-checkout').post(authenticateUserWithoutOpenAI, StripeController.createSimoneOneTimeCheckout);
stripeRouter.route('/create-portal-session').post(authenticateUserWithoutOpenAI, StripeController.createBillingPortalSession);
stripeRouter.route('/payment-method').get(authenticateUserWithoutOpenAI, StripeController.getPaymentMethod);
stripeRouter.route('/payment-method/setup-intent').post(authenticateUserWithoutOpenAI, StripeController.createPaymentMethodSetupIntent);
stripeRouter.route('/payment-method').post(authenticateUserWithoutOpenAI, StripeController.replacePaymentMethod);
stripeRouter.route('/public/checkout-session').post(StripeController.createPublicCheckoutSession);

// Superadmin-only: generate a Stripe Checkout link on behalf of a selected user,
// and optionally email that link to the user.
stripeRouter
  .route('/admin/invite-checkout')
  .post(authenticateUserWithoutOpenAI, requireSuperAdmin, StripeController.createManualInviteCheckout);
stripeRouter
  .route('/admin/invite-checkout/email')
  .post(authenticateUserWithoutOpenAI, requireSuperAdmin, StripeController.sendManualInviteCheckoutEmail);

export default stripeRouter;
