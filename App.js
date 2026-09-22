// App.js - MAIN FILE (UPDATED)

import React from 'react';
import { LogBox } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AdminProvider } from './context/AdminContext';
import { ProductProvider } from './context/ProductContext';
import { FavoritesProvider } from './context/FavoritesContext';
import { CartProvider } from './context/CartContext';
import withRoleGuard from './components/withRoleGuard';
import AppAlertHost from './components/ui/AppAlertHost';
import { navigationRef } from './navigationRef';

// Import all screens
import LandingScreen from './screens/LandingScreen';
import HomeScreen from './screens/Homescreen';
import LoginScreen from './screens/Loginscreen';
import SignupScreen from './screens/Signupscreen';
import ForgotPasswordScreen from './screens/ForgotPasswordScreen';
import ShopScreen from './screens/Shopscreen';
import ProductScreen from './screens/Productscreen';
import CartScreen from './screens/Cartscreen';
import CheckoutScreen from './screens/Checkoutscreen';
import SandboxPaymentScreen from './screens/SandboxPaymentScreen';
import ProfileScreen from './screens/Profilescreen';
import FavoritesScreen from './screens/Favoritescreen';
import LocationScreen from './screens/LocationScreen';
import HelpScreen from './screens/HelpScreen';
import OrdersScreen from './screens/OrdersScreen';
import OrderDetailsScreen from './screens/OrderDetailsScreen'; // <-- NEW IMPORT
import OrderConfirmationScreen from './screens/OrderConfirmationScreen';
import WriteReviewScreen from './screens/WriteReviewScreen';

import AdminLoginScreen from './screens/admin/AdminLoginScreen';
import StoreManagerDashboardScreen from './screens/admin/StoreManagerDashboardScreen';
import AdminProductsScreen from './screens/admin/AdminProductsScreen';
import AdminAddProductScreen from './screens/admin/AdminAddProductScreen';
import AdminEditProductScreen from './screens/admin/AdminEditProductScreen';
import AdminOrdersScreen from './screens/admin/AdminOrdersScreen';
import AdminUsersScreen from './screens/admin/AdminUsersScreen';
import AdminSupportScreen from './screens/admin/AdminSupportScreen';
import AdminReviewsScreen from './screens/admin/AdminReviewsScreen';
import AdminActivityScreen from './screens/admin/AdminActivityScreen';
import AdminMailLogScreen from './screens/admin/AdminMailLogScreen';

LogBox.ignoreLogs(['Text strings must be rendered within a <Text> component']);

const Stack = createNativeStackNavigator();

// Every admin screen except AdminLoginScreen itself is wrapped so it can
// only render for someone whose AdminContext role matches the role named
// here — mirrors the product/order/support-request vs. user-account split
// in firestore.rules exactly. AdminLoginScreen is intentionally left
// unguarded — it has to stay reachable by non-admins, since it's the
// screen that grants a role in the first place.
const GuardedStoreManagerDashboard = withRoleGuard(StoreManagerDashboardScreen, 'seller');
const GuardedAdminProductsScreen = withRoleGuard(AdminProductsScreen, 'seller');
const GuardedAdminAddProductScreen = withRoleGuard(AdminAddProductScreen, 'seller');
const GuardedAdminEditProductScreen = withRoleGuard(AdminEditProductScreen, 'seller');
const GuardedAdminOrdersScreen = withRoleGuard(AdminOrdersScreen, 'seller');
const GuardedAdminUsersScreen = withRoleGuard(AdminUsersScreen, 'platformAdmin');
// Both roles, with disjoint data, like Activity below: a Store Manager's
// queue is questions about their store's orders, the Platform Admin's is
// general questions that name no store (handlesSupport() in
// firestore.rules). The screen picks the queue from the signed-in role.
const GuardedAdminSupportScreen = withRoleGuard(AdminSupportScreen, ['seller', 'platformAdmin']);
// Reviews are store content, so moderating them is the Store Manager's job,
// not the Platform Admin's — same side of the split as products, orders and
// support requests. firestore.rules agrees: only isSeller() may write the
// `hidden` flag.
const GuardedAdminReviewsScreen = withRoleGuard(AdminReviewsScreen, 'seller');
// Seller-only, matching the mailLog read rule: these entries are about
// orders and support requests, which is store operations. A platformAdmin
// navigating here would be bounced by the guard, same as for Orders.
const GuardedAdminMailLogScreen = withRoleGuard(AdminMailLogScreen, 'seller');
// The one screen both roles may open, and the exception that proves the
// rule: it shows each role its OWN activity log and nothing else, because
// it picks the collection from the signed-in role and firestore.rules
// refuses the other collection in both directions. Shared screen, disjoint
// data — see AdminActivityScreen's VIEWS map.
const GuardedAdminActivityScreen = withRoleGuard(AdminActivityScreen, ['seller', 'platformAdmin']);

export default function App() {
  return (
    <SafeAreaProvider>
      <AdminProvider>
        <ProductProvider>
          <FavoritesProvider>
            <CartProvider>
              {/* ref lets AdminContext bounce a deactivated account back
                  to Landing — it sits above this container and has no
                  navigation prop of its own. See navigationRef.js. */}
              <NavigationContainer ref={navigationRef}>
                <Stack.Navigator
                  initialRouteName="Landing"
                  screenOptions={{
                    headerShown: false,
                    animation: 'slide_from_right',
                  }}
                >
                  {/* Landing Screen */}
                  <Stack.Screen name="Landing" component={LandingScreen} />

                  {/* iPhone 16 Pro Max - 1 */}
                  <Stack.Screen name="Home" component={HomeScreen} />

                  {/* iPhone 16 Pro Max - 7 */}
                  <Stack.Screen name="Login" component={LoginScreen} />

                  {/* iPhone 16 Pro Max - 6 */}
                  <Stack.Screen name="Signup" component={SignupScreen} />

                  {/* New Forgot Password Screen */}
                  <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />

                  {/* iPhone 16 Pro Max - 14 */}
                  <Stack.Screen name="Shop" component={ShopScreen} />

                  {/* iPhone 16 Pro Max - 16 & 18 */}
                  <Stack.Screen name="Product" component={ProductScreen} />

                  {/* iPhone 16 Pro Max - 24 & 25 */}
                  <Stack.Screen name="Cart" component={CartScreen} />

                  {/* iPhone 16 Pro Max - 17 */}
                  <Stack.Screen name="Checkout" component={CheckoutScreen} />

                  {/* The simulated payment step. Reached only from Checkout,
                      and only for the online methods — COD never opens it. */}
                  <Stack.Screen name="SandboxPayment" component={SandboxPaymentScreen} />

                  {/* iPhone 16 Pro Max - 13 */}
                  <Stack.Screen name="Profile" component={ProfileScreen} />

                  {/* iPhone 16 Pro Max - 9 */}
                  <Stack.Screen name="Favorites" component={FavoritesScreen} />

                  {/* New Screens for Shop Menu */}
                  <Stack.Screen name="Location" component={LocationScreen} />
                  <Stack.Screen name="Help" component={HelpScreen} />
                  <Stack.Screen name="Orders" component={OrdersScreen} />
                  <Stack.Screen name="OrderDetails" component={OrderDetailsScreen} />
                  {/* Reached by resetting the stack from Checkout, never
                      pushed — see the reset in Checkoutscreen for why the
                      back gesture must not return into a checkout whose
                      order has already been placed. */}
                  <Stack.Screen name="OrderConfirmation" component={OrderConfirmationScreen} />
                  <Stack.Screen name="WriteReview" component={WriteReviewScreen} />

                  {/* Admin Screens */}
                  <Stack.Screen name="AdminLogin" component={AdminLoginScreen} />
                  <Stack.Screen name="AdminDashboard" component={GuardedStoreManagerDashboard} />
                  <Stack.Screen name="AdminProducts" component={GuardedAdminProductsScreen} />
                  <Stack.Screen name="AdminAddProduct" component={GuardedAdminAddProductScreen} />
                  <Stack.Screen name="AdminEditProduct" component={GuardedAdminEditProductScreen} />
                  <Stack.Screen name="AdminOrders" component={GuardedAdminOrdersScreen} />
                  <Stack.Screen name="AdminUsers" component={GuardedAdminUsersScreen} />
                  <Stack.Screen name="AdminSupport" component={GuardedAdminSupportScreen} />
                  <Stack.Screen name="AdminReviews" component={GuardedAdminReviewsScreen} />
                  <Stack.Screen name="AdminActivity" component={GuardedAdminActivityScreen} />
                  <Stack.Screen name="AdminMailLog" component={GuardedAdminMailLogScreen} />
                </Stack.Navigator>
              </NavigationContainer>
              <AppAlertHost />
            </CartProvider>
          </FavoritesProvider>
        </ProductProvider>
      </AdminProvider>
    </SafeAreaProvider>
  );
}