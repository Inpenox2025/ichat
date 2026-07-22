import React, { useState, useEffect, useRef } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

// Import Screens
import AuthScreen from './src/screens/AuthScreen';
import ChatListScreen from './src/screens/ChatListScreen';
import ChatScreen from './src/screens/ChatScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import CallScreen from './src/screens/CallScreen';

// Import Services
import { connectWebSocket, disconnectWebSocket, sendSocketMessage, addSocketListener } from './src/services/websocket';
import { decryptAsymmetric, decryptSymmetric, encryptAsymmetric, encryptSymmetric, decodeBase64, encodeBase64, decodeUTF8, encodeUTF8, nacl } from './src/services/crypto';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Bottom Tabs Navigator (Chats & Settings)
function MainTabs({ chats, messages, onSelectChat, onRestoreCompleted, onLogout, serverUrl, token, user, selectedTheme, onThemeChange }) {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ color, size }) => {
          let iconName;
          if (route.name === 'Chats') {
            iconName = 'chatbubbles-outline';
          } else if (route.name === 'Settings') {
            iconName = 'settings-outline';
          }
          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#00f2fe',
        tabBarInactiveTintColor: '#718096',
        tabBarStyle: {
          backgroundColor: '#161c2d',
          borderTopWidth: 1,
          borderTopColor: 'rgba(255,255,255,0.06)',
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        headerStyle: {
          backgroundColor: '#161c2d',
          borderBottomWidth: 1,
          borderBottomColor: 'rgba(255,255,255,0.06)',
        },
        headerTitleStyle: {
          color: '#fff',
          fontWeight: '700',
        },
      })}
    >
      <Tab.Screen name="Chats">
        {(props) => (
          <ChatListScreen
            {...props}
            chats={chats}
            messages={messages}
            onSelectChat={onSelectChat}
            serverUrl={serverUrl}
            token={token}
          />
        )}
      </Tab.Screen>
      <Tab.Screen name="Settings">
        {(props) => (
          <SettingsScreen
            {...props}
            chats={chats}
            messages={messages}
            onRestoreCompleted={onRestoreCompleted}
            onLogout={onLogout}
            serverUrl={serverUrl}
            token={token}
            user={user}
            selectedTheme={selectedTheme}
            onThemeChange={onThemeChange}
          />
        )}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

export default function App() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [serverUrl, setServerUrl] = useState(null);
  const [theme, setTheme] = useState('system');
  const [loading, setLoading] = useState(true);

  // Chat Data State
  const [chats, setChats] = useState([]);
  const [messages, setMessages] = useState([]);
  const [outbox, setOutbox] = useState([]);
  const [activePartner, setActivePartner] = useState(null);

  // Real-time Event States
  const [typingPartner, setTypingPartner] = useState(null); // username that is typing
  const [callState, setCallState] = useState(null); // { partner, status: 'ringing'|'connected'|'disconnected' }

  // Refs to avoid stale closures in socket listener
  const stateRef = useRef({ token, user, serverUrl, chats, messages, outbox, activePartner });
  stateRef.current = { token, user, serverUrl, chats, messages, outbox, activePartner };

  const navigationRef = useRef(null);

  // Initialize App and Load Local Data
  useEffect(() => {
    async function loadInitialData() {
      try {
        const savedToken = await AsyncStorage.getItem('ichat_token');
        const savedUser = await AsyncStorage.getItem('ichat_user');
        const savedServer = await AsyncStorage.getItem('ichat_server_url');
        const savedTheme = await AsyncStorage.getItem('ichat_theme') || 'system';

        if (savedToken && savedUser && savedServer) {
          setToken(savedToken);
          setUser(JSON.parse(savedUser));
          setServerUrl(savedServer);
          
          // Load chat database
          const savedChats = await AsyncStorage.getItem('ichat_chats');
          const savedMsgs = await AsyncStorage.getItem('ichat_messages');
          const savedOutbox = await AsyncStorage.getItem('ichat_outbox');

          if (savedChats) setChats(JSON.parse(savedChats));
          if (savedMsgs) setMessages(JSON.parse(savedMsgs));
          if (savedOutbox) setOutbox(JSON.parse(savedOutbox));
        }
        setTheme(savedTheme);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    loadInitialData();
  }, []);

  // Manage WebSocket connection and messaging router
  useEffect(() => {
    if (!token || !serverUrl) return;

    // Connect
    connectWebSocket(serverUrl, token);

    // Register listener
    const unsubscribe = addSocketListener(async (data) => {
      const current = stateRef.current;

      // 1. Auth Success
      if (data.type === 'auth-success') {
        console.log('[WS Mobile] Authenticated!');
        flushOutboxQueue();
        return;
      }

      // 2. Incoming Encrypted Message
      if (data.type === 'message') {
        await handleIncomingMessage(data);
        return;
      }

      // 3. Typing Indicators
      if (data.type === 'typing') {
        const { sender, status } = data;
        if (status) {
          setTypingPartner(sender);
        } else {
          setTypingPartner(null);
        }
        return;
      }

      // 4. Delivery/Read Receipt Checks
      if (data.type === 'ack') {
        const { messageId, status } = data;
        setMessages(prev => {
          const idx = prev.findIndex(m => m.id === messageId);
          if (idx !== -1) {
            const updated = [...prev];
            const currentStatus = updated[idx].status;
            if (status === 'read' || (status === 'delivered' && currentStatus !== 'read')) {
              updated[idx] = { ...updated[idx], status };
              AsyncStorage.setItem('ichat_messages', JSON.stringify(updated));
              return updated;
            }
          }
          return prev;
        });
        return;
      }

      // 5. Incoming Calling signaling invitation
      if (data.type === 'call-offer') {
        const { sender } = data;
        setCallState({ partner: sender, status: 'ringing' });
        // Navigate call Screen
        navigationRef.current?.navigate('Call', { username: sender, direction: 'incoming' });
        return;
      }

      if (data.type === 'call-answer') {
        setCallState(prev => prev ? { ...prev, status: 'connected' } : null);
        return;
      }

      if (data.type === 'call-hangup') {
        setCallState(null);
        return;
      }
    });

    return () => {
      unsubscribe();
      disconnectWebSocket();
    };
  }, [token, serverUrl]);

  // Decode E2EE message packets
  async function handleIncomingMessage(data) {
    const current = stateRef.current;
    const { messageId, sender, recipient, key, payload, timestamp, media, isSenderSync } = data;
    const partner = isSenderSync ? recipient : sender;

    // Check duplicates
    if (current.messages.some(m => m.id === messageId)) return;

    try {
      const sqlPayload = JSON.parse(payload);
      
      // Fetch public keys of sender
      const res = await fetch(`${current.serverUrl}/api/users/keys?username=${sender}`, {
        headers: { 'Authorization': `Bearer ${current.token}` }
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.error);

      // Fetch own private key from local system
      const myPriv = await AsyncStorage.getItem('ichat_identity_key_private');
      const myPrivBytes = decodeBase64(myPriv);

      let decryptedBody = '';
      const allKnownDevices = [...result.recipient_devices, ...result.sender_other_devices];

      for (const dev of allKnownDevices) {
        try {
          const devPub = decodeBase64(dev.public_key);
          const nonceBytes = decodeBase64(sqlPayload.nonce);
          const decryptedSessionKey = decryptAsymmetric(devPub, myPrivBytes, key, nonceBytes);
          if (decryptedSessionKey) {
            decryptedBody = decryptSymmetric(sqlPayload.encryptedBody, sqlPayload.nonce, decryptedSessionKey);
            break;
          }
        } catch (e) {}
      }

      if (!decryptedBody && !media) {
        decryptedBody = '[Decryption error: Shared key mismatch]';
      }

      const newMsg = {
        id: messageId,
        chatPartner: partner,
        sender,
        body: decryptedBody,
        timestamp,
        media: media ? {
          url: media.url,
          filename: media.filename,
          type: media.type,
          size: media.size,
          encryptedKey: media.encryptedKeyBase64,
          mediaNonce: media.mediaNonceBase64
        } : null,
        status: 'delivered'
      };

      // Append message
      const updatedMessages = [...current.messages, newMsg];
      setMessages(updatedMessages);
      await AsyncStorage.setItem('ichat_messages', JSON.stringify(updatedMessages));

      // Append chat room
      const updatedChats = [...current.chats];
      const chatIdx = updatedChats.findIndex(c => c.username === partner);
      if (chatIdx === -1) {
        updatedChats.push({ username: partner, email: '', unreadCount: current.activePartner === partner ? 0 : 1 });
      } else if (current.activePartner !== partner) {
        updatedChats[chatIdx].unreadCount = (updatedChats[chatIdx].unreadCount || 0) + 1;
      }
      setChats(updatedChats);
      await AsyncStorage.setItem('ichat_chats', JSON.stringify(updatedChats));

      // Delivered receipt ack back to sender (skip self syncs)
      if (!isSenderSync) {
        sendSocketMessage({
          type: 'ack-delivered',
          messageId,
          senderOfMessage: sender
        });
      }

      // Read receipt automatic trigger if open
      if (current.activePartner === partner) {
        sendSocketMessage({
          type: 'ack-read',
          messageId,
          senderOfMessage: sender
        });
        // Update local status as read
        newMsg.status = 'read';
        await AsyncStorage.setItem('ichat_messages', JSON.stringify(updatedMessages));
      }

    } catch (err) {
      console.error('[WS Mobile] Decrypt message failed:', err);
    }
  }

  // Flush mobile outbox on socket restore
  async function flushOutboxQueue() {
    const current = stateRef.current;
    if (current.outbox.length === 0) return;

    console.log(`[WS Mobile] Flushing outbox queue of ${current.outbox.length} messages.`);
    const remainingOutbox = [...current.outbox];
    
    while (remainingOutbox.length > 0) {
      const packet = remainingOutbox[0];
      const sent = sendSocketMessage(packet);
      if (sent) {
        remainingOutbox.shift();
      } else {
        break; // socket disconnected again
      }
    }

    setOutbox(remainingOutbox);
    await AsyncStorage.setItem('ichat_outbox', JSON.stringify(remainingOutbox));
  }

  // Handle message sending flows
  async function handleSendMessage(actionObj) {
    const current = stateRef.current;

    // Typing statuses signals
    if (actionObj.type === 'typing') {
      sendSocketMessage(actionObj);
      return;
    }

    // Text & Media Dispatch
    const timestamp = new Date().toISOString();
    const messageId = 'msg-' + Math.random().toString(36).substring(2, 15);
    const { recipient, body, media } = actionObj;

    // 1. Fetch public keys of recipient's devices and my other devices
    let recipientKeys, senderOtherKeys;
    try {
      const res = await fetch(`${current.serverUrl}/api/users/keys?username=${recipient}`, {
        headers: { 'Authorization': `Bearer ${current.token}` }
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.error);
      recipientKeys = result.recipient_devices;
      senderOtherKeys = result.sender_other_devices;
    } catch (err) {
      Alert.alert('E2EE Failure', 'Failed to acquire security keys.');
      return;
    }

    // 2. Generate E2EE session keys
    const sessionKey = nacl.randomBytes(32);
    const nonce = nacl.randomBytes(24);

    // 3. Encrypt payload
    const content = encryptSymmetric(body || '', sessionKey);

    // 4. Encrypt session key for all recipient/sender devices
    const keysMap = {};
    const myPriv = await AsyncStorage.getItem('ichat_identity_key_private');
    const myPrivBytes = decodeBase64(myPriv);

    for (const dev of recipientKeys) {
      const devPub = decodeBase64(dev.public_key);
      const encKey = encryptAsymmetric(devPub, myPrivBytes, sessionKey, nonce);
      keysMap[dev.device_id] = encKey;
    }

    for (const dev of senderOtherKeys) {
      const devPub = decodeBase64(dev.public_key);
      const encKey = encryptAsymmetric(devPub, myPrivBytes, sessionKey, nonce);
      keysMap[dev.device_id] = encKey;
    }

    const payload = {
      encryptedBody: content.ciphertext,
      nonce: content.nonce
    };

    const messagePacket = {
      type: 'message',
      messageId,
      recipient,
      keys: keysMap,
      payload: JSON.stringify(payload),
      timestamp,
      media // { url, filename, type, size, encryptedKeyBase64, mediaNonceBase64 }
    };

    // 5. Append locally
    const localMsgObj = {
      id: messageId,
      chatPartner: recipient,
      sender: current.user.username,
      body,
      timestamp,
      media: media ? {
        url: media.url,
        filename: media.filename,
        type: media.type,
        size: media.size
      } : null,
      status: 'pending'
    };

    const updatedMessages = [...current.messages, localMsgObj];
    setMessages(updatedMessages);
    await AsyncStorage.setItem('ichat_messages', JSON.stringify(updatedMessages));

    // Send
    const sent = sendSocketMessage(messagePacket);
    if (!sent) {
      // Buffer to outbox
      const updatedOutbox = [...current.outbox, messagePacket];
      setOutbox(updatedOutbox);
      await AsyncStorage.setItem('ichat_outbox', JSON.stringify(updatedOutbox));
    }
  }

  // Trigger read tick ack
  function handleSendReadReceipt(messageId, senderOfMessage) {
    sendSocketMessage({
      type: 'ack-read',
      messageId,
      senderOfMessage
    });

    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === messageId);
      if (idx !== -1) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], status: 'read' };
        AsyncStorage.setItem('ichat_messages', JSON.stringify(updated));
        return updated;
      }
      return prev;
    });
  }

  // Handle select chat and clearing unreads
  async function handleSelectChat(username) {
    setActivePartner(username);
    
    // Clear unreads
    setChats(prev => {
      const updated = prev.map(c => c.username === username ? { ...c, unreadCount: 0 } : c);
      AsyncStorage.setItem('ichat_chats', JSON.stringify(updated));
      return updated;
    });
  }

  // Handle Auth Session login
  async function handleAuthSuccess(newToken, newUser, newServer) {
    setToken(newToken);
    setUser(newUser);
    setServerUrl(newServer);

    // Initial setup table pulls
    try {
      await fetch(`${newServer}/api/setup`, { method: 'POST' });
    } catch (e) {}

    // Load initial storage elements
    const savedChats = await AsyncStorage.getItem('ichat_chats');
    const savedMsgs = await AsyncStorage.getItem('ichat_messages');
    if (savedChats) setChats(JSON.parse(savedChats));
    if (savedMsgs) setMessages(JSON.parse(savedMsgs));
  }

  // Handle Restore database imports
  function handleRestoreCompleted(restoredChats, restoredMessages) {
    setChats(restoredChats);
    setMessages(restoredMessages);
  }

  function handleLogout() {
    disconnectWebSocket();
    setToken(null);
    setUser(null);
    setServerUrl(null);
    setChats([]);
    setMessages([]);
    setOutbox([]);
    AsyncStorage.clear();
  }

  function handleHangupCall() {
    setCallState(null);
  }

  if (loading) {
    return null; // Splash handles initial loaders
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer ref={navigationRef}>
        {!token ? (
          <AuthScreen onAuthSuccess={handleAuthSuccess} />
        ) : (
          <Stack.Navigator
            screenOptions={{
              headerStyle: {
                backgroundColor: '#161c2d',
              },
              headerTintColor: '#fff',
              headerTitleStyle: {
                fontWeight: '700',
              },
              contentStyle: {
                backgroundColor: '#0c101a',
              }
            }}
          >
            {/* Main bottom tabs */}
            <Stack.Screen name="MainTabs" options={{ headerShown: false }}>
              {(props) => (
                <MainTabs
                  {...props}
                  chats={chats}
                  messages={messages}
                  onSelectChat={handleSelectChat}
                  onRestoreCompleted={handleRestoreCompleted}
                  onLogout={handleLogout}
                  serverUrl={serverUrl}
                  token={token}
                  user={user}
                  selectedTheme={theme}
                  onThemeChange={(mode) => {
                    setTheme(mode);
                    AsyncStorage.setItem('ichat_theme', mode);
                  }}
                />
              )}
            </Stack.Screen>

            {/* Chat conversation view screen */}
            <Stack.Screen name="Chat" options={{ headerShown: false }}>
              {(props) => (
                <ChatScreen
                  {...props}
                  messages={messages}
                  onSendMessage={handleSendMessage}
                  onSendReadReceipt={handleSendReadReceipt}
                  typingStatus={typingPartner === props.route.params.username}
                  serverUrl={serverUrl}
                  token={token}
                  currentUsername={user?.username}
                />
              )}
            </Stack.Screen>

            {/* Call Screen overlay */}
            <Stack.Screen name="Call" options={{ headerShown: false }}>
              {(props) => (
                <CallScreen
                  {...props}
                  onSendMessage={handleSendMessage}
                  callState={callState}
                  onHangupCall={handleHangupCall}
                />
              )}
            </Stack.Screen>
          </Stack.Navigator>
        )}
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
