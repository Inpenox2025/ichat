import React, { useState, useEffect } from 'react';
import {
  StyleSheet, Text, View, FlatList, TextInput, TouchableOpacity,
  Alert, ActivityIndicator, Modal, ScrollView, StatusBar, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

export default function ChatListScreen({
  navigation, chats = [], groups = [], messages = [],
  activeTab = 'home', onSwitchTab, onSelectChat, onSelectGroup,
  onCreateGroup, onDeleteSelectedChats, onDeleteSelectedGroups,
  onExitSelectedGroups, onAcceptRequest, onDeclineRequest,
  serverUrl, token, user, currentUsername
}) {
  const { colors, selectedTheme } = useTheme();
  const C = colors;

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedGroupMembers, setSelectedGroupMembers] = useState([]);
  const [selectedChats, setSelectedChats] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState([]);

  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults([]); setShowSearchDropdown(false); return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`${serverUrl}/api/users/search?q=${searchQuery.trim()}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (res.ok) { setSearchResults(data.users || []); setShowSearchDropdown(true); }
      } catch (err) { console.error('[MOBILE SEARCH]', err); }
      finally { setSearching(false); }
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  async function handleAddContact(contact) {
    setSearchQuery(''); setShowSearchDropdown(false);
    onSelectChat(contact.username);
    navigation.navigate('Chat', { username: contact.username });
  }

  const handleExecuteCreateGroup = () => {
    if (!newGroupName.trim()) { Alert.alert('Group Name Required', 'Please enter a group name.'); return; }
    if (selectedGroupMembers.length === 0) { Alert.alert('Members Required', 'Select at least one contact.'); return; }
    onCreateGroup(newGroupName.trim(), selectedGroupMembers);
    setNewGroupName(''); setSelectedGroupMembers([]); setShowCreateGroupModal(false);
  };

  const toggleSelectGroupMember = (u) => setSelectedGroupMembers(prev =>
    prev.includes(u) ? prev.filter(x => x !== u) : [...prev, u]);
  const toggleSelectChat = (u) => setSelectedChats(prev =>
    prev.includes(u) ? prev.filter(x => x !== u) : [...prev, u]);
  const toggleSelectGroup = (id) => setSelectedGroups(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const confirmDeleteSelectedChats = () => {
    if (selectedChats.length === 0) return;
    const msg = `Delete ${selectedChats.length} selected conversation${selectedChats.length > 1 ? 's' : ''} and all message history?`;
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) {
        onDeleteSelectedChats(selectedChats);
        setSelectedChats([]);
      }
      return;
    }
    Alert.alert('Delete Selected Chats', msg, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          onDeleteSelectedChats(selectedChats);
          setSelectedChats([]);
        }
      }
    ]);
  };

  const confirmExitSelectedGroups = () => {
    if (selectedGroups.length === 0) return;
    const msg = `Exit ${selectedGroups.length} selected group${selectedGroups.length > 1 ? 's' : ''}? You will no longer receive new messages.`;
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) {
        onExitSelectedGroups(selectedGroups);
        setSelectedGroups([]);
      }
      return;
    }
    Alert.alert('Exit Selected Groups', msg, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Exit Groups',
        style: 'destructive',
        onPress: () => {
          onExitSelectedGroups(selectedGroups);
          setSelectedGroups([]);
        }
      }
    ]);
  };

  const confirmDeleteSelectedGroups = () => {
    if (selectedGroups.length === 0) return;
    const msg = `Permanently delete ${selectedGroups.length} selected group${selectedGroups.length > 1 ? 's' : ''} and message logs?`;
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) {
        onDeleteSelectedGroups(selectedGroups);
        setSelectedGroups([]);
      }
      return;
    }
    Alert.alert('Delete Selected Groups', msg, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete Groups',
        style: 'destructive',
        onPress: () => {
          onDeleteSelectedGroups(selectedGroups);
          setSelectedGroups([]);
        }
      }
    ]);
  };

  function getPartnerMessages(partnerId) {
    if (Array.isArray(messages)) {
      return messages.filter(m => m && (m.chatPartner === partnerId || m.recipient === partnerId || m.sender === partnerId));
    }
    if (messages && typeof messages === 'object') {
      return messages[partnerId] || [];
    }
    return [];
  }

  const mainChats = (chats || []).filter(c => c && (c.status === 'accepted' || c.status === 'pending_outgoing' || !c.status));
  const pendingRequests = (chats || []).filter(c => c && c.status === 'pending_incoming');
  const sortedChats = [...mainChats].sort((a, b) => {
    const msgsA = getPartnerMessages(a.username);
    const msgsB = getPartnerMessages(b.username);
    const lA = msgsA.slice(-1)[0];
    const lB = msgsB.slice(-1)[0];
    return new Date(lB?.timestamp || 0) - new Date(lA?.timestamp || 0);
  });
  const filteredGroups = (groups || []).filter(g => g?.name?.toLowerCase().includes(groupSearchQuery.toLowerCase().trim()));
  const totalUnreadGroups = (groups || []).reduce((acc, g) => acc + (g.unreadCount || 0), 0);
  const totalUnreadChats = (chats || []).reduce((acc, c) => acc + (c.unreadCount || 0), 0);

  function renderChatItem({ item }) {
    const isSelected = selectedChats.includes(item.username);
    const selMode = selectedChats.length > 0;
    const chatMsgs = getPartnerMessages(item.username);
    const last = chatMsgs.slice(-1)[0];
    const displayMsg = last ? (last.media ? `📷 ${last.media.filename}` : last.body) : 'No messages yet';
    const displayTime = last ? new Date(last.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return (
      <TouchableOpacity
        style={[{ flexDirection: 'row', padding: 16, borderBottomWidth: 1, alignItems: 'center', backgroundColor: isSelected ? C.selectedItem : C.chatItem, borderBottomColor: C.chatItemBorder }]}
        onLongPress={() => toggleSelectChat(item.username)}
        onPress={() => selMode ? toggleSelectChat(item.username) : (onSelectChat(item.username), navigation.navigate('Chat', { username: item.username }))}
      >
        {selMode && <Text style={{ fontSize: 18, color: C.accent, marginRight: 10 }}>{isSelected ? '☑' : '☐'}</Text>}
        <View style={[styles.avatar, { backgroundColor: '#0284c7' }]}>
          <Text style={styles.avatarText}>{item.username.substring(0, 2).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={{ color: C.text, fontWeight: '700', fontSize: 15 }}>@{item.username}</Text>
            <Text style={{ color: C.textFaint, fontSize: 11 }}>{displayTime}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: C.textMuted, fontSize: 13, flex: 1, marginRight: 8 }} numberOfLines={1}>{displayMsg}</Text>
            {item.unreadCount > 0 && (
              <View style={{ backgroundColor: C.unreadBadge, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{item.unreadCount}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  function renderGroupItem({ item }) {
    const isSelected = selectedGroups.includes(item.id);
    const selMode = selectedGroups.length > 0;
    const groupMsgs = getPartnerMessages(item.id);
    const last = groupMsgs.slice(-1)[0];
    const displayMsg = last ? `${last.sender === currentUsername ? 'You' : '@' + last.sender}: ${last.media ? '📷 File' : last.body}` : 'No messages yet';
    const displayTime = last ? new Date(last.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return (
      <TouchableOpacity
        style={[{ flexDirection: 'row', padding: 16, borderBottomWidth: 1, alignItems: 'center', backgroundColor: isSelected ? C.selectedItem : C.chatItem, borderBottomColor: C.chatItemBorder }]}
        onLongPress={() => toggleSelectGroup(item.id)}
        onPress={() => selMode ? toggleSelectGroup(item.id) : (onSelectGroup(item), navigation.navigate('Chat', { username: item.id, isGroup: true, group: item }))}
      >
        {selMode && <Text style={{ fontSize: 18, color: C.accent, marginRight: 10 }}>{isSelected ? '☑' : '☐'}</Text>}
        <View style={[styles.avatar, { backgroundColor: '#0e7490' }]}>
          <Text style={styles.avatarText}>{(item.name || 'G').substring(0, 2).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={{ color: C.text, fontWeight: '700', fontSize: 15 }}>{item.name}</Text>
            <Text style={{ color: C.textFaint, fontSize: 11 }}>{displayTime}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: C.textMuted, fontSize: 13, flex: 1, marginRight: 8 }} numberOfLines={1}>{displayMsg}</Text>
            {item.unreadCount > 0 && (
              <View style={{ backgroundColor: C.unreadBadge, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{item.unreadCount}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  function renderRequestItem({ item }) {
    return (
      <View style={[{ flexDirection: 'row', padding: 16, borderBottomWidth: 1, alignItems: 'center', backgroundColor: C.chatItem, borderBottomColor: C.chatItemBorder }]}>
        <View style={[styles.avatar, { backgroundColor: '#334155' }]}>
          <Text style={styles.avatarText}>{item.username.substring(0, 2).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={{ color: C.text, fontWeight: '700', fontSize: 15 }}>@{item.username}</Text>
            <View style={{ backgroundColor: C.accentBg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
              <Text style={{ color: C.accent, fontSize: 10, fontWeight: '700' }}>Request</Text>
            </View>
          </View>
          <Text style={{ color: C.textMuted, fontSize: 13 }}>Wants to send you encrypted messages</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginLeft: 8 }}>
          <TouchableOpacity style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#0284c7', alignItems: 'center', justifyContent: 'center' }} onPress={() => onAcceptRequest(item.username)}>
            <Ionicons name="checkmark" size={16} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(239,68,68,0.15)', borderWidth: 1, borderColor: '#ef4444', alignItems: 'center', justifyContent: 'center' }} onPress={() => onDeclineRequest(item.username)}>
            <Ionicons name="close" size={16} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const tabActive = C.accent;
  const tabInactive = C.textFaint;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle={C.isDark ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />

      {/* ── BRANDED HEADER ── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 13, backgroundColor: C.bg, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 26, fontWeight: '900', color: C.accent, letterSpacing: -0.5 }}>ichat</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.accentBg, borderWidth: 1, borderColor: C.isDark ? 'rgba(0,242,254,0.25)' : 'rgba(2,132,199,0.25)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Ionicons name="shield-checkmark" size={9} color={C.accent} />
            <Text style={{ color: C.accent, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 }}>E2EE</Text>
          </View>
        </View>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#0284c7', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(56,189,248,0.4)' }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>{(user?.username || '?').substring(0, 2).toUpperCase()}</Text>
        </View>
      </View>

      {/* ── MAIN CONTENT ── */}
      <View style={{ flex: 1, backgroundColor: C.bg }}>

        {/* 1. CHATS TAB */}
        {activeTab === 'home' && (
          <View style={{ flex: 1 }}>
            {selectedChats.length > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.cardAlt, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border }}>
                <TouchableOpacity onPress={() => setSelectedChats([])}>
                  <Text style={{ color: C.textMuted, fontWeight: '700', fontSize: 13 }}>✕ Cancel</Text>
                </TouchableOpacity>
                <Text style={{ color: C.text, fontWeight: '700', fontSize: 13 }}>{selectedChats.length} Selected</Text>
                <TouchableOpacity style={{ backgroundColor: '#ef4444', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 }} onPress={confirmDeleteSelectedChats}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>Delete</Text>
                </TouchableOpacity>
              </View>
            )}
            <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: C.border, zIndex: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.input, borderWidth: 1, borderColor: C.inputBorder, borderRadius: 12, paddingHorizontal: 12, height: 44 }}>
                <Ionicons name="search" size={18} color={C.textFaint} style={{ marginRight: 8 }} />
                <TextInput style={{ flex: 1, color: C.text, fontSize: 14, height: '100%' }} value={searchQuery} onChangeText={setSearchQuery} placeholder="Search username or email..." placeholderTextColor={C.textFaint} autoCapitalize="none" autoCorrect={false} />
                {searching && <ActivityIndicator size="small" color={C.accent} style={{ marginLeft: 8 }} />}
              </View>
              {showSearchDropdown && (
                <View style={{ backgroundColor: C.dropdown, borderWidth: 1, borderColor: C.borderStrong, borderRadius: 12, maxHeight: 200, marginTop: 8 }}>
                  <FlatList data={searchResults} keyExtractor={item => item.id.toString()} renderItem={({ item }) => (
                    <TouchableOpacity style={{ padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: C.border }} onPress={() => handleAddContact(item)}>
                      <View>
                        <Text style={{ color: C.text, fontWeight: '600', fontSize: 14 }}>@{item.username}</Text>
                        <Text style={{ color: C.textFaint, fontSize: 11, marginTop: 2 }}>{item.email}</Text>
                      </View>
                      <Ionicons name="chatbubble-ellipses-outline" size={20} color={C.accent} />
                    </TouchableOpacity>
                  )} ListEmptyComponent={() => <Text style={{ color: C.textFaint, textAlign: 'center', padding: 16, fontSize: 13 }}>No users found</Text>} />
                </View>
              )}
            </View>
            <FlatList data={sortedChats} keyExtractor={item => item.username} renderItem={renderChatItem} contentContainerStyle={{ flexGrow: 1 }}
              ListEmptyComponent={() => (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, marginTop: 40 }}>
                  <Ionicons name="chatbubbles-outline" size={56} color={C.textFaint} />
                  <Text style={{ color: C.textSub, fontWeight: '700', fontSize: 17, marginTop: 16, marginBottom: 8 }}>No conversations yet</Text>
                  <Text style={{ color: C.textFaint, textAlign: 'center', fontSize: 13, lineHeight: 18 }}>Search and add contacts above to start encrypted conversations.</Text>
                </View>
              )} />
          </View>
        )}

        {/* 2. GROUPS TAB */}
        {activeTab === 'groups' && (
          <View style={{ flex: 1 }}>
            {selectedGroups.length > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.cardAlt, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border }}>
                <TouchableOpacity onPress={() => setSelectedGroups([])}><Text style={{ color: C.textMuted, fontWeight: '700', fontSize: 13 }}>✕ Cancel</Text></TouchableOpacity>
                <Text style={{ color: C.text, fontWeight: '700', fontSize: 13 }}>{selectedGroups.length} Selected</Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <TouchableOpacity style={{ backgroundColor: 'rgba(245,158,11,0.2)', borderWidth: 1, borderColor: '#f59e0b', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 }} onPress={confirmExitSelectedGroups}>
                    <Text style={{ color: '#f59e0b', fontWeight: '700', fontSize: 12 }}>Exit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={{ backgroundColor: '#ef4444', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 }} onPress={confirmDeleteSelectedGroups}>
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.sectionHeader, borderBottomWidth: 1, borderBottomColor: C.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="people-outline" size={20} color={C.accent} />
                <Text style={{ fontSize: 16, fontWeight: '700', color: C.text }}>Group Chats</Text>
                <View style={{ backgroundColor: C.accentBg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 }}>
                  <Text style={{ fontSize: 11, fontWeight: '800', color: C.accent }}>{groups.length}</Text>
                </View>
              </View>
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#0284c7', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }} onPress={() => setShowCreateGroupModal(true)}>
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>New Group</Text>
              </TouchableOpacity>
            </View>
            <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: C.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.input, borderWidth: 1, borderColor: C.inputBorder, borderRadius: 12, paddingHorizontal: 12, height: 44 }}>
                <Ionicons name="search" size={18} color={C.textFaint} style={{ marginRight: 8 }} />
                <TextInput style={{ flex: 1, color: C.text, fontSize: 14, height: '100%' }} value={groupSearchQuery} onChangeText={setGroupSearchQuery} placeholder="Search group chats..." placeholderTextColor={C.textFaint} autoCapitalize="none" />
              </View>
            </View>
            <FlatList data={filteredGroups} keyExtractor={item => item.id} renderItem={renderGroupItem} contentContainerStyle={{ flexGrow: 1 }}
              ListEmptyComponent={() => (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, marginTop: 40 }}>
                  <Ionicons name="people-outline" size={56} color={C.textFaint} />
                  <Text style={{ color: C.textSub, fontWeight: '700', fontSize: 17, marginTop: 16, marginBottom: 8 }}>No group chats yet</Text>
                  <Text style={{ color: C.textFaint, textAlign: 'center', fontSize: 13, lineHeight: 18 }}>Tap "+ New Group" above to create an encrypted group chat.</Text>
                </View>
              )} />
          </View>
        )}

        {/* 3. REQUESTS TAB */}
        {activeTab === 'requests' && (
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.sectionHeader, borderBottomWidth: 1, borderBottomColor: C.border, gap: 8 }}>
              <Ionicons name="mail-unread-outline" size={20} color={C.accent} />
              <Text style={{ fontSize: 16, fontWeight: '700', color: C.text }}>Message Requests</Text>
              <View style={{ backgroundColor: C.accentBg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 }}>
                <Text style={{ fontSize: 11, fontWeight: '800', color: C.accent }}>{pendingRequests.length}</Text>
              </View>
            </View>
            <FlatList data={pendingRequests} keyExtractor={item => item.username} renderItem={renderRequestItem} contentContainerStyle={{ flexGrow: 1 }}
              ListEmptyComponent={() => (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, marginTop: 40 }}>
                  <Ionicons name="mail-open-outline" size={56} color={C.textFaint} />
                  <Text style={{ color: C.textSub, fontWeight: '700', fontSize: 17, marginTop: 16, marginBottom: 8 }}>No pending requests</Text>
                  <Text style={{ color: C.textFaint, textAlign: 'center', fontSize: 13, lineHeight: 18 }}>When users message you, requests appear here.</Text>
                </View>
              )} />
          </View>
        )}
      </View>

      {/* ── BOTTOM 4-TAB NAV ── */}
      <View style={{ flexDirection: 'row', height: 64, backgroundColor: C.tabBar, borderTopWidth: 1, borderTopColor: C.tabBarBorder, paddingBottom: 4 }}>
        {[
          { id: 'home', icon: 'chatbubbles', label: 'Chats', badge: totalUnreadChats },
          { id: 'groups', icon: 'people', label: 'Groups', badge: totalUnreadGroups },
          { id: 'requests', icon: 'mail-unread', label: 'Requests', badge: pendingRequests.length },
        ].map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <TouchableOpacity key={tab.id} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 6, backgroundColor: isActive ? (C.isDark ? 'rgba(56,189,248,0.07)' : 'rgba(2,132,199,0.06)') : 'transparent' }} onPress={() => onSwitchTab(tab.id)}>
              <View style={{ position: 'relative' }}>
                <Ionicons name={isActive ? tab.icon : tab.icon + '-outline'} size={22} color={isActive ? tabActive : tabInactive} />
                {tab.badge > 0 && (
                  <View style={{ position: 'absolute', top: -4, right: -8, backgroundColor: C.unreadBadge, borderRadius: 7, minWidth: 14, height: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2, borderWidth: 1.5, borderColor: C.tabBar }}>
                    <Text style={{ color: '#fff', fontSize: 8, fontWeight: '800' }}>{tab.badge > 99 ? '99+' : tab.badge}</Text>
                  </View>
                )}
              </View>
              <Text style={{ fontSize: 10, color: isActive ? tabActive : tabInactive, fontWeight: isActive ? '700' : '600', marginTop: 2 }}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 6 }} onPress={() => navigation.navigate('Settings')}>
          <Ionicons name="settings-outline" size={22} color={tabInactive} />
          <Text style={{ fontSize: 10, color: tabInactive, fontWeight: '600', marginTop: 2 }}>Settings</Text>
        </TouchableOpacity>
      </View>

      {/* ── CREATE GROUP MODAL ── */}
      <Modal visible={showCreateGroupModal} animationType="slide" transparent onRequestClose={() => setShowCreateGroupModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: C.modalBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '80%', borderWidth: 1, borderColor: C.borderStrong }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18, borderBottomWidth: 1, borderBottomColor: C.border }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: C.text }}>Create E2EE Group</Text>
              <TouchableOpacity onPress={() => setShowCreateGroupModal(false)}>
                <Text style={{ fontSize: 18, color: C.textMuted, fontWeight: '700' }}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={{ padding: 18 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: C.text, marginBottom: 6 }}>Group Name</Text>
              <TextInput style={{ backgroundColor: C.cardAlt, borderRadius: 10, borderWidth: 1, borderColor: C.borderStrong, color: C.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginBottom: 16 }} value={newGroupName} onChangeText={setNewGroupName} placeholder="e.g. Project Alpha" placeholderTextColor={C.textFaint} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: C.text }}>Select Members</Text>
                <Text style={{ fontSize: 11, color: C.textMuted }}>{selectedGroupMembers.length} selected</Text>
              </View>
              <ScrollView style={{ backgroundColor: C.cardAlt, borderRadius: 10, maxHeight: 140, padding: 6 }}>
                {mainChats.length === 0
                  ? <Text style={{ color: C.textFaint, textAlign: 'center', padding: 16, fontSize: 13 }}>No contacts yet. Start a 1-on-1 chat first!</Text>
                  : mainChats.map(c => {
                    const isSel = selectedGroupMembers.includes(c.username);
                    return (
                      <TouchableOpacity key={c.username} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: isSel ? C.selectedItem : 'transparent' }} onPress={() => toggleSelectGroupMember(c.username)}>
                        <Text style={{ fontSize: 16, color: C.accent, marginRight: 8 }}>{isSel ? '☑' : '☐'}</Text>
                        <Text style={{ fontSize: 13, color: C.text, fontWeight: '600' }}>@{c.username}</Text>
                      </TouchableOpacity>
                    );
                  })}
              </ScrollView>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
                <TouchableOpacity style={{ flex: 1, borderWidth: 1, borderColor: C.borderStrong, paddingVertical: 12, borderRadius: 10, alignItems: 'center' }} onPress={() => setShowCreateGroupModal(false)}>
                  <Text style={{ color: C.textMuted, fontWeight: '600', fontSize: 13 }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ flex: 1, backgroundColor: '#0284c7', paddingVertical: 12, borderRadius: 10, alignItems: 'center' }} onPress={handleExecuteCreateGroup}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Create Group</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: {
    color: '#ffffff', fontWeight: '800', fontSize: 15,
  },
});
