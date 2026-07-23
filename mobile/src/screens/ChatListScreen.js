import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
  ScrollView
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

export default function ChatListScreen({
  navigation,
  chats = [],
  groups = [],
  messages = [],
  activeTab = 'home',
  onSwitchTab,
  onSelectChat,
  onSelectGroup,
  onCreateGroup,
  onDeleteSelectedChats,
  onDeleteSelectedGroups,
  onExitSelectedGroups,
  onAcceptRequest,
  onDeclineRequest,
  serverUrl,
  token,
  currentUsername
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);

  // Group search query
  const [groupSearchQuery, setGroupSearchQuery] = useState('');

  // Create Group Modal State
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedGroupMembers, setSelectedGroupMembers] = useState([]);

  // Selection states
  const [selectedChats, setSelectedChats] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [selectedRequests, setSelectedRequests] = useState([]);

  // Trigger users query search for 1-on-1 chats
  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      setShowSearchDropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`${serverUrl}/api/users/search?q=${searchQuery.trim()}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (res.ok) {
          setSearchResults(data.users || []);
          setShowSearchDropdown(true);
        }
      } catch (err) {
        console.error('[MOBILE SEARCH]', err);
      } finally {
        setSearching(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  async function handleAddContact(contact) {
    setSearchQuery('');
    setShowSearchDropdown(false);

    const savedChats = [...chats];
    const exists = savedChats.some(c => c.username === contact.username);
    if (!exists) {
      const newChat = {
        username: contact.username,
        email: contact.email,
        unreadCount: 0
      };
      savedChats.push(newChat);
      await AsyncStorage.setItem('ichat_chats', JSON.stringify(savedChats));
    }
    
    onSelectChat(contact.username);
    navigation.navigate('Chat', { username: contact.username });
  }

  // Group Creation Submission
  const handleExecuteCreateGroup = () => {
    if (!newGroupName.trim()) {
      Alert.alert('Group Name Required', 'Please enter a name for the group.');
      return;
    }
    if (selectedGroupMembers.length === 0) {
      Alert.alert('Members Required', 'Please select at least one contact.');
      return;
    }

    onCreateGroup(newGroupName.trim(), selectedGroupMembers);
    setNewGroupName('');
    setSelectedGroupMembers([]);
    setShowCreateGroupModal(false);
  };

  const toggleSelectGroupMember = (username) => {
    if (selectedGroupMembers.includes(username)) {
      setSelectedGroupMembers(selectedGroupMembers.filter(u => u !== username));
    } else {
      setSelectedGroupMembers([...selectedGroupMembers, username]);
    }
  };

  // Selection Toggles
  const toggleSelectChat = (username) => {
    if (selectedChats.includes(username)) {
      setSelectedChats(selectedChats.filter(u => u !== username));
    } else {
      setSelectedChats([...selectedChats, username]);
    }
  };

  const toggleSelectGroup = (groupId) => {
    if (selectedGroups.includes(groupId)) {
      setSelectedGroups(selectedGroups.filter(g => g !== groupId));
    } else {
      setSelectedGroups([...selectedGroups, groupId]);
    }
  };

  // Filter 1-on-1 chats (accepted/pending)
  const mainChats = chats.filter(c => c && (c.status === 'accepted' || c.status === 'pending_outgoing' || !c.status));
  const pendingRequests = chats.filter(c => c && c.status === 'pending_incoming');

  const sortedChats = [...mainChats].sort((a, b) => {
    const lastA = messages.filter(m => m.chatPartner === a.username).slice(-1)[0];
    const lastB = messages.filter(m => m.chatPartner === b.username).slice(-1)[0];
    const timeA = lastA ? new Date(lastA.timestamp) : new Date(0);
    const timeB = lastB ? new Date(lastB.timestamp) : new Date(0);
    return timeB - timeA;
  });

  const filteredGroups = groups.filter(g => g && g.name && g.name.toLowerCase().includes(groupSearchQuery.toLowerCase().trim()));
  const totalUnreadGroups = groups.reduce((acc, g) => acc + (g.unreadCount || 0), 0);

  function renderChatItem({ item }) {
    const isSelected = selectedChats.includes(item.username);
    const isSelectionMode = selectedChats.length > 0;

    const chatMsgs = messages.filter(m => m.chatPartner === item.username);
    const lastMsg = chatMsgs.slice(-1)[0];
    const displayMsg = lastMsg 
      ? (lastMsg.media ? `📷 ${lastMsg.media.filename}` : lastMsg.body) 
      : 'No messages yet';
    const displayTime = lastMsg 
      ? new Date(lastMsg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
      : '';

    return (
      <TouchableOpacity 
        style={[styles.chatItem, isSelected && styles.selectedItem]}
        onLongPress={() => toggleSelectChat(item.username)}
        onPress={() => {
          if (isSelectionMode) {
            toggleSelectChat(item.username);
          } else {
            onSelectChat(item.username);
            navigation.navigate('Chat', { username: item.username });
          }
        }}
      >
        {isSelectionMode && (
          <Text style={styles.checkIcon}>{isSelected ? '☑' : '☐'}</Text>
        )}
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{item.username.substring(0, 2).toUpperCase()}</Text>
        </View>
        <View style={styles.chatInfo}>
          <View style={styles.chatHeader}>
            <Text style={styles.chatName}>@{item.username}</Text>
            <Text style={styles.chatTime}>{displayTime}</Text>
          </View>
          <View style={styles.chatBody}>
            <Text style={styles.lastMsg} numberOfLines={1}>{displayMsg}</Text>
            {item.unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{item.unreadCount}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  function renderGroupItem({ item }) {
    const isSelected = selectedGroups.includes(item.id);
    const isSelectionMode = selectedGroups.length > 0;

    const groupMsgs = messages.filter(m => m.chatPartner === item.id);
    const lastMsg = groupMsgs.slice(-1)[0];
    const displayMsg = lastMsg 
      ? `${lastMsg.sender === currentUsername ? 'You' : '@' + lastMsg.sender}: ${lastMsg.media ? '📷 File' : lastMsg.body}`
      : 'No messages yet';
    const displayTime = lastMsg 
      ? new Date(lastMsg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
      : '';

    const avatarInitial = (item.name || 'G').substring(0, 2).toUpperCase();

    return (
      <TouchableOpacity 
        style={[styles.chatItem, isSelected && styles.selectedItem]}
        onLongPress={() => toggleSelectGroup(item.id)}
        onPress={() => {
          if (isSelectionMode) {
            toggleSelectGroup(item.id);
          } else {
            onSelectGroup(item);
            navigation.navigate('Chat', { username: item.id, isGroup: true, group: item });
          }
        }}
      >
        {isSelectionMode && (
          <Text style={styles.checkIcon}>{isSelected ? '☑' : '☐'}</Text>
        )}
        <View style={[styles.avatar, styles.groupAvatar]}>
          <Text style={styles.groupAvatarText}>{avatarInitial}</Text>
        </View>
        <View style={styles.chatInfo}>
          <View style={styles.chatHeader}>
            <Text style={styles.chatName}>{item.name}</Text>
            <Text style={styles.chatTime}>{displayTime}</Text>
          </View>
          <View style={styles.chatBody}>
            <Text style={styles.lastMsg} numberOfLines={1}>{displayMsg}</Text>
            {item.unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{item.unreadCount}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  function renderRequestItem({ item }) {
    return (
      <View style={styles.chatItem}>
        <View style={[styles.avatar, styles.requestAvatar]}>
          <Text style={styles.avatarText}>{item.username.substring(0, 2).toUpperCase()}</Text>
        </View>
        <View style={styles.chatInfo}>
          <View style={styles.chatHeader}>
            <Text style={styles.chatName}>@{item.username}</Text>
            <Text style={styles.requestBadge}>Request</Text>
          </View>
          <Text style={styles.lastMsg}>Wants to send you encrypted messages</Text>
        </View>
        <View style={styles.requestActions}>
          <TouchableOpacity style={styles.acceptBtn} onPress={() => onAcceptRequest(item.username)}>
            <Ionicons name="checkmark" size={16} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.declineBtn} onPress={() => onDeclineRequest(item.username)}>
            <Ionicons name="close" size={16} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* 1. CHATS TAB VIEW */}
      {activeTab === 'home' && (
        <View style={{ flex: 1 }}>
          {/* Chats Selection Bar */}
          {selectedChats.length > 0 && (
            <View style={styles.selectionBar}>
              <TouchableOpacity onPress={() => setSelectedChats([])}>
                <Text style={styles.selectionCancel}>✕ Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.selectionCount}>{selectedChats.length} Selected</Text>
              <TouchableOpacity 
                style={styles.btnDangerXs} 
                onPress={() => {
                  onDeleteSelectedChats(selectedChats);
                  setSelectedChats([]);
                }}
              >
                <Text style={styles.btnDangerXsText}>Delete</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Search Bar */}
          <View style={styles.searchSection}>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={18} color="#718096" style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search username or email..."
                placeholderTextColor="#718096"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {searching && <ActivityIndicator size="small" color="#00f2fe" style={styles.loadingSpinner} />}
            </View>

            {showSearchDropdown && (
              <View style={styles.dropdown}>
                <FlatList
                  data={searchResults}
                  keyExtractor={(item) => item.id.toString()}
                  renderItem={({ item }) => (
                    <TouchableOpacity style={styles.dropdownItem} onPress={() => handleAddContact(item)}>
                      <View>
                        <Text style={styles.dropdownName}>@{item.username}</Text>
                        <Text style={styles.dropdownEmail}>{item.email}</Text>
                      </View>
                      <Ionicons name="chatbubble-ellipses-outline" size={20} color="#00f2fe" />
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={() => (
                    <Text style={styles.emptyText}>No users found</Text>
                  )}
                />
              </View>
            )}
          </View>

          {/* Conversations Stream */}
          <FlatList
            data={sortedChats}
            keyExtractor={(item) => item.username}
            renderItem={renderChatItem}
            contentContainerStyle={styles.listContainer}
            ListEmptyComponent={() => (
              <View style={styles.emptyList}>
                <Ionicons name="chatbubbles-outline" size={56} color="#4a5568" />
                <Text style={styles.emptyListTitle}>No conversations started</Text>
                <Text style={styles.emptyListDesc}>Search and add contacts using the lookup bar above to begin secure conversations.</Text>
              </View>
            )}
          />
        </View>
      )}

      {/* 2. GROUPS TAB VIEW */}
      {activeTab === 'groups' && (
        <View style={{ flex: 1 }}>
          {/* Groups Selection Bar */}
          {selectedGroups.length > 0 && (
            <View style={styles.selectionBar}>
              <TouchableOpacity onPress={() => setSelectedGroups([])}>
                <Text style={styles.selectionCancel}>✕ Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.selectionCount}>{selectedGroups.length} Selected</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity 
                  style={styles.btnWarningXs} 
                  onPress={() => {
                    onExitSelectedGroups(selectedGroups);
                    setSelectedGroups([]);
                  }}
                >
                  <Text style={styles.btnWarningXsText}>Exit</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.btnDangerXs} 
                  onPress={() => {
                    onDeleteSelectedGroups(selectedGroups);
                    setSelectedGroups([]);
                  }}
                >
                  <Text style={styles.btnDangerXsText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Groups Header Bar */}
          <View style={styles.groupsHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="people-outline" size={20} color="#38bdf8" />
              <Text style={styles.groupsTitleText}>Group Chats</Text>
              <View style={styles.groupsCountBadge}>
                <Text style={styles.groupsCountBadgeText}>{groups.length}</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.btnNewGroup} onPress={() => setShowCreateGroupModal(true)}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={styles.btnNewGroupText}>New Group</Text>
            </TouchableOpacity>
          </View>

          {/* Group Search Input */}
          <View style={styles.searchSection}>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={18} color="#718096" style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                value={groupSearchQuery}
                onChangeText={setGroupSearchQuery}
                placeholder="Search group chats..."
                placeholderTextColor="#718096"
                autoCapitalize="none"
              />
            </View>
          </View>

          {/* Groups List */}
          <FlatList
            data={filteredGroups}
            keyExtractor={(item) => item.id}
            renderItem={renderGroupItem}
            contentContainerStyle={styles.listContainer}
            ListEmptyComponent={() => (
              <View style={styles.emptyList}>
                <Ionicons name="people-outline" size={56} color="#4a5568" />
                <Text style={styles.emptyListTitle}>No group chats yet</Text>
                <Text style={styles.emptyListDesc}>Click "+ New Group" above to create an encrypted multi-user group chat!</Text>
              </View>
            )}
          />
        </View>
      )}

      {/* 3. REQUESTS TAB VIEW */}
      {activeTab === 'requests' && (
        <View style={{ flex: 1 }}>
          <View style={styles.groupsHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="mail-unread-outline" size={20} color="#38bdf8" />
              <Text style={styles.groupsTitleText}>Message Requests</Text>
              <View style={styles.groupsCountBadge}>
                <Text style={styles.groupsCountBadgeText}>{pendingRequests.length}</Text>
              </View>
            </View>
          </View>

          <FlatList
            data={pendingRequests}
            keyExtractor={(item) => item.username}
            renderItem={renderRequestItem}
            contentContainerStyle={styles.listContainer}
            ListEmptyComponent={() => (
              <View style={styles.emptyList}>
                <Ionicons name="mail-open-outline" size={56} color="#4a5568" />
                <Text style={styles.emptyListTitle}>No pending requests</Text>
                <Text style={styles.emptyListDesc}>When new users message you, their requests will appear here.</Text>
              </View>
            )}
          />
        </View>
      )}

      {/* 4. BOTTOM 3-TAB NAVIGATION BAR */}
      <View style={styles.bottomTabNav}>
        <TouchableOpacity 
          style={[styles.tabItem, activeTab === 'home' && styles.tabItemActive]}
          onPress={() => onSwitchTab('home')}
        >
          <Ionicons name="chatbubbles" size={20} color={activeTab === 'home' ? '#38bdf8' : '#718096'} />
          <Text style={[styles.tabLabel, activeTab === 'home' && styles.tabLabelActive]}>Chats</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tabItem, activeTab === 'groups' && styles.tabItemActive]}
          onPress={() => onSwitchTab('groups')}
        >
          <View>
            <Ionicons name="people" size={20} color={activeTab === 'groups' ? '#38bdf8' : '#718096'} />
            {totalUnreadGroups > 0 && (
              <View style={styles.tabBadge}>
                <Text style={styles.tabBadgeText}>{totalUnreadGroups}</Text>
              </View>
            )}
          </View>
          <Text style={[styles.tabLabel, activeTab === 'groups' && styles.tabLabelActive]}>Groups</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tabItem, activeTab === 'requests' && styles.tabItemActive]}
          onPress={() => onSwitchTab('requests')}
        >
          <View>
            <Ionicons name="mail-unread" size={20} color={activeTab === 'requests' ? '#38bdf8' : '#718096'} />
            {pendingRequests.length > 0 && (
              <View style={styles.tabBadge}>
                <Text style={styles.tabBadgeText}>{pendingRequests.length}</Text>
              </View>
            )}
          </View>
          <Text style={[styles.tabLabel, activeTab === 'requests' && styles.tabLabelActive]}>Requests</Text>
        </TouchableOpacity>
      </View>

      {/* 5. CREATE GROUP MODAL */}
      <Modal visible={showCreateGroupModal} animationType="slide" transparent onRequestClose={() => setShowCreateGroupModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create E2EE Group</Text>
              <TouchableOpacity onPress={() => setShowCreateGroupModal(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.inputLabel}>Group Name</Text>
              <TextInput
                style={styles.modalInput}
                value={newGroupName}
                onChangeText={setNewGroupName}
                placeholder="e.g. Project Alpha"
                placeholderTextColor="#718096"
              />

              <View style={styles.checklistHeader}>
                <Text style={styles.inputLabel}>Select Group Members</Text>
                <Text style={styles.checklistCount}>{selectedGroupMembers.length} selected</Text>
              </View>

              <ScrollView style={styles.checklistScroll}>
                {mainChats.length === 0 ? (
                  <Text style={styles.emptyText}>No connected contacts available. Start a 1-on-1 chat first!</Text>
                ) : (
                  mainChats.map(c => {
                    const isSelected = selectedGroupMembers.includes(c.username);
                    return (
                      <TouchableOpacity
                        key={c.username}
                        style={[styles.checklistItem, isSelected && styles.checklistItemActive]}
                        onPress={() => toggleSelectGroupMember(c.username)}
                      >
                        <Text style={styles.checkboxIcon}>{isSelected ? '☑' : '☐'}</Text>
                        <Text style={styles.checklistText}>@{c.username}</Text>
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.btnCancel} onPress={() => setShowCreateGroupModal(false)}>
                  <Text style={styles.btnCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnCreateSubmit} onPress={handleExecuteCreateGroup}>
                  <Text style={styles.btnCreateSubmitText}>Create Group</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c101a',
  },
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e293b',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155'
  },
  selectionCancel: {
    color: '#94a3b8',
    fontWeight: '700',
    fontSize: 13
  },
  selectionCount: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14
  },
  btnDangerXs: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6
  },
  btnDangerXsText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12
  },
  btnWarningXs: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    borderWidth: 1,
    borderColor: '#f59e0b',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6
  },
  btnWarningXsText: {
    color: '#f59e0b',
    fontWeight: '700',
    fontSize: 12
  },
  searchSection: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    zIndex: 10,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#06080d',
    borderWidth: 1,
    borderColor: '#2d3748',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    height: '100%',
  },
  loadingSpinner: {
    marginLeft: 8,
  },
  dropdown: {
    backgroundColor: '#161c2d',
    borderWidth: 1,
    borderColor: '#2d3748',
    borderRadius: 12,
    maxHeight: 200,
    marginTop: 8,
  },
  dropdownItem: {
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  dropdownName: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  dropdownEmail: {
    color: '#718096',
    fontSize: 11,
    marginTop: 2,
  },
  emptyText: {
    color: '#718096',
    textAlign: 'center',
    padding: 16,
    fontSize: 13,
  },
  groupsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#161c2d',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)'
  },
  groupsTitleText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff'
  },
  groupsCountBadge: {
    backgroundColor: 'rgba(56, 189, 248, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10
  },
  groupsCountBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#38bdf8'
  },
  btnNewGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0284c7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8
  },
  btnNewGroupText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12
  },
  listContainer: {
    flexGrow: 1,
  },
  chatItem: {
    flexDirection: 'row',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
  },
  selectedItem: {
    backgroundColor: 'rgba(56, 189, 248, 0.12)'
  },
  checkIcon: {
    fontSize: 18,
    color: '#38bdf8',
    marginRight: 10
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#0284c7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 15,
  },
  groupAvatar: {
    backgroundColor: '#0284c7'
  },
  groupAvatarText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 15
  },
  requestAvatar: {
    backgroundColor: '#334155'
  },
  chatInfo: {
    flex: 1,
    marginLeft: 12,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  chatName: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  chatTime: {
    color: '#718096',
    fontSize: 11,
  },
  chatBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lastMsg: {
    color: '#a0aec0',
    fontSize: 13,
    flex: 1,
    marginRight: 8,
  },
  badge: {
    backgroundColor: '#38bdf8',
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#0c101a',
    fontSize: 10,
    fontWeight: '800',
  },
  requestBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#38bdf8',
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6
  },
  requestActions: {
    flexDirection: 'row',
    gap: 8,
    marginLeft: 8
  },
  acceptBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#0284c7',
    alignItems: 'center',
    justifyContent: 'center'
  },
  declineBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center'
  },
  emptyList: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    marginTop: 40,
  },
  emptyListTitle: {
    color: '#e2e8f0',
    fontWeight: '700',
    fontSize: 17,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyListDesc: {
    color: '#718096',
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 18,
  },
  bottomTabNav: {
    flexDirection: 'row',
    height: 60,
    backgroundColor: '#161c2d',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabItemActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.08)'
  },
  tabLabel: {
    fontSize: 11,
    color: '#718096',
    fontWeight: '600',
    marginTop: 2
  },
  tabLabelActive: {
    color: '#38bdf8',
    fontWeight: '700'
  },
  tabBadge: {
    position: 'absolute',
    top: -4,
    right: -10,
    backgroundColor: '#0284c7',
    borderRadius: 7,
    minWidth: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2
  },
  tabBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800'
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end'
  },
  modalCard: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    borderWidth: 1,
    borderColor: '#334155'
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b'
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff'
  },
  modalCloseText: {
    fontSize: 18,
    color: '#94a3b8',
    fontWeight: '700'
  },
  modalBody: {
    padding: 18
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 6
  },
  modalInput: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 16
  },
  checklistHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6
  },
  checklistCount: {
    fontSize: 11,
    color: '#94a3b8'
  },
  checklistScroll: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    maxHeight: 140,
    padding: 6
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8
  },
  checklistItemActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)'
  },
  checkboxIcon: {
    fontSize: 16,
    color: '#38bdf8',
    marginRight: 8
  },
  checklistText: {
    fontSize: 13,
    color: '#f8fafc',
    fontWeight: '600'
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20
  },
  btnCancel: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center'
  },
  btnCancelText: {
    color: '#94a3b8',
    fontWeight: '600',
    fontSize: 13
  },
  btnCreateSubmit: {
    flex: 1,
    backgroundColor: '#0284c7',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center'
  },
  btnCreateSubmitText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13
  }
});
