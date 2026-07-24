import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Platform
} from 'react-native';

export default function GroupDetailsModal({
  visible,
  onClose,
  group,
  currentUser,
  contacts,
  onAddMembers,
  onExitGroup,
  onDeleteGroup
}) {
  const [selectedContacts, setSelectedContacts] = useState([]);

  if (!group) return null;

  const nonMemberContacts = (contacts || []).filter(
    c => c && (c.status === 'accepted' || c.status === 'pending_outgoing' || !c.status) && !group.members.includes(c.username)
  );

  const toggleSelectContact = (username) => {
    if (selectedContacts.includes(username)) {
      setSelectedContacts(selectedContacts.filter(u => u !== username));
    } else {
      setSelectedContacts([...selectedContacts, username]);
    }
  };

  const handleAddMembersSubmit = () => {
    if (selectedContacts.length === 0) return;
    onAddMembers(group.id, selectedContacts);
    setSelectedContacts([]);
  };

  const handleExitPress = () => {
    const title = `Exit Group "${group.name}"?`;
    const msg = 'Are you sure you want to exit this group? You will no longer receive new messages.';
    if (Platform.OS === 'web') {
      if (window.confirm(`${title}\n${msg}`)) {
        onClose();
        onExitGroup(group.id);
      }
      return;
    }
    Alert.alert(
      title,
      msg,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Exit Group',
          style: 'destructive',
          onPress: () => {
            onClose();
            onExitGroup(group.id);
          }
        }
      ]
    );
  };

  const handleDeletePress = () => {
    const title = `Delete Group "${group.name}"?`;
    const msg = 'Are you sure you want to delete this group and all its message history?';
    if (Platform.OS === 'web') {
      if (window.confirm(`${title}\n${msg}`)) {
        onClose();
        onDeleteGroup(group.id);
      }
      return;
    }
    Alert.alert(
      title,
      msg,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Group',
          style: 'destructive',
          onPress: () => {
            onClose();
            onDeleteGroup(group.id);
          }
        }
      ]
    );
  };

  const avatarInitial = (group.name || 'G').substring(0, 2).toUpperCase();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Group Info</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 24 }}>
            {/* Group Banner */}
            <View style={styles.profileHeader}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{avatarInitial}</Text>
              </View>
              <Text style={styles.groupTitle}>{group.name}</Text>
              <Text style={styles.groupSub}>Created by @{group.createdBy || 'unknown'}</Text>
            </View>

            {/* Active Members */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Group Members</Text>
                <Text style={styles.sectionBadge}>{group.members.length} members</Text>
              </View>
              <View style={styles.membersList}>
                {group.members.map(username => {
                  const isCreator = username === group.createdBy;
                  const isYou = username === currentUser?.username;
                  const initial = (username || 'U').substring(0, 2).toUpperCase();

                  return (
                    <View key={username} style={styles.memberItem}>
                      <View style={styles.memberLeft}>
                        <View style={styles.memberAvatar}>
                          <Text style={styles.memberAvatarText}>{initial}</Text>
                        </View>
                        <Text style={styles.memberUsername}>@{username}</Text>
                      </View>
                      <View style={styles.badgesRow}>
                        {isCreator && (
                          <View style={styles.creatorBadge}>
                            <Text style={styles.creatorBadgeText}>Creator</Text>
                          </View>
                        )}
                        {isYou && (
                          <View style={styles.youBadge}>
                            <Text style={styles.youBadgeText}>You</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Add More Members */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Add People to Group</Text>
                <Text style={styles.sectionBadge}>{selectedContacts.length} selected</Text>
              </View>
              <View style={styles.checklistContainer}>
                {nonMemberContacts.length === 0 ? (
                  <Text style={styles.emptyText}>All contacts are already in this group.</Text>
                ) : (
                  nonMemberContacts.map(c => {
                    const isSelected = selectedContacts.includes(c.username);
                    return (
                      <TouchableOpacity
                        key={c.username}
                        style={[styles.checklistItem, isSelected && styles.checklistItemActive]}
                        onPress={() => toggleSelectContact(c.username)}
                      >
                        <Text style={styles.checkboxIcon}>{isSelected ? '☑' : '☐'}</Text>
                        <Text style={styles.checklistText}>@{c.username}</Text>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
              {nonMemberContacts.length > 0 && (
                <TouchableOpacity
                  style={[styles.btnPrimary, selectedContacts.length === 0 && styles.btnDisabled]}
                  disabled={selectedContacts.length === 0}
                  onPress={handleAddMembersSubmit}
                >
                  <Text style={styles.btnPrimaryText}>Add Selected Members</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Exit / Delete Actions */}
            <View style={styles.actionsRow}>
              <TouchableOpacity style={styles.btnWarning} onPress={handleExitPress}>
                <Text style={styles.btnWarningText}>Exit Group</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnDanger} onPress={handleDeletePress}>
                <Text style={styles.btnDangerText}>Delete Group</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    justifyContent: "flex-end",
  },
  card: {
    backgroundColor: "#0f172a",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "85%",
    borderWidth: 1,
    borderColor: "#334155",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#ffffff",
  },
  closeBtn: {
    padding: 4,
  },
  closeBtnText: {
    fontSize: 18,
    color: "#94a3b8",
    fontWeight: "700",
  },
  body: {
    padding: 18,
  },
  profileHeader: {
    alignItems: "center",
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#0284c7",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  avatarText: {
    fontSize: 22,
    fontWeight: "800",
    color: "#ffffff",
  },
  groupTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#ffffff",
  },
  groupSub: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 2,
  },
  section: {
    marginTop: 18,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#38bdf8",
  },
  sectionBadge: {
    fontSize: 11,
    color: "#94a3b8",
  },
  membersList: {
    backgroundColor: "#1e293b",
    borderRadius: 12,
    padding: 6,
    maxHeight: 150,
  },
  memberItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  memberLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  memberAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#334155",
    alignItems: "center",
    justifyContent: "center",
  },
  memberAvatarText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#ffffff",
  },
  memberUsername: {
    fontSize: 13,
    fontWeight: "600",
    color: "#f8fafc",
  },
  badgesRow: {
    flexDirection: "row",
    gap: 4,
  },
  creatorBadge: {
    backgroundColor: "rgba(56, 189, 248, 0.2)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  creatorBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#38bdf8",
  },
  youBadge: {
    backgroundColor: "#334155",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  youBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#94a3b8",
  },
  checklistContainer: {
    backgroundColor: "#1e293b",
    borderRadius: 12,
    padding: 6,
    maxHeight: 140,
  },
  emptyText: {
    fontSize: 12,
    color: "#94a3b8",
    textAlign: "center",
    padding: 10,
  },
  checklistItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  checklistItemActive: {
    backgroundColor: "rgba(56, 189, 248, 0.15)",
  },
  checkboxIcon: {
    fontSize: 16,
    color: "#38bdf8",
    marginRight: 8,
  },
  checklistText: {
    fontSize: 13,
    color: "#f8fafc",
    fontWeight: "600",
  },
  btnPrimary: {
    backgroundColor: "#0284c7",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 10,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnPrimaryText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 13,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
  },
  btnWarning: {
    flex: 1,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.5)",
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  btnWarningText: {
    color: "#f59e0b",
    fontWeight: "700",
    fontSize: 13,
  },
  btnDanger: {
    flex: 1,
    backgroundColor: "#ef4444",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  btnDangerText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 13,
  },
});
