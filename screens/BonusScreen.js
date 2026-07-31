import React, { useState, useEffect } from 'react';
import {
View,
Text,
StyleSheet,
ScrollView,
TouchableOpacity,
Platform,
Dimensions,
Modal,
Alert,
Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';  // <- Changed import
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

const { width } = Dimensions.get('window');

// Sample user bonus data
const userBonusData = {
points: 1250,
tier: 'Gold',
nextTierPoints: 2000,
nextTierName: 'Platinum',
pointsToNextTier: 750,
totalEarned: 3250,
totalRedeemed: 2000,
joinDate: 'January 2024',
};

// Sample bonus history
const bonusHistory = [
{
id: '1',
title: 'Birthday Bonus',
points: 500,
type: 'credit',
date: '2024-07-15',
description: 'Happy Birthday! Special bonus points',
},
{
id: '2',
title: 'Purchase Reward',
points: 150,
type: 'credit',
date: '2024-07-10',
description: 'Earned from order #ORD-12345',
},
{
id: '3',
title: 'Redeemed Voucher',
points: 200,
type: 'debit',
date: '2024-07-05',
description: '$20 off voucher redeemed',
},
{
id: '4',
title: 'Referral Bonus',
points: 300,
type: 'credit',
date: '2024-06-28',
description: 'Friend joined using your referral code',
},
{
id: '5',
title: 'Product Review',
points: 50,
type: 'credit',
date: '2024-06-20',
description: 'Reviewed White T-shirt',
},
{
id: '6',
title: 'Redeemed Voucher',
points: 150,
type: 'debit',
date: '2024-06-15',
description: '$15 off voucher redeemed',
},
];

// Available rewards to redeem
const availableRewards = [
{
id: 'r1',
title: '$10 OFF Voucher',
points: 500,
description: 'Get $10 off on your next purchase',
discount: '$10',
minSpend: '$50',
icon: 'cash-outline',
color: '#FF9500',
},
{
id: 'r2',
title: '$20 OFF Voucher',
points: 1000,
description: 'Get $20 off on your next purchase',
discount: '$20',
minSpend: '$100',
icon: 'card-outline',
color: '#FF3B30',
},
{
id: 'r3',
title: 'Free Shipping',
points: 300,
description: 'Free shipping on any order',
discount: 'Free',
minSpend: '$0',
icon: 'car-outline',
color: '#34C759',
},
{
id: 'r4',
title: '15% OFF Voucher',
points: 800,
description: 'Get 15% off on your next purchase',
discount: '15%',
minSpend: '$75',
icon: 'percent-outline',
color: '#AF52DE',
},
{
id: 'r5',
title: 'Free Item',
points: 1500,
description: 'Get a free accessory with purchase',
discount: 'Free Item',
minSpend: '$100',
icon: 'gift-outline',
color: '#007AFF',
},
];

export default function BonusScreen({ navigation }) {
const [points, setPoints] = useState(userBonusData.points);
const [selectedReward, setSelectedReward] = useState(null);
const [showRedeemModal, setShowRedeemModal] = useState(false);
const [showHistory, setShowHistory] = useState(false);
const [progressAnim] = useState(new Animated.Value(0));
const [pointsAnim] = useState(new Animated.Value(0));

const progressPercentage = (points / userBonusData.nextTierPoints) * 100;
const pointsToNextTier = userBonusData.nextTierPoints - points;

useEffect(() => {
Animated.timing(progressAnim, {
toValue: progressPercentage,
duration: 1000,
useNativeDriver: false,
}).start();

Animated.timing(pointsAnim, {
toValue: points,
duration: 1500,
useNativeDriver: false,
}).start();
}, [points]);

const getTierColor = () => {
switch (userBonusData.tier) {
case 'Bronze':
return '#CD7F32';
case 'Silver':
return '#C0C0C0';
case 'Gold':
return '#FFD700';
case 'Platinum':
return '#E5E4E2';
default:
return '#FFD700';
}
};

const getTierIcon = () => {
switch (userBonusData.tier) {
case 'Bronze':
return 'medal-outline';
case 'Silver':
return 'star-outline';
case 'Gold':
return 'trophy-outline';
case 'Platinum':
return 'diamond-outline';
default:
return 'trophy-outline';
}
};

const handleRedeem = (reward) => {
if (points >= reward.points) {
setSelectedReward(reward);
setShowRedeemModal(true);
} else {
Alert.alert(
'Insufficient Points',
`You need ${reward.points - points} more points to redeem this reward.`,
[{ text: 'OK' }]
);
}
};

const confirmRedeem = () => {
if (!selectedReward) {
return;
}

const newPoints = points - selectedReward.points;
setPoints(newPoints);

const newHistory = {
id: Date.now().toString(),
title: `Redeemed: ${selectedReward.title}`,
points: selectedReward.points,
type: 'debit',
date: new Date().toISOString().split('T')[0],
description: `Redeemed ${selectedReward.discount} voucher`,
};
bonusHistory.unshift(newHistory);

setShowRedeemModal(false);
setSelectedReward(null);
Alert.alert(
'Success!',
`You have successfully redeemed ${selectedReward.title}. Check your vouchers!`,
[{ text: 'OK' }]
);
};

const closeModal = () => {
setShowRedeemModal(false);
setSelectedReward(null);
};

const getPointsEarnedThisMonth = () => {
const currentMonth = new Date().getMonth();
const monthlyEarnings = bonusHistory
.filter(item => {
const itemDate = new Date(item.date);
return item.type === 'credit' && itemDate.getMonth() === currentMonth;
})
.reduce((sum, item) => sum + item.points, 0);
return monthlyEarnings;
};

const formatDate = (dateString) => {
const date = new Date(dateString);
return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const getPointValue = (points) => {
return (points / 100).toFixed(2);
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
<Text style={styles.headerTitle}>Bonus Points</Text>
<TouchableOpacity onPress={() => setShowHistory(!showHistory)}>
<Ionicons name="time-outline" size={24} color="#000" />
</TouchableOpacity>
</View>

<ScrollView showsVerticalScrollIndicator={false}>
{/* Points Card */}
<LinearGradient
colors={[getTierColor(), getTierColor() + 'CC']}
start={{ x: 0, y: 0 }}
end={{ x: 1, y: 1 }}
style={styles.pointsCard}
>
<View style={styles.pointsHeader}>
<View>
<Text style={styles.pointsLabel}>Total Points</Text>
<Animated.Text style={styles.pointsValue}>
{pointsAnim.interpolate({
inputRange: [0, points],
outputRange: ['0', points.toString()],
})}
</Animated.Text>
</View>
<View style={styles.tierBadge}>
<Ionicons name={getTierIcon()} size={20} color="#fff" />
<Text style={styles.tierText}>{userBonusData.tier}</Text>
</View>
</View>

<View style={styles.pointsValueInfo}>
<View style={styles.valueItem}>
<Text style={styles.valueLabel}>Points Value</Text>
<Text style={styles.valueAmount}>${getPointValue(points)}</Text>
</View>
<View style={styles.divider} />
<View style={styles.valueItem}>
<Text style={styles.valueLabel}>Lifetime Earned</Text>
<Text style={styles.valueAmount}>{userBonusData.totalEarned}</Text>
</View>
</View>
</LinearGradient>

{/* Progress to Next Tier */}
<View style={styles.progressSection}>
<View style={styles.progressHeader}>
<Text style={styles.progressTitle}>
{pointsToNextTier > 0
? `${pointsToNextTier} points to ${userBonusData.nextTierName}`
: `Congratulations! You've reached ${userBonusData.nextTierName} Tier!`}
</Text>
<Text style={styles.progressPercentage}>{Math.round(progressPercentage)}%</Text>
</View>
<View style={styles.progressBar}>
<Animated.View
style={[
styles.progressFill,
{
width: progressAnim.interpolate({
inputRange: [0, 100],
outputRange: ['0%', '100%'],
}),
backgroundColor: getTierColor()
}
]}
/>
</View>
<View style={styles.tierInfo}>
<Text style={styles.tierInfoText}>
Member since {userBonusData.joinDate}
</Text>
</View>
</View>

{/* Quick Stats */}
<View style={styles.statsContainer}>
<View style={styles.statCard}>
<Ionicons name="calendar-outline" size={24} color="#007AFF" />
<Text style={styles.statValue}>{getPointsEarnedThisMonth()}</Text>
<Text style={styles.statLabel}>Points This Month</Text>
</View>
<View style={styles.statCard}>
<Ionicons name="gift-outline" size={24} color="#FF9500" />
<Text style={styles.statValue}>{userBonusData.totalRedeemed}</Text>
<Text style={styles.statLabel}>Points Redeemed</Text>
</View>
</View>

{/* Ways to Earn Points */}
<View style={styles.section}>
<Text style={styles.sectionTitle}>Ways to Earn Points</Text>
<View style={styles.earnGrid}>
<View style={styles.earnItem}>
<Ionicons name="cart-outline" size={32} color="#34C759" />
<Text style={styles.earnTitle}>Make a Purchase</Text>
<Text style={styles.earnPoints}>10 points/$1</Text>
</View>
<View style={styles.earnItem}>
<Ionicons name="star-outline" size={32} color="#FF9500" />
<Text style={styles.earnTitle}>Write a Review</Text>
<Text style={styles.earnPoints}>50 points/review</Text>
</View>
<View style={styles.earnItem}>
<Ionicons name="people-outline" size={32} color="#007AFF" />
<Text style={styles.earnTitle}>Refer a Friend</Text>
<Text style={styles.earnPoints}>300 points/referral</Text>
</View>
<View style={styles.earnItem}>
<Ionicons name="gift-outline" size={32} color="#AF52DE" />
<Text style={styles.earnTitle}>Birthday Bonus</Text>
<Text style={styles.earnPoints}>500 points/year</Text>
</View>
</View>
</View>

{/* Available Rewards - FIXED with consistent heights */}
<View style={styles.section}>
<Text style={styles.sectionTitle}>Redeem Rewards</Text>
<ScrollView
horizontal
showsHorizontalScrollIndicator={false}
style={styles.rewardsScroll}
contentContainerStyle={styles.rewardsScrollContent}
>
{availableRewards.map((reward) => (
<TouchableOpacity
key={reward.id}
style={styles.rewardCard}
onPress={() => handleRedeem(reward)}
>
<View style={[styles.rewardIcon, { backgroundColor: reward.color + '20' }]}>
<Ionicons name={reward.icon} size={32} color={reward.color} />
</View>
<Text style={styles.rewardTitle}>{reward.title}</Text>
<Text style={styles.rewardDescription} numberOfLines={2}>
{reward.description}
</Text>
<Text style={styles.rewardPoints}>{reward.points} points</Text>
<View style={styles.rewardMinSpend}>
<Text style={styles.rewardMinSpendText}>
Min. spend {reward.minSpend}
</Text>
</View>
<View style={styles.redeemButtonContainer}>
<TouchableOpacity
style={[
styles.redeemButton,
points >= reward.points ? styles.redeemButtonActive : styles.redeemButtonDisabled
]}
onPress={() => handleRedeem(reward)}
>
<Text style={styles.redeemButtonText}>
{points >= reward.points ? 'Redeem' : 'Need More Points'}
</Text>
</TouchableOpacity>
</View>
</TouchableOpacity>
))}
</ScrollView>
</View>

{/* Bonus History */}
{showHistory && (
<View style={styles.section}>
<Text style={styles.sectionTitle}>Points History</Text>
{bonusHistory.map((item) => (
<View key={item.id} style={styles.historyItem}>
<View style={styles.historyIcon}>
<Ionicons
name={item.type === 'credit' ? 'add-circle-outline' : 'remove-circle-outline'}
size={24}
color={item.type === 'credit' ? '#34C759' : '#FF3B30'}
/>
</View>
<View style={styles.historyInfo}>
<Text style={styles.historyTitle}>{item.title}</Text>
<Text style={styles.historyDescription}>{item.description}</Text>
<Text style={styles.historyDate}>{formatDate(item.date)}</Text>
</View>
<Text style={[
styles.historyPoints,
item.type === 'credit' ? styles.creditPoints : styles.debitPoints
]}>
{item.type === 'credit' ? '+' : '-'}{item.points}
</Text>
</View>
))}
</View>
)}
</ScrollView>

{/* Redeem Modal */}
<Modal
visible={showRedeemModal}
transparent={true}
animationType="fade"
onRequestClose={closeModal}
>
<View style={styles.modalOverlay}>
<View style={styles.modalContent}>
<View style={styles.modalHeader}>
<Text style={styles.modalTitle}>Redeem Reward</Text>
<TouchableOpacity onPress={closeModal}>
<Ionicons name="close" size={24} color="#000" />
</TouchableOpacity>
</View>

{selectedReward && (
<>
<View style={styles.modalRewardInfo}>
<View style={[styles.modalRewardIcon, { backgroundColor: selectedReward.color + '20' }]}>
<Ionicons name={selectedReward.icon} size={48} color={selectedReward.color} />
</View>
<Text style={styles.modalRewardTitle}>{selectedReward.title}</Text>
<Text style={styles.modalRewardDescription}>{selectedReward.description}</Text>
<View style={styles.modalPointsContainer}>
<Text style={styles.modalPointsLabel}>Cost:</Text>
<Text style={styles.modalPointsValue}>{selectedReward.points} points</Text>
</View>
<View style={styles.modalBalanceContainer}>
<Text style={styles.modalBalanceLabel}>Your Balance:</Text>
<Text style={styles.modalBalanceValue}>{points} points</Text>
</View>
</View>

<View style={styles.modalButtons}>
<TouchableOpacity
style={[styles.modalButton, styles.cancelButton]}
onPress={closeModal}
>
<Text style={styles.cancelButtonText}>Cancel</Text>
</TouchableOpacity>
<TouchableOpacity
style={[styles.modalButton, styles.confirmButton]}
onPress={confirmRedeem}
>
<Text style={styles.confirmButtonText}>Confirm Redeem</Text>
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
pointsCard: {
margin: 20,
padding: 20,
borderRadius: 20,
shadowColor: '#000',
shadowOffset: { width: 0, height: 4 },
shadowOpacity: 0.1,
shadowRadius: 12,
elevation: 5,
},
pointsHeader: {
flexDirection: 'row',
justifyContent: 'space-between',
alignItems: 'center',
marginBottom: 20,
},
pointsLabel: {
fontSize: 14,
color: '#fff',
opacity: 0.9,
marginBottom: 4,
},
pointsValue: {
fontSize: 48,
fontWeight: '700',
color: '#fff',
},
tierBadge: {
flexDirection: 'row',
alignItems: 'center',
backgroundColor: 'rgba(255, 255, 255, 0.2)',
paddingHorizontal: 12,
paddingVertical: 6,
borderRadius: 20,
gap: 6,
},
tierText: {
color: '#fff',
fontSize: 14,
fontWeight: '600',
},
pointsValueInfo: {
flexDirection: 'row',
justifyContent: 'space-between',
paddingTop: 20,
borderTopWidth: 1,
borderTopColor: 'rgba(255, 255, 255, 0.2)',
},
valueItem: {
flex: 1,
alignItems: 'center',
},
valueLabel: {
fontSize: 12,
color: '#fff',
opacity: 0.8,
marginBottom: 4,
},
valueAmount: {
fontSize: 18,
fontWeight: '600',
color: '#fff',
},
divider: {
width: 1,
backgroundColor: 'rgba(255, 255, 255, 0.2)',
},
progressSection: {
paddingHorizontal: 20,
marginBottom: 20,
},
progressHeader: {
flexDirection: 'row',
justifyContent: 'space-between',
marginBottom: 8,
},
progressTitle: {
fontSize: 14,
color: '#666',
},
progressPercentage: {
fontSize: 14,
fontWeight: '600',
color: '#000',
},
progressBar: {
height: 8,
backgroundColor: '#E5E5EA',
borderRadius: 4,
overflow: 'hidden',
},
progressFill: {
height: '100%',
borderRadius: 4,
},
tierInfo: {
marginTop: 8,
},
tierInfoText: {
fontSize: 12,
color: '#999',
},
statsContainer: {
flexDirection: 'row',
paddingHorizontal: 20,
gap: 12,
marginBottom: 20,
},
statCard: {
flex: 1,
backgroundColor: '#F9F9FB',
borderRadius: 12,
padding: 16,
alignItems: 'center',
},
statValue: {
fontSize: 24,
fontWeight: '700',
color: '#000',
marginTop: 8,
},
statLabel: {
fontSize: 12,
color: '#666',
marginTop: 4,
},
section: {
marginBottom: 24,
},
sectionTitle: {
fontSize: 18,
fontWeight: '600',
color: '#000',
marginHorizontal: 20,
marginBottom: 16,
},
earnGrid: {
flexDirection: 'row',
flexWrap: 'wrap',
paddingHorizontal: 12,
},
earnItem: {
width: (width - 40) / 2,
backgroundColor: '#F9F9FB',
borderRadius: 12,
padding: 16,
margin: 8,
alignItems: 'center',
},
earnTitle: {
fontSize: 14,
fontWeight: '600',
color: '#000',
marginTop: 8,
marginBottom: 4,
},
earnPoints: {
fontSize: 12,
color: '#666',
},
rewardsScroll: {
paddingHorizontal: 16,
},
rewardsScrollContent: {
paddingRight: 16,
},
rewardCard: {
width: 200,
backgroundColor: '#fff',
borderRadius: 12,
padding: 16,
marginRight: 12,
borderWidth: 1,
borderColor: '#E5E5EA',
// Fixed height to ensure consistency
minHeight: 280,
justifyContent: 'space-between',
},
rewardIcon: {
width: 60,
height: 60,
borderRadius: 30,
justifyContent: 'center',
alignItems: 'center',
marginBottom: 12,
alignSelf: 'center',
},
rewardTitle: {
fontSize: 16,
fontWeight: '600',
color: '#000',
marginBottom: 6,
textAlign: 'center',
},
rewardDescription: {
fontSize: 12,
color: '#666',
marginBottom: 8,
textAlign: 'center',
minHeight: 36,
},
rewardPoints: {
fontSize: 14,
fontWeight: '700',
color: '#FF9500',
marginBottom: 8,
textAlign: 'center',
},
rewardMinSpend: {
marginBottom: 12,
alignItems: 'center',
},
rewardMinSpendText: {
fontSize: 10,
color: '#999',
},
redeemButtonContainer: {
marginTop: 'auto',
},
redeemButton: {
paddingVertical: 10,
borderRadius: 8,
alignItems: 'center',
justifyContent: 'center',
},
redeemButtonActive: {
backgroundColor: '#007AFF',
},
redeemButtonDisabled: {
backgroundColor: '#E5E5EA',
},
redeemButtonText: {
fontSize: 12,
fontWeight: '600',
color: '#fff',
},
historyItem: {
flexDirection: 'row',
alignItems: 'center',
paddingHorizontal: 20,
paddingVertical: 12,
borderBottomWidth: 1,
borderBottomColor: '#F2F2F7',
},
historyIcon: {
marginRight: 12,
},
historyInfo: {
flex: 1,
},
historyTitle: {
fontSize: 14,
fontWeight: '500',
color: '#000',
marginBottom: 2,
},
historyDescription: {
fontSize: 12,
color: '#666',
marginBottom: 2,
},
historyDate: {
fontSize: 11,
color: '#999',
},
historyPoints: {
fontSize: 14,
fontWeight: '600',
},
creditPoints: {
color: '#34C759',
},
debitPoints: {
color: '#FF3B30',
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
modalRewardInfo: {
alignItems: 'center',
marginBottom: 24,
},
modalRewardIcon: {
width: 80,
height: 80,
borderRadius: 40,
justifyContent: 'center',
alignItems: 'center',
marginBottom: 16,
},
modalRewardTitle: {
fontSize: 20,
fontWeight: '600',
color: '#000',
marginBottom: 8,
},
modalRewardDescription: {
fontSize: 14,
color: '#666',
textAlign: 'center',
marginBottom: 16,
},
modalPointsContainer: {
flexDirection: 'row',
justifyContent: 'space-between',
width: '100%',
marginBottom: 8,
},
modalPointsLabel: {
fontSize: 14,
color: '#666',
},
modalPointsValue: {
fontSize: 14,
fontWeight: '600',
color: '#FF9500',
},
modalBalanceContainer: {
flexDirection: 'row',
justifyContent: 'space-between',
width: '100%',
},
modalBalanceLabel: {
fontSize: 14,
color: '#666',
},
modalBalanceValue: {
fontSize: 14,
fontWeight: '600',
color: '#000',
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