import { useState, useEffect, useRef } from 'react';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

let Notifications: any = null;
try {
  // Gracefully handle expo-notifications crash in Expo Go SDK 53+
  Notifications = require('expo-notifications');
} catch (error) {
  console.warn('expo-notifications is not supported in this client environment (Expo Go SDK 53+).');
}

// Set default notification handler behavior if available
if (Notifications) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export const usePushNotifications = () => {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [notification, setNotification] = useState<any>(null);
  
  const notificationListener = useRef<any>(null);
  const responseListener = useRef<any>(null);

  const registerForPushNotificationsAsync = async (): Promise<string | null> => {
    let token = null;

    if (!Notifications) {
      console.log('Notifications module not available. Bypassing push registration.');
      return null;
    }

    if (!Device.isDevice) {
      console.log('Must use physical device for Push Notifications');
      return null;
    }

    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.warn('Failed to get push token for push notification!');
        return null;
      }

      // Resolve projectId from expoConfig safely
      const projectId =
        Constants.expoConfig?.extra?.eas?.projectId ??
        Constants.easConfig?.projectId;

      token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      console.log('🏍️ Expo Push Token generated:', token);
    } catch (error) {
      console.error('Error generating Expo Push Token:', error);
    }

    if (Platform.OS === 'android') {
      try {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF6B00', // KTM Orange
        });
      } catch (channelError) {
        console.error('Failed to set notification channel:', channelError);
      }
    }

    return token;
  };

  useEffect(() => {
    if (!Notifications) return;

    // Register token
    registerForPushNotificationsAsync().then(token => {
      if (token) setExpoPushToken(token);
    });

    // Handle notifications received while app is foregrounded
    notificationListener.current = Notifications.addNotificationReceivedListener(
      (notification: any) => {
        setNotification(notification);
      }
    );

    // Handle user tapping on/interacting with notification
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response: any) => {
        console.log('User tapped on notification:', response.notification.request.content.data);
      }
    );

    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, []);

  return {
    expoPushToken,
    notification,
  };
};
