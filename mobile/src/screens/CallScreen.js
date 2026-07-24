import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Safely attempt to load expo-sensors ProximitySensor if available
let ProximitySensor = null;
try {
  const Sensors = require('expo-sensors');
  if (Sensors && Sensors.ProximitySensor) {
    ProximitySensor = Sensors.ProximitySensor;
  }
} catch (e) {}

export default function CallScreen({ route, navigation, onSendMessage, callState, onHangupCall }) {
  const { username, direction } = route.params || {}; // direction: 'incoming' | 'outgoing'
  const [status, setStatus] = useState(direction === 'incoming' ? 'Incoming secure call...' : 'Ringing...');
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [isNearEar, setIsNearEar] = useState(false);
  const [screenSaverActive, setScreenSaverActive] = useState(false);
  const timerRef = useRef(null);

  // Monitor hardware Proximity Sensor (detects phone near ear)
  useEffect(() => {
    let sub = null;
    if (ProximitySensor && typeof ProximitySensor.addListener === 'function') {
      try {
        sub = ProximitySensor.addListener(data => {
          const near = typeof data.near !== 'undefined' ? data.near : (data.distance < 2);
          setIsNearEar(near);
        });
      } catch (e) {}
    }
    return () => {
      if (sub && typeof sub.remove === 'function') sub.remove();
    };
  }, []);

  // Monitor global callState shifts from WebSocket notifications
  useEffect(() => {
    if (callState) {
      if (callState.status === 'connected') {
        setStatus('Connected');
        // Start duration counter
        if (!timerRef.current) {
          timerRef.current = setInterval(() => {
            setDuration(prev => prev + 1);
          }, 1000);
        }
      } else if (callState.status === 'disconnected') {
        handleHangup();
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callState]);

  // If outgoing, send signaling call-offer immediately
  useEffect(() => {
    if (direction === 'outgoing') {
      onSendMessage({
        type: 'call-offer',
        recipient: username,
        offer: { sdp: 'simulated-sdp-audio-only' }
      });
    }
  }, []);

  function handleAccept() {
    onSendMessage({
      type: 'call-answer',
      recipient: username,
      answer: { sdp: 'simulated-sdp-answer' }
    });
    setStatus('Connected');
    if (!timerRef.current) {
      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
    }
  }

  function handleDecline() {
    onSendMessage({
      type: 'call-hangup',
      recipient: username
    });
    handleHangup();
  }

  function handleHangup() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (onHangupCall) onHangupCall();
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('MainHome');
    }
  }

  function toggleMute() {
    const nextMuted = !muted;
    setMuted(nextMuted);
    onSendMessage({
      type: 'mute',
      recipient: username,
      muted: nextMuted
    });
  }

  function formatTime(secs) {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remainingSecs.toString().padStart(2, '0')}`;
  }

  const isConnected = status === 'Connected';

  // ── EARPIECE PROXIMITY BLACK SCREEN OVERLAY ──
  // Blackout display when phone is held to ear or when manual screen saver is toggled
  if (isNearEar || screenSaverActive) {
    return (
      <TouchableOpacity
        activeOpacity={1}
        style={styles.blackScreenOverlay}
        onPress={() => setScreenSaverActive(false)}
      >
        <Text style={styles.screenSaverHint}>[Phone held to ear • Screen dimming active]</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.profile}>
        <View style={styles.largeAvatar}>
          <Text style={styles.largeAvatarText}>{(username || 'U').substring(0, 2).toUpperCase()}</Text>
        </View>
        <Text style={styles.username}>@{username}</Text>
        <Text style={styles.status}>{isConnected ? formatTime(duration) : status}</Text>
      </View>

      <View style={styles.actionsGrid}>
        {/* Incoming controls (Accept / Decline) */}
        {!isConnected && direction === 'incoming' && (
          <View style={styles.btnRow}>
            <TouchableOpacity style={[styles.btn, styles.acceptBtn]} onPress={handleAccept}>
              <Ionicons name="call" size={28} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.declineBtn]} onPress={handleDecline}>
              <Ionicons name="call" size={28} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
            </TouchableOpacity>
          </View>
        )}

        {/* Outgoing or Connected controls */}
        {(isConnected || direction === 'outgoing') && (
          <View style={styles.btnRow}>
            {isConnected && (
              <TouchableOpacity style={[styles.btn, styles.muteBtn, muted && styles.muteBtnActive]} onPress={toggleMute}>
                <Ionicons name={muted ? "mic-off" : "mic"} size={26} color="#fff" />
              </TouchableOpacity>
            )}

            {/* Manual Ear/Pocket Screen Dimming Saver */}
            <TouchableOpacity style={[styles.btn, styles.saverBtn]} onPress={() => setScreenSaverActive(true)}>
              <Ionicons name="moon" size={24} color="#a0aec0" />
            </TouchableOpacity>

            <TouchableOpacity style={[styles.btn, styles.declineBtn]} onPress={handleDecline}>
              <Ionicons name="call" size={28} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0d16',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 80,
  },
  profile: {
    alignItems: 'center',
    marginTop: 40,
  },
  largeAvatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#00f2fe',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: '#00f2fe',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    elevation: 10,
  },
  largeAvatarText: {
    color: '#0c101a',
    fontWeight: '800',
    fontSize: 38,
  },
  username: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 24,
    marginBottom: 8,
  },
  status: {
    color: '#a0aec0',
    fontSize: 14,
  },
  actionsGrid: {
    width: '100%',
    alignItems: 'center',
  },
  btnRow: {
    flexDirection: 'row',
    gap: 20,
  },
  btn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  acceptBtn: {
    backgroundColor: '#48bb78',
  },
  declineBtn: {
    backgroundColor: '#e53e3e',
  },
  muteBtn: {
    backgroundColor: '#1a202c',
    borderWidth: 1,
    borderColor: '#4a5568',
  },
  muteBtnActive: {
    backgroundColor: '#dd6b20',
  },
  saverBtn: {
    backgroundColor: '#1a202c',
    borderWidth: 1,
    borderColor: '#2d3748',
  },
  blackScreenOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 99999,
  },
  screenSaverHint: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '600',
  }
});
