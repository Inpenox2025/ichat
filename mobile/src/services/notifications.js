import { Platform, Vibration } from 'react-native';
import * as Notifications from 'expo-notifications';

// Configure notification behavior for foreground mode
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Configure interactive notification categories (Mark as Read & Inline Reply)
export async function setupNotificationCategories() {
  try {
    if (Platform.OS === 'web') return;

    await Notifications.setNotificationCategoryAsync('message', [
      {
        identifier: 'MARK_READ',
        buttonTitle: '✓ Mark as Read',
        options: {
          isAuthenticationRequired: false,
          isDestructive: false,
        },
      },
      {
        identifier: 'REPLY',
        buttonTitle: '💬 Reply',
        textInput: {
          submitButtonTitle: 'Send',
          placeholder: 'Type a quick reply...',
        },
        options: {
          isAuthenticationRequired: false,
        },
      },
    ]);
  } catch (err) {
    console.warn('[NOTIFICATIONS CATEGORY ERROR]', err);
  }
}

export async function registerForPushNotificationsAsync() {
  try {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        try { await Notification.requestPermission(); } catch (e) {}
      }
      return true;
    }

    await setupNotificationCategories();

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      console.log('[NOTIFICATIONS] Permission not granted for local notifications.');
      return false;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#38bdf8',
      });
    }

    return true;
  } catch (err) {
    console.warn('[NOTIFICATIONS INIT ERROR]', err);
    return false;
  }
}

export async function presentLocalNotification({ title, body, data = {} }) {
  try {
    // 1. Mobile (Android / iOS)
    if (Platform.OS !== 'web') {
      Vibration.vibrate([0, 150, 100, 150]);
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          sound: true,
          categoryIdentifier: 'message', // Enables Mark as Read & Reply interactive buttons
          data,
        },
        trigger: null, // Display immediately
      });
      return;
    }

    // 2. Web Browser Desktop Notifications API
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification(title, {
          body,
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag: data?.chatPartner || 'ichat-msg'
        });
      } else if (Notification.permission !== 'denied') {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          new Notification(title, {
            body,
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            tag: data?.chatPartner || 'ichat-msg'
          });
        }
      }
    }
  } catch (err) {
    console.warn('[NOTIFICATIONS PRESENT ERROR]', err);
  }
}
