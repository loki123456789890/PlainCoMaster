import React, { useState, useEffect } from 'react';
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
  Switch,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

// Sample saved addresses
const initialAddresses = [
  {
    id: '1',
    name: 'Home',
    address: '123 Main Street, Barangay San Antonio',
    city: 'Makati City',
    province: 'Metro Manila',
    zipCode: '1200',
    country: 'Philippines',
    phone: '+63 912 345 6789',
    isDefault: true,
    type: 'home',
    coordinates: {
      lat: 14.5547,
      lng: 121.0244,
    },
  },
  {
    id: '2',
    name: 'Office',
    address: '456 Ayala Avenue, Salcedo Village',
    city: 'Makati City',
    province: 'Metro Manila',
    zipCode: '1227',
    country: 'Philippines',
    phone: '+63 923 456 7890',
    isDefault: false,
    type: 'work',
    coordinates: {
      lat: 14.5547,
      lng: 121.0244,
    },
  },
  {
    id: '3',
    name: 'Condo',
    address: '789 BGC, 5th Avenue',
    city: 'Taguig City',
    province: 'Metro Manila',
    zipCode: '1630',
    country: 'Philippines',
    phone: '+63 934 567 8901',
    isDefault: false,
    type: 'other',
    coordinates: {
      lat: 14.5500,
      lng: 121.0500,
    },
  },
];

const regions = [
  'Metro Manila',
  'Calabarzon',
  'Central Luzon',
  'Ilocos Region',
  'Cagayan Valley',
  'Bicol Region',
  'Western Visayas',
  'Central Visayas',
  'Eastern Visayas',
  'Zamboanga Peninsula',
  'Northern Mindanao',
  'Davao Region',
  'Soccsksargen',
  'Caraga',
  'Cordillera Administrative Region',
  'Mimaropa',
];

export default function LocationScreen({ navigation }) {
  const [addresses, setAddresses] = useState(initialAddresses);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    city: '',
    province: '',
    zipCode: '',
    country: 'Philippines',
    phone: '',
    type: 'home',
    isDefault: false,
  });

  useEffect(() => {
    getCurrentLocation();
  }, []);

  const getCurrentLocation = async () => {
    setIsLoadingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Denied',
          'Allow location access to use this feature.',
          [{ text: 'OK' }]
        );
        setIsLoadingLocation(false);
        return;
      }

      const location = await Location.getCurrentPositionAsync({});
      const reverseGeocode = await Location.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });

      if (reverseGeocode.length > 0) {
        const address = reverseGeocode[0];
        setCurrentLocation({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          address: `${address.street || ''} ${address.name || ''}, ${address.city || ''}, ${address.region || ''}`,
          city: address.city || '',
          region: address.region || '',
        });
      }
    } catch (error) {
      console.log('Error getting location:', error);
      Alert.alert('Error', 'Unable to get your current location.');
    } finally {
      setIsLoadingLocation(false);
    }
  };

  const handleAddAddress = () => {
    setFormData({
      name: '',
      address: '',
      city: '',
      province: '',
      zipCode: '',
      country: 'Philippines',
      phone: '',
      type: 'home',
      isDefault: addresses.length === 0, // Make default if first address
    });
    setShowAddModal(true);
  };

  const handleEditAddress = (address) => {
    setSelectedAddress(address);
    setFormData({
      name: address.name,
      address: address.address,
      city: address.city,
      province: address.province,
      zipCode: address.zipCode,
      country: address.country,
      phone: address.phone,
      type: address.type,
      isDefault: address.isDefault,
    });
    setShowEditModal(true);
  };

  const handleDeleteAddress = (addressId) => {
    Alert.alert(
      'Delete Address',
      'Are you sure you want to delete this address?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const updatedAddresses = addresses.filter(addr => addr.id !== addressId);
            setAddresses(updatedAddresses);
            Alert.alert('Success', 'Address deleted successfully.');
          },
        },
      ]
    );
  };

  const saveAddress = () => {
    // Validation
    if (!formData.name.trim()) {
      Alert.alert('Error', 'Please enter a location name (e.g., Home, Office)');
      return;
    }
    if (!formData.address.trim()) {
      Alert.alert('Error', 'Please enter your street address');
      return;
    }
    if (!formData.city.trim()) {
      Alert.alert('Error', 'Please enter your city');
      return;
    }
    if (!formData.province.trim()) {
      Alert.alert('Error', 'Please select your province/region');
      return;
    }
    if (!formData.zipCode.trim()) {
      Alert.alert('Error', 'Please enter your zip code');
      return;
    }
    if (!formData.phone.trim()) {
      Alert.alert('Error', 'Please enter your phone number');
      return;
    }

    if (showEditModal && selectedAddress) {
      // Update existing address
      const updatedAddresses = addresses.map(addr => {
        if (addr.id === selectedAddress.id) {
          // If setting as default, update other addresses
          if (formData.isDefault) {
            return {
              ...addr,
              ...formData,
              isDefault: true,
            };
          }
          return { ...addr, ...formData };
        }
        // If current address is being set as default, remove default from others
        if (formData.isDefault) {
          return { ...addr, isDefault: false };
        }
        return addr;
      });
      setAddresses(updatedAddresses);
      Alert.alert('Success', 'Address updated successfully.');
    } else {
      // Add new address
      const newAddress = {
        id: Date.now().toString(),
        ...formData,
      };
      
      let updatedAddresses;
      if (formData.isDefault) {
        // Set all other addresses as non-default
        updatedAddresses = addresses.map(addr => ({ ...addr, isDefault: false }));
        updatedAddresses.push(newAddress);
      } else {
        updatedAddresses = [...addresses, newAddress];
      }
      setAddresses(updatedAddresses);
      Alert.alert('Success', 'Address added successfully.');
    }

    setShowAddModal(false);
    setShowEditModal(false);
    setSelectedAddress(null);
  };

  const setDefaultAddress = (addressId) => {
    const updatedAddresses = addresses.map(addr => ({
      ...addr,
      isDefault: addr.id === addressId,
    }));
    setAddresses(updatedAddresses);
    Alert.alert('Success', 'Default address updated.');
  };

  const getAddressTypeIcon = (type) => {
    switch (type) {
      case 'home':
        return 'home-outline';
      case 'work':
        return 'briefcase-outline';
      default:
        return 'location-outline';
    }
  };

  const getAddressTypeColor = (type) => {
    switch (type) {
      case 'home':
        return '#007AFF';
      case 'work':
        return '#34C759';
      default:
        return '#FF9500';
    }
  };

  const filteredAddresses = addresses.filter(addr =>
    addr.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    addr.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
    addr.city.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const useCurrentLocation = () => {
    if (currentLocation) {
      setFormData({
        ...formData,
        address: currentLocation.address.split(',')[0] || '',
        city: currentLocation.city || '',
        province: currentLocation.region || '',
      });
      setShowAddModal(true);
    } else {
      getCurrentLocation();
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
        <Text style={styles.headerTitle}>My Locations</Text>
        <TouchableOpacity onPress={handleAddAddress}>
          <Ionicons name="add-circle-outline" size={24} color="#007AFF" />
        </TouchableOpacity>
      </View>

      {/* Current Location Card */}
      <TouchableOpacity style={styles.currentLocationCard} onPress={useCurrentLocation}>
        <View style={styles.currentLocationIcon}>
          <Ionicons name="locate-outline" size={24} color="#007AFF" />
        </View>
        <View style={styles.currentLocationInfo}>
          <Text style={styles.currentLocationTitle}>Use Current Location</Text>
          {isLoadingLocation ? (
            <ActivityIndicator size="small" color="#007AFF" />
          ) : currentLocation ? (
            <Text style={styles.currentLocationAddress} numberOfLines={1}>
              {currentLocation.address}
            </Text>
          ) : (
            <Text style={styles.currentLocationAddress}>
              Tap to detect your location
            </Text>
          )}
        </View>
        <Ionicons name="chevron-forward" size={20} color="#999" />
      </TouchableOpacity>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={20} color="#999" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search addresses..."
          placeholderTextColor="#999"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={20} color="#999" />
          </TouchableOpacity>
        )}
      </View>

      {/* Addresses List */}
      <ScrollView 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.addressesContainer}
      >
        <Text style={styles.sectionTitle}>Saved Addresses</Text>
        
        {filteredAddresses.length > 0 ? (
          filteredAddresses.map((address) => (
            <View key={address.id} style={styles.addressCard}>
              <View style={styles.addressHeader}>
                <View style={styles.addressTypeContainer}>
                  <Ionicons 
                    name={getAddressTypeIcon(address.type)} 
                    size={20} 
                    color={getAddressTypeColor(address.type)} 
                  />
                  <Text style={[styles.addressName, { color: getAddressTypeColor(address.type) }]}>
                    {address.name}
                  </Text>
                  {address.isDefault && (
                    <View style={styles.defaultBadge}>
                      <Text style={styles.defaultBadgeText}>Default</Text>
                    </View>
                  )}
                </View>
                <View style={styles.addressActions}>
                  <TouchableOpacity 
                    onPress={() => handleEditAddress(address)}
                    style={styles.actionButton}
                  >
                    <Ionicons name="create-outline" size={20} color="#007AFF" />
                  </TouchableOpacity>
                  <TouchableOpacity 
                    onPress={() => handleDeleteAddress(address.id)}
                    style={styles.actionButton}
                  >
                    <Ionicons name="trash-outline" size={20} color="#FF3B30" />
                  </TouchableOpacity>
                </View>
              </View>
              
              <Text style={styles.addressDetail}>{address.address}</Text>
              <Text style={styles.addressDetail}>
                {address.city}, {address.province}
              </Text>
              <Text style={styles.addressDetail}>
                {address.zipCode}, {address.country}
              </Text>
              <Text style={styles.addressDetail}>📞 {address.phone}</Text>
              
              {!address.isDefault && (
                <TouchableOpacity
                  style={styles.setDefaultButton}
                  onPress={() => setDefaultAddress(address.id)}
                >
                  <Text style={styles.setDefaultButtonText}>Set as Default</Text>
                </TouchableOpacity>
              )}
            </View>
          ))
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="location-outline" size={64} color="#ccc" />
            <Text style={styles.emptyStateText}>No saved addresses</Text>
            <Text style={styles.emptyStateSubtext}>
              Add your first address to get started
            </Text>
            <TouchableOpacity style={styles.addButton} onPress={handleAddAddress}>
              <Text style={styles.addButtonText}>Add Address</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Add/Edit Address Modal */}
      <Modal
        visible={showAddModal || showEditModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          setShowAddModal(false);
          setShowEditModal(false);
        }}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {showEditModal ? 'Edit Address' : 'Add New Address'}
              </Text>
              <TouchableOpacity onPress={() => {
                setShowAddModal(false);
                setShowEditModal(false);
              }}>
                <Ionicons name="close" size={24} color="#000" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Location Name */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Location Name *</Text>
                <View style={styles.typeSelector}>
                  {['home', 'work', 'other'].map((type) => (
                    <TouchableOpacity
                      key={type}
                      style={[
                        styles.typeButton,
                        formData.type === type && styles.typeButtonActive,
                      ]}
                      onPress={() => setFormData({ ...formData, type })}
                    >
                      <Ionicons 
                        name={getAddressTypeIcon(type)} 
                        size={20} 
                        color={formData.type === type ? '#fff' : getAddressTypeColor(type)} 
                      />
                      <Text style={[
                        styles.typeButtonText,
                        formData.type === type && styles.typeButtonTextActive,
                      ]}>
                        {type.charAt(0).toUpperCase() + type.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="e.g., Home, Office, Condo"
                  placeholderTextColor="#999"
                  value={formData.name}
                  onChangeText={(text) => setFormData({ ...formData, name: text })}
                />
              </View>

              {/* Street Address */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Street Address *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="House number, street, barangay"
                  placeholderTextColor="#999"
                  value={formData.address}
                  onChangeText={(text) => setFormData({ ...formData, address: text })}
                  multiline
                />
              </View>

              {/* City */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>City *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter city"
                  placeholderTextColor="#999"
                  value={formData.city}
                  onChangeText={(text) => setFormData({ ...formData, city: text })}
                />
              </View>

              {/* Province/Region */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Province/Region *</Text>
                <View style={styles.pickerContainer}>
                  <TextInput
                    style={styles.input}
                    placeholder="Select or enter province/region"
                    placeholderTextColor="#999"
                    value={formData.province}
                    onChangeText={(text) => setFormData({ ...formData, province: text })}
                  />
                </View>
              </View>

              {/* Zip Code */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Zip Code *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter zip code"
                  placeholderTextColor="#999"
                  value={formData.zipCode}
                  onChangeText={(text) => setFormData({ ...formData, zipCode: text })}
                  keyboardType="numeric"
                />
              </View>

              {/* Phone Number */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Phone Number *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="+63 XXX XXX XXXX"
                  placeholderTextColor="#999"
                  value={formData.phone}
                  onChangeText={(text) => setFormData({ ...formData, phone: text })}
                  keyboardType="phone-pad"
                />
              </View>

              {/* Default Address Switch */}
              <View style={styles.switchContainer}>
                <Text style={styles.switchLabel}>Set as default address</Text>
                <Switch
                  value={formData.isDefault}
                  onValueChange={(value) => setFormData({ ...formData, isDefault: value })}
                  trackColor={{ false: '#E5E5EA', true: '#007AFF' }}
                  thumbColor="#fff"
                />
              </View>

              {/* Use Current Location Button */}
              <TouchableOpacity style={styles.useLocationButton} onPress={useCurrentLocation}>
                <Ionicons name="location-outline" size={20} color="#007AFF" />
                <Text style={styles.useLocationButtonText}>Use Current Location</Text>
              </TouchableOpacity>
            </ScrollView>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  setShowAddModal(false);
                  setShowEditModal(false);
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.saveButton]}
                onPress={saveAddress}
              >
                <Text style={styles.saveButtonText}>Save Address</Text>
              </TouchableOpacity>
            </View>
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
  currentLocationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9F9FB',
    margin: 20,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  currentLocationIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E3F2FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  currentLocationInfo: {
    flex: 1,
  },
  currentLocationTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  currentLocationAddress: {
    fontSize: 12,
    color: '#666',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9F9FB',
    marginHorizontal: 20,
    marginBottom: 20,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 44,
    fontSize: 14,
    color: '#000',
  },
  addressesContainer: {
    paddingHorizontal: 20,
    paddingBottom: 30,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 16,
  },
  addressCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  addressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  addressTypeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addressName: {
    fontSize: 16,
    fontWeight: '600',
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
  addressActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    padding: 4,
  },
  addressDetail: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  setDefaultButton: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F2F2F7',
  },
  setDefaultButtonText: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: '500',
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
    marginBottom: 24,
  },
  addButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 14,
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
  typeSelector: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  typeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
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
  pickerContainer: {
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 12,
    backgroundColor: '#F9F9FB',
  },
  switchContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingVertical: 12,
  },
  switchLabel: {
    fontSize: 14,
    color: '#000',
  },
  useLocationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    marginBottom: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#007AFF',
    backgroundColor: '#E3F2FF',
  },
  useLocationButtonText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#F2F2F7',
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#F2F2F7',
  },
  saveButton: {
    backgroundColor: '#007AFF',
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '500',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});