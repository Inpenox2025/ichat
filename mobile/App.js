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
import GroupDetailsModal from './src/screens/GroupDetailsModal';

// Import Services
import { connectWebSocket, disconnectWebSocket, sendSocketMessage, addSocketListener } from './src/services/websocket';
import { decryptAsymmetric, decryptSymmetric, encryptAsymmetric, encryptSymmetric, decodeBase64, encodeBase64, decodeUTF8, encodeUTF8, nacl } from './src/services/crypto';
import { registerForPushNotificationsAsync, presentLocalNotification } from './src/services/notifications';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Bottom Tabs Navigator (Chats & Settings)
function MainTabs({
  chats,
  groups,
  messages,
  activeTab,
  onSwitchTab,
  onSelectChat,
  onSelectGroup,
  onCreateGroup,
  onDeleteSelectedChats,
  onDeleteSelectedGroups,
  onExitSelectedGroups,
  onAcceptRequest,
  onDeclineRequest,
  onRestoreCompleted,
  onLogout,
  serverUrl,
  token,
  user,
  selectedTheme,
  onThemeChange
}) {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ color, size }) => {
          let iconName;
          if (route.name === 'ChatsTab') {
            iconName = 'chatbubbles-outline';
          } else if (route.name === 'Settings') {
            iconName = 'settings-outline';
          }
          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#38bdf8',
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
      <Tab.Screen name="ChatsTab" options={{ title: 'Messages' }}>
        {(props) => (
          <ChatListScreen
            {...props}
            chats={chats}
            groups={groups}
            messages={messages}
            activeTab={activeTab}
            onSwitchTab={onSwitchTab}
            onSelectChat={onSelectChat}
            onSelectGroup={onSelectGroup}
            onCreateGroup={onCreateGroup}
            onDeleteSelectedChats={onDeleteSelectedChats}
            onDeleteSelectedGroups={onDeleteSelectedGroups}
            onExitSelectedGroups={onExitSelectedGroups}
            onAcceptRequest={onAcceptRequest}
            onDeclineRequest={onDeclineRequest}
            serverUrl={serverUrl}
            token={token}
            currentUsername={user?.username}
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

  // Chat & Group Data State
  const [chats, setChats] = useState([]);
  const [groups, setGroups] = useState([]);
  const [messages, setMessages] = useState([]);
  const [outbox, setOutbox] = useState([]);
  const [activePartner, setActivePartner] = useState(null);
  const [activeGroup, setActiveGroup] = useState(null);
  const [activeTab, setActiveTab] = useState('home');

  // Group Details Modal State
  const [groupDetailsGroup, setGroupDetailsGroup] = useState(null);
  const [showGroupDetailsModal, setShowGroupDetailsModal] = useState(false);

  // Real-time Event States
  const [typingPartner, setTypingPartner] = useState(null);
  const [callState, setCallState] = useState(null);

  // Refs to avoid stale closures in socket listener
  const stateRef = useRef({ token, user, serverUrl, chats, groups, messages, outbox, activePartner, activeGroup });
  stateRef.current = { token, user, serverUrl, chats, groups, messages, outbox, activePartner, activeGroup };

  const navigationRef = useRef(null);

  // Initialize App and Load Local Data
  useEffect(() => {
    async function loadInitialData() {
      try {
        const savedToken = await AsyncStorage.getItem('ichat_token');
        const savedUser = await AsyncStorage.getItem('ichat_user');
        const savedServer = await AsyncStorage.getItem('ichat_server_url');
        const savedTheme = await AsyncStorage.getItem('ichat_theme') || 'system';
        const savedTab = await AsyncStorage.getItem('ichat_active_tab') || 'home';

        if (savedToken && savedUser && savedServer) {
          setToken(savedToken);
          setUser(JSON.parse(savedUser));
          setServerUrl(savedServer);
          setActiveTab(savedTab);
          
          // Load chat & group database
          const savedChats = await AsyncStorage.getItem('ichat_chats');
          const savedGroups = await AsyncStorage.getItem('ichat_groups');
          const savedMsgs = await AsyncStorage.getItem('ichat_messages');
          const savedOutbox = await AsyncStorage.getItem('ichat_outbox');

          if (savedChats) setChats(JSON.parse(savedChats));
          if (savedGroups) setGroups(JSON.parse(savedGroups));
          if (savedMsgs) setMessages(JSON.parse(savedMsgs));
          if (savedOutbox) setOutbox(JSON.parse(savedOutbox));
        }
        setTheme(savedTheme);
        registerForPushNotificationsAsync();
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

    connectWebSocket(serverUrl, token);

    const unsubscribe = addSocketListener(async (data) => {
      const current = stateRef.current;

      if (data.type === 'auth-success') {
        console.log('[WS Mobile] Authenticated!');
        flushOutboxQueue();
        return;
      }

      if (data.type === 'message') {
        await handleIncomingMessage(data);
        return;
      }

      if (data.type === 'group_updated') {
        if (data.group && data.group.id) {
          setGroups(prev => {
            const idx = prev.findIndex(g => g.id === data.group.id);
            let updated;
            if (idx === -1) {
              updated = [...prev, data.group];
            } else {
              updated = [...prev];
              updated[idx] = { ...updated[idx], ...data.group };
            }
            AsyncStorage.setItem('ichat_groups', JSON.stringify(updated));
            return updated;
          });
        }
        return;
      }

      if (data.type === 'typing') {
        const { sender, isTyping, status } = data;
        const activeState = typeof isTyping !== 'undefined' ? isTyping : status;
        if (activeState) {
          setTypingPartner(sender);
        } else {
          setTypingPartner(null);
        }
        return;
      }

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

      if (data.type === 'call-offer') {
        const { sender } = data;
        setCallState({ partner: sender, status: 'ringing' });
        presentLocalNotification({
          title: `Incoming Voice Call`,
          body: `@${sender} is calling you. Tap to join encrypted call.`,
          data: { type: 'call', sender }
        });
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

  // Decode E2EE message packets (including Group Messages)
  async function handleIncomingMessage(data) {
    const current = stateRef.current;
    const { messageId, sender, recipient, key, payload, timestamp, media, isSenderSync, isGroup, groupId, groupName } = data;
    const partner = isGroup ? groupId : (isSenderSync ? recipient : sender);

    if (current.messages.some(m => m.id === messageId)) return;

    try {
      const sqlPayload = JSON.parse(payload);
      
      const res = await fetch(`${current.serverUrl}/api/users/keys?username=${sender}`, {
        headers: { 'Authorization': `Bearer ${current.token}` }
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.error);

      const myPriv = await AsyncStorage.getItem('ichat_identity_key_private');
      const myPrivBytes = decodeBase64(myPriv);

      let decryptedBody = '';
      const allKnownDevices = [...(result.recipient_devices || []), ...(result.sender_other_devices || [])];

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
        isGroup: !!isGroup,
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

      const updatedMessages = [...current.messages, newMsg];
      setMessages(updatedMessages);
      await AsyncStorage.setItem('ichat_messages', JSON.stringify(updatedMessages));

      if (isGroup) {
        setGroups(prev => {
          const idx = prev.findIndex(g => g.id === groupId);
          let updated = [...prev];
          if (idx !== -1) {
            updated[idx] = {
              ...updated[idx],
              unreadCount: current.activeGroup?.id === groupId ? 0 : (updated[idx].unreadCount || 0) + 1
            };
          } else {
            updated.push({
              id: groupId,
              name: groupName || 'Group',
              createdBy: sender,
              members: [sender, current.user.username],
              unreadCount: 1
            });
          }
          AsyncStorage.setItem('ichat_groups', JSON.stringify(updated));
          return updated;
        });
      } else {
        const updatedChats = [...current.chats];
        const chatIdx = updatedChats.findIndex(c => c.username === partner);
        if (chatIdx === -1) {
          updatedChats.push({ username: partner, email: '', unreadCount: current.activePartner === partner ? 0 : 1 });
        } else if (current.activePartner !== partner) {
          updatedChats[chatIdx].unreadCount = (updatedChats[chatIdx].unreadCount || 0) + 1;
        }
        setChats(updatedChats);
        await AsyncStorage.setItem('ichat_chats', JSON.stringify(updatedChats));
      }

      // Present local push notification if conversation is not currently open
      if (!isSenderSync && sender !== current.user?.username) {
        if (isGroup && current.activeGroup?.id !== groupId) {
          presentLocalNotification({
            title: `${groupName || 'Group Chat'} • @${sender}`,
            body: decryptedBody || (media ? `📷 Sent attachment: ${media.filename}` : 'New encrypted message'),
            data: { groupId }
          });
        } else if (!isGroup && current.activePartner !== partner) {
          presentLocalNotification({
            title: `@${sender}`,
            body: decryptedBody || (media ? `📷 Sent attachment: ${media.filename}` : 'New encrypted message'),
            data: { username: partner }
          });
        }
      }

      if (!isSenderSync && !isGroup) {
        sendSocketMessage({
          type: 'ack-delivered',
          messageId,
          senderOfMessage: sender
        });
      }

      if (!isGroup && current.activePartner === partner) {
        sendSocketMessage({
          type: 'ack-read',
          messageId,
          senderOfMessage: sender
        });
        newMsg.status = 'read';
        await AsyncStorage.setItem('ichat_messages', JSON.stringify(updatedMessages));
      }

    } catch (err) {
      console.error('[WS Mobile] Decrypt message failed:', err);
    }
  }

  async function flushOutboxQueue() {
    const current = stateRef.current;
    if (current.outbox.length === 0) return;

    const remainingOutbox = [...current.outbox];
    while (remainingOutbox.length > 0) {
      const packet = remainingOutbox[0];
      const sent = sendSocketMessage(packet);
      if (sent) {
        remainingOutbox.shift();
      } else {
        break;
      }
    }

    setOutbox(remainingOutbox);
    await AsyncStorage.setItem('ichat_outbox', JSON.stringify(remainingOutbox));
  }

  // Handle Send Message (1-on-1 and Group)
  async function handleSendMessage(actionObj) {
    const current = stateRef.current;

    if (actionObj.type === 'typing') {
      const isTypingState = typeof actionObj.isTyping !== 'undefined' ? actionObj.isTyping : actionObj.status;
      const packet = {
        type: 'typing',
        sender: current.user?.username || '',
        recipient: actionObj.recipient,
        isTyping: isTypingState,
        status: isTypingState
      };

      const sent = sendSocketMessage(packet);
      if (!sent && current.token && current.serverUrl) {
        fetch(`${current.serverUrl}/api/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${current.token}`
          },
          body: JSON.stringify({ recipient: actionObj.recipient, packet })
        }).catch(() => {});
      }
      return;
    }

    const timestamp = new Date().toISOString();
    const messageId = 'msg-' + Math.random().toString(36).substring(2, 15);
    const { type, recipient, group, body, media } = actionObj;

    if (type === 'group_message' && group) {
      // Group E2EE Dispatches
      const sessionKey = nacl.randomBytes(32);
      const nonce = nacl.randomBytes(24);
      const content = encryptSymmetric(body || '', sessionKey);

      const myPriv = await AsyncStorage.getItem('ichat_identity_key_private');
      const myPrivBytes = decodeBase64(myPriv);

      const otherMembers = group.members.filter(m => m !== current.user.username);

      for (const member of otherMembers) {
        try {
          const res = await fetch(`${current.serverUrl}/api/users/keys?username=${member}`, {
            headers: { 'Authorization': `Bearer ${current.token}` }
          });
          const result = await res.json();
          if (!result.success) continue;

          const keysMap = {};
          for (const dev of (result.recipient_devices || [])) {
            const devPub = decodeBase64(dev.public_key);
            keysMap[dev.device_id] = encryptAsymmetric(devPub, myPrivBytes, sessionKey, nonce);
          }

          const payload = { encryptedBody: content.ciphertext, nonce: content.nonce };
          const packet = {
            type: 'message',
            messageId,
            recipient: member,
            isGroup: true,
            groupId: group.id,
            groupName: group.name,
            keys: keysMap,
            payload: JSON.stringify(payload),
            timestamp,
            media
          };

          sendSocketMessage(packet);
        } catch (e) {}
      }

      // Save locally
      const localMsgObj = {
        id: messageId,
        chatPartner: group.id,
        sender: current.user.username,
        body,
        timestamp,
        isGroup: true,
        media: media ? {
          url: media.url,
          filename: media.filename,
          type: media.type,
          size: media.size
        } : null,
        status: 'sent'
      };

      const updatedMessages = [...current.messages, localMsgObj];
      setMessages(updatedMessages);
      await AsyncStorage.setItem('ichat_messages', JSON.stringify(updatedMessages));
      return;
    }

    // 1-on-1 Message Dispatch
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
      return;
    }

    const sessionKey = nacl.randomBytes(32);
    const nonce = nacl.randomBytes(24);
    const content = encryptSymmetric(body || '', sessionKey);

    const keysMap = {};
    const myPriv = await AsyncStorage.getItem('ichat_identity_key_private');
    const myPrivBytes = decodeBase64(myPriv);

    for (const dev of recipientKeys) {
      const devPub = decodeBase64(dev.public_key);
      keysMap[dev.device_id] = encryptAsymmetric(devPub, myPrivBytes, sessionKey, nonce);
    }

    for (const dev of senderOtherKeys) {
      const devPub = decodeBase64(dev.public_key);
      keysMap[dev.device_id] = encryptAsymmetric(devPub, myPrivBytes, sessionKey, nonce);
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
      media
    };

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

    const sent = sendSocketMessage(messagePacket);
    if (!sent) {
      const updatedOutbox = [...current.outbox, messagePacket];
      setOutbox(updatedOutbox);
      await AsyncStorage.setItem('ichat_outbox', JSON.stringify(updatedOutbox));
    }
  }

  // Create Group Handler
  const handleCreateGroup = (name, selectedUsernames) => {
    const groupId = 'group-' + Date.now();
    const allMembers = Array.from(new Set([user.username, ...selectedUsernames]));

    const newGroupObj = {
      id: groupId,
      name,
      createdBy: user.username,
      members: allMembers,
      unreadCount: 0
    };

    setGroups(prev => {
      const updated = [...prev, newGroupObj];
      AsyncStorage.setItem('ichat_groups', JSON.stringify(updated));
      return updated;
    });

    // Notify all members
    const updatePacket = {
      type: 'group_updated',
      group: newGroupObj
    };

    allMembers.forEach(m => {
      if (m !== user.username) {
        sendSocketMessage({ ...updatePacket, recipient: m });
      }
    });
  };

  // Group Details Actions
  const handleAddMembersToGroup = (groupId, newMembers) => {
    setGroups(prev => {
      const updated = prev.map(g => {
        if (g.id === groupId) {
          const combined = Array.from(new Set([...g.members, ...newMembers]));
          const updatedGroup = { ...g, members: combined };
          
          const updatePacket = { type: 'group_updated', group: updatedGroup };
          combined.forEach(m => {
            if (m !== user.username) sendSocketMessage({ ...updatePacket, recipient: m });
          });

          return updatedGroup;
        }
        return g;
      });
      AsyncStorage.setItem('ichat_groups', JSON.stringify(updated));
      return updated;
    });
  };

  const handleExitGroup = (groupId) => {
    setGroups(prev => {
      const targetGroup = prev.find(g => g.id === groupId);
      if (targetGroup) {
        const remaining = targetGroup.members.filter(m => m !== user.username);
        const updatedGroup = { ...targetGroup, members: remaining };

        const updatePacket = { type: 'group_updated', group: updatedGroup };
        remaining.forEach(m => {
          sendSocketMessage({ ...updatePacket, recipient: m });
        });
      }

      const updated = prev.filter(g => g.id !== groupId);
      AsyncStorage.setItem('ichat_groups', JSON.stringify(updated));
      return updated;
    });
  };

  const handleDeleteGroup = (groupId) => {
    setGroups(prev => {
      const updated = prev.filter(g => g.id !== groupId);
      AsyncStorage.setItem('ichat_groups', JSON.stringify(updated));
      return updated;
    });

    setMessages(prev => {
      const updated = prev.filter(m => m.chatPartner !== groupId);
      AsyncStorage.setItem('ichat_messages', JSON.stringify(updated));
      return updated;
    });
  };

  // Selection Actions
  const handleDeleteSelectedChats = (selectedUsernames) => {
    setChats(prev => {
      const updated = prev.filter(c => !selectedUsernames.includes(c.username));
      AsyncStorage.setItem('ichat_chats', JSON.stringify(updated));
      return updated;
    });

    setMessages(prev => {
      const updated = prev.filter(m => !selectedUsernames.includes(m.chatPartner));
      AsyncStorage.setItem('ichat_messages', JSON.stringify(updated));
      return updated;
    });
  };

  const handleDeleteSelectedGroups = (selectedGroupIds) => {
    selectedGroupIds.forEach(id => handleDeleteGroup(id));
  };

  const handleExitSelectedGroups = (selectedGroupIds) => {
    selectedGroupIds.forEach(id => handleExitGroup(id));
  };

  const handleAcceptRequest = (username) => {
    setChats(prev => {
      const updated = prev.map(c => c.username === username ? { ...c, status: 'accepted' } : c);
      AsyncStorage.setItem('ichat_chats', JSON.stringify(updated));
      return updated;
    });
  };

  const handleDeclineRequest = (username) => {
    setChats(prev => {
      const updated = prev.filter(c => c.username !== username);
      AsyncStorage.setItem('ichat_chats', JSON.stringify(updated));
      return updated;
    });
  };

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

  async function handleSelectChat(username) {
    setActivePartner(username);
    setActiveGroup(null);
    setChats(prev => {
      const updated = prev.map(c => c.username === username ? { ...c, unreadCount: 0 } : c);
      AsyncStorage.setItem('ichat_chats', JSON.stringify(updated));
      return updated;
    });
  }

  async function handleSelectGroup(groupObj) {
    setActiveGroup(groupObj);
    setActivePartner(null);
    setGroups(prev => {
      const updated = prev.map(g => g.id === groupObj.id ? { ...g, unreadCount: 0 } : g);
      AsyncStorage.setItem('ichat_groups', JSON.stringify(updated));
      return updated;
    });
  }

  const handleSwitchTab = (tabName) => {
    setActiveTab(tabName);
    AsyncStorage.setItem('ichat_active_tab', tabName);
  };

  async function handleAuthSuccess(newToken, newUser, newServer) {
    setToken(newToken);
    setUser(newUser);
    setServerUrl(newServer);

    try {
      await fetch(`${newServer}/api/setup`, { method: 'POST' });
    } catch (e) {}

    const savedChats = await AsyncStorage.getItem('ichat_chats');
    const savedGroups = await AsyncStorage.getItem('ichat_groups');
    const savedMsgs = await AsyncStorage.getItem('ichat_messages');
    if (savedChats) setChats(JSON.parse(savedChats));
    if (savedGroups) setGroups(JSON.parse(savedGroups));
    if (savedMsgs) setMessages(JSON.parse(savedMsgs));
  }

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
    setGroups([]);
    setMessages([]);
    setOutbox([]);
    AsyncStorage.clear();
  }

  function handleHangupCall() {
    setCallState(null);
  }

  if (loading) {
    return null;
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
                  groups={groups}
                  messages={messages}
                  activeTab={activeTab}
                  onSwitchTab={handleSwitchTab}
                  onSelectChat={handleSelectChat}
                  onSelectGroup={handleSelectGroup}
                  onCreateGroup={handleCreateGroup}
                  onDeleteSelectedChats={handleDeleteSelectedChats}
                  onDeleteSelectedGroups={handleDeleteSelectedGroups}
                  onExitSelectedGroups={handleExitSelectedGroups}
                  onAcceptRequest={handleAcceptRequest}
                  onDeclineRequest={handleDeclineRequest}
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
                  onOpenGroupDetails={(group) => {
                    setGroupDetailsGroup(group);
                    setShowGroupDetailsModal(true);
                  }}
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

        {/* Global Group Details Modal */}
        <GroupDetailsModal
          visible={showGroupDetailsModal}
          onClose={() => setShowGroupDetailsModal(false)}
          group={groupDetailsGroup}
          currentUser={user}
          contacts={chats}
          onAddMembers={handleAddMembersToGroup}
          onExitGroup={handleExitGroup}
          onDeleteGroup={handleDeleteGroup}
        />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
