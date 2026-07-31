import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Platform,
  Alert,
  Modal,
  Switch,
  KeyboardAvoidingView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';  // <- Changed import
import { Ionicons } from '@expo/vector-icons';

// Sample payment methods
const initialPaymentMethods = [
  {
    id: '1',
    type: 'credit_card',
    name: 'Visa',
    last4: '4242',
    expiryDate: '12/25',
    cardholderName: 'John Doe',
    isDefault: true,
    brand: 'visa',
    color: '#1A1F71',
  },
  {
    id: '2',
    type: 'credit_card',
    name: 'Mastercard',
    last4: '5555',
    expiryDate: '08/24',
    cardholderName: 'John Doe',
    isDefault: false,
    brand: 'mastercard',
    color: '#EB001B',
  },
  {
    id: '3',
    type: 'gcash',
    name: 'GCash',
    accountName: 'John Doe',
    accountNumber: '09123456789',
    isDefault: false,
    color: '#0078FF',
  },
  {
    id: '4',
    type: 'paymaya',
    name: 'PayMaya',
    accountName: 'John Doe',
    accountNumber: '09123456789',
    isDefault: false,
    color: '#00BFFF',
  },
];

// Transaction history
const transactionHistory = [
  {
    id: 't1',
    amount: 43.99,
    date: '2024-07-15',
    status: 'completed',
    method: 'Visa ending in 4242',
    orderId: 'ORD-12345',
  },
  {
    id: 't2',
    amount: 6.99,
    date: '2024-07-10',
    status: 'completed',
    method: 'GCash',
    orderId: 'ORD-12346',
  },
  {
    id: 't3',
    amount: 45.99,
    date: '2024-07-05',
    status: 'pending',
    method: 'Mastercard ending in 5555',
    orderId: 'ORD-12347',
  },
  {
    id: 't4',
    amount: 35.99,
    date: '2024-06-28',
    status: 'completed',
    method: 'PayMaya',
    orderId: 'ORD-12348',
  },
];

export default function PaymentScreen({ navigation }) {
  const [paymentMethods, setPaymentMethods] = useState(initialPaymentMethods);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState(null);
  const [formData, setFormData] = useState({
    type: 'credit_card',
    cardNumber: '',
    expiryDate: '',
    cardholderName: '',
    cvv: '',
    accountName: '',
    accountNumber: '',
    isDefault: false,
  });

  const getCardBrand = (cardNumber) => {
    const firstDigit = cardNumber.charAt(0);
    if (firstDigit === '4') return 'visa';
    if (firstDigit === '5') return 'mastercard';
    if (firstDigit === '3') return 'amex';
    if (firstDigit === '6') return 'discover';
    return 'credit-card';
  };

  const formatCardNumber = (text) => {
    const cleaned = text.replace(/\s/g, '');
    const groups = cleaned.match(/.{1,4}/g);
    return groups ? groups.join(' ') : text;
  };

  const formatExpiryDate = (text) => {
    const cleaned = text.replace(/\D/g, '');
    if (cleaned.length >= 2) {
      return `${cleaned.slice(0, 2)}/${cleaned.slice(2, 4)}`;
    }
    return cleaned;
  };

  const validateCardNumber = (number) => {
    const cleaned = number.replace(/\s/g, '');
    return /^\d{16}$/.test(cleaned);
  };

  const validateExpiryDate = (date) => {
    const [month, year] = date.split('/');
    if (!month || !year) return false;
    const monthNum = parseInt(month, 10);
    const yearNum = parseInt(year, 10);
    const currentYear = new Date().getFullYear() % 100;
    const currentMonth = new Date().getMonth() + 1;
    
    if (monthNum < 1 || monthNum > 12) return false;
    if (yearNum < currentYear) return false;
    if (yearNum === currentYear && monthNum < currentMonth) return false;
    return true;
  };

  const validateCVV = (cvv) => {
    return /^\d{3,4}$/.test(cvv);
  };

  const handleAddPaymentMethod = () => {
    // Validation
    if (formData.type === 'credit_card') {
      if (!validateCardNumber(formData.cardNumber)) {
        Alert.alert('Error', 'Please enter a valid 16-digit card number');
        return;
      }
      if (!validateExpiryDate(formData.expiryDate)) {
        Alert.alert('Error', 'Please enter a valid expiry date (MM/YY)');
        return;
      }
      if (!formData.cardholderName.trim()) {
        Alert.alert('Error', 'Please enter cardholder name');
        return;
      }
      if (!validateCVV(formData.cvv)) {
        Alert.alert('Error', 'Please enter a valid CVV (3-4 digits)');
        return;
      }

      const last4 = formData.cardNumber.replace(/\s/g, '').slice(-4);
      const brand = getCardBrand(formData.cardNumber);
      
      const newMethod = {
        id: Date.now().toString(),
        type: 'credit_card',
        name: brand.charAt(0).toUpperCase() + brand.slice(1),
        last4: last4,
        expiryDate: formData.expiryDate,
        cardholderName: formData.cardholderName,
        isDefault: formData.isDefault,
        brand: brand,
        color: brand === 'visa' ? '#1A1F71' : brand === 'mastercard' ? '#EB001B' : '#006FCF',
      };

      let updatedMethods;
      if (formData.isDefault) {
        updatedMethods = paymentMethods.map(m => ({ ...m, isDefault: false }));
        updatedMethods.push(newMethod);
      } else {
        updatedMethods = [...paymentMethods, newMethod];
      }
      
      setPaymentMethods(updatedMethods);
    } else {
      // E-wallet (GCash, PayMaya)
      if (!formData.accountName.trim()) {
        Alert.alert('Error', 'Please enter account name');
        return;
      }
      if (!formData.accountNumber.trim()) {
        Alert.alert('Error', 'Please enter account number');
        return;
      }

      const newMethod = {
        id: Date.now().toString(),
        type: formData.type,
        name: formData.type === 'gcash' ? 'GCash' : 'PayMaya',
        accountName: formData.accountName,
        accountNumber: formData.accountNumber,
        isDefault: formData.isDefault,
        color: formData.type === 'gcash' ? '#0078FF' : '#00BFFF',
      };

      let updatedMethods;
      if (formData.isDefault) {
        updatedMethods = paymentMethods.map(m => ({ ...m, isDefault: false }));
        updatedMethods.push(newMethod);
      } else {
        updatedMethods = [...paymentMethods, newMethod];
      }
      
      setPaymentMethods(updatedMethods);
    }

    Alert.alert('Success', 'Payment method added successfully');
    setShowAddModal(false);
    resetForm();
  };

  const handleDeletePaymentMethod = (methodId) => {
    Alert.alert(
      'Remove Payment Method',
      'Are you sure you want to remove this payment method?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            const updatedMethods = paymentMethods.filter(m => m.id !== methodId);
            setPaymentMethods(updatedMethods);
            Alert.alert('Success', 'Payment method removed successfully');
          },
        },
      ]
    );
  };

  const setDefaultPaymentMethod = (methodId) => {
    const updatedMethods = paymentMethods.map(m => ({
      ...m,
      isDefault: m.id === methodId,
    }));
    setPaymentMethods(updatedMethods);
    Alert.alert('Success', 'Default payment method updated');
  };

  const resetForm = () => {
    setFormData({
      type: 'credit_card',
      cardNumber: '',
      expiryDate: '',
      cardholderName: '',
      cvv: '',
      accountName: '',
      accountNumber: '',
      isDefault: false,
    });
  };

  const getPaymentMethodIcon = (method) => {
    if (method.type === 'credit_card') {
      switch (method.brand) {
        case 'visa':
          return require('./assets/visa.png'); // You'll need to add these images
        case 'mastercard':
          return require('./assets/mastercard.png');
        default:
          return 'card-outline';
      }
    } else if (method.type === 'gcash') {
      return require('./assets/gcash.png');
    } else if (method.type === 'paymaya') {
      return require('./assets/paymaya.png');
    }
    return 'card-outline';
  };

  const getPaymentMethodIconComponent = (method) => {
    // Using Ionicons as fallback if images aren't available
    if (method.type === 'credit_card') {
      return <Ionicons name="card-outline" size={32} color={method.color} />;
    } else if (method.type === 'gcash') {
      return <Ionicons name="cash-outline" size={32} color={method.color} />;
    } else if (method.type === 'paymaya') {
      return <Ionicons name="wallet-outline" size={32} color={method.color} />;
    }
    return <Ionicons name="card-outline" size={32} color={method.color} />;
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return '#34C759';
      case 'pending':
        return '#FF9500';
      case 'failed':
        return '#FF3B30';
      default:
        return '#666';
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Payment Methods</Text>
        <TouchableOpacity onPress={() => setShowHistory(!showHistory)}>
          <Ionicons name="time-outline" size={24} color="#000" />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Balance Card */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Total Balance</Text>
          <Text style={styles.balanceAmount}>$0.00</Text>
          <Text style={styles.balanceNote}>Add payment method to start shopping</Text>
        </View>

        {/* Payment Methods Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Saved Payment Methods</Text>
            <TouchableOpacity 
              style={styles.addButton}
              onPress={() => {
                resetForm();
                setShowAddModal(true);
              }}
            >
              <Ionicons name="add-circle-outline" size={24} color="#007AFF" />
              <Text style={styles.addButtonText}>Add New</Text>
            </TouchableOpacity>
          </View>

          {paymentMethods.length > 0 ? (
            paymentMethods.map((method) => (
              <View key={method.id} style={styles.paymentCard}>
                <View style={styles.paymentCardLeft}>
                  <View style={styles.paymentIcon}>
                    {getPaymentMethodIconComponent(method)}
                  </View>
                  <View style={styles.paymentInfo}>
                    <View style={styles.paymentNameContainer}>
                      <Text style={styles.paymentName}>{method.name}</Text>
                      {method.isDefault && (
                        <View style={styles.defaultBadge}>
                          <Text style={styles.defaultBadgeText}>Default</Text>
                        </View>
                      )}
                    </View>
                    {method.type === 'credit_card' ? (
                      <>
                        <Text style={styles.paymentDetail}>
                          •••• {method.last4}
                        </Text>
                        <Text style={styles.paymentDetail}>
                          Expires {method.expiryDate}
                        </Text>
                        <Text style={styles.paymentDetail}>
                          {method.cardholderName}
                        </Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.paymentDetail}>
                          {method.accountName}
                        </Text>
                        <Text style={styles.paymentDetail}>
                          {method.accountNumber}
                        </Text>
                      </>
                    )}
                  </View>
                </View>
                <View style={styles.paymentActions}>
                  {!method.isDefault && (
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => setDefaultPaymentMethod(method.id)}
                    >
                      <Text style={styles.setDefaultText}>Set Default</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleDeletePaymentMethod(method.id)}
                  >
                    <Ionicons name="trash-outline" size={20} color="#FF3B30" />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="card-outline" size={64} color="#ccc" />
              <Text style={styles.emptyStateText}>No payment methods</Text>
              <Text style={styles.emptyStateSubtext}>
                Add your first payment method to start shopping
              </Text>
              <TouchableOpacity 
                style={styles.emptyAddButton}
                onPress={() => {
                  resetForm();
                  setShowAddModal(true);
                }}
              >
                <Text style={styles.emptyAddButtonText}>Add Payment Method</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Transaction History */}
        {showHistory && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Transaction History</Text>
            {transactionHistory.map((transaction) => (
              <View key={transaction.id} style={styles.transactionCard}>
                <View style={styles.transactionLeft}>
                  <View style={styles.transactionIcon}>
                    <Ionicons 
                      name={transaction.status === 'completed' ? 'checkmark-circle' : 'time-circle'} 
                      size={24} 
                      color={getStatusColor(transaction.status)} 
                    />
                  </View>
                  <View>
                    <Text style={styles.transactionMethod}>{transaction.method}</Text>
                    <Text style={styles.transactionDate}>{formatDate(transaction.date)}</Text>
                    <Text style={styles.transactionOrderId}>Order #{transaction.orderId}</Text>
                  </View>
                </View>
                <View style={styles.transactionRight}>
                  <Text style={styles.transactionAmount}>${transaction.amount.toFixed(2)}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: getStatusColor(transaction.status) + '20' }]}>
                    <Text style={[styles.statusText, { color: getStatusColor(transaction.status) }]}>
                      {transaction.status.charAt(0).toUpperCase() + transaction.status.slice(1)}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Add Payment Method Modal */}
      <Modal
        visible={showAddModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowAddModal(false)}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Payment Method</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Ionicons name="close" size={24} color="#000" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Payment Type Selector */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Payment Type</Text>
                <View style={styles.typeSelector}>
                  <TouchableOpacity
                    style={[
                      styles.typeButton,
                      formData.type === 'credit_card' && styles.typeButtonActive,
                    ]}
                    onPress={() => setFormData({ ...formData, type: 'credit_card' })}
                  >
                    <Ionicons 
                      name="card-outline" 
                      size={20} 
                      color={formData.type === 'credit_card' ? '#fff' : '#007AFF'} 
                    />
                    <Text style={[
                      styles.typeButtonText,
                      formData.type === 'credit_card' && styles.typeButtonTextActive,
                    ]}>
                      Credit Card
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.typeButton,
                      formData.type === 'gcash' && styles.typeButtonActive,
                    ]}
                    onPress={() => setFormData({ ...formData, type: 'gcash' })}
                  >
                    <Ionicons 
                      name="cash-outline" 
                      size={20} 
                      color={formData.type === 'gcash' ? '#fff' : '#0078FF'} 
                    />
                    <Text style={[
                      styles.typeButtonText,
                      formData.type === 'gcash' && styles.typeButtonTextActive,
                    ]}>
                      GCash
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.typeButton,
                      formData.type === 'paymaya' && styles.typeButtonActive,
                    ]}
                    onPress={() => setFormData({ ...formData, type: 'paymaya' })}
                  >
                    <Ionicons 
                      name="wallet-outline" 
                      size={20} 
                      color={formData.type === 'paymaya' ? '#fff' : '#00BFFF'} 
                    />
                    <Text style={[
                      styles.typeButtonText,
                      formData.type === 'paymaya' && styles.typeButtonTextActive,
                    ]}>
                      PayMaya
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {formData.type === 'credit_card' ? (
                <>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Card Number *</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="1234 5678 9012 3456"
                      placeholderTextColor="#999"
                      value={formData.cardNumber}
                      onChangeText={(text) => setFormData({ ...formData, cardNumber: formatCardNumber(text) })}
                      keyboardType="numeric"
                      maxLength={19}
                    />
                  </View>

                  <View style={styles.rowInput}>
                    <View style={[styles.inputGroup, { flex: 1, marginRight: 12 }]}>
                      <Text style={styles.inputLabel}>Expiry Date *</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="MM/YY"
                        placeholderTextColor="#999"
                        value={formData.expiryDate}
                        onChangeText={(text) => setFormData({ ...formData, expiryDate: formatExpiryDate(text) })}
                        keyboardType="numeric"
                        maxLength={5}
                      />
                    </View>
                    <View style={[styles.inputGroup, { flex: 1 }]}>
                      <Text style={styles.inputLabel}>CVV *</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="123"
                        placeholderTextColor="#999"
                        value={formData.cvv}
                        onChangeText={(text) => setFormData({ ...formData, cvv: text })}
                        keyboardType="numeric"
                        maxLength={4}
                        secureTextEntry
                      />
                    </View>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Cardholder Name *</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="John Doe"
                      placeholderTextColor="#999"
                      value={formData.cardholderName}
                      onChangeText={(text) => setFormData({ ...formData, cardholderName: text })}
                    />
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Account Name *</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Full name as registered"
                      placeholderTextColor="#999"
                      value={formData.accountName}
                      onChangeText={(text) => setFormData({ ...formData, accountName: text })}
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Account Number *</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="09123456789"
                      placeholderTextColor="#999"
                      value={formData.accountNumber}
                      onChangeText={(text) => setFormData({ ...formData, accountNumber: text })}
                      keyboardType="phone-pad"
                    />
                  </View>
                </>
              )}

              <View style={styles.switchContainer}>
                <Text style={styles.switchLabel}>Set as default payment method</Text>
                <Switch
                  value={formData.isDefault}
                  onValueChange={(value) => setFormData({ ...formData, isDefault: value })}
                  trackColor={{ false: '#E5E5EA', true: '#007AFF' }}
                  thumbColor="#fff"
                />
              </View>

              <TouchableOpacity style={styles.savePaymentButton} onPress={handleAddPaymentMethod}>
                <Text style={styles.savePaymentButtonText}>Add Payment Method</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
    // REMOVED: marginTop: Platform.OS === 'ios' ? 0 : 30,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000',
  },
  balanceCard: {
    backgroundColor: '#007AFF',
    margin: 20,
    padding: 20,
    borderRadius: 20,
    alignItems: 'center',
  },
  balanceLabel: {
    fontSize: 14,
    color: '#fff',
    opacity: 0.9,
    marginBottom: 8,
  },
  balanceAmount: {
    fontSize: 48,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  balanceNote: {
    fontSize: 12,
    color: '#fff',
    opacity: 0.8,
  },
  section: {
    marginBottom: 24,
    paddingHorizontal: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addButtonText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
  paymentCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  paymentCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  paymentIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#F9F9FB',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  paymentInfo: {
    flex: 1,
  },
  paymentNameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  paymentName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  defaultBadge: {
    backgroundColor: '#34C759',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  defaultBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  paymentDetail: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  paymentActions: {
    alignItems: 'flex-end',
    gap: 8,
  },
  actionButton: {
    padding: 4,
  },
  setDefaultText: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: '500',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    marginTop: 16,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
    marginBottom: 24,
    textAlign: 'center',
  },
  emptyAddButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  emptyAddButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  transactionCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  transactionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  transactionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F9F9FB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  transactionMethod: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  transactionDate: {
    fontSize: 11,
    color: '#999',
    marginBottom: 2,
  },
  transactionOrderId: {
    fontSize: 11,
    color: '#999',
  },
  transactionRight: {
    alignItems: 'flex-end',
  },
  transactionAmount: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
    marginBottom: 4,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#000',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    color: '#000',
    backgroundColor: '#F9F9FB',
  },
  rowInput: {
    flexDirection: 'row',
    gap: 12,
  },
  typeSelector: {
    flexDirection: 'row',
    gap: 12,
  },
  typeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    backgroundColor: '#fff',
  },
  typeButtonActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  typeButtonText: {
    fontSize: 14,
    color: '#666',
  },
  typeButtonTextActive: {
    color: '#fff',
  },
  switchContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingVertical: 12,
  },
  switchLabel: {
    fontSize: 14,
    color: '#000',
  },
  savePaymentButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 20,
  },
  savePaymentButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});