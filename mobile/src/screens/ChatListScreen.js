import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, FlatList, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

export default function ChatListScreen({ navigation, chats, messages, onSelectChat, serverUrl, token }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);

  // Trigger users query search
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

    // Save contact locally
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
    
    // Select chat partner and open screen
    onSelectChat(contact.username);
    navigation.navigate('Chat', { username: contact.username });
  }

  // Sort chats by last message timestamp
  const sortedChats = [...chats].sort((a, b) => {
    const lastA = messages.filter(m => m.chatPartner === a.username).slice(-1)[0];
    const lastB = messages.filter(m => m.chatPartner === b.username).slice(-1)[0];
    const timeA = lastA ? new Date(lastA.timestamp) : new Date(0);
    const timeB = lastB ? new Date(lastB.timestamp) : new Date(0);
    return timeB - timeA;
  });

  function renderChatItem({ item }) {
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
        style={styles.chatItem}
        onPress={() => {
          onSelectChat(item.username);
          navigation.navigate('Chat', { username: item.username });
        }}
      >
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

  return (
    <View style={styles.container}>
      {/* Search Header */}
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

        {/* Dropdown Results Overlay */}
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
            <Ionicons name="chatbubbles-outline" size={64} color="#4a5568" />
            <Text style={styles.emptyListTitle}>No chats started</Text>
            <Text style={styles.emptyListDesc}>Search and add contacts using the lookup bar above to begin secure conversations.</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c101a',
  },
  searchSection: {
    padding: 16,
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
    height: 48,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
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
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#00f2fe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#0c101a',
    fontWeight: '800',
    fontSize: 16,
  },
  chatInfo: {
    flex: 1,
    marginLeft: 14,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  chatName: {
    color: '#fff',
    fontWeight: '600',
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
    fontSize: 13.5,
    flex: 1,
    marginRight: 8,
  },
  badge: {
    backgroundColor: '#00f2fe',
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
  emptyList: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    marginTop: 60,
  },
  emptyListTitle: {
    color: '#e2e8f0',
    fontWeight: '700',
    fontSize: 18,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyListDesc: {
    color: '#718096',
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 18,
  }
});
