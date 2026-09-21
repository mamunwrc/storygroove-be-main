import StatusCodes from 'http-status-codes';
import Subscription from '../models/subscriptionModel.js';

export const subscriptionsList = async (req, res) => {
  let subscriptions = await Subscription.find({
    isdeleted: false,
    // If the visible field is undefined, or the value is null or true, this will return it
    visible: { $in: [null, true] }
  }).sort({amount: 1});
  res.status(StatusCodes.OK).json(subscriptions);
};

export const subscriptionsListV2 = async (req, res) => {
  const subscriptions = await Subscription.find({
    isdeleted: false,
    // If the visible field is undefined, or the value is null or true, this will return it
    visible: { $in: [null, true] }
  }).sort({amount: 1});
  const dtoSubscriptions = subscriptions.map(subscription => {
    return subscription.buildDataTransferObject();
  });
  res.status(StatusCodes.OK).json(dtoSubscriptions);
};
