import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, FlatList, TextInput, TouchableOpacity, Image, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { decodeBase64, encodeBase64, decryptSymmetric, encryptSymmetric, nacl } from '../services/crypto';

export default function ChatScreen({ route, navigation, messages, onSendMessage, onSendReadReceipt, typingStatus, activeCallPartner, serverUrl, token, currentUsername }) {
  const { username } = route.params;
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaCache, setMediaCache] = useState({}); // url -> local decrypted file path
  const typingTimeoutRef = useRef(null);
  const flatListRef = useRef(null);

  // Filter messages for this chat partner
  const chatMessages = messages.filter(m => m.chatPartner === username);

  // Mark all unread messages as read
  useEffect(() => {
    chatMessages.forEach(m => {
      if (m.sender !== currentUsername && m.status !== 'read') {
        onSendReadReceipt(m.id, username);
      }
    });
  }, [chatMessages.length]);

  // Dispatch typing status
  function handleTextChange(val) {
    setText(val);

    // Send typing notification
    if (!typing) {
      setTyping(true);
      onSendMessage({ type: 'typing', recipient: username, status: true });
    }

    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      setTyping(false);
      onSendMessage({ type: 'typing', recipient: username, status: false });
    }, 2000);
  }

  // Trigger text message send
  function handleSendText() {
    const cleanText = text.trim();
    if (!cleanText) return;

    onSendMessage({
      type: 'text',
      recipient: username,
      body: cleanText
    });
    
    setText('');
    
    // Clear typing indicator
    clearTimeout(typingTimeoutRef.current);
    setTyping(false);
    onSendMessage({ type: 'typing', recipient: username, status: false });
  }

  // Pick Media image
  async function handlePickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission Denied', 'Camera roll access is required to share images.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      uploadMediaFile(result.assets[0].uri, result.assets[0].fileName || 'image.jpg', 'image/jpeg');
    }
  }

  // Pick general files
  async function handlePickDocument() {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*'
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const file = result.assets[0];
      uploadMediaFile(file.uri, file.name, file.mimeType || 'application/octet-stream');
    }
  }

  // Encrypt and Upload E2EE media file
  async function uploadMediaFile(uri, filename, mimeType) {
    setMediaUploading(true);
    try {
      // 1. Read binary as base64 string
      const fileBase64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const fileBytes = decodeBase64(fileBase64);

      // 2. Generate E2EE media keys
      const mediaKey = nacl.randomBytes(32);
      const mediaNonce = nacl.randomBytes(24);

      // 3. Symmetrically encrypt file
      const encryptedBytes = nacl.secretbox(fileBytes, mediaNonce, mediaKey);
      const encryptedBase64 = encodeBase64(encryptedBytes);

      // 4. Save encrypted block to temporary local folder
      const tempPath = `${FileSystem.cacheDirectory}${filename}.enc`;
      await FileSystem.writeAsStringAsync(tempPath, encryptedBase64, { encoding: FileSystem.EncodingType.Base64 });

      // 5. Upload temporary encrypted file to server
      const uploadResult = await FileSystem.uploadAsync(
        `${serverUrl}/api/upload`,
        tempPath,
        {
          headers: { 'Authorization': `Bearer ${token}` },
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: 'file'
        }
      );

      // Delete temp encrypted file
      await FileSystem.deleteAsync(tempPath, { idempotent: true });

      const response = JSON.parse(uploadResult.body);
      if (!response.success) throw new Error(response.error);

      // Save to local cache so we don't have to download it again
      const cachePath = `${FileSystem.documentDirectory}${response.filename}`;
      await FileSystem.copyAsync({ from: uri, to: cachePath });
      setMediaCache(prev => ({ ...prev, [response.url]: cachePath }));

      // Append media file to outbox message
      onSendMessage({
        type: 'media',
        recipient: username,
        body: null,
        media: {
          url: response.url,
          filename,
          type: mimeType,
          size: response.size,
          encryptedKeyBase64: encodeBase64(mediaKey),
          mediaNonceBase64: encodeBase64(mediaNonce)
        }
      });

    } catch (err) {
      console.error('[MOBILE MEDIA UPLOAD]', err);
      Alert.alert('Upload failed', 'Attachments are capped at 10MB.');
    } finally {
      setMediaUploading(false);
    }
  }

  // Secure Decrypt downloaded attachments
  async function decryptAttachment(msg) {
    const { url, filename, type } = msg.media;
    
    // 1. Check in-memory local caches
    if (mediaCache[url]) return mediaCache[url];

    // Check if file is already stored in app system
    const localPath = `${FileSystem.documentDirectory}${filename}`;
    const fileInfo = await FileSystem.getInfoAsync(localPath);
    if (fileInfo.exists) {
      setMediaCache(prev => ({ ...prev, [url]: localPath }));
      return localPath;
    }

    // 2. Need E2EE keys to decrypt
    if (!msg.media.encryptedKey || !msg.media.mediaNonce) return null;

    try {
      const mediaKey = decodeBase64(msg.media.encryptedKey);
      const mediaNonce = decodeBase64(msg.media.mediaNonce);

      // 3. Download encrypted ciphertext from server to local cache path
      const encPath = `${FileSystem.cacheDirectory}${filename}.enc`;
      await FileSystem.downloadAsync(url, encPath);

      // 4. Read file base64 data
      const encBase64 = await FileSystem.readAsStringAsync(encPath, { encoding: FileSystem.EncodingType.Base64 });
      const encBytes = decodeBase64(encBase64);

      // 5. Decrypt binary bytes
      const decryptedBytes = nacl.secretbox.open(encBytes, mediaNonce, mediaKey);
      if (!decryptedBytes) throw new Error('Decryption mismatch');

      // Delete temporary download
      await FileSystem.deleteAsync(encPath, { idempotent: true });

      // 6. Write decrypted base64 block back to document storage
      const decBase64 = encodeBase64(decryptedBytes);
      await FileSystem.writeAsStringAsync(localPath, decBase64, { encoding: FileSystem.EncodingType.Base64 });

      // Cache mapping path
      setMediaCache(prev => ({ ...prev, [url]: localPath }));
      return localPath;

    } catch (err) {
      console.error('[MOBILE MEDIA DECRYPT]', err);
      return null;
    }
  }

  function handleTriggerCall() {
    navigation.navigate('Call', { username, direction: 'outgoing' });
  }

  function renderMessageItem({ item }) {
    const isOutgoing = item.sender === currentUsername;
    const time = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return (
      <View style={[styles.msgWrapper, isOutgoing ? styles.outgoingWrapper : styles.incomingWrapper]}>
        <View style={[styles.bubble, isOutgoing ? styles.outgoingBubble : styles.incomingBubble]}>
          
          {/* Media Attachment card */}
          {item.media && (
            <MediaAttachment msg={item} decryptFn={decryptAttachment} />
          )}

          {item.body && (
            <Text style={isOutgoing ? styles.outgoingText : styles.incomingText}>{item.body}</Text>
          )}

          <View style={styles.meta}>
            <Text style={styles.metaText}>{time}</Text>
            {isOutgoing && (
              <View style={styles.ticks}>
                {item.status === 'pending' && <Ionicons name="time-outline" size={12} color="#718096" />}
                {item.status === 'sent' && <Ionicons name="checkmark" size={12} color="#718096" />}
                {item.status === 'delivered' && (
                  <View style={{flexDirection: 'row'}}><Ionicons name="checkmark" size={12} color="#a0aec0" /><Ionicons name="checkmark" size={12} color="#a0aec0" style={{marginLeft:-6}} /></View>
                )}
                {item.status === 'read' && (
                  <View style={{flexDirection: 'row'}}><Ionicons name="checkmark" size={12} color="#00f2fe" /><Ionicons name="checkmark" size={12} color="#00f2fe" style={{marginLeft:-6}} /></View>
                )}
              </View>
            )}
          </View>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : null}
      keyboardVerticalOffset={90}
    >
      {/* Header bar overrides */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerUser}>
          <Text style={styles.headerTitle}>@{username}</Text>
          {typingStatus ? (
            <Text style={styles.headerTyping}>is typing...</Text>
          ) : (
            <Text style={styles.headerSubtitle}>Active Secure Room</Text>
          )}
        </View>
        <TouchableOpacity style={styles.callBtn} onPress={handleTriggerCall}>
          <Ionicons name="call" size={20} color="#00f2fe" />
        </TouchableOpacity>
      </View>

      <FlatList
        ref={flatListRef}
        data={chatMessages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessageItem}
        contentContainerStyle={styles.history}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      {/* Media uploading indicator spinner */}
      {mediaUploading && (
        <View style={styles.uploadingOverlay}>
          <ActivityIndicator size="small" color="#00f2fe" />
          <Text style={styles.uploadingText}>Encrypting & uploading attachment...</Text>
        </View>
      )}

      {/* Chat inputs panel */}
      <View style={styles.inputBar}>
        <TouchableOpacity style={styles.attachBtn} onPress={handlePickImage} onLongPress={handlePickDocument}>
          <Ionicons name="add" size={24} color="#a0aec0" />
        </TouchableOpacity>
        
        <TextInput
          style={styles.textInput}
          value={text}
          onChangeText={handleTextChange}
          placeholder="Type secure message..."
          placeholderTextColor="#718096"
          multiline
        />

        <TouchableOpacity style={styles.sendBtn} onPress={handleSendText}>
          <Ionicons name="send" size={18} color="#0c101a" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// Media attachment asynchronous component
function MediaAttachment({ msg, decryptFn }) {
  const [localUri, setLocalUri] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    decryptFn(msg).then(uri => {
      if (active) {
        setLocalUri(uri);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [msg.media.url]);

  if (loading) {
    return (
      <View style={styles.mediaLoading}>
        <ActivityIndicator size="small" color="#00f2fe" />
        <Text style={styles.mediaLoadingText}>Decrypting attachment...</Text>
      </View>
    );
  }

  if (!localUri) {
    return <Text style={styles.decryptError}>[Decryption key error]</Text>;
  }

  if (msg.media.type.startsWith('image/')) {
    return (
      <Image source={{ uri: localUri }} style={styles.mediaImage} resizeMode="cover" />
    );
  }

  return (
    <TouchableOpacity 
      style={styles.fileCard}
      onPress={() => Alert.alert('File Decrypted', `File saved to local storage:\n${localUri}`)}
    >
      <Ionicons name="document-text-outline" size={24} color="#00f2fe" />
      <View style={{marginLeft: 10, flex: 1}}>
        <Text style={styles.fileCardName} numberOfLines={1}>{msg.media.filename}</Text>
        <Text style={styles.fileCardSize}>{(msg.media.size / 1024).toFixed(1)} KB</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c101a',
  },
  header: {
    height: 60,
    backgroundColor: '#161c2d',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  backBtn: {
    paddingRight: 12,
  },
  headerUser: {
    flex: 1,
  },
  headerTitle: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  headerSubtitle: {
    color: '#718096',
    fontSize: 11,
    marginTop: 2,
  },
  headerTyping: {
    color: '#00f2fe',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  callBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,242,254,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  history: {
    padding: 16,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  msgWrapper: {
    marginVertical: 6,
    maxWidth: '75%',
  },
  outgoingWrapper: {
    alignSelf: 'flex-end',
  },
  incomingWrapper: {
    alignSelf: 'flex-start',
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  outgoingBubble: {
    backgroundColor: '#00f2fe',
    borderBottomRightRadius: 2,
  },
  incomingBubble: {
    backgroundColor: '#161c2d',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderBottomLeftRadius: 2,
  },
  outgoingText: {
    color: '#0c101a',
    fontSize: 14.5,
    lineHeight: 20,
  },
  incomingText: {
    color: '#fff',
    fontSize: 14.5,
    lineHeight: 20,
  },
  meta: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 4,
  },
  metaText: {
    fontSize: 9,
    color: 'rgba(0,0,0,0.5)',
  },
  incomingBubble: {
    backgroundColor: '#161c2d',
  },
  // Overrides to match meta colors
  incomingText: { color: '#fff' },
  // Need custom selector
  metaText: {
    fontSize: 9,
    color: '#718096',
  },
  ticks: {
    marginLeft: 4,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#161c2d',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  attachBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#0c101a',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#06080d',
    color: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14.5,
    maxHeight: 100,
    minHeight: 40,
    textAlignVertical: 'center',
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#00f2fe',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  uploadingOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161c2d',
    padding: 10,
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  uploadingText: {
    color: '#a0aec0',
    fontSize: 12,
    marginLeft: 8,
  },
  mediaLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
  },
  mediaLoadingText: {
    color: '#718096',
    fontSize: 11,
    marginLeft: 8,
  },
  decryptError: {
    color: '#f56565',
    fontSize: 12,
    marginVertical: 4,
  },
  mediaImage: {
    width: 200,
    height: 150,
    borderRadius: 8,
    marginBottom: 6,
  },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0c101a',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    width: 200,
  },
  fileCardName: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  fileCardSize: {
    color: '#718096',
    fontSize: 10,
    marginTop: 2,
  }
});
