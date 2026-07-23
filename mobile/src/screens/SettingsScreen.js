import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import { pbkdf2Sync, encryptSymmetric, decryptSymmetric, decodeBase64, encodeBase64 } from '../services/crypto';

export default function SettingsScreen({ navigation, chats, messages, onRestoreCompleted, onLogout, serverUrl, token, user, selectedTheme, onThemeChange }) {
  const [themeMode, setThemeMode] = useState(selectedTheme || 'system');
  const [backupPass, setBackupPass] = useState('');
  const [restorePass, setRestorePass] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Storage sizes
  const [textStorageSize, setTextStorageSize] = useState('0 KB');
  const [mediaStorageSize, setMediaStorageSize] = useState('0 MB');
  const [backupStatus, setBackupStatus] = useState('Never');

  // Per-Chat storage exploration state
  const [chatStorageList, setChatStorageList] = useState([]);
  const [expandedChats, setExpandedChats] = useState({});

  // Backup schedule
  const [backupSchedule, setBackupSchedule] = useState('never');

  useEffect(() => {
    async function loadSchedule() {
      const sched = await AsyncStorage.getItem('ichat_backup_schedule');
      if (sched) setBackupSchedule(sched);
    }
    loadSchedule();
  }, []);

  async function handleScheduleChange(mode) {
    setBackupSchedule(mode);
    await AsyncStorage.setItem('ichat_backup_schedule', mode);
  }

  useEffect(() => {
    calculateStorageSizes();
    loadBackupStatus();
    calculatePerChatStorage();
  }, [chats, messages]);

  async function loadBackupStatus() {
    const status = await AsyncStorage.getItem('ichat_backup_status');
    if (status) setBackupStatus(status);
  }

  async function calculateStorageSizes() {
    // 1. Messages JSON size
    const rawText = JSON.stringify(messages) + JSON.stringify(chats);
    const textSizeKB = (rawText.length / 1024).toFixed(1);
    setTextStorageSize(`${textSizeKB} KB`);

    // 2. Media cache size in Document Storage
    try {
      const files = await FileSystem.readDirectoryAsync(FileSystem.documentDirectory);
      let totalSize = 0;
      for (const filename of files) {
        const info = await FileSystem.getInfoAsync(`${FileSystem.documentDirectory}${filename}`);
        if (info.exists && !info.isDirectory) {
          totalSize += info.size;
        }
      }
      const mediaSizeMB = (totalSize / (1024 * 1024)).toFixed(2);
      setMediaStorageSize(`${mediaSizeMB} MB`);
    } catch (e) {
      console.error(e);
    }
  }

  function calculatePerChatStorage() {
    const list = [];
    for (const chat of chats) {
      const chatMsgs = messages.filter(m => m.chatPartner === chat.username);
      const textBytes = JSON.stringify(chatMsgs).length;
      
      let mediaBytes = 0;
      const mediaFiles = [];
      for (const m of chatMsgs) {
        if (m.media) {
          mediaBytes += m.media.size || 0;
          mediaFiles.push(m);
        }
      }
      
      list.push({
        username: chat.username,
        textBytes,
        mediaBytes,
        totalBytes: textBytes + mediaBytes,
        mediaFiles
      });
    }
    
    // Sort largest total storage occupied first
    list.sort((a, b) => b.totalBytes - a.totalBytes);
    setChatStorageList(list);
  }

  async function handleDeleteFile(chatUsername, msg) {
    Alert.alert(
      'Delete File',
      `Delete "${msg.media.filename}" from this chat to free storage?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            // Delete file from Document Directory
            const localPath = `${FileSystem.documentDirectory}${msg.media.filename}`;
            await FileSystem.deleteAsync(localPath, { idempotent: true });

            // Update messages list
            const updatedMessages = messages.map(m => {
              if (m.id === msg.id) {
                return { ...m, body: `[File deleted: ${msg.media.filename}]`, media: null };
              }
              return m;
            });

            await AsyncStorage.setItem('ichat_messages', JSON.stringify(updatedMessages));
            onRestoreCompleted(chats, updatedMessages);
          }
        }
      ]
    );
  }

  async function handleDeleteSpecificChat(chatUsername) {
    Alert.alert(
      'Clear Chat Data',
      `Delete all messages and media files for conversation with @${chatUsername}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Chat',
          style: 'destructive',
          onPress: async () => {
            const chatMsgs = messages.filter(m => m.chatPartner === chatUsername);
            
            // Delete media files from Document Directory
            for (const m of chatMsgs) {
              if (m.media) {
                const localPath = `${FileSystem.documentDirectory}${m.media.filename}`;
                await FileSystem.deleteAsync(localPath, { idempotent: true });
              }
            }

            // Remove messages for this partner
            const updatedMessages = messages.filter(m => m.chatPartner !== chatUsername);
            await AsyncStorage.setItem('ichat_messages', JSON.stringify(updatedMessages));
            
            onRestoreCompleted(chats, updatedMessages);
          }
        }
      ]
    );
  }

  async function handleClearMedia() {
    Alert.alert(
      'Clear Media Cache',
      'Are you sure you want to delete all decrypted media files from this phone? Message logs will be kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              const files = await FileSystem.readDirectoryAsync(FileSystem.documentDirectory);
              for (const filename of files) {
                await FileSystem.deleteAsync(`${FileSystem.documentDirectory}${filename}`, { idempotent: true });
              }
              await calculateStorageSizes();
              Alert.alert('Success', 'Media cache successfully cleared.');
            } catch (err) {
              Alert.alert('Error', 'Failed to clear media cache');
            }
          }
        }
      ]
    );
  }

  async function handleClearHistory() {
    Alert.alert(
      'Clear Chat History',
      'This will permanently delete all chat logs and credentials locally. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            await AsyncStorage.removeItem('ichat_chats');
            await AsyncStorage.removeItem('ichat_messages');
            
            const files = await FileSystem.readDirectoryAsync(FileSystem.documentDirectory);
            for (const filename of files) {
              await FileSystem.deleteAsync(`${FileSystem.documentDirectory}${filename}`, { idempotent: true });
            }

            onRestoreCompleted([], []);
            Alert.alert('Wiped', 'Local databases cleared.');
          }
        }
      ]
    );
  }

  async function handleBackup() {
    if (!backupPass || backupPass.length < 4) {
      Alert.alert('Error', 'Please enter a secure password (at least 4 characters)');
      return;
    }

    setLoading(true);
    try {
      const pub = await AsyncStorage.getItem('ichat_identity_key_public');
      const priv = await AsyncStorage.getItem('ichat_identity_key_private');

      const payloadObject = {
        chats,
        messages,
        keys: { publicKey: pub, privateKey: priv }
      };

      const salt = user.email;
      const keyBytes = pbkdf2Sync(backupPass, salt, 2000, 32);

      const encrypted = encryptSymmetric(JSON.stringify(payloadObject), keyBytes);
      const backupBlobString = JSON.stringify(encrypted);

      const res = await fetch(`${serverUrl}/api/backup/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ backup_data: backupBlobString })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload backup');

      const timeStr = new Date().toLocaleString();
      await AsyncStorage.setItem('ichat_backup_status', timeStr);
      setBackupStatus(timeStr);
      setBackupPass('');
      Alert.alert('Success', 'Zero-knowledge backup successfully uploaded.');
    } catch (err) {
      Alert.alert('Backup failed', err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRestore() {
    if (!restorePass) {
      Alert.alert('Error', 'Please enter your backup password');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${serverUrl}/api/backup/download`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to download backup');

      const encryptedBlob = JSON.parse(data.backup_data);
      const salt = user.email;
      const keyBytes = pbkdf2Sync(restorePass, salt, 2000, 32);

      const decryptedStr = decryptSymmetric(encryptedBlob.ciphertext, encryptedBlob.nonce, keyBytes);
      const restored = JSON.parse(decryptedStr);

      await AsyncStorage.setItem('ichat_identity_key_public', restored.keys.publicKey);
      await AsyncStorage.setItem('ichat_identity_key_private', restored.keys.privateKey);
      await AsyncStorage.setItem('ichat_chats', JSON.stringify(restored.chats));
      await AsyncStorage.setItem('ichat_messages', JSON.stringify(restored.messages));

      onRestoreCompleted(restored.chats, restored.messages);
      setRestorePass('');
      Alert.alert('Success', 'Chat history and keys successfully restored.');
    } catch (err) {
      Alert.alert('Restore failed', 'Decryption password key mismatched.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteAccount() {
    Alert.alert(
      'Danger Zone',
      'Permanently delete your profile, active devices, and cloud backups from the server? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              const res = await fetch(`${serverUrl}/api/auth/delete-account`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || 'Account deletion failed');

              await AsyncStorage.clear();
              const files = await FileSystem.readDirectoryAsync(FileSystem.documentDirectory);
              for (const filename of files) {
                await FileSystem.deleteAsync(`${FileSystem.documentDirectory}${filename}`, { idempotent: true });
              }

              onLogout();
            } catch (err) {
              Alert.alert('Error', err.message);
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* Profile Header */}
      <View style={styles.profileHeader}>
        <View style={styles.largeAvatar}>
          <Text style={styles.largeAvatarText}>{user?.username?.substring(0, 2).toUpperCase()}</Text>
        </View>
        <Text style={styles.profileUsername}>@{user?.username}</Text>
        <Text style={styles.profileEmail}>{user?.email}</Text>
      </View>

      {/* Theme Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="color-palette-outline" size={20} color="#00f2fe" />
          <Text style={styles.sectionTitle}>Appearance</Text>
        </View>
        <View style={styles.themeGrid}>
          {['system', 'light', 'dark'].map((mode) => (
            <TouchableOpacity 
              key={mode} 
              style={[styles.themeBtn, themeMode === mode && styles.themeBtnActive]}
              onPress={() => {
                setThemeMode(mode);
                onThemeChange(mode);
              }}
            >
              <Text style={[styles.themeText, themeMode === mode && styles.themeTextActive]}>
                {mode === 'system' ? 'System' : (mode === 'light' ? 'Light' : 'Dark')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Storage Management Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="server-outline" size={20} color="#00f2fe" />
          <Text style={styles.sectionTitle}>Storage Management</Text>
        </View>
        <View style={styles.statCard}>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Message Logs Database Size</Text>
            <Text style={styles.statValue}>{textStorageSize}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Downloaded Media Cache Size</Text>
            <Text style={styles.statValue}>{mediaStorageSize}</Text>
          </View>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.smallOutlineBtn} onPress={handleClearMedia}>
              <Ionicons name="trash-bin-outline" size={14} color="#fff" />
              <Text style={styles.btnTextSmall}>Clear Cached Media</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.smallOutlineBtn, styles.dangerBorder]} onPress={handleClearHistory}>
              <Ionicons name="trash-outline" size={14} color="#f56565" />
              <Text style={[styles.btnTextSmall, {color: '#f56565'}]}>Wipe History</Text>
            </TouchableOpacity>
          </View>

          {/* Per-Chat Storage Explorer */}
          <View style={styles.perChatSection}>
            <Text style={styles.perChatTitle}>Storage by Chat (Largest First)</Text>
            {chatStorageList.length === 0 ? (
              <Text style={styles.noChatsText}>No chats stored</Text>
            ) : (
              chatStorageList.map((item) => {
                const isExpanded = !!expandedChats[item.username];
                const formattedSize = item.totalBytes > 1024 * 1024 
                  ? (item.totalBytes / (1024 * 1024)).toFixed(2) + ' MB'
                  : (item.totalBytes / 1024).toFixed(1) + ' KB';

                return (
                  <View key={item.username} style={styles.chatStorageCard}>
                    <View style={styles.chatStorageHeader}>
                      <View style={{flex: 1}}>
                        <Text style={styles.chatStorageUser}>@{item.username}</Text>
                        <Text style={styles.chatStorageMeta}>{formattedSize} • {item.mediaFiles.length} files</Text>
                      </View>
                      <View style={styles.chatStorageBtns}>
                        <TouchableOpacity 
                          style={styles.iconActionBtn}
                          onPress={() => setExpandedChats(prev => ({ ...prev, [item.username]: !isExpanded }))}
                        >
                          <Ionicons name={isExpanded ? "chevron-up" : "folder-open-outline"} size={16} color="#00f2fe" />
                        </TouchableOpacity>
                        <TouchableOpacity 
                          style={[styles.iconActionBtn, {backgroundColor: 'rgba(245,101,101,0.1)'}]}
                          onPress={() => handleDeleteSpecificChat(item.username)}
                        >
                          <Ionicons name="trash-outline" size={16} color="#f56565" />
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* Files Sub-list */}
                    {isExpanded && (
                      <View style={styles.fileListSub}>
                        {item.mediaFiles.length === 0 ? (
                          <Text style={styles.noFilesText}>No shared media files</Text>
                        ) : (
                          item.mediaFiles.map((m) => (
                            <View key={m.id} style={styles.fileRow}>
                              <Ionicons name="document-text-outline" size={14} color="#718096" />
                              <View style={styles.fileRowInfo}>
                                <Text style={styles.fileRowName} numberOfLines={1}>{m.media.filename}</Text>
                                <Text style={styles.fileRowSize}>{(m.media.size / 1024).toFixed(1)} KB</Text>
                              </View>
                              <TouchableOpacity onPress={() => handleDeleteFile(item.username, m)}>
                                <Ionicons name="trash-bin-outline" size={16} color="#f56565" />
                              </TouchableOpacity>
                            </View>
                          ))
                        )}
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </View>

        </View>
      </View>

      {/* Backup & Restoration Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="cloud-upload-outline" size={20} color="#00f2fe" />
          <Text style={styles.sectionTitle}>Google Drive Backup & Schedule</Text>
        </View>

        {/* Schedule Selector */}
        <View style={{ marginBottom: 16 }}>
          <Text style={{ color: '#a0aec0', fontSize: 12, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase' }}>Automated Backup Schedule</Text>
          <View style={styles.themeGrid}>
            <TouchableOpacity 
              style={[styles.themeBtn, backupSchedule === 'never' && styles.themeBtnActive]}
              onPress={() => handleScheduleChange('never')}
            >
              <Text style={[styles.themeText, backupSchedule === 'never' && styles.themeTextActive]}>Never (Manual)</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.themeBtn, backupSchedule === 'daily' && styles.themeBtnActive]}
              onPress={() => handleScheduleChange('daily')}
            >
              <Text style={[styles.themeText, backupSchedule === 'daily' && styles.themeTextActive]}>Daily (24h)</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.backupCard}>
          <Text style={styles.backupTitle}>Upload to Google Drive</Text>
          <TextInput
            style={styles.backupInput}
            secureTextEntry
            value={backupPass}
            onChangeText={setBackupPass}
            placeholder="Set backup passcode (E2EE)"
            placeholderTextColor="#718096"
          />
          <TouchableOpacity style={styles.backupBtn} onPress={handleBackup} disabled={loading}>
            <Text style={styles.backupBtnText}>Encrypt & Upload</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.backupCard}>
          <Text style={styles.backupTitle}>Restore from Google Drive</Text>
          <TextInput
            style={styles.backupInput}
            secureTextEntry
            value={restorePass}
            onChangeText={setRestorePass}
            placeholder="Enter backup passcode"
            placeholderTextColor="#718096"
          />
          <TouchableOpacity style={[styles.backupBtn, {backgroundColor: '#1a202c', borderWidth: 1, borderColor: '#4a5568'}]} onPress={handleRestore} disabled={loading}>
            <Text style={[styles.backupBtnText, {color: '#fff'}]}>Download & Decrypt</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.backupStatus}>Last Backup Uploaded: {backupStatus}</Text>
      </View>

      {/* Logout & Danger Zone Section */}
      <View style={[styles.section, {marginBottom: 40}]}>
        <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}>
          <Ionicons name="log-out-outline" size={20} color="#fff" />
          <Text style={styles.logoutBtnText}>Log Out from Session</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.deleteBtn} onPress={handleDeleteAccount} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : (
            <>
              <Ionicons name="trash-outline" size={20} color="#fff" />
              <Text style={styles.deleteBtnText}>Delete & Wipe Account</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c101a',
    padding: 16,
  },
  profileHeader: {
    alignItems: 'center',
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
    marginBottom: 20,
  },
  largeAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#00f2fe',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  largeAvatarText: {
    color: '#0c101a',
    fontWeight: '800',
    fontSize: 28,
  },
  profileUsername: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 20,
  },
  profileEmail: {
    color: '#718096',
    fontSize: 13,
    marginTop: 4,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
    marginLeft: 8,
  },
  themeGrid: {
    flexDirection: 'row',
    backgroundColor: '#06080d',
    borderWidth: 1,
    borderColor: '#2d3748',
    borderRadius: 12,
    padding: 4,
  },
  themeBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  themeBtnActive: {
    backgroundColor: '#00f2fe',
  },
  themeText: {
    color: '#718096',
    fontSize: 13,
    fontWeight: '600',
  },
  themeTextActive: {
    color: '#0c101a',
  },
  statCard: {
    backgroundColor: '#161c2d',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    padding: 16,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  statLabel: {
    color: '#a0aec0',
    fontSize: 13,
  },
  statValue: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 14,
    gap: 10,
  },
  smallOutlineBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#4a5568',
    borderRadius: 8,
    paddingVertical: 8,
    gap: 6,
  },
  dangerBorder: {
    borderColor: 'rgba(245,101,101,0.2)',
  },
  btnTextSmall: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  perChatSection: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: 14,
  },
  perChatTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
  },
  noChatsText: {
    color: '#718096',
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 8,
  },
  chatStorageCard: {
    backgroundColor: '#06080d',
    borderWidth: 1,
    borderColor: '#2d3748',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  chatStorageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chatStorageUser: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13.5,
  },
  chatStorageMeta: {
    color: '#718096',
    fontSize: 11,
    marginTop: 2,
  },
  chatStorageBtns: {
    flexDirection: 'row',
    gap: 8,
  },
  iconActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#161c2d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileListSub: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1a202c',
    paddingTop: 8,
  },
  noFilesText: {
    color: '#718096',
    fontSize: 11,
    textAlign: 'center',
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  fileRowInfo: {
    flex: 1,
    marginLeft: 8,
    marginRight: 8,
  },
  fileRowName: {
    color: '#e2e8f0',
    fontSize: 12,
  },
  fileRowSize: {
    color: '#718096',
    fontSize: 10,
  },
  backupCard: {
    backgroundColor: '#161c2d',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
  },
  backupTitle: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
    marginBottom: 10,
  },
  backupInput: {
    backgroundColor: '#06080d',
    borderWidth: 1,
    borderColor: '#2d3748',
    borderRadius: 8,
    color: '#fff',
    padding: 10,
    fontSize: 13,
    marginBottom: 12,
  },
  backupBtn: {
    backgroundColor: '#00f2fe',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  backupBtnText: {
    color: '#0c101a',
    fontWeight: '700',
    fontSize: 13,
  },
  backupStatus: {
    color: '#718096',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 6,
  },
  logoutBtn: {
    backgroundColor: '#2d3748',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  logoutBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  deleteBtn: {
    backgroundColor: '#e53e3e',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  deleteBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  }
});
