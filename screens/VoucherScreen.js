import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  TextInput,
  Platform,
  Alert,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Sample voucher data
const availableVouchers = [
  {
    id: '1',
    code: 'WELCOME10',
    discount: '10% OFF',
    description: 'Get 10% off on your first purchase',
    minSpend: '$20',
    expiry: '2024-12-31',
    type: 'percentage',
    value: 10,
    isNew: true,
  },
  {
    id: '2',
    code: 'FREESHIP',
    discount: 'Free Shipping',
    description: 'Free shipping on orders above $30',
    minSpend: '$30',
    expiry: '2024-11-30',
    type: 'free_shipping',
    value: 0,
    isNew: false,
  },
  {
    id: '3',
    code: 'SUMMER20',
    discount: '$20 OFF',
    description: 'Get $20 off on orders above $100',
    minSpend: '$100',
    expiry: '2024-09-30',
    type: 'fixed',
    value: 20,
    isNew: true,
  },
  {
    id: '4',
    code: 'FLASH15',
    discount: '15% OFF',
    description: 'Limited time offer! 15% off on all items',
    minSpend: '$50',
    expiry: '2024-08-15',
    type: 'percentage',
    value: 15,
    isNew: false,
  },
  {
    id: '5',
    code: 'WEEKEND25',
    discount: '25% OFF',
    description: 'Weekend special - 25% off on selected items',
    minSpend: '$75',
    expiry: '2024-08-18',
    type: 'percentage',
    value: 25,
    isNew: true,
  },
];

// Sample saved vouchers
const savedVouchers = [
  {
    id: 's1',
    code: 'SAVED10',
    discount: '10% OFF',
    description: 'Saved for later use',
    minSpend: '$25',
    expiry: '2024-10-31',
    type: 'percentage',
    value: 10,
  },
];

export default function VoucherScreen({ navigation }) {
  const [activeTab, setActiveTab] = useState('available'); // 'available' or 'saved'
  const [voucherCode, setVoucherCode] = useState('');
  const [myVouchers, setMyVouchers] = useState(savedVouchers);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [selectedVoucher, setSelectedVoucher] = useState(null);

  const handleApplyVoucher = (voucher) => {
    setSelectedVoucher(voucher);
    setShowApplyModal(true);
  };

  const confirmApplyVoucher = () => {
    // Check if voucher is already saved
    const isAlreadySaved = myVouchers.some(v => v.id === selectedVoucher.id);
    
    if (!isAlreadySaved) {
      setMyVouchers([...myVouchers, { ...selectedVoucher, id: `s${Date.now()}` }]);
      Alert.alert(
        'Voucher Applied!',
        `${selectedVoucher.discount} discount has been applied to your cart.`,
        [{ text: 'OK', onPress: () => navigation.navigate('Cart') }]
      );
    } else {
      Alert.alert('Already Applied', 'This voucher is already in your saved list.');
    }
    setShowApplyModal(false);
    setSelectedVoucher(null);
  };

  const handleRedeemCode = () => {
    if (!voucherCode.trim()) {
      Alert.alert('Error', 'Please enter a voucher code');
      return;
    }

    // Check if code exists in available vouchers
    const existingVoucher = availableVouchers.find(
      v => v.code.toLowerCase() === voucherCode.toLowerCase()
    );

    if (existingVoucher) {
      handleApplyVoucher(existingVoucher);
      setVoucherCode('');
    } else {
      Alert.alert('Invalid Code', 'The voucher code you entered is invalid or expired.');
    }
  };

  const removeVoucher = (voucherId) => {
    Alert.alert(
      'Remove Voucher',
      'Are you sure you want to remove this voucher?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Remove', 
          style: 'destructive',
          onPress: () => {
            setMyVouchers(myVouchers.filter(v => v.id !== voucherId));
          }
        }
      ]
    );
  };

  const getExpiryStatus = (expiryDate) => {
    const today = new Date();
    const expiry = new Date(expiryDate);
    const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
    
    if (daysLeft < 0) return 'Expired';
    if (daysLeft <= 3) return 'Expiring Soon';
    return `${daysLeft} days left`;
  };

  const getExpiryStyle = (expiryDate) => {
    const today = new Date();
    const expiry = new Date(expiryDate);
    const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
    
    if (daysLeft < 0) return styles.expired;
    if (daysLeft <= 3) return styles.expiringSoon;
    return styles.valid;
  };

  const renderVoucherCard = (voucher, isSaved = false) => {
    const expiryStatus = getExpiryStatus(voucher.expiry);
    const expiryStyle = getExpiryStyle(voucher.expiry);
    
    return (
      <View key={voucher.id} style={styles.voucherCard}>
        <View style={styles.voucherLeft}>
          <View style={styles.discountBadge}>
            <Text style={styles.discountText}>{voucher.discount}</Text>
          </View>
          <Text style={styles.voucherCode}>{voucher.code}</Text>
          <Text style={styles.voucherDescription}>{voucher.description}</Text>
          <View style={styles.voucherDetails}>
            <View style={styles.detailItem}>
              <Ionicons name="cash-outline" size={14} color="#666" />
              <Text style={styles.detailText}>Min. spend {voucher.minSpend}</Text>
            </View>
            <View style={styles.detailItem}>
              <Ionicons name="calendar-outline" size={14} color="#666" />
              <Text style={[styles.detailText, expiryStyle]}>
                {expiryStatus}
              </Text>
            </View>
          </View>
        </View>
        
        <View style={styles.voucherRight}>
          {isSaved ? (
            <TouchableOpacity
              style={styles.removeButton}
              onPress={() => removeVoucher(voucher.id)}
            >
              <Ionicons name="trash-outline" size={20} color="#FF3B30" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.applyButton}
              onPress={() => handleApplyVoucher(voucher)}
            >
              <Text style={styles.applyButtonText}>Apply</Text>
            </TouchableOpacity>
          )}
        </View>
        
        {voucher.isNew && !isSaved && (
          <View style={styles.newBadge}>
            <Text style={styles.newBadgeText}>NEW</Text>
          </View>
        )}
      </View>
    );
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
        <Text style={styles.headerTitle}>Vouchers</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Redeem Code Section */}
      <View style={styles.redeemSection}>
        <Text style={styles.sectionTitle}>Redeem Code</Text>
        <View style={styles.redeemContainer}>
          <TextInput
            style={styles.codeInput}
            placeholder="Enter voucher code"
            placeholderTextColor="#999"
            value={voucherCode}
            onChangeText={setVoucherCode}
            autoCapitalize="characters"
          />
          <TouchableOpacity style={styles.redeemButton} onPress={handleRedeemCode}>
            <Text style={styles.redeemButtonText}>Apply</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'available' && styles.activeTab]}
          onPress={() => setActiveTab('available')}
        >
          <Text style={[styles.tabText, activeTab === 'available' && styles.activeTabText]}>
            Available Vouchers
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'saved' && styles.activeTab]}
          onPress={() => setActiveTab('saved')}
        >
          <Text style={[styles.tabText, activeTab === 'saved' && styles.activeTabText]}>
            My Vouchers ({myVouchers.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Vouchers List */}
      <ScrollView 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.vouchersContainer}
      >
        {activeTab === 'available' ? (
          availableVouchers.length > 0 ? (
            availableVouchers.map(voucher => renderVoucherCard(voucher, false))
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="ticket-outline" size={64} color="#ccc" />
              <Text style={styles.emptyStateText}>No vouchers available</Text>
              <Text style={styles.emptyStateSubtext}>Check back later for new offers!</Text>
            </View>
          )
        ) : (
          myVouchers.length > 0 ? (
            myVouchers.map(voucher => renderVoucherCard(voucher, true))
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="ticket-outline" size={64} color="#ccc" />
              <Text style={styles.emptyStateText}>No saved vouchers</Text>
              <Text style={styles.emptyStateSubtext}>
                Apply vouchers to save them here
              </Text>
            </View>
          )
        )}
      </ScrollView>

      {/* Apply Voucher Modal */}
      <Modal
        visible={showApplyModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowApplyModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Apply Voucher</Text>
              <TouchableOpacity onPress={() => setShowApplyModal(false)}>
                <Ionicons name="close" size={24} color="#000" />
              </TouchableOpacity>
            </View>
            
            {selectedVoucher && (
              <>
                <View style={styles.modalVoucherInfo}>
                  <Text style={styles.modalDiscount}>{selectedVoucher.discount}</Text>
                  <Text style={styles.modalCode}>{selectedVoucher.code}</Text>
                  <Text style={styles.modalDescription}>{selectedVoucher.description}</Text>
                  <View style={styles.modalDetails}>
                    <Text style={styles.modalDetailText}>
                      Minimum spend: {selectedVoucher.minSpend}
                    </Text>
                    <Text style={styles.modalDetailText}>
                      Expires: {selectedVoucher.expiry}
                    </Text>
                  </View>
                </View>
                
                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.cancelButton]}
                    onPress={() => setShowApplyModal(false)}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.confirmButton]}
                    onPress={confirmApplyVoucher}
                  >
                    <Text style={styles.confirmButtonText}>Apply Now</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
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
    marginTop: Platform.OS === 'ios' ? 0 : 30,
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
  placeholder: {
    width: 40,
  },
  redeemSection: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 12,
  },
  redeemContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  codeInput: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 14,
    color: '#000',
    backgroundColor: '#F9F9FB',
  },
  redeemButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  redeemButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#007AFF',
  },
  tabText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  activeTabText: {
    color: '#007AFF',
    fontWeight: '600',
  },
  vouchersContainer: {
    padding: 16,
  },
  voucherCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    position: 'relative',
  },
  voucherLeft: {
    flex: 1,
  },
  discountBadge: {
    backgroundColor: '#FF3B30',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 8,
  },
  discountText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  voucherCode: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
    marginBottom: 4,
  },
  voucherDescription: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
  },
  voucherDetails: {
    flexDirection: 'row',
    gap: 12,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailText: {
    fontSize: 11,
    color: '#666',
  },
  valid: {
    color: '#34C759',
  },
  expiringSoon: {
    color: '#FF9500',
  },
  expired: {
    color: '#FF3B30',
  },
  voucherRight: {
    justifyContent: 'center',
    paddingLeft: 12,
  },
  applyButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
  },
  applyButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  removeButton: {
    padding: 8,
  },
  newBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#FF3B30',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  newBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
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
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    width: '85%',
    maxWidth: 340,
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
  modalVoucherInfo: {
    alignItems: 'center',
    marginBottom: 24,
  },
  modalDiscount: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FF3B30',
    marginBottom: 8,
  },
  modalCode: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 8,
  },
  modalDescription: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  modalDetails: {
    alignItems: 'center',
    gap: 4,
  },
  modalDetailText: {
    fontSize: 12,
    color: '#999',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#F2F2F7',
  },
  confirmButton: {
    backgroundColor: '#007AFF',
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '500',
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});