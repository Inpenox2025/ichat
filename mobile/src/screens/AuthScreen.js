import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateIdentityKeys } from '../services/crypto';

export default function AuthScreen({ onAuthSuccess }) {
  const [serverUrl, setServerUrl] = useState('https://ichat.inspenox.in'); // Default Live Server
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [username, setUsername] = useState('');
  const [step, setStep] = useState(1); // 1: Send OTP, 2: Verify OTP, 3: Set Username, 4: Device Limit Conflict
  const [loading, setLoading] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [conflictDevices, setConflictDevices] = useState([]);

  // E2EE credentials cached during auth
  const [localKeys, setLocalKeys] = useState(null);

  useEffect(() => {
    async function loadDevice() {
      let id = await AsyncStorage.getItem('ichat_device_id');
      if (!id) {
        id = 'mob-' + Math.random().toString(36).substring(2, 15);
        await AsyncStorage.setItem('ichat_device_id', id);
      }
      setDeviceId(id);

      // Load or generate identity keypair
      let pub = await AsyncStorage.getItem('ichat_identity_key_public');
      let priv = await AsyncStorage.getItem('ichat_identity_key_private');
      if (pub && priv) {
        setLocalKeys({ publicKey: pub, privateKey: priv });
      } else {
        const keypair = generateIdentityKeys();
        await AsyncStorage.setItem('ichat_identity_key_public', keypair.publicKey);
        await AsyncStorage.setItem('ichat_identity_key_private', keypair.privateKey);
        setLocalKeys(keypair);
      }
    }
    loadDevice();
  }, []);

  async function handleSendOtp() {
    if (!email || !email.includes('@')) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${serverUrl}/api/auth/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send OTP');
      
      setStep(2);
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(replaceDeviceId = null, revokeAll = false) {
    if (!otp || otp.length !== 6) {
      Alert.alert('Error', 'Please enter the 6-digit verification code');
      return;
    }

    setLoading(true);
    try {
      let id = deviceId;
      if (!id) {
        id = await AsyncStorage.getItem('ichat_device_id');
        if (!id) {
          id = 'mob-' + Math.random().toString(36).substring(2, 15);
          await AsyncStorage.setItem('ichat_device_id', id);
        }
        setDeviceId(id);
      }

      let keys = localKeys;
      if (!keys) {
        let pub = await AsyncStorage.getItem('ichat_identity_key_public');
        let priv = await AsyncStorage.getItem('ichat_identity_key_private');
        if (pub && priv) {
          keys = { publicKey: pub, privateKey: priv };
        } else {
          keys = generateIdentityKeys();
          await AsyncStorage.setItem('ichat_identity_key_public', keys.publicKey);
          await AsyncStorage.setItem('ichat_identity_key_private', keys.privateKey);
        }
        setLocalKeys(keys);
      }

      const payload = {
        email: email.trim().toLowerCase(),
        code: otp,
        device_id: id,
        device_name: 'Android Device',
        public_key: keys.publicKey
      };

      if (revokeAll) {
        payload.revoke_all = true;
      } else if (replaceDeviceId) {
        payload.replace_device_id = replaceDeviceId;
      }

      const res = await fetch(`${serverUrl}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (res.status === 409 && data.error === 'MAX_DEVICES_EXCEEDED') {
        setConflictDevices(data.devices);
        setStep(4);
        return;
      }

      if (!res.ok) throw new Error(data.error || 'OTP verification failed');

      // Save token & user
      await AsyncStorage.setItem('ichat_token', data.token);
      await AsyncStorage.setItem('ichat_user', JSON.stringify(data.user));
      await AsyncStorage.setItem('ichat_server_url', serverUrl);

      if (data.username_required) {
        setStep(3);
      } else {
        onAuthSuccess(data.token, data.user, serverUrl);
      }
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSetUsername() {
    const cleanUsername = username.trim().toLowerCase();
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(cleanUsername)) {
      Alert.alert('Error', 'Username must be 3-20 alphanumeric characters or underscores');
      return;
    }

    setLoading(true);
    try {
      const token = await AsyncStorage.getItem('ichat_token');
      const res = await fetch(`${serverUrl}/api/auth/register-username`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ username: cleanUsername })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to set username');

      await AsyncStorage.setItem('ichat_user', JSON.stringify(data.user));
      onAuthSuccess(token, data.user, serverUrl);
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#090d16' }}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          
          {/* Logo & E2EE Header */}
          <View style={styles.headerBox}>
            <View style={styles.iconCircle}>
              <Text style={{ fontSize: 26 }}>🔒</Text>
            </View>
            <Text style={styles.logo}>ichat</Text>
            <View style={styles.e2eeBadge}>
              <Text style={styles.e2eeBadgeText}>🛡️ ZERO-KNOWLEDGE E2EE</Text>
            </View>
            <Text style={styles.subtitle}>Private, Encrypted Messaging System</Text>
          </View>

          {/* Step Progress Indicator */}
          <View style={styles.stepIndicator}>
            <View style={[styles.stepDot, step >= 1 && styles.stepDotActive]} />
            <View style={[styles.stepLine, step >= 2 && styles.stepLineActive]} />
            <View style={[styles.stepDot, step >= 2 && styles.stepDotActive]} />
            <View style={[styles.stepLine, step >= 3 && styles.stepLineActive]} />
            <View style={[styles.stepDot, step >= 3 && styles.stepDotActive]} />
          </View>

          {/* Step 1: Request OTP */}
          {step === 1 && (
            <View style={styles.form}>
              <Text style={styles.stepTitle}>Enter Your Email</Text>
              <Text style={styles.label}>Email Address</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="name@domain.com"
                placeholderTextColor="#4a5568"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />

              <TouchableOpacity style={styles.button} onPress={handleSendOtp} disabled={loading}>
                {loading ? <ActivityIndicator color="#0c101a" /> : <Text style={styles.buttonText}>Send Code →</Text>}
              </TouchableOpacity>
            </View>
          )}

          {/* Step 2: Verify OTP */}
          {step === 2 && (
            <View style={styles.form}>
              <TouchableOpacity style={styles.backBtn} onPress={() => setStep(1)}>
                <Text style={styles.backBtnText}>← Change Email ({email})</Text>
              </TouchableOpacity>

              <Text style={styles.stepTitle}>Verify Security Code</Text>
              <Text style={styles.label}>Enter 6-Digit Code</Text>
              <TextInput
                style={[styles.input, { letterSpacing: 4, fontSize: 18, textAlign: 'center' }]}
                value={otp}
                onChangeText={setOtp}
                placeholder="• • • • • •"
                placeholderTextColor="#4a5568"
                keyboardType="number-pad"
                maxLength={6}
              />

              <TouchableOpacity style={styles.button} onPress={() => handleVerifyOtp()} disabled={loading}>
                {loading ? <ActivityIndicator color="#0c101a" /> : <Text style={styles.buttonText}>Verify & Login ✓</Text>}
              </TouchableOpacity>
            </View>
          )}

          {/* Step 3: Choose Username */}
          {step === 3 && (
            <View style={styles.form}>
              <Text style={styles.stepTitle}>Set Your Handle</Text>
              <Text style={styles.label}>Choose Username</Text>
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={setUsername}
                placeholder="e.g. alice_secure"
                placeholderTextColor="#4a5568"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.tip}>3-20 characters: letters, numbers, and underscores.</Text>

              <TouchableOpacity style={styles.button} onPress={handleSetUsername} disabled={loading}>
                {loading ? <ActivityIndicator color="#0c101a" /> : <Text style={styles.buttonText}>Complete Setup →</Text>}
              </TouchableOpacity>
            </View>
          )}

          {/* Step 4: Device Limit Conflict */}
          {step === 4 && (
            <View style={styles.form}>
              <Text style={styles.conflictHeader}>⚠️ Device Limit Exceeded</Text>
              <Text style={styles.conflictDesc}>You have reached the maximum limit of 3 active devices. Revoke all previous sessions to continue, or select a device to replace:</Text>
              
              <TouchableOpacity 
                style={[styles.button, { backgroundColor: '#ef4444', marginBottom: 16 }]} 
                onPress={() => handleVerifyOtp(null, true)}
                disabled={loading}
              >
                {loading ? <ActivityIndicator color="#ffffff" /> : <Text style={[styles.buttonText, { color: '#ffffff' }]}>⚡ Revoke All Sessions & Login</Text>}
              </TouchableOpacity>

              {conflictDevices.map((dev) => (
                <TouchableOpacity 
                  key={dev.device_id} 
                  style={styles.conflictItem}
                  onPress={() => handleVerifyOtp(dev.device_id)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.conflictDeviceName}>{dev.device_name || 'Device Session'} ({dev.device_id.substring(0, 8)}...)</Text>
                    <Text style={styles.conflictDeviceDate}>Last active: {new Date(dev.last_active).toLocaleDateString()}</Text>
                  </View>
                  <View style={styles.replaceChip}>
                    <Text style={styles.replaceChipText}>Replace →</Text>
                  </View>
                </TouchableOpacity>
              ))}

              <TouchableOpacity style={[styles.button, {backgroundColor: '#2d3748', marginTop: 10}]} onPress={() => setStep(2)}>
                <Text style={styles.buttonText}>← Go Back</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#090d16',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderRadius: 24,
    padding: 28,
    borderWidth: 1,
    borderColor: 'rgba(0, 242, 254, 0.2)',
    alignItems: 'center',
    shadowColor: '#00f2fe',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  headerBox: {
    alignItems: 'center',
    marginBottom: 20,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0, 242, 254, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0, 242, 254, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  logo: {
    fontWeight: '900',
    fontSize: 34,
    color: '#00f2fe',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  e2eeBadge: {
    backgroundColor: 'rgba(0, 242, 254, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0, 242, 254, 0.3)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 8,
  },
  e2eeBadgeText: {
    color: '#00f2fe',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
  },
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    width: '60%',
  },
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
  },
  stepDotActive: {
    backgroundColor: '#00f2fe',
    borderColor: '#00f2fe',
  },
  stepLine: {
    flex: 1,
    height: 2,
    backgroundColor: '#1e293b',
    marginHorizontal: 4,
  },
  stepLineActive: {
    backgroundColor: '#00f2fe',
  },
  form: {
    width: '100%',
  },
  stepTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 14,
    textAlign: 'center',
  },
  label: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#06080d',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    color: '#fff',
    padding: 14,
    fontSize: 15,
    marginBottom: 18,
  },
  button: {
    backgroundColor: '#00f2fe',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#00f2fe',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 5,
    marginTop: 6,
  },
  buttonText: {
    color: '#0c101a',
    fontWeight: '800',
    fontSize: 15,
  },
  backBtn: {
    marginBottom: 14,
  },
  backBtnText: {
    color: '#00f2fe',
    fontWeight: '600',
    fontSize: 13,
  },
  tip: {
    color: '#64748b',
    fontSize: 11,
    marginBottom: 16,
  },
  conflictHeader: {
    color: '#ef4444',
    fontWeight: '700',
    fontSize: 17,
    marginBottom: 10,
    textAlign: 'center',
  },
  conflictDesc: {
    color: '#94a3b8',
    fontSize: 13,
    marginBottom: 20,
    lineHeight: 18,
    textAlign: 'center',
  },
  conflictItem: {
    backgroundColor: '#06080d',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  conflictDeviceName: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  conflictDeviceDate: {
    color: '#64748b',
    fontSize: 11,
  },
  replaceChip: {
    backgroundColor: '#00f2fe',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginLeft: 8,
  },
  replaceChipText: {
    color: '#0c101a',
    fontWeight: '700',
    fontSize: 11,
  },
});
