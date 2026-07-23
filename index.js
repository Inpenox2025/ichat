/* ═══════════ STATE MANAGEMENT ═══════════ */
const state = {
  token: null,
  user: null, // { id, email, username }
  deviceId: null,
  keys: null, // { publicKey, privateKey } (Uint8Array)
  socket: null,
  reconnectAttempts: 0,
  activeChatPartner: null, // username string
  activeGroup: null, // group object or null
  activeSidebarTab: 'home', // 'home' | 'groups' | 'requests'
  selectedChats: new Set(),
  selectedRequests: new Set(),
  selectedGroups: new Set(),
  isChatsSelectionMode: false,
  isRequestsSelectionMode: false,
  isGroupsSelectionMode: false,
  chats: [], // [{ username, email, deviceKeys: [{device_id, public_key}], unreadCount, status }]
  groups: [], // [{ id, name, members: [usernames], createdBy, createdAt, unreadCount }]
  messages: [], // [{ id, chatPartner, sender, body, timestamp, media: { url, filename, type, size }, status }]
  outbox: [], // Pending messages queue for low internet resilience
  typingTimer: null,
  isTyping: false,
  theme: 'system',
  localMediaCache: new Map(), // url -> blobUrl (for in-memory session speed)
  
  // WebRTC Call State
  localStream: null,
  peerConnection: null,
  currentCall: null, // { partner, type: 'incoming'|'outgoing', status: 'ringing'|'connecting'|'connected' }
  callMuted: false
};

// Config Constants
const API_BASE = window.location.origin;
const WS_BASE = window.location.protocol === 'https:' 
  ? `wss://${window.location.host}` 
  : `ws://${window.location.host}`;


/* ═══════════ CUSTOM TOAST & CONFIRM MODAL CONTROLLERS ═══════════ */
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-notification ${type}`;
  
  let iconName = 'info';
  if (type === 'success') iconName = 'check-circle';
  if (type === 'error') iconName = 'alert-circle';

  toast.innerHTML = `
    <i data-feather="${iconName}" class="toast-icon"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  feather.replace();

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px) scale(0.95)';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

let pendingConfirmCallback = null;

function showConfirmModal(options) {
  const {
    title = 'Are you sure?',
    message = 'This action cannot be undone.',
    icon = 'alert-triangle',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    isDanger = false,
    onConfirm
  } = options;

  const modal = document.getElementById('customConfirmModal');
  const titleEl = document.getElementById('confirmModalTitle');
  const msgEl = document.getElementById('confirmModalMessage');
  const iconWrapper = document.getElementById('confirmModalIconWrapper');
  const iconEl = document.getElementById('confirmModalIcon');
  const btnOk = document.getElementById('btnConfirmOk');
  const btnCancel = document.getElementById('btnConfirmCancel');

  if (!modal) return;

  if (titleEl) titleEl.innerText = title;
  if (msgEl) msgEl.innerText = message;
  if (btnOk) {
    btnOk.innerText = confirmText;
    btnOk.className = isDanger ? 'btn btn-danger' : 'btn btn-primary';
  }
  if (btnCancel) btnCancel.innerText = cancelText;

  if (iconWrapper) {
    iconWrapper.className = `confirm-modal-icon-wrapper ${isDanger ? 'danger' : ''}`;
  }
  if (iconEl) {
    iconEl.setAttribute('data-feather', icon);
  }

  feather.replace();
  pendingConfirmCallback = onConfirm;
  modal.classList.add('active');

  // Push state to support back gesture closing modal
  history.pushState({ modalOpen: true }, '');
}

function closeConfirmModal() {
  const modal = document.getElementById('customConfirmModal');
  if (modal) modal.classList.remove('active');
  pendingConfirmCallback = null;
}


/* ═══════════ HISTORY API & BACK GESTURE NAVIGATION ═══════════ */
function initHistoryNavigation() {
  window.addEventListener('popstate', (e) => {
    // 1. Close confirm modal if open
    const confirmModal = document.getElementById('customConfirmModal');
    if (confirmModal && confirmModal.classList.contains('active')) {
      confirmModal.classList.remove('active');
      pendingConfirmCallback = null;
      return;
    }

    // 2. Close settings modal if open
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal && settingsModal.classList.contains('active')) {
      settingsModal.classList.remove('active');
      return;
    }

    // 3. Return from Active Conversation Pane to Sidebar on mobile/desktop back gesture
    if (state.activeChatPartner) {
      state.activeChatPartner = null;
      localStorage.removeItem('ichat_active_partner');
      document.getElementById('chatPane')?.classList.remove('active');
      document.getElementById('chatEmptyState')?.classList.add('active');
      document.getElementById('chatWindow')?.classList.remove('active');
      document.getElementById('sidebar')?.classList.remove('inactive');
      return;
    }

    // 4. Return to Home tab if in Requests tab
    if (state.activeSidebarTab === 'requests') {
      switchSidebarTab('home');
      return;
    }
  });
}

function switchSidebarTab(tabName) {
  state.activeSidebarTab = tabName;
  const chatsView = document.getElementById('chatsView');
  const requestsView = document.getElementById('requestsView');
  const tabHome = document.getElementById('tabNavHome');
  const tabRequests = document.getElementById('tabNavRequests');

  if (tabName === 'requests') {
    chatsView?.classList.remove('active');
    requestsView?.classList.add('active');
    tabHome?.classList.remove('active');
    tabRequests?.classList.add('active');
    renderRequestsList();
  } else {
    requestsView?.classList.remove('active');
    chatsView?.classList.add('active');
    tabRequests?.classList.remove('active');
    tabHome?.classList.add('active');
    renderChatList();
  }
}

/* ═══════════ LONG-PRESS & MULTI-SELECT CONTROLLERS ═══════════ */
function bindLongPress(element, onLongPress, onClick) {
  let timer = null;
  let isLongPress = false;

  const start = (e) => {
    isLongPress = false;
    timer = setTimeout(() => {
      isLongPress = true;
      if (navigator.vibrate) navigator.vibrate(50);
      onLongPress(e);
    }, 500);
  };

  const cancel = () => {
    clearTimeout(timer);
  };

  const end = (e) => {
    clearTimeout(timer);
    if (!isLongPress && onClick) {
      onClick(e);
    }
  };

  element.addEventListener('touchstart', start, { passive: true });
  element.addEventListener('touchend', end);
  element.addEventListener('touchmove', cancel, { passive: true });
  element.addEventListener('mousedown', start);
  element.addEventListener('mouseup', end);
  element.addEventListener('mouseleave', cancel);
  element.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    onLongPress(e);
  });
}

// CHATS SELECTION CONTROLS
function toggleChatSelection(username) {
  state.isChatsSelectionMode = true;
  if (state.selectedChats.has(username)) {
    state.selectedChats.delete(username);
  } else {
    state.selectedChats.add(username);
  }
  
  if (state.selectedChats.size === 0) {
    exitChatsSelection();
  } else {
    updateChatsSelectionBar();
    renderChatList();
  }
}

function updateChatsSelectionBar() {
  const bar = document.getElementById('chatsSelectionBar');
  const countEl = document.getElementById('chatsSelectedCount');
  const btnSelectAll = document.getElementById('btnSelectAllChats');
  const mainChats = state.chats.filter(c => c && (c.status === 'accepted' || c.status === 'pending_outgoing' || !c.status));

  if (bar) bar.style.display = 'flex';
  if (countEl) countEl.innerText = `${state.selectedChats.size} Selected`;
  
  if (btnSelectAll) {
    const isAllSelected = mainChats.length > 0 && state.selectedChats.size === mainChats.length;
    btnSelectAll.innerText = isAllSelected ? 'Deselect All' : 'Select All';
  }
}

function exitChatsSelection() {
  state.isChatsSelectionMode = false;
  state.selectedChats.clear();
  const bar = document.getElementById('chatsSelectionBar');
  if (bar) bar.style.display = 'none';
  renderChatList();
}

function toggleSelectAllChats() {
  const mainChats = state.chats.filter(c => c && (c.status === 'accepted' || c.status === 'pending_outgoing' || !c.status));
  if (state.selectedChats.size === mainChats.length) {
    state.selectedChats.clear();
    exitChatsSelection();
  } else {
    state.isChatsSelectionMode = true;
    mainChats.forEach(c => state.selectedChats.add(c.username));
    updateChatsSelectionBar();
    renderChatList();
  }
}

function deleteSelectedChats() {
  if (state.selectedChats.size === 0) return;
  const count = state.selectedChats.size;

  showConfirmModal({
    title: `Delete ${count} Conversation${count > 1 ? 's' : ''}?`,
    message: `Are you sure you want to delete ${count} selected chat${count > 1 ? 's' : ''} and all associated message history?`,
    icon: 'trash-2',
    confirmText: `Delete ${count} Chat${count > 1 ? 's' : ''}`,
    cancelText: 'Cancel',
    isDanger: true,
    onConfirm: () => {
      const selectedUsernames = Array.from(state.selectedChats);
      state.chats = state.chats.filter(c => !selectedUsernames.includes(c.username));
      state.messages = state.messages.filter(m => !selectedUsernames.includes(m.chatPartner));

      if (selectedUsernames.includes(state.activeChatPartner)) {
        closeActiveConversation();
      }

      saveStateToLocalStorage();
      switchSidebarTab('home');
      exitChatsSelection();
      showToast(`${count} conversation${count > 1 ? 's' : ''} deleted`, 'info');
    }
  });
}

// REQUESTS SELECTION CONTROLS
function toggleRequestSelection(username) {
  state.isRequestsSelectionMode = true;
  if (state.selectedRequests.has(username)) {
    state.selectedRequests.delete(username);
  } else {
    state.selectedRequests.add(username);
  }

  if (state.selectedRequests.size === 0) {
    exitRequestsSelection();
  } else {
    updateRequestsSelectionBar();
    renderRequestsList();
  }
}

function updateRequestsSelectionBar() {
  const bar = document.getElementById('requestsSelectionBar');
  const countEl = document.getElementById('requestsSelectedCount');
  const btnSelectAll = document.getElementById('btnSelectAllRequests');
  const pendingRequests = state.chats.filter(c => c && c.status === 'pending_incoming');

  if (bar) bar.style.display = 'flex';
  if (countEl) countEl.innerText = `${state.selectedRequests.size} Selected`;
  
  if (btnSelectAll) {
    const isAllSelected = pendingRequests.length > 0 && state.selectedRequests.size === pendingRequests.length;
    btnSelectAll.innerText = isAllSelected ? 'Deselect All' : 'Select All';
  }
}

function exitRequestsSelection() {
  state.isRequestsSelectionMode = false;
  state.selectedRequests.clear();
  const bar = document.getElementById('requestsSelectionBar');
  if (bar) bar.style.display = 'none';
  renderRequestsList();
}

function toggleSelectAllRequests() {
  const pendingRequests = state.chats.filter(c => c && c.status === 'pending_incoming');
  if (state.selectedRequests.size === pendingRequests.length) {
    state.selectedRequests.clear();
    exitRequestsSelection();
  } else {
    state.isRequestsSelectionMode = true;
    pendingRequests.forEach(c => state.selectedRequests.add(c.username));
    updateRequestsSelectionBar();
    renderRequestsList();
  }
}

function acceptSelectedRequests() {
  if (state.selectedRequests.size === 0) return;
  const selectedUsernames = Array.from(state.selectedRequests);

  selectedUsernames.forEach(username => {
    acceptChatRequest(username);
  });

  exitRequestsSelection();
  showToast(`${selectedUsernames.length} request${selectedUsernames.length > 1 ? 's' : ''} accepted`, 'success');
}

function declineSelectedRequests() {
  if (state.selectedRequests.size === 0) return;
  const count = state.selectedRequests.size;

  showConfirmModal({
    title: `Decline ${count} Request${count > 1 ? 's' : ''}?`,
    message: `Are you sure you want to decline and remove ${count} selected request${count > 1 ? 's' : ''}?`,
    icon: 'trash-2',
    confirmText: `Decline ${count}`,
    cancelText: 'Cancel',
    isDanger: true,
    onConfirm: () => {
      const selectedUsernames = Array.from(state.selectedRequests);
      state.chats = state.chats.filter(c => !selectedUsernames.includes(c.username));
      state.messages = state.messages.filter(m => !selectedUsernames.includes(m.chatPartner));

      if (selectedUsernames.includes(state.activeChatPartner)) {
        state.activeChatPartner = null;
        document.getElementById('chatPane')?.classList.remove('active');
        document.getElementById('chatEmptyState')?.classList.add('active');
      }

      saveStateToLocalStorage();
      exitRequestsSelection();
      showToast(`${count} request${count > 1 ? 's' : ''} declined`, 'info');
    }
  });
}

// IndexedDB setup for E2EE Media Storage (to bypass 5MB localStorage limit)
const DB_NAME = 'ichat_media_db';
const DB_VERSION = 1;
let mediaDb = null;

function initIndexedDB() {
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = (e) => {
      console.error('[DB] IndexedDB failed to load:', e);
      resolve(null);
    };
    request.onsuccess = (e) => {
      mediaDb = e.target.result;
      resolve(mediaDb);
    };
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('media')) {
        db.createObjectStore('media', { keyPath: 'url' });
      }
    };
  });
}

function saveMediaToLocalDB(url, arrayBuffer, mimeType) {
  return new Promise((resolve) => {
    if (!mediaDb) return resolve(false);
    const transaction = mediaDb.transaction(['media'], 'readwrite');
    const store = transaction.objectStore('media');
    const request = store.put({ url, arrayBuffer, mimeType });
    request.onsuccess = () => resolve(true);
    request.onerror = () => resolve(false);
  });
}

function getMediaFromLocalDB(url) {
  return new Promise((resolve) => {
    if (!mediaDb) return resolve(null);
    const transaction = mediaDb.transaction(['media'], 'readonly');
    const store = transaction.objectStore('media');
    const request = store.get(url);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

function clearMediaLocalDB() {
  return new Promise((resolve) => {
    if (!mediaDb) return resolve(false);
    const transaction = mediaDb.transaction(['media'], 'readwrite');
    const store = transaction.objectStore('media');
    const request = store.clear();
    request.onsuccess = () => resolve(true);
    request.onerror = () => resolve(false);
  });
}

function getMediaStorageSize() {
  return new Promise((resolve) => {
    if (!mediaDb) return resolve(0);
    const transaction = mediaDb.transaction(['media'], 'readonly');
    const store = transaction.objectStore('media');
    const request = store.getAll();
    request.onsuccess = () => {
      let size = 0;
      for (const item of request.result) {
        size += item.arrayBuffer.byteLength;
      }
      resolve(size);
    };
    request.onerror = () => resolve(0);
  });
}


/* ═══════════ CRYPTOGRAPHY HELPER FUNCTIONS ═══════════ */
// Helper base64 encoding and decoding
const encodeBase64 = (arr) => nacl.util.encodeBase64(arr);
const decodeBase64 = (str) => nacl.util.decodeBase64(str);
const encodeUTF8 = (arr) => nacl.util.encodeUTF8(arr);
const decodeUTF8 = (str) => nacl.util.decodeUTF8(str);

// Generate device keys
function generateIdentityKeys() {
  const kp = nacl.box.keyPair();
  return {
    publicKey: encodeBase64(kp.publicKey),
    privateKey: encodeBase64(kp.secretKey)
  };
}

// Symmetric encryption for messages using a one-time symmetric key
function encryptSymmetric(plaintext, key) {
  const nonce = nacl.randomBytes(24);
  const messageBytes = decodeUTF8(plaintext);
  const cipherBytes = nacl.secretbox(messageBytes, nonce, key);
  return {
    ciphertext: encodeBase64(cipherBytes),
    nonce: encodeBase64(nonce)
  };
}

function decryptSymmetric(ciphertext, nonce, key) {
  const cipherBytes = decodeBase64(ciphertext);
  const nonceBytes = decodeBase64(nonce);
  const decrypted = nacl.secretbox.open(cipherBytes, nonceBytes, key);
  if (!decrypted) throw new Error('Symmetric decryption failed');
  return encodeUTF8(decrypted);
}

// Asymmetric key encryption (for session key exchange)
function encryptAsymmetric(recipientPublicKey, senderPrivateKey, messageBytes, nonceBytes) {
  const encrypted = nacl.box(messageBytes, nonceBytes, recipientPublicKey, senderPrivateKey);
  return encodeBase64(encrypted);
}

function decryptAsymmetric(senderPublicKey, recipientPrivateKey, ciphertextBase64, nonceBytes) {
  const cipherBytes = decodeBase64(ciphertextBase64);
  const decrypted = nacl.box.open(cipherBytes, nonceBytes, senderPublicKey, recipientPrivateKey);
  if (!decrypted) throw new Error('Asymmetric decryption failed');
  return decrypted;
}

// PBKDF2 Key derivation from backup password
async function pbkdf2(password, salt, keyLengthBytes = 32) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const derivedBits = await window.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc.encode(salt),
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    keyLengthBytes * 8
  );
  return new Uint8Array(derivedBits);
}


/* ═══════════ LOCAL DATABASE PERSISTENCE ═══════════ */
function loadStateFromLocalStorage() {
  state.token = localStorage.getItem('ichat_token');
  
  const storedUser = localStorage.getItem('ichat_user');
  state.user = storedUser ? JSON.parse(storedUser) : null;
  
  let deviceId = localStorage.getItem('ichat_device_id');
  if (!deviceId) {
    deviceId = 'device-' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('ichat_device_id', deviceId);
  }
  state.deviceId = deviceId;

  // Load E2EE credentials
  const pub = localStorage.getItem('ichat_identity_key_public');
  const priv = localStorage.getItem('ichat_identity_key_private');
  if (pub && priv) {
    state.keys = {
      publicKey: decodeBase64(pub),
      privateKey: decodeBase64(priv)
    };
  } else {
    // Generate new credentials
    const newKeys = generateIdentityKeys();
    localStorage.setItem('ichat_identity_key_public', newKeys.publicKey);
    localStorage.setItem('ichat_identity_key_private', newKeys.privateKey);
    state.keys = {
      publicKey: decodeBase64(newKeys.publicKey),
      privateKey: decodeBase64(newKeys.privateKey)
    };
  }

  // Load user-scoped chat logs, groups & message records
  const userId = state.user?.id || 'guest';
  const chats = localStorage.getItem(`ichat_chats_${userId}`) || localStorage.getItem('ichat_chats');
  state.chats = chats ? JSON.parse(chats) : [];

  const storedGroups = localStorage.getItem(`ichat_groups_${userId}`);
  state.groups = storedGroups ? JSON.parse(storedGroups) : [];

  const msgs = localStorage.getItem(`ichat_messages_${userId}`) || localStorage.getItem('ichat_messages');
  state.messages = msgs ? JSON.parse(msgs) : [];

  // Outbox pending sync
  const out = localStorage.getItem('ichat_outbox');
  state.outbox = out ? JSON.parse(out) : [];

  // Load theme
  state.theme = localStorage.getItem('ichat_theme') || 'system';
}

function saveStateToLocalStorage() {
  const userId = state.user?.id || 'guest';
  localStorage.setItem(`ichat_chats_${userId}`, JSON.stringify(state.chats));
  localStorage.setItem(`ichat_groups_${userId}`, JSON.stringify(state.groups));
  localStorage.setItem(`ichat_messages_${userId}`, JSON.stringify(state.messages));
  localStorage.setItem('ichat_outbox', JSON.stringify(state.outbox));
}


/* ═══════════ THEME MANAGEMENT ═══════════ */
function applyTheme(themeMode) {
  const appEl = document.getElementById('app');
  appEl.className = ''; // Reset classes
  
  if (themeMode === 'light') {
    appEl.classList.add('theme-light');
  } else if (themeMode === 'dark') {
    appEl.classList.add('theme-dark');
  } else {
    appEl.classList.add('theme-system');
  }
  
  localStorage.setItem('ichat_theme', themeMode);
  state.theme = themeMode;
}

// Monitor System Appearance shifts dynamically
const systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
systemThemeMedia.addEventListener('change', () => {
  if (state.theme === 'system') {
    applyTheme('system');
  }
});


/* ═══════════ WEBSOCKET CLIENT & SYNC ═══════════ */
function connectWebSocket() {
  if (!state.token) return;

  // Serverless platforms like Vercel do not support persistent WebSockets
  const hostname = window.location.hostname;
  const isServerlessHost = hostname.endsWith('.vercel.app') || 
                           hostname.endsWith('.netlify.app') || 
                           hostname.endsWith('.now.sh');

  if (isServerlessHost) {
    console.log('[WS] Serverless environment detected (Vercel). WebSockets disabled; using HTTP polling mode.');
    return;
  }

  console.log('[WS] Establishing socket connection...');
  try {
    state.socket = new WebSocket(WS_BASE);
  } catch (err) {
    console.warn('[WS] Socket connection skipped:', err);
    return;
  }

  state.socket.onopen = () => {
    console.log('[WS] Connection open. Authenticating session...');
    state.reconnectAttempts = 0;
    
    // Authenticate
    state.socket.send(JSON.stringify({
      type: 'auth',
      token: state.token
    }));
  };

  state.socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      
      // 1. Auth Success
      if (data.type === 'auth-success') {
        console.log('[WS] Session authenticated as @' + data.username);
        flushOutboxQueue();
        updateContactStatusesUI();
        return;
      }

      // 2. Incoming message
      if (data.type === 'message') {
        await handleIncomingMessage(data);
        return;
      }

      // 3. Typing indicator status
      if (data.type === 'typing') {
        handleIncomingTyping(data);
        return;
      }

      // 4. Message delivery checks (ack checkmarks)
      if (data.type === 'ack') {
        handleAckReceipt(data);
        return;
      }

      // 5. Voice Call signaling
      if (['call-offer', 'call-answer', 'ice-candidate', 'call-hangup', 'call-busy'].includes(data.type)) {
        handleIncomingCallSignaling(data);
        return;
      }

    } catch (err) {
      console.error('[WS ERROR] Failed to parse socket packet:', err);
    }
  };

  state.socket.onerror = (err) => {
    console.warn('[WS] Socket error encountered.');
  };

  state.socket.onclose = () => {
    console.log('[WS] Connection disconnected.');
    
    // Limit reconnection attempts if environment doesn't support WebSockets
    if (state.reconnectAttempts >= 3) {
      console.warn('[WS] Max reconnect attempts reached. Falling back to HTTP polling mode.');
      return;
    }

    // Exponential backoff reconnect (low internet optimization)
    const delay = Math.min(30000, Math.pow(2, state.reconnectAttempts) * 1000);
    state.reconnectAttempts++;
    console.log(`[WS] Attempting reconnection in ${delay}ms...`);
    setTimeout(connectWebSocket, delay);
  };
}

// Send Typing status
function sendTypingIndicator(recipientUsername, isTyping) {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify({
      type: 'typing',
      recipient: recipientUsername,
      status: isTyping
    }));
  }
}

// Sending E2EE messages
async function sendE2EEMessage(recipientUsername, bodyText, mediaData = null) {
  if (state.activeGroup) {
    return sendE2EEGroupMessage(state.activeGroup, bodyText, mediaData);
  }

  const timestamp = new Date().toISOString();
  const messageId = 'msg-' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

  // Check Chat Request Status & Enforce 1-Message Initiation Limit
  let chatItem = state.chats.find(c => c.username === recipientUsername);
  if (!chatItem) {
    chatItem = { username: recipientUsername, email: '', status: 'pending_outgoing', unreadCount: 0 };
    state.chats.push(chatItem);
  } else if (!chatItem.status) {
    chatItem.status = 'accepted';
  }

  if (chatItem.status === 'pending_outgoing') {
    const countSent = state.messages.filter(m => m.chatPartner === recipientUsername && m.sender === state.user.username).length;
    if (countSent >= 1) {
      alert(`You can only send 1 initiation message until @${recipientUsername} accepts your request.`);
      return;
    }
  } else if (chatItem.status === 'pending_incoming') {
    alert(`Please accept the message request from @${recipientUsername} before replying.`);
    return;
  }

  // 1. Fetch public keys of recipient's devices and my other devices
  let recipientKeys, senderOtherKeys;
  try {
    const res = await fetch(`${API_BASE}/api/users/keys?username=${recipientUsername}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error);
    recipientKeys = result.recipient_devices;
    senderOtherKeys = result.sender_other_devices;
  } catch (err) {
    console.error('[E2EE] Failed to fetch device keys:', err);
    alert('Failed to establish secure keys. User might be offline or deleted.');
    return;
  }

  // 2. Generate random 256-bit symmetric encryption key (secret key)
  const sessionKey = nacl.randomBytes(32);

  // 3. Encrypt payload symmetrically
  const content = encryptSymmetric(bodyText || '', sessionKey);
  const nonceBytes = decodeBase64(content.nonce);

  // 4. Encrypt session key for each active recipient device
  const keysMap = {};
  for (const dev of recipientKeys) {
    const devPub = decodeBase64(dev.public_key);
    const encKey = encryptAsymmetric(devPub, state.keys.privateKey, sessionKey, nonceBytes);
    keysMap[dev.device_id] = encKey;
  }

  // Encrypt session key for each of my OTHER devices so they can sync this chat history
  for (const dev of senderOtherKeys) {
    const devPub = decodeBase64(dev.public_key);
    const encKey = encryptAsymmetric(devPub, state.keys.privateKey, sessionKey, nonceBytes);
    keysMap[dev.device_id] = encKey;
  }

  const payload = {
    encryptedBody: content.ciphertext,
    nonce: content.nonce
  };

  const messagePacket = {
    type: 'message',
    messageId,
    sender: state.user?.username || '',
    recipient: recipientUsername,
    keys: keysMap,
    payload: JSON.stringify(payload),
    timestamp,
    media: mediaData // { url, filename, type, size, encryptedKeyBase64, mediaNonceBase64 }
  };

  // 5. Append locally as "sending/sent" status
  const localMsgObj = {
    id: messageId,
    chatPartner: recipientUsername,
    sender: state.user.username,
    body: bodyText,
    timestamp,
    media: mediaData ? {
      url: mediaData.url,
      filename: mediaData.filename,
      type: mediaData.type,
      size: mediaData.size
    } : null,
    status: 'pending' // pending delivery
  };

  state.messages.push(localMsgObj);
  saveStateToLocalStorage();
  renderActiveChat();
  renderChatList();

  // 6. Dispatch via WebSocket or HTTP Transient Queue (for serverless resilience like Vercel)
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify(messagePacket));
  } else {
    try {
      console.log('[HTTP QUEUE] WebSocket offline/serverless. Dispatching via HTTP transient queue...');
      await apiCall('/api/messages', 'POST', { recipient: recipientUsername, packet: messagePacket });
      localMsgObj.status = 'delivered';
      saveStateToLocalStorage();
      renderActiveChat();
      // Immediately check queue
      pollTransientQueue();
    } catch (e) {
      console.warn('[OUTBOX] HTTP delivery failed. Buffering message packet to local outbox:', e);
      state.outbox.push(messagePacket);
      saveStateToLocalStorage();
    }
  }
}

// Send E2EE message to a Group Chat
async function sendE2EEGroupMessage(group, bodyText, mediaData = null) {
  const timestamp = new Date().toISOString();
  const messageId = 'msg-' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

  const otherMembers = group.members.filter(m => m !== state.user.username);

  // Generate 256-bit symmetric session key for group payload
  const sessionKey = nacl.randomBytes(32);
  const content = encryptSymmetric(bodyText || '', sessionKey);
  const nonceBytes = decodeBase64(content.nonce);

  const keysMap = {};

  // Fetch device keys for all other members in the group
  for (const member of otherMembers) {
    try {
      const res = await fetch(`${API_BASE}/api/users/keys?username=${member}`, {
        headers: { 'Authorization': `Bearer ${state.token}` }
      });
      const result = await res.json();
      if (result.success && result.recipient_devices) {
        for (const dev of result.recipient_devices) {
          const devPub = decodeBase64(dev.public_key);
          const encKey = encryptAsymmetric(devPub, state.keys.privateKey, sessionKey, nonceBytes);
          keysMap[dev.device_id] = encKey;
        }
      }
    } catch (e) {
      console.warn(`[GROUP E2EE] Device keys fetch failed for ${member}:`, e);
    }
  }

  // Also encrypt session key for my own OTHER registered devices
  try {
    const myRes = await fetch(`${API_BASE}/api/users/keys?username=${state.user.username}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const myResult = await myRes.json();
    if (myResult.success && myResult.sender_other_devices) {
      for (const dev of myResult.sender_other_devices) {
        const devPub = decodeBase64(dev.public_key);
        const encKey = encryptAsymmetric(devPub, state.keys.privateKey, sessionKey, nonceBytes);
        keysMap[dev.device_id] = encKey;
      }
    }
  } catch (e) {}

  const payload = {
    encryptedBody: content.ciphertext,
    nonce: content.nonce
  };

  const groupPacket = {
    type: 'group_message',
    messageId,
    groupId: group.id,
    groupName: group.name,
    members: group.members,
    sender: state.user.username,
    keys: keysMap,
    payload: JSON.stringify(payload),
    timestamp,
    media: mediaData
  };

  // Local log
  const localMsgObj = {
    id: messageId,
    chatPartner: group.id,
    sender: state.user.username,
    body: bodyText,
    timestamp,
    media: mediaData ? {
      url: mediaData.url,
      filename: mediaData.filename,
      type: mediaData.type,
      size: mediaData.size
    } : null,
    status: 'delivered'
  };

  state.messages.push(localMsgObj);
  saveStateToLocalStorage();
  renderActiveChat();
  renderGroupsList();

  // Dispatch to each group member
  for (const member of otherMembers) {
    if (state.socket && state.socket.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify({ ...groupPacket, recipient: member }));
    } else {
      try {
        await apiCall('/api/messages', 'POST', { recipient: member, packet: groupPacket });
      } catch (e) {
        console.warn(`[GROUP QUEUE] Failed queue to ${member}:`, e);
      }
    }
  }
}

// Poll transient queue for incoming messages when WebSocket is offline or in serverless environments
async function pollTransientQueue() {
  if (!state.token) return;
  try {
    const data = await apiCall(`/api/messages?t=${Date.now()}`, 'GET');
    if (data.success && data.messages && data.messages.length > 0) {
      for (const msgPacket of data.messages) {
        await handleIncomingMessage(msgPacket);
      }
    }
  } catch (err) {
    // Silent catch on poll errors
  }
}

// Flush outbox queue on socket reconnection
function flushOutboxQueue() {
  if (state.outbox.length === 0) return;
  console.log(`[OUTBOX] Reconnected. Flushing ${state.outbox.length} pending messages.`);
  
  while (state.outbox.length > 0) {
    const packet = state.outbox.shift();
    if (state.socket && state.socket.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify(packet));
    } else {
      state.outbox.unshift(packet); // Put back on failure
      break;
    }
  }
  saveStateToLocalStorage();
}

// Decrypting incoming messages
async function handleIncomingMessage(data) {
  // 0A. Handle Chat Request Accepted signal
  if (data.type === 'request-accepted') {
    const partner = data.sender;
    let chatItem = state.chats.find(c => c && c.username === partner);
    if (chatItem) {
      chatItem.status = 'accepted';
      saveStateToLocalStorage();
      switchSidebarTab('home');
      renderChatList();
      renderRequestsList();
      renderActiveChat();
      showToast(`@${partner} accepted your message request!`, 'success');
    }
    return;
  }

  // 0B. Handle Group Created Notification
  if (data.type === 'group_created' && data.group) {
    if (!state.groups.some(g => g.id === data.group.id)) {
      state.groups.push(data.group);
      saveStateToLocalStorage();
      renderGroupsList();
      showToast(`Added to group "${data.group.name}"!`, 'info');
    }
    return;
  }

  // 0B-2. Handle Group Updated Notification (members added/exited)
  if (data.type === 'group_updated' && data.group) {
    let group = state.groups.find(g => g.id === data.group.id);
    const isMemberNow = data.group.members.includes(state.user?.username);

    if (isMemberNow) {
      if (group) {
        group.members = data.group.members;
        if (data.group.name) group.name = data.group.name;
      } else {
        state.groups.push(data.group);
      }
    } else {
      // User was removed or exited
      state.groups = state.groups.filter(g => g.id !== data.group.id);
      if (state.activeGroup && state.activeGroup.id === data.group.id) {
        state.activeGroup = null;
        document.getElementById('chatPane')?.classList.remove('active');
        document.getElementById('chatEmptyState')?.classList.add('active');
      }
    }

    saveStateToLocalStorage();
    renderGroupsList();
    renderActiveChat();
    return;
  }

  // 0C. Handle Group Message
  const isGroupMsg = data.type === 'group_message' || !!data.groupId;
  const { messageId, sender, recipient, keys, key, payload, timestamp, media, isSenderSync, groupId, groupName, members } = data;
  
  const partner = isGroupMsg ? groupId : (isSenderSync ? recipient : sender);
  if (!partner) return;

  // Prevent duplicate logs
  if (state.messages.some(m => m.id === messageId)) return;

  try {
    const sqlPayload = JSON.parse(payload);
    
    // 1. Fetch public keys of sender
    const res = await fetch(`${API_BASE}/api/users/keys?username=${sender}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error);
    
    const recipientDevs = Array.isArray(result.recipient_devices) ? result.recipient_devices : [];
    const senderOtherDevs = Array.isArray(result.sender_other_devices) ? result.sender_other_devices : [];
    const allKnownDevices = [...recipientDevs, ...senderOtherDevs];

    // Collect candidate encrypted keys
    const targetEncryptedKeys = [];
    if (keys && typeof keys === 'object') {
      if (keys[state.deviceId]) {
        targetEncryptedKeys.push(keys[state.deviceId]);
      }
      Object.values(keys).forEach(k => {
        if (!targetEncryptedKeys.includes(k)) targetEncryptedKeys.push(k);
      });
    }
    if (key && !targetEncryptedKeys.includes(key)) {
      targetEncryptedKeys.push(key);
    }

    let decryptedBody = '';

    // Attempt asymmetric key decryption across candidate session keys & sender device public keys
    for (const encSessionKey of targetEncryptedKeys) {
      for (const dev of allKnownDevices) {
        try {
          const devPub = decodeBase64(dev.public_key);
          const nonceBytes = decodeBase64(sqlPayload.nonce);
          const decryptedSessionKey = decryptAsymmetric(devPub, state.keys.privateKey, encSessionKey, nonceBytes);
          if (decryptedSessionKey) {
            decryptedBody = decryptSymmetric(sqlPayload.encryptedBody, sqlPayload.nonce, decryptedSessionKey);
            if (decryptedBody) break;
          }
        } catch (e) {
          // Continue testing remaining device key combinations
        }
      }
      if (decryptedBody) break;
    }

    if (!decryptedBody && !media) {
      decryptedBody = '[Decryption error: Shared key mismatch]';
    }

    // Save message locally
    const newMsgObj = {
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

    state.messages.push(newMsgObj);
    
    if (isGroupMsg) {
      // Auto-create group locally if not already registered
      let groupItem = state.groups.find(g => g.id === groupId);
      if (!groupItem) {
        groupItem = {
          id: groupId,
          name: groupName || 'Group Chat',
          members: members || [sender, state.user.username],
          createdBy: sender,
          createdAt: timestamp,
          unreadCount: 0
        };
        state.groups.push(groupItem);
      }

      if (!state.activeGroup || state.activeGroup.id !== groupId) {
        groupItem.unreadCount = (groupItem.unreadCount || 0) + 1;
      }

      saveStateToLocalStorage();
      renderGroupsList();
      renderActiveChat();
    } else {
      // 1-on-1 Chat
      let chatItem = state.chats.find(c => c.username === partner);
      if (!chatItem) {
        chatItem = {
          username: partner,
          email: '',
          status: isSenderSync ? 'accepted' : 'pending_incoming',
          unreadCount: 0
        };
        state.chats.push(chatItem);
      }

      // Increment unread count if not currently viewing
      if (state.activeChatPartner !== partner) {
        if (chatItem) chatItem.unreadCount = (chatItem.unreadCount || 0) + 1;
      } else {
        // Currently active, send read receipt automatically
        sendReadAcknowledgement(messageId, sender);
        newMsgObj.status = 'read';
      }

      saveStateToLocalStorage();
      renderChatList();
      renderRequestsList();
      renderActiveChat();

      // Trigger double check delivery ack back to sender (skip for self syncs)
      if (!isSenderSync) {
        sendDeliveryAcknowledgement(messageId, sender);
      }
    }

  } catch (error) {
    console.error('[E2EE] Failed to process incoming message:', error);
  }
}

// Status Acknowledgement Dispatchers
function sendDeliveryAcknowledgement(messageId, senderOfMessage) {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify({
      type: 'ack-delivered',
      messageId,
      senderOfMessage
    }));
  }
}

function sendReadAcknowledgement(messageId, senderOfMessage) {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify({
      type: 'ack-read',
      messageId,
      senderOfMessage
    }));
  }
}

const readToastTracker = new Set();

function handleAckReceipt(data) {
  const { messageId, status } = data;
  const msgIndex = state.messages.findIndex(m => m.id === messageId);
  if (msgIndex !== -1) {
    const msg = state.messages[msgIndex];
    const currentStatus = msg.status;
    if (status === 'read' || (status === 'delivered' && currentStatus !== 'read')) {
      msg.status = status;
      saveStateToLocalStorage();
      renderActiveChat();

      if (status === 'read' && !readToastTracker.has(messageId)) {
        readToastTracker.add(messageId);
        showToast(`@${msg.chatPartner} read your message`, 'info');
      }
    }
  }
}

let typingClearTimeout = null;
const onlineToastTracker = new Set();

function handleIncomingTyping(data) {
  const { sender, status } = data;

  if (state.activeChatPartner === sender) {
    const typingEl = document.getElementById('chatTitleTypingText');
    const statusEl = document.getElementById('chatTitleStatusText');
    if (typingEl && statusEl) {
      if (status) {
        typingEl.style.display = 'inline';
        statusEl.style.display = 'none';
        clearTimeout(typingClearTimeout);
        typingClearTimeout = setTimeout(() => {
          typingEl.style.display = 'none';
          statusEl.style.display = 'inline';
        }, 3500);
      } else {
        clearTimeout(typingClearTimeout);
        typingEl.style.display = 'none';
        statusEl.style.display = 'inline';
      }
    }
  }
}

// Update partner online indicators
function updateContactStatusesUI() {
  const statusEl = document.getElementById('chatTitleStatusText');
  if (state.activeChatPartner && statusEl) {
    statusEl.className = 'status-online';
    statusEl.innerText = 'Online • Encrypted Session';
    
    // Show online status toast once when starting conversation
    if (!onlineToastTracker.has(state.activeChatPartner)) {
      onlineToastTracker.add(state.activeChatPartner);
      showToast(`@${state.activeChatPartner} is online`, 'info');
    }
  }
}


function compressImageFile(file) {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) {
      return resolve(file);
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 1280;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (blob) {
            const compressedFile = new File([blob], file.name, {
              type: 'image/jpeg',
              lastModified: Date.now()
            });
            resolve(compressedFile);
          } else {
            resolve(file);
          }
        }, 'image/jpeg', 0.6); // ~10% size compression
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ═══════════ MEDIA UPLOAD & ENCRYPT/DECRYPT ═══════════ */
async function encryptAndUploadFile(rawFile, isGallery = false) {
  try {
    // Enforce 500 MB limit
    if (rawFile.size > 500 * 1024 * 1024) {
      showToast('File exceeds maximum size limit of 500 MB', 'warning');
      return null;
    }

    let fileToUpload = rawFile;
    if (isGallery || rawFile.type.startsWith('image/')) {
      fileToUpload = await compressImageFile(rawFile);
    }

    // 1. Read file bytes
    const arrayBuffer = await fileToUpload.arrayBuffer();
    const fileBytes = new Uint8Array(arrayBuffer);

    // 2. Generate random 256-bit media encryption key and nonce
    const mediaKey = nacl.randomBytes(32);
    const mediaNonce = nacl.randomBytes(24);

    // 3. Encrypt file locally using NaCl secretbox
    const encryptedBytes = nacl.secretbox(fileBytes, mediaNonce, mediaKey);

    // 4. Wrap ciphertext in a Blob and append to form
    const encryptedBlob = new Blob([encryptedBytes], { type: 'application/octet-stream' });
    const formData = new FormData();
    formData.append('file', encryptedBlob, fileToUpload.name);

    // 5. Upload encrypted binary to server endpoint
    const res = await fetch(`${API_BASE}/api/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` },
      body: formData
    });

    const result = await res.json();
    if (!result.success) throw new Error(result.error || 'Upload failed');

    // 6. Cache decrypted file in IndexedDB immediately for instant local render
    await saveMediaToLocalDB(result.url, arrayBuffer, fileToUpload.type);
    state.localMediaCache.set(result.url, URL.createObjectURL(new Blob([arrayBuffer], { type: fileToUpload.type })));

    // Return E2EE media descriptor to embed in chat message packet
    return {
      url: result.url,
      filename: fileToUpload.name,
      type: fileToUpload.type,
      size: fileToUpload.size,
      encryptedKeyBase64: encodeBase64(mediaKey),
      mediaNonceBase64: encodeBase64(mediaNonce)
    };

  } catch (error) {
    console.error('[MEDIA] Failed to encrypt or upload file:', error);
    showToast('Failed to upload file. Check size limits (500 MB).', 'warning');
    return null;
  }
}

// Download and decrypt media attachments securely
async function getDecryptedMediaUrl(mediaObj) {
  const { url, type } = mediaObj;
  
  // 1. Check in-memory session cache first
  if (state.localMediaCache.has(url)) {
    return state.localMediaCache.get(url);
  }

  // 2. Check IndexedDB storage cache
  const localCache = await getMediaFromLocalDB(url);
  if (localCache) {
    const blob = new Blob([localCache.arrayBuffer], { type: localCache.mimeType });
    const localUrl = URL.createObjectURL(blob);
    state.localMediaCache.set(url, localUrl);
    return localUrl;
  }

  // 3. Retrieve keys from media metadata (keys were securely shared via the E2EE chat bubble)
  if (!mediaObj.encryptedKey || !mediaObj.mediaNonce) {
    return null; // Missing E2EE keys
  }

  const mediaKey = decodeBase64(mediaObj.encryptedKey);
  const mediaNonce = decodeBase64(mediaObj.mediaNonce);

  try {
    // 4. Download E2EE ciphertext from server
    const response = await fetch(url);
    if (!response.ok) throw new Error('File download failed');
    const encryptedArrayBuffer = await response.arrayBuffer();
    const encryptedBytes = new Uint8Array(encryptedArrayBuffer);

    // 5. Decrypt binary bytes locally using TweetNaCl
    const decryptedBytes = nacl.secretbox.open(encryptedBytes, mediaNonce, mediaKey);
    if (!decryptedBytes) throw new Error('Media decryption failed');

    // 6. Save decrypted file bytes to IndexedDB
    await saveMediaToLocalDB(url, decryptedBytes.buffer, type);

    // 7. Generate local blob URL and cache
    const blob = new Blob([decryptedBytes], { type });
    const localUrl = URL.createObjectURL(blob);
    state.localMediaCache.set(url, localUrl);
    return localUrl;

  } catch (error) {
    console.error('[MEDIA] Decryption failure:', error);
    return null;
  }
}


/* ═══════════ WEBRTC AUDIO CALLING ═══════════ */
// Establish Peer Connection
async function startWebRTCCall(recipientUsername, isIncoming = false) {
  state.peerConnection = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });

  // Handle remote stream tracks
  state.peerConnection.ontrack = (event) => {
    console.log('[WebRTC] Received remote stream track');
    const audioEl = document.getElementById('remoteAudioStream');
    if (audioEl && event.streams[0]) {
      audioEl.srcObject = event.streams[0];
    }
  };

  // Dispatch local ICE candidates to recipient
  state.peerConnection.onicecandidate = (event) => {
    if (event.candidate && state.socket && state.socket.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify({
        type: 'ice-candidate',
        recipient: recipientUsername,
        candidate: event.candidate
      }));
    }
  };

  // Acquire local microphone audio
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    state.localStream.getTracks().forEach((track) => {
      state.peerConnection.addTrack(track, state.localStream);
    });
  } catch (err) {
    console.error('[WebRTC] Failed to acquire microphone:', err);
    alert('Microphone access is required for voice calls.');
    hangUpCall(recipientUsername);
    return false;
  }
  return true;
}

// Triggers Calling Outflow
async function triggerCallOut(recipientUsername) {
  state.currentCall = { partner: recipientUsername, type: 'outgoing', status: 'ringing' };
  openCallUI(recipientUsername, 'ringing', 'outgoing');

  const ready = await startWebRTCCall(recipientUsername);
  if (!ready) return;

  // Generate SDP Offer
  const offer = await state.peerConnection.createOffer();
  await state.peerConnection.setLocalDescription(offer);

  // Send signaling call offer packet
  state.socket.send(JSON.stringify({
    type: 'call-offer',
    recipient: recipientUsername,
    offer
  }));
}

// Call Signaling Inbound router
async function handleIncomingCallSignaling(data) {
  const { type, sender, offer, answer, candidate } = data;

  if (type === 'call-offer') {
    // If already in a call, send busy signal
    if (state.currentCall) {
      state.socket.send(JSON.stringify({
        type: 'call-busy',
        recipient: sender
      }));
      return;
    }

    state.currentCall = { partner: sender, type: 'incoming', status: 'ringing' };
    openCallUI(sender, 'ringing', 'incoming');
    
    // Cache the WebRTC offer configuration
    state.incomingOfferData = offer;
    return;
  }

  if (type === 'call-answer') {
    if (state.currentCall && state.currentCall.type === 'outgoing') {
      state.currentCall.status = 'connected';
      document.getElementById('callStatusText').innerText = 'Connected';
      document.getElementById('callOverlay').className = 'call-overlay-container active active-call';
      
      await state.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }
    return;
  }

  if (type === 'ice-candidate') {
    if (state.peerConnection) {
      await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
    return;
  }

  if (type === 'call-hangup') {
    cleanupCallState();
    return;
  }

  if (type === 'call-busy') {
    alert(`${state.currentCall?.partner || 'User'} is busy on another call.`);
    cleanupCallState();
    return;
  }
}

// User Actions: Call Accepted
async function acceptIncomingCall() {
  if (!state.currentCall || !state.incomingOfferData) return;
  const caller = state.currentCall.partner;

  state.currentCall.status = 'connecting';
  document.getElementById('callStatusText').innerText = 'Connecting...';
  document.getElementById('callOverlay').className = 'call-overlay-container active active-call';

  const ready = await startWebRTCCall(caller);
  if (!ready) return;

  // Set remote SDP Offer description
  await state.peerConnection.setRemoteDescription(new RTCSessionDescription(state.incomingOfferData));

  // Generate SDP Answer
  const answer = await state.peerConnection.createAnswer();
  await state.peerConnection.setLocalDescription(answer);

  // Send answer signaling packet
  state.socket.send(JSON.stringify({
    type: 'call-answer',
    recipient: caller,
    answer
  }));

  state.currentCall.status = 'connected';
  document.getElementById('callStatusText').innerText = 'Connected';
}

function declineIncomingCall() {
  if (!state.currentCall) return;
  const caller = state.currentCall.partner;
  state.socket.send(JSON.stringify({
    type: 'call-hangup',
    recipient: caller
  }));
  cleanupCallState();
}

function hangUpCall(partner) {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify({
      type: 'call-hangup',
      recipient: partner || state.currentCall?.partner
    }));
  }
  cleanupCallState();
}

function toggleMuteMic() {
  if (state.localStream) {
    state.callMuted = !state.callMuted;
    state.localStream.getAudioTracks().forEach(track => {
      track.enabled = !state.callMuted;
    });
    
    const muteBtn = document.getElementById('btnCallMute');
    if (state.callMuted) {
      muteBtn.classList.add('active');
      muteBtn.innerHTML = '<i data-feather="mic"></i>';
    } else {
      muteBtn.classList.remove('active');
      muteBtn.innerHTML = '<i data-feather="mic-off"></i>';
    }
    feather.replace();
  }
}

function cleanupCallState() {
  // Stop mic tracks
  if (state.localStream) {
    state.localStream.getTracks().forEach(track => track.stop());
    state.localStream = null;
  }
  // Close WebRTC channels
  if (state.peerConnection) {
    state.peerConnection.close();
    state.peerConnection = null;
  }
  state.currentCall = null;
  state.incomingOfferData = null;
  state.callMuted = false;

  const audioEl = document.getElementById('remoteAudioStream');
  if (audioEl) audioEl.srcObject = null;

  document.getElementById('callOverlay').className = 'call-overlay-container';
}


/* ═══════════ REST API CLIENT CONTROLLER ═══════════ */
async function apiCall(endpoint, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${endpoint}`, options);
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || 'API Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Step 1: Send OTP Login
async function requestOtp(email) {
  const form = document.getElementById('requestOtpForm');
  const btn = form.querySelector('button[type="submit"]');
  const originalHtml = btn.innerHTML;

  btn.disabled = true;
  btn.innerHTML = '<span>Sending Code...</span><i data-feather="loader" class="animate-pulse"></i>';
  feather.replace();

  try {
    await apiCall('/api/auth/request-otp', 'POST', { email });
    
    // Transition Forms
    form.classList.remove('active');
    document.getElementById('verifyOtpForm').classList.add('active');
    document.getElementById('otpTargetMessage').innerText = `Sent to ${email}`;
    document.getElementById('otpCodeInput').focus();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    feather.replace();
  }
}

// Step 2: Validate OTP
async function verifyOtp(email, code, replaceDeviceId = null) {
  const form = document.getElementById('verifyOtpForm');
  const btn = form.querySelector('button[type="submit"]');
  const originalHtml = btn.innerHTML;

  btn.disabled = true;
  btn.innerHTML = '<span>Verifying...</span><i data-feather="loader" class="animate-pulse"></i>';
  feather.replace();

  try {
    const payload = {
      email,
      code,
      device_id: state.deviceId,
      device_name: navigator.userAgent.split(')')[0].split('(')[1] || 'Web Session',
      public_key: encodeBase64(state.keys.publicKey)
    };

    if (replaceDeviceId) {
      payload.replace_device_id = replaceDeviceId;
    }

    const data = await apiCall('/api/auth/verify-otp', 'POST', payload);
    
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('ichat_token', data.token);
    localStorage.setItem('ichat_user', JSON.stringify(data.user));

    // Clear conflict resolution layers
    document.getElementById('deviceConflictResolver').classList.remove('active');

    // Route Screens
    document.getElementById('authScreen').classList.remove('active');
    
    if (data.username_required) {
      document.getElementById('usernameScreen').classList.add('active');
      document.getElementById('usernameInput').focus();
    } else {
      document.getElementById('chatDashboard').classList.add('active');
      initDashboard();
    }
  } catch (err) {
    if (err.data && err.data.error === 'MAX_DEVICES_EXCEEDED') {
      renderDeviceConflictList(email, code, err.data.devices);
    } else {
      alert(err.message);
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    feather.replace();
  }
}

// Step 3: Username Setup
async function registerUsername(username) {
  const form = document.getElementById('usernameForm');
  const btn = form.querySelector('button[type="submit"]');
  const originalHtml = btn.innerHTML;

  btn.disabled = true;
  btn.innerHTML = '<span>Saving...</span><i data-feather="loader" class="animate-pulse"></i>';
  feather.replace();

  try {
    const data = await apiCall('/api/auth/register-username', 'POST', { username });
    state.user = data.user;
    localStorage.setItem('ichat_user', JSON.stringify(data.user));

    document.getElementById('usernameScreen').classList.remove('active');
    document.getElementById('chatDashboard').classList.add('active');
    initDashboard();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    feather.replace();
  }
}

// Step 4: De-registration (Account Wipe)
async function deleteAccount() {
  if (confirm('CAUTION: This will permanently delete your user profile, active device registrations, and cloud backups from the server registry. This action CANNOT be undone. Proceed?')) {
    const btn = document.getElementById('btnDeleteAccount');
    const originalHtml = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = '<span>Deleting Account...</span><i data-feather="loader" class="animate-pulse"></i>';
    feather.replace();

    try {
      await apiCall('/api/auth/delete-account', 'POST');
      triggerLogOut();
    } catch (err) {
      alert('Delete profile failed: ' + err.message);
      btn.disabled = false;
      btn.innerHTML = originalHtml;
      feather.replace();
    }
  }
}

function triggerLogOut() {
  localStorage.clear();
  clearMediaLocalDB();
  state.token = null;
  state.user = null;
  state.chats = [];
  state.messages = [];
  state.outbox = [];
  
  if (state.socket) {
    state.socket.close();
  }
  
  // Back to login screen
  document.getElementById('chatDashboard').classList.remove('active');
  document.getElementById('settingsModal').classList.remove('active');
  document.getElementById('authScreen').classList.add('active');
  document.getElementById('requestOtpForm').classList.add('active');
  document.getElementById('verifyOtpForm').classList.remove('active');
  document.getElementById('emailInput').value = '';
  document.getElementById('otpCodeInput').value = '';
}


/* ═══════════ GOOGLE DRIVE ZERO-KNOWLEDGE BACKUP & RESTORE ═══════════ */
let googleDriveAccessToken = null;
const GOOGLE_CLIENT_ID = '727368410192-bd9ijvr8fmseqgcbp7de22bk28eooq5g.apps.googleusercontent.com';

function getGoogleAccessToken() {
  return new Promise((resolve, reject) => {
    if (googleDriveAccessToken) return resolve(googleDriveAccessToken);

    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      return reject(new Error('Google Identity Services SDK not loaded'));
    }

    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (response) => {
        if (response.error) {
          return reject(new Error(response.error_description || response.error));
        }
        googleDriveAccessToken = response.access_token;
        resolve(googleDriveAccessToken);
      }
    });

    client.requestAccessToken();
  });
}

async function uploadBackupToGoogleDrive(backupBlobString) {
  const token = await getGoogleAccessToken();

  const searchRes = await fetch("https://www.googleapis.com/drive/v3/files?q=name='ichat_e2ee_backup.json' and trashed=false", {
    headers: { Authorization: `Bearer ${token}` }
  });
  const searchData = await searchRes.json();
  const existingFile = searchData.files && searchData.files[0];

  const metadata = {
    name: 'ichat_e2ee_backup.json',
    mimeType: 'application/json'
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([backupBlobString], { type: 'application/json' }));

  let uploadRes;
  if (existingFile) {
    uploadRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=multipart`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });
  } else {
    uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });
  }

  if (!uploadRes.ok) {
    const errData = await uploadRes.json();
    throw new Error(errData.error?.message || 'Google Drive upload failed');
  }

  return true;
}

async function downloadBackupFromGoogleDrive() {
  const token = await getGoogleAccessToken();

  const searchRes = await fetch("https://www.googleapis.com/drive/v3/files?q=name='ichat_e2ee_backup.json' and trashed=false", {
    headers: { Authorization: `Bearer ${token}` }
  });
  const searchData = await searchRes.json();
  if (!searchData.files || searchData.files.length === 0) {
    throw new Error('No ichat_e2ee_backup.json backup file found in your Google Drive.');
  }

  const fileId = searchData.files[0].id;
  const fileRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!fileRes.ok) {
    throw new Error('Failed to download backup from Google Drive');
  }

  return await fileRes.text();
}

async function executeBackup(passcode) {
  if (!passcode || passcode.length < 4) {
    alert('Please specify a strong backup password (at least 4 characters).');
    return;
  }

  const btn = document.getElementById('btnCreateBackup');
  const originalHtml = btn.innerHTML;

  btn.disabled = true;
  btn.innerHTML = '<span>Uploading to Drive...</span><i data-feather="loader" class="animate-pulse"></i>';
  feather.replace();

  const backupStatusEl = document.getElementById('backupStatusText');
  backupStatusEl.innerText = 'Creating secure backup...';

  try {
    const payloadObject = {
      chats: state.chats,
      messages: state.messages,
      keys: {
        publicKey: encodeBase64(state.keys.publicKey),
        privateKey: encodeBase64(state.keys.privateKey)
      }
    };
    const plaintext = JSON.stringify(payloadObject);

    const salt = state.user?.email || 'ichat_salt';
    const derivedKeyBytes = await pbkdf2(passcode, salt, 32);

    const encrypted = encryptSymmetric(plaintext, derivedKeyBytes);
    const backupBlobString = JSON.stringify(encrypted);

    backupStatusEl.innerText = 'Uploading to Google Drive...';
    await uploadBackupToGoogleDrive(backupBlobString);

    const timeStr = new Date().toLocaleString();
    backupStatusEl.innerText = `Backup successfully uploaded to Google Drive! (${timeStr})`;
    localStorage.setItem('ichat_backup_status', timeStr);
    localStorage.setItem('ichat_backup_last_timestamp', new Date().toISOString());
  } catch (err) {
    console.error('[GOOGLE DRIVE BACKUP ERROR]', err);
    backupStatusEl.innerText = 'Failed to upload backup: ' + err.message;
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    feather.replace();
  }
}

async function executeRestore(passcode) {
  if (!passcode) {
    alert('Enter backup passcode to decrypt files.');
    return;
  }

  const btn = document.getElementById('btnRestoreBackup');
  const originalHtml = btn.innerHTML;

  btn.disabled = true;
  btn.innerHTML = '<span>Fetching from Drive...</span><i data-feather="loader" class="animate-pulse"></i>';
  feather.replace();

  const backupStatusEl = document.getElementById('backupStatusText');
  backupStatusEl.innerText = 'Downloading backup from Google Drive...';

  try {
    const backupBlobString = await downloadBackupFromGoogleDrive();

    backupStatusEl.innerText = 'Decrypting database...';
    const encryptedBlob = JSON.parse(backupBlobString);

    const salt = state.user?.email || 'ichat_salt';
    const derivedKeyBytes = await pbkdf2(passcode, salt, 32);

    const decryptedJsonString = decryptSymmetric(encryptedBlob.ciphertext, encryptedBlob.nonce, derivedKeyBytes);
    const restored = JSON.parse(decryptedJsonString);

    state.chats = restored.chats;
    state.messages = restored.messages;
    state.keys = {
      publicKey: decodeBase64(restored.keys.publicKey),
      privateKey: decodeBase64(restored.keys.privateKey)
    };

    localStorage.setItem('ichat_identity_key_public', restored.keys.publicKey);
    localStorage.setItem('ichat_identity_key_private', restored.keys.privateKey);
    saveStateToLocalStorage();

    renderChatList();
    renderActiveChat();
    updateStorageStatsUI();

    backupStatusEl.innerText = 'Database successfully restored from Google Drive!';
  } catch (err) {
    console.error('[RESTORE ERROR]', err);
    backupStatusEl.innerText = 'Decryption failed: ' + err.message;
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    feather.replace();
  }
}


/* ═══════════ DOM RENDERING & UI UPDATES ═══════════ */

// Conflict Resolution Screen Renders
function renderDeviceConflictList(email, code, devices) {
  const container = document.getElementById('deviceReplaceList');
  container.innerHTML = '';

  devices.forEach(dev => {
    const item = document.createElement('div');
    item.className = 'device-replace-item';
    
    const info = document.createElement('div');
    info.innerHTML = `<h5>${dev.device_name}</h5><span>Last Active: ${new Date(dev.last_active).toLocaleString()}</span>`;
    
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary btn-sm';
    btn.innerText = 'Replace';
    
    item.appendChild(info);
    item.appendChild(btn);
    
    btn.addEventListener('click', () => {
      verifyOtp(email, code, dev.device_id);
    });

    container.appendChild(item);
  });

  document.getElementById('deviceConflictResolver').classList.add('active');
}

// Accept incoming chat request
async function acceptChatRequest(partnerUsername) {
  let chatItem = state.chats.find(c => c && c.username === partnerUsername);
  if (chatItem) {
    chatItem.status = 'accepted';
    chatItem.unreadCount = 0;

    // Mark incoming messages as read and send read receipts
    state.messages.forEach(m => {
      if (m.chatPartner === partnerUsername && m.sender !== state.user.username && m.status !== 'read') {
        m.status = 'read';
        sendReadAcknowledgement(m.id, partnerUsername);
      }
    });

    saveStateToLocalStorage();

    // Send request-accepted signal to initiator
    const acceptPacket = {
      type: 'request-accepted',
      sender: state.user.username,
      recipient: partnerUsername,
      timestamp: new Date().toISOString()
    };

    if (state.socket && state.socket.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify(acceptPacket));
    } else {
      try {
        await apiCall('/api/messages', 'POST', { recipient: partnerUsername, packet: acceptPacket });
      } catch (e) {
        console.warn('[REQUEST] Failed to send acceptance signal:', e);
      }
    }

    switchSidebarTab('home');
    renderChatList();
    renderRequestsList();
    renderActiveChat();
    showToast(`Accepted message request from @${partnerUsername}`, 'success');
  }
}

// Decline incoming chat request
function declineChatRequest(partnerUsername) {
  state.chats = state.chats.filter(c => c.username !== partnerUsername);
  state.messages = state.messages.filter(m => m.chatPartner !== partnerUsername);
  
  if (state.activeChatPartner === partnerUsername) {
    state.activeChatPartner = null;
    document.getElementById('chatPane')?.classList.remove('active');
    document.getElementById('chatEmptyState')?.classList.add('active');
  }
  
  saveStateToLocalStorage();
  switchSidebarTab('home');
  renderChatList();
  renderRequestsList();
  renderActiveChat();
  showToast(`Request from @${partnerUsername} declined`, 'info');
}

// Bulk Decline All Pending Requests
function declineAllRequests() {
  const pendingRequests = state.chats.filter(c => c && c.status === 'pending_incoming');
  if (pendingRequests.length === 0) {
    showToast('No pending requests to decline', 'info');
    return;
  }

  showConfirmModal({
    title: 'Decline All Requests?',
    message: `Are you sure you want to decline and clear all ${pendingRequests.length} pending message requests?`,
    icon: 'trash-2',
    confirmText: 'Decline All',
    cancelText: 'Cancel',
    isDanger: true,
    onConfirm: () => {
      const usernamesToRemove = pendingRequests.map(c => c.username);
      state.chats = state.chats.filter(c => !usernamesToRemove.includes(c.username));
      state.messages = state.messages.filter(m => !usernamesToRemove.includes(m.chatPartner));
      
      if (usernamesToRemove.includes(state.activeChatPartner)) {
        state.activeChatPartner = null;
        document.getElementById('chatPane')?.classList.remove('active');
        document.getElementById('chatEmptyState')?.classList.add('active');
      }

      saveStateToLocalStorage();
      renderChatList();
      renderRequestsList();
      renderActiveChat();
      showToast('All pending requests declined', 'success');
    }
  });
}

// Sidebar Requests list renderer (100+ Requests Scalable View)
function renderRequestsList() {
  const container = document.getElementById('requestsContainer');
  const badgeView = document.getElementById('requestsCountBadge');
  const badgeNav = document.getElementById('requestsNavBadge');
  const filterInput = document.getElementById('requestSearchInput');
  const query = filterInput ? filterInput.value.trim().toLowerCase() : '';

  if (!container) return;

  let pendingRequests = state.chats.filter(c => c && c.status === 'pending_incoming');
  const totalCount = pendingRequests.length;
  const formattedCount = totalCount > 99 ? '99+' : totalCount.toString();

  if (badgeView) badgeView.innerText = formattedCount;
  if (badgeNav) {
    badgeNav.innerText = formattedCount;
    badgeNav.style.display = totalCount > 0 ? 'inline-block' : 'none';
  }

  // Live filter query
  if (query) {
    pendingRequests = pendingRequests.filter(c => c.username.toLowerCase().includes(query));
  }

  if (pendingRequests.length === 0) {
    container.innerHTML = `<div style="padding: 24px 16px; text-align: center; color: var(--text-muted); font-size: 13px;">${query ? 'No matching requests' : 'No pending message requests'}</div>`;
    return;
  }

  container.innerHTML = '';
  pendingRequests.forEach(chat => {
    const lastMsg = state.messages.filter(m => m.chatPartner === chat.username).slice(-1)[0];
    const displayMsg = lastMsg 
      ? (lastMsg.media ? `📷 ${lastMsg.media.filename}` : (lastMsg.body || '')) 
      : 'New Message Request';
    const avatarInitial = (chat.username || 'C').substring(0, 2).toUpperCase();
    const isSelected = state.selectedRequests.has(chat.username);

    const item = document.createElement('div');
    item.className = `request-item ${state.activeChatPartner === chat.username ? 'active' : ''} ${isSelected ? 'selected' : ''}`;
    item.innerHTML = `
      ${state.isRequestsSelectionMode ? `
        <div class="custom-checkbox">
          <i data-feather="check"></i>
        </div>
      ` : ''}
      <div class="request-item-user">
        <div class="request-avatar">${avatarInitial}</div>
        <div class="request-user-info">
          <h5>@${chat.username}</h5>
          <p style="max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${displayMsg}</p>
        </div>
      </div>
      <span class="request-tag">Request</span>
    `;

    bindLongPress(item, 
      () => {
        toggleRequestSelection(chat.username);
      },
      () => {
        if (state.isRequestsSelectionMode) {
          toggleRequestSelection(chat.username);
        } else {
          openConversation(chat.username);
        }
      }
    );

    container.appendChild(item);
  });
  feather.replace();
}

// Sidebar Chats list renderer (Main chats)
function renderChatList() {
  const container = document.getElementById('chatsContainer');
  container.innerHTML = '';

  // Main chats list contains accepted chats and pending outgoing chats
  const mainChats = state.chats.filter(c => c && (c.status === 'accepted' || c.status === 'pending_outgoing' || !c.status));

  if (mainChats.length === 0) {
    container.innerHTML = `
      <div class="chat-list-empty">
        <i data-feather="users" class="empty-icon"></i>
        <p>No conversations started.</p>
        <span>Add a contact above to begin encrypting.</span>
      </div>
    `;
    renderRequestsList();
    feather.replace();
    return;
  }

  // Sort chats by last message timestamp
  const sortedChats = [...mainChats].sort((a, b) => {
    const lastA = state.messages.filter(m => m.chatPartner === a.username).slice(-1)[0];
    const lastB = state.messages.filter(m => m.chatPartner === b.username).slice(-1)[0];
    const timeA = lastA ? new Date(lastA.timestamp) : new Date(0);
    const timeB = lastB ? new Date(lastB.timestamp) : new Date(0);
    return timeB - timeA;
  });

  sortedChats.forEach(chat => {
    if (!chat || !chat.username) return;

    const lastMsg = state.messages.filter(m => m.chatPartner === chat.username).slice(-1)[0];
    const displayMsg = lastMsg 
      ? (lastMsg.media ? `📷 ${lastMsg.media.filename}` : (lastMsg.body || '')) 
      : 'No messages yet';
    const displayTime = lastMsg 
      ? new Date(lastMsg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
      : '';

    const avatarInitial = (chat.username || 'C').substring(0, 2).toUpperCase();
    const isPendingOutgoing = chat.status === 'pending_outgoing';
    const isSelected = state.selectedChats.has(chat.username);

    const item = document.createElement('div');
    item.className = `chat-list-item ${state.activeChatPartner === chat.username ? 'active' : ''} ${isSelected ? 'selected' : ''}`;
    
    item.innerHTML = `
      ${state.isChatsSelectionMode ? `
        <div class="custom-checkbox">
          <i data-feather="check"></i>
        </div>
      ` : ''}
      <div class="chat-item-avatar-wrapper">
        <div class="chat-item-avatar">${avatarInitial}</div>
      </div>
      <div class="chat-item-info">
        <div class="chat-item-header">
          <h4>@${chat.username} ${isPendingOutgoing ? '<span class="pending-tag">Pending</span>' : ''}</h4>
          <span class="chat-item-time">${displayTime}</span>
        </div>
        <div class="chat-item-body">
          <p class="chat-item-lastmsg">${displayMsg}</p>
          ${chat.unreadCount > 0 ? `<span class="chat-item-badge">${chat.unreadCount}</span>` : ''}
        </div>
      </div>
    `;

    bindLongPress(item, 
      () => {
        toggleChatSelection(chat.username);
      },
      () => {
        if (state.isChatsSelectionMode) {
          toggleChatSelection(chat.username);
        } else {
          chat.unreadCount = 0;
          saveStateToLocalStorage();
          openConversation(chat.username);
        }
      }
    );

    container.appendChild(item);
  });

  renderRequestsList();
  feather.replace();
}

/* ═══════════ GROUPS & 3-TAB SIDEBAR CONTROLLERS ═══════════ */
function closeActiveConversation() {
  state.activeChatPartner = null;
  state.activeGroup = null;
  localStorage.removeItem('ichat_active_partner');
  localStorage.removeItem('ichat_active_group');

  const emptyState = document.getElementById('chatEmptyState');
  if (emptyState) emptyState.classList.add('active');

  const chatPane = document.getElementById('chatPane');
  if (chatPane) chatPane.classList.remove('active');

  const chatWin = document.getElementById('chatWindow');
  if (chatWin) chatWin.classList.remove('active');

  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.remove('inactive');
}

function switchSidebarTab(tabName) {
  state.activeSidebarTab = tabName;
  localStorage.setItem('ichat_active_tab', tabName);
  
  const tabHome = document.getElementById('tabNavHome');
  const tabGroups = document.getElementById('tabNavGroups');
  const tabRequests = document.getElementById('tabNavRequests');

  const viewChats = document.getElementById('chatsView');
  const viewGroups = document.getElementById('groupsView');
  const viewRequests = document.getElementById('requestsView');

  [tabHome, tabGroups, tabRequests].forEach(t => t?.classList.remove('active'));
  [viewChats, viewGroups, viewRequests].forEach(v => v?.classList.remove('active'));

  if (tabName === 'home') {
    tabHome?.classList.add('active');
    viewChats?.classList.add('active');
    renderChatList();
  } else if (tabName === 'groups') {
    tabGroups?.classList.add('active');
    viewGroups?.classList.add('active');
    renderGroupsList();
  } else if (tabName === 'requests') {
    tabRequests?.classList.add('active');
    viewRequests?.classList.add('active');
    renderRequestsList();
  }
}

function openCreateGroupModal() {
  const modal = document.getElementById('createGroupModal');
  const checklist = document.getElementById('groupMembersChecklist');
  const countEl = document.getElementById('selectedMembersCount');
  const nameInput = document.getElementById('groupNameInput');
  
  if (nameInput) nameInput.value = '';
  if (countEl) countEl.innerText = '0 selected';
  if (!checklist) return;
  checklist.innerHTML = '';

  // Get connected/accepted contacts
  const connectedContacts = state.chats.filter(c => c && (c.status === 'accepted' || c.status === 'pending_outgoing' || !c.status));

  if (connectedContacts.length === 0) {
    checklist.innerHTML = `
      <div style="padding: 12px; font-size: 12px; color: var(--text-muted); text-align: center;">
        No connected contacts available. Start a 1-on-1 chat first!
      </div>
    `;
  } else {
    connectedContacts.forEach(c => {
      const item = document.createElement('label');
      item.className = 'group-checklist-item';
      
      const avatarInitial = (c.username || 'C').substring(0, 2).toUpperCase();

      item.innerHTML = `
        <input type="checkbox" value="${c.username}">
        <div class="group-checklist-avatar">${avatarInitial}</div>
        <div class="group-checklist-info">@${c.username}</div>
      `;

      item.querySelector('input').addEventListener('change', () => {
        const selected = checklist.querySelectorAll('input[type="checkbox"]:checked');
        if (countEl) countEl.innerText = `${selected.length} selected`;
      });

      checklist.appendChild(item);
    });
  }

  modal?.classList.add('active');
}

function closeCreateGroupModal() {
  document.getElementById('createGroupModal')?.classList.remove('active');
}

async function executeCreateGroup(groupName, selectedMemberUsernames) {
  if (!groupName || groupName.trim() === '') {
    showToast('Please enter a group name', 'error');
    return;
  }
  if (!selectedMemberUsernames || selectedMemberUsernames.length === 0) {
    showToast('Please select at least one contact to join the group', 'error');
    return;
  }

  const groupId = 'group-' + Math.random().toString(36).substring(2, 15);
  const allMembers = Array.from(new Set([state.user.username, ...selectedMemberUsernames]));

  const newGroup = {
    id: groupId,
    name: groupName.trim(),
    members: allMembers,
    createdBy: state.user.username,
    createdAt: new Date().toISOString(),
    unreadCount: 0
  };

  state.groups.push(newGroup);
  saveStateToLocalStorage();
  closeCreateGroupModal();
  switchSidebarTab('groups');
  renderGroupsList();

  // Send group creation notification to member devices
  const groupInitPacket = {
    type: 'group_created',
    group: newGroup
  };

  for (const member of selectedMemberUsernames) {
    try {
      if (state.socket && state.socket.readyState === WebSocket.OPEN) {
        state.socket.send(JSON.stringify({
          ...groupInitPacket,
          recipient: member
        }));
      } else {
        await apiCall('/api/messages', 'POST', {
          recipient: member,
          packet: groupInitPacket
        });
      }
    } catch (e) {
      console.warn(`[GROUP] Failed to notify ${member} of group creation:`, e);
    }
  }

  openGroupConversation(groupId);
  showToast(`Group "${newGroup.name}" created!`, 'success');
}

/* ═══════════ GROUPS SELECTION & ACTION BAR CONTROLLERS ═══════════ */
function toggleGroupSelection(groupId) {
  state.isGroupsSelectionMode = true;
  if (state.selectedGroups.has(groupId)) {
    state.selectedGroups.delete(groupId);
  } else {
    state.selectedGroups.add(groupId);
  }
  updateGroupsSelectionBar();
  renderGroupsList();
}

function updateGroupsSelectionBar() {
  const bar = document.getElementById('groupsSelectionBar');
  const countEl = document.getElementById('groupsSelectedCount');
  const btnSelectAll = document.getElementById('btnSelectAllGroups');

  if (state.selectedGroups.size === 0) {
    state.isGroupsSelectionMode = false;
    if (bar) bar.style.display = 'none';
  } else {
    state.isGroupsSelectionMode = true;
    if (bar) bar.style.display = 'flex';
    if (countEl) countEl.innerText = `${state.selectedGroups.size} Selected`;
    const isAllSelected = state.groups.length > 0 && state.selectedGroups.size === state.groups.length;
    if (btnSelectAll) btnSelectAll.innerText = isAllSelected ? 'Deselect All' : 'Select All';
  }
}

function exitGroupsSelection() {
  state.isGroupsSelectionMode = false;
  state.selectedGroups.clear();
  const bar = document.getElementById('groupsSelectionBar');
  if (bar) bar.style.display = 'none';
  renderGroupsList();
}

function toggleSelectAllGroups() {
  if (state.selectedGroups.size === state.groups.length) {
    state.selectedGroups.clear();
    exitGroupsSelection();
  } else {
    state.isGroupsSelectionMode = true;
    state.groups.forEach(g => state.selectedGroups.add(g.id));
    updateGroupsSelectionBar();
    renderGroupsList();
  }
}

function exitSelectedGroups() {
  if (state.selectedGroups.size === 0) return;
  const count = state.selectedGroups.size;

  showConfirmModal({
    title: `Exit ${count} Group${count > 1 ? 's' : ''}?`,
    message: `Are you sure you want to leave ${count} selected group${count > 1 ? 's' : ''}? You will no longer receive messages from ${count > 1 ? 'these groups' : 'this group'}.`,
    icon: 'log-out',
    confirmText: `Exit ${count} Group${count > 1 ? 's' : ''}`,
    cancelText: 'Cancel',
    isDanger: true,
    onConfirm: async () => {
      const selectedGroupIds = Array.from(state.selectedGroups);
      
      for (const gid of selectedGroupIds) {
        await executeExitGroup(gid, false);
      }

      exitGroupsSelection();
      showToast(`Exited ${count} group${count > 1 ? 's' : ''}`, 'info');
    }
  });
}

function deleteSelectedGroups() {
  if (state.selectedGroups.size === 0) return;
  const count = state.selectedGroups.size;

  showConfirmModal({
    title: `Delete ${count} Group${count > 1 ? 's' : ''}?`,
    message: `Are you sure you want to delete ${count} selected group${count > 1 ? 's' : ''} and all local chat history?`,
    icon: 'trash-2',
    confirmText: `Delete ${count} Group${count > 1 ? 's' : ''}`,
    cancelText: 'Cancel',
    isDanger: true,
    onConfirm: () => {
      const selectedGroupIds = Array.from(state.selectedGroups);
      state.groups = state.groups.filter(g => !selectedGroupIds.includes(g.id));
      state.messages = state.messages.filter(m => !selectedGroupIds.includes(m.chatPartner));

      if (state.activeGroup && selectedGroupIds.includes(state.activeGroup.id)) {
        closeActiveConversation();
      }

      saveStateToLocalStorage();
      switchSidebarTab('groups');
      exitGroupsSelection();
      showToast(`${count} group${count > 1 ? 's' : ''} deleted`, 'info');
    }
  });
}

/* ═══════════ GROUP DETAILS & MEMBER ADDITION CONTROLLERS ═══════════ */
function openGroupDetailsModal(groupId) {
  const group = state.groups.find(g => g.id === groupId);
  if (!group) return;

  const modal = document.getElementById('groupDetailsModal');
  const avatar = document.getElementById('groupDetailsAvatar');
  const title = document.getElementById('groupDetailsTitle');
  const sub = document.getElementById('groupDetailsSubtitle');
  const count = document.getElementById('groupDetailsMembersCount');
  const list = document.getElementById('groupDetailsMembersList');
  const checklist = document.getElementById('addMembersChecklist');
  const selectedCount = document.getElementById('addMembersSelectedCount');
  const addBtn = document.getElementById('btnExecuteAddMembers');

  if (avatar) avatar.innerText = (group.name || 'G').substring(0, 2).toUpperCase();
  if (title) title.innerText = group.name;
  if (sub) sub.innerText = `Created by @${group.createdBy || 'unknown'}`;
  if (count) count.innerText = `${group.members.length} members`;

  // Render current active members
  if (list) {
    list.innerHTML = '';
    group.members.forEach(username => {
      const memberItem = document.createElement('div');
      memberItem.className = 'group-member-item';
      
      const isCreator = username === group.createdBy;
      const isYou = username === state.user?.username;
      const initial = (username || 'U').substring(0, 2).toUpperCase();

      memberItem.innerHTML = `
        <div class="group-member-left">
          <div class="group-member-avatar">${initial}</div>
          <span class="group-member-username">@${username}</span>
        </div>
        <div style="display: flex; gap: 4px; align-items: center;">
          ${isCreator ? '<span class="member-badge-creator">Creator</span>' : ''}
          ${isYou ? '<span class="member-badge-you">You</span>' : ''}
        </div>
      `;
      list.appendChild(memberItem);
    });
  }

  // Render contacts NOT in this group for adding
  if (checklist) {
    checklist.innerHTML = '';
    if (selectedCount) selectedCount.innerText = '0 selected';
    if (addBtn) addBtn.disabled = true;

    const connectedContacts = state.chats.filter(c => c && (c.status === 'accepted' || c.status === 'pending_outgoing' || !c.status));
    const nonMembers = connectedContacts.filter(c => !group.members.includes(c.username));

    if (nonMembers.length === 0) {
      checklist.innerHTML = `
        <div style="padding: 10px; font-size: 12px; color: var(--text-muted); text-align: center;">
          All your contacts are already in this group.
        </div>
      `;
    } else {
      nonMembers.forEach(c => {
        const item = document.createElement('label');
        item.className = 'group-checklist-item';
        const initial = (c.username || 'C').substring(0, 2).toUpperCase();

        item.innerHTML = `
          <input type="checkbox" value="${c.username}">
          <div class="group-checklist-avatar">${initial}</div>
          <div class="group-checklist-info">@${c.username}</div>
        `;

        item.querySelector('input').addEventListener('change', () => {
          const selected = checklist.querySelectorAll('input[type="checkbox"]:checked');
          if (selectedCount) selectedCount.innerText = `${selected.length} selected`;
          if (addBtn) addBtn.disabled = selected.length === 0;
        });

        checklist.appendChild(item);
      });
    }
  }

  // Bind direct Exit / Delete modal buttons
  const exitBtn = document.getElementById('btnExitGroupModal');
  const deleteBtn = document.getElementById('btnDeleteGroupModal');

  if (exitBtn) {
    exitBtn.onclick = () => {
      closeGroupDetailsModal();
      executeExitGroup(groupId, true);
    };
  }

  if (deleteBtn) {
    deleteBtn.onclick = () => {
      closeGroupDetailsModal();
      executeDeleteGroup(groupId);
    };
  }

  if (addBtn) {
    addBtn.onclick = () => {
      const selectedBoxes = checklist ? checklist.querySelectorAll('input[type="checkbox"]:checked') : [];
      const newMembers = Array.from(selectedBoxes).map(cb => cb.value);
      if (newMembers.length > 0) {
        executeAddMembersToGroup(groupId, newMembers);
      }
    };
  }

  modal?.classList.add('active');
  feather.replace();
}

function closeGroupDetailsModal() {
  document.getElementById('groupDetailsModal')?.classList.remove('active');
}

async function executeAddMembersToGroup(groupId, newMemberUsernames) {
  const group = state.groups.find(g => g.id === groupId);
  if (!group) return;

  const updatedMembers = Array.from(new Set([...group.members, ...newMemberUsernames]));
  group.members = updatedMembers;
  saveStateToLocalStorage();

  // Send group_updated packet to all members (existing + new)
  const updatePacket = {
    type: 'group_updated',
    group: group
  };

  const allOtherMembers = updatedMembers.filter(m => m !== state.user?.username);
  for (const member of allOtherMembers) {
    try {
      if (state.socket && state.socket.readyState === WebSocket.OPEN) {
        state.socket.send(JSON.stringify({ ...updatePacket, recipient: member }));
      } else {
        await apiCall('/api/messages', 'POST', { recipient: member, packet: updatePacket });
      }
    } catch (e) {
      console.warn(`[GROUP UPDATE] Failed notify to ${member}:`, e);
    }
  }

  // Refresh group details modal & status bar
  openGroupDetailsModal(groupId);
  if (state.activeGroup && state.activeGroup.id === groupId) {
    const statusText = document.getElementById('chatTitleStatusText');
    if (statusText) statusText.innerText = `Group • ${group.members.length} Members`;
  }

  renderGroupsList();
  showToast(`Added ${newMemberUsernames.length} member(s) to "${group.name}"`, 'success');
}

async function executeExitGroup(groupId, showConfirm = true) {
  const group = state.groups.find(g => g.id === groupId);
  if (!group) return;

  const performExit = async () => {
    group.members = group.members.filter(m => m !== state.user?.username);
    
    // Broadcast update to remaining members
    const updatePacket = {
      type: 'group_updated',
      group: group
    };

    for (const member of group.members) {
      try {
        if (state.socket && state.socket.readyState === WebSocket.OPEN) {
          state.socket.send(JSON.stringify({ ...updatePacket, recipient: member }));
        } else {
          await apiCall('/api/messages', 'POST', { recipient: member, packet: updatePacket });
        }
      } catch (e) {}
    }

    // Remove group locally
    state.groups = state.groups.filter(g => g.id !== groupId);

    if (!state.activeGroup || state.activeGroup.id === groupId) {
      closeActiveConversation();
    }

    saveStateToLocalStorage();
    switchSidebarTab('groups');
    renderGroupsList();
    if (showConfirm) showToast(`You left "${group.name}"`, 'info');
  };

  if (showConfirm) {
    showConfirmModal({
      title: `Exit Group "${group.name}"?`,
      message: `Are you sure you want to exit this group? You will no longer receive new messages from members in this group.`,
      icon: 'log-out',
      confirmText: 'Exit Group',
      cancelText: 'Cancel',
      isDanger: true,
      onConfirm: performExit
    });
  } else {
    await performExit();
  }
}

function executeDeleteGroup(groupId) {
  const group = state.groups.find(g => g.id === groupId);
  if (!group) return;

  showConfirmModal({
    title: `Delete Group "${group.name}"?`,
    message: `Are you sure you want to delete this group and all its local chat history? This action cannot be undone.`,
    icon: 'trash-2',
    confirmText: 'Delete Group',
    cancelText: 'Cancel',
    isDanger: true,
    onConfirm: () => {
      state.groups = state.groups.filter(g => g.id !== groupId);
      state.messages = state.messages.filter(m => m.chatPartner !== groupId);

      if (!state.activeGroup || state.activeGroup.id === groupId) {
        closeActiveConversation();
      }

      saveStateToLocalStorage();
      switchSidebarTab('groups');
      renderGroupsList();
      showToast(`Group "${group.name}" deleted`, 'info');
    }
  });
}

function renderGroupsList() {
  const container = document.getElementById('groupsContainer');
  const countBadge = document.getElementById('groupsCountBadge');
  const navBadge = document.getElementById('groupsNavBadge');
  const searchVal = (document.getElementById('groupSearchInput')?.value || '').toLowerCase().trim();

  if (!container) return;
  container.innerHTML = '';

  const filteredGroups = state.groups.filter(g => g && g.name && g.name.toLowerCase().includes(searchVal));

  if (countBadge) countBadge.innerText = state.groups.length;

  const totalUnread = state.groups.reduce((acc, g) => acc + (g.unreadCount || 0), 0);
  if (navBadge) {
    if (totalUnread > 0) {
      navBadge.innerText = totalUnread > 99 ? '99+' : totalUnread;
      navBadge.style.display = 'inline-flex';
    } else {
      navBadge.style.display = 'none';
    }
  }

  if (filteredGroups.length === 0) {
    container.innerHTML = `
      <div class="chat-list-empty">
        <i data-feather="users" class="empty-icon"></i>
        <p>${searchVal ? 'No matching group chats' : 'No group chats yet.'}</p>
        <span>${searchVal ? 'Try a different search term' : 'Click "+ New Group" above to start one!'}</span>
      </div>
    `;
    feather.replace();
    return;
  }

  filteredGroups.forEach(group => {
    const lastMsg = state.messages.filter(m => m.chatPartner === group.id).slice(-1)[0];
    const displayMsg = lastMsg 
      ? `${lastMsg.sender === state.user?.username ? 'You' : '@' + lastMsg.sender}: ${lastMsg.media ? '📷 File' : lastMsg.body}`
      : 'No messages yet';
    const displayTime = lastMsg 
      ? new Date(lastMsg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
      : '';

    const avatarInitial = (group.name || 'G').substring(0, 2).toUpperCase();
    const isSelected = state.selectedGroups.has(group.id);

    const item = document.createElement('div');
    item.className = `group-item ${state.activeGroup && state.activeGroup.id === group.id ? 'active' : ''} ${isSelected ? 'selected' : ''}`;

    item.innerHTML = `
      ${state.isGroupsSelectionMode ? `
        <div class="custom-checkbox">
          <i data-feather="check"></i>
        </div>
      ` : ''}
      <div class="group-item-avatar">${avatarInitial}</div>
      <div class="group-item-info">
        <div class="group-item-header">
          <h4>${group.name}</h4>
          <span class="chat-item-time">${displayTime}</span>
        </div>
        <div class="group-item-body" style="display: flex; justify-content: space-between; align-items: center;">
          <p class="group-item-members">${displayMsg}</p>
          ${group.unreadCount > 0 ? `<span class="chat-item-badge">${group.unreadCount}</span>` : ''}
        </div>
      </div>
    `;

    bindLongPress(item, 
      () => {
        toggleGroupSelection(group.id);
      },
      () => {
        if (state.isGroupsSelectionMode) {
          toggleGroupSelection(group.id);
        } else {
          group.unreadCount = 0;
          saveStateToLocalStorage();
          openGroupConversation(group.id);
        }
      }
    );

    container.appendChild(item);
  });

  feather.replace();
}

function openGroupConversation(groupId) {
  const group = state.groups.find(g => g.id === groupId);
  if (!group) return;

  state.activeGroup = group;
  state.activeChatPartner = null;
  localStorage.setItem('ichat_active_group', groupId);
  localStorage.removeItem('ichat_active_partner');

  history.pushState({ view: 'group', groupId }, '');

  const emptyState = document.getElementById('chatEmptyState');
  if (emptyState) emptyState.classList.remove('active');

  const chatPane = document.getElementById('chatPane');
  if (chatPane) chatPane.classList.add('active');

  const chatWin = document.getElementById('chatWindow');
  if (chatWin) chatWin.classList.add('active');

  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.add('inactive');

  const titleUser = document.getElementById('chatTitleUsername');
  if (titleUser) titleUser.innerText = group.name;

  const titleAvatar = document.getElementById('chatTitleAvatar');
  if (titleAvatar) titleAvatar.innerText = group.name.substring(0, 2).toUpperCase();

  const typingText = document.getElementById('chatTitleTypingText');
  if (typingText) typingText.style.display = 'none';

  const statusText = document.getElementById('chatTitleStatusText');
  if (statusText) {
    statusText.className = 'status-online';
    statusText.innerText = `Group • ${group.members.length} Members`;
    statusText.style.display = 'inline';
  }

  group.unreadCount = 0;
  saveStateToLocalStorage();

  renderActiveChat();
  renderGroupsList();
}

// Conversation views renderer (1-on-1)
function openConversation(username) {
  state.activeChatPartner = username;
  state.activeGroup = null;
  localStorage.setItem('ichat_active_partner', username);
  localStorage.removeItem('ichat_active_group');

  // Push history state to enable back gesture / browser back button navigation
  history.pushState({ view: 'chat', partner: username }, '');

  const emptyState = document.getElementById('chatEmptyState');
  if (emptyState) emptyState.classList.remove('active');
  
  const chatPane = document.getElementById('chatPane');
  if (chatPane) chatPane.classList.add('active');
  
  // Responsive sidebar toggles
  const chatWin = document.getElementById('chatWindow');
  if (chatWin) chatWin.classList.add('active');

  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.add('inactive');

  const titleUser = document.getElementById('chatTitleUsername');
  if (titleUser) titleUser.innerText = `@${username}`;

  const titleAvatar = document.getElementById('chatTitleAvatar');
  if (titleAvatar) titleAvatar.innerText = username.substring(0, 2).toUpperCase();

  // Reset typing layout state
  const typingText = document.getElementById('chatTitleTypingText');
  if (typingText) typingText.style.display = 'none';

  const statusText = document.getElementById('chatTitleStatusText');
  if (statusText) statusText.style.display = 'inline';

  updateContactStatusesUI();
  
  // Set all messages from this partner to read, send read receipts
  state.messages.forEach(m => {
    if (m.chatPartner === username && m.sender !== state.user.username && m.status !== 'read') {
      m.status = 'read';
      sendReadAcknowledgement(m.id, username);
    }
  });
  saveStateToLocalStorage();

  renderActiveChat();
  renderChatList();
}

async function renderActiveChat() {
  const historyContainer = document.getElementById('messageHistory');
  const scrollAtBottom = historyContainer.scrollHeight - historyContainer.scrollTop <= historyContainer.clientHeight + 100;
  
  historyContainer.innerHTML = '';

  const activeTargetId = state.activeGroup ? state.activeGroup.id : state.activeChatPartner;
  const activeMessages = state.messages.filter(m => m.chatPartner === activeTargetId);

  if (activeMessages.length === 0) {
    historyContainer.innerHTML = `
      <div style="flex: 1; display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-size: 13px;">
        <p><i data-feather="lock" style="width: 12px; height: 12px; vertical-align: middle;"></i> ${state.activeGroup ? 'Group messages are end-to-end encrypted across all members.' : 'Messages are fully encrypted end-to-end.'}</p>
      </div>
    `;
    feather.replace();
    return;
  }

  for (const msg of activeMessages) {
    const isOutgoing = msg.sender === state.user.username;
    
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${isOutgoing ? 'outgoing' : 'incoming'}`;

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    // Render Group Sender Tag for incoming group messages
    if (state.activeGroup && !isOutgoing) {
      const senderTag = document.createElement('span');
      senderTag.className = 'group-sender-tag';
      senderTag.innerText = `@${msg.sender}`;
      bubble.appendChild(senderTag);
    }

    // Renders attachments
    if (msg.media) {
      const mediaDiv = document.createElement('div');
      mediaDiv.className = 'message-media';

      if (msg.media.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><text y="50" x="50" text-anchor="middle" font-size="12" fill="grey">Decrypting...</text></svg>';
        img.alt = msg.media.filename;
        mediaDiv.appendChild(img);

        // Fetch decrypt asynchronous callback
        getDecryptedMediaUrl(msg).then(decryptedUrl => {
          if (decryptedUrl) {
            img.src = decryptedUrl;
          } else {
            img.src = '';
            mediaDiv.innerText = '[Media Decryption Failed]';
          }
        });
      } else {
        // Render general document files card
        const linkCard = document.createElement('a');
        linkCard.className = 'message-file-card';
        linkCard.href = '#';
        linkCard.innerHTML = `
          <div class="file-icon-wrapper"><i data-feather="file"></i></div>
          <div class="file-info">
            <h5>${msg.media.filename}</h5>
            <p>${(msg.media.size / 1024).toFixed(1)} KB</p>
          </div>
        `;
        mediaDiv.appendChild(linkCard);
        
        linkCard.addEventListener('click', async (e) => {
          e.preventDefault();
          const decUrl = await getDecryptedMediaUrl(msg);
          if (decUrl) {
            const tempLink = document.createElement('a');
            tempLink.href = decUrl;
            tempLink.download = msg.media.filename;
            tempLink.click();
          } else {
            alert('File decryption key mismatched.');
          }
        });
      }
      bubble.appendChild(mediaDiv);
    }

    // Renders Message content text
    if (msg.body) {
      const textNode = document.createElement('span');
      textNode.innerText = msg.body;
      bubble.appendChild(textNode);
    }

    // Meta section (Ticks & Timing)
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    
    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.innerHTML = `<span class="e2ee-tag"><i data-feather="lock" style="width: 8px; height: 8px;"></i> E2EE</span> <span>${time}</span>`;

    // Outbox ticks (only outgoing messages get checks)
    if (isOutgoing) {
      const tick = document.createElement('span');
      tick.className = `tick-wrapper ${msg.status}`;
      
      if (msg.status === 'pending') {
        tick.innerHTML = '<i data-feather="clock"></i>'; // clock
      } else if (msg.status === 'sent') {
        tick.innerHTML = '<i data-feather="check"></i>'; // single check
      } else if (msg.status === 'delivered') {
        tick.innerHTML = '<i data-feather="check"></i><i data-feather="check" style="margin-left:-8px;"></i>'; // double check
      } else if (msg.status === 'read') {
        tick.innerHTML = '<i data-feather="check"></i><i data-feather="check" style="margin-left:-8px;"></i>'; // blue double check
      }
      meta.appendChild(tick);
    }

    bubble.appendChild(meta);
    wrapper.appendChild(bubble);
    history.appendChild(wrapper);
  }

  // Adjust scroll positions
  if (scrollAtBottom) {
    history.scrollTop = history.scrollHeight;
  }

  // Update Request Action Banner and Input Bar Lock States
  const currentChat = state.chats.find(c => c && c.username === state.activeChatPartner);
  const banner = document.getElementById('requestActionBanner');
  const noticeBar = document.getElementById('requestNoticeBar');
  const inputBar = document.getElementById('chatInputBar');
  const textInput = document.getElementById('messageTextInput');
  const sendBtn = document.getElementById('btnSendMessage');
  const attachBtn = document.getElementById('btnAttachFile');

  if (currentChat && currentChat.status === 'pending_incoming') {
    if (banner) {
      banner.style.display = 'flex';
      const bannerTitle = document.getElementById('requestBannerTitle');
      const bannerSub = document.getElementById('requestBannerSubtitle');
      if (bannerTitle) bannerTitle.innerText = `Message Request`;
      if (bannerSub) bannerSub.innerText = `Allow @${currentChat.username} to message you?`;
    }
    if (noticeBar) noticeBar.style.display = 'none';
    if (inputBar) inputBar.classList.add('disabled');
    if (textInput) {
      textInput.disabled = true;
      textInput.placeholder = `Accept request to reply...`;
    }
    if (sendBtn) sendBtn.disabled = true;
    if (attachBtn) attachBtn.disabled = true;
  } else if (currentChat && currentChat.status === 'pending_outgoing') {
    const countSent = state.messages.filter(m => m.chatPartner === state.activeChatPartner && m.sender === state.user.username).length;
    if (countSent >= 1) {
      if (banner) banner.style.display = 'none';
      if (noticeBar) {
        noticeBar.style.display = 'flex';
        const noticeText = document.getElementById('requestNoticeText');
        if (noticeText) noticeText.innerText = `Waiting for @${currentChat.username} to accept your request.`;
      }
      if (inputBar) inputBar.classList.add('disabled');
      if (textInput) {
        textInput.disabled = true;
        textInput.placeholder = `Waiting for acceptance...`;
      }
      if (sendBtn) sendBtn.disabled = true;
      if (attachBtn) attachBtn.disabled = true;
    } else {
      if (banner) banner.style.display = 'none';
      if (noticeBar) noticeBar.style.display = 'none';
      if (inputBar) inputBar.classList.remove('disabled');
      if (textInput) {
        textInput.disabled = false;
        textInput.placeholder = 'Type a message...';
      }
      if (sendBtn) sendBtn.disabled = false;
      if (attachBtn) attachBtn.disabled = false;
    }
  } else {
    if (banner) banner.style.display = 'none';
    if (noticeBar) noticeBar.style.display = 'none';
    if (inputBar) inputBar.classList.remove('disabled');
    if (textInput) {
      textInput.disabled = false;
      textInput.placeholder = 'Type a message...';
    }
    if (sendBtn) sendBtn.disabled = false;
    if (attachBtn) attachBtn.disabled = false;
  }
  
  feather.replace();
}

// Settings dashboard updates
async function updateStorageStatsUI() {
  // Calculates size text vs media
  const rawTextSize = new Blob([JSON.stringify(state.messages)]).size;
  const rawMediaSize = await getMediaStorageSize();

  const formattedText = (rawTextSize / 1024).toFixed(1) + ' KB';
  const formattedMedia = (rawMediaSize / (1024 * 1024)).toFixed(2) + ' MB';

  document.getElementById('storageSizeText').innerText = formattedText;
  document.getElementById('storageSizeMedia').innerText = formattedMedia;

  // Render Bar Charts
  const total = rawTextSize + rawMediaSize;
  if (total > 0) {
    const textPercent = Math.max(5, (rawTextSize / total) * 100);
    const mediaPercent = Math.max(5, (rawMediaSize / total) * 100);
    document.getElementById('storageBarText').style.width = `${textPercent}%`;
    document.getElementById('storageBarMedia').style.width = `${mediaPercent}%`;
  } else {
    document.getElementById('storageBarText').style.width = '0%';
    document.getElementById('storageBarMedia').style.width = '0%';
  }

  // Calculate storage per chat (text + media)
  const chatStats = [];
  for (const chat of state.chats) {
    const chatMsgs = state.messages.filter(m => m.chatPartner === chat.username);
    
    // Calculate text size
    const chatTextSize = new Blob([JSON.stringify(chatMsgs)]).size;
    
    // Calculate media size
    let chatMediaSize = 0;
    const mediaFiles = [];
    
    for (const m of chatMsgs) {
      if (m.media) {
        chatMediaSize += m.media.size || 0;
        mediaFiles.push(m);
      }
    }
    
    chatStats.push({
      username: chat.username,
      textSize: chatTextSize,
      mediaSize: chatMediaSize,
      totalSize: chatTextSize + chatMediaSize,
      mediaFiles
    });
  }

  // Sort largest total size first
  chatStats.sort((a, b) => b.totalSize - a.totalSize);

  // Render per-chat list
  const chatsListEl = document.getElementById('storageChatsList');
  chatsListEl.innerHTML = '';

  if (chatStats.length === 0) {
    chatsListEl.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 10px;">No chats to display.</div>';
    return;
  }

  chatStats.forEach(stat => {
    const item = document.createElement('div');
    item.className = 'storage-chat-item';
    
    const formattedChatSize = stat.totalSize > 1024 * 1024 
      ? (stat.totalSize / (1024 * 1024)).toFixed(2) + ' MB'
      : (stat.totalSize / 1024).toFixed(1) + ' KB';

    item.innerHTML = `
      <div class="storage-chat-header">
        <div class="storage-chat-user">
          <h5>@${stat.username}</h5>
          <span style="font-size: 11px; color: var(--text-muted); margin-left: 6px;">Size: <strong>${formattedChatSize}</strong> (${stat.mediaFiles.length} files)</span>
        </div>
        <div class="storage-chat-actions">
          <button type="button" class="btn btn-outline btn-sm btn-files-toggle" style="padding: 4px 8px; font-size: 11px;">
            <i data-feather="folder" style="width: 12px; height: 12px; margin-right: 2px;"></i> View Files
          </button>
          <button type="button" class="btn btn-outline btn-danger btn-sm btn-clear-chat" style="padding: 4px 8px; font-size: 11px;">
            <i data-feather="trash-2" style="width: 12px; height: 12px; margin-right: 2px;"></i> Clear
          </button>
        </div>
      </div>
      <div class="storage-media-list">
        <!-- Media items -->
      </div>
    `;

    const mediaListEl = item.querySelector('.storage-media-list');
    const toggleBtn = item.querySelector('.btn-files-toggle');
    const clearBtn = item.querySelector('.btn-clear-chat');

    // Populates files inside expanded section
    if (stat.mediaFiles.length === 0) {
      mediaListEl.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); padding: 4px 0; text-align: center;">No shared files in this chat.</div>';
    } else {
      stat.mediaFiles.forEach(msg => {
        const fileItem = document.createElement('div');
        fileItem.className = 'storage-media-item';
        
        const fileSizeStr = (msg.media.size / 1024).toFixed(1) + ' KB';
        fileItem.innerHTML = `
          <div class="storage-media-item-info">
            <i data-feather="file" style="width: 12px; height: 12px; stroke: var(--text-secondary);"></i>
            <span class="storage-media-item-name" style="max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${msg.media.filename}">${msg.media.filename}</span>
            <span class="storage-media-item-size">(${fileSizeStr})</span>
          </div>
          <button type="button" class="btn-delete-file" title="Delete File">
            <i data-feather="trash" style="width: 12px; height: 12px;"></i>
          </button>
        `;

        const deleteFileBtn = fileItem.querySelector('.btn-delete-file');
        deleteFileBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          showConfirmModal({
            title: 'Delete File?',
            message: `Delete the file "${msg.media.filename}" from this chat? This releases local storage.`,
            icon: 'trash-2',
            confirmText: 'Delete File',
            cancelText: 'Cancel',
            isDanger: true,
            onConfirm: async () => {
              // 1. Delete from IndexedDB
              if (mediaDb) {
                const transaction = mediaDb.transaction(['media'], 'readwrite');
                const store = transaction.objectStore('media');
                store.delete(msg.media.url);
              }
              // 2. Clear local memory cache
              state.localMediaCache.delete(msg.media.url);
              
              // 3. Update message object
              msg.body = `[File deleted: ${msg.media.filename}]`;
              msg.media = null;
              
              saveStateToLocalStorage();
              await updateStorageStatsUI();
              renderActiveChat();
              showToast('File deleted from storage', 'info');
            }
          });
        });

        mediaListEl.appendChild(fileItem);
      });
    }

    // Clear specific chat
    clearBtn.addEventListener('click', () => {
      showConfirmModal({
        title: `Clear Chat with @${stat.username}?`,
        message: `Delete all messages and media files for the conversation with @${stat.username}?`,
        icon: 'trash-2',
        confirmText: 'Clear Chat',
        cancelText: 'Cancel',
        isDanger: true,
        onConfirm: async () => {
          // Delete media files from IndexedDB
          stat.mediaFiles.forEach(m => {
            if (mediaDb) {
              const transaction = mediaDb.transaction(['media'], 'readwrite');
              const store = transaction.objectStore('media');
              store.delete(m.media.url);
            }
            state.localMediaCache.delete(m.media.url);
          });

          // Filter messages out
          state.messages = state.messages.filter(m => m.chatPartner !== stat.username);
          saveStateToLocalStorage();
          
          await updateStorageStatsUI();
          if (state.activeChatPartner === stat.username) {
            state.activeChatPartner = null;
            document.getElementById('chatPane').classList.remove('active');
            document.getElementById('chatEmptyState').classList.add('active');
          }
          renderChatList();
          renderActiveChat();
          showToast(`Chat with @${stat.username} cleared`, 'info');
        }
      });
    });

    chatsListEl.appendChild(item);
  });

  feather.replace();
}

// WebRTC call panel UI triggers
function openCallUI(partner, status, direction) {
  document.getElementById('callTargetUsername').innerText = `@${partner}`;
  document.getElementById('callAvatar').innerText = partner.substring(0, 2).toUpperCase();
  document.getElementById('callStatusText').innerText = status === 'ringing' 
    ? (direction === 'incoming' ? 'Incoming secure call...' : 'Ringing...') 
    : 'Connecting...';
  
  const overlay = document.getElementById('callOverlay');
  overlay.className = `call-overlay-container active ${direction} ${status === 'connected' ? 'active-call' : ''}`;
}

// App Initialization
function initDashboard() {
  const username = state.user?.username || 'user';
  const email = state.user?.email || '';

  const userDisp = document.getElementById('myUsernameDisplay');
  if (userDisp) userDisp.innerText = `@${username}`;

  const emailDisp = document.getElementById('myEmailDisplay');
  if (emailDisp) emailDisp.innerText = email;

  const avatarDisp = document.getElementById('myAvatar');
  if (avatarDisp) avatarDisp.innerText = username.substring(0, 2).toUpperCase();
  
  const lastBackup = localStorage.getItem('ichat_backup_status');
  const backupText = document.getElementById('backupStatusText');
  if (backupText) backupText.innerText = lastBackup ? `Last Backup: ${lastBackup}` : 'Last Backup: Never';

  // Apply Theme
  applyTheme(state.theme);
  const themeSelect = document.getElementById('themeSelect');
  if (themeSelect) themeSelect.value = state.theme;

  renderChatList();
  renderGroupsList();
  
  // Restore active open conversation if preserved
  const savedPartner = localStorage.getItem('ichat_active_partner');
  const savedGroup = localStorage.getItem('ichat_active_group');

  if (savedGroup && state.groups.some(g => g.id === savedGroup)) {
    switchSidebarTab('groups');
    openGroupConversation(savedGroup);
  } else if (savedPartner && state.chats.some(c => c.username === savedPartner)) {
    switchSidebarTab('home');
    openConversation(savedPartner);
  }

  connectWebSocket();
  pollTransientQueue();
  if (!state.pollInterval) {
    state.pollInterval = setInterval(pollTransientQueue, 3000);
  }
}


/* ═══════════ DOM BINDINGS & EVENT LISTENERS ═══════════ */
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize Database Caches
  await initIndexedDB();
  
  // Load State
  loadStateFromLocalStorage();

  const authScreen = document.getElementById('authScreen');
  const usernameScreen = document.getElementById('usernameScreen');
  const chatDashboard = document.getElementById('chatDashboard');

  // Reset active classes across screens
  [authScreen, usernameScreen, chatDashboard].forEach(s => s?.classList.remove('active'));

  if (state.token && state.user) {
    if (!state.user.username) {
      usernameScreen?.classList.add('active');
    } else {
      chatDashboard?.classList.add('active');
      initDashboard();
    }
  } else {
    authScreen?.classList.add('active');
  }

  // Initialize Database button listener
  const btnInitDb = document.getElementById('btnInitDb');
  if (btnInitDb) {
    btnInitDb.addEventListener('click', async () => {
      const originalHtml = btnInitDb.innerHTML;
      btnInitDb.disabled = true;
      btnInitDb.innerHTML = '<span>Initializing DB...</span><i data-feather="loader" class="animate-pulse"></i>';
      feather.replace();

      try {
        const data = await apiCall('/api/setup', 'POST');
        alert(data.message || 'Database initialized successfully!');
        btnInitDb.innerHTML = '<span>DB Initialized</span><i data-feather="check"></i>';
      } catch (err) {
        alert('Database setup failed: ' + err.message);
        btnInitDb.innerHTML = originalHtml;
      } finally {
        btnInitDb.disabled = false;
        feather.replace();
      }
    });
  }

  // 1. Submit email login OTP
  document.getElementById('requestOtpForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('emailInput').value;
    requestOtp(email);
  });

  // Back button in OTP panel
  document.getElementById('btnBackToEmail').addEventListener('click', () => {
    document.getElementById('verifyOtpForm').classList.remove('active');
    document.getElementById('requestOtpForm').classList.add('active');
  });

  // 2. Verify OTP code
  document.getElementById('verifyOtpForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('emailInput').value;
    const code = document.getElementById('otpCodeInput').value;
    verifyOtp(email, code);
  });

  // Cancel login replace screen
  document.getElementById('btnCancelReplace').addEventListener('click', () => {
    document.getElementById('deviceConflictResolver').classList.remove('active');
  });

  // 3. Complete username setup
  document.getElementById('usernameForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('usernameInput').value;
    registerUsername(username);
  });

  // 4. Search dropdown contacts handler
  const searchInput = document.getElementById('contactSearchInput');
  const dropdown = document.getElementById('searchDropdownList');

  searchInput.addEventListener('input', async () => {
    const q = searchInput.value.trim();
    if (q.length < 2) {
      dropdown.classList.remove('active');
      return;
    }

    try {
      const data = await apiCall(`/api/users/search?q=${q}`, 'GET');
      dropdown.innerHTML = '';
      
      if (data.users.length === 0) {
        dropdown.innerHTML = '<div style="padding: 12px; font-size:12px; color: var(--text-muted);">No users found</div>';
      } else {
        data.users.forEach(u => {
          const item = document.createElement('div');
          item.className = 'search-result-item';
          item.innerHTML = `<div><h5>@${u.username}</h5><p>${u.email}</p></div><button class="add-btn">Chat</button>`;
          
          item.addEventListener('click', () => {
            dropdown.classList.remove('active');
            searchInput.value = '';
            
            // Add contact to chats list
            if (!state.chats.some(c => c.username === u.username)) {
              state.chats.push({
                username: u.username,
                email: u.email,
                unreadCount: 0
              });
              saveStateToLocalStorage();
            }
            openConversation(u.username);
          });
          dropdown.appendChild(item);
        });
      }
      dropdown.classList.add('active');
    } catch (e) {
      console.error(e);
    }
  });

  // Hide search outcomes when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.sidebar-search')) {
      dropdown.classList.remove('active');
    }
  });

  // 5. Active Chat message entry
  const textInput = document.getElementById('messageTextInput');
  const sendBtn = document.getElementById('btnSendMessage');

  // Auto-resize message input height
  textInput.addEventListener('input', () => {
    textInput.style.height = 'auto';
    textInput.style.height = `${textInput.scrollHeight}px`;

    // Typing statuses notifications with 2s cooldown
    if (state.activeChatPartner) {
      if (!state.isTyping) {
        state.isTyping = true;
        sendTypingIndicator(state.activeChatPartner, true);
      }
      clearTimeout(state.typingTimer);
      state.typingTimer = setTimeout(() => {
        state.isTyping = false;
        sendTypingIndicator(state.activeChatPartner, false);
      }, 2000);
    }
  });

  // Message Send actions
  const triggerSendText = () => {
    const text = textInput.value.trim();
    if (text && state.activeChatPartner) {
      sendE2EEMessage(state.activeChatPartner, text);
      textInput.value = '';
      textInput.style.height = 'auto';
      
      // Clear typing notifications immediately
      clearTimeout(state.typingTimer);
      state.isTyping = false;
      sendTypingIndicator(state.activeChatPartner, false);
    }
  };

  // Message Request Buttons (Accept & Decline)
  const btnAcceptReq = document.getElementById('btnAcceptRequest');
  const btnDeclineReq = document.getElementById('btnDeclineRequest');

  if (btnAcceptReq) {
    btnAcceptReq.addEventListener('click', () => {
      if (state.activeChatPartner) {
        acceptChatRequest(state.activeChatPartner);
      }
    });
  }

  if (btnDeclineReq) {
    btnDeclineReq.addEventListener('click', () => {
      if (state.activeChatPartner) {
        declineChatRequest(state.activeChatPartner);
      }
    });
  }

  sendBtn.addEventListener('click', triggerSendText);
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      triggerSendText();
    }
  });

  // Real-time Typing Status Broadcaster (emits typing-start / typing-stop)
  textInput.addEventListener('input', () => {
    if (!state.activeChatPartner) return;
    const text = textInput.value;

    if (text.length > 0) {
      if (!state.isTyping) {
        state.isTyping = true;
        sendTypingIndicator(state.activeChatPartner, true);
      }
      clearTimeout(state.typingTimer);
      state.typingTimer = setTimeout(() => {
        state.isTyping = false;
        sendTypingIndicator(state.activeChatPartner, false);
      }, 2500);
    } else {
      if (state.isTyping) {
        clearTimeout(state.typingTimer);
        state.isTyping = false;
        sendTypingIndicator(state.activeChatPartner, false);
      }
    }
  });

  // 6. Media Attachment Triggers & Modal
  const attachBtn = document.getElementById('btnAttachFile');
  const attachmentModal = document.getElementById('attachmentPickerModal');
  const btnCloseAttachment = document.getElementById('btnCloseAttachmentModal');

  const galleryInput = document.getElementById('fileInputGallery');
  const documentInput = document.getElementById('fileInputDocument');

  if (attachBtn) {
    attachBtn.addEventListener('click', () => {
      if (attachmentModal) attachmentModal.classList.add('active');
    });
  }

  if (btnCloseAttachment) {
    btnCloseAttachment.addEventListener('click', () => {
      if (attachmentModal) attachmentModal.classList.remove('active');
    });
  }

  document.getElementById('btnPickGalleryMedia')?.addEventListener('click', () => {
    if (attachmentModal) attachmentModal.classList.remove('active');
    if (galleryInput) galleryInput.click();
  });

  document.getElementById('btnPickDocumentFile')?.addEventListener('click', () => {
    if (attachmentModal) attachmentModal.classList.remove('active');
    if (documentInput) documentInput.click();
  });

  const handleFileSelect = async (file, isGallery) => {
    const targetId = state.activeGroup ? state.activeGroup : state.activeChatPartner;
    if (file && targetId) {
      if (attachBtn) attachBtn.innerHTML = '<i data-feather="loader" class="animate-pulse"></i>';
      feather.replace();

      const mediaResult = await encryptAndUploadFile(file, isGallery);
      if (mediaResult) {
        if (state.activeGroup) {
          sendE2EEGroupMessage(state.activeGroup, null, mediaResult);
        } else {
          sendE2EEMessage(state.activeChatPartner, null, mediaResult);
        }
      }

      if (attachBtn) attachBtn.innerHTML = '<i data-feather="paperclip"></i>';
      feather.replace();
    }
  };

  galleryInput?.addEventListener('change', () => {
    if (galleryInput.files && galleryInput.files[0]) {
      handleFileSelect(galleryInput.files[0], true);
      galleryInput.value = '';
    }
  });

  documentInput?.addEventListener('change', () => {
    if (documentInput.files && documentInput.files[0]) {
      handleFileSelect(documentInput.files[0], false);
      documentInput.value = '';
    }
  });

  // 7. Modals: Settings Modal toggle triggers
  const settingsModal = document.getElementById('settingsModal');
  const btnSettings = document.getElementById('btnSettings');
  const btnCloseSettings = document.getElementById('btnCloseSettings');
  const backupScheduleSelect = document.getElementById('backupScheduleSelect');



  if (backupScheduleSelect) {
    backupScheduleSelect.value = localStorage.getItem('ichat_backup_schedule') || 'never';
    backupScheduleSelect.addEventListener('change', (e) => {
      localStorage.setItem('ichat_backup_schedule', e.target.value);
      showToast(`Backup schedule set to: ${e.target.options[e.target.selectedIndex].text}`, 'info');
    });
  }

  btnSettings.addEventListener('click', () => {
    updateStorageStatsUI();
    settingsModal.classList.add('active');
  });
  btnCloseSettings.addEventListener('click', () => {
    settingsModal.classList.remove('active');
  });

  // Settings: Theme Option selector
  document.getElementById('themeSelect').addEventListener('change', (e) => {
    applyTheme(e.target.value);
  });

  // Settings: Create Cloud backup action
  document.getElementById('btnCreateBackup').addEventListener('click', () => {
    const pass = document.getElementById('backupPasscode').value;
    executeBackup(pass);
    document.getElementById('backupPasscode').value = '';
  });

  // Settings: Restore backup database
  document.getElementById('btnRestoreBackup').addEventListener('click', () => {
    const pass = document.getElementById('restorePasscode').value;
    executeRestore(pass);
    document.getElementById('restorePasscode').value = '';
  });

  // Initialize history back-gesture navigation
  initHistoryNavigation();

  // Confirm Modal buttons
  document.getElementById('btnConfirmOk')?.addEventListener('click', () => {
    if (typeof pendingConfirmCallback === 'function') {
      const cb = pendingConfirmCallback;
      closeConfirmModal();
      cb();
    } else {
      closeConfirmModal();
    }
  });

  document.getElementById('btnConfirmCancel')?.addEventListener('click', closeConfirmModal);

  // Selection Action Bars Listeners
  document.getElementById('btnExitChatsSelection')?.addEventListener('click', exitChatsSelection);
  document.getElementById('btnSelectAllChats')?.addEventListener('click', toggleSelectAllChats);
  document.getElementById('btnDeleteSelectedChats')?.addEventListener('click', deleteSelectedChats);

  document.getElementById('btnExitRequestsSelection')?.addEventListener('click', exitRequestsSelection);
  document.getElementById('btnSelectAllRequests')?.addEventListener('click', toggleSelectAllRequests);
  document.getElementById('btnAcceptSelectedRequests')?.addEventListener('click', acceptSelectedRequests);
  document.getElementById('btnDeclineSelectedRequests')?.addEventListener('click', declineSelectedRequests);

  // Bottom Sidebar 3-Tab Navigation
  document.getElementById('tabNavHome')?.addEventListener('click', () => switchSidebarTab('home'));
  document.getElementById('tabNavGroups')?.addEventListener('click', () => switchSidebarTab('groups'));
  document.getElementById('tabNavRequests')?.addEventListener('click', () => switchSidebarTab('requests'));

  // Groups Selection Action Bar Listeners
  document.getElementById('btnExitGroupsSelection')?.addEventListener('click', exitGroupsSelection);
  document.getElementById('btnSelectAllGroups')?.addEventListener('click', toggleSelectAllGroups);
  document.getElementById('btnExitSelectedGroups')?.addEventListener('click', exitSelectedGroups);
  document.getElementById('btnDeleteSelectedGroups')?.addEventListener('click', deleteSelectedGroups);

  // Group Details Modal Close Button
  document.getElementById('btnCloseGroupDetailsModal')?.addEventListener('click', closeGroupDetailsModal);

  // Chat Header User click listener -> Open Group Details Modal when viewing active group
  document.querySelector('.chat-header-user')?.addEventListener('click', (e) => {
    if (e.target.closest('.back-btn')) return;
    if (state.activeGroup) {
      openGroupDetailsModal(state.activeGroup.id);
    }
  });

  // Group Creation Triggers & Form Submit
  document.getElementById('btnOpenCreateGroupModal')?.addEventListener('click', openCreateGroupModal);
  document.getElementById('btnCreateGroupHeader')?.addEventListener('click', openCreateGroupModal);
  document.getElementById('btnCloseCreateGroupModal')?.addEventListener('click', closeCreateGroupModal);
  document.getElementById('btnCancelCreateGroup')?.addEventListener('click', closeCreateGroupModal);

  document.getElementById('groupSearchInput')?.addEventListener('input', renderGroupsList);

  document.getElementById('createGroupForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('groupNameInput')?.value || '';
    const checklist = document.getElementById('groupMembersChecklist');
    const selectedBoxes = checklist ? checklist.querySelectorAll('input[type="checkbox"]:checked') : [];
    const selectedUsernames = Array.from(selectedBoxes).map(cb => cb.value);
    executeCreateGroup(name, selectedUsernames);
  });

  // Requests Filter Search & Bulk Decline
  document.getElementById('requestSearchInput')?.addEventListener('input', renderRequestsList);
  document.getElementById('btnDeclineAllRequests')?.addEventListener('click', declineAllRequests);

  // Settings: Clear App Cache
  document.getElementById('btnClearCache')?.addEventListener('click', () => {
    showConfirmModal({
      title: 'Clear App Cache?',
      message: 'This will clear temporary browser caches, local media cache, and storage data. Your account and chat messages will remain safe.',
      icon: 'refresh-cw',
      confirmText: 'Clear Cache',
      cancelText: 'Cancel',
      isDanger: false,
      onConfirm: async () => {
        state.localMediaCache.clear();
        await clearMediaLocalDB();
        
        if ('caches' in window) {
          try {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
          } catch (e) {
            console.warn('[CACHE] CacheStorage clear error:', e);
          }
        }
        
        if (typeof onlineToastTracker !== 'undefined') onlineToastTracker.clear();
        if (typeof readToastTracker !== 'undefined') readToastTracker.clear();

        updateStorageStatsUI();
        renderActiveChat();
        showToast('App cache cleared successfully!', 'success');
      }
    });
  });

  // Settings: Clear Cached Media files
  document.getElementById('btnClearMedia').addEventListener('click', () => {
    showConfirmModal({
      title: 'Clear Cached Media?',
      message: 'Are you sure you want to clear all downloaded media files from your local storage cache? Text chats will be kept.',
      icon: 'trash-2',
      confirmText: 'Clear Media',
      cancelText: 'Cancel',
      isDanger: true,
      onConfirm: async () => {
        await clearMediaLocalDB();
        state.localMediaCache.clear();
        updateStorageStatsUI();
        renderActiveChat();
        showToast('Downloaded media attachments cleared', 'success');
      }
    });
  });

  // Settings: Clear chat logs database
  document.getElementById('btnClearAllChats').addEventListener('click', () => {
    showConfirmModal({
      title: 'Clear All History?',
      message: 'WARNING: This will permanently delete your entire local chat history. This action is irreversible. Proceed?',
      icon: 'alert-triangle',
      confirmText: 'Wipe History',
      cancelText: 'Cancel',
      isDanger: true,
      onConfirm: () => {
        state.chats = [];
        state.messages = [];
        state.localMediaCache.clear();
        clearMediaLocalDB();
        saveStateToLocalStorage();
        renderChatList();
        renderActiveChat();
        updateStorageStatsUI();
        showToast('Chat history wiped', 'info');
      }
    });
  });

  // Settings: Delete entire account profile
  document.getElementById('btnDeleteAccount').addEventListener('click', deleteAccount);

  // 8. Log out session
  const triggerLogOutAction = () => {
    showConfirmModal({
      title: 'Log Out Session?',
      message: 'Log out from this device session? You can restore your chats later using a backup password.',
      icon: 'log-out',
      confirmText: 'Log Out',
      cancelText: 'Cancel',
      isDanger: true,
      onConfirm: () => {
        triggerLogOut();
      }
    });
  };

  document.getElementById('btnLogout')?.addEventListener('click', triggerLogOutAction);
  document.getElementById('btnModalLogout')?.addEventListener('click', triggerLogOutAction);

  // 9. WebRTC: Calling interface hooks
  document.getElementById('btnMakeCall').addEventListener('click', () => {
    if (state.activeChatPartner) {
      triggerCallOut(state.activeChatPartner);
    }
  });

  document.getElementById('btnCallAccept').addEventListener('click', acceptIncomingCall);
  document.getElementById('btnCallDecline').addEventListener('click', declineIncomingCall);
  document.getElementById('btnCallHangup').addEventListener('click', () => hangUpCall());
  document.getElementById('btnCallMute').addEventListener('click', toggleMuteMic);

  // Responsive mobile sidebar back buttons
  const backBtn = document.getElementById('btnBackToSidebar');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      closeActiveConversation();
    });
  }

  // Initial feather icon replacements
  feather.replace();
});
