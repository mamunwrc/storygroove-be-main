import express from 'express';
import * as SubscriptionController from '../controllers/subscriptionController.js';

const subscriptionRoute = express.Router();

subscriptionRoute.route('/list').get(SubscriptionController.subscriptionsList);
subscriptionRoute.route('/v2/list').get(SubscriptionController.subscriptionsListV2);

export default subscriptionRoute;
