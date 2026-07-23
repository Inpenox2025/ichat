import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
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

  async function handleVerifyOtp(replaceDeviceId = null) {
    if (!otp || otp.length !== 6) {
      Alert.alert('Error', 'Please enter the 6-digit verification code');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        email: email.trim().toLowerCase(),
        code: otp,
        device_id: deviceId,
        device_name: 'Android Device',
        public_key: localKeys.publicKey
      };

      if (replaceDeviceId) {
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
    <ScrollView contentContainerStyle={styles.container}>
      <View class="auth-card" style={styles.card}>
        <Text style={styles.logo}>ichat</Text>
        <Text style={styles.subtitle}>Secure End-to-End Encrypted Chat</Text>

        {/* Step 1: Request OTP */}
        {step === 1 && (
          <View style={styles.form}>
            <Text style={styles.label}>Server Endpoint IP/Port</Text>
            <TextInput
              style={styles.input}
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="e.g. http://192.168.1.100:3000"
              autoCapitalize="none"
              keyboardType="url"
            />

            <Text style={styles.label}>Email Address</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="name@domain.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />

            <TouchableOpacity style={styles.button} onPress={handleSendOtp} disabled={loading}>
              {loading ? <ActivityIndicator color="#0c101a" /> : <Text style={styles.buttonText}>Send Code</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* Step 2: Verify OTP */}
        {step === 2 && (
          <View style={styles.form}>
            <TouchableOpacity style={styles.backBtn} onPress={() => setStep(1)}>
              <Text style={styles.backBtnText}>← Change Email</Text>
            </TouchableOpacity>

            <Text style={styles.label}>Enter Code sent to {email}</Text>
            <TextInput
              style={styles.input}
              value={otp}
              onChangeText={setOtp}
              placeholder="6-digit verification code"
              keyboardType="number-pad"
              maxLength={6}
            />

            <TouchableOpacity style={styles.button} onPress={() => handleVerifyOtp()} disabled={loading}>
              {loading ? <ActivityIndicator color="#0c101a" /> : <Text style={styles.buttonText}>Verify OTP</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* Step 3: Choose Username */}
        {step === 3 && (
          <View style={styles.form}>
            <Text style={styles.label}>Set Unique Username</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              placeholder="e.g. alice_secure"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.tip}>3-20 characters: letters, numbers, and underscores.</Text>

            <TouchableOpacity style={styles.button} onPress={handleSetUsername} disabled={loading}>
              {loading ? <ActivityIndicator color="#0c101a" /> : <Text style={styles.buttonText}>Set Username</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* Step 4: Device Limit Conflict */}
        {step === 4 && (
          <View style={styles.form}>
            <Text style={styles.conflictHeader}>Session Limit Exceeded</Text>
            <Text style={styles.conflictDesc}>You can only register up to 3 active devices. Select an existing session to replace:</Text>
            
            {conflictDevices.map((dev) => (
              <TouchableOpacity 
                key={dev.device_id} 
                style={styles.conflictItem}
                onPress={() => handleVerifyOtp(dev.device_id)}
              >
                <Text style={styles.conflictDeviceName}>{dev.device_name}</Text>
                <Text style={styles.conflictDeviceDate}>Active: {new Date(dev.last_active).toLocaleDateString()}</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity style={[styles.button, {backgroundColor: '#555', marginTop: 10}]} onPress={() => setStep(2)}>
              <Text style={styles.buttonText}>Back</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#0c101a',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: 'rgba(22, 28, 45, 0.75)',
    borderRadius: 20,
    padding: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  logo: {
    fontFamily: 'System',
    fontWeight: '800',
    fontSize: 36,
    color: '#00f2fe',
    marginBottom: 8,
  },
  subtitle: {
    color: '#a0aec0',
    fontSize: 14,
    marginBottom: 36,
    textAlign: 'center',
  },
  form: {
    width: '100%',
  },
  label: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#06080d',
    borderWidth: 1,
    borderColor: '#2d3748',
    borderRadius: 10,
    color: '#fff',
    padding: 14,
    fontSize: 15,
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#00f2fe',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#00f2fe',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
    marginTop: 10,
  },
  buttonText: {
    color: '#0c101a',
    fontWeight: '700',
    fontSize: 16,
  },
  backBtn: {
    marginBottom: 16,
  },
  backBtnText: {
    color: '#00f2fe',
    fontWeight: '600',
    fontSize: 14,
  },
  tip: {
    color: '#718096',
    fontSize: 11,
    marginBottom: 16,
  },
  conflictHeader: {
    color: '#f56565',
    fontWeight: '700',
    fontSize: 18,
    marginBottom: 10,
    textAlign: 'center',
  },
  conflictDesc: {
    color: '#a0aec0',
    fontSize: 13,
    marginBottom: 20,
    lineHeight: 18,
    textAlign: 'center',
  },
  conflictItem: {
    backgroundColor: '#06080d',
    borderWidth: 1,
    borderColor: '#2d3748',
    borderRadius: 8,
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
    color: '#718096',
    fontSize: 11,
  }
});
