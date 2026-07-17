import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

// Starts assumed-connected so the UI doesn't flash an "offline" banner on
// mount before NetInfo's first event arrives — it only flips to false once
// a real event confirms the device is actually offline.
export default function useNetworkStatus() {
  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsConnected(state.isConnected ?? false);
    });

    return () => unsubscribe();
  }, []);

  return { isConnected };
}
