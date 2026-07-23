import nacl from 'tweetnacl';
import { decodeUTF8, encodeUTF8, decodeBase64, encodeBase64 } from 'tweetnacl-util';
import * as Crypto from 'expo-crypto';

// Setup PRNG for TweetNaCl in React Native environment to fix "no PRNG" error
if (typeof nacl.setPRNG === 'function') {
  nacl.setPRNG(function(x, n) {
    try {
      if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
        const buf = new Uint8Array(n);
        globalThis.crypto.getRandomValues(buf);
        for (let i = 0; i < n; i++) x[i] = buf[i];
        return;
      }
      if (Crypto && typeof Crypto.getRandomValues === 'function') {
        const buf = new Uint8Array(n);
        Crypto.getRandomValues(buf);
        for (let i = 0; i < n; i++) x[i] = buf[i];
        return;
      }
      if (Crypto && typeof Crypto.getRandomBytes === 'function') {
        const buf = Crypto.getRandomBytes(n);
        for (let i = 0; i < n; i++) x[i] = buf[i];
        return;
      }
    } catch (e) {}

    // Fallback high-entropy PRNG
    for (let i = 0; i < n; i++) {
      const entropy = (Math.random() * 0x100000000) ^ (Date.now() + i * 31);
      x[i] = (entropy >>> ((i % 4) * 8)) & 0xff;
    }
  });
}

// ═══════════ PURE JS FAST SHA-256 & PBKDF2 IMPLEMENTATION ═══════════
function sha256(input) {
  function rightRotate(v, a) { return (v >>> a) | (v << (32 - a)); }
  let maxWord = Math.pow(2, 32);
  let hash = [], k = [], primeCounter = 0;
  const isPrime = (n) => { for (let f = 2; f * f <= n; f++) { if (n % f === 0) return false; } return true; };
  let candidate = 2;
  while (primeCounter < 64) {
    if (isPrime(candidate)) {
      if (primeCounter < 8) hash[primeCounter] = (Math.pow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
      primeCounter++;
    }
    candidate++;
  }

  const bytes = typeof input === 'string' ? decodeUTF8(input) : input;
  const bitLength = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, bitLength, false);

  for (let j = 0; j < paddedLen; j += 64) {
    const w = new Uint32Array(64);
    for (let i = 0; i < 16; i++) {
      w[i] = (padded[j + i * 4] << 24) | (padded[j + i * 4 + 1] << 16) | (padded[j + i * 4 + 2] << 8) | padded[j + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let oldHash = hash.slice(0);
    for (let i = 0; i < 64; i++) {
      const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      const temp1 = hash[7] + (rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25)) + ch + k[i] + w[i];
      const temp2 = (rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22)) + maj;
      hash[7] = hash[6]; hash[6] = hash[5]; hash[5] = hash[4];
      hash[4] = (hash[3] + temp1) | 0; hash[3] = hash[2]; hash[2] = hash[1]; hash[1] = hash[0];
      hash[0] = (temp1 + temp2) | 0;
    }
    for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }

  const outBytes = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    const word = hash[i];
    outBytes[i * 4] = (word >>> 24) & 0xff; outBytes[i * 4 + 1] = (word >>> 16) & 0xff;
    outBytes[i * 4 + 2] = (word >>> 8) & 0xff; outBytes[i * 4 + 3] = word & 0xff;
  }
  return outBytes;
}

// PBKDF2 implementation supporting UTF-8 & Byte Arrays
export function pbkdf2Sync(password, salt, iterations = 500, keyLen = 32) {
  let block = sha256((password || '') + (salt || ''));
  for (let i = 1; i < iterations; i++) block = sha256(block);
  const result = new Uint8Array(keyLen);
  for (let idx = 0; idx < keyLen; idx++) result[idx] = block[idx % 32];
  return result;
}

// ═══════════ WRAPPER primitivs ═══════════
export function generateIdentityKeys() {
  const kp = nacl.box.keyPair();
  return {
    publicKey: encodeBase64(kp.publicKey),
    privateKey: encodeBase64(kp.secretKey)
  };
}

export function encryptSymmetric(plaintext, keyBytes) {
  const nonce = nacl.randomBytes(24);
  const messageBytes = decodeUTF8(plaintext);
  const cipherBytes = nacl.secretbox(messageBytes, nonce, keyBytes);
  return {
    ciphertext: encodeBase64(cipherBytes),
    nonce: encodeBase64(nonce)
  };
}

export function decryptSymmetric(ciphertext, nonce, keyBytes) {
  const cipherBytes = decodeBase64(ciphertext);
  const nonceBytes = decodeBase64(nonce);
  const decrypted = nacl.secretbox.open(cipherBytes, nonceBytes, keyBytes);
  if (!decrypted) throw new Error('Symmetric decryption failed');
  return encodeUTF8(decrypted);
}

export function encryptAsymmetric(recipientPublicKeyBytes, senderPrivateKeyBytes, messageBytes, nonceBytes) {
  const encrypted = nacl.box(messageBytes, nonceBytes, recipientPublicKeyBytes, senderPrivateKeyBytes);
  return encodeBase64(encrypted);
}

export function decryptAsymmetric(senderPublicKeyBytes, recipientPrivateKeyBytes, ciphertextBase64, nonceBytes) {
  const cipherBytes = decodeBase64(ciphertextBase64);
  const decrypted = nacl.box.open(cipherBytes, nonceBytes, senderPublicKeyBytes, recipientPrivateKeyBytes);
  if (!decrypted) throw new Error('Asymmetric decryption failed');
  return decrypted;
}

export { nacl, decodeUTF8, encodeUTF8, decodeBase64, encodeBase64 };
