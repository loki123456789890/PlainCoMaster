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
import withAdminGuard from './components/withAdminGuard';

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
import ProfileScreen from './screens/Profilescreen';
import FavoritesScreen from './screens/Favoritescreen';
import LocationScreen from './screens/LocationScreen';
import HelpScreen from './screens/HelpScreen';
import OrdersScreen from './screens/OrdersScreen';
import OrderDetailsScreen from './screens/OrderDetailsScreen'; // <-- NEW IMPORT

import AdminLoginScreen from './screens/admin/AdminLoginScreen';
import AdminDashboardScreen from './screens/admin/AdminDashboardScreen';
import AdminProductsScreen from './screens/admin/AdminProductsScreen';
import AdminAddProductScreen from './screens/admin/AdminAddProductScreen';
import AdminEditProductScreen from './screens/admin/AdminEditProductScreen';
import AdminOrdersScreen from './screens/admin/AdminOrdersScreen';
import AdminUsersScreen from './screens/admin/AdminUsersScreen';
import AdminSupportScreen from './screens/admin/AdminSupportScreen';

LogBox.ignoreLogs(['Text strings must be rendered within a <Text> component']);

const Stack = createNativeStackNavigator();

// Every admin screen except AdminLoginScreen itself is wrapped so it can
// only render for someone whose AdminContext isAdmin flag is true.
// AdminLoginScreen is intentionally left unguarded — it has to stay
// reachable by non-admins, since it's the screen that grants isAdmin
// in the first place.
const GuardedAdminDashboardScreen = withAdminGuard(AdminDashboardScreen);
const GuardedAdminProductsScreen = withAdminGuard(AdminProductsScreen);
const GuardedAdminAddProductScreen = withAdminGuard(AdminAddProductScreen);
const GuardedAdminEditProductScreen = withAdminGuard(AdminEditProductScreen);
const GuardedAdminOrdersScreen = withAdminGuard(AdminOrdersScreen);
const GuardedAdminUsersScreen = withAdminGuard(AdminUsersScreen);
const GuardedAdminSupportScreen = withAdminGuard(AdminSupportScreen);

export default function App() {
  return (
    <SafeAreaProvider>
      <AdminProvider>
        <ProductProvider>
          <FavoritesProvider>
            <CartProvider>
              <NavigationContainer>
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

                  {/* iPhone 16 Pro Max - 13 */}
                  <Stack.Screen name="Profile" component={ProfileScreen} />

                  {/* iPhone 16 Pro Max - 9 */}
                  <Stack.Screen name="Favorites" component={FavoritesScreen} />

                  {/* New Screens for Shop Menu */}
                  <Stack.Screen name="Location" component={LocationScreen} />
                  <Stack.Screen name="Help" component={HelpScreen} />
                  <Stack.Screen name="Orders" component={OrdersScreen} />
                  <Stack.Screen name="OrderDetails" component={OrderDetailsScreen} /> 

                  {/* Admin Screens */}
                  <Stack.Screen name="AdminLogin" component={AdminLoginScreen} />
                  <Stack.Screen name="AdminDashboard" component={GuardedAdminDashboardScreen} />
                  <Stack.Screen name="AdminProducts" component={GuardedAdminProductsScreen} />
                  <Stack.Screen name="AdminAddProduct" component={GuardedAdminAddProductScreen} />
                  <Stack.Screen name="AdminEditProduct" component={GuardedAdminEditProductScreen} />
                  <Stack.Screen name="AdminOrders" component={GuardedAdminOrdersScreen} />
                  <Stack.Screen name="AdminUsers" component={GuardedAdminUsersScreen} />
                  <Stack.Screen name="AdminSupport" component={GuardedAdminSupportScreen} />
                </Stack.Navigator>
              </NavigationContainer>
            </CartProvider>
          </FavoritesProvider>
        </ProductProvider>
      </AdminProvider>
    </SafeAreaProvider>
  );
}