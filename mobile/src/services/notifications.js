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

export async function registerForPushNotificationsAsync() {
  try {
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
    // Trigger subtle vibration pattern
    Vibration.vibrate([0, 150, 100, 150]);

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
        data,
      },
      trigger: null, // Display immediately
    });
  } catch (err) {
    console.warn('[NOTIFICATIONS PRESENT ERROR]', err);
  }
}
