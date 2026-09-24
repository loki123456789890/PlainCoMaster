// utils/paymentReturn.js
//
// The address PayMongo's page hands the customer back to, by way of the
// paymentReturn function. plainco://payment-return in a build,
// exp://<host>/--/payment-return in Expo Go — createURL picks the right one.
//
// One function because two places must agree on it exactly: Checkout sends
// it to placeOrder, and OnlinePaymentScreen tells the browser to close when
// it sees it. If they differed, the browser would never close on its own.
import * as Linking from 'expo-linking';

export const paymentReturnUrl = () => Linking.createURL('payment-return');
