import React, { useState, useEffect } from 'react';
import {
  StyleSheet, Text, View, ScrollView, TextInput, TouchableOpacity,
  Alert, ActivityIndicator, StatusBar, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { pbkdf2Sync, encryptSymmetric, decryptSymmetric, decodeBase64, encodeBase64 } from '../services/crypto';
import { useTheme } from '../context/ThemeContext';

// Conditionally import file-system APIs (not available on web)
let FileSystem = null;
let Sharing = null;
let DocumentPicker = null;
if (Platform.OS !== 'web') {
  FileSystem = require('expo-file-system');
  Sharing = require('expo-sharing');
  DocumentPicker = require('expo-document-picker');
}

function SectionHead({ icon, title, C }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
      <Ionicons name={icon} size={20} color={C.accent} />
      <Text style={{ color: C.text, fontWeight: '700', fontSize: 15, marginLeft: 8 }}>{title}</Text>
    </View>
  );
}

function Card({ children, style, C }) {
  return (
    <View style={[{ backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 16, marginBottom: 10 }, style]}>
      {children}
    </View>
  );
}

export default function SettingsScreen({ navigation, chats, messages, onRestoreCompleted, onLogout, serverUrl, token, user }) {
  const { colors: C, selectedTheme, changeTheme } = useTheme();

  const [backupPass, setBackupPass] = useState('');
  const [restorePass, setRestorePass] = useState('');
  const [actionLoading, setActionLoading] = useState(null);
  const [textStorageSize, setTextStorageSize] = useState('0 KB');
  const [mediaStorageSize, setMediaStorageSize] = useState('0 MB');
  const [backupStatus, setBackupStatus] = useState('Never');
  const [chatStorageList, setChatStorageList] = useState([]);
  const [expandedChats, setExpandedChats] = useState({});
  const [backupSchedule, setBackupSchedule] = useState('never');
  const [backupStatusMsg, setBackupStatusMsg] = useState('');
  const [restoreStatusMsg, setRestoreStatusMsg] = useState('');

  // Auto-dismiss success/error status messages after 4 seconds
  useEffect(() => {
    if (backupStatusMsg && (backupStatusMsg.startsWith('✅') || backupStatusMsg.startsWith('❌'))) {
      const timer = setTimeout(() => setBackupStatusMsg(''), 4000);
      return () => clearTimeout(timer);
    }
  }, [backupStatusMsg]);

  useEffect(() => {
    if (restoreStatusMsg && (restoreStatusMsg.startsWith('✅') || restoreStatusMsg.startsWith('❌'))) {
      const timer = setTimeout(() => setRestoreStatusMsg(''), 4000);
      return () => clearTimeout(timer);
    }
  }, [restoreStatusMsg]);

  useEffect(() => {
    AsyncStorage.getItem('ichat_backup_schedule').then(s => { if (s) setBackupSchedule(s); });
  }, []);

  useEffect(() => {
    calculateStorageSizes();
    loadBackupStatus();
    calculatePerChatStorage();
  }, [chats, messages]);

  async function loadBackupStatus() {
    const s = await AsyncStorage.getItem('ichat_backup_status');
    if (s) setBackupStatus(s);
  }

  async function handleScheduleChange(mode) {
    setBackupSchedule(mode);
    await AsyncStorage.setItem('ichat_backup_schedule', mode);
  }

  async function calculateStorageSizes() {
    const rawText = JSON.stringify(messages) + JSON.stringify(chats);
    setTextStorageSize(`${(rawText.length / 1024).toFixed(1)} KB`);
    if (Platform.OS === 'web') {
      setMediaStorageSize('N/A (web)');
      return;
    }
    try {
      const files = await FileSystem.readDirectoryAsync(FileSystem.documentDirectory);
      let total = 0;
      for (const f of files) {
        const info = await FileSystem.getInfoAsync(`${FileSystem.documentDirectory}${f}`);
        if (info.exists && !info.isDirectory) total += info.size;
      }
      setMediaStorageSize(`${(total / (1024 * 1024)).toFixed(2)} MB`);
    } catch (e) {}
  }

  function calculatePerChatStorage() {
    const list = chats.map(chat => {
      const chatMsgs = messages.filter(m => m.chatPartner === chat.username);
      const textBytes = JSON.stringify(chatMsgs).length;
      const mediaFiles = chatMsgs.filter(m => m.media);
      const mediaBytes = mediaFiles.reduce((acc, m) => acc + (m.media.size || 0), 0);
      return { username: chat.username, textBytes, mediaBytes, totalBytes: textBytes + mediaBytes, mediaFiles };
    });
    list.sort((a, b) => b.totalBytes - a.totalBytes);
    setChatStorageList(list);
  }

  async function handleDeleteFile(chatUsername, msg) {
    if (Platform.OS === 'web') { Alert.alert('Not available', 'File management is not available on web.'); return; }
    Alert.alert('Delete File', `Delete "${msg.media.filename}" to free storage?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await FileSystem.deleteAsync(`${FileSystem.documentDirectory}${msg.media.filename}`, { idempotent: true });
        const updated = messages.map(m => m.id === msg.id ? { ...m, body: `[Deleted: ${msg.media.filename}]`, media: null } : m);
        await AsyncStorage.setItem('ichat_messages', JSON.stringify(updated));
        onRestoreCompleted(chats, updated);
      }}
    ]);
  }

  async function handleDeleteSpecificChat(chatUsername) {
    Alert.alert('Clear Chat Data', `Delete all messages for @${chatUsername}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear Chat', style: 'destructive', onPress: async () => {
        if (Platform.OS !== 'web') {
          const chatMsgs = messages.filter(m => m.chatPartner === chatUsername);
          for (const m of chatMsgs) {
            if (m.media) await FileSystem.deleteAsync(`${FileSystem.documentDirectory}${m.media.filename}`, { idempotent: true });
          }
        }
        const updated = messages.filter(m => m.chatPartner !== chatUsername);
        await AsyncStorage.setItem('ichat_messages', JSON.stringify(updated));
        onRestoreCompleted(chats, updated);
      }}
    ]);
  }

  async function handleClearMedia() {
    if (Platform.OS === 'web') { Alert.alert('Not available', 'Media cache management is not available on web.'); return; }
    Alert.alert('Clear Media Cache', 'Delete all decrypted media from this phone? Message logs will be kept.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => {
        try {
          const files = await FileSystem.readDirectoryAsync(FileSystem.documentDirectory);
          for (const f of files) await FileSystem.deleteAsync(`${FileSystem.documentDirectory}${f}`, { idempotent: true });
          await calculateStorageSizes();
          Alert.alert('Done', 'Media cache cleared.');
        } catch (e) { Alert.alert('Error', 'Failed to clear media.'); }
      }}
    ]);
  }

  async function handleClearHistory() {
    Alert.alert('Clear Chat History', 'Permanently delete all local chat logs and credentials?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear All', style: 'destructive', onPress: async () => {
        await AsyncStorage.removeItem('ichat_chats');
        await AsyncStorage.removeItem('ichat_messages');
        const files = await FileSystem.readDirectoryAsync(FileSystem.documentDirectory);
        for (const f of files) await FileSystem.deleteAsync(`${FileSystem.documentDirectory}${f}`, { idempotent: true });
        onRestoreCompleted([], []);
        Alert.alert('Wiped', 'Local databases cleared.');
      }}
    ]);
  }

  async function handleCloudBackup() {
    if (!backupPass || backupPass.length < 4) {
      Alert.alert('Passcode Required', 'Please set a backup passcode (at least 4 characters).');
      return;
    }
    setActionLoading('backup');
    setBackupStatusMsg('⏳ Step 1/3: Deriving key & encrypting database...');
    try {
      await new Promise(r => setTimeout(r, 50));

      const pub = await AsyncStorage.getItem('ichat_identity_key_public');
      const priv = await AsyncStorage.getItem('ichat_identity_key_private');
      const payload = { chats: chats || [], messages: messages || [], keys: { publicKey: pub, privateKey: priv } };
      const userEmail = user?.email || 'default_user';
      const keyBytes = pbkdf2Sync(backupPass, userEmail, 2000, 32);
      const encrypted = encryptSymmetric(JSON.stringify(payload), keyBytes);

      setBackupStatusMsg('☁️ Step 2/3: Uploading encrypted payload to cloud account...');
      await new Promise(r => setTimeout(r, 50));

      const res = await fetch(`${serverUrl}/api/backup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ backup_data: JSON.stringify(encrypted) })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Cloud backup failed');

      const statusStr = new Date().toLocaleString();
      await AsyncStorage.setItem('ichat_backup_status', statusStr);
      await AsyncStorage.setItem('ichat_backup_passcode', backupPass);
      setBackupStatus(statusStr);
      setBackupStatusMsg('✅ Step 3/3: Backup completed successfully!');
      Alert.alert('Cloud Backup Complete', 'Encrypted chat history and E2EE keys backed up securely to your account.');
    } catch (err) {
      setBackupStatusMsg(`❌ Backup failed: ${err.message}`);
      Alert.alert('Backup failed', err.message);
    }
    finally { setActionLoading(null); }
  }

  async function handleCloudRestore() {
    if (!restorePass) { Alert.alert('Passcode Required', 'Please enter your backup passcode.'); return; }
    setActionLoading('restore');
    setRestoreStatusMsg('☁️ Step 1/3: Downloading encrypted payload from account...');
    try {
      const res = await fetch(`${serverUrl}/api/backup`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No backup found for this account.');

      setRestoreStatusMsg('🔑 Step 2/3: Deriving key & decrypting payload...');
      await new Promise(r => setTimeout(r, 50));

      const blob = JSON.parse(data.backup_data);
      const userEmail = user?.email || 'default_user';
      const keyBytes = pbkdf2Sync(restorePass, userEmail, 2000, 32);
      const decryptedStr = decryptSymmetric(blob.ciphertext, blob.nonce, keyBytes);
      const decrypted = JSON.parse(decryptedStr);

      setRestoreStatusMsg('💾 Step 3/3: Restoring chats, messages & keys to database...');
      await new Promise(r => setTimeout(r, 50));

      const safeChats = Array.isArray(decrypted?.chats) ? decrypted.chats : [];
      let safeMsgs = [];
      if (Array.isArray(decrypted?.messages)) {
        safeMsgs = decrypted.messages;
      } else if (decrypted?.messages && typeof decrypted.messages === 'object') {
        safeMsgs = Object.values(decrypted.messages).flat();
      }

      if (decrypted?.keys?.publicKey && decrypted?.keys?.privateKey) {
        await AsyncStorage.setItem('ichat_identity_key_public', decrypted.keys.publicKey);
        await AsyncStorage.setItem('ichat_identity_key_private', decrypted.keys.privateKey);
      }
      await AsyncStorage.setItem('ichat_chats', JSON.stringify(safeChats));
      await AsyncStorage.setItem('ichat_messages', JSON.stringify(safeMsgs));

      onRestoreCompleted(safeChats, safeMsgs);
      setRestorePass('');
      setRestoreStatusMsg('✅ Step 3/3: Restore completed successfully!');
      Alert.alert('Restore Complete', 'Encrypted chat history and keys restored successfully!');
    } catch (err) {
      console.error('[RESTORE ERROR]', err);
      const isPassErr = err.message.includes('Symmetric');
      setRestoreStatusMsg(`❌ Restore failed: ${isPassErr ? 'Wrong passcode!' : err.message}`);
      Alert.alert('Restore failed', isPassErr ? 'Wrong passcode! Please check your backup password.' : err.message);
    }
    finally { setActionLoading(null); }
  }

  async function handleExportLocalBackup() {
    if (Platform.OS === 'web') {
      Alert.alert('Export on Web', 'On web, use the desktop app backup feature instead.');
      return;
    }
    if (!backupPass || backupPass.length < 4) {
      Alert.alert('Error', 'Enter a backup password (at least 4 characters).');
      return;
    }
    setActionLoading('export');
    try {
      const pub = await AsyncStorage.getItem('ichat_identity_key_public');
      const priv = await AsyncStorage.getItem('ichat_identity_key_private');
      const payload = { chats, messages, keys: { publicKey: pub, privateKey: priv } };
      const keyBytes = pbkdf2Sync(backupPass, user.email, 2000, 32);
      const encrypted = encryptSymmetric(JSON.stringify(payload), keyBytes);
      const fileUri = `${FileSystem.cacheDirectory}ichat_backup_${new Date().toISOString().slice(0, 10)}.json`;
      await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(encrypted), { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, { mimeType: 'application/json', dialogTitle: 'Save Backup File' });
      } else {
        Alert.alert('Exported', `Backup saved to: ${fileUri}`);
      }
    } catch (err) { Alert.alert('Export failed', err.message); }
    finally { setActionLoading(null); }
  }

  async function handleImportLocalBackup() {
    if (Platform.OS === 'web') {
      Alert.alert('Import on Web', 'On web, use the desktop app restore feature instead.');
      return;
    }
    if (!restorePass) { Alert.alert('Error', 'Enter your backup password first.'); return; }
    setActionLoading('import');
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*' });
      if (result.canceled || !result.assets?.length) { setActionLoading(null); return; }
      const content = await FileSystem.readAsStringAsync(result.assets[0].uri, { encoding: FileSystem.EncodingType.UTF8 });
      const blob = JSON.parse(content);
      const keyBytes = pbkdf2Sync(restorePass, user.email, 2000, 32);
      const decrypted = JSON.parse(decryptSymmetric(blob.ciphertext, blob.nonce, keyBytes));
      await AsyncStorage.setItem('ichat_identity_key_public', decrypted.keys.publicKey);
      await AsyncStorage.setItem('ichat_identity_key_private', decrypted.keys.privateKey);
      await AsyncStorage.setItem('ichat_chats', JSON.stringify(decrypted.chats));
      await AsyncStorage.setItem('ichat_messages', JSON.stringify(decrypted.messages));
      onRestoreCompleted(decrypted.chats, decrypted.messages);
      setRestorePass('');
      Alert.alert('Success', 'Chat history and keys restored!');
    } catch (err) { Alert.alert('Import failed', 'Wrong password or invalid file.'); }
    finally { setActionLoading(null); }
  }

  async function handleLogoutAllDevices() {
    Alert.alert('Logout from All Devices', 'This signs you out from ALL devices. You will need to log in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout All', style: 'destructive', onPress: async () => {
        setActionLoading('logout-all');
        try {
          const res = await fetch(`${serverUrl}/api/auth/logout-all-devices?action=logout-all-devices`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ action: 'logout-all-devices' })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to logout all devices');
          Alert.alert('Success', 'All device sessions have been revoked.');
          await onLogout();
        } catch (err) {
          Alert.alert('Error', err.message);
        } finally {
          setActionLoading(null);
        }
      }}
    ]);
  }

  async function handleDeleteAccount() {
    Alert.alert('Danger Zone', 'Permanently delete your account? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        setActionLoading('delete-account');
        try {
          const res = await fetch(`${serverUrl}/api/auth/delete-account`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${token}` }
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Deletion failed');
          await AsyncStorage.clear();
          if (Platform.OS !== 'web') {
            const files = await FileSystem.readDirectoryAsync(FileSystem.documentDirectory);
            for (const f of files) await FileSystem.deleteAsync(`${FileSystem.documentDirectory}${f}`, { idempotent: true });
          }
          onLogout();
        } catch (err) { Alert.alert('Error', err.message); }
        finally { setActionLoading(null); }
      }}
    ]);
  }

  const themeLabels = { system: 'System', light: 'Light', dark: 'Dark' };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle={C.isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />

      {/* ── HEADER ── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: C.bg, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('MainHome')} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: C.cardAlt }}>
          <Ionicons name="arrow-back" size={20} color={C.text} />
        </TouchableOpacity>
        <Text style={{ fontSize: 18, fontWeight: '700', color: C.text }}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>

        {/* ── PROFILE HEADER ── */}
        <View style={{ alignItems: 'center', paddingVertical: 24, borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 20 }}>
          <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <Text style={{ color: C.isDark ? '#0c101a' : '#ffffff', fontWeight: '800', fontSize: 28 }}>{user?.username?.substring(0, 2).toUpperCase()}</Text>
          </View>
          <Text style={{ color: C.text, fontWeight: '700', fontSize: 20 }}>@{user?.username}</Text>
          <Text style={{ color: C.textMuted, fontSize: 13, marginTop: 4 }}>{user?.email}</Text>
        </View>

        {/* ── APPEARANCE ── */}
        <View style={{ marginBottom: 24 }}>
          <SectionHead C={C} icon="color-palette-outline" title="Appearance" />
          <View style={{ flexDirection: 'row', backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 4 }}>
            {['system', 'light', 'dark'].map(mode => (
              <TouchableOpacity
                key={mode}
                style={{ flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: selectedTheme === mode ? C.accent : 'transparent' }}
                onPress={() => changeTheme(mode)}
              >
                <Text style={{ color: selectedTheme === mode ? (C.isDark ? '#0c101a' : '#ffffff') : C.textMuted, fontSize: 13, fontWeight: '600' }}>
                  {themeLabels[mode]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── STORAGE MANAGEMENT ── */}
        <View style={{ marginBottom: 24 }}>
          <SectionHead C={C} icon="server-outline" title="Storage Management" />
          <Card C={C}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
              <Text style={{ color: C.textMuted, fontSize: 13 }}>Message Logs</Text>
              <Text style={{ color: C.text, fontWeight: '600', fontSize: 13 }}>{textStorageSize}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 12 }}>
              <Text style={{ color: C.textMuted, fontSize: 13 }}>Media Cache</Text>
              <Text style={{ color: C.text, fontWeight: '600', fontSize: 13 }}>{mediaStorageSize}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.cardAlt, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingVertical: 9 }} onPress={handleClearMedia}>
                <Ionicons name="trash-bin-outline" size={14} color={C.textMuted} />
                <Text style={{ color: C.textMuted, fontSize: 12, fontWeight: '600' }}>Clear Media</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(239,68,68,0.08)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', borderRadius: 8, paddingVertical: 9 }} onPress={handleClearHistory}>
                <Ionicons name="trash-outline" size={14} color="#ef4444" />
                <Text style={{ color: '#ef4444', fontSize: 12, fontWeight: '600' }}>Wipe History</Text>
              </TouchableOpacity>
            </View>

            {/* Per-Chat Storage */}
            <View style={{ marginTop: 16 }}>
              <Text style={{ color: C.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 10 }}>Storage by Chat</Text>
              {chatStorageList.length === 0
                ? <Text style={{ color: C.textFaint, fontSize: 13, textAlign: 'center', paddingVertical: 8 }}>No chats stored</Text>
                : chatStorageList.map(item => {
                  const isExpanded = !!expandedChats[item.username];
                  const size = item.totalBytes > 1048576
                    ? `${(item.totalBytes / 1048576).toFixed(2)} MB`
                    : `${(item.totalBytes / 1024).toFixed(1)} KB`;
                  return (
                    <View key={item.username} style={{ marginBottom: 8, backgroundColor: C.cardAlt, borderRadius: 10, padding: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: C.text, fontWeight: '600', fontSize: 13 }}>@{item.username}</Text>
                          <Text style={{ color: C.textFaint, fontSize: 11, marginTop: 2 }}>{size} · {item.mediaFiles.length} files</Text>
                        </View>
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          <TouchableOpacity style={{ width: 30, height: 30, backgroundColor: C.accentBg, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }} onPress={() => setExpandedChats(p => ({ ...p, [item.username]: !isExpanded }))}>
                            <Ionicons name={isExpanded ? 'chevron-up' : 'folder-open-outline'} size={14} color={C.accent} />
                          </TouchableOpacity>
                          <TouchableOpacity style={{ width: 30, height: 30, backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }} onPress={() => handleDeleteSpecificChat(item.username)}>
                            <Ionicons name="trash-outline" size={14} color="#ef4444" />
                          </TouchableOpacity>
                        </View>
                      </View>
                      {isExpanded && (
                        <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8 }}>
                          {item.mediaFiles.length === 0
                            ? <Text style={{ color: C.textFaint, fontSize: 11, textAlign: 'center' }}>No media files</Text>
                            : item.mediaFiles.map(m => (
                              <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5 }}>
                                <Ionicons name="document-text-outline" size={13} color={C.textFaint} />
                                <View style={{ flex: 1, marginLeft: 8 }}>
                                  <Text style={{ color: C.textSub, fontSize: 12 }} numberOfLines={1}>{m.media.filename}</Text>
                                  <Text style={{ color: C.textFaint, fontSize: 10 }}>{(m.media.size / 1024).toFixed(1)} KB</Text>
                                </View>
                                <TouchableOpacity onPress={() => handleDeleteFile(item.username, m)}>
                                  <Ionicons name="trash-bin-outline" size={15} color="#ef4444" />
                                </TouchableOpacity>
                              </View>
                            ))}
                        </View>
                      )}
                    </View>
                  );
                })}
            </View>
          </Card>
        </View>

        {/* ── BACKUP & RESTORE ── */}
        <View style={{ marginBottom: 24 }}>
          <SectionHead C={C} icon="cloud-upload-outline" title="Backup & Restore" />

          {/* Schedule */}
          <View style={{ marginBottom: 12 }}>
            <Text style={{ color: C.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 }}>Auto Backup Schedule</Text>
            <Text style={{ color: C.textFaint, fontSize: 11, marginBottom: 8 }}>When Daily is active, automatic encrypted backups run every 24 hours (02:00 AM window).</Text>
            <View style={{ flexDirection: 'row', backgroundColor: C.bgSecondary, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 4 }}>
              {[['never', 'Manual'], ['daily', 'Daily (24h)']].map(([val, label]) => (
                <TouchableOpacity key={val} style={{ flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 8, backgroundColor: backupSchedule === val ? C.accent : 'transparent' }} onPress={() => handleScheduleChange(val)}>
                  <Text style={{ color: backupSchedule === val ? (C.isDark ? '#0c101a' : '#fff') : C.textMuted, fontWeight: '600', fontSize: 13 }}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Cloud Account Backup */}
          <Card C={C}>
            <Text style={{ color: C.text, fontWeight: '600', fontSize: 14, marginBottom: 4 }}>☁️ Encrypted Cloud Backup</Text>
            <Text style={{ color: C.textMuted, fontSize: 11, marginBottom: 10 }}>Securely back up your chat logs and E2EE keys to your account in the cloud.</Text>
            <TextInput style={{ backgroundColor: C.input, borderWidth: 1, borderColor: C.inputBorder, borderRadius: 8, color: C.text, padding: 10, fontSize: 13, marginBottom: 10 }} secureTextEntry value={backupPass} onChangeText={setBackupPass} placeholder="Set backup passcode (min 4 chars)" placeholderTextColor={C.textFaint} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={{ flex: 1, backgroundColor: C.accent, borderRadius: 8, padding: 12, alignItems: 'center' }} onPress={handleCloudBackup} disabled={!!actionLoading}>
                {actionLoading === 'backup' ? <ActivityIndicator color="#0c101a" /> : <Text style={{ color: C.isDark ? '#0c101a' : '#ffffff', fontWeight: '700', fontSize: 13 }}>☁️ Backup to Cloud</Text>}
              </TouchableOpacity>
            </View>
            {backupStatusMsg ? (
              <View style={{ marginTop: 10, padding: 8, backgroundColor: C.accentBg, borderRadius: 6, borderWidth: 1, borderColor: C.border }}>
                <Text style={{ color: C.accent, fontSize: 11, fontWeight: '600', textAlign: 'center' }}>{backupStatusMsg}</Text>
              </View>
            ) : null}
          </Card>

          {/* Cloud Account Restore */}
          <Card C={C}>
            <Text style={{ color: C.text, fontWeight: '600', fontSize: 14, marginBottom: 4 }}>☁️ Restore from Cloud</Text>
            <Text style={{ color: C.textMuted, fontSize: 11, marginBottom: 10 }}>Restore encrypted chat history and security keys from your cloud account.</Text>
            <TextInput style={{ backgroundColor: C.input, borderWidth: 1, borderColor: C.inputBorder, borderRadius: 8, color: C.text, padding: 10, fontSize: 13, marginBottom: 10 }} secureTextEntry value={restorePass} onChangeText={setRestorePass} placeholder="Enter your backup passcode" placeholderTextColor={C.textFaint} />
            <TouchableOpacity style={{ backgroundColor: C.cardAlt, borderWidth: 1, borderColor: C.borderStrong, borderRadius: 8, padding: 12, alignItems: 'center' }} onPress={handleCloudRestore} disabled={!!actionLoading}>
              {actionLoading === 'restore' ? <ActivityIndicator color={C.text} /> : <Text style={{ color: C.text, fontWeight: '700', fontSize: 13 }}>☁️ Restore from Cloud</Text>}
            </TouchableOpacity>
            {restoreStatusMsg ? (
              <View style={{ marginTop: 10, padding: 8, backgroundColor: C.accentBg, borderRadius: 6, borderWidth: 1, borderColor: C.border }}>
                <Text style={{ color: C.accent, fontSize: 11, fontWeight: '600', textAlign: 'center' }}>{restoreStatusMsg}</Text>
              </View>
            ) : null}
          </Card>

          {/* Local File Export / Import */}
          <Card C={C}>
            <Text style={{ color: C.text, fontWeight: '600', fontSize: 14, marginBottom: 10 }}>📂 Local File Export / Import</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={{ flex: 1, backgroundColor: C.cardAlt, borderWidth: 1, borderColor: C.borderStrong, borderRadius: 8, padding: 11, alignItems: 'center' }} onPress={handleExportLocalBackup} disabled={!!actionLoading}>
                {actionLoading === 'export' ? <ActivityIndicator color={C.text} /> : <Text style={{ color: C.text, fontWeight: '600', fontSize: 12 }}>📤 Export File</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, backgroundColor: C.cardAlt, borderWidth: 1, borderColor: C.borderStrong, borderRadius: 8, padding: 11, alignItems: 'center' }} onPress={handleImportLocalBackup} disabled={!!actionLoading}>
                {actionLoading === 'import' ? <ActivityIndicator color={C.text} /> : <Text style={{ color: C.text, fontWeight: '600', fontSize: 12 }}>📥 Import File</Text>}
              </TouchableOpacity>
            </View>
          </Card>

          <Text style={{ color: C.textFaint, fontSize: 11, textAlign: 'center', marginTop: 4 }}>Last Cloud Backup: {backupStatus}</Text>
        </View>

        {/* ── SESSIONS & ACCOUNT ── */}
        <View style={{ marginBottom: 40 }}>
          <SectionHead C={C} icon="shield-outline" title="Sessions & Account" />

          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.cardAlt, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 16, marginBottom: 10 }} onPress={onLogout}>
            <Ionicons name="log-out-outline" size={20} color={C.text} />
            <Text style={{ color: C.text, fontWeight: '600', fontSize: 14 }}>Log Out (This Device)</Text>
          </TouchableOpacity>

          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(217,119,6,0.12)', borderWidth: 1, borderColor: '#d97706', borderRadius: 12, padding: 16, marginBottom: 10 }} onPress={handleLogoutAllDevices} disabled={!!actionLoading}>
            {actionLoading === 'logout-all' ? <ActivityIndicator color="#d97706" /> : (
              <>
                <Ionicons name="phone-portrait-outline" size={20} color="#d97706" />
                <Text style={{ color: '#d97706', fontWeight: '600', fontSize: 14 }}>Logout from All Sessions</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(239,68,68,0.12)', borderWidth: 1, borderColor: '#ef4444', borderRadius: 12, padding: 16 }} onPress={handleDeleteAccount} disabled={!!actionLoading}>
            {actionLoading === 'delete-account' ? <ActivityIndicator color="#ef4444" /> : (
              <>
                <Ionicons name="trash-outline" size={20} color="#ef4444" />
                <Text style={{ color: '#ef4444', fontWeight: '600', fontSize: 14 }}>Delete & Wipe Account</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({});
